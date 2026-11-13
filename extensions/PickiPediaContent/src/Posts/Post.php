<?php
/**
 * A post: a person's own writing, kept as a subpage of their user page
 * (User:JMyles/My Long Forgotten Dream), and read in its own skin, Broadside
 * (SkinBroadside.php), not the wiki's.
 *
 * Justin, 13 Nov 2026 (#pickipedia-style-and-main-page): "a complete rewrite
 * of the 'blogish' style ... templated out so that the style isn't suddenly
 * shifted by javascript - have a totally different style sheet set load".
 *
 * This file is the part that needs no wiki: which titles are posts, how a
 * title reads as a headline, where a post stands in its series, how long it
 * takes to read, and what is lifted out of its body. tests/check-posts.php
 * runs it as plain PHP.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts;

class Post {

	/**
	 * Under User:, these are not writing: the attestations an invitation
	 * leaves behind, and a user's own scripts and styles.
	 */
	public const NOT_POSTS = [ '#^[^/]+/Attestations(/|$)#', '#\.(js|css|json)$#i' ];

	/** An unhurried reader of English prose. */
	public const WORDS_PER_MINUTE = 230;

	/** How much of a message from the thread is shown under a post. */
	public const SAID_CHARS = 420;

	/**
	 * Whether a title in a post namespace (without its namespace) names a
	 * post: somebody's subpage, and not one of the kinds that never are.
	 *
	 * @param string $text e.g. "JMyles/My Long Forgotten Dream"
	 * @param string[] $not regular expressions for titles that are not posts
	 */
	public static function isPostTitle( string $text, array $not = self::NOT_POSTS ): bool {
		$slash = strpos( $text, '/' );
		if ( $slash === false || $slash === 0 || $slash === strlen( $text ) - 1 ) {
			return false;
		}
		foreach ( $not as $pattern ) {
			if ( preg_match( $pattern, $text ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * A title, taken apart: whose it is, and the path under them.
	 *
	 * @return array{user: string, path: string[], leaf: string, parent: ?string}
	 *   parent: the path above the leaf ("letters-to-emergents"), or null
	 */
	public static function parts( string $text ): array {
		$path = explode( '/', $text );
		$user = array_shift( $path );
		return [
			'user' => $user,
			'path' => $path,
			'leaf' => $path ? $path[count( $path ) - 1] : '',
			'parent' => count( $path ) > 1 ? implode( '/', array_slice( $path, 0, -1 ) ) : null,
		];
	}

	/**
	 * A path segment as words: "letters-to-emergents" is "Letters to
	 * emergents". One already written as words is left as it is.
	 */
	public static function humanize( string $segment ): string {
		if ( str_contains( $segment, ' ' ) || !preg_match( '/[-_]/', $segment ) ) {
			return $segment;
		}
		$words = trim( preg_replace( '/[-_]+/', ' ', $segment ) );
		return mb_strtoupper( mb_substr( $words, 0, 1 ) ) . mb_substr( $words, 1 );
	}

	/**
	 * The headline. A post on its own is its own name. One of a series
	 * that is only numbered ("letters-to-emergents/13") takes the series'
	 * name with its number, since "13" is no headline.
	 *
	 * @param array $parts from parts()
	 * @param bool $inSeries whether its parent is a series (PostData decides: the parent page exists, or it has siblings)
	 */
	public static function headline( array $parts, bool $inSeries ): string {
		if ( !$inSeries || $parts['parent'] === null ) {
			return implode( '/', $parts['path'] );
		}
		if ( preg_match( '/^\d+$/', $parts['leaf'] ) ) {
			return self::seriesName( $parts ) . ', № ' . $parts['leaf'];
		}
		return $parts['leaf'];
	}

	/** The series' name: the last segment above the leaf, as words. */
	public static function seriesName( array $parts ): string {
		$above = array_slice( $parts['path'], 0, -1 );
		return $above ? self::humanize( $above[count( $above ) - 1] ) : '';
	}

	/** How many words a parsed page has, its styles and scripts left out. */
	public static function wordCount( string $html ): int {
		$html = preg_replace( '#<(style|script)\b[^>]*>.*?</\1>#is', ' ', $html ) ?? $html;
		$text = html_entity_decode( strip_tags( str_replace( '<', ' <', $html ) ), ENT_QUOTES | ENT_HTML5 );
		return count( preg_split( '/\s+/u', trim( $text ), -1, PREG_SPLIT_NO_EMPTY ) ?: [] );
	}

	/** Minutes to read that many words; never less than one. */
	public static function minutes( int $words ): int {
		return max( 1, (int)round( $words / self::WORDS_PER_MINUTE ) );
	}

	/**
	 * Where a post stands among its siblings, in reading order: numbers as
	 * numbers ("2" before "10"), anything else by name.
	 *
	 * @param string[] $leaves every sibling's leaf name, the post's own among them
	 * @return array{index: int, count: int, prev: ?string, next: ?string, order: string[]}
	 *   index: 1-based, 0 if the post is not among them
	 */
	public static function neighbours( array $leaves, string $current ): array {
		$order = array_values( array_unique( $leaves ) );
		usort( $order, 'strnatcasecmp' );
		$at = array_search( $current, $order, true );
		return [
			'index' => $at === false ? 0 : $at + 1,
			'count' => count( $order ),
			'prev' => $at !== false && $at > 0 ? $order[$at - 1] : null,
			'next' => $at !== false && $at < count( $order ) - 1 ? $order[$at + 1] : null,
			'order' => $order,
		];
	}

	/**
	 * A person's other writing, as the rail lists it: each post on its
	 * own, and a series (a path with posts under it) as one line, counted.
	 * Newest first, by when each was begun (a series: its newest part).
	 * The post being read is left out, and so is its own series, which has
	 * its own place on the page.
	 *
	 * @param array<int,array{path: string, created: string}> $rows every post of theirs: its path under
	 *   the user, and when it was created (any sortable timestamp)
	 * @param string $current the path of the post being read
	 * @param int $limit
	 * @return array{items: array<int,array{path: string, title: string, created: string, count: int}>, total: int}
	 *   count: 0 for a post, the number of parts for a series
	 */
	public static function shelf( array $rows, string $current, int $limit ): array {
		$paths = array_column( $rows, 'created', 'path' );
		$series = [];
		foreach ( $paths as $path => $created ) {
			$slash = strpos( $path, '/' );
			if ( $slash !== false ) {
				$series[substr( $path, 0, $slash )][] = $path;
			}
		}
		$currentTop = explode( '/', $current )[0];
		$items = [];
		foreach ( $paths as $path => $created ) {
			$top = explode( '/', $path )[0];
			if ( isset( $series[$top] ) ) {
				continue;  // a series, or part of one: below
			}
			if ( $path !== $current ) {
				$items[] = [ 'path' => $path, 'title' => $path, 'created' => (string)$created, 'count' => 0 ];
			}
		}
		foreach ( $series as $top => $parts ) {
			if ( $top === $currentTop ) {
				continue;  // the series being read: it has its own place on the page
			}
			usort( $parts, 'strnatcasecmp' );
			$newest = max( array_map( static fn ( $p ) => (string)$paths[$p], $parts ) );
			$items[] = [
				'path' => isset( $paths[$top] ) ? $top : $parts[0],
				'title' => self::humanize( $top ),
				'created' => $newest,
				'count' => count( $parts ),
			];
		}
		usort( $items, static fn ( $a, $b ) => strcmp( $b['created'], $a['created'] ) ?: strnatcasecmp( $a['title'], $b['title'] ) );
		return [ 'items' => array_slice( $items, 0, $limit ), 'total' => count( $items ) ];
	}

	/**
	 * What a post hands to its masthead: the inside of its first element
	 * of the given class (pp-dek-source: the line under the headline;
	 * pp-kicker-source: the line over it). The element stays in the body,
	 * where the stylesheet hides it; nothing is moved in the browser.
	 */
	public static function sourced( string $html, string $class ): ?string {
		$pattern = '#<(p|div|span)\b[^>]*\bclass="[^"]*(?<![\w-])' . preg_quote( $class, '#' )
			. '(?![\w-])[^"]*"[^>]*>(.*?)</\1>#is';
		if ( !preg_match( $pattern, $html, $m ) ) {
			return null;
		}
		$inner = trim( $m[2] );
		return $inner === '' ? null : $inner;
	}

	/** The CIDs of the videos a parsed page plays ({{HLSVideo}}), in order, each once. */
	public static function videoCids( string $html ): array {
		preg_match_all( '#<div class="hls-video-player" data-cid="([A-Za-z0-9]{30,100})"#', $html, $m );
		return array_values( array_unique( $m[1] ) );
	}

	/**
	 * Give each video its shape before any script runs, so the page does
	 * not jump when the picture arrives: a player whose release says how
	 * wide and tall it is carries that as --bs-ar, and one taller than wide
	 * is marked upright. A video nothing is known about is left alone, and
	 * the stylesheet holds 16:9 for it.
	 *
	 * @param string $html
	 * @param array<string,array{0:int,1:int}> $shapes CID => [width, height]
	 */
	public static function shapeVideos( string $html, array $shapes ): string {
		if ( !$shapes ) {
			return $html;
		}
		return preg_replace_callback(
			'#<div class="hls-video-player" data-cid="([A-Za-z0-9]{30,100})"#',
			static function ( $m ) use ( $shapes ) {
				$shape = $shapes[$m[1]] ?? null;
				if ( !$shape || (int)$shape[0] < 1 || (int)$shape[1] < 1 ) {
					return $m[0];
				}
				[ $w, $h ] = [ (int)$shape[0], (int)$shape[1] ];
				return '<div class="hls-video-player' . ( $h > $w ? ' is-upright' : '' ) . '" style="--bs-ar:'
					. $w . '/' . $h . '" data-cid="' . $m[1] . '"';
			},
			$html
		) ?? $html;
	}

	/**
	 * A release's picture size, from its YAML as parsed: what the
	 * transcode made, else what was uploaded.
	 *
	 * @return array{0:int,1:int}|null [width, height]
	 */
	public static function videoShape( array $release ): ?array {
		$t = is_array( $release['transcode'] ?? null ) ? $release['transcode'] : [];
		$candidates = [
			[ $t['output_width'] ?? null, $t['output_height'] ?? null ],
			[ $release['width'] ?? null, $release['height'] ?? null ],
		];
		foreach ( $candidates as [ $w, $h ] ) {
			if ( is_numeric( $w ) && is_numeric( $h ) && (int)$w > 0 && (int)$h > 0 ) {
				return [ (int)$w, (int)$h ];
			}
		}
		return null;
	}

	/** The first picture a page's wikitext shows, as a file name; '' if none. As magenta reads a person's (wiki_preview.first_file). */
	public static function firstFile( string $wikitext ): string {
		$wikitext = preg_replace( '/<!--.*?-->/s', '', $wikitext ) ?? $wikitext;
		if ( preg_match( '/\[\[\s*(?:File|Image)\s*:\s*([^|\]\n]+)/i', $wikitext, $m ) ) {
			return trim( $m[1] );
		}
		return '';
	}

	/** The name a user page gives its person on magenta ({{Magenta person|justin|Justin}}); '' if it doesn't. */
	public static function magentaName( string $wikitext ): string {
		if ( preg_match( '/\{\{\s*Magenta[ _]person\s*\|\s*([a-z0-9_-]{1,40})\s*[|}]/i', $wikitext, $m ) ) {
			return strtolower( $m[1] );
		}
		return '';
	}

	/**
	 * The addresses a parsed page links into Rabbithole by, its own listen button's first
	 * ({{Listen in Rabbithole}}, drawn pp-listen-rh): a song's page may also link every other track of its
	 * record ({{#ontherecord:}}), and those are not the song.
	 *
	 * @return string[]
	 */
	public static function listenLinks( string $html ): array {
		$decode = static fn ( $href ) => html_entity_decode( $href, ENT_QUOTES | ENT_HTML5 );
		preg_match_all( '/class="[^"]*\bpp-listen-rh\b[^"]*"[^>]*>\s*<a\b[^>]*\bhref="([^"]*\/rabbithole\/\?[^"]*)"/', $html, $own );
		preg_match_all( '/\bhref="([^"]*\/rabbithole\/\?[^"]*)"/', $html, $all );
		return array_values( array_unique( array_map( $decode, array_merge( $own[1], $all[1] ) ) ) );
	}

	/**
	 * The track a song page plays in Rabbithole: the CID in its listen
	 * link's address, which is the only place the wiki says so (as
	 * Rabbithole itself reads it, src/wiki/api.js trackCidForSong).
	 *
	 * @param string[] $links addresses the page links to
	 */
	public static function trackIn( array $links ): string {
		foreach ( $links as $link ) {
			if ( preg_match( '#/rabbithole/\?(?:[^\#]*&)?track=([A-Za-z0-9]{30,100})(?:[&\#]|$)#', (string)$link, $m ) ) {
				return $m[1];
			}
		}
		return '';
	}

	/**
	 * What magenta said of a page's tiding (its api/wiki/tiding/), kept
	 * only where it is what was asked for: addresses under magenta's own,
	 * names and words as plain text, cut to size. Anything else is dropped,
	 * so nothing magenta sends is trusted as markup here.
	 *
	 * @param mixed $found the decoded answer
	 * @param string $magenta magenta's public address, e.g. https://magenta.cryptograss.live
	 * @return array|null null: not a tiding
	 */
	public static function tiding( $found, string $magenta ): ?array {
		$magenta = rtrim( $magenta, '/' );
		if ( !is_array( $found ) || !is_string( $found['tiding'] ?? null )
			|| !str_starts_with( $found['tiding'], $magenta . '/tidings/' )
		) {
			return null;
		}
		$said = [];
		foreach ( is_array( $found['recent'] ?? null ) ? $found['recent'] : [] as $row ) {
			if ( !is_array( $row ) || !is_string( $row['who'] ?? null ) || !is_string( $row['text'] ?? null ) ) {
				continue;
			}
			$text = trim( $row['text'] );
			$who = trim( $row['who'] );
			if ( $text === '' || $who === '' ) {
				continue;
			}
			$href = is_string( $row['href'] ?? null ) && str_starts_with( $row['href'], $magenta . '/' )
				? $row['href'] : $found['tiding'];
			$colour = is_string( $row['colour'] ?? null ) && preg_match( '/^#[0-9a-fA-F]{6}$/', $row['colour'] )
				? $row['colour'] : '';
			$said[] = [
				'who' => mb_substr( $who, 0, 60 ),
				'paragraphs' => self::paragraphs( $text, self::SAID_CHARS ),
				'href' => $href,
				'at' => is_string( $row['at'] ?? null ) && preg_match( '/^\d{4}-\d\d-\d\dT[\d:.+Z-]+$/', $row['at'] ) ? $row['at'] : '',
				'block' => is_numeric( $row['block'] ?? null ) ? (int)$row['block'] : 0,
				'emergent' => ( $row['kind'] ?? '' ) === 'emergent',
				'colour' => $colour,
			];
		}
		return [
			'url' => $found['tiding'],
			'title' => is_string( $found['title'] ?? null ) ? mb_substr( $found['title'], 0, 300 ) : '',
			'score' => is_numeric( $found['score'] ?? null ) ? (int)$found['score'] : 0,
			'comments' => is_numeric( $found['comments'] ?? null ) ? (int)$found['comments'] : 0,
			'said' => array_slice( $said, -8 ),
		];
	}

	/**
	 * Plain words as paragraphs, cut at $limit characters in all, at a
	 * word, with an ellipsis where they were cut.
	 *
	 * @return string[]
	 */
	public static function paragraphs( string $text, int $limit ): array {
		$text = trim( preg_replace( "/\r\n?/", "\n", $text ) );
		if ( mb_strlen( $text ) > $limit ) {
			$cut = mb_substr( $text, 0, $limit );
			$space = mb_strrpos( $cut, ' ' );
			$text = rtrim( $space > $limit / 2 ? mb_substr( $cut, 0, $space ) : $cut, " \n,;:" ) . '…';
		}
		$out = [];
		foreach ( preg_split( "/\n\s*\n/", $text ) ?: [] as $para ) {
			$para = trim( preg_replace( '/\s+/u', ' ', $para ) );
			if ( $para !== '' ) {
				$out[] = $para;
			}
		}
		return $out;
	}
}
