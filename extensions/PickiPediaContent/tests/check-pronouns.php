<?php
/**
 * Pronouns (src/Pronouns.php): what a person may set, and what's refused.
 *
 * Run from the extension root:  php tests/check-pronouns.php
 */

require dirname( __DIR__ ) . '/src/Pronouns.php';

use MediaWiki\Extension\PickiPediaContent\Pronouns;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

foreach ( Pronouns::CHOICES as $choice ) {
	check( "$choice is offered and kept", Pronouns::clean( $choice ) === $choice );
}
check( 'it/its is among them (Justin, 26 Oct)', in_array( 'it/its', Pronouns::CHOICES, true ) );
check( 'their own words', Pronouns::clean( '  xe/xem ' ) === 'xe/xem' );
check( 'several', Pronouns::clean( 'she/they, any' ) === 'she/they, any' );
check( 'unsaid', Pronouns::clean( '' ) === '' );
foreach ( [ '[[User:X]]', '<b>he</b>', '{{tpl}}', "he\u{0007}him", '/him', str_repeat( 'a', 41 ) ] as $bad ) {
	check( 'refused: ' . json_encode( $bad ), Pronouns::clean( $bad ) === '', Pronouns::clean( $bad ) );
}

// MediaWiki's gender, for {{GENDER:}}, follows (its own field is hidden).
foreach ( [ 'he/him' => 'male', 'she/her' => 'female', 'they/them' => 'unknown', 'it/its' => 'unknown',
	'she/they' => 'female', 'He/Him' => 'male', 'xe/xem' => 'unknown', '' => 'unknown', 'hey/hem' => 'unknown' ] as $p => $g ) {
	check( "gender of '$p' is $g", Pronouns::genderFor( $p ) === $g, Pronouns::genderFor( $p ) );
}
check( 'a male gender starts as he/him', Pronouns::fromGender( 'male' ) === 'he/him' );
check( 'unknown starts unsaid', Pronouns::fromGender( 'unknown' ) === '' );

echo $failures === 0 ? "\nAll checks passed.\n" : "\n$failures FAILED\n";
exit( $failures === 0 ? 0 : 1 );
