<?php
/**
 * A page in brief, for the card shown when a link to it is pointed at in a
 * post (Justin, 13 Nov 2026: "links throughout the post need to have nice
 * hover cards"), and for magenta, which shows a post's masthead on its
 * tiding's page so the page here is the same thing continued.
 *
 * The words and the picture are the page's own opening, by the rules its
 * card for sharing already follows (SocialCard.php): nothing unverified,
 * no banner for a face. A song says where it plays; a post says who wrote
 * it and how long it takes; a person's page gives their picture; a release
 * its still; a page nobody has written says so.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts;

use MediaWiki\Extension\PickiPediaContent\SocialCard;
use MediaWiki\MediaWikiServices;
use MediaWiki\Parser\ParserOptions;
use MediaWiki\Title\Title;

class PageCard {

	private const TTL = 3600;
	private const GATEWAY = 'https://ipfs.delivery-kid.cryptograss.live/ipfs';

	/**
	 * @param string $text a title as written, or as it stands in an address
	 * @return array{kind: string, title?: string, url?: string, text?: string, image?: ?string, ...}
	 *   kind: 'page', 'post', 'person', 'song', 'release', 'missing', or 'none' (nothing to show)
	 */
	public static function of( string $text ): array {
		$title = Title::newFromText( $text );
		if ( !$title || $title->isExternal() || $title->getNamespace() < 0 ) {
			return [ 'kind' => 'none' ];
		}
		$services = MediaWikiServices::getInstance();
		if ( $title->isRedirect() ) {
			$target = $services->getRedirectLookup()->getRedirectTarget( $title );
			$target = $target ? Title::castFromLinkTarget( $target ) : null;
			if ( $target && !$target->isExternal() && $target->getNamespace() >= 0 ) {
				$title = $target;
			}
		}
		$url = (string)$services->getUrlUtils()->expand( $title->getLocalURL(), PROTO_CANONICAL );
		if ( !$title->exists() ) {
			return [ 'kind' => 'missing', 'title' => $title->getPrefixedText(), 'url' => $url ];
		}
		$cache = $services->getMainWANObjectCache();
		$user = $title->getNamespace() === NS_USER ? explode( '/', $title->getText(), 2 )[0] : '';
		return $cache->getWithSetCallback(
			$cache->makeKey( 'pp-posts', 'card', $title->getArticleID(), $title->getLatestRevID() ),
			self::TTL,
			static fn () => self::read( $title, $url ),
			// A person's card, and a post's, say things of their user page too.
			$user !== '' ? [ 'checkKeys' => [ $cache->makeKey( 'pp-posts', 'user', sha1( $user ) ) ] ] : []
		);
	}

	private static function read( Title $title, string $url ): array {
		$services = MediaWikiServices::getInstance();
		$server = (string)$services->getMainConfig()->get( 'CanonicalServer' );
		$abs = static fn ( ?string $path ) => $path ? (string)$services->getUrlUtils()->expand( $path, PROTO_CANONICAL ) : null;
		$card = [ 'kind' => 'page', 'title' => $title->getPrefixedText(), 'url' => $url, 'text' => '', 'image' => null ];
		$ns = $title->getNamespace();

		if ( defined( 'NS_RELEASE' ) && $ns === NS_RELEASE ) {
			return self::release( $title, $card );
		}

		$html = '';
		try {
			$page = $services->getWikiPageFactory()->newFromTitle( $title );
			$status = $services->getParserOutputAccess()->getParserOutput( $page, ParserOptions::newFromAnon() );
			if ( $status->isOK() ) {
				$html = $status->getValue()->getRawText();
			}
		} catch ( \Throwable $e ) {
			$html = '';
		}
		$opening = SocialCard::fromHtml( $html, $server );
		$card['text'] = $opening['description'];
		$card['image'] = $opening['image'];

		if ( $ns === NS_USER && !str_contains( $title->getText(), '/' ) ) {
			$author = PostData::author( $title->getText() );
			$card['kind'] = 'person';
			$card['title'] = $author['name'];
			$card['image'] = $abs( $author['avatar']['src'] ?? null ) ?? $card['image'];
			if ( $author['says'] !== '' ) {
				$card['text'] = $author['says'];
			}
			$card['writings'] = count( Post::shelf( PostData::writings( $title->getText() ), '', 1000 )['items'] );
		} elseif ( $ns === NS_USER && PostData::isPost( $title ) ) {
			$parts = Post::parts( $title->getText() );
			$author = PostData::author( $parts['user'] );
			$parent = $parts['parent'] !== null ? Title::makeTitle( NS_USER, $parts['user'] . '/' . $parts['parent'] ) : null;
			$inSeries = $parent !== null && $parent->exists();
			$first = $services->getRevisionLookup()->getFirstRevision( $title );
			$dek = Post::sourced( $html, 'pp-dek-source' );
			$card['kind'] = 'post';
			$card['title'] = Post::headline( $parts, $inSeries );
			$card['post'] = [
				'headline' => $card['title'],
				// As its page's masthead has it (SkinBroadside): its own line, else its series' name.
				'kicker' => Post::ownKicker( $html ) ?? ( $inSeries ? Post::seriesName( $parts ) : '' ),
				'dek' => $dek !== null ? trim( html_entity_decode( strip_tags( $dek ), ENT_QUOTES | ENT_HTML5 ) ) : '',
				'author' => [
					'name' => $author['name'],
					'url' => $author['exists'] ? $abs( $author['url'] ) : null,
					'avatar' => $abs( $author['avatar']['src'] ?? null ),
				],
				'published' => $first && $first->getTimestamp() ? wfTimestamp( TS_ISO_8601, $first->getTimestamp() ) : '',
				'minutes' => Post::minutes( Post::wordCount( $html ) ),
			];
		} elseif ( defined( 'NS_SONG' ) && $ns === NS_SONG ) {
			$card['kind'] = 'song';
			$card['title'] = $title->getText();
			$cid = PostData::trackOf( $title );
			if ( $cid !== '' ) {
				$card['listen'] = $abs( '/rabbithole/?track=' . rawurlencode( $cid ) );
			}
		}
		return $card;
	}

	/** A release: its title and kind, what it says of itself, its still. */
	private static function release( Title $title, array $card ): array {
		$card['kind'] = 'release';
		try {
			$content = MediaWikiServices::getInstance()->getWikiPageFactory()->newFromTitle( $title )->getContent();
			$text = $content && method_exists( $content, 'getText' ) ? (string)$content->getText() : '';
			$release = class_exists( \Symfony\Component\Yaml\Yaml::class ) ? \Symfony\Component\Yaml\Yaml::parse( $text ) : null;
		} catch ( \Throwable $e ) {
			$release = null;
		}
		if ( is_array( $release ) ) {
			if ( is_string( $release['title'] ?? null ) && trim( $release['title'] ) !== '' ) {
				$card['title'] = trim( $release['title'] );
			}
			$card['text'] = is_string( $release['description'] ?? null ) ? mb_substr( trim( $release['description'] ), 0, SocialCard::MAX_CHARS ) : '';
			$card['label'] = is_string( $release['release_type'] ?? null ) ? $release['release_type'] : '';
			if ( in_array( $release['release_type'] ?? '', [ 'video', 'blue-railroad' ], true )
				|| str_starts_with( (string)( $release['file_type'] ?? '' ), 'video/' )
			) {
				$cid = $title->getText();
				$cid = str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
				$card['image'] = self::GATEWAY . '/' . $cid . '/poster.jpg';
			}
		}
		return $card;
	}

}
