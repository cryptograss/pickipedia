<?php
/**
 * Checks for the Release page's download block (src/ReleaseDownload.php),
 * runnable without a wiki:
 * php extensions/PickiPediaReleases/tests/check-release-download.php
 */

require __DIR__ . '/../src/ReleaseDownload.php';

use MediaWiki\Extension\PickiPediaReleases\ReleaseDownload;

$failures = 0;
function check( bool $ok, string $what ): void {
	global $failures;
	echo ( $ok ? 'ok   ' : 'FAIL ' ) . $what . "\n";
	if ( !$ok ) {
		$failures++;
	}
}

$ih = '2f1bea2eb182412cd2612e13ce06b83c11ddbcc6';
$cid = 'QmeLBAbzHrwc2Xkkx1oTco61qeMykK5ffp2eofYkvs2v32';

// The magnet URI
$m = ReleaseDownload::magnetUri( $ih, 'Victory & more', [ 'udp://t.example:6969' ], [ 'https://w.example/ws/' ] );
check( str_starts_with( $m, "magnet:?xt=urn:btih:$ih" ), 'magnet carries the infohash' );
check( str_contains( $m, '&dn=Victory+%26+more' ), 'name is encoded' );
check( str_contains( $m, '&tr=udp%3A%2F%2Ft.example%3A6969' ), 'trackers are encoded' );
check( str_contains( $m, '&ws=https%3A%2F%2Fw.example%2Fws%2F' ), 'webseeds are encoded' );
check( ReleaseDownload::magnetUri( $ih ) === "magnet:?xt=urn:btih:$ih", 'bare magnet without name' );
check( ReleaseDownload::magnetFor( [], $cid ) === null, 'no infohash, no magnet' );
check( str_contains( ReleaseDownload::magnetFor( [ 'bittorrent_infohash' => $ih ], $cid ), "&dn=$cid" ), 'name falls back to the CID' );

// With a torrent
$data = [
	'title' => 'Victory',
	'bittorrent_infohash' => $ih,
	'bittorrent_trackers' => [ 'udp://t.example:6969' ],
	'bittorrent_torrent_url' => "https://delivery-kid.cryptograss.live/torrent/$ih.torrent",
];
$html = ReleaseDownload::render( $cid, $data );
$button = strpos( $html, 'Download with BitTorrent' );
$ipfs = strpos( $html, 'Also on IPFS' );
check( $button !== false, 'button shows' );
check( $ipfs !== false && $button < $ipfs, 'BitTorrent comes before IPFS' );
check( str_contains( $html, 'class="release-download-button" href="magnet:?xt=urn:btih:' . $ih ), 'button links the magnet' );
check( str_contains( $html, '&amp;tr=' ), 'magnet is escaped for HTML' );
check( str_contains( $html, ".torrent file</a>" ), '.torrent link shows when there is a URL' );
check( str_contains( $html, ReleaseDownload::GATEWAY . $cid ), 'IPFS gateway link' );
check( str_contains( $html, "ipfs://$cid" ), 'ipfs:// link' );
check( !str_contains( $html, 'still being made' ), 'no pending note when the torrent is there' );

unset( $data['bittorrent_torrent_url'] );
check( !str_contains( ReleaseDownload::render( $cid, $data ), '.torrent file' ), 'no .torrent link without a URL' );
$data['bittorrent_torrent_url'] = 'javascript:alert(1)';
check( !str_contains( ReleaseDownload::render( $cid, $data ), 'javascript:' ), 'a non-http .torrent URL is dropped' );

// Without a torrent yet (the newest Releases, 8 Nov 2026)
$html = ReleaseDownload::render( $cid, [ 'title' => "IBMA 2022 pickin' crew" ] );
check( str_contains( $html, 'still being made' ), 'says the torrent is still being made' );
check( !str_contains( $html, 'Download with BitTorrent' ), 'no button without a torrent' );
check( str_contains( $html, 'On IPFS: ' ) && !str_contains( $html, 'Also on IPFS' ), 'IPFS is the way meanwhile' );

// CIDs
check( ReleaseDownload::normalizeCid( 'BafyBEIGDYRZT' ) === 'bafybeigdyrzt', 'CIDv1 lowercased' );
check( ReleaseDownload::normalizeCid( $cid ) === $cid, 'CIDv0 kept' );
check( str_contains( ReleaseDownload::render( 'BafyABC', [] ), 'ipfs://bafyabc' ), 'render lowercases CIDv1' );
check( ReleaseDownload::render( null, [] ) === '', 'nothing to offer, nothing shown' );

echo $failures ? "$failures failed\n" : "all passed\n";
exit( $failures ? 1 : 0 );
