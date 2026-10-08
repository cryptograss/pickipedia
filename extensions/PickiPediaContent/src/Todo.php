<?php
/**
 * <todo>: a to-do list kept as YAML, shown as a checklist.
 *
 * Each magenta Mood keeps a running list of what its people have to do at
 * Cryptograss:Moods/<slug>/todo (memory-lane services/todo.py), and magenta
 * shows it beside the Mood. It is YAML, so agents can keep it current and
 * magenta can read it:
 *
 *     <todo>
 *     - task: Merge memory-lane#117
 *       who: justin
 *       kind: merge
 *       link: https://github.com/jMyles/memory-lane/pull/117
 *       note: optional
 *       done: false
 *     </todo>
 *
 * Inside <pre> it read as YAML here too, with nothing a reader could click.
 * This tag shows it as a checklist instead: a task with a link is the link
 * (a web address, a page here, or a magenta Mood or message), done items are
 * folded away, and a list that cannot be read says where, over the text.
 *
 * render() is the whole of it and needs no wiki, so tests/check-todo.php can
 * run it; the hook only supplies how a link becomes an address.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

class Todo {

	public const MAGENTA = 'https://magenta.cryptograss.live';

	/**
	 * The list as HTML.
	 *
	 * @param string $text The YAML between the tags.
	 * @param callable $hrefFor string $link -> ?string address, or null for no link.
	 * @return string Escaped HTML, safe to return from a tag hook.
	 */
	public static function render( string $text, callable $hrefFor ): string {
		try {
			$items = Yaml::parse( trim( $text ) );
		} catch ( ParseException $e ) {
			$line = $e->getParsedLine();
			return self::problem( 'This list\'s YAML has a problem' . ( $line > 0 ? " at line $line" : '' )
				. ': ' . $e->getMessage(), $text );
		}
		if ( $items === null ) {
			$items = [];
		}
		if ( !is_array( $items ) || !array_is_list( $items ) ) {
			return self::problem( 'This list\'s YAML should be a list, each item starting "- task: ..."', $text );
		}
		$open = [];
		$done = [];
		foreach ( $items as $raw ) {
			if ( is_string( $raw ) ) {
				$raw = [ 'task' => $raw ];
			}
			if ( !is_array( $raw ) || !is_scalar( $raw['task'] ?? null ) || trim( (string)$raw['task'] ) === '' ) {
				continue;
			}
			if ( !empty( $raw['done'] ) ) {
				$done[] = self::item( $raw, $hrefFor );
			} else {
				$open[] = self::item( $raw, $hrefFor );
			}
		}
		$html = '<div class="pp-todo">';
		$html .= $open
			? '<ul class="pp-todo-open">' . implode( '', $open ) . '</ul>'
			: '<p class="pp-todo-empty">Nothing to do.</p>';
		if ( $done ) {
			$html .= '<details class="pp-todo-done"><summary>Done (' . count( $done ) . ')</summary>'
				. '<ul>' . implode( '', $done ) . '</ul></details>';
		}
		return $html . '</div>';
	}

	/**
	 * One item: its box, its task (a link, if it has one), who and what kind, its note.
	 *
	 * @param array $raw The item as parsed.
	 * @param callable $hrefFor As for render().
	 * @return string
	 */
	private static function item( array $raw, callable $hrefFor ): string {
		$task = htmlspecialchars( trim( (string)$raw['task'] ) );
		$link = is_scalar( $raw['link'] ?? null ) ? trim( (string)$raw['link'] ) : '';
		$href = $link !== '' ? $hrefFor( $link ) : null;
		if ( $href !== null ) {
			$external = preg_match( '#^https?://#i', $href ) === 1;
			$task = '<a href="' . htmlspecialchars( $href ) . '"'
				. ( $external ? ' class="external" rel="nofollow"' : '' ) . '>' . $task . '</a>';
		}
		$who = $raw['who'] ?? [];
		if ( is_string( $who ) ) {
			$who = explode( ',', $who );
		}
		$who = array_values( array_filter( array_map(
			static fn ( $w ) => is_scalar( $w ) ? trim( (string)$w ) : '',
			is_array( $who ) ? $who : []
		) ) );
		$kind = is_scalar( $raw['kind'] ?? null ) ? trim( (string)$raw['kind'] ) : '';
		$meta = array_values( array_filter( [ $kind, implode( ', ', $who ) ] ) );
		$note = is_scalar( $raw['note'] ?? null ) ? trim( (string)$raw['note'] ) : '';
		return '<li class="pp-todo-item"><span class="pp-todo-box">' . ( empty( $raw['done'] ) ? '☐' : '☑' ) . '</span>'
			. '<div class="pp-todo-text"><span class="pp-todo-task">' . $task . '</span>'
			. ( $meta ? '<div class="pp-todo-meta">' . htmlspecialchars( implode( ' · ', $meta ) ) . '</div>' : '' )
			. ( $note !== '' ? '<div class="pp-todo-note">' . htmlspecialchars( $note ) . '</div>' : '' )
			. '</div></li>';
	}

	/**
	 * A list that can't be read: why, then the text as it is.
	 *
	 * @param string $why
	 * @param string $text
	 * @return string
	 */
	private static function problem( string $why, string $text ): string {
		return '<div class="pp-todo pp-todo-problem"><p class="error">' . htmlspecialchars( $why ) . '</p>'
			. '<pre>' . htmlspecialchars( trim( $text ) ) . '</pre></div>';
	}

	/**
	 * Where a link field goes, from a page: a web address as it is; "#m-<id>"
	 * (a magenta message) and "#<slug>" (a Mood) in magenta -- a message in the
	 * Mood whose list this is; anything else, a page here.
	 *
	 * @param string $link The link field.
	 * @param string $pageTitle The page the list is on, prefixed ("Cryptograss:Moods/x/todo").
	 * @param callable $pageUrl string $title -> ?string, for a page here.
	 * @return string|null
	 */
	public static function hrefFrom( string $link, string $pageTitle, callable $pageUrl ): ?string {
		if ( preg_match( '#^https?://\S+$#i', $link ) ) {
			return $link;
		}
		if ( preg_match( '/^#m-[0-9a-f-]{8,36}$/i', $link ) ) {
			$slug = preg_match( '#^Cryptograss:Moods/([^/]+)/todo$#i', str_replace( '_', ' ', $pageTitle ), $m )
				? rawurlencode( $m[1] ) : null;
			return $slug ? self::MAGENTA . "/moods/$slug/" . $link : null;
		}
		if ( preg_match( '/^#([\w-]+)$/', $link, $m ) ) {
			return self::MAGENTA . '/moods/' . rawurlencode( $m[1] ) . '/';
		}
		return $pageUrl( $link );
	}
}
