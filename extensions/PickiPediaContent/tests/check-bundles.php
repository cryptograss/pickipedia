<?php
/**
 * Rebuilding an agent's rules bundle (src/Bundles.php), without a wiki.
 *
 * fixtures/bundle-record.json is a record as magenta keeps it, made by the
 * bundler itself (memory-lane poller/rules_bundle.py), with the revisions it
 * was made from: comments, a non-breaking space at a page's edges, and
 * non-ASCII text, each a place PHP and Python could part ways. The rebuild
 * here must give the bundler's text byte for byte, and its sha256.
 *
 * Run from the extension root:  php tests/check-bundles.php
 */

require dirname( __DIR__ ) . '/src/Bundles.php';

use MediaWiki\Extension\PickiPediaContent\Bundles;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$fixture = json_decode( file_get_contents( __DIR__ . '/fixtures/bundle-record.json' ), true );
$record = $fixture['record'];
$revisions = $fixture['revisions'];
$read = static fn ( int $revision ): ?string => $revisions[(string)$revision] ?? null;

$again = Bundles::rebuild( $record['parts'], $read );
check( 'rebuilt, it is the text the bundler made', $again['text'] === $fixture['text'],
	'got: ' . json_encode( substr( (string)$again['text'], 0, 300 ) ) );
check( 'and its sha256 is the one recorded', Bundles::matches( (string)$again['text'], $record['sha256'] ) );
check( 'the revisions it names, in order', Bundles::revisions( $record['parts'] ) === [ 101, 104, 103 ],
	json_encode( Bundles::revisions( $record['parts'] ) ) );
check( 'a record id is a uuid', preg_match( Bundles::ID, $record['id'] ) === 1
	&& preg_match( Bundles::ID, '../../etc' ) === 0 );

$gone = Bundles::rebuild( $record['parts'], static fn ( int $r ): ?string => $r === 104 ? null : $read( $r ) );
check( 'a revision gone is named, never guessed', $gone === [ 'text' => null, 'missing' => [ 104 ] ],
	json_encode( $gone ) );

$changed = $revisions;
$changed['101'] = str_replace( 'Never', 'Always', $changed['101'] );
$tampered = Bundles::rebuild( $record['parts'], static fn ( int $r ): ?string => $changed[(string)$r] ?? null );
check( 'a changed revision does not match', !Bundles::matches( $tampered['text'], $record['sha256'] ) );

check( 'layerBody strips comments and Unicode whitespace as Python does',
	Bundles::layerBody( "\u{00a0} <!-- x -->Rule.\n<!--\nmulti\n-->\u{2003}" ) === 'Rule.' );

echo $failures ? "$failures failed\n" : "all ok\n";
exit( $failures ? 1 : 0 );
