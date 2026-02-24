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

	/**
	 * Hook: LoadExtensionSchemaUpdates
	 *
	 * Register database schema updates.
	 *
	 * @param DatabaseUpdater $updater
	 */
	public function onLoadExtensionSchemaUpdates( $updater ) {
		$dir = dirname( __DIR__ );

		$updater->addExtensionTable(
			'pickipedia_invites',
			"$dir/sql/tables.sql"
		);
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
		$systemUser = User::newSystemUser( 'PickiPedia Invitations', [ 'steal' => true ] );

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
