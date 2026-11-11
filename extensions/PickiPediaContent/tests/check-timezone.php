<?php
/**
 * Time zones (src/TimeZone.php): what MediaWiki's time offset preference says, read as a zone.
 *
 * Run from the extension root:  php tests/check-timezone.php
 */

require dirname( __DIR__ ) . '/src/TimeZone.php';

use MediaWiki\Extension\PickiPediaContent\TimeZone;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

foreach ( [
	'ZoneInfo|-360|America/Chicago' => 'America/Chicago',
	'ZoneInfo|60|Europe/Berlin' => 'Europe/Berlin',
	'ZoneInfo|-240|America/Argentina/Buenos_Aires' => 'America/Argentina/Buenos_Aires',
	'ZoneInfo|-180|Etc/GMT+3' => 'Etc/GMT+3',
	'Offset|-360' => '-06:00',
	'Offset|330' => '+05:30',
	'Offset|0' => '+00:00',
	'System|0' => '',
	'' => '',
	'ZoneInfo|0|[[User:X]]' => '',
	'ZoneInfo|0|<b>x</b>' => '',
	'ZoneInfo|0|America/Chicago|extra' => 'America/Chicago',
	'Offset|9999' => '',
	'Offset|abc' => '',
	'nonsense' => '',
] as $stored => $zone ) {
	check( json_encode( $stored ) . " is " . json_encode( $zone ), TimeZone::zoneOf( $stored ) === $zone, TimeZone::zoneOf( $stored ) );
}
check( 'a long name is refused', TimeZone::zoneOf( 'ZoneInfo|0|' . str_repeat( 'A', 70 ) ) === '' );

echo $failures === 0 ? "\nAll checks passed.\n" : "\n$failures FAILED\n";
