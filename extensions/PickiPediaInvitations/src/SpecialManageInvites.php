<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;

/**
 * Special page for administrators to manage invites.
 *
 * Lists all invites, shows invitation chains, and allows revoking unused invites.
 */
class SpecialManageInvites extends SpecialPage {

	public function __construct() {
		parent::__construct( 'ManageInvites', 'sysop' );
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

		$out->addModuleStyles( 'mediawiki.special' );

		// Handle actions
		$action = $request->getVal( 'action' );

		if ( $action === 'revoke' && $request->wasPosted() ) {
			$this->handleRevoke( $request, $user );
		} elseif ( $action === 'chain' ) {
			$this->showInviteChain( $request );
			return;
		}

		// Show main view
		$this->showAllInvites();
	}

	/**
	 * Show all invites with pagination.
	 */
	private function showAllInvites(): void {
		$out = $this->getOutput();
		$request = $this->getRequest();
		$userFactory = MediaWikiServices::getInstance()->getUserFactory();

		$limit = 50;
		$offset = (int)$request->getVal( 'offset', 0 );

		$invites = InviteStore::getAllInvites( $limit + 1, $offset );

		$hasMore = count( $invites ) > $limit;
		if ( $hasMore ) {
			array_pop( $invites );
		}

		$out->addWikiTextAsInterface(
			wfMessage( 'pickipediainvitations-manageinvites-intro' )->text()
		);

		if ( empty( $invites ) ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-manageinvites-none' )->text()
			);
			return;
		}

		// Add inline styles
		$out->addInlineStyle( '
			.mw-manageinvites-status-pending { color: #666; }
			.mw-manageinvites-status-used { color: #080; }
			.mw-manageinvites-status-expired { color: #800; }
			.mw-manageinvites-actions a { margin-right: 1em; }
			.mw-manageinvites-success { background: #dfd; border: 1px solid #0a0; padding: 0.5em; margin: 1em 0; }
			.mw-manageinvites-error { background: #fdd; border: 1px solid #a00; padding: 0.5em; margin: 1em 0; }
		' );

		$html = Html::openElement( 'table', [ 'class' => 'wikitable sortable' ] );
		$html .= Html::rawElement( 'tr', [],
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-id' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-inviter' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-invitee' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-type' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-created' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-expires' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-status' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-actions' )->text() )
		);

		foreach ( $invites as $invite ) {
			$inviter = $userFactory->newFromId( (int)$invite->ppi_inviter_id );
			$inviterName = $inviter ? $inviter->getName() : '#' . $invite->ppi_inviter_id;

			$statusInfo = $this->getStatusInfo( $invite );

			$actions = $this->getActions( $invite );

			$html .= Html::rawElement( 'tr', [],
				Html::element( 'td', [], $invite->ppi_id ) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [
						'href' => \Title::makeTitle( NS_USER, $inviterName )->getLocalURL()
					], $inviterName )
				) .
				Html::element( 'td', [], $invite->ppi_invitee_name ) .
				Html::element( 'td', [], $invite->ppi_entity_type ) .
				Html::element( 'td', [], $this->formatTimestamp( $invite->ppi_created_at ) ) .
				Html::element( 'td', [], $invite->ppi_expires_at
					? $this->formatTimestamp( $invite->ppi_expires_at )
					: wfMessage( 'pickipediainvitations-never' )->text()
				) .
				Html::rawElement( 'td', [ 'class' => $statusInfo['class'] ], $statusInfo['text'] ) .
				Html::rawElement( 'td', [ 'class' => 'mw-manageinvites-actions' ], $actions )
			);
		}

		$html .= Html::closeElement( 'table' );

		// Pagination
		$paginationHtml = '';
		if ( $offset > 0 ) {
			$paginationHtml .= Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL( [
					'offset' => max( 0, $offset - $limit )
				] )
			], wfMessage( 'pickipediainvitations-prev' )->text() ) . ' ';
		}
		if ( $hasMore ) {
			$paginationHtml .= Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL( [
					'offset' => $offset + $limit
				] )
			], wfMessage( 'pickipediainvitations-next' )->text() );
		}

		if ( $paginationHtml ) {
			$html .= Html::rawElement( 'p', [], $paginationHtml );
		}

		$out->addHTML( $html );
	}

	/**
	 * Get status info (text and CSS class) for an invite.
	 */
	private function getStatusInfo( $invite ): array {
		if ( $invite->ppi_used_at !== null ) {
			return [
				'text' => wfMessage( 'pickipediainvitations-status-used' )->text(),
				'class' => 'mw-manageinvites-status-used',
			];
		}

		if ( $invite->ppi_expires_at !== null ) {
			$expiresTimestamp = wfTimestamp( TS_UNIX, $invite->ppi_expires_at );
			if ( time() > $expiresTimestamp ) {
				return [
					'text' => wfMessage( 'pickipediainvitations-status-expired' )->text(),
					'class' => 'mw-manageinvites-status-expired',
				];
			}
		}

		return [
			'text' => wfMessage( 'pickipediainvitations-status-pending' )->text(),
			'class' => 'mw-manageinvites-status-pending',
		];
	}

	/**
	 * Get action links for an invite.
	 */
	private function getActions( $invite ): string {
		$actions = [];

		// View chain link (if used)
		if ( $invite->ppi_used_by_id ) {
			$actions[] = Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL( [
					'action' => 'chain',
					'user' => $invite->ppi_used_by_id
				] )
			], wfMessage( 'pickipediainvitations-action-viewchain' )->text() );
		}

		// Revoke link (if unused)
		if ( $invite->ppi_used_at === null ) {
			$actions[] = Html::rawElement( 'form', [
				'method' => 'post',
				'action' => $this->getPageTitle()->getLocalURL(),
				'style' => 'display: inline;',
			],
				Html::hidden( 'action', 'revoke' ) .
				Html::hidden( 'inviteId', $invite->ppi_id ) .
				Html::hidden( 'token', $this->getUser()->getEditToken() ) .
				Html::submitButton(
					wfMessage( 'pickipediainvitations-action-revoke' )->text(),
					[ 'class' => 'mw-htmlform-submit-destructive' ]
				)
			);
		}

		return implode( ' ', $actions );
	}

	/**
	 * Handle invite revocation.
	 */
	private function handleRevoke( $request, $user ): void {
		$out = $this->getOutput();

		if ( !$user->matchEditToken( $request->getVal( 'token' ) ) ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-manageinvites-error' ],
				wfMessage( 'pickipediainvitations-error-badtoken' )->escaped()
			) );
			return;
		}

		$inviteId = (int)$request->getVal( 'inviteId' );
		if ( !$inviteId ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-manageinvites-error' ],
				wfMessage( 'pickipediainvitations-error-noinvite' )->escaped()
			) );
			return;
		}

		$success = InviteStore::revokeInvite( $inviteId );

		if ( $success ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-manageinvites-success' ],
				wfMessage( 'pickipediainvitations-revoke-success' )->escaped()
			) );
		} else {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-manageinvites-error' ],
				wfMessage( 'pickipediainvitations-revoke-failed' )->escaped()
			) );
		}
	}

	/**
	 * Show the invitation chain for a user.
	 */
	private function showInviteChain( $request ): void {
		$out = $this->getOutput();
		$userFactory = MediaWikiServices::getInstance()->getUserFactory();

		$userId = (int)$request->getVal( 'user' );
		if ( !$userId ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-chain-nouser' )->text()
			);
			return;
		}

		$targetUser = $userFactory->newFromId( $userId );
		if ( !$targetUser || !$targetUser->getId() ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-chain-usernotfound' )->text()
			);
			return;
		}

		$out->setPageTitle(
			wfMessage( 'pickipediainvitations-chain-title', $targetUser->getName() )->text()
		);

		$chain = InviteStore::getInviteChain( $userId );

		if ( count( $chain ) <= 1 ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-chain-genesis', $targetUser->getName() )->text()
			);
			return;
		}

		$html = Html::element( 'p', [],
			wfMessage( 'pickipediainvitations-chain-intro', $targetUser->getName() )->text()
		);

		$html .= Html::openElement( 'ol' );

		foreach ( $chain as $uid ) {
			$u = $userFactory->newFromId( $uid );
			$name = $u ? $u->getName() : '#' . $uid;

			$html .= Html::rawElement( 'li', [],
				Html::element( 'a', [
					'href' => \Title::makeTitle( NS_USER, $name )->getLocalURL()
				], $name )
			);
		}

		$html .= Html::closeElement( 'ol' );

		$html .= Html::element( 'p', [],
			wfMessage( 'pickipediainvitations-chain-explanation' )->text()
		);

		$html .= Html::rawElement( 'p', [],
			Html::element( 'a', [
				'href' => $this->getPageTitle()->getLocalURL()
			], wfMessage( 'pickipediainvitations-chain-backtolist' )->text() )
		);

		$out->addHTML( $html );
	}

	/**
	 * Format a MediaWiki timestamp for display.
	 */
	private function formatTimestamp( string $ts ): string {
		return $this->getLanguage()->userTimeAndDate( $ts, $this->getUser() );
	}

	/**
	 * @return string
	 */
	protected function getGroupName() {
		return 'users';
	}
}
