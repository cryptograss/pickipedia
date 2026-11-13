<?php
/**
 * {{#ontherecord:<track CID>|<record page>}}: the record a track is on, as a
 * row of its tracks, the one this page is about marked, every other one a way
 * into Rabbithole playing it.
 *
 * It replaces a line every song page carried by hand, "Silver 44 &middot;
 * '''Paint Exchange''' &middot; Moon Factory ...", which said which song this
 * was in bold and nothing else: the other songs were not links, and the list
 * was typed out once per song, so a record's track list lived in eleven
 * places (Justin and Skyler, #rabbithole, 13 Nov 2026). Now it lives in one,
 * the record's Release page, which the track's own Release page names as its
 * parent_release.
 *
 * render() is pure, so it can be checked without a wiki
 * (tests/check-on-the-record.php); forTrack() reads the two Release pages.
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

class OnTheRecord {

	/** Wikitext-safe text: no markup, links, templates or tables can start in it. */
	public static function escape( string $text ): string {
		return strtr( htmlspecialchars( $text, ENT_NOQUOTES ), [
			'"' => '&quot;',
			'[' => '&#91;', ']' => '&#93;', '{' => '&#123;', '}' => '&#125;',
			'|' => '&#124;', "'" => '&#39;', '~' => '&#126;', "\n" => ' ',
		] );
	}

	/** The record's tracks, in running order: [cid, title, number]. */
	public static function tracks( array $record ): array {
		$rows = [];
		foreach ( $record['tracks'] ?? [] as $i => $track ) {
			if ( !is_array( $track ) || empty( $track['cid'] ) || !is_string( $track['cid'] ) ) {
				continue;
			}
			$number = isset( $track['track_number'] ) && is_numeric( $track['track_number'] )
				? (int)$track['track_number'] : null;
			$rows[] = [
				'cid' => $track['cid'],
				'title' => is_scalar( $track['title'] ?? null ) && trim( (string)$track['title'] ) !== ''
					? trim( (string)$track['title'] ) : $track['cid'],
				'number' => $number,
				'order' => $number ?? ( 1000 + $i ),
			];
		}
		usort( $rows, static fn ( $a, $b ) => $a['order'] <=> $b['order'] );
		return $rows;
	}

	/**
	 * The row, as wikitext on one line (a newline inside a div turns into a
	 * paragraph). The current track is a filled pill, not a link: this page
	 * is already about it. Every other track is a pill linking into
	 * Rabbithole with that track, the same address {{Listen in Rabbithole}}
	 * uses, which the Rabbithole pane plays in its own dock.
	 *
	 * @param array $record The record's Release YAML, parsed
	 * @param string $recordCid The record's CID, for the link to its Release page
	 * @param string $currentCid The track this page is about
	 * @param string $server The wiki's address, e.g. https://pickipedia.xyz
	 * @param string $recordPage The record's wiki page, if it has one, e.g. 4masks
	 */
	public static function render(
		array $record, string $recordCid, string $currentCid, string $server, string $recordPage = ''
	): string {
		$tracks = self::tracks( $record );
		if ( !$tracks ) {
			return '';
		}

		$name = $recordPage !== ''
			? "'''[[" . self::escape( $recordPage ) . "]]'''"
			: "'''" . self::escape( is_string( $record['title'] ?? null ) ? $record['title'] : $recordCid ) . "'''";
		$count = count( $tracks );
		$head = $name
			. ' &middot; [[Release:' . self::escape( $recordCid ) . '|the release]]'
			. ' &middot; ' . $count . ( $count === 1 ? ' track' : ' tracks' );

		$pill = 'display:inline-block; padding:.1em .6em; border-radius:999px; line-height:1.4;'
			. ' white-space:nowrap; font-size:.85em;';
		$items = '';
		foreach ( $tracks as $t ) {
			$label = ( $t['number'] !== null ? $t['number'] . '. ' : '' ) . self::escape( $t['title'] );
			if ( $t['cid'] === $currentCid ) {
				$items .= '<li class="pp-on-record-current" style="' . $pill
					. ' border:1px solid #3c6749; background:#4a7c59; color:#fff; font-weight:600;">'
					. $label . '</li>';
			} else {
				$href = rtrim( $server, '/' ) . '/rabbithole/?track=' . rawurlencode( $t['cid'] );
				$items .= '<li style="' . $pill . ' border:1px solid #9aa895; background:#f1f4ef;"'
					. ' title="Listen in Rabbithole">'
					. '[' . $href . ' <span style="color:#2d5016;">' . $label . '</span>]</li>';
			}
		}

		return '<div class="pp-on-record plainlinks" style="margin:.3em 0 1em;">'
			. '<div style="font-size:.9em; color:#5a6b5c; margin-bottom:.35em;">' . $head . '</div>'
			. '<ol style="list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:.3em .35em;">'
			. $items . '</ol></div>';
	}

	/**
	 * The record a track is on, read from the wiki: the track's Release page
	 * names its parent_release, and that page lists the tracks. Both are
	 * recorded as the page's templates, so editing either re-renders it.
	 *
	 * @param \Parser $parser
	 * @return string Wikitext, or '' when the track has no record
	 */
	public static function forTrack( $parser, string $trackCid, string $recordPage = '' ): string {
		$trackCid = trim( $trackCid );
		if ( $trackCid === '' ) {
			return '';
		}
		$track = self::read( $parser, $trackCid );
		$recordCid = is_string( $track['parent_release'] ?? null ) ? trim( $track['parent_release'] ) : '';
		if ( $recordCid === '' ) {
			return '';
		}
		$record = self::read( $parser, $recordCid );
		if ( !$record ) {
			return '';
		}
		$server = \MediaWiki\MediaWikiServices::getInstance()->getMainConfig()->get( 'Server' );
		if ( str_starts_with( $server, '//' ) ) {
			$server = 'https:' . $server;
		}
		return self::render( $record, $recordCid, $trackCid, $server, trim( $recordPage ) );
	}

	/** A Release page's YAML, parsed, or [] if it is missing or not a release. */
	private static function read( $parser, string $cid ): array {
		$title = \MediaWiki\Title\Title::makeTitleSafe( NS_RELEASE, $cid );
		if ( !$title ) {
			return [];
		}
		$revision = $parser->fetchCurrentRevisionRecordOfTitle( $title );
		$parser->getOutput()->addTemplate(
			$title,
			$revision ? $revision->getPageId() : 0,
			$revision ? $revision->getId() : 0
		);
		if ( !$revision ) {
			return [];
		}
		$content = $revision->getContent( \MediaWiki\Revision\SlotRecord::MAIN );
		return $content instanceof ReleaseContent ? $content->getData() : [];
	}
}
