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

	/**
	 * What the queue is grouped by, in the order it is shown. One list of
	 * three hundred pages mixed every kind of claim together (Justin, 10 Nov):
	 * a lineup wants a different reader, and a different source, than a
	 * property's one-line description.
	 */
	public const KINDS = [
		'lineups' => 'Records, recordings and lineups',
		'people' => 'People and bands',
		'shows' => 'Shows, venues, festivals and scenes',
		'songs' => 'Songs and tunes',
		'releases' => 'Releases',
		'podcasts' => 'Podcasts',
		'project' => 'Project pages: Cryptograss, Magenta, emergents, help',
		'model' => 'Data model: properties, templates, categories',
		'other' => 'Everything else',
	];

	private const MODEL_NAMESPACES = [ 'Property', 'Template', 'Module', 'MediaWiki', 'Form',
		'Concept', 'smw/schema', 'Category' ];
	private const PROJECT_NAMESPACES = [ 'Cryptograss', 'Magenta', 'Emergent', 'Instructions',
		'VersionControl', 'PickiPedia', 'Help', 'User' ];

	public function __construct() {
		parent::__construct( 'VerifyBotEdits', 'edit' );
	}

	/**
	 * Which group a page's claims belong to.
	 *
	 * @param string $ns The page's subject namespace, by name ('' for main).
	 * @param string $text The title without its namespace, spaces not underscores.
	 * @param string[] $categories Its categories, without the prefix.
	 * @return string A key of KINDS.
	 */
	public static function kindOf( string $ns, string $text, array $categories ): string {
		$cats = array_map( static fn ( $c ) => str_replace( '_', ' ', $c ), $categories );
		$in = static fn ( array $names ) => (bool)array_intersect( $names, $cats );

		if ( in_array( $ns, self::MODEL_NAMESPACES, true ) ) {
			return 'model';
		}
		if ( $ns === 'Release' || $ns === 'ReleaseDraft' ) {
			return 'releases';
		}
		if ( $ns === 'Song' ) {
			return 'songs';
		}
		// Notes the emergents keep: Cryptograss/..., a page named for a
		// block ("26329427 maybelle disk full incident"), a gadget candidate.
		if ( in_array( $ns, self::PROJECT_NAMESPACES, true )
			|| preg_match( '/^(Cryptograss\/|Candidate:|\d{6,} )/', $text ) ) {
			return 'project';
		}
		if ( $in( [ 'Records', 'Recordings' ] ) || str_starts_with( $text, 'Recording:' ) ) {
			return 'lineups';
		}
		if ( $in( [ 'Podcasts', 'Podcast episodes' ] ) ) {
			return 'podcasts';
		}
		if ( str_starts_with( $text, 'Show:' ) || $in( [ 'Shows', 'Venues', 'Festivals',
			'Festival editions', 'Jams', 'Recurring events', 'Events', 'Scenes' ] ) ) {
			return 'shows';
		}
		if ( $in( [ 'Musicians', 'People', 'Bands' ] ) ) {
			return 'people';
		}
		if ( $in( [ 'Compositions', 'Songs', 'Tunes', 'Blue Railroad Songs' ] ) ) {
			return 'songs';
		}
		return 'other';
	}

	/**
	 * How many claims a page holds, and the sources they name.
	 *
	 * Sources are what lets claims be verified together: every claim one
	 * Discogs release or one LMA item supports is checked against the same
	 * page (Justin, 10 Nov).
	 *
	 * @param string $text The page's wikitext.
	 * @return array{claims: int, sources: string[]}
	 */
	public static function claimsIn( string $text ): array {
		$claims = 0;
		$sources = [];
		if ( preg_match_all( '/<proposed(\s[^>]*)?>/i', $text, $tags ) ) {
			$claims += count( $tags[0] );
			foreach ( $tags[1] as $attrs ) {
				if ( preg_match( '/\bsource\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/i', $attrs, $m ) ) {
					$sources[] = trim( $m[1] !== '' ? $m[1] : ( $m[2] ?? '' ) );
				}
			}
		}
		if ( preg_match_all( '/\{\{\s*Bot[_ ]proposes\s*\|/i', $text, $bp ) ) {
			$claims += count( $bp[0] );
		}
		$sources = array_values( array_unique( array_filter( $sources,
			static fn ( $s ) => $s !== '' && strcasecmp( $s, 'unspecified' ) !== 0 ) ) );
		return [ 'claims' => $claims, 'sources' => $sources ];
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

		$out->addWikiTextAsInterface( "Pages holding claims an emergent or bot proposed and no person has verified yet, grouped by what they are about. Pages that name the same source sit together.\n\n" );

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
				'id' => (int)$row->page_id,
				'namespace' => $row->page_namespace,
				'title' => $row->page_title,
			];
		}

		if ( empty( $pages ) ) {
			$out->addWikiTextAsInterface( "'''No pages with unverified bot claims found.''' All bot edits have been verified." );
			return;
		}

		// Every page's categories in one query, for grouping.
		$categories = [];
		$cres = $dbr->newSelectQueryBuilder()
			->select( [ 'cl_from', 'cl_to' ] )
			->from( 'categorylinks' )
			->where( [ 'cl_from' => array_column( $pages, 'id' ) ] )
			->caller( __METHOD__ )
			->fetchResultSet();
		foreach ( $cres as $row ) {
			$categories[(int)$row->cl_from][] = $row->cl_to;
		}

		$wikiPageFactory = MediaWikiServices::getInstance()->getWikiPageFactory();
		$namespaceInfo = MediaWikiServices::getInstance()->getNamespaceInfo();
		$groups = array_fill_keys( array_keys( self::KINDS ), [] );

		foreach ( $pages as $page ) {
			$title = Title::makeTitle( $page['namespace'], $page['title'] );
			$problems = [];
			$scan = [ 'claims' => 0, 'sources' => [] ];
			$content = $wikiPageFactory->newFromTitle( $title )->getContent();
			$rawText = $content ? ContentHandler::getContentText( $content ) : null;
			if ( is_string( $rawText ) ) {
				$problems = self::bracketProblems( self::stripMarkers( $rawText ) );
				$scan = self::claimsIn( $rawText );
			}
			$subject = $namespaceInfo->getSubject( $page['namespace'] );
			$kind = self::kindOf(
				$subject === NS_MAIN ? '' : (string)$namespaceInfo->getCanonicalName( $subject ),
				$title->getText(),
				$categories[$page['id']] ?? []
			);
			$groups[$kind][] = [ 'id' => $page['id'], 'title' => $title, 'problems' => $problems ] + $scan;
		}

		// Within a group, pages that name the same source sit together, so
		// what one source supports can be checked in one sitting.
		foreach ( $groups as &$rows ) {
			usort( $rows, static function ( $a, $b ) {
				$sa = $a['sources'][0] ?? "\u{10FFFF}";
				$sb = $b['sources'][0] ?? "\u{10FFFF}";
				return [ $sa, $a['title']->getPrefixedText() ] <=> [ $sb, $b['title']->getPrefixedText() ];
			} );
		}
		unset( $rows );

		$only = $this->getRequest()->getVal( 'kind' );
		if ( !isset( self::KINDS[$only] ) ) {
			$only = null;
		}

		// Where to go: each group with its pages and claims, and "all".
		$nav = [];
		foreach ( self::KINDS as $key => $label ) {
			if ( !$groups[$key] ) {
				continue;
			}
			$count = count( $groups[$key] ) . ' pages, '
				. array_sum( array_column( $groups[$key], 'claims' ) ) . ' claims';
			$nav[] = $key === $only
				? Html::element( 'strong', [], "$label ($count)" )
				: Html::element( 'a', [ 'href' => $this->getPageTitle()->getLocalURL( [ 'kind' => $key ] ) ],
					"$label ($count)" );
		}
		$nav[] = $only === null
			? Html::element( 'strong', [], 'All' )
			: Html::element( 'a', [ 'href' => $this->getPageTitle()->getLocalURL() ], 'All' );
		$out->addHTML( Html::rawElement( 'ul', [ 'class' => 'pv-kinds' ],
			implode( '', array_map( static fn ( $n ) => Html::rawElement( 'li', [], $n ), $nav ) ) ) );

		// Build form
		$html = Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL(),
		] );

		$html .= Html::hidden( 'action', 'verify' );
		$html .= Html::hidden( 'token', $this->getUser()->getEditToken() );

		foreach ( self::KINDS as $key => $label ) {
			if ( !$groups[$key] || ( $only !== null && $key !== $only ) ) {
				continue;
			}
			$html .= Html::element( 'h2', [ 'id' => 'kind-' . $key ], $label );
			$html .= Html::openElement( 'table', [ 'class' => 'wikitable sortable' ] );
			$html .= Html::rawElement( 'tr', [],
				Html::element( 'th', [], '' ) .
				Html::element( 'th', [], 'Page' ) .
				Html::element( 'th', [], 'Claims' ) .
				Html::element( 'th', [], 'Sources named' ) .
				Html::element( 'th', [], 'Brackets' ) .
				Html::element( 'th', [], 'Actions' )
			);
			foreach ( $groups[$key] as $row ) {
				$html .= $this->renderRow( $row );
			}
			$html .= Html::closeElement( 'table' );
		}

		// Verify All posts no list: it means every page in the queue. Under
		// one group that would verify the groups you aren't looking at, so it
		// is offered only on the whole list.
		$html .= Html::rawElement( 'p', [],
			Html::submitButton( 'Verify Selected', [ 'name' => 'verify_selected' ] ) .
			( $only === null ? ' ' . Html::submitButton( 'Verify All', [ 'name' => 'verify_all' ] ) : '' )
		);

		$html .= Html::closeElement( 'form' );

		$out->addHTML( $html );
	}

	/**
	 * One page's row: tick box, link, how many claims, the sources they name,
	 * whether its brackets balance, and the actions.
	 *
	 * @param array $row id, title, problems, claims, sources.
	 * @return string HTML.
	 */
	private function renderRow( array $row ): string {
		$title = $row['title'];
		$problems = $row['problems'];
		$bracketCell = empty( $problems )
			? Html::element( 'span', [ 'style' => 'color:#1b6e2b;' ], '✓ balanced' )
			: Html::element( 'span', [
				'style' => 'color:#b32424;font-weight:bold;',
				'title' => implode( '; ', $problems )
			], '⚠ ' . implode( '; ', $problems ) );

		$sources = [];
		foreach ( $row['sources'] as $source ) {
			$sources[] = preg_match( '#^https?://#i', $source )
				? Html::element( 'a', [ 'href' => $source, 'rel' => 'nofollow noopener', 'target' => '_blank' ],
					preg_replace( '#^https?://(www\.)?#i', '', $source ) )
				: Html::element( 'span', [], $source );
		}
		$sourceCell = $sources
			? implode( '<br>', $sources )
			: Html::element( 'span', [ 'style' => 'color:#72777d;' ], 'none named' );

		return Html::rawElement( 'tr', [],
			Html::rawElement( 'td', [],
				Html::check( 'pages[]', false, [ 'value' => $row['id'], 'disabled' => !empty( $problems ) ] )
			) .
			Html::rawElement( 'td', [],
				Html::element( 'a', [ 'href' => $title->getLocalURL() ], $title->getPrefixedText() )
			) .
			Html::element( 'td', [ 'data-sort-value' => (string)$row['claims'] ], (string)$row['claims'] ) .
			Html::rawElement( 'td', [], $sourceCell ) .
			Html::rawElement( 'td', [], $bracketCell ) .
			Html::rawElement( 'td', [],
				Html::element( 'a', [
					'href' => $title->getLocalURL( 'action=edit' )
				], 'edit' ) .
				' | ' .
				// A submit button, not a link: execute() only verifies on a
				// POST, and a button carrying a name and value says which row
				// it came from and inherits the form's token.
				Html::element( 'button', [
					'type' => 'submit',
					'name' => 'verify_page',
					'value' => (string)$row['id']
				], 'verify' )
			)
		);
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
