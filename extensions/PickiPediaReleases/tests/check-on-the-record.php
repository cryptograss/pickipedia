<?php
/**
 * Checks for {{#ontherecord:}}'s row (src/OnTheRecord.php), runnable without
 * a wiki: php extensions/PickiPediaReleases/tests/check-on-the-record.php
 */

require __DIR__ . '/../src/OnTheRecord.php';

use MediaWiki\Extension\PickiPediaReleases\OnTheRecord;

$failures = 0;
function check( bool $ok, string $what ): void {
	global $failures;
	echo ( $ok ? 'ok   ' : 'FAIL ' ) . $what . "\n";
	if ( !$ok ) {
		$failures++;
	}
}

// 4masks, as its Release page lists it (trimmed), out of order on purpose.
$record = [
	'title' => 'Justin Myles Holmes - 4masks (RC1)',
	'release_type' => 'record',
	'tracks' => [
		[ 'cid' => 'QmPaint', 'title' => 'Paint Exchange', 'track_number' => 2 ],
		[ 'cid' => 'QmSilver', 'title' => 'Silver 44', 'track_number' => 1 ],
		[ 'cid' => 'QmBarlow', 'title' => "Barlow's [Jig] | {{x}}", 'track_number' => 6 ],
		[ 'title' => 'no cid, skipped' ],
	],
];
$out = OnTheRecord::render( $record, 'QmRecord', 'QmPaint', 'https://pickipedia.xyz/', '4masks' );

check( strpos( $out, "\n" ) === false, 'one line, so no stray paragraphs inside the div' );
check( strpos( $out, "'''[[4masks]]'''" ) !== false, 'the record page, linked, when given' );
check( strpos( $out, '[[Release:QmRecord|the release]]' ) !== false, 'the record\'s Release page' );
check( strpos( $out, '3 tracks' ) !== false, 'counts only the tracks it can play' );
check( strpos( $out, 'no cid' ) === false, 'a track without a CID is left out' );
check( strpos( $out, '1. Silver 44' ) < strpos( $out, '2. Paint Exchange' ), 'running order, by track number' );
check(
	(bool)preg_match( '/<li class="pp-on-record-current"[^>]*>2\. Paint Exchange<\/li>/', $out ),
	'the current track is the marked pill, and not a link'
);
check( strpos( $out, 'track=QmPaint' ) === false, 'no link to the page\'s own track' );
check(
	strpos( $out, '[https://pickipedia.xyz/rabbithole/?track=QmSilver <span' ) !== false,
	'another track links into Rabbithole, one slash after the host'
);
check( strpos( $out, "Barlow&#39;s &#91;Jig&#93; &#124; &#123;&#123;x&#125;&#125;" ) !== false, 'a title cannot start markup' );

$bare = OnTheRecord::render( $record, 'QmRecord', 'QmPaint', 'https://pickipedia.xyz' );
check( strpos( $bare, "'''Justin Myles Holmes - 4masks (RC1)'''" ) !== false, 'no record page: the release\'s own title, unlinked' );

check( OnTheRecord::render( [ 'tracks' => [] ], 'QmR', 'QmPaint', 'https://x' ) === '', 'a record with no tracks says nothing' );
check(
	strpos( OnTheRecord::render( [ 'tracks' => [ [ 'cid' => 'QmA', 'title' => 'A' ] ] ], 'QmR', 'QmA', 'https://x' ), '1 track' ) !== false,
	'one track, singular'
);

exit( $failures ? 1 : 0 );
