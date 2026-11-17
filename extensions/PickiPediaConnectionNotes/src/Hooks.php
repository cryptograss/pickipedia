<?php
/**
 * Hooks for PickiPediaConnectionNotes.
 *
 * The note-writer is a system user, created during update.php so nobody can
 * squat the name: the same pattern PickiPediaInvitations uses. A note saved
 * by this user publishes nothing about the visitor — no IP, no account.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaConnectionNotes;

use MediaWiki\Installer\Hook\LoadExtensionSchemaUpdatesHook;
use User;

class Hooks implements LoadExtensionSchemaUpdatesHook {

	public const SYSTEM_USER_NAME = 'ConnectionInbox-bot';

	/** @inheritDoc */
	public function onLoadExtensionSchemaUpdates( $updater ) {
		// Create the system user immediately, during update.php, before the
		// wiki is publicly accessible.
		$updater->addExtensionUpdate( [ [ __CLASS__, 'createSystemUser' ] ] );
	}

	/** Create the system user account that saves the notes. */
	public static function createSystemUser(): bool {
		$user = User::newSystemUser( self::SYSTEM_USER_NAME, [ 'steal' => false ] );
		if ( $user ) {
			echo "System user '" . self::SYSTEM_USER_NAME . "' is ready.\n";
			return true;
		}
		echo "Could not create system user '" . self::SYSTEM_USER_NAME . "'.\n";
		return false;
	}
}
