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
			Html::element( 'th', [], 'Brackets' ) .
			Html::element( 'th', [], 'Actions' )
		);

		$wikiPageFactory = MediaWikiServices::getInstance()->getWikiPageFactory();

		foreach ( $pages as $page ) {
			$title = Title::makeTitle( $page['namespace'], $page['title'] );
			$displayTitle = $title->getPrefixedText();
			$problems = [];
			$content = $wikiPageFactory->newFromTitle( $title )->getContent();
			$rawText = $content ? ContentHandler::getContentText( $content ) : null;
			if ( is_string( $rawText ) ) {
				$after = self::stripMarkers( $rawText );
				$problems = self::bracketProblems( $after );
			}
			$bracketCell = empty( $problems )
				? Html::element( 'span', [ 'style' => 'color:#1b6e2b;' ], '✓ balanced' )
				: Html::element( 'span', [
					'style' => 'color:#b32424;font-weight:bold;',
					'title' => implode( '; ', $problems )
				], '⚠ ' . implode( '; ', $problems ) );

			$html .= Html::rawElement( 'tr', [],
				Html::rawElement( 'td', [],
					Html::check( 'pages[]', false, [ 'value' => $page['id'], 'disabled' => !empty( $problems ) ] )
				) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [ 'href' => $title->getLocalURL() ], $displayTitle )
				) .
				Html::element( 'td', [], $title->getNsText() ?: '(main)' ) .
				Html::rawElement( 'td', [], $bracketCell ) .
				Html::rawElement( 'td', [],
					Html::element( 'a', [
						'href' => $title->getLocalURL( 'action=edit' )
					], 'edit' ) .
					' | ' .
					// A submit button, not a link. execute() only calls
					// handleVerification() on a POST, so the link this
					// replaces could never do anything but reload the page —
					// which is exactly what it did. A <button> carrying a
					// name and value posts the enclosing form and says which
					// row it came from, and it inherits that form's token.
					Html::element( 'button', [
						'type' => 'submit',
						'name' => 'verify_page',
						'value' => (string)$page['id']
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

		// A bot's verifying is no one's verifying (PageHooks says the same of
		// the button). The save below goes through PageUpdater, past the gate,
		// and in a strict namespace a page with nothing proposed on it is what
		// the runner trusts: a bot that could verify could trust itself.
		$services = MediaWikiServices::getInstance();
		$config = $services->getMainConfig();
		$groups = $services->getUserGroupManager()->getUserGroups( $user );
		if ( !array_intersect( $groups, $config->get( 'PickiPediaVerificationExemptGroups' ) )
			&& array_intersect( $groups, $config->get( 'PickiPediaVerificationBotGroups' ) ) ) {
			$out->addWikiTextAsInterface( "'''Error:''' A bot cannot verify. Verification is a person's act." );
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

			$wikiPageFactory = MediaWikiServices::getInstance()->getWikiPageFactory();
			foreach ( $res as $row ) {
				$t = Title::newFromID( $row->page_id );
				$c = $t ? $wikiPageFactory->newFromTitle( $t )->getContent() : null;
				$raw = $c ? ContentHandler::getContentText( $c ) : null;
				if ( is_string( $raw ) && !empty( self::bracketProblems( self::stripMarkers( $raw ) ) ) ) {
					$errors[] = "Skipped " . $t->getPrefixedText() . " in Verify All (unbalanced brackets; use its row verify button to override)";
					continue;
				}
				$pageIds[] = $row->page_id;
			}
		} elseif ( $request->getVal( 'verify_page' ) ) {
			// One row's verify button. Previously read 'page', set by a GET
			// link that this handler never saw, so the branch was dead.
			$pageIds[] = intval( $request->getVal( 'verify_page' ) );
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

		// From a page's own "Verify all on this page" button (PageHooks): back to
		// the page, now without its markers -- unless something went wrong, which
		// is said here.
		$returnTo = Title::newFromText( (string)$request->getVal( 'returnto', '' ) );
		if ( $returnTo && $verified === count( $pageIds ) ) {
			$out->redirect( $returnTo->getFullURL() );
			return;
		}

		$out->addWikiTextAsInterface( "'''Verification complete.''' Verified $verified page(s)." );

		if ( !empty( $errors ) ) {
			$out->addWikiTextAsInterface( "\n'''Errors:'''\n* " . implode( "\n* ", $errors ) );
		}

		if ( $returnTo ) {
			$out->addWikiTextAsInterface( "\n\n[[:" . $returnTo->getPrefixedText() . "|Back to " . $returnTo->getPrefixedText() . "]]" );
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

		// Strip both marker forms. A page can carry a mix: prose marked with
		// {{Bot_proposes}} alongside a template marked with <proposed>.
		$newText = self::stripMarkers( $text );

		if ( $newText === $text ) {
			return "No bot proposals found in " . $title->getPrefixedText();
		}

		// Explicit single-page or selected verify is allowed through even if
		// bracketProblems() warns (so a false positive never locks a page out);
		// bulk Verify All skips unbalanced pages above.

		// Save the page
		$newContent = ContentHandler::makeContent( $newText, $title );
		$updater = $wikiPage->newPageUpdater( $user );
		$updater->setContent( 'main', $newContent );

		$comment = \MediaWiki\CommentStore\CommentStoreComment::newUnsavedComment(
			'Verified bot edits (removed proposal markers)'
		);
		$updater->saveRevision( $comment, EDIT_MINOR );

		if ( !$updater->wasSuccessful() ) {
			return "Failed to save " . $title->getPrefixedText() . ": " . $updater->getStatus()->getMessage()->text();
		}

		return true;
	}

	/**
	 * Strip <proposed> tags, keeping what they wrapped; a proposed removal
	 * goes with its tags.
	 *
	 * The whole point of the tag is that its content was never escaped, so
	 * verifying is just removing the tags — no unescaping, no regex walking
	 * balanced braces. Compare stripBotProposes() below, which has to do both.
	 *
	 * Nested tags would be meaningless (a claim proposed twice), but the loop
	 * costs nothing and stops one from surviving verification if someone
	 * writes it anyway.
	 *
	 * @param string $text
	 * @return string
	 */
	/**
	 * Strip both <proposed> tags and {{Bot_proposes}} templates.
	 *
	 * @param string $text
	 * @return string
	 */
	public static function stripMarkers( string $text ): string {
		return self::stripProposedTags( self::stripBotProposes( $text ) );
	}

	/**
	 * Check wikitext for unbalanced template braces ({{ / }}), link brackets
	 * ([[ / ]]), or single-brace placeholders ({foo}) inside templates after
	 * comments and <nowiki>/<pre>/<syntaxhighlight>/<code> regions are blanked.
	 *
	 * Returns human-readable problem descriptions with 1-based line numbers,
	 * or [] when balanced.
	 *
	 * @param string $text
	 * @return string[]
	 */
	public static function bracketProblems( string $text ): array {
		$problems = [];
		if ( preg_match( '/<proposed\b|<\/proposed\s*>|\{\{\s*Bot_proposes\s*\|/i', $text ) ) {
			$problems[] = 'unclosed or leftover proposal marker';
		}

		// Blank comments and literal tags while preserving newlines so line numbers match the page.
		$clean = preg_replace_callback(
			'/<!--[\s\S]*?-->|<(nowiki|pre|syntaxhighlight|source|code)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/i',
			static function ( array $m ): string {
				return str_repeat( "\n", substr_count( $m[0], "\n" ) );
			},
			$text
		);

		$braceStack = [];
		$linkStack = [];
		$tableStack = [];
		$len = strlen( $clean );
		$line = 1;
		$i = 0;

		while ( $i < $len ) {
			$ch = $clean[$i];
			if ( $ch === "\n" ) {
				$line++;
				$i++;
				continue;
			}
			$two = substr( $clean, $i, 2 );
			$three = substr( $clean, $i, 3 );

			if ( $two === '{|' ) {
				$tableStack[] = $line;
				$i += 2;
				continue;
			}
			if ( $two === '|}' ) {
				if ( empty( $tableStack ) ) {
					$problems[] = "line $line: stray '|}'";
				} else {
					array_pop( $tableStack );
				}
				$i += 2;
				continue;
			}
			if ( $two === '{{' ) {
				$braceStack[] = [ 'tok' => '{{', 'line' => $line ];
				$i += 2;
				continue;
			}
			if ( $three === '}}}' ) {
				$n = count( $braceStack );
				if ( $n >= 2 && $braceStack[$n - 1]['tok'] === '{' && $braceStack[$n - 2]['tok'] === '{{' ) {
					// A {blank} right before the closing }} of a template (e.g. ...{wait}}}).
					array_pop( $braceStack );
					array_pop( $braceStack );
					$i += 3;
					continue;
				}
			}
			if ( $two === '}}' ) {
				if ( empty( $braceStack ) ) {
					$problems[] = "line $line: stray '}}'";
				} else {
					$top = array_pop( $braceStack );
					if ( $top['tok'] === '{' ) {
						$problems[] = "line {$top['line']}: unclosed '{' (or missing '}}' on line $line)";
						if ( !empty( $braceStack ) && $braceStack[count( $braceStack ) - 1]['tok'] === '{{' ) {
							array_pop( $braceStack );
						}
					}
				}
				$i += 2;
				continue;
			}
			if ( $ch === '{' && !empty( $braceStack )
				&& preg_match( '/^\{(?:[a-zA-Z_][a-zA-Z0-9_]*\}|\{)/', substr( $clean, $i, 32 ) ) ) {
				$braceStack[] = [ 'tok' => '{', 'line' => $line ];
				$i++;
				continue;
			}
			if ( $ch === '}' && !empty( $braceStack ) && $braceStack[count( $braceStack ) - 1]['tok'] === '{' ) {
				array_pop( $braceStack );
				$i++;
				continue;
			}
			if ( $two === '[[' ) {
				$linkStack[] = $line;
				$i += 2;
				continue;
			}
			if ( $two === ']]' ) {
				if ( empty( $linkStack ) ) {
					$problems[] = "line $line: stray ']]'";
				} else {
					array_pop( $linkStack );
				}
				$i += 2;
				continue;
			}
			$i++;
		}

		foreach ( $braceStack as $open ) {
			$problems[] = "line {$open['line']}: unclosed '{$open['tok']}'";
		}
		foreach ( $linkStack as $openLine ) {
			$problems[] = "line $openLine: unclosed '[['";
		}
		foreach ( $tableStack as $openLine ) {
			$problems[] = "line $openLine: unclosed '{|'";
		}

		return $problems;
	}

	public static function stripProposedTags( $text ) {
		$pattern = '/(\n?)<proposed((?:\s[^>]*)?)>(.*?)<\/proposed\s*>/is';

		// Drop one newline either side of the content. A block-form tag sits
		// on its own line, so removing just the tags leaves the newline that
		// followed the opening one — which reads as a blank line before the
		// template and accumulates every time something is verified. Inline
		// use has no newlines to trim, so it is unaffected.
		//
		// A proposed removal (action="remove") is verified by taking the text
		// away, the line it stood on included: the proposal was that it goes.
		$unwrap = static function ( array $matches ): string {
			if ( preg_match( '/\baction\s*=\s*["\']?remove\b/i', $matches[2] ) ) {
				return '';
			}
			return $matches[1] . preg_replace( [ '/\A\n/', '/\n\z/' ], '', $matches[3] );
		};

		$prevText = '';
		while ( $prevText !== $text ) {
			$prevText = $text;
			$text = preg_replace_callback( $pattern, $unwrap, $text );
		}

		return $text;
	}

	/**
	 * Strip all Bot_proposes template wrappers from text.
	 *
	 * Handles: {{Bot_proposes|content|by=Name}}
	 * Keeps: content
	 *
	 * The wrapper is a template call, so any pipe in the content had to be
	 * escaped to {{!}} on the way in or it would have split the parameter.
	 * Unescaping on the way out is therefore part of removing the wrapper,
	 * not an extra: skipping it leaves {{!}} baked into the page permanently.
	 * That is how roughly 25 pages ended up with things like
	 * [[File:Ahbck4.jpg{{!}}right{{!}}thumb{{!}}60px{{!}}...]] — verified
	 * content carrying scars from a wrapper that is no longer there.
	 *
	 * Only content that was inside a wrapper gets unescaped. A page may use
	 * {{!}} on its own account — passing a pipe into some other template — and
	 * that must survive untouched.
	 *
	 * @param string $text
	 * @return string
	 */
	public static function stripBotProposes( $text ) {
		// Match {{Bot_proposes|content|by=...}}
		// This is tricky because content can contain nested templates
		// We'll use a simple approach that handles most cases
		$unwrap = static function ( array $matches ): string {
			return str_replace( '{{!}}', '|', $matches[1] );
		};

		$pattern = '/\{\{Bot_proposes\|([^|]+)\|by=[^}]+\}\}/s';

		// Keep replacing until no more matches (handles nested cases)
		$prevText = '';
		while ( $prevText !== $text ) {
			$prevText = $text;
			$text = preg_replace_callback( $pattern, $unwrap, $text );
		}

		// Also handle case where content might have pipes (use greedy match to last |by=)
		$pattern2 = '/\{\{Bot_proposes\|(.*?)\|by=[^}]+\}\}/s';
		$prevText = '';
		while ( $prevText !== $text ) {
			$prevText = $text;
			$text = preg_replace_callback( $pattern2, $unwrap, $text );
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
