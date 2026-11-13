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
use MediaWiki\Hook\PageMoveCompleteHook;
use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Hook\UploadCompleteHook;
use MediaWiki\Storage\Hook\PageSaveCompleteHook;
use MediaWiki\Hook\SkinAfterContentHook;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\Permissions\Hook\GetUserPermissionsErrorsHook;
use MediaWiki\Preferences\Hook\GetPreferencesHook;
use MediaWiki\User\Options\Hook\SaveUserOptionsHook;
use MediaWiki\SpecialPage\Hook\ChangesListSpecialPageStructuredFiltersHook;
use MediaWiki\Title\Title;
use Wikimedia\Rdbms\IExpression;
use Wikimedia\Rdbms\IReadableDatabase;
use Wikimedia\Rdbms\LikeValue;

class Hooks implements BeforePageDisplayHook, ParserFirstCallInitHook, GetUserPermissionsErrorsHook,
	ChangesListSpecialPageStructuredFiltersHook, SkinAfterContentHook, GetPreferencesHook, SaveUserOptionsHook,
	PageSaveCompleteHook, PageMoveCompleteHook, UploadCompleteHook {

	/** A save, told to magenta at once (MagentaPush.php). */
	public function onPageSaveComplete( $wikiPage, $user, $summary, $flags, $revisionRecord, $editResult ) {
		MagentaPush::tell( MagentaPush::payload(
			$wikiPage->getTitle()->getPrefixedText(), $revisionRecord->getId(), $user->getName(),
			( $flags & EDIT_NEW ) ? 'new' : 'edit'
		) );
	}

	/** A move: both titles, so magenta forgets the old and reads the new. */
	public function onPageMoveComplete( $old, $new, $user, $pageid, $redirid, $reason, $revision ) {
		$from = Title::newFromLinkTarget( $old )->getPrefixedText();
		MagentaPush::tell( MagentaPush::payload(
			Title::newFromLinkTarget( $new )->getPrefixedText(), $revision ? $revision->getId() : null,
			$user->getName(), 'move', $from
		) );
	}

	/** An upload: its File: page, so a picture's embed is read again. */
	public function onUploadComplete( $uploadBase ) {
		$title = $uploadBase->getTitle();
		if ( !$title ) {
			return;
		}
		$file = $uploadBase->getLocalFile();
		$user = $file ? $file->getUploader() : null;
		MagentaPush::tell( MagentaPush::payload(
			$title->getPrefixedText(), null, $user ? $user->getName() : '', 'upload'
		) );
	}

	/**
	 * Pronouns on Special:Preferences, in place of MediaWiki's own three (Pronouns.php; Justin, 26 Oct: one field,
	 * not two). Its gender stays a preference -- the API still sets it -- set from the pronouns when they're saved.
	 */
	public function onGetPreferences( $user, &$preferences ) {
		$field = Pronouns::preference();
		$lookup = MediaWikiServices::getInstance()->getUserOptionsLookup();
		if ( Pronouns::clean( $lookup->getOption( $user, Pronouns::OPTION, '' ) ) === '' ) {
			$field['default'] = Pronouns::fromGender( $lookup->getOption( $user, 'gender' ) );
		}
		$preferences[Pronouns::OPTION] = $field;
		// The time offset is MediaWiki's own field; it says here that it's read by others (TimeZone.php).
		if ( isset( $preferences[TimeZone::OPTION] ) ) {
			$preferences[TimeZone::OPTION]['help-message'] = 'pickipediacontent-timezone-help';
		}
		if ( isset( $preferences['gender'] ) ) {
			$preferences['gender'] = [ 'type' => 'api' ];
		}
	}

	/** Saving pronouns sets MediaWiki's gender to match (Pronouns::genderFor). */
	public function onSaveUserOptions( $user, &$modifiedOptions, $originalOptions ) {
		if ( array_key_exists( Pronouns::OPTION, $modifiedOptions ) ) {
			$modifiedOptions['gender'] = Pronouns::genderFor( $modifiedOptions[Pronouns::OPTION] );
		}
	}

	/** A user's pronouns, as they set them; '' if they haven't, or there's no such user. */
	public static function pronounsOf( string $name ): string {
		$services = MediaWikiServices::getInstance();
		$user = $services->getUserFactory()->newFromName( $name );
		if ( !$user || !$user->isRegistered() ) {
			return '';
		}
		return Pronouns::clean( $services->getUserOptionsLookup()->getOption( $user, Pronouns::OPTION, '' ) );
	}

	/** A user's time zone, as their time offset preference names it (TimeZone::zoneOf); '' if it doesn't. */
	public static function timeZoneOf( string $name ): string {
		$services = MediaWikiServices::getInstance();
		$user = $services->getUserFactory()->newFromName( $name );
		if ( !$user || !$user->isRegistered() ) {
			return '';
		}
		return TimeZone::zoneOf( $services->getUserOptionsLookup()->getOption( $user, TimeZone::OPTION, '' ) );
	}

	/**
	 * <todo>: a to-do list kept as YAML, shown as a checklist (Todo.php).
	 *
	 * @param \Parser $parser
	 */
	public function onParserFirstCallInit( $parser ): void {
		// {{#pronouns:Name}}: theirs, or nothing. A preference changes without an edit, so a page using it is
		// parsed again within the hour.
		$parser->setFunctionHook( 'pronouns', static function ( $parser, $name = '' ) {
			$parser->getOutput()->updateCacheExpiry( 3600 );
			return wfEscapeWikiText( self::pronounsOf( trim( (string)$name ) ) );
		} );
		// {{#timezone:Name}}: the zone their time offset preference names, or nothing (TimeZone.php).
		$parser->setFunctionHook( 'timezone', static function ( $parser, $name = '' ) {
			$parser->getOutput()->updateCacheExpiry( 3600 );
			return wfEscapeWikiText( self::timeZoneOf( trim( (string)$name ) ) );
		} );
		// {{#connectome:}}: the page's connectome card, or nothing (Connectome.php). The cards are rebuilt at each
		// deploy, without an edit to the page, so a page takes its new card within a day.
		$parser->setFunctionHook( 'connectome', static function ( $parser, $name = '' ) {
			$output = $parser->getOutput();
			$output->updateCacheExpiry( 86400 );
			$name = trim( (string)$name );
			$page = $parser->getPage();
			$title = $name !== '' ? Title::newFromText( $name ) : ( $page ? Title::newFromPageReference( $page ) : null );
			$html = $title ? Connectome::cardFor( Connectome::dir(), $title->getPrefixedText() ) : '';
			if ( $html === '' ) {
				return '';
			}
			$output->addModuleStyles( [ 'ext.pickipediaContent.connectome.styles' ] );
			$output->addModules( [ 'ext.pickipediaContent.connectome' ] );
			return [ $html, 'isHTML' => true, 'noparse' => true ];
		} );
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
		// The page, and every title that redirects to it: a page moved for a better headline keeps the links
		// said to its old title (Justin, #interfaces, 13 Nov 2026).
		$targets = [ $title ];
		$redirects = $dbr->newSelectQueryBuilder()
			->select( [ 'page_namespace', 'page_title' ] )
			->from( 'redirect' )
			->join( 'page', null, 'page_id = rd_from' )
			->where( [ 'rd_namespace' => $title->getNamespace(), 'rd_title' => $title->getDBkey(), 'rd_interwiki' => '' ] )
			->limit( 20 )
			->caller( __METHOD__ )
			->fetchResultSet();
		foreach ( $redirects as $redirect ) {
			$targets[] = Title::makeTitle( (int)$redirect->page_namespace, $redirect->page_title );
		}
		$ledgers = [];
		foreach ( $targets as $target ) {
			$found = $dbr->newSelectQueryBuilder()
				->select( [ 'page_id', 'page_title' ] )
				->tables( $info['tables'] )
				->joinConds( $info['joins'] )
				->join( 'page', null, 'page_id = pl_from' )
				->where( $links->getLinksConditions( 'pagelinks', $target ) )
				->andWhere( [ 'pl_from_namespace' => Todo::NAMESPACE ] )
				->andWhere( $dbr->expr( 'page_title', IExpression::LIKE,
					new LikeValue( MoodLinks::PREFIX, $dbr->anyString(), MoodLinks::INFIX, $dbr->anyString() ) ) )
				->orderBy( 'page_title', 'DESC' )
				->limit( 48 )
				->caller( __METHOD__ )
				->fetchResultSet();
			foreach ( $found as $ledger ) {
				$ledgers[(int)$ledger->page_id] = $ledger;
			}
		}
		$rows = [];
		$revisions = $services->getRevisionLookup();
		foreach ( $ledgers as $ledger ) {
			$mood = MoodLinks::moodOf( Todo::NAMESPACE, $ledger->page_title );
			$revision = $mood !== null ? $revisions->getRevisionByPageId( (int)$ledger->page_id ) : null;
			$content = $revision ? $revision->getContent( SlotRecord::MAIN ) : null;
			if ( !$content instanceof \TextContent ) {
				continue;
			}
			foreach ( MoodLinks::rows( MoodLinks::body( $content->getText() ) ) ?? [] as $row ) {
				$named = Title::newFromText( $row['page'] );
				foreach ( $targets as $target ) {
					if ( $named && $named->equals( $target ) ) {
						$rows[] = $row + [ 'mood' => $mood ];
						break;
					}
				}
			}
		}
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
		// A user page says whose pronouns are what, under its title.
		$title = $out->getTitle();
		if ( $title && $title->getNamespace() === NS_USER && !$title->isSubpage()
			&& $out->getRequest()->getVal( 'action', 'view' ) === 'view' ) {
			$pronouns = self::pronounsOf( $title->getText() );
			if ( $pronouns !== '' ) {
				$out->addSubtitle( htmlspecialchars( $out->msg( 'pickipediacontent-pronouns-subtitle', $pronouns )->text() ) );
			}
		}
		self::addCard( $out );
		self::addTidingBanner( $out );
		// "+ chartifact" on the edit toolbar, and beside a Chartifacts
		// heading's "edit source" for whoever can edit (Skyler, #rabbithole,
		// 13 Nov 2026).
		$action = $out->getRequest()->getVal( 'action', 'view' );
		if ( in_array( $action, [ 'edit', 'submit' ], true )
			|| ( $action === 'view' && $out->getUser()->isRegistered() ) ) {
			$out->addModules( [ 'ext.pickipediaContent.chartifactButton' ] );
		}
	}

	/**
	 * A page that is a tiding on magenta says so at its foot, linking to the
	 * discussion there (Justin, #interfaces, 13 Nov 2026). Whether it is, and
	 * the words (Magenta:Interface's wiki-tiding-banner), are magenta's to say:
	 * the reader's browser asks it, so the page here stays cached as it is.
	 *
	 * @param \OutputPage $out
	 */
	private static function addTidingBanner( $out ): void {
		$title = $out->getTitle();
		$request = $out->getRequest();
		if ( !$title || !$title->exists() || $title->isSpecialPage() || $title->isTalkPage()
			|| $request->getVal( 'action', 'view' ) !== 'view'
			|| $request->getVal( 'diff' ) !== null || $request->getVal( 'oldid' ) !== null ) {
			return;
		}
		$out->addJsConfigVars( 'wgPickiPediaMagenta',
			rtrim( (string)$out->getConfig()->get( 'PickiPediaContentMagentaPublicUrl' ), '/' ) );
		$out->addModules( [ 'ext.pickipediaContent.tidingBanner' ] );
	}

	/**
	 * The page's card where its address is shared (SocialCard.php): Open Graph
	 * and Twitter tags, for a page as it reads -- not an edit, a diff, an old
	 * revision or a special page.
	 *
	 * @param \OutputPage $out
	 */
	private static function addCard( $out ): void {
		$title = $out->getTitle();
		$request = $out->getRequest();
		if ( !$title || !$title->exists() || $title->isSpecialPage()
			|| $request->getVal( 'action', 'view' ) !== 'view'
			|| $request->getVal( 'diff' ) !== null || $request->getVal( 'oldid' ) !== null ) {
			return;
		}
		$config = $out->getConfig();
		$server = $config->get( 'CanonicalServer' );
		$card = SocialCard::fromHtml( $out->getHTML(), $server );
		$urls = MediaWikiServices::getInstance()->getUrlUtils();
		$logo = $config->get( 'Logos' )['1x'] ?? '';
		$image = $card['image'] ?? ( $logo !== '' ? $urls->expand( $logo, PROTO_CANONICAL ) : null );
		$tags = [
			'og:site_name' => $config->get( 'Sitename' ),
			'og:type' => 'article',
			'og:title' => $title->getPrefixedText(),
			'og:url' => $title->getCanonicalURL(),
			'og:description' => $card['description'],
			'og:image' => $image,
		];
		foreach ( $tags as $property => $content ) {
			if ( $content !== null && $content !== '' ) {
				$out->addHeadItem( $property, \MediaWiki\Html\Html::element( 'meta', [ 'property' => $property, 'content' => $content ] ) );
			}
		}
		$out->addHeadItem( 'twitter:card', \MediaWiki\Html\Html::element( 'meta',
			[ 'name' => 'twitter:card', 'content' => $card['image'] ? 'summary_large_image' : 'summary' ] ) );
		if ( $card['description'] !== '' ) {
			$out->addMeta( 'description', $card['description'] );
		}
	}

	/**
	 * An Emergent: page is changed only by the emergent it belongs to, or a
	 * sysop (EmergentPages.php). Every action but reading is a change: edit, create,
	 * move (asked of both the page and where it would go), delete.
	 *
	 * @param Title $title
	 * @param \User $user
	 * @param string $action
	 * @param array|string|\MessageSpecifier &$result
	 * @return bool|void
	 */
	public function onGetUserPermissionsErrors( $title, $user, $action, &$result ) {
		if ( $action === 'read' || !defined( 'NS_EMERGENT' ) || $title->getNamespace() !== NS_EMERGENT ) {
			return;
		}
		if ( EmergentPages::mayChange( $title->getText(), $user->getName(), $user->isAllowed( 'emergent-edit-any' ) ) ) {
			return;
		}
		$result = [ 'pickipediacontent-emergent-not-yours', EmergentPages::owner( $title->getText() ) ];
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
