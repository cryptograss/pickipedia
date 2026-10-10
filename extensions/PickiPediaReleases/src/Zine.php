<?php
/**
 * The zine look for user subpages (User:Name/Post): corner logo, topbar,
 * hero with the post's title, and a light/dark toggle.
 *
 * This used to be built in the browser by MediaWiki:Common.js, after the
 * page had already painted as an ordinary wiki page, so every post flashed
 * the default skin before turning into itself. Now the server sends the page
 * already dressed: the body classes that switch the stylesheet on, and the
 * elements the script used to insert. What's left for JavaScript is clicking
 * the toggle (ext.pickipediaReleases.zine.js).
 *
 * render() is plain PHP with no MediaWiki calls, so tests/check-zine.php can
 * run it without a wiki.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\Output\OutputPage;

class Zine {

	/** Remembers the reader's choice so the server can paint dark too. */
	public const MODE_COOKIE = 'pickipedia-mode';

	public const LOGO_URL = '/images/thumb/8/80/Pickipedia-quarter-transparent.png/400px-Pickipedia-quarter-transparent.png';

	/**
	 * Is this a user subpage being read? The same test the script made:
	 * User namespace, a slash in the title, the plain view.
	 */
	public static function applies( OutputPage $out ): bool {
		$title = $out->getTitle();
		return $title
			&& $title->getNamespace() === NS_USER
			&& str_contains( $title->getText(), '/' )
			&& $out->getActionName() === 'view';
	}

	/**
	 * "masthead" or "letter", from the page's categories or a
	 * `pickipedia:variant=` marker in its HTML. Categories win.
	 *
	 * @param string $html
	 * @param string[] $categories names, with spaces or underscores
	 */
	public static function variant( string $html, array $categories ): string {
		$variant = 'letter';
		if ( preg_match( '/pickipedia:variant\s*=\s*(letter|masthead)/i', $html, $m ) ) {
			$variant = strtolower( $m[1] );
		}
		$categories = array_map( static fn ( $c ) => str_replace( '_', ' ', (string)$c ), $categories );
		if ( in_array( 'Masthead style', $categories, true ) ) {
			$variant = 'masthead';
		}
		if ( in_array( 'Letter style', $categories, true ) ) {
			$variant = 'letter';
		}
		return $variant;
	}

	/**
	 * Body classes for the stylesheet. Present in the first byte of the
	 * page, which is the whole point.
	 *
	 * @return string[]
	 */
	public static function bodyClasses( string $variant, bool $dark ): array {
		$classes = [ 'pickipedia-userpost', 'pickipedia-variant-' . $variant ];
		if ( $dark ) {
			$classes[] = 'pickipedia-dark';
		}
		return $classes;
	}

	/**
	 * The logo, topbar, hero and toggle, as HTML to go at the top of the
	 * page content.
	 *
	 * Every element carries `pp-server`, so the stylesheet can tell these
	 * from copies an old MediaWiki:Common.js still inserts, and hide those
	 * until the page is emptied.
	 *
	 * @param array $p username, subpage, variant, dark, homeUrl, editUrl,
	 *   historyUrl, talkUrl, userUrl
	 */
	public static function render( array $p ): string {
		$e = static fn ( $s ) => htmlspecialchars( (string)$s, ENT_QUOTES );

		$logo = '<a class="pp-corner-logo pp-server" href="' . $e( $p['homeUrl'] ) . '" title="PickiPedia home">'
			. '<img src="' . $e( self::LOGO_URL ) . '" alt="PickiPedia"></a>';

		$topbar = '<header class="pickipedia-topbar pp-server"><nav class="pickipedia-topbar-nav">'
			. '<a href="' . $e( $p['editUrl'] ) . '">edit</a>'
			. '<a href="' . $e( $p['historyUrl'] ) . '">history</a>'
			. '<a href="' . $e( $p['talkUrl'] ) . '">talk</a>'
			. '</nav></header>';

		$kicker = '<div class="pp-kicker"><a href="' . $e( $p['userUrl'] ) . '">User:' . $e( $p['username'] ) . '</a></div>';
		$title = '<h1 class="pp-title">' . $e( $p['subpage'] ) . '</h1>';

		if ( $p['variant'] === 'masthead' ) {
			$hero = '<div class="pp-topbar">' . $kicker . '<div class="pp-topbar-rule"></div></div>'
				. '<div class="pp-titlewrap">' . $title . '</div>';
		} else {
			$hero = $title . $kicker;
		}
		$hero = '<header class="pickipedia-hero pp-server">' . $hero . '</header>';

		$toggle = '<button class="pickipedia-mode pp-server" type="button">'
			. ( $p['dark'] ? '☼ Light' : '☾ Dark' ) . '</button>';

		return $logo . $topbar . $hero . $toggle;
	}

	/**
	 * Dress the page. Called from Hooks::onBeforePageDisplay when applies().
	 */
	public static function addTo( OutputPage $out ): void {
		$title = $out->getTitle();
		$text = $title->getText();
		$slash = strpos( $text, '/' );
		$username = substr( $text, 0, $slash );

		$variant = self::variant( $out->getHTML(), $out->getCategories() );
		$dark = $out->getRequest()->getCookie( self::MODE_COOKIE, '' ) === 'dark';

		$out->addBodyClasses( self::bodyClasses( $variant, $dark ) );
		$out->prependHTML( self::render( [
			'username' => $username,
			'subpage' => substr( $text, $slash + 1 ),
			'variant' => $variant,
			'dark' => $dark,
			'homeUrl' => \MediaWiki\Title\Title::newMainPage()->getLocalURL(),
			'editUrl' => $title->getLocalURL( [ 'action' => 'edit' ] ),
			'historyUrl' => $title->getLocalURL( [ 'action' => 'history' ] ),
			'talkUrl' => $title->getTalkPageIfDefined()?->getLocalURL() ?? '',
			'userUrl' => \MediaWiki\Title\Title::makeTitle( NS_USER, $username )->getLocalURL(),
		] ) );

		$out->addModuleStyles( 'ext.pickipediaReleases.zine.styles' );
		$out->addModules( 'ext.pickipediaReleases.zine' );
	}
}
