<?php
/**
 * The push to magenta (src/MagentaPush.php): the body, its signature, and where it goes. What magenta
 * checks on its side (memory-lane conversations/views_moods.api_wiki_hook) is the same HMAC over the same
 * bytes, so the signature here is pinned to a known vector.
 *
 * Run from the extension root:  php tests/check-magenta-push.php
 */

require dirname( __DIR__ ) . '/src/MagentaPush.php';

use MediaWiki\Extension\PickiPediaContent\MagentaPush;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$payload = MagentaPush::payload( 'Magenta:Interface', 14320, 'Magent', 'edit' );
check( 'a save: title, revision, user, kind, when', $payload['title'] === 'Magenta:Interface' && $payload['revid'] === 14320
	&& $payload['user'] === 'Magent' && $payload['kind'] === 'edit' && preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $payload['at'] ) === 1
	&& !array_key_exists( 'from', $payload ), json_encode( $payload ) );
$moved = MagentaPush::payload( 'Magenta:Clips', null, 'Magent', 'move', 'Cryptograss:Clips' );
check( 'a move carries the title it had', $moved['from'] === 'Cryptograss:Clips' && $moved['revid'] === null );
check( 'the URL is magenta plus the hook path',
	MagentaPush::url( 'https://memory-lane.maybelle.cryptograss.live/' ) === 'https://memory-lane.maybelle.cryptograss.live/api/wiki/hook/' );
// The same vector memory-lane's tests use: HMAC-SHA256, hex, prefixed sha256=.
$body = '{"title":"X"}';
check( 'the signature is sha256=<hmac hex>',
	MagentaPush::sign( 'secret', $body ) === 'sha256=' . hash_hmac( 'sha256', $body, 'secret' )
	&& strlen( MagentaPush::sign( 'secret', $body ) ) === 7 + 64 );
check( 'a different secret, a different signature', MagentaPush::sign( 'other', $body ) !== MagentaPush::sign( 'secret', $body ) );

echo $failures === 0 ? "\nAll checks passed.\n" : "\n$failures FAILED\n";
