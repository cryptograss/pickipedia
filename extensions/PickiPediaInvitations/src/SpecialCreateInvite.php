<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;

/**
 * Special page for creating invite codes.
 *
 * Allows any logged-in user to create invites for new users.
 */
class SpecialCreateInvite extends SpecialPage {

	public function __construct() {
		parent::__construct( 'CreateInvite', 'createaccount' );
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

		// Must be logged in
		if ( !$user->isRegistered() ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-must-be-logged-in' )->text()
			);
			return;
		}

		$out->addModuleStyles( 'mediawiki.special' );

		// Handle form submission
		if ( $request->wasPosted() && $request->getVal( 'action' ) === 'create' ) {
			$this->handleSubmission( $request, $user );
			return;
		}

		// Show the form
		$this->showForm();
	}

	/**
	 * Display the invite creation form.
	 */
	private function showForm(): void {
		$out = $this->getOutput();
		$config = MediaWikiServices::getInstance()->getMainConfig();
		$defaultExpireDays = $config->get( 'PickiPediaInviteExpireDays' );

		$out->addWikiTextAsInterface(
			wfMessage( 'pickipediainvitations-createinvite-intro' )->text()
		);

		$html = Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL(),
			'class' => 'mw-createinvite-form',
		] );

		$html .= Html::hidden( 'action', 'create' );
		$html .= Html::hidden( 'token', $this->getUser()->getEditToken() );

		// Entity type field
		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createinvite-field' ],
			Html::label(
				wfMessage( 'pickipediainvitations-field-entitytype' )->text(),
				'entityType'
			) .
			Html::rawElement( 'select', [
				'id' => 'entityType',
				'name' => 'entityType',
			],
				Html::element( 'option', [ 'value' => 'human', 'selected' => true ],
					wfMessage( 'pickipediainvitations-entitytype-human' )->text()
				) .
				Html::element( 'option', [ 'value' => 'bot' ],
					wfMessage( 'pickipediainvitations-entitytype-bot' )->text()
				)
			) .
			Html::element( 'p', [ 'class' => 'mw-createinvite-help' ],
				wfMessage( 'pickipediainvitations-field-entitytype-help' )->text()
			)
		);

		// Expiration field
		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createinvite-field' ],
			Html::label(
				wfMessage( 'pickipediainvitations-field-expiredays' )->text(),
				'expireDays'
			) .
			Html::input( 'expireDays', (string)$defaultExpireDays, 'number', [
				'id' => 'expireDays',
				'min' => 0,
				'max' => 365,
				'size' => 10,
			] ) .
			Html::element( 'p', [ 'class' => 'mw-createinvite-help' ],
				wfMessage( 'pickipediainvitations-field-expiredays-help' )->text()
			)
		);

		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createinvite-submit' ],
			Html::submitButton(
				wfMessage( 'pickipediainvitations-create-button' )->text(),
				[ 'class' => 'mw-htmlform-submit' ]
			)
		);

		$html .= Html::closeElement( 'form' );

		// Add some basic styling
		$out->addInlineStyle( '
			.mw-createinvite-field { margin-bottom: 1em; }
			.mw-createinvite-field label { display: block; font-weight: bold; margin-bottom: 0.3em; }
			.mw-createinvite-help { color: #666; font-size: 0.9em; margin-top: 0.3em; }
			.mw-createinvite-success { background: #dfd; border: 1px solid #0a0; padding: 1em; margin: 1em 0; }
			.mw-createinvite-error { background: #fdd; border: 1px solid #a00; padding: 1em; margin: 1em 0; }
			.mw-createinvite-invite-link { font-family: monospace; background: #f5f5f5; padding: 0.5em; display: block; margin: 0.5em 0; word-break: break-all; }
		' );

		$out->addHTML( $html );

		// Show user's existing invites
		$this->showMyInvites();
	}

	/**
	 * Handle form submission.
	 */
	private function handleSubmission( $request, $user ): void {
		$out = $this->getOutput();

		// Verify token
		if ( !$user->matchEditToken( $request->getVal( 'token' ) ) ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createinvite-error' ],
				wfMessage( 'pickipediainvitations-error-badtoken' )->escaped()
			) );
			$this->showForm();
			return;
		}

		$entityType = $request->getVal( 'entityType', 'human' );
		$expireDays = (int)$request->getVal( 'expireDays', 30 );

		// Create the invite
		$result = InviteStore::createInvite(
			$user->getId(),
			$entityType,
			$expireDays
		);

		if ( !$result['success'] ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createinvite-error' ],
				Html::element( 'strong', [],
					wfMessage( 'pickipediainvitations-error-create-failed' )->text()
				) . ' ' . htmlspecialchars( $result['error'] )
			) );
			$this->showForm();
			return;
		}

		// Success! Show the invite link
		$config = MediaWikiServices::getInstance()->getMainConfig();
		$server = $config->get( 'Server' );
		$inviteUrl = $server . '/wiki/Special:CreateAccount?invite=' . $result['code'];

		$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createinvite-success' ],
			Html::element( 'strong', [],
				wfMessage( 'pickipediainvitations-success-title' )->text()
			) .
			Html::element( 'p', [],
				wfMessage( 'pickipediainvitations-success-message' )->text()
			) .
			Html::rawElement( 'p', [],
				wfMessage( 'pickipediainvitations-success-link-label' )->escaped() .
				Html::element( 'code', [ 'class' => 'mw-createinvite-invite-link' ],
					$inviteUrl
				)
			) .
			Html::element( 'p', [],
				wfMessage( 'pickipediainvitations-success-share-instructions' )->text()
			)
		) );

		$this->showForm();
	}

	/**
	 * Show the user's existing invites.
	 */
	private function showMyInvites(): void {
		$out = $this->getOutput();
		$user = $this->getUser();

		$invites = InviteStore::getInvitesByInviter( $user->getId() );

		if ( empty( $invites ) ) {
			$out->addWikiTextAsInterface(
				"\n== " . wfMessage( 'pickipediainvitations-myinvites-heading' )->text() . " ==\n" .
				wfMessage( 'pickipediainvitations-myinvites-none' )->text()
			);
			return;
		}

		$out->addWikiTextAsInterface(
			"\n== " . wfMessage( 'pickipediainvitations-myinvites-heading' )->text() . " =="
		);

		$html = Html::openElement( 'table', [ 'class' => 'wikitable sortable' ] );
		$html .= Html::rawElement( 'tr', [],
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-type' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-created' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-expires' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-status' )->text() ) .
			Html::element( 'th', [], wfMessage( 'pickipediainvitations-th-usedby' )->text() )
		);

		$userFactory = MediaWikiServices::getInstance()->getUserFactory();

		foreach ( $invites as $invite ) {
			$status = $this->getInviteStatus( $invite );

			// Show who used the invite (if used)
			$usedBy = '';
			if ( $invite->ppi_used_by_id ) {
				$usedByUser = $userFactory->newFromId( (int)$invite->ppi_used_by_id );
				$usedBy = $usedByUser ? $usedByUser->getName() : '(unknown)';
			}

			$html .= Html::rawElement( 'tr', [],
				Html::element( 'td', [], $invite->ppi_entity_type ) .
				Html::element( 'td', [], $this->formatTimestamp( $invite->ppi_created_at ) ) .
				Html::element( 'td', [], $invite->ppi_expires_at
					? $this->formatTimestamp( $invite->ppi_expires_at )
					: wfMessage( 'pickipediainvitations-never' )->text()
				) .
				Html::element( 'td', [], $status ) .
				Html::element( 'td', [], $usedBy )
			);
		}

		$html .= Html::closeElement( 'table' );
		$out->addHTML( $html );
	}

	/**
	 * Get human-readable status for an invite.
	 */
	private function getInviteStatus( $invite ): string {
		if ( $invite->ppi_used_at !== null ) {
			return wfMessage( 'pickipediainvitations-status-used' )->text();
		}

		if ( $invite->ppi_expires_at !== null ) {
			$expiresTimestamp = wfTimestamp( TS_UNIX, $invite->ppi_expires_at );
			if ( time() > $expiresTimestamp ) {
				return wfMessage( 'pickipediainvitations-status-expired' )->text();
			}
		}

		return wfMessage( 'pickipediainvitations-status-pending' )->text();
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
