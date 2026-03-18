<?php
/**
 * Special page for delivering video content via delivery-kid.
 *
 * Video-specific upload page with metadata fields tailored for
 * performance video: venue, performers, date/blockheight.
 *
 * Wiki login is the auth layer. PHP generates a short-lived HMAC token.
 * JavaScript uploads files directly to delivery-kid — no bytes pass through PHP.
 *
 * Flow:
 * 1. User logs in to wiki
 * 2. PHP generates HMAC upload token from shared API key
 * 3. JS uploads video directly to delivery-kid with the token
 * 4. JS creates a ReleaseDraft wiki page (type: video) and redirects there
 * 5. Review, metadata, and finalization happen on the ReleaseDraft page
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\Html\Html;
use MediaWiki\SpecialPage\SpecialPage;

class SpecialDeliverVideo extends SpecialPage {

	public function __construct() {
		parent::__construct( 'DeliverVideo' );
	}

	/**
	 * @inheritDoc
	 */
	public function execute( $par ): void {
		$this->setHeaders();
		$this->requireNamedUser();
		$out = $this->getOutput();
		$user = $this->getUser();

		$out->addModuleStyles( [ 'ext.pickipediaReleases.upload.styles' ] );
		$out->addModules( [ 'ext.pickipediaReleases.deliverVideo' ] );

		// Generate HMAC upload token
		$apiKey = $this->getConfig()->get( 'DeliveryKidApiKey' );
		$apiUrl = $this->getConfig()->get( 'DeliveryKidUrl' );
		$username = $user->getName();
		$timestamp = (int)( microtime( true ) * 1000 );
		$token = hash_hmac( 'sha256', "upload:{$username}:{$timestamp}", $apiKey );

		// Estimate current Ethereum block from wall-clock time
		// (post-merge: 12s slots from the merge block)
		$mergeBlock = 15537394;
		$mergeTimestamp = 1663224179;
		$slotTime = 12;
		$uploadBlockheight = $mergeBlock + intdiv( time() - $mergeTimestamp, $slotTime );

		// Pass config to JS — token is short-lived, not a persistent secret
		$out->addJsConfigVars( [
			'wgDeliveryKidUrl' => $apiUrl,
			'wgUploadToken' => $token,
			'wgUploadUser' => $username,
			'wgUploadTimestamp' => $timestamp,
			'wgUploadBlockheight' => $uploadBlockheight,
		] );

		// Editable intro text
		$this->addWikitextMessage( 'special-delivervideo-header' );

		$out->addHTML( $this->renderPageStructure() );
	}

	/**
	 * Render the HTML skeleton — video dropzone + metadata fields.
	 * After upload, JS creates a ReleaseDraft page and redirects.
	 */
	private function renderPageStructure(): string {
		$html = '';

		$html .= '<div id="dv-step-upload" class="uc-step uc-step-active">';
		$html .= '<h3>Upload Video</h3>';
		$html .= '<p>Upload a video file. After analysis, a draft page will be created for review and metadata editing.</p>';
		$html .= '<p class="uc-hint">Video will be transcoded to AV1 HLS (royalty-free) automatically on finalization.</p>';

		// Video dropzone
		$html .= '<div id="dv-dropzone" class="uc-dropzone">';
		$html .= '<p>Drag video file here or click to select</p>';
		$html .= '<p class="uc-hint">MP4, MKV, WebM, MOV, AVI &mdash; no size limit</p>';
		$html .= '<input type="file" id="dv-file-input" accept=".mp4,.mkv,.webm,.mov,.avi,.m4v,.ts" style="display:none">';
		$html .= '</div>';
		$html .= '<div id="dv-file-list" class="uc-file-list"></div>';

		// Required: Title
		$html .= '<h3>Title <span class="uc-required">(required)</span></h3>';
		$html .= '<div class="uc-metadata-form">';
		$html .= '<div class="uc-field">';
		$html .= Html::element( 'input', [
			'type' => 'text',
			'id' => 'dv-title',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'e.g. Flatpicking at Station Inn',
			'required' => true,
		] );
		$html .= '</div>';
		$html .= '</div>';

		// Optional metadata
		$html .= '<h3>Optional Details</h3>';
		$html .= '<p class="uc-hint">All of these can also be added or changed later on the draft page.</p>';
		$html .= '<div class="uc-metadata-form">';

		// Venue
		$html .= '<div class="uc-field">';
		$html .= Html::element( 'label', [ 'for' => 'dv-venue' ], 'Venue' );
		$html .= Html::element( 'input', [
			'type' => 'text',
			'id' => 'dv-venue',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'e.g. Station Inn, The Birchmere',
		] );
		$html .= '</div>';

		// Performers
		$html .= '<div class="uc-field">';
		$html .= Html::element( 'label', [ 'for' => 'dv-performers' ], 'Performers' );
		$html .= Html::element( 'input', [
			'type' => 'text',
			'id' => 'dv-performers',
			'class' => 'cdx-text-input__input',
			'placeholder' => 'Comma-separated names',
		] );
		$html .= '</div>';

		// Content blockheight — when the video was recorded
		$html .= '<div class="uc-field">';
		$html .= Html::element( 'label', [ 'for' => 'dv-content-blockheight' ], 'When was this recorded? (Ethereum block height)' );
		$html .= '<div class="rd-blockheight-row">';
		$html .= Html::element( 'input', [
			'type' => 'number',
			'id' => 'dv-content-blockheight',
			'class' => 'cdx-text-input__input rd-blockheight-input',
			'placeholder' => 'e.g. 24631327',
		] );
		$html .= Html::element( 'button', [
			'type' => 'button',
			'id' => 'dv-blockheight-now',
			'class' => 'cdx-button',
		], 'Current Block' );
		$html .= Html::element( 'span', [ 'id' => 'dv-blockheight-date', 'class' => 'rd-blockheight-date' ], '' );
		$html .= '</div>';
		$html .= '</div>';

		// Description
		$html .= '<div class="uc-field">';
		$html .= Html::element( 'label', [ 'for' => 'dv-description' ], 'Description' );
		$html .= Html::element( 'textarea', [
			'id' => 'dv-description',
			'class' => 'cdx-text-input__input',
			'rows' => 3,
			'placeholder' => 'Optional description',
		], '' );
		$html .= '</div>';

		$html .= '</div>';

		// Upload button
		$html .= '<button id="dv-upload-btn" class="cdx-button cdx-button--action-progressive cdx-button--weight-primary" disabled>Upload &amp; Analyze</button>';
		$html .= '<div id="dv-upload-progress" class="uc-progress-bar" style="display:none"><div class="uc-progress-fill"></div></div>';
		$html .= '<div id="dv-upload-status" class="uc-status"></div>';

		$html .= '</div>';

		return $html;
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
	 * @inheritDoc
	 */
	protected function getGroupName(): string {
		return 'media';
	}
}
