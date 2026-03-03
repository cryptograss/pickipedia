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
		$defaultYaml = <<<'YAML'
# Release metadata
title:
ipfs_cid:

# Optional fields
# bittorrent_infohash:
# file_type: video/mp4
# file_size:
# description:
# created_at:
# source_url:
# bittorrent_trackers:
#   - udp://tracker.opentrackr.org:1337
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

		// Render the metadata table
		$data = $content->getData();
		if ( !empty( $data ) ) {
			$html .= $this->renderMetadataTable( $data );
		}

		// Add raw YAML view
		$html .= $this->renderRawYaml( $content->getText() );

		$output->setRawText( $html );

		// Add categories for organization
		$pageRef = $cpoParams->getPage();
		if ( $pageRef ) {
			$output->addCategory( 'Releases' );
		}
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
	 * Render the release metadata as an HTML table
	 *
	 * @param array $data
	 * @return string
	 */
	private function renderMetadataTable( array $data ): string {
		$html = Html::openElement( 'table', [ 'class' => 'release-metadata wikitable' ] );

		// Define the order and rendering of fields
		$fieldConfig = [
			'title' => [
				'label' => 'Title',
				'class' => 'release-title',
				'render' => fn( $v ) => htmlspecialchars( $v )
			],
			'ipfs_cid' => [
				'label' => 'IPFS CID',
				'render' => fn( $v ) => $this->renderIpfsLink( $v )
			],
			'bittorrent_infohash' => [
				'label' => 'BitTorrent Infohash',
				'render' => fn( $v ) => $this->renderTorrentLink( $v, $data['title'] ?? '' )
			],
			'file_type' => [
				'label' => 'File Type',
				'render' => fn( $v ) => htmlspecialchars( $v )
			],
			'file_size' => [
				'label' => 'File Size',
				'render' => fn( $v ) => $this->formatFileSize( (int)$v )
			],
			'description' => [
				'label' => 'Description',
				'class' => 'release-description',
				'render' => fn( $v ) => nl2br( htmlspecialchars( $v ) )
			],
			'created_at' => [
				'label' => 'Created',
				'render' => fn( $v ) => htmlspecialchars( $v )
			],
			'source_url' => [
				'label' => 'Source URL',
				'render' => fn( $v ) => Html::element( 'a',
					[ 'href' => $v, 'rel' => 'nofollow' ],
					$v
				)
			],
			'bittorrent_trackers' => [
				'label' => 'Trackers',
				'render' => fn( $v ) => $this->renderTrackers( $v )
			],
		];

		foreach ( $fieldConfig as $key => $config ) {
			if ( !isset( $data[$key] ) || $data[$key] === '' || $data[$key] === [] ) {
				continue;
			}

			$rowClass = $config['class'] ?? '';
			$html .= Html::openElement( 'tr', [ 'class' => $rowClass ] );
			$html .= Html::element( 'th', [], $config['label'] );
			$html .= Html::rawElement( 'td', [], $config['render']( $data[$key] ) );
			$html .= Html::closeElement( 'tr' );
		}

		// Render any additional fields not in the config
		$extraFields = array_diff_key( $data, $fieldConfig );
		foreach ( $extraFields as $key => $value ) {
			if ( $value === '' || $value === [] ) {
				continue;
			}
			$html .= Html::openElement( 'tr' );
			$html .= Html::element( 'th', [], ucfirst( str_replace( '_', ' ', $key ) ) );
			if ( is_array( $value ) ) {
				$html .= Html::rawElement( 'td', [],
					Html::element( 'pre', [], json_encode( $value, JSON_PRETTY_PRINT ) )
				);
			} else {
				$html .= Html::element( 'td', [], (string)$value );
			}
			$html .= Html::closeElement( 'tr' );
		}

		$html .= Html::closeElement( 'table' );
		return $html;
	}

	/**
	 * Render an IPFS CID as a clickable link
	 *
	 * @param string $cid
	 * @return string
	 */
	private function renderIpfsLink( string $cid ): string {
		$gatewayUrl = "https://ipfs.io/ipfs/{$cid}";
		$dweb = "ipfs://{$cid}";

		return Html::rawElement( 'span', [ 'class' => 'release-ipfs-link' ],
			Html::element( 'code', [], $cid ) . ' ' .
			Html::element( 'a', [ 'href' => $gatewayUrl, 'rel' => 'nofollow' ], '[gateway]' ) . ' ' .
			Html::element( 'a', [ 'href' => $dweb ], '[ipfs://]' )
		);
	}

	/**
	 * Render a BitTorrent infohash as a magnet link
	 *
	 * @param string $infohash
	 * @param string $name
	 * @return string
	 */
	private function renderTorrentLink( string $infohash, string $name ): string {
		$magnetUri = "magnet:?xt=urn:btih:{$infohash}";
		if ( $name ) {
			$magnetUri .= "&dn=" . urlencode( $name );
		}

		return Html::rawElement( 'span', [ 'class' => 'release-torrent-link' ],
			Html::element( 'code', [], $infohash ) . ' ' .
			Html::element( 'a', [ 'href' => $magnetUri ], '[magnet]' )
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
	 * Render tracker list
	 *
	 * @param array $trackers
	 * @return string
	 */
	private function renderTrackers( array $trackers ): string {
		if ( empty( $trackers ) ) {
			return '';
		}

		$html = Html::openElement( 'ul', [ 'style' => 'margin: 0; padding-left: 1.5em;' ] );
		foreach ( $trackers as $tracker ) {
			$html .= Html::element( 'li', [], $tracker );
		}
		$html .= Html::closeElement( 'ul' );
		return $html;
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
