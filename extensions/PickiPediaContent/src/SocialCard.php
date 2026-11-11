<?php
/**
 * A page's card where its address is shared: Telegram, Signal, Mastodon,
 * Slack, Discord and the rest read Open Graph tags from the page as served,
 * and PickiPedia had none, so a shared link showed a bare address.
 *
 * Justin, 11 Nov 2026 (#interfaces), after "Kuba's Last Merged Commits"
 * went to Tidings: "yes please fix pickipedia cards".
 *
 * The card is the page's own opening, as magenta's Tidings shows it
 * (memory-lane services/wiki_lead.py, the same rules): its paragraphs, taken
 * in order, before its first heading once there's something, as text, up
 * to MAX_CHARS; and its first picture big enough to look at that isn't a
 * banner or a strip (a graph 1376x212 isn't the page's face). Read from the
 * parsed page, so it needs no extension (WikiSEO wants TextExtracts and
 * PageImages for the same) and a page's card changes when its words do.
 *
 * Pure: HTML in, card out. Hooks::onBeforePageDisplay puts it in the head.
 */

namespace MediaWiki\Extension\PickiPediaContent;

class SocialCard {

	public const MAX_CHARS = 300;
	public const PICTURE_MIN = 200;   // the file's width in pixels, at least
	public const PICTURE_RATIO = 3.0; // longer side over shorter, at most

	/**
	 * @param string $html the page's parsed body (OutputPage::getHTML)
	 * @param string $server where relative addresses are, e.g. https://pickipedia.xyz
	 * @return array{description: string, image: ?string}
	 */
	public static function fromHtml( string $html, string $server ): array {
		$card = [ 'description' => '', 'image' => null ];
		if ( trim( $html ) === '' ) {
			return $card;
		}
		$doc = new \DOMDocument();
		$before = libxml_use_internal_errors( true );
		$doc->loadHTML( '<?xml encoding="UTF-8"><body>' . $html . '</body>', LIBXML_NONET );
		libxml_clear_errors();
		libxml_use_internal_errors( $before );
		$xpath = new \DOMXPath( $doc );

		$root = $xpath->query( '//div[contains(concat(" ", normalize-space(@class), " "), " mw-parser-output ")]' )->item( 0 )
			?? $doc->getElementsByTagName( 'body' )->item( 0 );
		if ( $root ) {
			$card['description'] = self::opening( $root );
		}
		$card['image'] = self::picture( $xpath, $server );
		return $card;
	}

	private static function opening( \DOMNode $root ): string {
		$words = [];
		$chars = 0;
		foreach ( $root->childNodes as $node ) {
			if ( !( $node instanceof \DOMElement ) ) {
				continue;
			}
			$tag = strtolower( $node->tagName );
			$isHeading = preg_match( '/^h[1-6]$/', $tag )
				|| str_contains( ' ' . $node->getAttribute( 'class' ) . ' ', ' mw-heading ' );
			if ( $isHeading ) {
				if ( $words ) {
					break;
				}
				continue;
			}
			if ( $tag !== 'p' ) {
				continue;
			}
			$bare = 0;
			$text = self::textOf( $node, $bare );
			// Nothing but a link ("edit", from a template): the page's furniture, not its words.
			if ( $text === '' || $bare === 0 ) {
				continue;
			}
			$words[] = $text;
			$chars += mb_strlen( $text );
			if ( $chars >= self::MAX_CHARS ) {
				break;
			}
		}
		$text = trim( preg_replace( '/\s+/u', ' ', implode( ' ', $words ) ) );
		if ( mb_strlen( $text ) > self::MAX_CHARS ) {
			$cut = mb_substr( $text, 0, self::MAX_CHARS - 1 );
			$space = mb_strrpos( $cut, ' ' );
			$text = rtrim( $space ? mb_substr( $cut, 0, $space ) : $cut, " ,;:" ) . '…';
		}
		return $text;
	}

	/** A paragraph's words, without its footnote marks or styles; $bare: how many are outside any link. */
	private static function textOf( \DOMNode $node, ?int &$bare, bool $inLink = false ): string {
		$bare = $bare ?? 0;
		if ( $node instanceof \DOMText ) {
			if ( !$inLink ) {
				$bare += mb_strlen( trim( $node->data ) );
			}
			return $node->data;
		}
		if ( !( $node instanceof \DOMElement ) ) {
			return '';
		}
		$tag = strtolower( $node->tagName );
		$class = ' ' . $node->getAttribute( 'class' ) . ' ';
		if ( in_array( $tag, [ 'style', 'script' ], true ) || str_contains( $class, ' reference ' )
			|| str_contains( $class, ' mw-editsection ' ) ) {
			return '';
		}
		$out = '';
		foreach ( $node->childNodes as $child ) {
			$out .= self::textOf( $child, $bare, $inLink || $tag === 'a' );
		}
		return trim( preg_replace( '/\s+/u', ' ', $out ) );
	}

	private static function picture( \DOMXPath $xpath, string $server ): ?string {
		foreach ( $xpath->query( '//img[contains(concat(" ", normalize-space(@class), " "), " mw-file-element ")]' ) as $img ) {
			$w = (int)$img->getAttribute( 'data-file-width' );
			$h = (int)$img->getAttribute( 'data-file-height' );
			if ( $w < self::PICTURE_MIN || $h <= 0 || max( $w, $h ) / min( $w, $h ) > self::PICTURE_RATIO ) {
				continue;
			}
			$src = $img->getAttribute( 'src' );
			foreach ( explode( ',', $img->getAttribute( 'srcset' ) ) as $candidate ) {  // the largest the wiki made
				$candidate = trim( $candidate );
				if ( $candidate !== '' ) {
					$src = preg_split( '/\s+/', $candidate )[0];
				}
			}
			if ( str_starts_with( $src, '//' ) ) {
				$src = 'https:' . $src;
			} elseif ( str_starts_with( $src, '/' ) ) {
				$src = rtrim( $server, '/' ) . $src;
			}
			if ( preg_match( '#^https?://#', $src ) ) {
				return $src;
			}
		}
		return null;
	}
}
