<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\MediaWikiServices;
use Wikimedia\Rdbms\IDatabase;
use stdClass;

/**
 * Database operations for the pickipedia_invites table.
 *
 * Handles creating, validating, and managing invite codes.
 */
class InviteStore {

	/**
	 * Create a new invite code.
	 *
	 * @param int $inviterId User ID of the person creating the invite
	 * @param string $entityType 'human' or 'bot'
	 * @param int|null $expireDays Days until expiration (null = use config default, 0 = never)
	 * @param string|null $intendedFor Intended username (soft tracking, not enforced)
	 * @param string $relationshipType How the inviter knows the invitee
	 * @param string|null $notes Freeform notes about the invitee
	 * @return array ['success' => bool, 'code' => string|null, 'error' => string|null]
	 */
	public static function createInvite(
		int $inviterId,
		string $entityType = 'human',
		?int $expireDays = null,
		?string $intendedFor = null,
		string $relationshipType = 'irl-buds',
		?string $notes = null
	): array {
		$config = MediaWikiServices::getInstance()->getMainConfig();

		// Use config default if not specified
		if ( $expireDays === null ) {
			$expireDays = $config->get( 'PickiPediaInviteExpireDays' );
		}

		// Validate entity type
		if ( !in_array( $entityType, [ 'human', 'bot' ] ) ) {
			return [
				'success' => false,
				'code' => null,
				'error' => 'Invalid entity type. Must be "human" or "bot".'
			];
		}

		// Generate random code
		$code = bin2hex( random_bytes( 16 ) ); // 32 hex chars

		// Calculate expiration
		$expiresAt = null;
		if ( $expireDays > 0 ) {
			$expiresAt = wfTimestamp( TS_MW, time() + ( $expireDays * 86400 ) );
		}

		$dbw = self::getDBConnection( DB_PRIMARY );
		$dbw->insert(
			'pickipedia_invites',
			[
				'ppi_code' => $code,
				'ppi_inviter_id' => $inviterId,
				'ppi_invitee_name' => $intendedFor,
				'ppi_entity_type' => $entityType,
				'ppi_relationship_type' => $relationshipType,
				'ppi_created_at' => wfTimestamp( TS_MW ),
				'ppi_expires_at' => $expiresAt,
				'ppi_used_at' => null,
				'ppi_used_by_id' => null,
				'ppi_notes' => $notes,
			],
			__METHOD__
		);

		return [
			'success' => true,
			'code' => $code,
			'error' => null
		];
	}

	/**
	 * Validate an invite code for use during signup.
	 *
	 * @param string $code The invite code
	 * @return array ['valid' => bool, 'invite' => stdClass|null, 'error' => string|null]
	 */
	public static function validateCode( string $code ): array {
		$invite = self::getInviteByCode( $code );

		if ( !$invite ) {
			return [
				'valid' => false,
				'invite' => null,
				'error' => 'Invalid invite code.'
			];
		}

		// Check if already used
		if ( $invite->ppi_used_at !== null ) {
			return [
				'valid' => false,
				'invite' => null,
				'error' => 'This invite code has already been used.'
			];
		}

		// Check if expired
		if ( $invite->ppi_expires_at !== null ) {
			$expiresTimestamp = wfTimestamp( TS_UNIX, $invite->ppi_expires_at );
			if ( time() > $expiresTimestamp ) {
				return [
					'valid' => false,
					'invite' => null,
					'error' => 'This invite code has expired.'
				];
			}
		}

		return [
			'valid' => true,
			'invite' => $invite,
			'error' => null
		];
	}

	/**
	 * Mark an invite as used.
	 *
	 * @param string $code The invite code
	 * @param int $userId The user ID that was created
	 * @return bool Success
	 */
	public static function markUsed( string $code, int $userId ): bool {
		$dbw = self::getDBConnection( DB_PRIMARY );

		$dbw->update(
			'pickipedia_invites',
			[
				'ppi_used_at' => wfTimestamp( TS_MW ),
				'ppi_used_by_id' => $userId,
			],
			[
				'ppi_code' => $code,
				'ppi_used_at' => null, // Only update if not already used
			],
			__METHOD__
		);

		return $dbw->affectedRows() > 0;
	}

	/**
	 * Get an invite by its ID.
	 *
	 * @param int $id
	 * @return stdClass|null
	 */
	public static function getInviteById( int $id ): ?stdClass {
		$dbr = self::getDBConnection( DB_REPLICA );

		$row = $dbr->selectRow(
			'pickipedia_invites',
			'*',
			[ 'ppi_id' => $id ],
			__METHOD__
		);

		return $row ?: null;
	}

	/**
	 * Get an invite by its code.
	 *
	 * @param string $code
	 * @return stdClass|null
	 */
	public static function getInviteByCode( string $code ): ?stdClass {
		$dbr = self::getDBConnection( DB_REPLICA );

		$row = $dbr->selectRow(
			'pickipedia_invites',
			'*',
			[ 'ppi_code' => $code ],
			__METHOD__
		);

		return $row ?: null;
	}

	/**
	 * Get an unused invite for a specific username.
	 *
	 * @param string $username
	 * @return stdClass|null
	 */
	public static function getUnusedInviteByName( string $username ): ?stdClass {
		$dbr = self::getDBConnection( DB_REPLICA );

		$userNameUtils = MediaWikiServices::getInstance()->getUserNameUtils();
		$canonicalName = $userNameUtils->getCanonical( $username );

		if ( $canonicalName === false ) {
			return null;
		}

		$row = $dbr->selectRow(
			'pickipedia_invites',
			'*',
			[
				'ppi_invitee_name' => $canonicalName,
				'ppi_used_at' => null,
			],
			__METHOD__
		);

		return $row ?: null;
	}

	/**
	 * Get all invites created by a user.
	 *
	 * @param int $userId
	 * @return array
	 */
	public static function getInvitesByInviter( int $userId ): array {
		$dbr = self::getDBConnection( DB_REPLICA );

		$result = $dbr->select(
			'pickipedia_invites',
			'*',
			[ 'ppi_inviter_id' => $userId ],
			__METHOD__,
			[ 'ORDER BY' => 'ppi_created_at DESC' ]
		);

		$invites = [];
		foreach ( $result as $row ) {
			$invites[] = $row;
		}

		return $invites;
	}

	/**
	 * Get all invites (for admin view).
	 *
	 * @param int $limit
	 * @param int $offset
	 * @return array
	 */
	public static function getAllInvites( int $limit = 100, int $offset = 0 ): array {
		$dbr = self::getDBConnection( DB_REPLICA );

		$result = $dbr->select(
			'pickipedia_invites',
			'*',
			[],
			__METHOD__,
			[
				'ORDER BY' => 'ppi_created_at DESC',
				'LIMIT' => $limit,
				'OFFSET' => $offset,
			]
		);

		$invites = [];
		foreach ( $result as $row ) {
			$invites[] = $row;
		}

		return $invites;
	}

	/**
	 * Get the invitation chain for a user (who invited them, who invited that person, etc.)
	 *
	 * @param int $userId
	 * @return array Array of user IDs in order: [user, inviter, inviter's inviter, ...]
	 */
	public static function getInviteChain( int $userId ): array {
		$chain = [];
		$currentUserId = $userId;
		$seen = []; // Prevent infinite loops

		while ( $currentUserId && !isset( $seen[$currentUserId] ) ) {
			$seen[$currentUserId] = true;
			$chain[] = $currentUserId;

			// Find the invite that created this user
			$dbr = self::getDBConnection( DB_REPLICA );
			$row = $dbr->selectRow(
				'pickipedia_invites',
				'ppi_inviter_id',
				[ 'ppi_used_by_id' => $currentUserId ],
				__METHOD__
			);

			if ( $row ) {
				$currentUserId = (int)$row->ppi_inviter_id;
			} else {
				// No invite found - this is a genesis user
				break;
			}
		}

		return $chain;
	}

	/**
	 * Revoke an unused invite.
	 *
	 * @param int $inviteId
	 * @return bool Success
	 */
	public static function revokeInvite( int $inviteId ): bool {
		$dbw = self::getDBConnection( DB_PRIMARY );

		// Only delete if unused
		$dbw->delete(
			'pickipedia_invites',
			[
				'ppi_id' => $inviteId,
				'ppi_used_at' => null,
			],
			__METHOD__
		);

		return $dbw->affectedRows() > 0;
	}

	/**
	 * Get the invite that was used to create a user.
	 *
	 * @param int $userId
	 * @return stdClass|null
	 */
	public static function getInviteForUser( int $userId ): ?stdClass {
		$dbr = self::getDBConnection( DB_REPLICA );

		$row = $dbr->selectRow(
			'pickipedia_invites',
			'*',
			[ 'ppi_used_by_id' => $userId ],
			__METHOD__
		);

		return $row ?: null;
	}

	/**
	 * Get database connection.
	 *
	 * @param int $mode DB_REPLICA or DB_PRIMARY
	 * @return IDatabase
	 */
	private static function getDBConnection( int $mode ): IDatabase {
		return MediaWikiServices::getInstance()
			->getDBLoadBalancer()
			->getConnection( $mode );
	}
}
