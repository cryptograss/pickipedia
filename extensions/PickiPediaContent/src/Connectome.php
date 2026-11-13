<?php
/**
 * {{#connectome:}}: the connectome card on a musician's page (Justin, #connectome, 13 Nov 2026), put there by
 * Template:MusicianInfo.
 *
 * The cards are drawn at deploy, by tools/connectome_card.py from the connectome store, one file per page under
 * assets/connectome/cards/, named by the md5 of the page's title. Here a card is only read and put into the page
 * as it is: an inline SVG can't pass through wikitext (the sanitizer drops it), and nothing a reader or editor
 * writes reaches the file -- the builder escapes every name and title it draws. A page the store doesn't know
 * gets nothing, not an empty box.
 */

namespace MediaWiki\Extension\PickiPediaContent;

class Connectome {

	/** How every card the builder writes begins; anything else in the folder is not a card. */
	public const OPENING = '<div class="connectome-card"';

	/** Where the builder keeps the cards, under the wiki's root. */
	public static function dir(): string {
		$root = defined( 'MW_INSTALL_PATH' ) ? MW_INSTALL_PATH : ( $GLOBALS['IP'] ?? '' );
		return rtrim( (string)$root, '/' ) . '/assets/connectome/cards';
	}

	/** The file that holds a page's card. */
	public static function fileFor( string $dir, string $title ): string {
		return rtrim( $dir, '/' ) . '/' . md5( $title ) . '.html';
	}

	/** A page's card, as HTML; '' when the store has none for it. */
	public static function cardFor( string $dir, string $title ): string {
		if ( $title === '' ) {
			return '';
		}
		$file = self::fileFor( $dir, $title );
		if ( !is_file( $file ) ) {
			return '';
		}
		$html = file_get_contents( $file );
		if ( !is_string( $html ) || strncmp( $html, self::OPENING, strlen( self::OPENING ) ) !== 0 ) {
			return '';
		}
		return $html;
	}
}
