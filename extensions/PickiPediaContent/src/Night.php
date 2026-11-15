<?php
/**
 * Night: the wiki by dark, on every skin but Broadside, which is its own.
 *
 * The reader's choice of day or night is one cookie, Broadside's
 * (SkinBroadside::MODE_COOKIE), and it is on <html> from the first byte
 * (pp-dark, pp-light), so a page chosen dark never paints light. With no
 * choice made, the stylesheet follows the reader's system
 * (resources/night/night.less), and nothing is put on <html>.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\Extension\PickiPediaContent\Posts\SkinBroadside;
use MediaWiki\Output\OutputPage;

class Night {

	/** 'dark', 'light', or '' for whatever the reader's system says. */
	public static function mode( \MediaWiki\Request\WebRequest $request ): string {
		return self::chosen( (string)$request->getCookie( SkinBroadside::MODE_COOKIE, '', '' ) );
	}

	/** A cookie's value as a choice: only the two words count. */
	public static function chosen( string $cookie ): string {
		return in_array( $cookie, [ 'dark', 'light' ], true ) ? $cookie : '';
	}

	/** What <meta name="color-scheme"> says for a choice: the choice, or both for the system's. */
	public static function scheme( string $mode ): string {
		return $mode !== '' ? $mode : 'light dark';
	}

	public static function onPage( OutputPage $out, \Skin $skin ): void {
		if ( $skin->getSkinName() === 'broadside' ) {
			return;
		}
		$mode = self::mode( $out->getRequest() );
		if ( $mode !== '' ) {
			$out->addHtmlClasses( 'pp-' . $mode );
		}
		$out->addMeta( 'color-scheme', self::scheme( $mode ) );
		$out->addModuleStyles( [ 'ext.pickipediaContent.night.styles' ] );
		$out->addModules( [ 'ext.pickipediaContent.night' ] );
	}
}
