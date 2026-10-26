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

echo $failures === 0 ? "\nAll checks passed.\n" : "\n$failures FAILED\n";
exit( $failures === 0 ? 0 : 1 );
