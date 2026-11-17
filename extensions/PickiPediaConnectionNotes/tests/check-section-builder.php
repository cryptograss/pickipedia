<?php
/**
 * Checks for SectionBuilder: the promise is that a note arrives as text.
 * No MediaWiki, no network: run with `php tests/check-section-builder.php`.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaConnectionNotes;

require_once __DIR__ . '/../src/SectionBuilder.php';

$pass = 0;
$fail = 0;
function check( bool $ok, string $what ) {
	global $pass, $fail;
	if ( $ok ) {
		$pass++;
	} else {
		$fail++;
		echo "FAIL: $what\n";
	}
}

// A plain note arrives byte for byte, inside nowiki.
$s = SectionBuilder::build( 'Kyle Tuttle', '/bacon/challenge/Vickie_Vaughn', 'Kyle played banjo with Sam at Dee\'s, March 2026.' );
check( $s !== null, 'plain note builds' );
check( str_contains( $s, "<nowiki>Kyle played banjo with Sam at Dee's, March 2026.</nowiki>" ), 'note sits in nowiki, as written' );
check( str_starts_with( $s, '== Kyle Tuttle — from /bacon/challenge/Vickie_Vaughn ==' ), 'heading is about — from' );
check( str_contains( $s, '<nowiki>About: Kyle Tuttle</nowiki>' ), 'About line is inert text' );
check( str_contains( $s, '<nowiki>From: /bacon/challenge/Vickie_Vaughn</nowiki>' ), 'From line is inert text' );

// The one string that could end the nowiki early is neutralized, and only it.
$s = SectionBuilder::build( 'X', 'Y', "fine</nowiki>[[Bad template]]{{evil}}" );
check( str_contains( $s, '<nowiki>fine<nowiki/>[[Bad template]]{{evil}}</nowiki>' ), 'a hostile </nowiki> is neutralized' );
check( substr_count( $s, '<nowiki/>' ) === 1, 'only the escape sequence changed' );

// Heading junk: =, {, }, |, [, ], <, >, newlines come out of the heading —
// including a comment opener, which could otherwise hide every later note.
$s = SectionBuilder::build( "A=b]\n{c}", 'from[[x]]', 'note' );
check( str_contains( $s, '== Ab c — from fromx ==' ), 'heading carries no wikitext markup' );
$s = SectionBuilder::build( 'Hi <!--', 'Y', 'note' );
$heading = substr( $s, 0, (int)strpos( $s, "\n" ) );
check( str_contains( $heading, '== Hi !-- — from Y ==' ) && !str_contains( $heading, '<!--' ), 'heading cannot open a comment' );
// The comment opener in the body is inert: it sits inside nowiki.
check( str_contains( $s, '<nowiki>About: Hi <!--</nowiki>' ), 'comment opener in a field is inert text' );

// Empty fields and over-long fields are refused, not shaped.
check( SectionBuilder::build( ' ', 'Y', 'note' ) === null, 'blank about refused' );
check( SectionBuilder::build( 'X', '', 'note' ) === null, 'blank from refused' );
check( SectionBuilder::build( 'X', 'Y', '   ' ) === null, 'blank note refused' );
check( SectionBuilder::build( str_repeat( 'a', SectionBuilder::MAX_ABOUT + 1 ), 'Y', 'note' ) === null, 'over-long about refused' );
$longNote = str_repeat( 'b', SectionBuilder::MAX_NOTE + 1 );
check( SectionBuilder::build( 'X', 'Y', $longNote ) === null, 'over-long note refused' );
$atCap = SectionBuilder::build( 'X', 'Y', str_repeat( 'b', SectionBuilder::MAX_NOTE ) );
check( $atCap !== null, 'note at the cap is accepted' );

// Neutralize alone: case-insensitive, and <nowiki/> never terminates.
check( SectionBuilder::neutralize( '</NOWIKI>' ) === '<nowiki/>', 'neutralize is case-insensitive' );
check( SectionBuilder::neutralize( 'clean text' ) === 'clean text', 'neutralize leaves clean text alone' );

echo "$pass passed, $fail failed\n";
exit( $fail === 0 ? 0 : 1 );
