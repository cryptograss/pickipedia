<?php
/**
 * A pale ground written in a stylesheet of ours is answered by night, or named here.
 *
 * This is the shape of the bug that keeps coming back. A stylesheet writes
 * MediaWiki's day palette -- #f8f9fa for a card, #fff for a row -- and by day
 * that is invisible against the page. By night the page goes dark and the ink
 * goes pale, but a ground written in CSS is not a ground night can see: it is
 * not a template's inline style, which night answers by its hex. So the box
 * stays lit and the words on it go to about 1.1:1. Special:DeliverOtherContent
 * was found that way (Justin, 23 Nov 2026), [[Template:ThinkingEntityInfo]]
 * before it (15 Nov), and there was no reason to think the next one would be
 * found any sooner.
 *
 * A stylesheet is not the only place one hides: Special:CreateInvite and its kin write theirs into
 * an inline <style> from PHP (OutputPage::addInlineStyle), and that was found the same way (Justin,
 * 25 Nov 2026). Those blocks are read here too.
 *
 * So: every class given a pale ground by a stylesheet of ours has to be named
 * in night.less, or be on the list below. The list is what was already unanswered
 * when this check was written -- a to-do, not an exemption. Take a name off it
 * when night learns that box; nothing is ever added.
 *
 * Broadside is left out: it has its own night (resources/skins.broadside).
 *
 * Run from the extension root:  php tests/check-night-grounds.php
 */

$root = dirname( __DIR__ );
$extensions = dirname( $root );

// Pale grounds night has not been taught yet. Shrink this; never grow it.
$known = [
	'btn-cancel',
	'btn-revert',
	'btn-toggle-mode',
	'btn-undo',
	'current-time-display',
	'editor-panel',
	'keyboard-help',
	'marker-row',
	'marker-time-input',
	'marker-yaml-editor',
	'musician-toggles',
	'pp-episode-art--none',
	'pp-ll-art',
	'pp-ll-chip',
	'pp-todo-problem',
	'pv-proposed--removal',
	'pv-verify-all__button',
	'raw-yaml-input',
	'timeline-editor',
];

/** How light a colour is, 0 to 1, as the eye weighs its parts. */
function lightness( string $hex ): float {
	$hex = ltrim( $hex, '#' );
	if ( strlen( $hex ) === 3 ) {
		$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
	}
	if ( strlen( $hex ) !== 6 ) {
		return 0.0;
	}
	$r = hexdec( substr( $hex, 0, 2 ) );
	$g = hexdec( substr( $hex, 2, 2 ) );
	$b = hexdec( substr( $hex, 4, 2 ) );
	return ( 0.2126 * $r + 0.7152 * $g + 0.0722 * $b ) / 255;
}

/**
 * Every bit of CSS of ours: each .css under an extension's resources, and each block of CSS a PHP
 * file writes into the page itself. Night's own and Broadside's are left out.
 *
 * @return array<string,string> what to call it => the CSS
 */
function sheets( string $extensions ): array {
	$found = [];
	$dir = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $extensions ) );
	foreach ( $dir as $file ) {
		$path = $file->getPathname();
		if ( str_contains( $path, '/night/' ) || str_contains( $path, '/skins.broadside/' ) ) {
			continue;
		}
		if ( substr( $path, -4 ) === '.css' && str_contains( $path, '/resources/' ) ) {
			$found[ basename( $path ) ] = file_get_contents( $path );
			continue;
		}
		if ( substr( $path, -4 ) !== '.php' ) {
			continue;
		}
		// addInlineStyle( '...' ): CSS written straight into the page, held in no stylesheet.
		$php = file_get_contents( $path );
		if ( !preg_match_all( "/addInlineStyle\(\s*'([^']*)'/s", $php, $blocks ) ) {
			continue;
		}
		$found[ basename( $path ) . ' (inline)' ] = implode( "\n", $blocks[1] );
	}
	ksort( $found );
	return $found;
}

$night = preg_replace( '#/\*.*?\*/#s', '', file_get_contents( "$root/resources/night/night.less" ) );

$failures = [];
$pale = 0;
foreach ( sheets( $extensions ) as $name => $source ) {
	$css = preg_replace( '#/\*.*?\*/#s', '', $source );
	if ( !preg_match_all( '/([^{}]+)\{([^}]*)\}/', $css, $rules, PREG_SET_ORDER ) ) {
		continue;
	}
	foreach ( $rules as $rule ) {
		$selector = trim( preg_replace( '/\s+/', ' ', $rule[1] ) );
		if ( $selector === '' || $selector[0] === '@' ) {
			continue;
		}
		if ( !preg_match_all( '/background(?:-color)?\s*:\s*([^;]+)/', $rule[2], $grounds ) ) {
			continue;
		}
		foreach ( $grounds[1] as $value ) {
			if ( !preg_match( '/#[0-9a-fA-F]{3,6}/', $value, $hex ) || lightness( $hex[0] ) <= 0.8 ) {
				continue;
			}
			if ( !preg_match_all( '/\.([a-zA-Z0-9_-]+)/', $selector, $classes ) ) {
				continue;
			}
			$pale++;
			foreach ( $classes[1] as $class ) {
				if ( str_contains( $night, ".$class" ) ) {
					continue 2;
				}
			}
			if ( in_array( $classes[1][0], $known, true ) ) {
				continue;
			}
			$failures[] = "  $name: $selector is {$hex[0]} by day, and night says nothing about it";
		}
	}
}

// A name taken off the list has to be taken out of it too, or the list rots.
foreach ( $known as $class ) {
	if ( str_contains( $night, ".$class" ) ) {
		$failures[] = "  night answers .$class now: take it off the list in this file";
	}
}

if ( $failures ) {
	echo "check-night-grounds.php FAILED\n" . implode( "\n", array_unique( $failures ) ) . "\n";
	echo "\nEither give the box night's colours in resources/night/night.less, or say why it stays pale there.\n";
	exit( 1 );
}

echo "check-night-grounds.php: $pale pale grounds, each answered by night or on the list of "
	. count( $known ) . " not yet answered.\n";
