<?php
/**
 * <moodlinks>: the magenta messages that link pages here, and each page's
 * "Linked from magenta" at its foot.
 *
 * magenta keeps a ledger for each Mood and month, at
 * Cryptograss:Moods/<mood>/links/<YYYY-MM> (memory-lane
 * services/wiki_ledger.py, written by its bot): every page a message links,
 * with the message, who said it, when, and its first words, as YAML:
 *
 *     <moodlinks>
 *     - page: Bill Monroe
 *       message: 0f132ada-…
 *       who: justin
 *       when: 2026-10-19T15:44:12Z
 *       block: 23612345
 *       words: Is Bill Monroe on the page yet?
 *     </moodlinks>
 *
 * On the ledger page the tag shows those rows, and records a link to each
 * page, so the wiki's own link table knows which ledgers name which page. A
 * page viewed looks there for ledgers linking it (Hooks::onSkinAfterContent)
 * and lists their rows for it at its foot, each going to its message in
 * magenta. So the links live here, on the wiki (Justin, 19 Oct 2026), and a
 * page shows them without asking magenta anything.
 *
 * Everything but finding the ledgers and reading them needs no wiki, so
 * tests/check-moodlinks.php can run it.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

class MoodLinks {

	/** Ledgers live at Cryptograss:Moods/<mood>/links/<YYYY-MM>. */
	public const PREFIX = 'Moods/';
	public const INFIX = '/links/';

	/** Rows shown at a page's foot, newest first; the rest are counted. */
	public const SHOWN = 12;

	/**
	 * The Mood a ledger page is for, or null if the page isn't one.
	 *
	 * @param int $namespace
	 * @param string $dbKey The title without its namespace, underscores or spaces
	 * @return string|null
	 */
	public static function moodOf( int $namespace, string $dbKey ): ?string {
		if ( $namespace !== Todo::NAMESPACE ) {
			return null;
		}
		return preg_match( '#^Moods/([^/]+)/links/\d{4}-\d{2}$#', str_replace( ' ', '_', $dbKey ), $m )
			? $m[1] : null;
	}

	/**
	 * The rows of a ledger: each with page, message and who; when, block and words if given.
	 * Rows without a page, a message id or who are left out.
	 *
	 * @param string $text The YAML between the tags.
	 * @return array[]|null Null if the YAML can't be read.
	 */
	public static function rows( string $text ): ?array {
		try {
			$items = Yaml::parse( trim( $text ) );
		} catch ( ParseException $e ) {
			return null;
		}
		if ( $items === null ) {
			return [];
		}
		if ( !is_array( $items ) || !array_is_list( $items ) ) {
			return null;
		}
		$rows = [];
		foreach ( $items as $raw ) {
			if ( !is_array( $raw ) ) {
				continue;
			}
			$field = static fn ( string $key ) => is_scalar( $raw[$key] ?? null ) ? trim( (string)$raw[$key] ) : '';
			$row = [ 'page' => $field( 'page' ), 'message' => $field( 'message' ), 'who' => $field( 'who' ),
				'when' => $field( 'when' ), 'block' => $field( 'block' ), 'words' => $field( 'words' ) ];
			if ( $row['page'] === '' || $row['who'] === '' || !preg_match( '/^[0-9a-f-]{8,36}$/i', $row['message'] ) ) {
				continue;
			}
			$rows[] = $row;
		}
		return $rows;
	}

	/**
	 * The YAML inside a ledger page's <moodlinks>, or '' if it has none.
	 *
	 * @param string $wikitext
	 * @return string
	 */
	public static function body( string $wikitext ): string {
		return preg_match( '#<moodlinks>(.*?)</moodlinks>#is', $wikitext, $m ) ? $m[1] : '';
	}

	/**
	 * A message's address in magenta.
	 *
	 * @param string $mood
	 * @param string $message
	 * @return string
	 */
	public static function messageUrl( string $mood, string $message ): string {
		return Todo::MAGENTA . '/moods/' . rawurlencode( $mood ) . '/#m-' . rawurlencode( $message );
	}

	/**
	 * When, as a reader wants it: "19 Oct 2026, 15:44 UTC". As given if it isn't a time.
	 *
	 * @param string $when
	 * @return string
	 */
	public static function when( string $when ): string {
		$t = $when !== '' ? strtotime( $when ) : false;
		return $t === false ? $when : gmdate( 'j M Y, H:i', $t ) . ' UTC';
	}

	/**
	 * The ledger page itself: its rows as a list.
	 *
	 * @param string $text The YAML between the tags.
	 * @param string $mood The Mood the ledger is for ('' if the page isn't a ledger).
	 * @param callable $pageUrl string $title -> ?string, for a page here.
	 * @return string Escaped HTML, safe to return from a tag hook.
	 */
	public static function render( string $text, string $mood, callable $pageUrl ): string {
		$rows = self::rows( $text );
		if ( $rows === null ) {
			return '<div class="pp-moodlinks"><p class="error">This ledger\'s YAML can\'t be read.</p>'
				. '<pre>' . htmlspecialchars( trim( $text ) ) . '</pre></div>';
		}
		if ( !$rows ) {
			return '<div class="pp-moodlinks"><p>No links this month.</p></div>';
		}
		$items = [];
		foreach ( $rows as $row ) {
			$href = $pageUrl( $row['page'] );
			$page = $href !== null
				? '<a href="' . htmlspecialchars( $href ) . '">' . htmlspecialchars( $row['page'] ) . '</a>'
				: htmlspecialchars( $row['page'] );
			$items[] = '<li>' . $page . ' ← ' . self::said( $row, $mood ) . '</li>';
		}
		return '<div class="pp-moodlinks"><ul>' . implode( '', $items ) . '</ul></div>';
	}

	/**
	 * A page's foot: the messages linking it, newest first.
	 *
	 * @param array[] $rows Rows for this page, each with its 'mood'.
	 * @param string $heading
	 * @return string Escaped HTML; '' if there are none.
	 */
	public static function footer( array $rows, string $heading ): string {
		if ( !$rows ) {
			return '';
		}
		usort( $rows, static fn ( $a, $b ) => strcmp( $b['when'], $a['when'] ) );
		$items = array_map( static fn ( $row ) => '<li>' . self::said( $row, $row['mood'], true ) . '</li>',
			array_slice( $rows, 0, self::SHOWN ) );
		$more = count( $rows ) - self::SHOWN;
		return '<div class="pp-moodlinks pp-moodlinks-foot"><h2>' . htmlspecialchars( $heading ) . '</h2>'
			. '<ul>' . implode( '', $items ) . '</ul>'
			. ( $more > 0 ? '<p class="pp-moodlinks-more">and ' . $more . ' more</p>' : '' )
			. '</div>';
	}

	/**
	 * One message: who, where and when, going to it in magenta; then its first words.
	 *
	 * @param array $row
	 * @param string $mood
	 * @param bool $where Name the Mood (at a page's foot; a ledger is one Mood's).
	 * @return string
	 */
	private static function said( array $row, string $mood, bool $where = false ): string {
		$label = $row['who'] . ( $where ? ' in #' . $mood : '' ) . ( $row['when'] !== '' ? ', ' . self::when( $row['when'] ) : '' );
		$link = $mood !== ''
			? '<a class="external" rel="nofollow" href="' . htmlspecialchars( self::messageUrl( $mood, $row['message'] ) ) . '">'
				. htmlspecialchars( $label ) . '</a>'
			: htmlspecialchars( $label );
		return $link . ( $row['words'] !== ''
			? ': <span class="pp-moodlinks-words">“' . htmlspecialchars( $row['words'] ) . '”</span>' : '' );
	}
}
