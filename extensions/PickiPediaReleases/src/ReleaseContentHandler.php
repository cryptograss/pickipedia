<?php
/**
 * Content handler for Release pages with YAML metadata
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use Content;
use MediaWiki\Content\ContentHandler;
use MediaWiki\Content\Renderer\ContentParseParams;
use MediaWiki\Content\ValidationParams;
use MediaWiki\Html\Html;
use MediaWiki\Parser\ParserOutput;
use StatusValue;

class ReleaseContentHandler extends ContentHandler {

	/** ParserOutput extension-data key for the link card (Hooks::onOutputPageParserOutput) */
	public const CARD_KEY = 'pickipedia-release-card';

	/** Where a release's still is, beside its stream, once delivery-kid has made one */
	private const IPFS_GATEWAY = 'https://ipfs.delivery-kid.cryptograss.live/ipfs/';

	/**
	 * @param string $modelId
	 */
	public function __construct( $modelId = 'release-yaml' ) {
		parent::__construct( $modelId, [ CONTENT_FORMAT_TEXT ] );
	}

	/**
	 * @inheritDoc
	 */
	public function serializeContent( Content $content, $format = null ): string {
		if ( !$content instanceof ReleaseContent ) {
			throw new \InvalidArgumentException( 'Expected ReleaseContent' );
		}
		return $content->getText();
	}

	/**
	 * @inheritDoc
	 */
	public function unserializeContent( $text, $format = null ): ReleaseContent {
		return new ReleaseContent( $text );
	}

	/**
	 * @inheritDoc
	 */
	public function makeEmptyContent(): ReleaseContent {
		// CID comes from the page title, so body can be empty or have optional metadata
		$defaultYaml = <<<'YAML'
# Optional metadata - the CID is the page title
# description:
# pinned_on:
#   - delivery-kid
#   - maybelle
YAML;
		return new ReleaseContent( $defaultYaml );
	}

	/**
	 * @inheritDoc
	 */
	public function validateSave(
		Content $content,
		ValidationParams $validationParams
	): StatusValue {
		if ( !$content instanceof ReleaseContent ) {
			return StatusValue::newFatal( 'invalid-content-data' );
		}
		return $content->validate();
	}

	/**
	 * @inheritDoc
	 */
	protected function fillParserOutput(
		Content $content,
		ContentParseParams $cpoParams,
		ParserOutput &$output
	): void {
		if ( !$content instanceof ReleaseContent ) {
			$output->setRawText( '<p>Invalid content type</p>' );
			return;
		}

		// Add our CSS
		$output->addModuleStyles( [ 'ext.pickipediaReleases.styles' ] );

		$html = '';
		$parseError = $content->getParseError();

		// Show validation errors if present
		$validation = $content->validate();
		if ( !$validation->isOK() ) {
			$html .= $this->renderValidationErrors( $validation );
		}

		// Extract CID from page title
		$pageRef = $cpoParams->getPage();
		$cid = $pageRef ? $pageRef->getDBkey() : null;

		// Get optional YAML metadata
		$data = $content->getData();

		// Show banner for deleted or unpinned releases. The "cleanup pending"
		// variants appear when the YAML is marked for removal but pinned_on
		// still lists active infrastructure — i.e. audit-storage.py will flag
		// it and purge-deleted-releases.py needs to run.
		$isDeleted = !empty( $data['delete'] );
		$isUnpinned = !empty( $data['unpin'] );
		$pinnedOn = $data['pinned_on'] ?? null;
		$hasActivePins = !empty( $pinnedOn );
		$removalReason = isset( $data['removal_reason'] ) && is_string( $data['removal_reason'] )
			? trim( $data['removal_reason'] ) : '';

		$reasonHtml = $removalReason !== ''
			? Html::rawElement( 'div', [ 'style' => 'margin-top:0.5em; font-weight:normal;' ],
				Html::element( 'em', [], 'Reason: ' ) . htmlspecialchars( $removalReason ) )
			: '';

		if ( $isDeleted && !$hasActivePins ) {
			$html .= Html::rawElement( 'div', [
				'class' => 'release-deleted-banner',
				'style' => 'background:#fee; border:2px solid #c00; padding:1em; margin-bottom:1em; border-radius:4px;',
			], Html::rawElement( 'strong', [ 'style' => 'color:#c00;' ],
				'This release has been deleted and is no longer pinned or distributed.'
			) . $reasonHtml );
		} elseif ( $isUnpinned && !$hasActivePins ) {
			$html .= Html::rawElement( 'div', [
				'class' => 'release-unpinned-banner',
				'style' => 'background:#fee; border:2px solid #c00; padding:1em; margin-bottom:1em; border-radius:4px;',
			], Html::rawElement( 'strong', [ 'style' => 'color:#c00;' ],
				'This release has been unpinned and is no longer distributed.'
			) . $reasonHtml );
		} elseif ( $isDeleted || $isUnpinned ) {
			$action = $isDeleted ? 'deletion' : 'unpinning';
			$html .= Html::rawElement( 'div', [
				'class' => 'release-cleanup-pending-banner',
				'style' => 'background:#fff3cd; border:2px solid #b8860b; padding:1em; margin-bottom:1em; border-radius:4px;',
			], Html::rawElement( 'strong', [ 'style' => 'color:#8a6d00;' ],
				"This release is marked for {$action}, but infrastructure " .
				"(pinned_on: " . implode( ', ', (array)$pinnedOn ) . ") is still active. " .
				"Cleanup is pending."
			) . $reasonHtml );
		}

		// Determine if this release is a video:
		// 1. Explicit file_type in YAML
		// 2. Inferred from backlinks (pages using HLSVideo template link here)
		// file_type is a MIME type ("video/mp4") for most releases, but
		// delivery-kid writes the bare word "video" for Blue Railroad
		// submissions; those got no player at all.
		$fileType = (string)( $data['file_type'] ?? '' );
		$isVideo = $fileType === 'video' || str_starts_with( $fileType, 'video/' );
		if ( !$isVideo && ( $data['release_type'] ?? '' ) === 'video' ) {
			$isVideo = true;
		}
		if ( !$isVideo && $pageRef ) {
			$isVideo = $this->hasHLSVideoBacklink( $pageRef );
		}

		// The release's own name as the page's heading and the tab's title:
		// "Cory Walkers Birthday Banjo Cake", not "Release:QmUQwn…". The CID
		// stays in the table below, where it is still the release's address.
		$releaseTitle = is_string( $data['title'] ?? null ) ? trim( $data['title'] ) : '';
		if ( $releaseTitle !== '' ) {
			$output->setDisplayTitle( htmlspecialchars( $releaseTitle ) );
		}

		// Who brought it, and when, under the heading.
		$html .= $this->renderByline( $data );

		// Under the player and its description, before the details table:
		// what the uploader, and whoever released it, have to say about it,
		// and whether it has captions (Release:<CID>/captions, which the
		// player reads) and where to write them.
		$afterPlayer = $this->renderCommentary( $data['commentary'] ?? null );
		if ( $cid && $isVideo && $pageRef ) {
			$afterPlayer .= $this->renderCaptionsLink( $pageRef, $output );
		}

		// Render the release info
		$html .= $this->renderReleaseInfo( $cid, $data, $pageRef, $isVideo, $afterPlayer );

		// The card for wherever it's linked (see Hooks::onOutputPageParserOutput).
		$output->setExtensionData( self::CARD_KEY,
			$this->card( $cid, $data, $releaseTitle, $isVideo ) );

		// "Play in Rabbithole" button for track-type releases that have an
		// OGG encoding available. Opens the rabbithole demo (player +
		// timeline editor + ensemble visualization) for this track.
		$isTrack = ( $data['release_type'] ?? '' ) === 'track';
		$hasOgg = !empty( $data['encodings']['ogg'] );
		if ( $cid && $isTrack && $hasOgg ) {
			$html .= Html::rawElement( 'div',
				[ 'class' => 'release-rabbithole-link',
				  'style' => 'margin: 1em 0; padding: 0.75em;'
					. ' background: linear-gradient(135deg, #9db89a 0%, #87a96b 100%);'
					. ' border-radius: 6px; text-align: center;' ],
				Html::element( 'a',
					[ 'href' => '/rabbithole/?track=' . rawurlencode( $cid ),
					  'style' => 'color: #2d5016; text-decoration: none;'
						. ' font-weight: 600; font-size: 1.05em;' ],
					'🐇 Play in Rabbithole — edit timeline, see musicians' )
			);
		}

		// Track list for record-type Releases. tracks: array is populated
		// by blue-railroad-import's materialize-tracks job. Each row links
		// to that track's Release page (where users find the per-track
		// "Play in Rabbithole" button).
		$tracks = $data['tracks'] ?? null;
		if ( is_array( $tracks ) && !empty( $tracks ) ) {
			$html .= $this->renderTrackList( $tracks );
		}

		// Get and render backlinks
		if ( $pageRef ) {
			$html .= $this->renderBacklinks( $pageRef );
		}

		// Add raw YAML view if there's any content
		$yamlText = trim( $content->getText() );
		if ( !empty( $yamlText ) && !$this->isOnlyComments( $yamlText ) ) {
			$html .= $this->renderRawYaml( $yamlText );
		}

		$output->setRawText( $html );

		// Add categories for organization
		if ( $pageRef ) {
			$output->addCategory( 'Releases' );

			// Add category based on pin status
			if ( !empty( $data['pinned_on'] ) ) {
				$output->addCategory( 'Pinned_Releases' );
			}

			// Add category based on release type
			$releaseType = $data['release_type'] ?? null;
			if ( $releaseType ) {
				$typeCategoryMap = [
					'video' => 'Video_Releases',
					'record' => 'Record_Releases',
					'blue-railroad' => 'Blue_Railroad_Releases',
					'other' => 'Other_Releases',
				];
				if ( isset( $typeCategoryMap[$releaseType] ) ) {
					$output->addCategory( $typeCategoryMap[$releaseType] );
				}
			}
		}

		// Emit Semantic MediaWiki properties if SMW is available
		if ( $pageRef && class_exists( \SMW\DIProperty::class ) ) {
			try {
				$this->setSemanticProperties( $output, $cid, $data, $pageRef );
			} catch ( \Throwable $e ) {
				// Don't let SMW errors break page rendering
				wfDebugLog( 'PickiPediaReleases',
					'SMW property emission failed: ' . $e->getMessage()
				);
			}
		}
	}

	/**
	 * Emit Semantic MediaWiki properties for this Release page.
	 *
	 * Uses DIProperty with explicit type IDs and DIBlob/DINumber directly,
	 * since DataValueFactory defaults to Page type for unknown properties.
	 *
	 * @param ParserOutput $output
	 * @param string|null $cid
	 * @param array $data
	 * @param mixed $pageRef
	 */
	private function setSemanticProperties(
		ParserOutput $output,
		?string $cid,
		array $data,
		$pageRef
	): void {
		$title = \MediaWiki\MediaWikiServices::getInstance()
			->getTitleFactory()
			->makeTitle( $pageRef->getNamespace(), $pageRef->getDBkey() );

		$subject = \SMW\DIWikiPage::newFromTitle( $title );
		$semanticData = new \SMW\SemanticData( $subject );

		// Helper to add a text property
		$addText = function ( string $propName, string $value ) use ( $semanticData ) {
			$prop = new \SMW\DIProperty( $propName );
			$prop->setPropertyTypeId( '_txt' );
			$semanticData->addPropertyObjectValue( $prop, new \SMWDIBlob( $value ) );
		};

		if ( $cid ) {
			$normalizedCid = str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
			$addText( 'IPFS_CID', $normalizedCid );
		}
		if ( !empty( $data['title'] ) ) {
			$addText( 'Release_title', $data['title'] );
		}
		if ( !empty( $data['release_type'] ) ) {
			$addText( 'Release_type', $data['release_type'] );
		}
		if ( !empty( $data['file_type'] ) ) {
			$addText( 'File_type', $data['file_type'] );
		}
		if ( !empty( $data['file_size'] ) ) {
			$prop = new \SMW\DIProperty( 'File_size' );
			$prop->setPropertyTypeId( '_num' );
			$semanticData->addPropertyObjectValue( $prop, new \SMWDINumber( (float)(int)$data['file_size'] ) );
		}
		if ( !empty( $data['pinned_on'] ) ) {
			$pinnedList = is_array( $data['pinned_on'] )
				? implode( ', ', $data['pinned_on'] )
				: (string)$data['pinned_on'];
			$addText( 'Pinned_on', $pinnedList );
		}
		if ( !empty( $data['bittorrent_infohash'] ) ) {
			$addText( 'BitTorrent_infohash', $data['bittorrent_infohash'] );
		}
		if ( !empty( $data['description'] ) ) {
			$addText( 'Release_description', $data['description'] );
		}

		// Write directly to SMW store — custom content handlers bypass
		// SMW's parser hooks, so the ParserOutput pipeline doesn't work.
		$store = \SMW\StoreFactory::getStore();
		$store->updateData( $semanticData );
	}

	/**
	 * Check if YAML content is only comments
	 *
	 * @param string $yaml
	 * @return bool
	 */
	private function isOnlyComments( string $yaml ): bool {
		$lines = explode( "\n", $yaml );
		foreach ( $lines as $line ) {
			$trimmed = trim( $line );
			if ( $trimmed !== '' && $trimmed[0] !== '#' ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Render the main release info section
	 *
	 * @param string|null $cid
	 * @param array $data
	 * @param mixed $pageRef
	 * @return string
	 */
	private function renderReleaseInfo(
		?string $cid, array $data, $pageRef, bool $isVideo = false, string $afterPlayer = ''
	): string {
		$html = Html::openElement( 'div', [ 'class' => 'release-info' ] );

		// Render video player if this release is a video
		if ( $cid && $isVideo ) {
			$html .= Html::element( 'div', [
				'class' => 'hls-video-player',
				'data-cid' => $cid,
				'data-width' => '100%',
				'data-max-width' => '800px',
			] );

		}

		// The title from the YAML is the page's own heading now (setDisplayTitle).
		// Its description reads as the page's opening words, not a table cell.
		if ( is_string( $data['description'] ?? null ) && trim( $data['description'] ) !== '' ) {
			$html .= Html::rawElement( 'div', [ 'class' => 'release-lede' ],
				nl2br( htmlspecialchars( trim( $data['description'] ) ) ) );
		}
		$html .= $afterPlayer;

		$html .= Html::openElement( 'table', [ 'class' => 'release-metadata wikitable' ] );

		// CID from page title (primary identifier)
		if ( $cid ) {
			$html .= Html::openElement( 'tr', [ 'class' => 'release-cid' ] );
			$html .= Html::element( 'th', [], 'IPFS CID' );
			$html .= Html::rawElement( 'td', [], $this->renderIpfsLink( $cid ) );
			$html .= Html::closeElement( 'tr' );
		}

		// Pin status from YAML
		if ( !empty( $data['pinned_on'] ) ) {
			$html .= Html::openElement( 'tr' );
			$html .= Html::element( 'th', [], 'Pinned On' );
			$pinnedList = is_array( $data['pinned_on'] )
				? implode( ', ', $data['pinned_on'] )
				: (string)$data['pinned_on'];
			$html .= Html::element( 'td', [ 'class' => 'release-pinned' ], $pinnedList );
			$html .= Html::closeElement( 'tr' );
		}

		// BitTorrent infohash if present
		if ( !empty( $data['bittorrent_infohash'] ) ) {
			$html .= Html::openElement( 'tr' );
			$html .= Html::element( 'th', [], 'BitTorrent' );
			$html .= Html::rawElement( 'td', [],
				$this->renderTorrentLink(
					$data['bittorrent_infohash'],
					$data['title'] ?? $cid,
					$data['bittorrent_trackers'] ?? [],
					$data['bittorrent_webseeds'] ?? [],
					$data['bittorrent_torrent_url'] ?? null
				)
			);
			$html .= Html::closeElement( 'tr' );
		}

		// File info if present
		if ( !empty( $data['file_type'] ) || !empty( $data['file_size'] ) ) {
			$html .= Html::openElement( 'tr' );
			$html .= Html::element( 'th', [], 'File Info' );
			$info = [];
			if ( !empty( $data['file_type'] ) ) {
				$info[] = htmlspecialchars( $data['file_type'] );
			}
			if ( !empty( $data['file_size'] ) ) {
				$info[] = $this->formatFileSize( (int)$data['file_size'] );
			}
			$html .= Html::rawElement( 'td', [], implode( ' · ', $info ) );
			$html .= Html::closeElement( 'tr' );
		}

		// Embed code for video releases
		if ( $cid && $isVideo ) {
			$normalizedCid = str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
			$embedCode = "{{HLSVideo|{$normalizedCid}|width=400px}}";
			$html .= Html::openElement( 'tr' );
			$html .= Html::element( 'th', [], 'Embed' );
			$html .= Html::rawElement( 'td', [],
				Html::element( 'code', [
					'id' => 'release-embed-code',
				], $embedCode ) . ' ' .
				Html::element( 'button', [
					'class' => 'release-copy-btn',
					'onclick' => "navigator.clipboard.writeText('" . htmlspecialchars( $embedCode, ENT_QUOTES ) . "').then(function(){var b=event.target;b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},1500)})",
					'style' => 'cursor:pointer; padding:2px 8px;',
				], 'Copy' )
			);
			$html .= Html::closeElement( 'tr' );
		}

		$html .= Html::closeElement( 'table' );
		$html .= Html::closeElement( 'div' );

		return $html;
	}

	/**
	 * "Uploaded by SkymanJenkins · block 26,172,962 · 12 Oct 2026", from
	 * what delivery-kid and the draft wrote. Only what's there is said.
	 *
	 * @param array $data
	 * @return string
	 */
	private function renderByline( array $data ): string {
		$parts = [];
		$by = is_string( $data['uploaded_by'] ?? null ) ? trim( $data['uploaded_by'] ) : '';
		if ( str_starts_with( $by, 'wiki:' ) ) {
			$name = substr( $by, 5 );
			$user = \MediaWiki\Title\Title::makeTitleSafe( NS_USER, $name );
			$parts[] = 'Uploaded by ' . ( $user
				? Html::element( 'a', [ 'href' => $user->getLocalURL() ], $name )
				: htmlspecialchars( $name ) );
		} elseif ( $by !== '' ) {
			$parts[] = 'Uploaded by ' . Html::element( 'code', [], $by );
		}
		$block = $data['upload_blockheight'] ?? null;
		if ( is_numeric( $block ) && (int)$block > 0 ) {
			$parts[] = Html::element( 'span', [ 'class' => 'release-block' ],
				'block ' . number_format( (int)$block ) );
		}
		$at = is_string( $data['created_at'] ?? null ) ? strtotime( $data['created_at'] ) : false;
		if ( $at ) {
			$parts[] = Html::element( 'time', [ 'datetime' => gmdate( 'c', $at ) ], gmdate( 'j M Y', $at ) );
		}
		if ( !$parts ) {
			return '';
		}
		return Html::rawElement( 'div', [ 'class' => 'release-byline' ], implode( ' · ', $parts ) );
	}

	/**
	 * Commentary: words about the release from the people who made it go.
	 *
	 *   commentary:
	 *     - by: SkymanJenkins
	 *       role: uploader
	 *       text: |
	 *         Cory turned 40 and the cake was a banjo.
	 *
	 * Plain text, paragraphs on blank lines; `by` is a wiki user name. A
	 * person writes it: nothing here generates it.
	 *
	 * @param mixed $commentary
	 * @return string
	 */
	private function renderCommentary( $commentary ): string {
		if ( !is_array( $commentary ) || !$commentary ) {
			return '';
		}
		$items = '';
		foreach ( $commentary as $note ) {
			if ( !is_array( $note ) ) {
				continue;
			}
			$text = is_string( $note['text'] ?? null ) ? trim( $note['text'] ) : '';
			if ( $text === '' ) {
				continue;
			}
			$paragraphs = '';
			foreach ( preg_split( "/\n\s*\n/", $text ) as $para ) {
				$paragraphs .= Html::rawElement( 'p', [], nl2br( htmlspecialchars( trim( $para ) ) ) );
			}
			$by = is_string( $note['by'] ?? null ) ? trim( preg_replace( '/^wiki:/', '', $note['by'] ) ) : '';
			$role = is_string( $note['role'] ?? null ) ? trim( $note['role'] ) : '';
			$who = '';
			if ( $by !== '' ) {
				$user = \MediaWiki\Title\Title::makeTitleSafe( NS_USER, $by );
				$who = $user
					? Html::element( 'a', [ 'href' => $user->getLocalURL() ], $by )
					: htmlspecialchars( $by );
			}
			$cite = trim( $who . ( $role !== '' ? Html::element( 'span', [ 'class' => 'release-commentary-role' ], $role ) : '' ) );
			$items .= Html::rawElement( 'figure', [ 'class' => 'release-commentary-note' ],
				Html::rawElement( 'blockquote', [], $paragraphs )
				. ( $cite !== '' ? Html::rawElement( 'figcaption', [], '— ' . $cite ) : '' )
			);
		}
		if ( $items === '' ) {
			return '';
		}
		return Html::rawElement( 'section', [ 'class' => 'release-commentary' ], $items );
	}

	/**
	 * A line saying whether this release has captions, linking to where they
	 * are written: Release:<CID>/captions, in WebVTT or SRT.
	 *
	 * @param mixed $pageRef
	 * @param ParserOutput $output
	 * @return string
	 */
	private function renderCaptionsLink( $pageRef, ParserOutput $output ): string {
		$captions = \MediaWiki\Title\Title::makeTitleSafe(
			$pageRef->getNamespace(), $pageRef->getDBkey() . '/captions' );
		if ( !$captions ) {
			return '';
		}
		// Recorded as links, so this line is redrawn when the captions page
		// is made (its links) or edited (its use as a template), rather than
		// saying "no captions yet" from the parser cache.
		$output->addLink( $captions );
		if ( $captions->exists() ) {
			$output->addTemplate( $captions, $captions->getArticleID(), $captions->getLatestRevID() );
		}
		if ( $captions->exists() ) {
			$words = Html::element( 'a', [ 'href' => $captions->getLocalURL() ], 'Captions' )
				. ' on, with CC under the player · '
				. Html::element( 'a', [ 'href' => $captions->getLocalURL( [ 'action' => 'edit' ] ) ], 'edit them' );
		} else {
			$words = 'No captions yet · '
				. Html::element( 'a', [
					'href' => $captions->getLocalURL( [ 'action' => 'edit' ] ),
					'title' => 'WebVTT or SRT: paste what VEED, Whisper or a person made',
				], 'add them' )
				. ' (WebVTT or SRT)';
		}
		return Html::rawElement( 'div', [ 'class' => 'release-captions' ], '💬 ' . $words );
	}

	/**
	 * What the link card says: title, a line of description, and a still.
	 *
	 * @param string|null $cid
	 * @param array $data
	 * @param string $releaseTitle
	 * @param bool $isVideo
	 * @return array
	 */
	private function card( ?string $cid, array $data, string $releaseTitle, bool $isVideo ): array {
		$normalizedCid = $cid && str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
		$description = is_string( $data['description'] ?? null ) ? trim( $data['description'] ) : '';
		if ( $description === '' && is_array( $data['commentary'] ?? null ) ) {
			foreach ( $data['commentary'] as $note ) {
				if ( is_array( $note ) && is_string( $note['text'] ?? null ) && trim( $note['text'] ) !== '' ) {
					$description = trim( $note['text'] );
					break;
				}
			}
		}
		if ( $description === '' ) {
			$by = is_string( $data['uploaded_by'] ?? null ) ? preg_replace( '/^wiki:/', '', $data['uploaded_by'] ) : '';
			$kind = $isVideo ? 'A video' : 'A release';
			$description = $by !== '' ? "{$kind} on PickiPedia, uploaded by {$by}." : "{$kind} on PickiPedia.";
		}
		$description = mb_strimwidth( preg_replace( '/\s+/', ' ', $description ), 0, 280, '…' );
		$poster = $data['transcode']['poster'] ?? null;
		$image = ( $normalizedCid && $isVideo && is_string( $poster ) && $poster !== '' )
			? self::IPFS_GATEWAY . $normalizedCid . '/' . rawurlencode( $poster )
			: null;
		$type = ( $data['release_type'] ?? '' ) === 'track' ? 'music.song'
			: ( $isVideo ? 'video.other' : 'website' );
		return [
			'title' => $releaseTitle !== '' ? $releaseTitle : (string)$normalizedCid,
			'description' => $description,
			'image' => $image,
			'type' => $type,
		];
	}

	/**
	 * Render the tracks: array on a record-type Release as a clickable
	 * list. Each entry links to the track's Release page, which carries
	 * its own "Play in Rabbithole" button + per-track metadata.
	 *
	 * @param array $tracks  Each row: { cid, title, track_number }
	 * @return string
	 */
	private function renderTrackList( array $tracks ): string {
		$html = Html::openElement( 'div', [
			'class' => 'release-track-list',
			'style' => 'margin: 1.25em 0;',
		] );
		$html .= Html::element( 'h3',
			[ 'style' => 'margin: 0 0 0.5em; color: #2d5016;' ],
			'Tracks' );
		$html .= Html::openElement( 'ol', [
			'class' => 'release-track-list-items',
			'style' => 'list-style: decimal inside; padding: 0; margin: 0;'
				. ' background: #f8faf6; border: 1px solid #d4d8d2;'
				. ' border-radius: 6px;',
		] );
		foreach ( $tracks as $track ) {
			if ( !is_array( $track ) || empty( $track['cid'] ) ) {
				continue;
			}
			$cid = $track['cid'];
			$title = $track['title'] ?? $cid;
			$num = $track['track_number'] ?? null;

			$row = Html::rawElement( 'li',
				[ 'style' => 'padding: 0.5em 0.75em;'
					. ' border-bottom: 1px solid #e5e7e1;' ],
				Html::element( 'a',
					[ 'href' => '/wiki/Release:' . rawurlencode( $cid ),
					  'style' => 'color: #2d5016; font-weight: 600;'
						. ' margin-right: 0.5em;' ],
					$title )
				. Html::element( 'span',
					[ 'style' => 'font-family: ui-monospace, monospace;'
						. ' font-size: 0.85em; color: #999;' ],
					$cid )
				. ' '
				. Html::element( 'a',
					[ 'href' => '/rabbithole/?track=' . rawurlencode( $cid ),
					  'title' => 'Play in Rabbithole',
					  'style' => 'float: right; color: #4a7c59;'
						. ' text-decoration: none; font-weight: 600;' ],
					'🐇 Play' )
			);
			$html .= $row;
		}
		$html .= Html::closeElement( 'ol' );
		$html .= Html::closeElement( 'div' );
		return $html;
	}

	/**
	 * Render backlinks from other pages
	 *
	 * @param mixed $pageRef
	 * @return string
	 */
	private function renderBacklinks( $pageRef ): string {
		$services = \MediaWiki\MediaWikiServices::getInstance();
		$dbr = $services->getDBLoadBalancer()->getConnection( DB_REPLICA );

		// MediaWiki 1.43+ uses linktarget table instead of pl_namespace/pl_title
		// Query pages that link to this release via linktarget join
		$result = $dbr->newSelectQueryBuilder()
			->select( [ 'page_namespace', 'page_title' ] )
			->from( 'pagelinks' )
			->join( 'linktarget', null, 'pl_target_id = lt_id' )
			->join( 'page', null, 'pl_from = page_id' )
			->where( [
				'lt_namespace' => $pageRef->getNamespace(),
				'lt_title' => $pageRef->getDBkey(),
			] )
			->limit( 50 )
			->caller( __METHOD__ )
			->fetchResultSet();

		$links = [];
		foreach ( $result as $row ) {
			$title = $services->getTitleFactory()->makeTitle(
				$row->page_namespace,
				$row->page_title
			);
			$links[] = Html::element(
				'a',
				[ 'href' => $title->getLocalURL() ],
				$title->getPrefixedText()
			);
		}

		if ( empty( $links ) ) {
			return '';
		}

		$html = Html::openElement( 'div', [ 'class' => 'release-backlinks' ] );
		$html .= Html::element( 'h3', [], 'Referenced by' );
		$html .= Html::rawElement( 'ul', [],
			implode( '', array_map( fn( $link ) => Html::rawElement( 'li', [], $link ), $links ) )
		);
		$html .= Html::closeElement( 'div' );

		return $html;
	}

	/**
	 * Check if any page linking to this release uses the HLSVideo template.
	 *
	 * Joins pagelinks → page → templatelinks → linktarget to find pages
	 * that both link to this Release page and transclude Template:HLSVideo.
	 *
	 * @param mixed $pageRef
	 * @return bool
	 */
	private function hasHLSVideoBacklink( $pageRef ): bool {
		$services = \MediaWiki\MediaWikiServices::getInstance();
		$dbr = $services->getDBLoadBalancer()->getConnection( DB_REPLICA );

		// Find pages that link to this Release AND use Template:HLSVideo
		$result = $dbr->newSelectQueryBuilder()
			->select( '1' )
			->from( 'pagelinks' )
			->join( 'linktarget', 'lt_release', 'pl_target_id = lt_release.lt_id' )
			->join( 'templatelinks', null, 'pl_from = tl_from' )
			->join( 'linktarget', 'lt_template', 'tl_target_id = lt_template.lt_id' )
			->where( [
				'lt_release.lt_namespace' => $pageRef->getNamespace(),
				'lt_release.lt_title' => $pageRef->getDBkey(),
				'lt_template.lt_namespace' => NS_TEMPLATE,
				'lt_template.lt_title' => 'HLSVideo',
			] )
			->limit( 1 )
			->caller( __METHOD__ )
			->fetchResultSet();

		return $result->numRows() > 0;
	}

	/**
	 * Render validation errors as HTML
	 *
	 * @param StatusValue $status
	 * @return string
	 */
	private function renderValidationErrors( StatusValue $status ): string {
		$errors = $status->getMessages( 'error' );
		$errorHtml = Html::element( 'strong', [], 'Validation Errors:' );

		$errorList = Html::openElement( 'ul' );
		foreach ( $errors as $error ) {
			$errorList .= Html::element( 'li', [], wfMessage( $error )->text() );
		}
		$errorList .= Html::closeElement( 'ul' );

		return Html::rawElement( 'div', [ 'class' => 'release-validation-error' ],
			$errorHtml . $errorList
		);
	}

	/**
	 * Render an IPFS CID as a clickable link
	 *
	 * @param string $cid
	 * @return string
	 */
	private function renderIpfsLink( string $cid ): string {
		// CIDv1 (bafy...) is Base32 lowercase; MediaWiki capitalizes page titles,
		// so we must lowercase it back. CIDv0 (Qm...) is Base58, case-sensitive.
		$normalizedCid = str_starts_with( $cid, 'Bafy' ) ? strtolower( $cid ) : $cid;
		$gatewayUrl = "https://ipfs.io/ipfs/" . $normalizedCid;
		$dweb = "ipfs://{$normalizedCid}";

		return Html::rawElement( 'span', [ 'class' => 'release-ipfs-link' ],
			Html::element( 'code', [], $normalizedCid ) . ' ' .
			Html::element( 'a', [ 'href' => $gatewayUrl, 'rel' => 'nofollow' ], '[gateway]' ) . ' ' .
			Html::element( 'a', [ 'href' => $dweb ], '[ipfs://]' )
		);
	}

	/**
	 * Render a BitTorrent infohash as a magnet link
	 *
	 * @param string $infohash
	 * @param string $name
	 * @param array $trackers
	 * @param string|null $cid IPFS CID for webseed URL
	 * @return string
	 */
	private function renderTorrentLink( string $infohash, string $name, array $trackers = [], array $webseeds = [], ?string $torrentUrl = null ): string {
		$magnetUri = "magnet:?xt=urn:btih:{$infohash}";
		if ( $name ) {
			$magnetUri .= "&dn=" . urlencode( $name );
		}
		foreach ( $trackers as $tracker ) {
			$magnetUri .= "&tr=" . urlencode( $tracker );
		}
		foreach ( $webseeds as $webseed ) {
			$magnetUri .= "&ws=" . urlencode( $webseed );
		}

		$links = Html::element( 'a', [ 'href' => $magnetUri ], '[magnet]' );
		if ( $torrentUrl ) {
			$links .= ' ' . Html::element( 'a', [ 'href' => $torrentUrl ], '[.torrent]' );
		}

		return Html::rawElement( 'span', [ 'class' => 'release-torrent-link' ],
			Html::element( 'code', [], $infohash ) . ' ' . $links
		);
	}

	/**
	 * Format file size in human-readable format
	 *
	 * @param int $bytes
	 * @return string
	 */
	private function formatFileSize( int $bytes ): string {
		$units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
		$unitIndex = 0;
		$size = (float)$bytes;

		while ( $size >= 1024 && $unitIndex < count( $units ) - 1 ) {
			$size /= 1024;
			$unitIndex++;
		}

		return round( $size, 2 ) . ' ' . $units[$unitIndex] .
			' (' . number_format( $bytes ) . ' bytes)';
	}

	/**
	 * Render raw YAML in a collapsible section
	 *
	 * @param string $yaml
	 * @return string
	 */
	private function renderRawYaml( string $yaml ): string {
		return Html::rawElement( 'details', [ 'class' => 'release-raw-yaml' ],
			Html::element( 'summary', [], 'Raw YAML' ) .
			Html::element( 'pre', [], $yaml )
		);
	}

	/**
	 * @inheritDoc
	 */
	public function supportsDirectEditing(): bool {
		return true;
	}

	/**
	 * @inheritDoc
	 */
	public function supportsDirectApiEditing(): bool {
		return true;
	}

	/**
	 * @inheritDoc
	 */
	public function getActionOverrides(): array {
		return [];
	}
}
