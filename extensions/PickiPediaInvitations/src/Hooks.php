<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\Installer\Hook\LoadExtensionSchemaUpdatesHook;
use MediaWiki\Hook\LocalUserCreatedHook;
use MediaWiki\User\User;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use ContentHandler;
use DatabaseUpdater;

/**
 * Hooks for PickiPediaInvitations extension.
 */
class Hooks implements LoadExtensionSchemaUpdatesHook, LocalUserCreatedHook {

	/** @var string System user name for creating attestation pages */
	public const SYSTEM_USER_NAME = 'Invitations-bot';

	/**
	 * Hook: LoadExtensionSchemaUpdates
	 *
	 * Register database schema updates and create system user.
	 *
	 * @param DatabaseUpdater $updater
	 */
	public function onLoadExtensionSchemaUpdates( $updater ) {
		$dir = dirname( __DIR__ );

		$updater->addExtensionTable(
			'pickipedia_invites',
			"$dir/sql/tables.sql"
		);

		// Create the system user immediately to prevent username squatting.
		// This runs during update.php before the wiki is publicly accessible.
		$updater->addExtensionUpdate( [
			[ __CLASS__, 'createSystemUser' ]
		] );
	}

	/**
	 * Create the system user account used for attestation pages.
	 *
	 * Called during update.php to ensure the account exists before
	 * anyone can register it through normal signup.
	 *
	 * @return bool
	 */
	public static function createSystemUser(): bool {
		$user = User::newSystemUser( self::SYSTEM_USER_NAME, [ 'steal' => false ] );

		if ( $user ) {
			echo "System user '" . self::SYSTEM_USER_NAME . "' is ready.\n";
			return true;
		}

		// Check if it already exists as a regular user (someone squatted it)
		$existingUser = MediaWikiServices::getInstance()
			->getUserFactory()
			->newFromName( self::SYSTEM_USER_NAME );

		if ( $existingUser && $existingUser->getId() > 0 ) {
			// User exists but isn't a system user - this is a problem
			echo "WARNING: User '" . self::SYSTEM_USER_NAME . "' exists but is not a system user!\n";
			echo "Consider renaming that account or using 'steal' => true.\n";
			return false;
		}

		echo "Failed to create system user '" . self::SYSTEM_USER_NAME . "'.\n";
		return false;
	}

	/**
	 * Hook: LocalUserCreated
	 *
	 * Called after a local user account is created.
	 * Marks the invite as used and creates the EntityAttestation page.
	 *
	 * @param User $user The user that was created
	 * @param bool $autocreated Whether this was an auto-created account
	 */
	public function onLocalUserCreated( $user, $autocreated ) {
		// Don't process auto-created accounts
		if ( $autocreated ) {
			return;
		}

		$request = \RequestContext::getMain()->getRequest();
		$inviteCode = $request->getVal( 'wpInviteCode' ) ?? $request->getVal( 'invite' );

		if ( !$inviteCode ) {
			// No invite code - might be a sysop-created account or invites not required
			return;
		}

		// Mark invite as used
		$marked = InviteStore::markUsed( $inviteCode, $user->getId() );

		if ( !$marked ) {
			// Failed to mark - invite might have been used in a race condition
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to mark invite as used for user {$user->getName()}"
			);
			return;
		}

		// Get the invite details
		$invite = InviteStore::getInviteByCode( $inviteCode );

		if ( !$invite ) {
			return;
		}

		// Create the EntityAttestation page
		$this->createEntityAttestation( $user, $invite );
	}

	/**
	 * Create the EntityAttestation subpage for a user.
	 *
	 * @param User $user The newly created user
	 * @param \stdClass $invite The invite record
	 */
	private function createEntityAttestation( User $user, \stdClass $invite ): void {
		$services = MediaWikiServices::getInstance();
		$userFactory = $services->getUserFactory();

		// Get inviter username
		$inviter = $userFactory->newFromId( (int)$invite->ppi_inviter_id );
		$inviterName = $inviter ? $inviter->getName() : 'Unknown';

		// Create page title
		$titleText = "User:{$user->getName()}/EntityAttestation";
		$title = Title::newFromText( $titleText );

		if ( !$title ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to create title for EntityAttestation: $titleText"
			);
			return;
		}

		// Check if page already exists
		if ( $title->exists() ) {
			return;
		}

		// Build page content
		$entityType = $invite->ppi_entity_type;
		$categoryName = ucfirst( $entityType ) . ' Users';
		$createdDate = wfTimestamp( TS_ISO_8601, $invite->ppi_used_at );
		$dateFormatted = date( 'Y-m-d', strtotime( $createdDate ) );

		$content = <<<WIKITEXT
{{EntityAttestation
|entity_type={$entityType}
|invited_by=User:{$inviterName}
|invited_at={$dateFormatted}
|invite_code_id={$invite->ppi_id}
}}

[[Category:{$categoryName}]]
[[Invited by::User:{$inviterName}]]
[[Entity type::{$entityType}]]
WIKITEXT;

		// Create the page using a system user
		$wikiPageFactory = $services->getWikiPageFactory();
		$wikiPage = $wikiPageFactory->newFromTitle( $title );

		// Use the MediaWiki system user for creating attestation pages
		// (created during update.php to prevent username squatting)
		$systemUser = User::newSystemUser( self::SYSTEM_USER_NAME, [ 'steal' => false ] );

		if ( !$systemUser ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to create system user for EntityAttestation"
			);
			return;
		}

		$contentObj = ContentHandler::makeContent( $content, $title );
		$updater = $wikiPage->newPageUpdater( $systemUser );
		$updater->setContent( 'main', $contentObj );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			"Created entity attestation for {$user->getName()} (invited by {$inviterName})"
		);

		$updater->saveRevision( $comment, EDIT_NEW | EDIT_SUPPRESS_RC );

		if ( !$updater->wasSuccessful() ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to save EntityAttestation: " . $updater->getStatus()->getMessage()->text()
			);
			return;
		}

		// Protect the page so only sysops can edit it
		$this->protectAttestationPage( $title, $systemUser );
	}

	/**
	 * Protect the EntityAttestation page so only sysops can edit.
	 *
	 * @param Title $title
	 * @param User $systemUser
	 */
	private function protectAttestationPage( Title $title, User $systemUser ): void {
		$wikiPage = MediaWikiServices::getInstance()
			->getWikiPageFactory()
			->newFromTitle( $title );

		$restrictions = [
			'edit' => 'sysop',
			'move' => 'sysop',
		];

		$expiry = [
			'edit' => 'infinity',
			'move' => 'infinity',
		];

		$cascade = false;
		$reason = 'Entity attestation pages are tamper-protected';

		$status = $wikiPage->doUpdateRestrictions(
			$restrictions,
			$expiry,
			$cascade,
			$reason,
			$systemUser
		);

		if ( !$status->isOK() ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to protect EntityAttestation page: " . $status->getMessage()->text()
			);
		}
	}
}
