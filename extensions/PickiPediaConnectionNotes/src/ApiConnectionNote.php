<?php
/**
 * API module: save a "know a connection?" note as text, and nothing else.
 *
 *    api.php?action=connectionnote&about=…&from=…&note=…&format=json
 *    { "connectionnote": { "result": "Success" } }
 *
 * The note lands on [[Cryptograss talk:Connection inbox]], one section per
 * note, written by the system user so a signed-out visitor publishes no IP.
 * SectionBuilder does the shaping; this class does the saving.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaConnectionNotes;

use ApiBase;
use CommentStoreComment;
use ContentHandler;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
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
		$systemUser = $services->getUserFactory()->newSystemUser(
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

		if ( $title->exists() ) {
			// Append the section, leave the rest of the page untouched.
			$content = $updater->getContent( 'main' );
			$existing = $content ? $content->getWikitextForTransclusion() : '';
			$updater->setContent(
				'main',
				ContentHandler::makeContent( rtrim( $existing ) . "\n\n" . $section, $title )
			);
		} else {
			$updater->setContent(
				'main',
				ContentHandler::makeContent( $section, $title )
			);
		}

		$about = SectionBuilder::heading( (string)$params['about'], '' );
		$comment = CommentStoreComment::newUnsavedComment( 'Connection note: ' . $about );
		$updater->saveRevision( $comment, EDIT_NEW | EDIT_SUPPRESS_RC );

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
