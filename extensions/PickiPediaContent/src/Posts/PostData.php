<?php
/**
 * What a post's page shows besides its own words, read from the wiki: who
 * wrote it and their picture, their other writing, their songs, where the
 * post stands in a series, its videos' shapes, and, if it is a tiding on
 * magenta, what has been said about it there.
 *
 * Everything here is kept (WANObjectCache) and is cheap to ask for again;
 * each answer says how long it is kept and what makes it stale sooner. The
 * rules themselves are in Post.php, which needs no wiki.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts;

use MediaWiki\Extension\PickiPediaContent\Hooks;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use Wikimedia\Rdbms\IExpression;
use Wikimedia\Rdbms\LikeValue;

class PostData {

	/** __NOTAPOST__ on a user subpage: it is read as an ordinary wiki page. */
	public const PROP_NOT = 'notapost';
	/** What {{#byline:}} on a user page says of its person. */
	public const BYLINE = [ 'name' => 'byline_name', 'person' => 'byline_person', 'picture' => 'byline_picture',
		'says' => 'byline_says' ];

	private const WRITINGS_TTL = 600;
	private const AUTHOR_TTL = 3600;
	private const SONGS_TTL = 3600;
	private const SHAPE_TTL = 86400;
	/** A tiding's thread moves; a new comment shows within two minutes. */
	private const TIDING_TTL = 120;
	/** magenta didn't answer: ask again in a minute, and meanwhile no page waits on it. */
	private const TIDING_MISS_TTL = 60;
	private const TIDING_TIMEOUT = 2;

	public const SHELF = 7;
	public const SONGS = 8;
	public const SAID = 5;

	/** Whether posts are on at all ($wgPickiPediaContentPosts): off, they are ordinary wiki pages. */
	public static function enabled(): bool {
		return (bool)MediaWikiServices::getInstance()->getMainConfig()->get( 'PickiPediaContentPosts' );
	}

	/**
	 * Whether a page is a post: somebody's subpage, written in wikitext,
	 * not one of the kinds that never are (Post::NOT_POSTS), and not
	 * marked __NOTAPOST__ by whoever keeps it.
	 */
	public static function isPost( Title $title ): bool {
		if ( $title->getNamespace() !== NS_USER || !Post::isPostTitle( $title->getText() ) || !$title->exists()
			|| $title->isRedirect() || $title->getContentModel() !== CONTENT_MODEL_WIKITEXT
		) {
			return false;
		}
		return !MediaWikiServices::getInstance()->getPageProps()->getProperties( $title, self::PROP_NOT );
	}

	private static function userKey( string $user ): string {
		$cache = MediaWikiServices::getInstance()->getMainWANObjectCache();
		return $cache->makeKey( 'pp-posts', 'user', sha1( $user ) );
	}

	/** Something of this user's changed (a save, a move, a deletion under User:Name): what is kept of them is read again. */
	public static function touch( string $user ): void {
		MediaWikiServices::getInstance()->getMainWANObjectCache()->touchCheckKey( self::userKey( $user ) );
	}

	/**
	 * Every post a user has: [ 'path' => its path under them, 'created' => when it was begun (TS_MW) ].
	 *
	 * @return array<int,array{path: string, created: string}>
	 */
	public static function writings( string $user ): array {
		$cache = MediaWikiServices::getInstance()->getMainWANObjectCache();
		return $cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'writings', sha1( $user ) ),
			self::WRITINGS_TTL,
			static fn () => self::readWritings( $user ),
			[ 'checkKeys' => [ self::userKey( $user ) ] ]
		);
	}

	private static function readWritings( string $user ): array {
		$services = MediaWikiServices::getInstance();
		$dbr = $services->getConnectionProvider()->getReplicaDatabase();
		$prefix = str_replace( ' ', '_', $user ) . '/';
		$res = $dbr->newSelectQueryBuilder()
			->select( [ 'page_id', 'page_title', 'page_content_model', 'created' => 'MIN(rev_timestamp)' ] )
			->from( 'page' )
			->join( 'revision', null, 'rev_page = page_id' )
			->where( [
				'page_namespace' => NS_USER,
				'page_is_redirect' => 0,
				$dbr->expr( 'page_title', IExpression::LIKE, new LikeValue( $prefix, $dbr->anyString() ) ),
			] )
			->groupBy( [ 'page_id', 'page_title', 'page_content_model' ] )
			->limit( 2000 )
			->caller( __METHOD__ )
			->fetchResultSet();
		$rows = [];
		foreach ( $res as $row ) {
			$text = str_replace( '_', ' ', $row->page_title );
			if ( $row->page_content_model !== null && $row->page_content_model !== CONTENT_MODEL_WIKITEXT ) {
				continue;
			}
			if ( !Post::isPostTitle( $text ) ) {
				continue;
			}
			$rows[(int)$row->page_id] = [
				'path' => substr( $text, strlen( $user ) + 1 ),
				'created' => (string)$row->created,
			];
		}
		if ( $rows ) {
			$not = $dbr->newSelectQueryBuilder()
				->select( 'pp_page' )
				->from( 'page_props' )
				->where( [ 'pp_propname' => self::PROP_NOT, 'pp_page' => array_keys( $rows ) ] )
				->caller( __METHOD__ )
				->fetchFieldValues();
			foreach ( $not as $id ) {
				unset( $rows[(int)$id] );
			}
		}
		return array_values( $rows );
	}

	/**
	 * Who wrote it, as their own user page says: their name, picture,
	 * a line about them, the person they are on this wiki, their page on
	 * magenta. Kept until their user page is next saved.
	 *
	 * @return array{user: string, name: string, url: string, exists: bool, avatar: ?array, says: string,
	 *   person: ?array, magenta: string, pronouns: string}
	 */
	public static function author( string $user ): array {
		$services = MediaWikiServices::getInstance();
		$cache = $services->getMainWANObjectCache();
		$userTitle = Title::makeTitle( NS_USER, $user );
		return $cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'author', sha1( $user ), $userTitle->getLatestRevID() ),
			self::AUTHOR_TTL,
			static fn () => self::readAuthor( $user, $userTitle )
		);
	}

	private static function readAuthor( string $user, Title $userTitle ): array {
		$services = MediaWikiServices::getInstance();
		$config = $services->getMainConfig();
		$wikitext = '';
		$props = [];
		if ( $userTitle->exists() ) {
			$content = $services->getWikiPageFactory()->newFromTitle( $userTitle )->getContent();
			$wikitext = $content && method_exists( $content, 'getText' ) ? (string)$content->getText() : '';
			$props = $services->getPageProps()->getProperties( $userTitle, array_values( self::BYLINE ) )
				[$userTitle->getArticleID()] ?? [];
		}
		$person = null;
		if ( ( $props[self::BYLINE['person']] ?? '' ) !== '' ) {
			$person = self::existing( (string)$props[self::BYLINE['person']] );
		}
		$name = trim( (string)( $props[self::BYLINE['name']] ?? '' ) );
		if ( $name === '' ) {
			$name = $person ? $person->getText() : $user;
		}
		$picture = trim( (string)( $props[self::BYLINE['picture']] ?? '' ) );
		if ( $picture === '' ) {
			$picture = Post::firstFile( $wikitext );
		}
		$magenta = Post::magentaName( $wikitext );
		$public = rtrim( (string)$config->get( 'PickiPediaContentMagentaPublicUrl' ), '/' );
		return [
			'user' => $user,
			'name' => $name,
			'url' => $userTitle->getLocalURL(),
			'exists' => $userTitle->exists(),
			'avatar' => $picture !== '' ? self::thumb( $picture, 96 ) : null,
			'says' => trim( (string)( $props[self::BYLINE['says']] ?? '' ) ),
			'person' => $person ? [ 'title' => $person->getPrefixedText(), 'url' => $person->getLocalURL() ] : null,
			'magenta' => $magenta !== '' && $public !== '' ? $public . '/people/' . rawurlencode( $magenta ) . '/' : '',
			'pronouns' => Hooks::pronounsOf( $user ),
		];
	}

	/** A title as an existing page, its redirect followed; null if there's no such page. */
	private static function existing( string $text ): ?Title {
		$title = Title::newFromText( $text );
		if ( !$title || !$title->exists() ) {
			return null;
		}
		if ( $title->isRedirect() ) {
			$target = MediaWikiServices::getInstance()->getRedirectLookup()->getRedirectTarget( $title );
			$title = $target ? Title::castFromLinkTarget( $target ) : null;
		}
		return $title && $title->exists() ? $title : null;
	}

	/**
	 * A picture, small: [ 'src', 'srcset', 'width', 'height' ], or null if
	 * the wiki has no such file or can't draw it.
	 */
	public static function thumb( string $fileName, int $width ): ?array {
		$title = Title::makeTitleSafe( NS_FILE, $fileName );
		if ( !$title ) {
			return null;
		}
		try {
			$file = MediaWikiServices::getInstance()->getRepoGroup()->findFile( $title );
			if ( !$file || !$file->exists() || !$file->canRender() ) {
				return null;
			}
			$one = $file->transform( [ 'width' => $width ] );
			if ( !$one || $one->isError() ) {
				return null;
			}
			$two = $file->transform( [ 'width' => $width * 2 ] );
			return [
				'src' => $one->getUrl(),
				'srcset' => $two && !$two->isError() && $two->getUrl() !== $one->getUrl()
					? $one->getUrl() . ' 1x, ' . $two->getUrl() . ' 2x' : '',
				'width' => (int)$one->getWidth(),
				'height' => (int)$one->getHeight(),
			];
		} catch ( \Throwable $e ) {
			return null;
		}
	}

	/**
	 * The songs a person wrote that are charted in Rabbithole: [ 'title',
	 * 'url', 'listen' ], by name. A song is theirs if its page says so
	 * ({{Song|composer=}}, which records Has composer); its track is the one
	 * its page's listen link names; and the track is charted if its recording
	 * metadata has a timeline (charted()), which is what Rabbithole's own song
	 * selector lists. A track nobody has charted plays there too, but with
	 * nobody lit up, and the rail promises that (re's QA, 13 Nov 2026: three
	 * of Justin's eight were such). No Semantic MediaWiki, or nobody: none.
	 *
	 * @param string $person the person's page, e.g. "Justin Myles Holmes"
	 */
	public static function songs( string $person ): array {
		if ( $person === '' || !defined( 'SMW_VERSION' ) ) {
			return [];
		}
		$cache = MediaWikiServices::getInstance()->getMainWANObjectCache();
		return $cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'charted-songs', sha1( $person ) ),
			self::SONGS_TTL,
			static fn () => self::readSongs( $person )
		);
	}

	private static function readSongs( string $person ): array {
		$title = Title::newFromText( $person );
		if ( !$title ) {
			return [];
		}
		$pages = [];
		try {
			$store = \SMW\StoreFactory::getStore();
			$property = \SMW\DIProperty::newFromUserLabel( 'Has composer' );
			foreach ( $store->getPropertySubjects( $property, \SMW\DIWikiPage::newFromTitle( $title ) ) as $subject ) {
				$page = $subject->getTitle();
				if ( $page && $subject->getSubobjectName() === '' && $page->exists() ) {
					$pages[$page->getArticleID()] = $page;
				}
			}
		} catch ( \Throwable $e ) {
			return [];
		}
		if ( !$pages ) {
			return [];
		}
		$songs = [];
		foreach ( $pages as $page ) {
			$cid = self::trackOf( $page );
			if ( $cid !== '' && self::charted( $cid ) ) {
				$songs[] = [
					'title' => $page->getText(),
					'url' => $page->getLocalURL(),
					'listen' => '/rabbithole/?track=' . rawurlencode( $cid ),
				];
			}
		}
		usort( $songs, static fn ( $a, $b ) => strnatcasecmp( $a['title'], $b['title'] ) );
		return $songs;
	}

	/**
	 * The track a song's page plays in Rabbithole (Post::trackIn), read from the page as parsed: its listen
	 * link is to this wiki's own address, and MediaWiki keeps no table of those. Kept until the page changes.
	 */
	public static function trackOf( Title $page ): string {
		$services = MediaWikiServices::getInstance();
		$cache = $services->getMainWANObjectCache();
		return (string)$cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'track', $page->getArticleID(), $page->getLatestRevID() ),
			self::SHAPE_TTL,
			static function () use ( $services, $page ) {
				try {
					$status = $services->getParserOutputAccess()->getParserOutput(
						$services->getWikiPageFactory()->newFromTitle( $page ),
						\MediaWiki\Parser\ParserOptions::newFromAnon()
					);
					if ( !$status->isOK() ) {
						return '';
					}
					return Post::trackIn( Post::listenLinks( $status->getValue()->getRawText() ) );
				} catch ( \Throwable $e ) {
					return '';
				}
			}
		);
	}

	/**
	 * Whether a track is charted in Rabbithole (Post::charted), read from its
	 * recording metadata, Release:<cid>/Metadata. Kept until that page changes;
	 * a person's list of songs (songs()) is kept an hour, so a song charted
	 * today joins their rail within the hour.
	 */
	public static function charted( string $cid ): bool {
		if ( $cid === '' || !defined( 'NS_RELEASE' ) || !class_exists( \Symfony\Component\Yaml\Yaml::class ) ) {
			return false;
		}
		$title = Title::makeTitleSafe( NS_RELEASE, $cid . '/Metadata' );
		if ( !$title || !$title->exists() ) {
			return false;
		}
		$services = MediaWikiServices::getInstance();
		$cache = $services->getMainWANObjectCache();
		// 1 or 0, never false: false is how a cache says it has nothing.
		return (bool)$cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'charted', sha1( $cid ), $title->getLatestRevID() ),
			self::SHAPE_TTL,
			static function () use ( $services, $title ) {
				try {
					$content = $services->getWikiPageFactory()->newFromTitle( $title )->getContent();
					$text = $content && method_exists( $content, 'getText' ) ? (string)$content->getText() : '';
					return Post::charted( \Symfony\Component\Yaml\Yaml::parse( $text ) ) ? 1 : 0;
				} catch ( \Throwable $e ) {
					return 0;
				}
			}
		);
	}

	/**
	 * Each video's picture size, from its Release page: CID => [width, height].
	 *
	 * @param string[] $cids
	 * @return array<string,array{0:int,1:int}>
	 */
	public static function videoShapes( array $cids ): array {
		if ( !$cids || !defined( 'NS_RELEASE' ) || !class_exists( \Symfony\Component\Yaml\Yaml::class ) ) {
			return [];
		}
		$services = MediaWikiServices::getInstance();
		$cache = $services->getMainWANObjectCache();
		$shapes = [];
		foreach ( array_slice( $cids, 0, 12 ) as $cid ) {
			$title = Title::makeTitleSafe( NS_RELEASE, $cid );
			if ( !$title || !$title->exists() ) {
				continue;
			}
			$shape = $cache->getWithSetCallback(
				$cache->makeKey( 'pp-posts', 'shape', sha1( $cid ), $title->getLatestRevID() ),
				self::SHAPE_TTL,
				static function () use ( $services, $title ) {
					try {
						$content = $services->getWikiPageFactory()->newFromTitle( $title )->getContent();
						$text = $content && method_exists( $content, 'getText' ) ? (string)$content->getText() : '';
						$release = \Symfony\Component\Yaml\Yaml::parse( $text );
						return is_array( $release ) ? ( Post::videoShape( $release ) ?? [] ) : [];
					} catch ( \Throwable $e ) {
						return [];
					}
				}
			);
			if ( $shape ) {
				$shapes[$cid] = $shape;
			}
		}
		return $shapes;
	}

	/**
	 * The page's tiding on magenta, and the last things said there
	 * (Post::tiding), or null: not a tiding, or magenta didn't say. Asked
	 * of magenta at most every two minutes for a page, from here, so the
	 * page arrives with it and nothing is added by script.
	 */
	public static function tiding( Title $title ): ?array {
		$services = MediaWikiServices::getInstance();
		$config = $services->getMainConfig();
		$base = rtrim( (string)$config->get( 'PickiPediaContentMagentaUrl' ), '/' );
		$public = rtrim( (string)$config->get( 'PickiPediaContentMagentaPublicUrl' ), '/' );
		if ( $base === '' || $public === '' ) {
			return null;
		}
		$cache = $services->getMainWANObjectCache();
		$key = $cache->makeKey( 'pp-posts', 'tiding', sha1( $title->getPrefixedText() ) );
		$found = $cache->get( $key );
		if ( $found === false ) {
			$ttl = self::TIDING_TTL;
			$found = [];
			try {
				$answer = $services->getHttpRequestFactory()->get(
					$base . '/api/wiki/tiding/?' . wfArrayToCgi( [ 'title' => $title->getPrefixedText(), 'recent' => self::SAID ] ),
					[ 'timeout' => self::TIDING_TIMEOUT, 'connectTimeout' => 1, 'userAgent' => 'PickiPedia/1.0 (posts)' ],
					__METHOD__
				);
				if ( $answer === null ) {
					$ttl = self::TIDING_MISS_TTL;
				} else {
					$found = Post::tiding( json_decode( $answer, true ), $public ) ?? [];
				}
			} catch ( \Throwable $e ) {
				$ttl = self::TIDING_MISS_TTL;
			}
			$cache->set( $key, $found, $ttl );
		}
		return $found ?: null;
	}
}
