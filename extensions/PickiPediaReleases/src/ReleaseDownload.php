<?php
/**
 * The "get it" block on a Release page: BitTorrent first and loudest, IPFS
 * beside it (Justin, 8 Nov 2026: BitTorrent is what more people know and
 * can open, so make it "louder and prouder").
 *
 * Plain PHP, no MediaWiki classes, so it can be checked without a wiki:
 * php extensions/PickiPediaReleases/tests/check-release-download.php
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

class ReleaseDownload {

	/** delivery-kid's gateway: where Releases are pinned */
	public const GATEWAY = 'https://ipfs.delivery-kid.cryptograss.live/ipfs/';

	/**
	 * CIDv1 (bafy...) is base32 lowercase, and MediaWiki capitalised the page
	 * title, so it goes back to lowercase; CIDv0 (Qm...) is base58 and kept.
	 */
	public static function normalizeCid( string $cid ): string {
		return str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
	}

	/**
	 * The magnet URI for a release's torrent. The one place it's built.
	 *
	 * @param string $infohash
	 * @param string $name
	 * @param array $trackers
	 * @param array $webseeds
	 * @return string
	 */
	public static function magnetUri(
		string $infohash, string $name = '', array $trackers = [], array $webseeds = []
	): string {
		$uri = "magnet:?xt=urn:btih:{$infohash}";
		if ( $name !== '' ) {
			$uri .= '&dn=' . urlencode( $name );
		}
		foreach ( $trackers as $tracker ) {
			$uri .= '&tr=' . urlencode( (string)$tracker );
		}
		foreach ( $webseeds as $webseed ) {
			$uri .= '&ws=' . urlencode( (string)$webseed );
		}
		return $uri;
	}

	/**
	 * The magnet URI for a Release page's YAML, or null if it has no torrent yet.
	 *
	 * @param array $data
	 * @param string|null $cid
	 * @return string|null
	 */
	public static function magnetFor( array $data, ?string $cid ): ?string {
		$infohash = $data['bittorrent_infohash'] ?? '';
		if ( !is_string( $infohash ) || $infohash === '' ) {
			return null;
		}
		$name = $data['title'] ?? $cid ?? '';
		return self::magnetUri(
			$infohash,
			is_string( $name ) ? $name : '',
			is_array( $data['bittorrent_trackers'] ?? null ) ? $data['bittorrent_trackers'] : [],
			is_array( $data['bittorrent_webseeds'] ?? null ) ? $data['bittorrent_webseeds'] : []
		);
	}

	/**
	 * The block itself, as HTML. Empty when there's neither a torrent nor a CID.
	 *
	 * @param string|null $cid
	 * @param array $data the Release page's YAML
	 * @return string
	 */
	public static function render( ?string $cid, array $data ): string {
		$magnet = self::magnetFor( $data, $cid );
		if ( $magnet === null && !$cid ) {
			return '';
		}
		$e = static fn ( string $s ): string => htmlspecialchars( $s, ENT_QUOTES );

		$html = '<div class="release-download">';
		if ( $magnet !== null ) {
			$html .= '<div class="release-download-torrent">'
				. '<a class="release-download-button" href="' . $e( $magnet ) . '">'
				. 'Download with BitTorrent</a>';
			$torrentUrl = $data['bittorrent_torrent_url'] ?? '';
			if ( is_string( $torrentUrl ) && preg_match( '#^https?://#', $torrentUrl ) ) {
				$html .= ' <a class="release-download-file" href="' . $e( $torrentUrl ) . '">'
					. '.torrent file</a>';
			}
			$html .= '</div>';
		} else {
			$html .= '<div class="release-download-pending">'
				. 'The BitTorrent download for this release is still being made: '
				. 'Blue Railroad Imports adds it once delivery-kid has built the torrent. '
				. ( $cid ? 'Until then, get it from IPFS.' : '' )
				. '</div>';
		}

		if ( $cid ) {
			$normal = self::normalizeCid( $cid );
			$html .= '<div class="release-download-ipfs">'
				. ( $magnet !== null ? 'Also on IPFS: ' : 'On IPFS: ' )
				. '<a href="' . $e( self::GATEWAY . $normal ) . '" rel="nofollow">gateway</a>'
				. ' · <a href="' . $e( 'ipfs://' . $normal ) . '">ipfs://</a>'
				. '</div>';
		}
		return $html . '</div>';
	}
}
