<?php
/**
 * Each change here, told to magenta at once (Justin, #interfaces, 6 Nov 2026: "notification of every edit
 * fires from pickipedia to magenta"). magenta keeps copies of many pages -- the interface's words, each
 * person's card, each Mood's instructions -- and used to learn of an edit only when its own clock ran out,
 * hours later. Now a save, a move or an upload is POSTed to magenta's /api/wiki/hook/ as JSON, signed with
 * a shared secret (HMAC-SHA256 of the body, X-Magenta-Signature: sha256=...), and magenta runs the hooks
 * for that page (memory-lane conversations/services/wiki_hooks.py). It also sweeps our recent changes once
 * a minute as the check on this: a change it finds there that was never pushed is said in its #ops.
 *
 * Sent after the response, as a deferred update, so a save never waits on magenta; a push that fails is
 * logged and let go, since the sweep will find the change within the minute. No secret configured: nothing
 * is sent, and the sweep alone serves.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\Deferred\DeferredUpdates;
use MediaWiki\Logger\LoggerFactory;
use MediaWiki\MediaWikiServices;

class MagentaPush {

	public const PATH = '/api/wiki/hook/';
	public const HEADER = 'X-Magenta-Signature';
	public const TIMEOUT = 5;

	/** The body magenta is sent: what changed, which revision, who, when, and what kind of change. */
	public static function payload( string $title, ?int $revid, string $user, string $kind, ?string $from = null ): array {
		$body = [
			'title' => $title,
			'revid' => $revid,
			'user' => $user,
			'kind' => $kind,
			'at' => gmdate( 'Y-m-d\TH:i:s\Z' ),
		];
		if ( $from !== null ) {
			$body['from'] = $from;  // a move: the title it had
		}
		return $body;
	}

	/** The signature header's value for a body: sha256=<HMAC-SHA256 of the bytes, keyed by the secret>. */
	public static function sign( string $secret, string $body ): string {
		return 'sha256=' . hash_hmac( 'sha256', $body, $secret );
	}

	/** Where the push goes: magenta's base URL (PickiPediaContentMagentaUrl) and PATH. */
	public static function url( string $base ): string {
		return rtrim( $base, '/' ) . self::PATH;
	}

	/** Tell magenta, after the response. Nothing without a secret. */
	public static function tell( array $payload ): void {
		$config = MediaWikiServices::getInstance()->getMainConfig();
		$secret = (string)$config->get( 'PickiPediaContentMagentaHookSecret' );
		$base = (string)$config->get( 'PickiPediaContentMagentaUrl' );
		if ( $secret === '' || $base === '' ) {
			return;
		}
		DeferredUpdates::addCallableUpdate( static function () use ( $payload, $secret, $base ) {
			self::send( self::url( $base ), $secret, $payload );
		} );
	}

	/** One POST; its outcome logged, never thrown. */
	public static function send( string $url, string $secret, array $payload ): bool {
		$body = json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		$logger = LoggerFactory::getInstance( 'PickiPediaContent' );
		try {
			$request = MediaWikiServices::getInstance()->getHttpRequestFactory()->create( $url, [
				'method' => 'POST',
				'postData' => $body,
				'timeout' => self::TIMEOUT,
				'logger' => $logger,
			], __METHOD__ );
			$request->setHeader( 'Content-Type', 'application/json' );
			$request->setHeader( self::HEADER, self::sign( $secret, $body ) );
			$status = $request->execute();
		} catch ( \Throwable $e ) {
			$logger->warning( 'magenta push failed for {title}: {error}',
				[ 'title' => $payload['title'] ?? '?', 'error' => $e->getMessage() ] );
			return false;
		}
		if ( !$status->isOK() ) {
			$logger->warning( 'magenta push refused for {title}: HTTP {code} {body}', [
				'title' => $payload['title'] ?? '?', 'code' => $request->getStatus(),
				'body' => substr( (string)$request->getContent(), 0, 200 ),
			] );
			return false;
		}
		return true;
	}
}
