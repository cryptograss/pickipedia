<?php
/**
 * Special page for uploading content to delivery-kid pinning service.
 *
 * Provides a multi-step workflow:
 * 1. Connect wallet (MetaMask)
 * 2. Upload files -> creates draft on delivery-kid
 * 3. Review analysis, edit metadata
 * 4. Finalize -> transcode (if needed) + pin to IPFS
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

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

		$out->addModuleStyles( [ 'ext.pickipediaReleases.upload.styles' ] );
		$out->addModules( [ 'ext.pickipediaReleases.upload' ] );

		// Pass config to JS
		$out->addJsConfigVars( [
			'wgDeliveryKidUrl' => $this->getConfig()->get( 'DeliveryKidUrl' ),
		] );

		// Editable intro text
		$this->addWikitextMessage( 'special-uploadcontent-header' );

		$out->addHTML( $this->renderPageStructure() );
	}

	/**
	 * Render the HTML skeleton for the upload workflow.
	 * JS handles all interactivity.
	 */
	private function renderPageStructure(): string {
		$html = '';

		// Step 1: Wallet connection
		$html .= '<div id="uc-step-wallet" class="uc-step uc-step-active">';
		$html .= '<h3>Step 1: Connect Wallet</h3>';
		$html .= '<p>Connect your Ethereum wallet to authenticate with the pinning service.</p>';
		$html .= '<button id="uc-connect-wallet" class="cdx-button cdx-button--action-progressive cdx-button--weight-primary">Connect Wallet</button>';
		$html .= '<div id="uc-wallet-status" class="uc-status"></div>';
		$html .= '</div>';

		// Step 2: File upload
		$html .= '<div id="uc-step-upload" class="uc-step">';
		$html .= '<h3>Step 2: Upload Files</h3>';
		$html .= '<div id="uc-dropzone" class="uc-dropzone">';
		$html .= '<p>Drag files here or click to select</p>';
		$html .= '<p class="uc-hint">Audio (FLAC, WAV, MP3, OGG, M4A, AAC, OPUS), ';
		$html .= 'Video (MP4, WebM, MOV, MKV, AVI), ';
		$html .= 'Images (JPG, PNG, WebP, GIF)</p>';
		$html .= '<input type="file" id="uc-file-input" multiple style="display:none">';
		$html .= '</div>';
		$html .= '<div id="uc-file-list" class="uc-file-list"></div>';
		$html .= '<button id="uc-upload-btn" class="cdx-button cdx-button--action-progressive cdx-button--weight-primary" disabled>Upload Files</button>';
		$html .= '<div id="uc-upload-status" class="uc-status"></div>';
		$html .= '</div>';

		// Step 3: Review and metadata
		$html .= '<div id="uc-step-review" class="uc-step">';
		$html .= '<h3>Step 3: Review &amp; Metadata</h3>';
		$html .= '<div id="uc-draft-info" class="uc-draft-info"></div>';
		$html .= '<div class="uc-metadata-form">';
		$html .= '<div class="uc-field"><label for="uc-title">Title</label>';
		$html .= '<input type="text" id="uc-title" class="cdx-text-input__input" placeholder="Content title"></div>';
		$html .= '<div class="uc-field"><label for="uc-description">Description</label>';
		$html .= '<textarea id="uc-description" class="cdx-text-input__input" rows="3" placeholder="Optional description"></textarea></div>';
		$html .= '<div class="uc-field"><label for="uc-file-type">File type override</label>';
		$html .= '<input type="text" id="uc-file-type" class="cdx-text-input__input" placeholder="e.g., video/webm (leave blank for auto)"></div>';
		$html .= '<div class="uc-field"><label for="uc-subsequent-to">Subsequent to (CID)</label>';
		$html .= '<input type="text" id="uc-subsequent-to" class="cdx-text-input__input" placeholder="CID this content supersedes"></div>';
		$html .= '<div class="uc-field uc-checkbox-field">';
		$html .= '<label><input type="checkbox" id="uc-transcode-hls"> Transcode video to HLS before pinning</label></div>';
		$html .= '</div>';
		$html .= '<button id="uc-finalize-btn" class="cdx-button cdx-button--action-progressive cdx-button--weight-primary">Finalize &amp; Pin</button>';
		$html .= '<button id="uc-delete-draft-btn" class="cdx-button cdx-button--action-destructive">Delete Draft</button>';
		$html .= '</div>';

		// Step 4: Progress and result
		$html .= '<div id="uc-step-progress" class="uc-step">';
		$html .= '<h3>Step 4: Pinning</h3>';
		$html .= '<div id="uc-progress-bar" class="uc-progress-bar"><div class="uc-progress-fill"></div></div>';
		$html .= '<div id="uc-progress-status" class="uc-status"></div>';
		$html .= '<div id="uc-result" class="uc-result"></div>';
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
