<?php
/**
 * Hook handlers for PickiPediaReleases extension
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\Installer\Hook\LoadExtensionSchemaUpdatesHook;
use MediaWiki\Installer\DatabaseUpdater;
use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Html\Html;
use MediaWiki\Output\Hook\OutputPageParserOutputHook;
use MediaWiki\Output\OutputPage;
use Skin;

class Hooks implements LoadExtensionSchemaUpdatesHook, BeforePageDisplayHook, OutputPageParserOutputHook {

	/**
	 * Handle schema updates
	 *
	 * @param DatabaseUpdater $updater
	 */
	public function onLoadExtensionSchemaUpdates( $updater ): void {
		// No schema updates needed at this time
	}

	/**
	 * Inject delivery-kid auth config when viewing ReleaseDraft pages
	 * or any page that uses the DeliveryKidUpload form input.
	 *
	 * Upload tokens (for status checks and re-uploads) are given to all
	 * logged-in users. Finalize tokens are only given to users with the
	 * 'finalize-release' permission.
	 *
	 * @param OutputPage $out
	 * @param Skin $skin
	 */
	public function onBeforePageDisplay( $out, $skin ): void {
		$title = $out->getTitle();
		$isReleaseDraft = $title && $title->getNamespace() === NS_RELEASEDRAFT;

		// The video player, on every page.
		//
		// Loaded unconditionally because that is what it already does: it lived
		// in MediaWiki:Common.js, which runs everywhere. Players turn up on
		// Release pages, on jam and article pages that embed them, and inside
		// {{Src|video|...}} citations, so there is no one namespace to gate on.
		// The script does nothing at all unless the page contains a
		// .hls-video-player element.
		$out->addModules( 'ext.pickipediaReleases.videoPlayer' );

		// The rest of what MediaWiki:Common.js used to do, moved here for
		// the same reasons as the player. Loaded on every page because that
		// is what Common.js did; each script returns immediately unless the
		// form or element it cares about is on the page being shown.
		$out->addModules( 'ext.pickipediaReleases.blueRailroadDate' );
		$out->addModules( 'ext.pickipediaReleases.blocksAgo' );
		$out->addModules( 'ext.pickipediaReleases.instrumentForm' );

		// The zine look for user subpages (User:Name/Post), sent by the server
		// so the page arrives styled instead of flashing the default skin
		// first. See Zine.php.
		if ( Zine::applies( $out ) ) {
			Zine::addTo( $out );
		}

		// Also inject tokens on Special:FormEdit pages and any page using
		// the deliveryKidInput module (PageForms forms).
		$modules = $out->getModules();
		$hasDeliveryKidInput = in_array( 'ext.pickipediaReleases.deliveryKidInput', $modules );

		if ( !$isReleaseDraft && !$hasDeliveryKidInput ) {
			return;
		}

		$config = $out->getConfig();
		$apiKey = $config->get( 'DeliveryKidApiKey' );
		$apiUrl = $config->get( 'DeliveryKidUrl' );

		if ( !$apiKey || !$apiUrl ) {
			return;
		}

		$user = $out->getUser();
		$username = $user->getName();
		$timestamp = (int)( microtime( true ) * 1000 );

		// Upload token — any logged-in user can upload to staging
		$uploadToken = hash_hmac( 'sha256', "upload:{$username}:{$timestamp}", $apiKey );

		$jsVars = [
			'wgDeliveryKidUrl' => $apiUrl,
			'wgUploadToken' => $uploadToken,
			'wgUploadUser' => $username,
			'wgUploadTimestamp' => $timestamp,
			'wgCanFinalize' => false,
		];

		// Finalize token — only for users with finalize-release permission
		if ( $isReleaseDraft ) {
			$canFinalize = $user->isAllowed( 'finalize-release' );
			if ( $canFinalize ) {
				$finalizeToken = hash_hmac( 'sha256', "finalize:{$username}:{$timestamp}", $apiKey );
				$jsVars['wgFinalizeToken'] = $finalizeToken;
				$jsVars['wgCanFinalize'] = true;
			}
		}

		$out->addJsConfigVars( $jsVars );
	}

	/**
	 * Register the DeliveryKidUpload input type with PageForms.
	 *
	 * @param \PFFormPrinter &$formPrinter
	 */
	public function onPageForms__FormPrinterSetup( &$formPrinter ): void {
		$formPrinter->registerInputType(
			'MediaWiki\\Extension\\PickiPediaReleases\\DeliveryKidUploadInput'
		);
	}

	/**
	 * Sub-pages of a ReleaseDraft are not themselves release drafts.
	 *
	 * The ReleaseDraft namespace defaults every page to release-draft-yaml,
	 * whose validator requires draft_id and type. That is right for
	 * ReleaseDraft:<uuid>, and wrong for ReleaseDraft:<uuid>/diagnostics,
	 * which holds a log trail with no business carrying a type field.
	 *
	 * The effect was that delivery-kid's diagnostics snapshots were rejected
	 * on save, every time, since the feature shipped:
	 *
	 *   snapshot failed for ReleaseDraft:51f6b3a0-.../diagnostics:
	 *   ('releasedraft-missing-type', 'Release draft is missing a type field.')
	 *
	 * Nothing noticed, because the caller discarded the result — so the wiki
	 * copy of every draft's logs, the one that survives a delivery-kid
	 * rebuild, has never existed. Sub-pages get the JSON model instead, which
	 * is what the snapshot actually writes.
	 *
	 * @param \Title $title
	 * @param string &$model
	 * @return bool
	 */
	public function onContentHandlerDefaultModelFor( $title, &$model ) {
		if ( $title->getNamespace() === 3006 && str_contains( $title->getText(), '/' ) ) {
			$model = CONTENT_MODEL_JSON;
			return false;
		}
		// Release:<CID>/captions holds a release's captions as WebVTT (or
		// SRT), which the player reads with action=raw. They live on the wiki
		// rather than in the pin because a CID can't change, and captions
		// are written and corrected long after a release is pinned. Plain
		// text, not release-yaml: a cue line is not YAML.
		if ( $title->getNamespace() === NS_RELEASE && self::isCaptionsPage( $title->getText() ) ) {
			$model = CONTENT_MODEL_TEXT;
			return false;
		}
		return true;
	}

	/**
	 * Is this Release subpage a release's captions? "<CID>/captions".
	 *
	 * @param string $text Title text without the namespace
	 * @return bool
	 */
	public static function isCaptionsPage( string $text ): bool {
		return (bool)preg_match( '#^[^/]+/captions$#i', $text );
	}

	/**
	 * A Release page's link card: Open Graph and Twitter tags, so a release
	 * pasted into a chat, a Mood or a post shows its title, its words and a
	 * still from it rather than a bare CID. ReleaseContentHandler leaves what
	 * the card says on the ParserOutput (Release card data); this is where
	 * the page's head can be written to.
	 *
	 * @param OutputPage $out
	 * @param \MediaWiki\Parser\ParserOutput $parserOutput
	 */
	public function onOutputPageParserOutput( $out, $parserOutput ): void {
		$card = $parserOutput->getExtensionData( ReleaseContentHandler::CARD_KEY );
		if ( !is_array( $card ) || empty( $card['title'] ) ) {
			return;
		}
		$tags = [
			'og:site_name' => 'PickiPedia',
			'og:type' => $card['type'] ?? 'website',
			'og:title' => $card['title'],
			'og:url' => $out->getTitle() ? $out->getTitle()->getFullURL() : null,
			'og:description' => $card['description'] ?? null,
			'og:image' => $card['image'] ?? null,
			'og:image:alt' => !empty( $card['image'] ) ? $card['title'] : null,
		];
		$twitter = [
			'twitter:card' => !empty( $card['image'] ) ? 'summary_large_image' : 'summary',
			'twitter:title' => $card['title'],
			'twitter:description' => $card['description'] ?? null,
			'twitter:image' => $card['image'] ?? null,
		];
		$head = '';
		foreach ( $tags as $property => $value ) {
			if ( $value !== null && $value !== '' ) {
				$head .= Html::element( 'meta', [ 'property' => $property, 'content' => $value ] ) . "\n";
			}
		}
		foreach ( $twitter as $name => $value ) {
			if ( $value !== null && $value !== '' ) {
				$head .= Html::element( 'meta', [ 'name' => $name, 'content' => $value ] ) . "\n";
			}
		}
		if ( !empty( $card['description'] ) ) {
			$out->addMeta( 'description', $card['description'] );
		}
		$out->addHeadItem( 'pickipedia-release-card', $head );
	}
}
