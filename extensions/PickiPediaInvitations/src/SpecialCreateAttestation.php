<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use MediaWiki\User\User;
use ContentHandler;

/**
 * Special page for creating attestations of other users.
 *
 * Allows any logged-in user to create an attestation page vouching for another user.
 * Creates a page at User:{Subject}/Attestations/by-{Attester}
 */
class SpecialCreateAttestation extends SpecialPage {

	/** @var array Valid attestation types for humans (ordered from strongest to weakest) */
	public const ATTESTATION_TYPES = [
		'recorded-or-performed' => 'pickipediainvitations-attestation-type-recorded-or-performed',
		'collaborated' => 'pickipediainvitations-attestation-type-collaborated',
		'seen-perform' => 'pickipediainvitations-attestation-type-seen-perform',
		'irl-buds' => 'pickipediainvitations-attestation-type-irl-buds',
		'met-in-person' => 'pickipediainvitations-attestation-type-met-in-person',
		'online-only' => 'pickipediainvitations-attestation-type-online-only',
	];

	/** @var array Valid attestation types for bots */
	public const BOT_ATTESTATION_TYPES = [
		'operator' => 'pickipediainvitations-attestation-type-operator',
		'authorized' => 'pickipediainvitations-attestation-type-authorized',
		'reviewed' => 'pickipediainvitations-attestation-type-reviewed',
		'vouched' => 'pickipediainvitations-attestation-type-vouched',
	];

	/**
	 * Get all attestation types (human + bot).
	 * @return array
	 */
	public static function getAllAttestationTypes(): array {
		return array_merge( self::ATTESTATION_TYPES, self::BOT_ATTESTATION_TYPES );
	}

	public function __construct() {
		parent::__construct( 'CreateAttestation' );
	}

	/**
	 * @param string|null $par
	 */
	public function execute( $par ) {
		$this->setHeaders();
		$this->checkReadOnly();

		$out = $this->getOutput();
		$request = $this->getRequest();
		$user = $this->getUser();

		// Must be logged in
		if ( !$user->isRegistered() ) {
			$out->addWikiTextAsInterface(
				wfMessage( 'pickipediainvitations-attestation-must-be-logged-in' )->text()
			);
			return;
		}

		$out->addModuleStyles( 'mediawiki.special' );

		// Handle form submission
		if ( $request->wasPosted() && $request->getVal( 'action' ) === 'create' ) {
			$this->handleSubmission( $request, $user );
			return;
		}

		// Pre-fill subject from URL parameter or subpage
		$subject = $par ?? $request->getVal( 'subject', '' );

		// Show the form
		$this->showForm( $subject );
	}

	/**
	 * Display the attestation creation form.
	 *
	 * @param string $prefillSubject Username to pre-fill
	 */
	private function showForm( string $prefillSubject = '' ): void {
		$out = $this->getOutput();

		$out->addWikiTextAsInterface(
			wfMessage( 'pickipediainvitations-attestation-intro' )->text()
		);

		$html = Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL(),
			'class' => 'mw-createattestation-form',
		] );

		$html .= Html::hidden( 'action', 'create' );
		$html .= Html::hidden( 'token', $this->getUser()->getEditToken() );

		// Subject (user being attested) field
		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createattestation-field' ],
			Html::label(
				wfMessage( 'pickipediainvitations-attestation-field-subject' )->text(),
				'subject'
			) .
			Html::input( 'subject', $prefillSubject, 'text', [
				'id' => 'subject',
				'size' => 40,
				'required' => true,
				'placeholder' => wfMessage( 'pickipediainvitations-attestation-field-subject-placeholder' )->text(),
			] ) .
			Html::element( 'p', [ 'class' => 'mw-createattestation-help' ],
				wfMessage( 'pickipediainvitations-attestation-field-subject-help' )->text()
			)
		);

		// Attestation type field - human types
		$typeOptions = '';
		foreach ( self::ATTESTATION_TYPES as $value => $msgKey ) {
			$typeOptions .= Html::element( 'option', [
				'value' => $value,
				'data-for-entity' => 'human',
			], wfMessage( $msgKey )->text() );
		}
		// Bot types
		foreach ( self::BOT_ATTESTATION_TYPES as $value => $msgKey ) {
			$typeOptions .= Html::element( 'option', [
				'value' => $value,
				'data-for-entity' => 'bot',
				'style' => 'display: none;', // Hidden by default, shown via JS if subject is bot
			], wfMessage( $msgKey )->text() );
		}

		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createattestation-field' ],
			Html::label(
				wfMessage( 'pickipediainvitations-attestation-field-type' )->text(),
				'attestationType'
			) .
			Html::rawElement( 'select', [
				'id' => 'attestationType',
				'name' => 'attestationType',
			], $typeOptions ) .
			Html::element( 'p', [ 'class' => 'mw-createattestation-help' ],
				wfMessage( 'pickipediainvitations-attestation-field-type-help' )->text()
			)
		);

		// Freeform text field
		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createattestation-field' ],
			Html::label(
				wfMessage( 'pickipediainvitations-attestation-field-text' )->text(),
				'attestationText'
			) .
			Html::textarea( 'attestationText', '', [
				'id' => 'attestationText',
				'rows' => 8,
				'cols' => 60,
				'placeholder' => wfMessage( 'pickipediainvitations-attestation-field-text-placeholder' )->text(),
			] ) .
			Html::element( 'p', [ 'class' => 'mw-createattestation-help' ],
				wfMessage( 'pickipediainvitations-attestation-field-text-help' )->text()
			)
		);

		$html .= Html::rawElement( 'div', [ 'class' => 'mw-createattestation-submit' ],
			Html::submitButton(
				wfMessage( 'pickipediainvitations-attestation-create-button' )->text(),
				[ 'class' => 'mw-htmlform-submit' ]
			)
		);

		$html .= Html::closeElement( 'form' );

		// Add styling
		$out->addInlineStyle( '
			.mw-createattestation-field { margin-bottom: 1em; }
			.mw-createattestation-field label { display: block; font-weight: bold; margin-bottom: 0.3em; }
			.mw-createattestation-field textarea { width: 100%; max-width: 600px; }
			.mw-createattestation-help { color: #666; font-size: 0.9em; margin-top: 0.3em; }
			.mw-createattestation-success { background: #dfd; border: 1px solid #0a0; padding: 1em; margin: 1em 0; }
			.mw-createattestation-error { background: #fdd; border: 1px solid #a00; padding: 1em; margin: 1em 0; }
		' );

		$out->addHTML( $html );
	}

	/**
	 * Handle form submission.
	 */
	private function handleSubmission( $request, $user ): void {
		$out = $this->getOutput();

		// Verify token
		if ( !$user->matchEditToken( $request->getVal( 'token' ) ) ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-error' ],
				wfMessage( 'pickipediainvitations-error-badtoken' )->escaped()
			) );
			$this->showForm();
			return;
		}

		$subjectName = trim( $request->getVal( 'subject', '' ) );
		$attestationType = $request->getVal( 'attestationType', 'vouches-for' );
		$attestationText = trim( $request->getVal( 'attestationText', '' ) );

		// Validate subject user exists
		$services = MediaWikiServices::getInstance();
		$userNameUtils = $services->getUserNameUtils();
		$userFactory = $services->getUserFactory();

		$canonicalName = $userNameUtils->getCanonical( $subjectName );
		if ( $canonicalName === false ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-error' ],
				wfMessage( 'pickipediainvitations-attestation-error-invalid-username' )->escaped()
			) );
			$this->showForm( $subjectName );
			return;
		}

		$subjectUser = $userFactory->newFromName( $canonicalName );
		if ( !$subjectUser || !$subjectUser->isRegistered() ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-error' ],
				wfMessage( 'pickipediainvitations-attestation-error-user-not-found' )->escaped()
			) );
			$this->showForm( $subjectName );
			return;
		}

		// Can't attest yourself
		if ( $subjectUser->getId() === $user->getId() ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-error' ],
				wfMessage( 'pickipediainvitations-attestation-error-self' )->escaped()
			) );
			$this->showForm( $subjectName );
			return;
		}

		// Validate attestation type
		$allTypes = self::getAllAttestationTypes();
		if ( !array_key_exists( $attestationType, $allTypes ) ) {
			$attestationType = 'irl-buds';
		}

		// Create the attestation page
		$result = $this->createAttestationPage(
			$user,
			$subjectUser,
			$attestationType,
			$attestationText
		);

		if ( !$result['success'] ) {
			$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-error' ],
				Html::element( 'strong', [],
					wfMessage( 'pickipediainvitations-attestation-error-create-failed' )->text()
				) . ' ' . htmlspecialchars( $result['error'] )
			) );
			$this->showForm( $subjectName );
			return;
		}

		// Success!
		$attestationTitle = $result['title'];
		$out->addHTML( Html::rawElement( 'div', [ 'class' => 'mw-createattestation-success' ],
			Html::element( 'strong', [],
				wfMessage( 'pickipediainvitations-attestation-success-title' )->text()
			) .
			Html::element( 'p', [],
				wfMessage( 'pickipediainvitations-attestation-success-message' )->text()
			) .
			Html::rawElement( 'p', [],
				wfMessage( 'pickipediainvitations-attestation-success-view' )->escaped() . ' ' .
				Html::element( 'a', [ 'href' => $attestationTitle->getLocalURL() ],
					$attestationTitle->getPrefixedText()
				)
			)
		) );

		// Show form again for another attestation
		$this->showForm();
	}

	/**
	 * Create the attestation page.
	 *
	 * @param User $attester The user creating the attestation
	 * @param User $subject The user being attested
	 * @param string $type Attestation type
	 * @param string $text Freeform attestation text
	 * @return array ['success' => bool, 'title' => Title|null, 'error' => string|null]
	 */
	private function createAttestationPage(
		User $attester,
		User $subject,
		string $type,
		string $text
	): array {
		$services = MediaWikiServices::getInstance();

		// Build page title: User:{Subject}/Attestations/by-{Attester}
		$attesterName = $attester->getName();
		$subjectName = $subject->getName();
		$titleText = "User:{$subjectName}/Attestations/by-{$attesterName}";

		$title = Title::newFromText( $titleText );
		if ( !$title ) {
			return [
				'success' => false,
				'title' => null,
				'error' => 'Invalid title'
			];
		}

		// Check if page already exists
		if ( $title->exists() ) {
			return [
				'success' => false,
				'title' => null,
				'error' => wfMessage( 'pickipediainvitations-attestation-error-exists' )->text()
			];
		}

		// Build page content
		$createdDate = date( 'Y-m-d' );
		$typeDisplay = wfMessage( self::ATTESTATION_TYPES[$type] )->text();

		$content = <<<WIKITEXT
{{Attestation
|attester=User:{$attesterName}
|subject=User:{$subjectName}
|created={$createdDate}
|attestation_type={$type}
}}

{$text}

[[Category:Attestations]]
[[Category:Attestations by {$attesterName}]]
[[Attested by::User:{$attesterName}]]
[[Subject of attestation::User:{$subjectName}]]
[[Attestation type::{$type}]]
WIKITEXT;

		// Create the page as the attester (not system user)
		$wikiPageFactory = $services->getWikiPageFactory();
		$wikiPage = $wikiPageFactory->newFromTitle( $title );

		$contentObj = ContentHandler::makeContent( $content, $title );
		$updater = $wikiPage->newPageUpdater( $attester );
		$updater->setContent( 'main', $contentObj );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			wfMessage( 'pickipediainvitations-attestation-edit-summary', $subjectName )->text()
		);

		$updater->saveRevision( $comment, EDIT_NEW );

		if ( !$updater->wasSuccessful() ) {
			return [
				'success' => false,
				'title' => null,
				'error' => $updater->getStatus()->getMessage()->text()
			];
		}

		return [
			'success' => true,
			'title' => $title,
			'error' => null
		];
	}

	/**
	 * @return string
	 */
	protected function getGroupName() {
		return 'users';
	}
}
