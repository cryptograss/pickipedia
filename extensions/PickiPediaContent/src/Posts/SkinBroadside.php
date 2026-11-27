<?php
/**
 * Broadside: the skin a post is read in.
 *
 * A broadside was a single printed sheet, a song or the news, sold in the
 * street and pasted on walls: how songs travelled before records did. A
 * post here is one sheet too.
 *
 * It is a skin of its own, not the wiki's skin rearranged: its own
 * template (templates/broadside/skin.mustache) and its own stylesheets
 * (resources/skins.broadside/), chosen on the server for a post's page
 * (Hooks::onRequestContextCreateSkin). The page arrives as it will look.
 * No script moves anything: the scripts that load afterwards only answer
 * the reader (the light, a link's card, a video that follows them down
 * the page).
 *
 * Justin, 13 Nov 2026 (#pickipedia-style-and-main-page): "templated out so
 * that the style isn't suddenly shifted by javascript - have a totally
 * different style sheet set load".
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts;

use MediaWiki\MediaWikiServices;
use MediaWiki\Output\OutputPage;
use MediaWiki\Title\Title;

class SkinBroadside extends \SkinMustache {

	/** The reader's choice of light or dark, kept so the server can send the page that way (as the zine kept it). */
	public const MODE_COOKIE = 'pickipedia-mode';

	/** The wiki's mark, as uploaded; the configured logo where there is no such file. */
	private const MARK = 'Pickipedia-quarter-transparent.png';

	/** 'dark', 'light', or '' for whatever the reader's system says. */
	public function mode(): string {
		$mode = $this->getRequest()->getCookie( self::MODE_COOKIE, '' );
		return in_array( $mode, [ 'dark', 'light' ], true ) ? $mode : '';
	}

	/** The choice is on <html> from the first byte, so a page chosen dark never paints light. */
	public function getHtmlElementAttributes() {
		$attrs = parent::getHtmlElementAttributes();
		$mode = $this->mode();
		$attrs['class'] = trim( ( $attrs['class'] ?? '' ) . ' bs-root' . ( $mode !== '' ? ' bs-' . $mode : '' ) );
		return $attrs;
	}

	public function initPage( OutputPage $out ) {
		parent::initPage( $out );
		$mode = $this->mode();
		$out->addMeta( 'color-scheme', $mode !== '' ? $mode : 'light dark' );
	}

	public function getTemplateData() {
		$data = parent::getTemplateData();
		$out = $this->getOutput();
		$title = $this->getTitle();
		$html = $out->getHTML();

		$data['html-body-content'] = Post::capped( Post::shapeVideos(
			$data['html-body-content'],
			PostData::videoShapes( Post::videoCids( $html ) )
		) );

		$toc = $data['data-toc'] ?? [];
		$hasToc = ( $toc['number-section-count'] ?? 0 ) >= 2;
		if ( !$hasToc ) {
			$data['data-toc'] = null;
		}

		$post = $this->post( $title, $html );
		$post['has-video'] = Post::videoCids( $html ) !== [];
		// The side column: what plays and what is said. A post whose writer has songs always has one; a
		// tiding alone doesn't make one (Post::hasSide).
		$post['has-side'] = !empty( $post['is-post'] ) && Post::hasSide( $post, $hasToc );
		$data['data-post'] = $post;

		$mode = $this->mode();
		$data['mode-is-dark'] = $mode === 'dark';
		$data['logo'] = self::blanksGone( $this->mark() );
		$data['link-plain'] = $title->getLocalURL( [ 'useskin' => $this->getConfig()->get( 'DefaultSkin' ) ] );
		$data['link-search'] = \MediaWiki\SpecialPage\SpecialPage::getTitleFor( 'Search' )->getLocalURL();
		$user = $this->getUser();
		$data['user-label'] = $user->isRegistered() ? $user->getName() : null;
		$data['array-tools'] = self::tools( $data['data-portlets'] ?? [] );
		return $data;
	}

	/**
	 * The page's own ways in (its talk page, edit, history), as plain links: [ 'text', 'href', 'title',
	 * 'class' ]. Taken from the menus every skin is given, without the one for where the reader already is.
	 * Plain, because the template shows them twice: along the bar on a wide screen, and in the bar's menu on a
	 * narrow one, where they don't fit; a list item's id can only be on one of them.
	 */
	private static function tools( array $portlets ): array {
		$tools = [];
		foreach ( [ 'data-namespaces', 'data-views' ] as $menu ) {
			foreach ( $portlets[$menu]['array-items'] ?? [] as $item ) {
				$classes = preg_split( '/\s+/', (string)( $item['class'] ?? '' ) ) ?: [];
				if ( in_array( 'selected', $classes, true ) || ( $item['name'] ?? '' ) === 'view' ) {
					continue;
				}
				foreach ( $item['array-links'] ?? [] as $link ) {
					$attrs = array_column( $link['array-attributes'] ?? [], 'value', 'key' );
					if ( !isset( $attrs['href'] ) ) {
						continue;
					}
					$tools[] = [
						'text' => (string)( $link['text'] ?? '' ),
						'href' => (string)$attrs['href'],
						'title' => isset( $attrs['title'] ) ? (string)$attrs['title'] : null,
						'is-new' => in_array( 'new', $classes, true ),
					];
				}
			}
		}
		return $tools;
	}

	private function mark(): array {
		$mark = PostData::thumb( self::MARK, 44 );
		if ( $mark ) {
			return $mark;
		}
		$logos = \MediaWiki\ResourceLoader\SkinModule::getAvailableLogos( $this->getConfig(), $this->getLanguage()->getCode() );
		return [ 'src' => $logos['icon'] ?? $logos['1x'] ?? '', 'srcset' => '', 'width' => 44, 'height' => 44 ];
	}

	/**
	 * '' made null, all the way down: the template's sections draw for an empty string (LightnCandy's do,
	 * though Mustache's own don't), so what is absent has to be null to be left out.
	 */
	private static function blanksGone( array $data ): array {
		foreach ( $data as $key => $value ) {
			if ( $value === '' ) {
				$data[$key] = null;
			} elseif ( is_array( $value ) ) {
				$data[$key] = self::blanksGone( $value );
			}
		}
		return $data;
	}

	/** A date as the reader's language writes it, and as a machine reads it. */
	private function when( string $timestamp ): array {
		return [
			'iso' => wfTimestamp( TS_ISO_8601, $timestamp ),
			'text' => $this->getLanguage()->userDate( $timestamp, $this->getUser() ),
		];
	}

	/**
	 * Everything the template shows of a post besides its words. A page
	 * that isn't a post (the skin asked for by hand, ?useskin=broadside)
	 * gets its title and nothing else.
	 */
	private function post( Title $title, string $html ): array {
		$out = $this->getOutput();
		$isPost = $title->getNamespace() === NS_USER && Post::isPostTitle( $title->getText() );
		if ( !$isPost ) {
			return [ 'is-post' => false, 'headline' => strip_tags( $out->getPageTitle() ) ];
		}
		$services = MediaWikiServices::getInstance();
		$parts = Post::parts( $title->getText() );
		$user = $parts['user'];
		$mine = implode( '/', $parts['path'] );
		$writings = PostData::writings( $user );
		$url = static fn ( string $path ) => Title::makeTitle( NS_USER, $user . '/' . $path )->getLocalURL();

		// Its series: the path above it, if that is a page or has other posts under it.
		$series = null;
		$inSeries = false;
		if ( $parts['parent'] !== null ) {
			$prefix = $parts['parent'] . '/';
			$leaves = [ $parts['leaf'] ];
			$parentIsPost = false;
			foreach ( $writings as $row ) {
				if ( $row['path'] === $parts['parent'] ) {
					$parentIsPost = true;
				}
				if ( str_starts_with( $row['path'], $prefix ) && !str_contains( substr( $row['path'], strlen( $prefix ) ), '/' ) ) {
					$leaves[] = substr( $row['path'], strlen( $prefix ) );
				}
			}
			$parentTitle = Title::makeTitle( NS_USER, $user . '/' . $parts['parent'] );
			$inSeries = $parentIsPost || $parentTitle->exists() || count( array_unique( $leaves ) ) >= 2;
			if ( $inSeries ) {
				$n = Post::neighbours( $leaves, $parts['leaf'] );
				$series = [
					'name' => Post::seriesName( $parts ),
					'url' => $parentTitle->exists() ? $parentTitle->getLocalURL() : null,
					'has-url' => $parentTitle->exists(),
					'position' => $this->msg( 'pickipediacontent-posts-position' )
						->numParams( $n['index'], $n['count'] )->text(),
					'prev' => $n['prev'] !== null ? [ 'label' => $n['prev'], 'url' => $url( $prefix . $n['prev'] ) ] : null,
					'next' => $n['next'] !== null ? [ 'label' => $n['next'], 'url' => $url( $prefix . $n['next'] ) ] : null,
				];
				$series['has-neighbours'] = $series['prev'] || $series['next'];
			}
		}
		// Or it is a series' own page: its parts are under it.
		$partsUnder = [];
		foreach ( $writings as $row ) {
			if ( str_starts_with( $row['path'], $mine . '/' ) ) {
				$partsUnder[] = substr( $row['path'], strlen( $mine ) + 1 );
			}
		}
		$opens = null;
		if ( $partsUnder ) {
			usort( $partsUnder, 'strnatcasecmp' );
			$opens = [
				'count' => $this->msg( 'pickipediacontent-posts-parts' )->numParams( count( $partsUnder ) )->text(),
				'first' => [ 'label' => $partsUnder[0], 'url' => $url( $mine . '/' . $partsUnder[0] ) ],
			];
		}

		$author = self::blanksGone( PostData::author( $user ) );
		$author['initial'] = mb_strtoupper( mb_substr( $author['name'], 0, 1 ) );
		// Somewhere to go from their name: their user page if they have made one, the person they are,
		// their page on magenta. A writer with none of them has a name and nothing under it.
		$author['has-links'] = $author['exists'] || $author['person'] || $author['magenta'];

		// The rail: what else they have written, newest first; past the first few, behind a fold.
		$shelf = Post::shelf( $writings, $mine, 200 );
		$lines = [];
		foreach ( $shelf['items'] as $item ) {
			$lines[] = [
				'title' => $item['count'] ? $item['title'] : Post::headline( Post::parts( $user . '/' . $item['path'] ), false ),
				'url' => $url( $item['path'] ),
				'note' => $item['count']
					? $this->msg( 'pickipediacontent-posts-parts' )->numParams( $item['count'] )->text()
					: $this->getLanguage()->userDate( $item['created'], $this->getUser() ),
			];
		}
		$rest = array_slice( $lines, PostData::SHELF );

		$songs = $author['person'] ? PostData::songs( $author['person']['title'] ) : [];

		$kicker = null;
		$own = Post::ownKicker( $html );
		if ( $own !== null ) {
			$kicker = [ 'text' => $own, 'has-url' => false ];
		} elseif ( $series ) {
			$kicker = [ 'text' => $series['name'], 'url' => $series['url'], 'has-url' => $series['has-url'] ];
		}

		$first = $services->getRevisionLookup()->getFirstRevision( $title );
		$published = $first && $first->getTimestamp() ? $this->when( $first->getTimestamp() ) : null;
		$edited = null;
		$editedAt = $out->getRevisionTimestamp();
		if ( $editedAt && $first && substr( $editedAt, 0, 8 ) !== substr( (string)$first->getTimestamp(), 0, 8 ) ) {
			$edited = $this->when( $editedAt );
			$edited['label'] = $this->msg( 'pickipediacontent-posts-edited', $edited['text'] )->text();
		}
		$words = Post::wordCount( $html );

		return [
			'is-post' => true,
			'headline' => Post::headline( $parts, $inSeries ),
			'kicker' => $kicker,
			'html-dek' => Post::sourced( $html, 'pp-dek-source' ),
			'author' => $author,
			'published' => $published,
			'edited' => $edited,
			'minutes' => $this->msg( 'pickipediacontent-posts-minutes' )->numParams( Post::minutes( $words ) )->text(),
			'series' => $series,
			'opens' => $opens,
			'shelf' => $lines ? [
				'array-items' => array_slice( $lines, 0, PostData::SHELF ),
				'rest' => $rest ? [
					'array-items' => $rest,
					'label' => $this->msg( 'pickipediacontent-posts-more' )->numParams( count( $rest ) )->text(),
				] : null,
			] : null,
			// Named for who wrote them: beside the post they stand apart from the writer's name.
			'songs' => $songs ? [
				'heading' => $this->msg( 'pickipediacontent-posts-songs-by', $author['name'] )->text(),
				'array-items' => array_slice( $songs, 0, PostData::SONGS ),
				'person' => $author['person'],
			] : null,
			'tiding' => $this->tiding( $title ),
		];
	}

	/** The page's tiding, as the template shows it: its counts in words, each thing said with its time. */
	private function tiding( Title $title ): ?array {
		$found = PostData::tiding( $title );
		if ( !$found ) {
			return null;
		}
		$lang = $this->getLanguage();
		$said = [];
		foreach ( $found['said'] as $row ) {
			$when = '';
			if ( $row['at'] !== '' ) {
				try {
					$when = $lang->getHumanTimestamp( new \MediaWiki\Utils\MWTimestamp( $row['at'] ), null, $this->getUser() );
				} catch ( \Throwable $e ) {
					$when = '';
				}
			}
			$said[] = [
				'who' => $row['who'],
				'href' => $row['href'],
				'iso' => $row['at'],
				'when' => $when,
				'has-when' => $when !== '',
				'block' => $row['block'] ? $lang->formatNum( $row['block'] ) : null,
				'is-emergent' => $row['emergent'],
				'colour' => $row['colour'] !== '' ? $row['colour'] : null,
				'array-paragraphs' => $row['paragraphs'],
			];
		}
		return [
			'url' => $found['url'],
			'summary' => $this->msg( 'pickipediacontent-posts-thread-summary' )
				->numParams( $found['comments'], $found['score'] )->text(),
			'chip' => $this->msg( 'pickipediacontent-posts-tiding-chip' )->numParams( $found['comments'] )->text(),
			'array-said' => $said,
			'has-said' => (bool)$said,
		];
	}
}
