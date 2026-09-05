<?php
/**
 * A single source of truth for "what block is it?".
 *
 * This used to be a four-line calculation copy-pasted into four Special
 * pages and three JavaScript files, all extrapolating from the Merge at
 * exactly 12 seconds per block. Twelve seconds is the *slot* time; slots
 * get missed, so the realised average is longer — measured at 12.044s over
 * the 911,340 blocks between 25,000,000 and 25,911,340.
 *
 * That 0.044s compounds. Across the ~10.4 million blocks since the Merge it
 * had grown to roughly 75,000 blocks — about ten and a half days — so every
 * block height this wiki recorded pointed into the future. Audit pages were
 * named after blocks that did not exist, and their Etherscan links 404'd.
 *
 * Two changes fix it. First, ask the chain when we can: an RPC round trip
 * with a short timeout and a couple of minutes of caching is cheap, and it
 * is exactly right. Second, when we cannot reach the chain, extrapolate from
 * a recent verified block rather than from 2022 — the error is proportional
 * to distance from the anchor, so anchoring four months back instead of four
 * years keeps the fallback within a few hundred blocks instead of 75,000.
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\MediaWikiServices;

class BlockHeight {

	/**
	 * A real block, verified against the chain, not a protocol constant.
	 * Block 25,000,000 carries timestamp 2026-05-01T12:09:23Z.
	 *
	 * Re-anchoring this occasionally is ordinary maintenance and keeps the
	 * offline estimate honest. It is only ever used when the RPC is
	 * unreachable.
	 */
	private const ANCHOR_BLOCK = 25000000;
	private const ANCHOR_TIME = 1777637363;

	/** Measured average, not the 12s slot time. See the class comment. */
	private const SECONDS_PER_BLOCK = 12.044;

	/** Long enough to spare the RPC, short enough that nobody notices. */
	private const CACHE_TTL = 120;

	/** A page render must not hang on someone else's node. */
	private const RPC_TIMEOUT = 3;

	/**
	 * The current block height — from the chain if it will answer promptly,
	 * otherwise estimated.
	 *
	 * @return int
	 */
	public static function current(): int {
		$services = MediaWikiServices::getInstance();
		$cache = $services->getMainWANObjectCache();

		return (int)$cache->getWithSetCallback(
			$cache->makeGlobalKey( 'pickipedia-blockheight' ),
			self::CACHE_TTL,
			static function () {
				$fromChain = self::fetchFromChain();
				return $fromChain ?? self::estimate( time() );
			}
		);
	}

	/**
	 * Estimate the block at a given timestamp. Used for historical dates,
	 * which no RPC round trip can answer anyway, and as the offline fallback.
	 *
	 * @param int $timestamp Unix seconds
	 * @return int
	 */
	public static function estimate( int $timestamp ): int {
		$delta = $timestamp - self::ANCHOR_TIME;
		return self::ANCHOR_BLOCK + (int)round( $delta / self::SECONDS_PER_BLOCK );
	}

	/**
	 * Estimate the timestamp of a given block. Inverse of estimate().
	 *
	 * @param int $block
	 * @return int Unix seconds
	 */
	public static function timestampOf( int $block ): int {
		$delta = $block - self::ANCHOR_BLOCK;
		return self::ANCHOR_TIME + (int)round( $delta * self::SECONDS_PER_BLOCK );
	}

	/**
	 * Ask an Ethereum node for the head block.
	 *
	 * Returns null rather than throwing: a page render should degrade to an
	 * estimate, not fail, if the node is slow or unreachable.
	 *
	 * @return int|null
	 */
	private static function fetchFromChain(): ?int {
		$services = MediaWikiServices::getInstance();
		$config = $services->getMainConfig();

		$url = $config->has( 'PickiPediaEthRpcUrl' )
			? $config->get( 'PickiPediaEthRpcUrl' )
			: 'https://ethereum-rpc.publicnode.com';
		if ( !$url ) {
			return null;
		}

		try {
			$request = $services->getHttpRequestFactory()->create(
				$url,
				[
					'method' => 'POST',
					'timeout' => self::RPC_TIMEOUT,
					'postData' => json_encode( [
						'jsonrpc' => '2.0',
						'method' => 'eth_blockNumber',
						'params' => [],
						'id' => 1,
					] ),
				],
				__METHOD__
			);
			$request->setHeader( 'Content-Type', 'application/json' );

			if ( !$request->execute()->isOK() ) {
				return null;
			}

			$body = json_decode( $request->getContent(), true );
			if ( !is_array( $body ) || !isset( $body['result'] ) ) {
				return null;
			}

			// hexdec ignores the leading "0x" and always returns int|float,
			// so the only check worth making is whether the answer is sane.
			$block = (int)hexdec( (string)$body['result'] );

			// A node returning something absurd — zero, or a value behind our
			// last known-good anchor — must not be allowed to stamp nonsense
			// onto a release that is meant to outlive it. Fall back instead.
			return $block > self::ANCHOR_BLOCK ? $block : null;
		} catch ( \Throwable $e ) {
			return null;
		}
	}
}
