<?php
/**
 * Special page for uploading content to delivery-kid pinning service.
 *
 * Wiki login is the auth layer. PHP proxies uploads to delivery-kid
 * using a shared API key — no wallet connection needed.
 *
 * Two-step flow:
 * 1. Upload files → shows analysis/preview
 * 2. Review metadata, finalize → pins to IPFS, shows result
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\Html\Html;
use MediaWiki\SpecialPage\SpecialPage;

class SpecialUploadContent extends SpecialPage {

	public function __construct() {
		parent::__construct( 'UploadContent', 'upload' );
	}

	/**
	 * @inheritDoc
	 */
	public function execute( $par ): void {
		$this->setHeaders();
		$this->checkPermissions();
		$out = $this->getOutput();
		$request = $this->getRequest();

		$out->addModuleStyles( [ 'ext.pickipediaReleases.upload.styles' ] );

		// Editable intro text
		$this->addWikitextMessage( 'special-uploadcontent-header' );

		$action = $request->getVal( 'action', '' );

		if ( $action === 'finalize' ) {
			$this->handleFinalize( $request );
		} elseif ( $action === 'delete' ) {
			$this->handleDelete( $request );
		} elseif ( $action === 'upload' && $request->wasPosted() ) {
			$this->handleUpload( $request );
		} elseif ( $request->getVal( 'draft_id' ) ) {
			$this->showReviewStep( $request->getVal( 'draft_id' ) );
		} else {
			$this->showUploadForm();
		}
	}

	/**
	 * Step 1: Show the file upload form.
	 */
	private function showUploadForm(): void {
		$out = $this->getOutput();

		$out->addHTML( '<div class="uc-step uc-step-active">' );
		$out->addHTML( Html::element( 'h3', [], 'Upload Files' ) );
		$out->addHTML( '<p>Select files to upload for review before pinning to IPFS.</p>' );
		$out->addHTML( '<p class="uc-hint">Audio (FLAC, WAV, MP3, OGG), ' .
			'Video (MP4, WebM, MOV, MKV), Images (JPG, PNG, WebP, GIF)</p>' );

		$out->addHTML( Html::openElement( 'form', [
			'method' => 'post',
			'enctype' => 'multipart/form-data',
			'action' => $this->getPageTitle()->getLocalURL( [ 'action' => 'upload' ] ),
		] ) );

		$out->addHTML( Html::input( 'wpEditToken', $this->getUser()->getEditToken(), 'hidden' ) );

		$out->addHTML( '<div class="uc-field">' );
		$out->addHTML( Html::element( 'label', [ 'for' => 'uc-files' ], 'Files' ) );
		$out->addHTML( Html::input( 'files[]', '', 'file', [
			'id' => 'uc-files',
			'multiple' => true,
			'accept' => '.flac,.wav,.mp3,.ogg,.m4a,.aac,.opus,.mp4,.webm,.mov,.mkv,.avi,.ts,.jpg,.jpeg,.png,.webp,.gif,.svg',
		] ) );
		$out->addHTML( '</div>' );

		$out->addHTML( Html::submitButton( 'Upload & Analyze', [
			'class' => 'cdx-button cdx-button--action-progressive cdx-button--weight-primary',
		] ) );

		$out->addHTML( Html::closeElement( 'form' ) );
		$out->addHTML( '</div>' );
	}

	/**
	 * Handle file upload POST — send files to delivery-kid, show review form.
	 */
	private function handleUpload( \MediaWiki\Request\WebRequest $request ): void {
		$out = $this->getOutput();
		$user = $this->getUser();

		if ( !$user->matchEditToken( $request->getVal( 'wpEditToken' ) ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Invalid session token. Please try again.</div>' );
			$this->showUploadForm();
			return;
		}

		$uploadedFiles = $request->getUploadDir() !== null ? $_FILES['files'] ?? null : null;
		// Fallback: PHP populates $_FILES directly
		if ( $uploadedFiles === null ) {
			$uploadedFiles = $_FILES['files'] ?? null;
		}

		if ( !$uploadedFiles || empty( $uploadedFiles['name'][0] ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">No files selected.</div>' );
			$this->showUploadForm();
			return;
		}

		$apiUrl = $this->getConfig()->get( 'DeliveryKidUrl' );
		$apiKey = $this->getConfig()->get( 'DeliveryKidApiKey' );

		// Build multipart POST to delivery-kid
		$curl = curl_init( $apiUrl . '/draft-content' );
		$postFields = [];

		// PHP receives multiple files as arrays of names/tmp_names/etc.
		$fileCount = count( $uploadedFiles['name'] );
		for ( $i = 0; $i < $fileCount; $i++ ) {
			if ( $uploadedFiles['error'][$i] !== UPLOAD_ERR_OK ) {
				continue;
			}
			$postFields["files[$i]"] = new \CURLFile(
				$uploadedFiles['tmp_name'][$i],
				$uploadedFiles['type'][$i],
				$uploadedFiles['name'][$i]
			);
		}

		if ( empty( $postFields ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">No valid files to upload.</div>' );
			$this->showUploadForm();
			return;
		}

		curl_setopt_array( $curl, [
			CURLOPT_POST => true,
			CURLOPT_POSTFIELDS => $postFields,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER => [
				'X-API-Key: ' . $apiKey,
				'X-Uploaded-By: wiki:' . $user->getName(),
			],
			CURLOPT_TIMEOUT => 120,
		] );

		$response = curl_exec( $curl );
		$httpCode = curl_getinfo( $curl, CURLINFO_HTTP_CODE );
		$curlError = curl_error( $curl );
		curl_close( $curl );

		if ( $curlError ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Connection error: ' .
				htmlspecialchars( $curlError ) . '</div>' );
			$this->showUploadForm();
			return;
		}

		$data = json_decode( $response, true );

		if ( $httpCode !== 200 || !$data ) {
			$detail = $data['detail'] ?? $response;
			$out->addHTML( '<div class="uc-status uc-status-error">Upload failed (' .
				$httpCode . '): ' . htmlspecialchars( $detail ) . '</div>' );
			$this->showUploadForm();
			return;
		}

		$this->showReviewForm( $data );
	}

	/**
	 * Step 2: Show review form with file analysis and metadata fields.
	 */
	private function showReviewForm( array $draft ): void {
		$out = $this->getOutput();

		$out->addHTML( '<div class="uc-step uc-step-active">' );
		$out->addHTML( Html::element( 'h3', [], 'Review & Finalize' ) );

		// File analysis table
		$out->addHTML( '<table class="wikitable">' );
		$out->addHTML( '<tr><th>File</th><th>Type</th><th>Format</th><th>Duration</th><th>Size</th></tr>' );

		$hasVideo = false;
		foreach ( $draft['files'] as $f ) {
			$out->addHTML( '<tr>' );
			$out->addHTML( Html::element( 'td', [], $f['original_filename'] ) );
			$out->addHTML( Html::element( 'td', [], $f['media_type'] ) );
			$out->addHTML( Html::element( 'td', [], $f['format'] ) );
			$duration = '';
			if ( !empty( $f['duration_seconds'] ) ) {
				$m = floor( $f['duration_seconds'] / 60 );
				$s = floor( $f['duration_seconds'] ) % 60;
				$duration = sprintf( '%d:%02d', $m, $s );
			}
			$out->addHTML( Html::element( 'td', [], $duration ) );
			$out->addHTML( Html::element( 'td', [], $this->formatFileSize( $f['size_bytes'] ) ) );
			$out->addHTML( '</tr>' );

			if ( !empty( $f['width'] ) && !empty( $f['height'] ) ) {
				$details = $f['width'] . 'x' . $f['height'];
				if ( !empty( $f['video_codec'] ) ) {
					$details .= ' · ' . $f['video_codec'];
				}
				if ( !empty( $f['audio_codec'] ) ) {
					$details .= ' · ' . $f['audio_codec'];
				}
				$out->addHTML( '<tr><td></td><td colspan="4">' .
					htmlspecialchars( $details ) . '</td></tr>' );
			}

			if ( $f['media_type'] === 'video' ) {
				$hasVideo = true;
			}
		}
		$out->addHTML( '</table>' );

		$out->addHTML( '<p class="uc-draft-expires">Draft ID: ' .
			htmlspecialchars( $draft['draft_id'] ) .
			' · Expires: ' . htmlspecialchars( $draft['expires_at'] ) . '</p>' );

		// Metadata form
		$out->addHTML( Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL( [ 'action' => 'finalize' ] ),
		] ) );

		$out->addHTML( Html::input( 'wpEditToken', $this->getUser()->getEditToken(), 'hidden' ) );
		$out->addHTML( Html::input( 'draft_id', $draft['draft_id'], 'hidden' ) );

		// Pre-fill title from first file
		$defaultTitle = '';
		if ( count( $draft['files'] ) === 1 && !empty( $draft['files'][0]['detected_title'] ) ) {
			$defaultTitle = $draft['files'][0]['detected_title'];
		}

		$out->addHTML( '<div class="uc-field">' );
		$out->addHTML( Html::element( 'label', [ 'for' => 'uc-title' ], 'Title' ) );
		$out->addHTML( Html::input( 'title', $defaultTitle, 'text', [
			'id' => 'uc-title',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'Content title',
		] ) );
		$out->addHTML( '</div>' );

		$out->addHTML( '<div class="uc-field">' );
		$out->addHTML( Html::element( 'label', [ 'for' => 'uc-description' ], 'Description' ) );
		$out->addHTML( Html::textarea( 'description', '', [
			'id' => 'uc-description',
			'class' => 'cdx-text-input__input',
			'rows' => 3,
			'placeholder' => 'Optional description',
		] ) );
		$out->addHTML( '</div>' );

		$out->addHTML( '<div class="uc-field">' );
		$out->addHTML( Html::element( 'label', [ 'for' => 'uc-file-type' ], 'File type override' ) );
		$out->addHTML( Html::input( 'file_type', '', 'text', [
			'id' => 'uc-file-type',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'e.g., video/webm (leave blank for auto)',
		] ) );
		$out->addHTML( '</div>' );

		$out->addHTML( '<div class="uc-field">' );
		$out->addHTML( Html::element( 'label', [ 'for' => 'uc-subsequent-to' ], 'Subsequent to (CID)' ) );
		$out->addHTML( Html::input( 'subsequent_to', '', 'text', [
			'id' => 'uc-subsequent-to',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'CID this content supersedes',
		] ) );
		$out->addHTML( '</div>' );

		if ( $hasVideo ) {
			$out->addHTML( '<div class="uc-field uc-checkbox-field">' );
			$out->addHTML( '<label>' );
			$out->addHTML( Html::check( 'transcode_hls', false ) );
			$out->addHTML( ' Transcode video to HLS before pinning</label>' );
			$out->addHTML( '</div>' );
		}

		$out->addHTML( '<div class="uc-button-row">' );
		$out->addHTML( Html::submitButton( 'Finalize & Pin to IPFS', [
			'class' => 'cdx-button cdx-button--action-progressive cdx-button--weight-primary',
		] ) );

		// Delete draft button (separate form)
		$out->addHTML( '</div>' );
		$out->addHTML( Html::closeElement( 'form' ) );

		$out->addHTML( Html::openElement( 'form', [
			'method' => 'post',
			'action' => $this->getPageTitle()->getLocalURL( [ 'action' => 'delete' ] ),
			'style' => 'display:inline; margin-top:0.5em;',
		] ) );
		$out->addHTML( Html::input( 'wpEditToken', $this->getUser()->getEditToken(), 'hidden' ) );
		$out->addHTML( Html::input( 'draft_id', $draft['draft_id'], 'hidden' ) );
		$out->addHTML( Html::submitButton( 'Delete Draft', [
			'class' => 'cdx-button cdx-button--action-destructive',
		] ) );
		$out->addHTML( Html::closeElement( 'form' ) );

		$out->addHTML( '</div>' );
	}

	/**
	 * Retrieve an existing draft and show the review form.
	 */
	private function showReviewStep( string $draftId ): void {
		$out = $this->getOutput();
		$apiUrl = $this->getConfig()->get( 'DeliveryKidUrl' );
		$apiKey = $this->getConfig()->get( 'DeliveryKidApiKey' );

		$curl = curl_init( $apiUrl . '/draft-content/' . urlencode( $draftId ) );
		curl_setopt_array( $curl, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER => [
				'X-API-Key: ' . $apiKey,
				'X-Uploaded-By: wiki:' . $this->getUser()->getName(),
			],
			CURLOPT_TIMEOUT => 30,
		] );

		$response = curl_exec( $curl );
		$httpCode = curl_getinfo( $curl, CURLINFO_HTTP_CODE );
		curl_close( $curl );

		$data = json_decode( $response, true );

		if ( $httpCode !== 200 || !$data ) {
			$detail = $data['detail'] ?? 'Draft not found or expired.';
			$out->addHTML( '<div class="uc-status uc-status-error">' .
				htmlspecialchars( $detail ) . '</div>' );
			$this->showUploadForm();
			return;
		}

		$this->showReviewForm( $data );
	}

	/**
	 * Handle finalization — POST to delivery-kid, consume SSE stream, show result.
	 */
	private function handleFinalize( \MediaWiki\Request\WebRequest $request ): void {
		$out = $this->getOutput();
		$user = $this->getUser();

		if ( !$user->matchEditToken( $request->getVal( 'wpEditToken' ) ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Invalid session token.</div>' );
			return;
		}

		$draftId = $request->getVal( 'draft_id' );
		if ( !$draftId ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Missing draft ID.</div>' );
			return;
		}

		$apiUrl = $this->getConfig()->get( 'DeliveryKidUrl' );
		$apiKey = $this->getConfig()->get( 'DeliveryKidApiKey' );

		$body = json_encode( [
			'title' => $request->getVal( 'title' ) ?: null,
			'description' => $request->getVal( 'description' ) ?: null,
			'file_type' => $request->getVal( 'file_type' ) ?: null,
			'subsequent_to' => $request->getVal( 'subsequent_to' ) ?: null,
			'transcode_hls' => (bool)$request->getVal( 'transcode_hls' ),
			'metadata' => [],
		] );

		$curl = curl_init( $apiUrl . '/draft-content/' . urlencode( $draftId ) . '/finalize' );
		curl_setopt_array( $curl, [
			CURLOPT_POST => true,
			CURLOPT_POSTFIELDS => $body,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER => [
				'Content-Type: application/json',
				'X-API-Key: ' . $apiKey,
				'X-Uploaded-By: wiki:' . $user->getName(),
			],
			CURLOPT_TIMEOUT => 600, // Transcoding can take a while
		] );

		$response = curl_exec( $curl );
		$httpCode = curl_getinfo( $curl, CURLINFO_HTTP_CODE );
		$curlError = curl_error( $curl );
		curl_close( $curl );

		if ( $curlError ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Connection error: ' .
				htmlspecialchars( $curlError ) . '</div>' );
			return;
		}

		if ( $httpCode !== 200 ) {
			$data = json_decode( $response, true );
			$detail = $data['detail'] ?? $response;
			$out->addHTML( '<div class="uc-status uc-status-error">Finalization failed (' .
				$httpCode . '): ' . htmlspecialchars( $detail ) . '</div>' );
			return;
		}

		// Parse SSE response to find the final 'complete' or 'error' event
		$result = $this->parseSSEResponse( $response );

		if ( $result === null ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Unexpected response from pinning service.</div>' );
			return;
		}

		if ( isset( $result['error'] ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Pinning failed: ' .
				htmlspecialchars( $result['error'] ) . '</div>' );
			return;
		}

		// Success — show result
		$this->showResult( $result );
	}

	/**
	 * Handle draft deletion.
	 */
	private function handleDelete( \MediaWiki\Request\WebRequest $request ): void {
		$out = $this->getOutput();
		$user = $this->getUser();

		if ( !$user->matchEditToken( $request->getVal( 'wpEditToken' ) ) ) {
			$out->addHTML( '<div class="uc-status uc-status-error">Invalid session token.</div>' );
			return;
		}

		$draftId = $request->getVal( 'draft_id' );
		$apiUrl = $this->getConfig()->get( 'DeliveryKidUrl' );
		$apiKey = $this->getConfig()->get( 'DeliveryKidApiKey' );

		$curl = curl_init( $apiUrl . '/draft-content/' . urlencode( $draftId ) );
		curl_setopt_array( $curl, [
			CURLOPT_CUSTOMREQUEST => 'DELETE',
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER => [
				'X-API-Key: ' . $apiKey,
				'X-Uploaded-By: wiki:' . $user->getName(),
			],
			CURLOPT_TIMEOUT => 30,
		] );

		curl_exec( $curl );
		curl_close( $curl );

		$out->addHTML( '<div class="uc-status uc-status-success">Draft deleted.</div>' );
		$this->showUploadForm();
	}

	/**
	 * Parse an SSE response body and return the data from the last meaningful event.
	 *
	 * @param string $response Raw SSE response
	 * @return array|null Parsed data from 'complete' or 'error' event
	 */
	private function parseSSEResponse( string $response ): ?array {
		$lastEvent = '';
		$lastData = null;

		foreach ( explode( "\n", $response ) as $line ) {
			$line = trim( $line );
			if ( str_starts_with( $line, 'event:' ) ) {
				$lastEvent = trim( substr( $line, 6 ) );
			} elseif ( str_starts_with( $line, 'data:' ) ) {
				$json = trim( substr( $line, 5 ) );
				$parsed = json_decode( $json, true );
				if ( $parsed !== null ) {
					if ( $lastEvent === 'complete' ) {
						return $parsed;
					} elseif ( $lastEvent === 'error' ) {
						return [ 'error' => $parsed['message'] ?? 'Unknown error' ];
					}
					$lastData = $parsed;
				}
			}
		}

		return $lastData;
	}

	/**
	 * Show pinning result with CID and links.
	 */
	private function showResult( array $data ): void {
		$out = $this->getOutput();

		$out->addHTML( '<div class="uc-step uc-step-active">' );
		$out->addHTML( '<div class="uc-result-card">' );
		$out->addHTML( Html::element( 'h3', [], 'Content Pinned Successfully' ) );

		$out->addHTML( '<table class="wikitable">' );

		if ( !empty( $data['title'] ) ) {
			$out->addHTML( '<tr>' . Html::element( 'th', [], 'Title' ) .
				Html::element( 'td', [], $data['title'] ) . '</tr>' );
		}

		$cid = $data['cid'] ?? '';
		$out->addHTML( '<tr>' . Html::element( 'th', [], 'CID' ) .
			Html::element( 'td', [ 'class' => 'release-cid-cell' ], $cid ) . '</tr>' );

		if ( !empty( $data['gateway_url'] ) ) {
			$out->addHTML( '<tr>' . Html::element( 'th', [], 'Gateway' ) .
				'<td>' . Html::element( 'a', [
					'href' => $data['gateway_url'],
					'target' => '_blank',
				], $data['gateway_url'] ) . '</td></tr>' );
		}

		$pinata = !empty( $data['pinata'] ) ? 'Yes' : 'No';
		$out->addHTML( '<tr>' . Html::element( 'th', [], 'Pinata' ) .
			Html::element( 'td', [], $pinata ) . '</tr>' );

		if ( !empty( $data['subsequent_to'] ) ) {
			$out->addHTML( '<tr>' . Html::element( 'th', [], 'Supersedes' ) .
				Html::element( 'td', [], $data['subsequent_to'] ) . '</tr>' );
		}

		$out->addHTML( '</table>' );

		// Link to Release page
		if ( $cid ) {
			$releaseTitle = \Title::makeTitle( NS_RELEASE, $cid );
			if ( $releaseTitle ) {
				$out->addHTML( '<p>' . Html::element( 'a', [
					'href' => $releaseTitle->getLocalURL(),
					'class' => 'cdx-button cdx-button--action-progressive',
				], 'View Release Page' ) . '</p>' );
			}
		}

		$out->addHTML( '<p>' . Html::element( 'a', [
			'href' => $this->getPageTitle()->getLocalURL(),
			'class' => 'cdx-button',
		], 'Upload More Content' ) . '</p>' );

		$out->addHTML( '</div></div>' );
	}

	/**
	 * Parse and output a MediaWiki message as wikitext, if it exists and is non-empty.
	 */
	private function addWikitextMessage( string $msgKey ): void {
		$msg = $this->msg( $msgKey );
		if ( !$msg->isDisabled() ) {
			$this->getOutput()->addWikiTextAsInterface( $msg->plain() );
		}
	}

	/**
	 * Format file size in human-readable format.
	 */
	private function formatFileSize( int $bytes ): string {
		$units = [ 'B', 'KB', 'MB', 'GB' ];
		$size = (float)$bytes;
		$i = 0;
		while ( $size >= 1024 && $i < count( $units ) - 1 ) {
			$size /= 1024;
			$i++;
		}
		return round( $size, 1 ) . ' ' . $units[$i];
	}

	/**
	 * @inheritDoc
	 */
	protected function getGroupName(): string {
		return 'media';
	}
}
