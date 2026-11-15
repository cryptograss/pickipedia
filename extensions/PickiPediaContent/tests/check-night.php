<?php
/**
 * Night (src/Night.php, resources/night/night.less), without a wiki: what
 * counts as the reader's choice, and that the stylesheet is written so it
 * holds by day, by the system's night and by the reader's.
 *
 *   php tests/check-night.php
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts { class SkinBroadside { public const MODE_COOKIE = 'pickipedia-mode'; } }

namespace {
	require dirname( __DIR__ ) . '/src/Night.php';

	use MediaWiki\Extension\PickiPediaContent\Night;

	$failures = 0;
	function check( string $name, bool $ok, string $detail = '' ): void {
		global $failures;
		$failures += $ok ? 0 : 1;
		echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
	}
	$root = dirname( __DIR__ );

	echo "The reader's choice\n";
	check( 'dark is a choice', Night::chosen( 'dark' ) === 'dark' );
	check( 'so is light', Night::chosen( 'light' ) === 'light' );
	check( 'nothing is the system\'s', Night::chosen( '' ) === '' );
	check( 'and so is anything else a cookie might hold', Night::chosen( 'dark" onload="x' ) === '' && Night::chosen( 'Dark' ) === '' );
	check( 'a choice is what the browser is told', Night::scheme( 'dark' ) === 'dark' && Night::scheme( 'light' ) === 'light' );
	check( 'with none, both, and the system picks', Night::scheme( '' ) === 'light dark' );

	echo "\nThe stylesheet\n";
	$less = (string)file_get_contents( $root . '/resources/night/night.less' );
	$bare = preg_replace( '#/\*.*?\*/#s', '', $less );
	check( 'its rules are written once and set down twice: for the system, and for the choice',
		substr_count( $bare, '.night();' ) === 2
		&& (bool)preg_match( '/@media screen and \( prefers-color-scheme: dark \) \{\s*:root:not\( \.pp-light \) \{\s*\.night\(\);/', $bare )
		&& (bool)preg_match( '/:root\.pp-dark \{\s*\.night\(\);/', $bare ) );
	// By day MonoBook is as it was: nothing that colours is outside .night().
	$outside = preg_replace( '/\.night\(\) \{.*?\n\}\n/s', '', $bare );
	check( 'nothing is coloured outside them, so day is untouched',
		!preg_match( '/(^|[\s;{])(color|background(-color)?|border-color)\s*:/', $outside ), trim( $outside ) );
	// Its colours have names of their own: --pp-* are the Show gadget's, set on <body>, and would be taken back by day's.
	// The one place they are named is where night gives the gadget its own back.
	$notShow = preg_replace( '/body\.pickipedia-show \{.*?\}/s', '', $bare );
	check( "its colours don't share a name with the Show gadget's (--pp-*)",
		!str_contains( $notShow, '--pp-' ) && str_contains( $bare, 'body.pickipedia-show {' ) );
	// The minifier takes a plain space out of an attribute selector's string; "\20 " survives it.
	check( 'an ink written by hand is met with and without a space after its colon',
		str_contains( $less, '[style*="color:@{day}"], [style*="color:\\20 @{day}"]' ) );

	echo "\nOne choice, read everywhere\n";
	$cookie = 'pickipedia-mode';
	check( 'the switch keeps it in the cookie Broadside reads',
		str_contains( (string)file_get_contents( $root . '/resources/night/night.js' ), "var COOKIE = '$cookie';" )
		&& str_contains( (string)file_get_contents( $root . '/src/Posts/SkinBroadside.php' ), "MODE_COOKIE = '$cookie'" ) );
	$js = (string)file_get_contents( $root . '/resources/night/night.js' );
	check( 'and giving it up takes the cookie away, so the system is followed again',
		str_contains( $js, "COOKIE + '=; path=/; max-age=0" ) && str_contains( $js, "'content', 'light dark'" )
		&& str_contains( $less, '#pt-night-system[hidden] { display: none !important; }' ) );
	$graph = dirname( $root, 2 ) . '/assets/connectome/';
	check( "the connectome's graph reads it before it paints",
		str_contains( (string)file_get_contents( $graph . 'index.html' ), "$cookie=(dark|light)" ) );
	$css = (string)file_get_contents( $graph . 'connectome.css' );
	check( 'and follows the system when there is none',
		str_contains( $css, 'color-scheme: light dark;' ) && str_contains( $css, ':root.pp-dark { color-scheme: dark; }' )
		&& str_contains( $css, ':root.pp-light { color-scheme: light; }' ) );

	echo $failures ? "\ncheck-night.php: $failures FAILED\n" : "\ncheck-night.php: all ok\n";
	exit( $failures ? 1 : 0 );
}
