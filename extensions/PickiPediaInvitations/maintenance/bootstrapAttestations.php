<?php
/**
 * Bootstrap EntityAttestation pages for existing users.
 *
 * Creates attestation pages for all users who don't have one,
 * marking them as "genesis" users who predate the invitation system.
 *
 * Usage: php maintenance/bootstrapAttestations.php
 *
 * @file
 * @ingroup Maintenance
 */

use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use MediaWiki\User\User;

$IP = getenv( 'MW_INSTALL_PATH' );
if ( $IP === false ) {
	$IP = dirname( __DIR__, 4 );
}
require_once "$IP/maintenance/Maintenance.php";

class BootstrapAttestations extends Maintenance {

	public function __construct() {
		parent::__construct();
		$this->addDescription( 'Create EntityAttestation pages for existing users (genesis users)' );
		$this->addOption( 'dry-run', 'Show what would be done without making changes' );
		$this->addOption( 'user', 'Process only this username', false, true );
		$this->addOption( 'exclude-bots', 'Skip users in the bot group' );
		$this->requireExtension( 'PickiPediaInvitations' );
	}

	public function execute() {
		$dryRun = $this->hasOption( 'dry-run' );
		$excludeBots = $this->hasOption( 'exclude-bots' );
		$specificUser = $this->getOption( 'user' );

		if ( $dryRun ) {
			$this->output( "DRY RUN - no changes will be made\n\n" );
		}

		$services = MediaWikiServices::getInstance();
		$userFactory = $services->getUserFactory();
		$dbr = $services->getDBLoadBalancer()->getConnection( DB_REPLICA );

		// Get system user for creating pages
		$systemUser = User::newSystemUser( 'PickiPedia Invitations', [ 'steal' => true ] );
		if ( !$systemUser && !$dryRun ) {
			$this->fatalError( "Could not create system user\n" );
		}

		// Query for users
		$queryBuilder = $dbr->newSelectQueryBuilder()
			->select( [ 'user_id', 'user_name' ] )
			->from( 'user' )
			->orderBy( 'user_id' );

		if ( $specificUser ) {
			$queryBuilder->where( [ 'user_name' => $specificUser ] );
		}

		$result = $queryBuilder->caller( __METHOD__ )->fetchResultSet();

		$total = 0;
		$created = 0;
		$skipped = 0;

		foreach ( $result as $row ) {
			$total++;
			$userId = (int)$row->user_id;
			$userName = $row->user_name;

			// Skip bots if requested
			if ( $excludeBots ) {
				$user = $userFactory->newFromId( $userId );
				$userGroupManager = $services->getUserGroupManager();
				$groups = $userGroupManager->getUserGroups( $user );
				if ( in_array( 'bot', $groups ) ) {
					$this->output( "SKIP (bot): $userName\n" );
					$skipped++;
					continue;
				}
			}

			// Check if attestation page already exists
			$titleText = "User:$userName/EntityAttestation";
			$title = Title::newFromText( $titleText );

			if ( !$title ) {
				$this->output( "SKIP (invalid title): $userName\n" );
				$skipped++;
				continue;
			}

			if ( $title->exists() ) {
				$this->output( "SKIP (exists): $userName\n" );
				$skipped++;
				continue;
			}

			// Create the attestation page
			$content = $this->buildAttestationContent( $userName );

			if ( $dryRun ) {
				$this->output( "WOULD CREATE: $titleText\n" );
				$created++;
				continue;
			}

			$success = $this->createAttestationPage( $title, $content, $systemUser );

			if ( $success ) {
				$this->output( "CREATED: $titleText\n" );
				$created++;
			} else {
				$this->output( "FAILED: $titleText\n" );
			}
		}

		$this->output( "\n" );
		$this->output( "Total users: $total\n" );
		$this->output( "Created: $created\n" );
		$this->output( "Skipped: $skipped\n" );

		if ( $dryRun ) {
			$this->output( "\nThis was a dry run. Use without --dry-run to make changes.\n" );
		}
	}

	/**
	 * Build the wikitext content for a genesis user attestation.
	 */
	private function buildAttestationContent( string $userName ): string {
		$date = date( 'Y-m-d' );

		return <<<WIKITEXT
{{EntityAttestation
|entity_type=human
|invited_by=Genesis
|invited_at=$date
|genesis=true
}}

[[Category:Genesis Users]]
[[Category:Human Users]]
[[Entity type::human]]
[[Genesis user::true]]
WIKITEXT;
	}

	/**
	 * Create the attestation page and protect it.
	 */
	private function createAttestationPage( Title $title, string $content, User $systemUser ): bool {
		$services = MediaWikiServices::getInstance();
		$wikiPageFactory = $services->getWikiPageFactory();
		$wikiPage = $wikiPageFactory->newFromTitle( $title );

		$contentObj = \ContentHandler::makeContent( $content, $title );
		$updater = $wikiPage->newPageUpdater( $systemUser );
		$updater->setContent( 'main', $contentObj );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			'Bootstrapped genesis user attestation'
		);

		$updater->saveRevision( $comment, EDIT_NEW | EDIT_SUPPRESS_RC );

		if ( !$updater->wasSuccessful() ) {
			return false;
		}

		// Protect the page
		$restrictions = [
			'edit' => 'sysop',
			'move' => 'sysop',
		];
		$expiry = [
			'edit' => 'infinity',
			'move' => 'infinity',
		];

		$wikiPage->doUpdateRestrictions(
			$restrictions,
			$expiry,
			false, // cascade
			'Entity attestation pages are tamper-protected',
			$systemUser
		);

		return true;
	}
}

$maintClass = BootstrapAttestations::class;
require_once RUN_MAINTENANCE_IF_MAIN;
