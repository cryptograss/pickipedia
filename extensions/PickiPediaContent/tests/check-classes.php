<?php
/**
 * The Lua and the stylesheet have to agree on class names.
 *
 * This is the seam the split creates. Putting presentation in a stylesheet and
 * markup in a module is the right shape, but it means a class name now lives
 * in two files, and renaming it in one of them fails silently: the page still
 * renders, the icons just quietly lose their styling. Nothing in a wiki
 * catches that — the whole point of moving this into the repository is that
 * something here can.
 *
 * Run from the extension root:  php tests/check-classes.php
 */

$root = dirname( __DIR__ );

/** Class names this extension's Lua emits, from class="..." attributes. */
function emittedClasses( string $dir ): array {
	$found = [];
	foreach ( glob( "$dir/*.lua" ) ?: [] as $file ) {
		$source = file_get_contents( $file );
		// class="a b c" and class="' .. concat .. '" — take the literal
		// names out of both, since a built list still starts with one.
		if ( preg_match_all( '/class="([^"\'\\\\]*)/', $source, $matches ) ) {
			foreach ( $matches[1] as $literal ) {
				foreach ( preg_split( '/\s+/', trim( $literal ) ) as $name ) {
					if ( $name !== '' ) {
						$found[ $name ] = true;
					}
				}
			}
		}
		// Names pushed into a class list: table.insert( classes, "pp-..." )
		if ( preg_match_all( '/"(pp-[a-z0-9_-]+)"/', $source, $matches ) ) {
			foreach ( $matches[1] as $name ) {
				$found[ $name ] = true;
			}
		}
	}
	return array_keys( $found );
}

/** Class names the stylesheet defines. */
function definedClasses( string $file ): array {
	$css = file_get_contents( $file );
	// Ignore comments, so prose mentioning a class is not a definition.
	$css = preg_replace( '#/\*.*?\*/#s', '', $css );
	preg_match_all( '/\.([a-zA-Z0-9_-]+)/', $css, $matches );
	return array_values( array_unique( $matches[1] ) );
}

$emitted = emittedClasses( "$root/lua/pickipedia" );
$defined = definedClasses( "$root/resources/ext.pickipediaContent.css" );

$failures = [];

sort( $emitted );
foreach ( $emitted as $name ) {
	if ( !in_array( $name, $defined, true ) ) {
		$failures[] = "  emitted by Lua but not styled: .$name";
	}
}

// No doubled underscores, however tempting BEM is. MediaWiki breaks "__" up
// in its output so it cannot be read as a behaviour switch like __NOTOC__,
// and the class arrives as pp-instrument&#95;_box. Browsers decode that and
// the rule still matches, which is exactly the problem: it works until
// something in the chain stops decoding, and nothing here would notice.
foreach ( $emitted as $name ) {
	if ( str_contains( $name, '__' ) ) {
		$failures[] = "  doubled underscore, which MediaWiki mangles: .$name";
	}
}

// And the other way. A rule for markup nothing produces any more is worse
// than no rule, because the next person cannot tell which half is live.
sort( $defined );
foreach ( $defined as $name ) {
	if ( !in_array( $name, $emitted, true ) ) {
		$failures[] = "  styled but nothing emits it: .$name";
	}
}

if ( $failures ) {
	echo "check-classes.php FAILED\n";
	echo implode( "\n", $failures ) . "\n";
	exit( 1 );
}

printf(
	"check-classes.php: %d classes, emitted and styled, agree.\n",
	count( $emitted )
);
exit( 0 );
