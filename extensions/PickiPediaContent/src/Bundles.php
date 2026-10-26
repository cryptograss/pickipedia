<?php
/**
 * The instructions the emergents of cryptograss were given, rebuilt here from
 * this wiki's own revisions (Special:EmergentBundles).
 *
 * Each turn an emergent is woken for, its runner gathers its instructions from
 * pages here (Cryptograss:Emergents/GeneralOrders, Cryptograss:Emergents/<Name>/Instructions,
 * a Mood's Instructions page) into one text, its system prompt, and magenta records
 * it (memory-lane poller/instructions.py, conversations/views_bundles.py):
 * not the text, but its parts -- the bundle's own words as strings, and in
 * each page's place only {page, revision} -- and the sha256 of the whole.
 * Justin, magent-self, 2026-10-24: "a list of every bundle action, somewhere
 * on pickipedia, with a button that lets me reconstruct and read the bundle".
 *
 * So the wiki rebuilds a bundle without asking magenta for its text: it
 * reads each revision itself, takes it as the bundler did (layerBody), joins
 * the parts, and checks the sha256. A match means this is, byte for byte,
 * what the emergent was told; a revision deleted since can't be had, and is
 * named. Nothing here needs a wiki, so tests/check-bundles.php can run it.
 */

namespace MediaWiki\Extension\PickiPediaContent;

final class Bundles {

	/** A record's id: magenta's, a uuid. */
	public const ID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

	/**
	 * A revision's wikitext as it goes into a bundle: less its <!-- comments -->,
	 * and stripped, as Python's str.strip() strips (instructions.layer_body).
	 */
	public static function layerBody( string $wikitext ): string {
		$text = preg_replace( '/<!--.*?-->/s', '', $wikitext );
		// Whitespace as Unicode means it (UCP), so U+00A0 and the like go as Python's strip() takes them.
		return preg_replace( '/(*UCP)^[\s\x{1c}-\x{1f}]+|[\s\x{1c}-\x{1f}]+$/u', '', $text ) ?? $text;
	}

	/**
	 * The revisions a record's parts name, in order.
	 *
	 * @param array $parts [string | ['page' => string, 'revision' => int]]
	 * @return int[]
	 */
	public static function revisions( array $parts ): array {
		$found = [];
		foreach ( $parts as $part ) {
			if ( is_array( $part ) && isset( $part['revision'] ) && is_int( $part['revision'] ) ) {
				$found[] = $part['revision'];
			}
		}
		return $found;
	}

	/**
	 * The bundle again, from its parts.
	 *
	 * @param array $parts As revisions() takes them
	 * @param callable $revisionText fn( int $revision ): ?string, the wikitext, null if it's gone
	 * @return array ['text' => ?string, 'missing' => int[]]
	 */
	public static function rebuild( array $parts, callable $revisionText ): array {
		$out = '';
		$missing = [];
		foreach ( $parts as $part ) {
			if ( is_string( $part ) ) {
				$out .= $part;
				continue;
			}
			$revision = is_array( $part ) ? ( $part['revision'] ?? null ) : null;
			$text = is_int( $revision ) ? $revisionText( $revision ) : null;
			if ( $text === null ) {
				$missing[] = $revision;
				continue;
			}
			$out .= self::layerBody( $text );
		}
		return [ 'text' => $missing ? null : $out, 'missing' => $missing ];
	}

	/** Whether $text is what the record says the emergent was given. */
	public static function matches( string $text, string $sha256 ): bool {
		return hash_equals( strtolower( $sha256 ), hash( 'sha256', $text ) );
	}
}
