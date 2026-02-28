<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\Installer\Hook\LoadExtensionSchemaUpdatesHook;
use MediaWiki\Auth\Hook\LocalUserCreatedHook;
use MediaWiki\Hook\EditFilterMergedContentHook;
use MediaWiki\Hook\SidebarBeforeOutputHook;
use MediaWiki\Hook\SkinTemplateNavigation__UniversalHook;
use MediaWiki\User\User;
use SkinTemplate;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use MediaWiki\Content\Content;
use MediaWiki\Context\IContextSource;
use MediaWiki\Status\Status;
use Skin;
use ContentHandler;
use DatabaseUpdater;

/**
 * Hooks for PickiPediaInvitations extension.
 */
class Hooks implements LoadExtensionSchemaUpdatesHook, LocalUserCreatedHook, EditFilterMergedContentHook, SidebarBeforeOutputHook, SkinTemplateNavigation__UniversalHook {

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

		// Add relationship_type column if missing
		$updater->addExtensionField(
			'pickipedia_invites',
			'ppi_relationship_type',
			"$dir/sql/patch-add-relationship-type.sql"
		);

		// Add notes column if missing
		$updater->addExtensionField(
			'pickipedia_invites',
			'ppi_notes',
			"$dir/sql/patch-add-notes.sql"
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
	 * Marks the invite as used and creates the invite-record attestation page.
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
		// Check various possible field names:
		// - wpinviteCode: MediaWiki's wp prefix + field name from AuthRequest
		// - invite: URL parameter for pre-filled invites
		$inviteCode = $request->getVal( 'wpinviteCode' )
			?? $request->getVal( 'inviteCode' )
			?? $request->getVal( 'invite' );

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

		// Create the invite-record attestation page
		$this->createInviteRecord( $user, $invite );
	}

	/**
	 * Create the invite-record attestation page for a user.
	 *
	 * This is the foundational attestation created at account signup,
	 * stored at User:{name}/Attestations/invite-record alongside
	 * user-created attestations at User:{name}/Attestations/by-{attester}.
	 *
	 * @param User $user The newly created user
	 * @param \stdClass $invite The invite record
	 */
	private function createInviteRecord( User $user, \stdClass $invite ): void {
		$services = MediaWikiServices::getInstance();
		$userFactory = $services->getUserFactory();

		// Get inviter username
		$inviter = $userFactory->newFromId( (int)$invite->ppi_inviter_id );
		$inviterName = $inviter ? $inviter->getName() : 'Unknown';

		// Create page title under the unified Attestations structure
		$titleText = "User:{$user->getName()}/Attestations/invite-record";
		$title = Title::newFromText( $titleText );

		if ( !$title ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to create title for invite-record: $titleText"
			);
			return;
		}

		// Check if page already exists
		if ( $title->exists() ) {
			return;
		}

		// Build page content
		$entityType = $invite->ppi_entity_type;
		$relationshipType = $invite->ppi_relationship_type ?? 'irl-buds';
		$intendedFor = $invite->ppi_invitee_name ?? '';
		$notes = $invite->ppi_notes ?? '';
		$categoryName = ucfirst( $entityType ) . ' Users';
		$createdDate = wfTimestamp( TS_ISO_8601, $invite->ppi_used_at );
		$dateFormatted = date( 'Y-m-d', strtotime( $createdDate ) );

		// Note if username differs from intended
		$usernameNote = '';
		if ( $intendedFor && $intendedFor !== $user->getName() ) {
			$usernameNote = "|known_as={$intendedFor}";
		} elseif ( $intendedFor ) {
			$usernameNote = "|known_as={$intendedFor}";
		}

		$content = <<<WIKITEXT
{{InviteRecord
|entity_type={$entityType}
|relationship_type={$relationshipType}
|invited_by=User:{$inviterName}
|invited_at={$dateFormatted}
|invite_code_id={$invite->ppi_id}{$usernameNote}
}}

{$notes}

[[Category:{$categoryName}]]
[[Category:Attestations]]
[[Invited by::User:{$inviterName}]]
[[Entity type::{$entityType}]]
[[Attestation type::{$relationshipType}]]
WIKITEXT;

		// Create the page using a system user
		$wikiPageFactory = $services->getWikiPageFactory();
		$wikiPage = $wikiPageFactory->newFromTitle( $title );

		// Use the MediaWiki system user for creating attestation pages
		// (created during update.php to prevent username squatting)
		$systemUser = User::newSystemUser( self::SYSTEM_USER_NAME, [ 'steal' => false ] );

		if ( !$systemUser ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to create system user for invite-record"
			);
			return;
		}

		$contentObj = ContentHandler::makeContent( $content, $title );
		$updater = $wikiPage->newPageUpdater( $systemUser );
		$updater->setContent( 'main', $contentObj );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			"Created invite record for {$user->getName()} (invited by {$inviterName})"
		);

		$updater->saveRevision( $comment, EDIT_NEW | EDIT_SUPPRESS_RC );

		if ( !$updater->wasSuccessful() ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to save invite-record: " . $updater->getStatus()->getMessage()->text()
			);
			return;
		}

		// Protect the page so only sysops can edit it
		$this->protectAttestationPage( $title, $systemUser );
	}

	/**
	 * Protect the invite-record page so only sysops can edit.
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
		$reason = 'Invite records are tamper-protected';

		$status = $wikiPage->doUpdateRestrictions(
			$restrictions,
			$expiry,
			$cascade,
			$reason,
			$systemUser
		);

		if ( !$status->isOK() ) {
			wfDebugLog( 'PickiPediaInvitations',
				"Failed to protect invite-record page: " . $status->getMessage()->text()
			);
		}
	}

	/**
	 * Hook: EditFilterMergedContent
	 *
	 * Enforce that only the attester (or sysops) can edit attestation pages.
	 * Attestation pages are at User:{Subject}/Attestations/by-{Attester}
	 *
	 * @param IContextSource $context
	 * @param Content $content
	 * @param StatusValue $status
	 * @param string $summary
	 * @param User $user
	 * @param bool $minoredit
	 * @return bool|void
	 */
	public function onEditFilterMergedContent(
		IContextSource $context,
		Content $content,
		Status $status,
		$summary,
		User $user,
		$minoredit
	) {
		$title = $context->getTitle();

		// Check if this is an attestation page: User:X/Attestations/by-Y
		if ( !$title || $title->getNamespace() !== NS_USER ) {
			return;
		}

		$titleText = $title->getText();

		// Match pattern: Username/Attestations/by-AttesterName
		if ( !preg_match( '#^[^/]+/Attestations/by-(.+)$#', $titleText, $matches ) ) {
			return;
		}

		$attesterName = $matches[1];

		// Check if the current user is the attester or a sysop
		$services = MediaWikiServices::getInstance();
		$userGroupManager = $services->getUserGroupManager();
		$userNameUtils = $services->getUserNameUtils();

		$currentUserName = $user->getName();
		$isSysop = in_array( 'sysop', $userGroupManager->getUserGroups( $user ) );

		// Normalize both names for comparison
		$normalizedAttester = $userNameUtils->getCanonical( $attesterName );
		$normalizedCurrent = $userNameUtils->getCanonical( $currentUserName );

		if ( $normalizedCurrent !== $normalizedAttester && !$isSysop ) {
			$status->fatal( 'pickipediainvitations-attestation-edit-denied' );
			return false;
		}

		return true;
	}

	/**
	 * Hook: SidebarBeforeOutput
	 *
	 * Add "Attest this user" link to sidebar on user pages.
	 * Only shows if: viewing a user page, logged in, not your own page,
	 * and you haven't already attested them.
	 *
	 * @param Skin $skin
	 * @param array &$sidebar
	 */
	public function onSidebarBeforeOutput( $skin, &$sidebar ): void {
		$title = $skin->getTitle();
		$user = $skin->getUser();

		// Must be logged in
		if ( !$user->isRegistered() ) {
			return;
		}

		// Must be viewing a user page (not subpage, not talk)
		if ( !$title || $title->getNamespace() !== NS_USER ) {
			return;
		}

		// Get the root username (in case we're on a subpage)
		$rootText = $title->getRootText();

		// Don't show on your own page
		if ( $rootText === $user->getName() ) {
			return;
		}

		// Check if the subject user exists
		$services = MediaWikiServices::getInstance();
		$userFactory = $services->getUserFactory();
		$subjectUser = $userFactory->newFromName( $rootText );

		if ( !$subjectUser || !$subjectUser->isRegistered() ) {
			return;
		}

		// Check if attestation already exists
		$attestationTitle = Title::newFromText(
			"User:{$rootText}/Attestations/by-{$user->getName()}"
		);

		if ( $attestationTitle && $attestationTitle->exists() ) {
			// Already attested - add a "View your attestation" link instead
			$sidebar['TOOLBOX'][] = [
				'text' => wfMessage( 'pickipediainvitations-sidebar-view-attestation' )->text(),
				'href' => $attestationTitle->getLocalURL(),
				'id' => 't-view-attestation',
			];
			return;
		}

		// Add "Attest this user" link
		$specialTitle = Title::newFromText( 'Special:CreateAttestation' );
		$sidebar['TOOLBOX'][] = [
			'text' => wfMessage( 'pickipediainvitations-sidebar-attest-user' )->text(),
			'href' => $specialTitle->getLocalURL( [ 'subject' => $rootText ] ),
			'id' => 't-attest-user',
		];
	}

	/**
	 * Hook: SkinTemplateNavigation::Universal
	 *
	 * Add "Invite someone" link to personal tools navigation bar,
	 * between contributions and logout.
	 *
	 * @param SkinTemplate $sktemplate
	 * @param array &$links
	 */
	public function onSkinTemplateNavigation__Universal( $sktemplate, &$links ): void {
		$user = $sktemplate->getUser();

		// Only show for logged-in users
		if ( !$user->isRegistered() ) {
			return;
		}

		// Build the invite link
		$inviteTitle = Title::newFromText( 'Special:CreateInvite' );
		$inviteLink = [
			'text' => wfMessage( 'pickipediainvitations-personal-invite' )->text(),
			'href' => $inviteTitle->getLocalURL(),
			'id' => 'pt-invite',
		];

		// Insert before logout in user-menu
		if ( isset( $links['user-menu'] ) ) {
			$newUserMenu = [];
			foreach ( $links['user-menu'] as $key => $item ) {
				if ( $key === 'logout' ) {
					$newUserMenu['invite'] = $inviteLink;
				}
				$newUserMenu[$key] = $item;
			}
			$links['user-menu'] = $newUserMenu;
		}
	}
}
