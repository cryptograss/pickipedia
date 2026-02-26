<?php

namespace MediaWiki\Extension\PickiPediaVerification;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;
use WikiPage;
use Title;
use ContentHandler;

/**
 * Special page to verify bot edits.
 *
 * Lists pages in Category:Pages with unverified bot claims and allows
 * users to verify them (strip Bot_proposes wrappers) individually or in bulk.
 */
class SpecialVerifyBotEdits extends SpecialPage {

	public function __construct() {
		parent::__construct( 'VerifyBotEdits', 'edit' );
	}

	/**
	 * @param string|null $par
	 */
	public function execute( $par ) {
		$this->setHeaders();
		$this->checkPermissions();
		$out = $this->getOutput();
		$request = $this->getRequest();

		$out->addModuleStyles( 'mediawiki.special' );

		// Handle form submission
		if ( $request->wasPosted() && $request->getVal( 'action' ) === 'verify' ) {
			$this->handleVerification( $request );
			return;
		}

		// Display the list of unverified pages
		$this->showUnverifiedPages();
	}

	/**
	 * Show list of pages with unverified bot claims.
	 */
	private function showUnverifiedPages() {
		$out = $this->getOutput();
		$categoryName = 'Pages_with_unverified_bot_claims';

		$out->addWikiTextAsInterface( "This page lists all pages containing unverified bot edits (wrapped in <code><nowiki>{{Bot_proposes}}</nowiki></code>).\n\n" );

		// Query category members
		$dbr = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );

		$res = $dbr->newSelectQueryBuilder()
			->select( [ 'page_id', 'page_namespace', 'page_title' ] )
			->from( 'page' )
			->join( 'categorylinks', null, 'cl_from = page_id' )
			->where( [ 'cl_to' => $categoryName ] )
			->orderBy( 'page_title' )
			->limit( 500 )
			->caller( __METHOD__ )
			->fetchResultSet();

		$pages = [];
		foreach ( $res as $row ) {
			$pages[] = [
				'id' => $row->page_id,
				'namespace' => $row->page_namespace,
				'title' => $row->page_title,
			];
		}

		if ( empty( $pages ) ) {
			$out->addWikiTextAsInterface( "'''No pages with unverified bot claims found.''' All bot edits have been verified." );
			return;
		}

		$out->addWikiTextAsInterface( "Found '''%d''' pages with unverified bot claims:\n", count( $pages ) );

		// Build form
		$html = Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL(),
		] );

		$html .= Html::hidden( 'action', 'verify' );
		$html .= Html::hidden( 'token', $this->getUser()->getEditToken() );

		$html .= Html::openElement( 'table', [ 'class' => 'wikitable sortable' ] );
		$html .= Html::rawElement( 'tr', [],
			Html::element( 'th', [], '' ) .
			Html::element( 'th', [], 'Page' ) .
			Html::element( 'th', [], 'Namespace' ) .
			Html::element( 'th', [], 'Actions' )
		);

		foreach ( $pages as $page ) {
			$title = Title::makeTitle( $page['namespace'], $page['title'] );
			$displayTitle = $title->getPrefixedText();

			$html .= Html::rawElement( 'tr', [],
				Html::rawElement( 'td', [],
					Html::check( 'pages[]', false, [ 'value' => $page['id'] ] )
				) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [ 'href' => $title->getLocalURL() ], $displayTitle )
				) .
				Html::element( 'td', [], $title->getNsText() ?: '(main)' ) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [
						'href' => $title->getLocalURL( 'action=edit' )
					], 'edit' ) .
					' | ' .
					Html::element( 'a', [
						'href' => $this->getPageTitle()->getLocalURL( [
							'action' => 'verify',
							'page' => $page['id'],
							'token' => $this->getUser()->getEditToken()
						] )
					], 'verify' )
				)
			);
		}

		$html .= Html::closeElement( 'table' );

		$html .= Html::rawElement( 'p', [],
			Html::submitButton( 'Verify Selected', [ 'name' => 'verify_selected' ] ) .
			' ' .
			Html::submitButton( 'Verify All', [ 'name' => 'verify_all' ] )
		);

		$html .= Html::closeElement( 'form' );

		$out->addHTML( $html );
	}

	/**
	 * Handle verification request.
	 */
	private function handleVerification( $request ) {
		$out = $this->getOutput();
		$user = $this->getUser();

		// Verify token
		if ( !$user->matchEditToken( $request->getVal( 'token' ) ) ) {
			$out->addWikiTextAsInterface( "'''Error:''' Invalid token. Please try again." );
			return;
		}

		// Determine which pages to verify
		$pageIds = [];

		if ( $request->getVal( 'verify_all' ) ) {
			// Get all pages from category
			$dbr = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );
			$res = $dbr->newSelectQueryBuilder()
				->select( 'page_id' )
				->from( 'page' )
				->join( 'categorylinks', null, 'cl_from = page_id' )
				->where( [ 'cl_to' => 'Pages_with_unverified_bot_claims' ] )
				->limit( 500 )
				->caller( __METHOD__ )
				->fetchResultSet();

			foreach ( $res as $row ) {
				$pageIds[] = $row->page_id;
			}
		} elseif ( $request->getVal( 'page' ) ) {
			// Single page verification (from link)
			$pageIds[] = intval( $request->getVal( 'page' ) );
		} else {
			// Selected pages
			$pageIds = array_map( 'intval', $request->getArray( 'pages', [] ) );
		}

		if ( empty( $pageIds ) ) {
			$out->addWikiTextAsInterface( "'''No pages selected for verification.'''" );
			return;
		}

		$verified = 0;
		$errors = [];

		foreach ( $pageIds as $pageId ) {
			$result = $this->verifyPage( $pageId, $user );
			if ( $result === true ) {
				$verified++;
			} else {
				$errors[] = $result;
			}
		}

		$out->addWikiTextAsInterface( "'''Verification complete.''' Verified $verified page(s)." );

		if ( !empty( $errors ) ) {
			$out->addWikiTextAsInterface( "\n'''Errors:'''\n* " . implode( "\n* ", $errors ) );
		}

		$out->addWikiTextAsInterface( "\n\n[[Special:VerifyBotEdits|Return to verification list]]" );
	}

	/**
	 * Verify a single page by stripping Bot_proposes wrappers.
	 *
	 * @param int $pageId
	 * @param User $user
	 * @return true|string True on success, error message on failure
	 */
	private function verifyPage( $pageId, $user ) {
		$title = Title::newFromID( $pageId );
		if ( !$title ) {
			return "Page ID $pageId not found";
		}

		$wikiPage = MediaWikiServices::getInstance()->getWikiPageFactory()->newFromTitle( $title );
		$content = $wikiPage->getContent();

		if ( !$content ) {
			return "Could not get content for " . $title->getPrefixedText();
		}

		$text = ContentHandler::getContentText( $content );
		if ( $text === null ) {
			return "Could not get text content for " . $title->getPrefixedText();
		}

		// Strip Bot_proposes wrappers
		$newText = $this->stripBotProposes( $text );

		if ( $newText === $text ) {
			return "No Bot_proposes found in " . $title->getPrefixedText();
		}

		// Save the page
		$newContent = ContentHandler::makeContent( $newText, $title );
		$updater = $wikiPage->newPageUpdater( $user );
		$updater->setContent( 'main', $newContent );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			'Verified bot edits (removed Bot_proposes wrappers)'
		);
		$updater->saveRevision( $comment, EDIT_MINOR );

		if ( !$updater->wasSuccessful() ) {
			return "Failed to save " . $title->getPrefixedText() . ": " . $updater->getStatus()->getMessage()->text();
		}

		return true;
	}

	/**
	 * Strip all Bot_proposes template wrappers from text.
	 *
	 * Handles: {{Bot_proposes|content|by=Name}}
	 * Keeps: content
	 *
	 * @param string $text
	 * @return string
	 */
	private function stripBotProposes( $text ) {
		// Match {{Bot_proposes|content|by=...}}
		// This is tricky because content can contain nested templates
		// We'll use a simple approach that handles most cases

		$pattern = '/\{\{Bot_proposes\|([^|]+)\|by=[^}]+\}\}/s';

		// Keep replacing until no more matches (handles nested cases)
		$prevText = '';
		while ( $prevText !== $text ) {
			$prevText = $text;
			$text = preg_replace( $pattern, '$1', $text );
		}

		// Also handle case where content might have pipes (use greedy match to last |by=)
		$pattern2 = '/\{\{Bot_proposes\|(.*?)\|by=[^}]+\}\}/s';
		$prevText = '';
		while ( $prevText !== $text ) {
			$prevText = $text;
			$text = preg_replace( $pattern2, '$1', $text );
		}

		return $text;
	}

	/**
	 * @return string
	 */
	protected function getGroupName() {
		return 'pagetools';
	}
}
