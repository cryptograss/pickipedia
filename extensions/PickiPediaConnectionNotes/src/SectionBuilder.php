<?php
/**
 * Shapes a connection note into one Talk page section.
 *
 * The note arrives as text and stays text: the body sits inside <nowiki>,
 * and the one string that could end the nowiki early — "</nowiki>" — is
 * neutralized on the way in. That is the only byte the tool changes; every
 * other character is copied as written.
 *
 * The heading and the About/From lines carry no live wikitext either: the
 * heading loses the markup characters (={}|[]<>), and every line of the body
 * is inside its own <nowiki>, so a template or link in a field is text a
 * person reads, never something the page runs.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaConnectionNotes;

class SectionBuilder {

	/** Field caps. The note is long; the rest are titles. */
	public const MAX_ABOUT = 200;
	public const MAX_FROM = 200;
	public const MAX_NOTE = 2000;

	/**
	 * Neutralize "</nowiki>" so the note cannot terminate its own nowiki.
	 * "<nowiki/>" is self-contained and does not close the enclosing block.
	 */
	public static function neutralize( string $text ): string {
		return preg_replace( '#</nowiki>#i', '<nowiki/>', $text );
	}

	/** A section heading may not carry =, {, }, |, [, ], < or >, or newlines. */
	public static function heading( string $about, string $from ): string {
		$clean = static function ( string $s ): string {
			$s = str_replace( [ "\n", "\r" ], ' ', $s );
			return trim( preg_replace( '/[={}|\\[\\]<>]/u', '', $s ) );
		};
		return $clean( $about ) . ' — from ' . $clean( $from );
	}

	/** One body line as inert text. */
	private static function line( string $label, string $value ): string {
		return '<nowiki>' . $label . ': ' . self::neutralize( trim( $value ) ) . '</nowiki>';
	}

	/**
	 * The whole section: heading, the fields as written, the note in nowiki.
	 *
	 * @return string|null null when a field is missing or over its cap.
	 */
	public static function build( string $about, string $from, string $note ): ?string {
		foreach ( [ $about, $from, $note ] as $field ) {
			if ( trim( $field ) === '' ) {
				return null;
			}
		}
		if ( mb_strlen( $about ) > self::MAX_ABOUT ||
			mb_strlen( $from ) > self::MAX_FROM ||
			mb_strlen( $note ) > self::MAX_NOTE ) {
			return null;
		}

		$heading = self::heading( $about, $from );
		$body = self::line( 'About', $about ) . "\n"
			. self::line( 'From', $from ) . "\n\n"
			. '<nowiki>' . self::neutralize( $note ) . '</nowiki>';

		return "== $heading ==\n\n" . $body . "\n";
	}
}
