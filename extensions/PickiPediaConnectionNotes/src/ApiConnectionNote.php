<?php
/**
 * API module for the connection box: a visitor's plain-text note about a
 * connection, appended to Cryptograss talk:Connection inbox.
 *
 * Writes as the ConnectionInbox-bot system user, so a signed-out visitor
 * publishes no IP. SectionBuilder does the shaping; this class does the
 * saving. Rate-limited through pingLimiter; the limits live in
 * LocalSettings.php ($wgRateLimits['connectionnote']).
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaConnectionNotes;

use ApiBase;
use CommentStoreComment;
use ContentHandler;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use MediaWiki\User\User;
use Wikimedia\ParamValidator\ParamValidator;

class ApiConnectionNote extends ApiBase {

	private const TALK_PAGE = 'Cryptograss talk:Connection inbox';

	/** @inheritDoc */
	public function mustBePosted(): bool {
		return true;
	}

	/** @inheritDoc */
	public function needsToken(): string {
		return 'csrf';
	}

	/** @inheritDoc */
	public function isWriteMode(): bool {
		return true;
	}

	/** @inheritDoc */
	public function getAllowedParams(): array {
		return [
			'about' => [
				ParamValidator::PARAM_TYPE => 'string',
				ParamValidator::PARAM_REQUIRED => true,
			],
			'from' => [
				ParamValidator::PARAM_TYPE => 'string',
				ParamValidator::PARAM_REQUIRED => true,
			],
			'note' => [
				ParamValidator::PARAM_TYPE => 'string',
				ParamValidator::PARAM_REQUIRED => true,
			],
		];
	}

	/** @inheritDoc */
	public function execute(): void {
		// Per-visitor rate limit; see $wgRateLimits['connectionnote'].
		// pingLimiter lives on User, not on ApiBase.
		if ( $this->getUser()->pingLimiter( 'connectionnote' ) ) {
			$this->dieWithError( 'apierror-ratelimited', 'ratelimited' );
		}

		$params = $this->extractRequestParams();

		$section = SectionBuilder::build(
			(string)$params['about'],
			(string)$params['from'],
			(string)$params['note']
		);
		if ( $section === null ) {
			$this->dieWithError(
				[ 'apierror-connectionnote-invalid', SectionBuilder::MAX_NOTE ],
				'invalidnote'
			);
		}

		$services = MediaWikiServices::getInstance();
		// UserFactory has no newSystemUser in 1.43; the static is on User,
		// the way Hooks creates the account on update.php.
		$systemUser = User::newSystemUser(
			Hooks::SYSTEM_USER_NAME, [ 'validate' => 'valid', 'steal' => false ]
		);
		if ( !$systemUser ) {
			$this->dieWithError( 'apierror-connectionnote-nouser', 'nouser' );
		}

		$title = Title::newFromText( self::TALK_PAGE );
		if ( !$title ) {
			$this->dieWithError( 'apierror-connectionnote-notitle', 'notitle' );
		}

		$wikiPage = $services->getWikiPageFactory()->newFromTitle( $title );
		$updater = $wikiPage->newPageUpdater( $systemUser );

		// The section is appended to whatever is there; PageUpdater decides
		// create or update from the parent revision, so no EDIT_NEW here.
		$parent = $updater->grabParentRevision();
		if ( $parent ) {
			$existing = $parent->getContent( 'main' );
			$existingText = $existing ? $existing->getWikitextForTransclusion() : '';
			$updater->setContent(
				'main',
				ContentHandler::makeContent( rtrim( $existingText ) . "\n\n" . $section, $title )
			);
		} else {
			$updater->setContent(
				'main',
				ContentHandler::makeContent( $section, $title )
			);
		}

		$about = SectionBuilder::headingPlain( (string)$params['about'] );
		$comment = CommentStoreComment::newUnsavedComment( 'Connection note: ' . $about );
		$updater->saveRevision( $comment );

		if ( !$updater->wasSuccessful() ) {
			$this->dieWithError(
				[ 'apierror-connectionnote-savefailed', $updater->getStatus()->getMessage()->text() ],
				'savefailed'
			);
		}

		$this->getResult()->addValue( null, 'connectionnote', [ 'result' => 'Success' ] );
	}

	/** @inheritDoc */
	public function getHelpMessage(): ?string {
		return 'connectionnote-help';
	}
}
