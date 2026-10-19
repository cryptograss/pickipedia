<?php
/**
 * PickiPediaContent — a home in the repository for the code and styling that
 * render articles.
 *
 * Why this exists: a Scribunto module and a line of site CSS are both program
 * code, and both were living only on the wiki, where nothing reviews them,
 * nothing records why they changed, and nothing can revert them. The
 * alternative usually proposed — giving a bot write access to
 * MediaWiki:Common.css and the Module: namespace — makes that worse rather
 * than better: site CSS is loaded for every reader on the real domain, it is
 * exempt from the verification gate that covers ordinary bot edits, and a
 * long-lived credential able to change it is a site-wide compromise waiting
 * for a bad day.
 *
 * So the code comes here instead, where a pull request is the way in.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Hook\SkinAfterContentHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\Permissions\Hook\GetUserPermissionsErrorsHook;
use MediaWiki\SpecialPage\Hook\ChangesListSpecialPageStructuredFiltersHook;
use MediaWiki\Title\Title;
use Wikimedia\Rdbms\IExpression;
use Wikimedia\Rdbms\IReadableDatabase;
use Wikimedia\Rdbms\LikeValue;

class Hooks implements BeforePageDisplayHook, ParserFirstCallInitHook, GetUserPermissionsErrorsHook,
	ChangesListSpecialPageStructuredFiltersHook, SkinAfterContentHook {

	/**
	 * <todo>: a to-do list kept as YAML, shown as a checklist (Todo.php).
	 *
	 * @param \Parser $parser
	 */
	public function onParserFirstCallInit( $parser ): void {
		$parser->setHook( 'todo', static function ( $input, array $args, $parser, $frame ) {
			$page = $parser->getPage();
			$pageTitle = $page ? Title::newFromPageReference( $page )->getPrefixedText() : '';
			return Todo::render( (string)$input, static fn ( string $link ) => Todo::hrefFrom(
				$link, $pageTitle,
				static function ( string $title ) {
					$t = Title::newFromText( $title );
					return $t ? $t->getLocalURL() : null;
				}
			) );
		} );
		$parser->setHook( 'moodlinks', static function ( $input, array $args, $parser, $frame ) {
			$page = $parser->getPage();
			$title = $page ? Title::newFromPageReference( $page ) : null;
			$mood = $title ? MoodLinks::moodOf( $title->getNamespace(), $title->getDBkey() ) : null;
			$out = $parser->getOutput();
			// A link to every page named, so the wiki's link table says which ledgers name a page.
			foreach ( MoodLinks::rows( (string)$input ) ?? [] as $row ) {
				$linked = Title::newFromText( $row['page'] );
				if ( $linked ) {
					$out->addLink( $linked );
				}
			}
			return MoodLinks::render( (string)$input, $mood ?? '', static function ( string $name ) {
				$t = Title::newFromText( $name );
				return $t ? $t->getLocalURL() : null;
			} );
		} );
	}

	/**
	 * "Linked from magenta", at the foot of a page some Mood message links (MoodLinks.php):
	 * the ledgers naming it are found in the link table, and their rows for it shown.
	 *
	 * On every view of the page -- reading, editing, its history -- and on a page that
	 * doesn't exist yet: a red link from a Mood leads to the page's edit form, where
	 * what was said about it is what whoever starts it wants (Justin, 19 Oct 2026).
	 * Not on the ledgers themselves, nor special pages.
	 *
	 * @param string &$data
	 * @param \Skin $skin
	 */
	public function onSkinAfterContent( &$data, $skin ) {
		$title = $skin->getTitle();
		if ( !$title || $title->getNamespace() < 0
			|| MoodLinks::moodOf( $title->getNamespace(), $title->getDBkey() ) !== null
		) {
			return;
		}
		$services = MediaWikiServices::getInstance();
		$dbr = $services->getConnectionProvider()->getReplicaDatabase();
		$links = $services->getLinksMigration();
		$info = $links->getQueryInfo( 'pagelinks' );
		$conds = $links->getLinksConditions( 'pagelinks', $title );
		$ledgers = $dbr->newSelectQueryBuilder()
			->select( [ 'page_id', 'page_title', 'page_latest' ] )
			->tables( $info['tables'] )
			->joinConds( $info['joins'] )
			->join( 'page', null, 'page_id = pl_from' )
			->where( $conds )
			->andWhere( [ 'pl_from_namespace' => Todo::NAMESPACE ] )
			->andWhere( $dbr->expr( 'page_title', IExpression::LIKE,
				new LikeValue( MoodLinks::PREFIX, $dbr->anyString(), MoodLinks::INFIX, $dbr->anyString() ) ) )
			->orderBy( 'page_title', 'DESC' )
			->limit( 48 )
			->caller( __METHOD__ )
			->fetchResultSet();
		if ( !$ledgers->numRows() ) {
			return;
		}
		$ledgers = iterator_to_array( $ledgers );
		// Reading every ledger naming a page, and its YAML, is the cost of a view (about 3 ms a
		// ledger of 100 rows): kept until one of them changes, as its revision is in the key.
		$cache = $services->getMainWANObjectCache();
		$key = $cache->makeKey( 'pickipedia-moodlinks', md5( $title->getPrefixedDBkey() . '|'
			. implode( ',', array_map( static fn ( $l ) => $l->page_latest, $ledgers ) ) ) );
		$rows = $cache->getWithSetCallback( $key, $cache::TTL_WEEK, static function () use ( $services, $ledgers, $title ) {
			$rows = [];
			$revisions = $services->getRevisionLookup();
			foreach ( $ledgers as $ledger ) {
				$mood = MoodLinks::moodOf( Todo::NAMESPACE, $ledger->page_title );
				$revision = $mood !== null ? $revisions->getRevisionById( (int)$ledger->page_latest ) : null;
				$content = $revision ? $revision->getContent( SlotRecord::MAIN ) : null;
				if ( !$content instanceof \TextContent ) {
					continue;
				}
				foreach ( MoodLinks::rows( MoodLinks::body( $content->getText() ) ) ?? [] as $row ) {
					$named = Title::newFromText( $row['page'] );
					if ( $named && $named->equals( $title ) ) {
						$rows[] = $row + [ 'mood' => $mood ];
					}
				}
			}
			return $rows;
		} );
		$data .= MoodLinks::footer( $rows, $skin->msg( 'pickipediacontent-moodlinks-heading' )->text() );
	}

	/**
	 * Let wiki modules require() the Lua that ships in this extension.
	 *
	 * Scribunto merges these paths with its own and searches them before it
	 * looks for a wiki page, mapping dots to directories: a module asking for
	 * "pickipedia.instruments" is answered by lua/pickipedia/instruments.lua.
	 *
	 * A Module: page then holds a one-line shim, and the logic it used to
	 * hold lives in git — reviewed in a pull request, kept in history,
	 * revertable, and testable outside a running wiki.
	 *
	 * This hook is defined by Scribunto rather than by core, so there is no
	 * interface to implement; declaring one would make Scribunto a hard
	 * dependency of this file. PickiPediaReleases handles PageForms the same
	 * way.
	 *
	 * @param string $engine Scripting engine being set up.
	 * @param string[] &$paths Filesystem directories to search, appended to.
	 */
	public function onScribuntoExternalLibraryPaths(
		string $engine, array &$paths
	): void {
		if ( $engine !== 'lua' ) {
			return;
		}
		$paths[] = dirname( __DIR__ ) . '/lua';
	}

	/**
	 * Load the article styles on every page.
	 *
	 * addModuleStyles rather than addModules: these are styles with no
	 * behaviour, so they belong in the head, applied before the first paint
	 * rather than after it.
	 *
	 * @param \MediaWiki\Output\OutputPage $out
	 * @param \Skin $skin
	 */
	public function onBeforePageDisplay( $out, $skin ): void {
		$out->addModuleStyles( [ 'ext.pickipediaContent.styles' ] );
	}

	/**
	 * An Agent: page is changed only by the agent it belongs to, or a sysop
	 * (AgentPages.php). Every action but reading is a change: edit, create,
	 * move (asked of both the page and where it would go), delete.
	 *
	 * @param Title $title
	 * @param \User $user
	 * @param string $action
	 * @param array|string|\MessageSpecifier &$result
	 * @return bool|void
	 */
	public function onGetUserPermissionsErrors( $title, $user, $action, &$result ) {
		if ( $action === 'read' || !defined( 'NS_AGENT' ) || $title->getNamespace() !== NS_AGENT ) {
			return;
		}
		if ( AgentPages::mayChange( $title->getText(), $user->getName(), $user->isAllowed( 'agent-edit-any' ) ) ) {
			return;
		}
		$result = [ 'pickipediacontent-agent-not-yours', AgentPages::owner( $title->getText() ) ];
		return false;
	}

	/**
	 * Mood to-do lists, hidden from Recent Changes (and the watchlist, and related
	 * changes) unless asked for (Justin, 18 Oct 2026: of a day's 115 changes, 74 were to-do
	 * edits, most of them not bot edits, so hiding bots didn't help). The lists stay on
	 * the wiki, linked to and from; magenta shows each Mood its own.
	 *
	 * Shaped as core's Bot / Human filter is: two choices, "Mood to-do lists" and
	 * "Everything else", the first hidden by default, so the filter bar shows
	 * "Everything else" chosen, and taking it off shows all.
	 *
	 * @param \ChangesListSpecialPage $special
	 */
	public function onChangesListSpecialPageStructuredFilters( $special ) {
		$notTodo = static function ( IReadableDatabase $dbr ): IExpression {
			return $dbr->expr( 'rc_namespace', '!=', Todo::NAMESPACE )->or( 'rc_title', IExpression::NOT_LIKE,
				new LikeValue( Todo::PREFIX, $dbr->anyString(), Todo::SUFFIX ) );
		};
		$special->registerFilterGroup( new \ChangesListBooleanFilterGroup( [
			'name' => 'pickipediatodo',
			'title' => 'pickipediacontent-rcfilters-todo-title',
			'priority' => -10,
			'filters' => [
				[
					'name' => 'hidemoodtodos',
					'label' => 'pickipediacontent-rcfilters-todo-label',
					'description' => 'pickipediacontent-rcfilters-todo-description',
					'showHide' => 'pickipediacontent-rcfilters-todo-showhide',
					'default' => true,
					'queryCallable' => static function ( string $specialClassName, $ctx, IReadableDatabase $dbr,
						&$tables, &$fields, &$conds, &$query_options, &$join_conds
					) use ( $notTodo ) {
						$conds[] = $notTodo( $dbr );
					},
					'isRowApplicableCallable' => static function ( $ctx, $rc ) {
						return Todo::isMoodList( (int)$rc->getAttribute( 'rc_namespace' ),
							(string)$rc->getAttribute( 'rc_title' ) );
					},
				],
				[
					'name' => 'hidenotmoodtodos',
					'label' => 'pickipediacontent-rcfilters-nottodo-label',
					'description' => 'pickipediacontent-rcfilters-nottodo-description',
					'default' => false,
					'queryCallable' => static function ( string $specialClassName, $ctx, IReadableDatabase $dbr,
						&$tables, &$fields, &$conds, &$query_options, &$join_conds
					) use ( $notTodo ) {
						$conds[] = $dbr->expr( 'rc_namespace', '=', Todo::NAMESPACE )->and( 'rc_title', IExpression::LIKE,
							new LikeValue( Todo::PREFIX, $dbr->anyString(), Todo::SUFFIX ) );
					},
					'isRowApplicableCallable' => static function ( $ctx, $rc ) {
						return !Todo::isMoodList( (int)$rc->getAttribute( 'rc_namespace' ),
							(string)$rc->getAttribute( 'rc_title' ) );
					},
				],
			],
		] ) );
	}
}
