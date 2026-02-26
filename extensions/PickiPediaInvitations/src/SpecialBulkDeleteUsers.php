<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;

/**
 * Special page for bulk deleting spam bot accounts.
 * Shows a list of users with checkboxes for bulk selection and deletion.
 */
class SpecialBulkDeleteUsers extends SpecialPage {

	public function __construct() {
		parent::__construct( 'BulkDeleteUsers', 'usermerge' );
	}

	public function doesWrites() {
		return true;
	}

	/**
	 * @param string|null $par
	 */
	public function execute( $par ) {
		$this->setHeaders();
		$this->checkPermissions();
		$this->checkReadOnly();

		$out = $this->getOutput();
		$request = $this->getRequest();
		$user = $this->getUser();

		$out->addModules( 'mediawiki.special' );

		// Handle deletion
		if ( $request->wasPosted() && $request->getVal( 'action' ) === 'delete' ) {
			$this->handleBulkDelete( $request, $user );
		}

		// Show the user list
		$this->showUserList();
	}

	/**
	 * Handle bulk deletion of selected users.
	 */
	private function handleBulkDelete( $request, $user ): void {
		$out = $this->getOutput();

		if ( !$user->matchEditToken( $request->getVal( 'token' ) ) ) {
			$out->addHTML( Html::errorBox( 'Invalid security token. Please try again.' ) );
			return;
		}

		$usernames = $request->getArray( 'users', [] );
		if ( empty( $usernames ) ) {
			$out->addHTML( Html::warningBox( 'No users selected.' ) );
			return;
		}

		$services = MediaWikiServices::getInstance();
		$userFactory = $services->getUserFactory();
		$dbw = $services->getDBLoadBalancer()->getConnection( DB_PRIMARY );

		$deleted = [];
		$failed = [];

		foreach ( $usernames as $username ) {
			$targetUser = $userFactory->newFromName( $username );
			if ( !$targetUser || $targetUser->getId() === 0 ) {
				$failed[] = $username . ' (not found)';
				continue;
			}

			// Don't delete users with special permissions
			if ( $targetUser->isAllowed( 'usermerge' ) ||
				 $targetUser->isAllowed( 'delete' ) ||
				 $targetUser->getId() === $user->getId() ) {
				$failed[] = $username . ' (protected)';
				continue;
			}

			// Delete the user directly from the database
			// This is simpler than using UserMerge for bulk operations
			try {
				$userId = $targetUser->getId();

				// Delete from user table
				$dbw->delete( 'user', [ 'user_id' => $userId ], __METHOD__ );

				// Clean up related tables
				$dbw->delete( 'user_groups', [ 'ug_user' => $userId ], __METHOD__ );
				$dbw->delete( 'user_properties', [ 'up_user' => $userId ], __METHOD__ );
				$dbw->delete( 'watchlist', [ 'wl_user' => $userId ], __METHOD__ );
				$dbw->delete( 'logging', [ 'log_actor' => $targetUser->getActorId() ], __METHOD__ );

				$deleted[] = $username;
			} catch ( \Exception $e ) {
				$failed[] = $username . ' (' . $e->getMessage() . ')';
			}
		}

		if ( !empty( $deleted ) ) {
			$out->addHTML( Html::successBox(
				'Deleted ' . count( $deleted ) . ' users: ' . implode( ', ', $deleted )
			) );
		}

		if ( !empty( $failed ) ) {
			$out->addHTML( Html::warningBox(
				'Failed to delete: ' . implode( ', ', $failed )
			) );
		}
	}

	/**
	 * Show the list of users with checkboxes.
	 */
	private function showUserList(): void {
		$out = $this->getOutput();
		$request = $this->getRequest();
		$services = MediaWikiServices::getInstance();
		$dbr = $services->getDBLoadBalancer()->getConnection( DB_REPLICA );

		// Filters
		$showOnlyNoEdits = $request->getBool( 'noedits', true );
		$createdAfter = $request->getVal( 'after', '20260101000000' );
		$limit = min( (int)$request->getVal( 'limit', 100 ), 500 );
		$offset = (int)$request->getVal( 'offset', 0 );

		// Build query
		$conds = [];

		if ( $createdAfter ) {
			$conds[] = 'user_registration >= ' . $dbr->addQuotes( $createdAfter );
		}

		if ( $showOnlyNoEdits ) {
			$conds[] = 'user_editcount = 0';
		}

		// Exclude special users
		$conds[] = 'user_name NOT IN (' . $dbr->makeList( [
			'Invitations-bot',
			'Blue Railroad Imports',
			'BlueRailroad Import',
		] ) . ')';

		$res = $dbr->select(
			'user',
			[ 'user_id', 'user_name', 'user_registration', 'user_editcount' ],
			$conds,
			__METHOD__,
			[
				'ORDER BY' => 'user_registration DESC',
				'LIMIT' => $limit + 1,
				'OFFSET' => $offset,
			]
		);

		$users = [];
		foreach ( $res as $row ) {
			$users[] = $row;
		}

		$hasMore = count( $users ) > $limit;
		if ( $hasMore ) {
			array_pop( $users );
		}

		// Filter form
		$out->addHTML( Html::openElement( 'form', [ 'method' => 'get' ] ) );
		$out->addHTML( Html::openElement( 'fieldset' ) );
		$out->addHTML( Html::element( 'legend', [], 'Filters' ) );

		$out->addHTML( Html::check( 'noedits', $showOnlyNoEdits, [ 'id' => 'noedits' ] ) );
		$out->addHTML( Html::label( ' Only users with 0 edits', 'noedits' ) );
		$out->addHTML( Html::element( 'br' ) );

		$out->addHTML( Html::label( 'Created after (YYYYMMDD): ', 'after' ) );
		$out->addHTML( Html::input( 'after', substr( $createdAfter, 0, 8 ), 'text', [ 'id' => 'after', 'size' => 10 ] ) );
		$out->addHTML( Html::element( 'br' ) );

		$out->addHTML( Html::label( 'Limit: ', 'limit' ) );
		$out->addHTML( Html::input( 'limit', $limit, 'number', [ 'id' => 'limit', 'min' => 1, 'max' => 500 ] ) );
		$out->addHTML( Html::element( 'br' ) );

		$out->addHTML( Html::submitButton( 'Apply Filters' ) );
		$out->addHTML( Html::closeElement( 'fieldset' ) );
		$out->addHTML( Html::closeElement( 'form' ) );

		if ( empty( $users ) ) {
			$out->addHTML( Html::warningBox( 'No users match the criteria.' ) );
			return;
		}

		$out->addHTML( Html::element( 'p', [],
			'Showing ' . count( $users ) . ' users. Check the ones to delete.'
		) );

		// Add select all JS
		$out->addInlineScript( '
			function toggleAll(checked) {
				document.querySelectorAll("input[name=\'users[]\']").forEach(function(cb) {
					cb.checked = checked;
				});
			}
		' );

		// User list form
		$out->addHTML( Html::openElement( 'form', [ 'method' => 'post' ] ) );
		$out->addHTML( Html::hidden( 'action', 'delete' ) );
		$out->addHTML( Html::hidden( 'token', $this->getUser()->getEditToken() ) );

		$out->addHTML( Html::element( 'button', [
			'type' => 'button',
			'onclick' => 'toggleAll(true)'
		], 'Select All' ) );
		$out->addHTML( ' ' );
		$out->addHTML( Html::element( 'button', [
			'type' => 'button',
			'onclick' => 'toggleAll(false)'
		], 'Select None' ) );
		$out->addHTML( ' ' );
		$out->addHTML( Html::submitButton( '🗑️ Delete Selected', [
			'style' => 'background: #c00; color: white; font-weight: bold;',
			'onclick' => 'return confirm("Delete selected users? This cannot be undone!");'
		] ) );

		$out->addHTML( Html::openElement( 'table', [ 'class' => 'wikitable' ] ) );
		$out->addHTML( Html::rawElement( 'tr', [],
			Html::element( 'th', [], '' ) .
			Html::element( 'th', [], 'Username' ) .
			Html::element( 'th', [], 'Created' ) .
			Html::element( 'th', [], 'Edits' )
		) );

		foreach ( $users as $row ) {
			$created = $row->user_registration
				? $this->getLanguage()->userTimeAndDate( $row->user_registration, $this->getUser() )
				: 'Unknown';

			$out->addHTML( Html::rawElement( 'tr', [],
				Html::rawElement( 'td', [],
					Html::check( 'users[]', false, [ 'value' => $row->user_name ] )
				) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [
						'href' => \Title::makeTitle( NS_USER, $row->user_name )->getLocalURL(),
						'target' => '_blank'
					], $row->user_name )
				) .
				Html::element( 'td', [], $created ) .
				Html::element( 'td', [], $row->user_editcount )
			) );
		}

		$out->addHTML( Html::closeElement( 'table' ) );
		$out->addHTML( Html::closeElement( 'form' ) );

		// Pagination
		$paginationHtml = '';
		if ( $offset > 0 ) {
			$paginationHtml .= Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL( [
					'offset' => max( 0, $offset - $limit ),
					'limit' => $limit,
					'noedits' => $showOnlyNoEdits ? 1 : 0,
					'after' => $createdAfter,
				] )
			], '← Previous' ) . ' ';
		}
		if ( $hasMore ) {
			$paginationHtml .= Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL( [
					'offset' => $offset + $limit,
					'limit' => $limit,
					'noedits' => $showOnlyNoEdits ? 1 : 0,
					'after' => $createdAfter,
				] )
			], 'Next →' );
		}

		if ( $paginationHtml ) {
			$out->addHTML( Html::rawElement( 'p', [], $paginationHtml ) );
		}
	}

	/**
	 * @return string
	 */
	protected function getGroupName() {
		return 'users';
	}
}
