<?php
/*
 * HighslideGallery adds highslide-style image/galleries and YouTube overlays to MediaWiki pages.
 * @Copyright (C) 2012 Brian McCloskey, David Van Winkle, Step Modifications, Inc.
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program; if not, see
 * < https://www.gnu.org/licenses/ >.
 *
 * PATCHED by PickiPedia/Magent: Modified onFunctionHsgImg() to use actual thumbnails
 * instead of full-size images with CSS max-width. This dramatically reduces page load
 * times for galleries with large images.
 */

if ( !defined( 'MEDIAWIKI' ) ) {
	die( 'This is a MediaWiki extension, and must be run from within MediaWiki.' );
}

class HighslideGallery {
	// HSG-owned gallery/group identity
	private static $hsgId; // current slideshow group id
	private static $isHsgGroupMember = false;
	private static $hsgLabel; // optional display label, derived from hsgid
	private static $lastHsgGroupId; // last slideshow group rendered on this page
	// Canonical default thumb width for ALL HSG thumbs (images + YT) when width is unset.
	private const DEFAULT_THUMB_WIDTH = 210;

	private static function getControlsPreset(): string {
		// Prefer explicit global override (LocalSettings.php).
		if ( isset( $GLOBALS['wgHSGControlsPreset'] ) && is_string( $GLOBALS['wgHSGControlsPreset'] ) ) {
			$val = trim( $GLOBALS['wgHSGControlsPreset'] );
			if ( $val !== '' ) {
				return $val;
			}
		}

		// Fall back to registered config (extension.json default is "classic").
		$config = \MediaWiki\MediaWikiServices::getInstance()->getMainConfig();
		$val = $config->get( 'wgHSGControlsPreset' );
		return is_string( $val ) ? $val : 'classic';
	}

	public static function AddResources( OutputPage &$out, Skin &$skin ): void {
		// Reset per-page state
		self::$hsgId = null;
		self::$isHsgGroupMember = false;
		self::$hsgLabel = null;
		self::$lastHsgGroupId = null;

		// Push the controls preset to mw.config on every page view.
		$preset = self::getControlsPreset();
		$out->addJsConfigVars( 'wgHSGControlsPreset', $preset );

		// Let ResourceLoader handle highslide.js + cfg + CSS.
		$out->addModules( 'ext.highslideGallery' );
		$out->addModuleStyles( 'ext.highslideGallery' );
	}

	// Parser hooks are non-abortable; return true. Use [self::class, 'method'].
	public static function AddHooks( Parser $parser ): bool {
		// -----------------------------------------------------------------
		// Tags
		// -----------------------------------------------------------------
		// Legacy tag - kept for backward compatibility
		$parser->setHook( 'hsyoutube', [ self::class, 'onTagHsYouTube' ] );

		// Canonical HSG tag for YouTube (ytb = all things YouTube)
		$parser->setHook( 'hsgytb', [ self::class, 'onTagHsgYtb' ] );

		// -----------------------------------------------------------------
		// Parser functions
		// -----------------------------------------------------------------
		$parser->setFunctionHook( 'hsgimg', [ self::class, 'onFunctionHsgImg' ] );
		$parser->setFunctionHook( 'hsgytb', [ self::class, 'onFunctionHsgYtb' ] );

		return true;
	}

	/**
	 * Tag <hsyoutube>…</hsyoutube> (legacy).
	 */
	public static function onTagHsYouTube(
		$source,
		array $attributes,
		Parser $parser,
		?PPFrame $frame = null
	) {
		return self::renderYouTubeHtml( $source, $attributes, $parser, $frame, false );
	}

	/**
	 * Tag <hsgytb>…</hsgytb> (canonical).
	 */
	public static function onTagHsgYtb(
		$source,
		array $attributes,
		Parser $parser,
		?PPFrame $frame = null
	) {
		return self::renderYouTubeHtml( $source, $attributes, $parser, $frame, false );
	}

	/**
	 * Expose selected config values to the client via mw.config.
	 */
	public static function onResourceLoaderGetConfigVars(
		array &$vars,
		string $skin,
		Config $config
	): bool {
		$vars['wgHSGControlsPreset'] = self::getControlsPreset();

		return true;
	}

	// =====================================================================
	// Parser function plumbing
	// =====================================================================

	/*
	 * Generic parser for parser function arguments.
	 *
	 * Pattern:
	 * - First non-empty param without '=' → primary value (unless overridden).
	 * - Or explicit "$primaryKey=..." → primary value.
	 * - Remaining "key=value" → attributes[key] = value.
	 * - Remaining bare tokens → attributes[token] = true (flags).
	 *
	 * @param string[] $params
	 * @param string $primaryKey e.g. 'source'
	 * @return array{0:string,1:array} [ $primary, $attributes ]
	 */
	private static function parseParserFunctionArgs( array $params, string $primaryKey ): array {
		$primary = null;
		$attributes = [];

		foreach ( $params as $raw ) {
			$raw = trim( (string)$raw );
			if ( $raw === '' ) {
				continue;
			}

			$pos = strpos( $raw, '=' );
			if ( $pos !== false ) {
				$key = trim( substr( $raw, 0, $pos ) );
				$value = trim( substr( $raw, $pos + 1 ) );

				if ( $key === '' ) {
					continue;
				}

				if ( $key === $primaryKey ) {
					$primary = $value;
				} else {
					$attributes[$key] = $value;
				}
				continue;
			}

			// No '=' in this param
			if ( $primary === null ) {
				$primary = $raw;
			} else {
				// Bare flag (e.g. "autoplay")
				$attributes[$raw] = true;
			}
		}

		if ( $primary === null && array_key_exists( $primaryKey, $attributes ) ) {
			$primary = $attributes[$primaryKey];
		}

		return [ $primary ?? '', $attributes ];
	}

	/**
	 * Interpret common truthy values for flag attributes.
	 *
	 * @param mixed $val
	 */
	private static function isTruthy( $val ): bool {
		if ( $val === true ) {
			return true;
		}
		if ( $val === false || $val === null ) {
			return false;
		}

		$normalized = strtolower( trim( (string)$val ) );

		return in_array( $normalized, [ '1', 'true', 'yes', 'y' ], true );
	}

	/**
	 * Build plain-text and HTML caption fragments with styling hooks.
	 *
	 * @param ?string $hsgid Gallery id / label
	 * @param ?string $titleText Title portion (optional)
	 * @param ?string $bodyText Caption portion (optional)
	 * @param bool $includeHsgId Whether to include hsgid in the output parts.
	 * @param ?Title $linkTitle Optional Title for linking the HTML
	 * @return array{0:string,1:string} [ plainText, html ]
	 */
	private static function buildCaptionFragments(
		?string $hsgId,
		?string $titleText,
		?string $bodyText,
		bool $includeHsgId = true,
		?Title $linkTitle = null
	): array {
		$partsPlain = [];
		$partsHtml = [];

		$add = static function ( ?string $raw, string $class ) use ( &$partsPlain, &$partsHtml ) {
			$raw = $raw ?? '';
			$trimmed = trim( $raw );
			if ( $trimmed === '' ) {
				return;
			}
			$partsPlain[] = $trimmed;
			$partsHtml[] = '<span class="' . $class . '">' .
				htmlspecialchars( $trimmed, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) .
				'</span>';
		};

		if ( $includeHsgId ) {
			$add( $hsgId, 'hsg-caption-gallery' );
		}
		$add( $titleText, 'hsg-caption-title' );
		$add( $bodyText, 'hsg-caption-caption' );

		if ( $partsPlain === [] ) {
			return [ '', '' ];
		}

		$plain = implode( ' | ', $partsPlain );
		$html = implode( ' | ', $partsHtml );

		if ( $linkTitle instanceof Title ) {
			$url = $linkTitle->getLocalURL();
			$href = htmlspecialchars( $url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
			$html = "<a href='" . $href . "' class='internal'>" . $html . '</a>';
		}

		return [ $plain, $html ];
	}

	/**
	 * Assemble overlay and no-id caption parts with shared fallbacks.
	 *
	 * @param ?string $hsgId Gallery id / label (for overlay if allowed)
	 * @param ?string $titleText Title portion
	 * @param ?string $bodyText Caption/body portion
	 * @param bool $includeHsgIdInOverlay Whether to include hsgid in overlay output
	 * @param ?Title $linkTitle Optional Title for link-wrapped overlay HTML
	 * @param string $fallbackText Plain fallback when parts are empty
	 * @return array{0:string,1:string,2:string,3:string} [ overlayPlain, overlayHtml, noIdPlain, noIdHtml ]
	 */
	private static function assembleCaptionBundle(
		?string $hsgId,
		?string $titleText,
		?string $bodyText,
		bool $includeHsgIdInOverlay,
		?Title $linkTitle,
		string $fallbackText
	): array {
		[ $overlayPlain, $overlayHtml ] = self::buildCaptionFragments(
			$hsgId,
			$titleText,
			$bodyText,
			$includeHsgIdInOverlay,
			$linkTitle
		);
		[ $noIdPlain, $noIdHtml ] = self::buildCaptionFragments(
			null,
			$titleText,
			$bodyText,
			false,
			null
		);

		if ( $overlayPlain === '' && $fallbackText !== '' ) {
			$overlayPlain = $fallbackText;
			$overlayHtml = htmlspecialchars( $fallbackText, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		}

		if ( $noIdPlain === '' ) {
			$noIdPlain = $overlayPlain !== '' ? $overlayPlain : $fallbackText;
			$noIdHtml = $overlayHtml !== '' ? $overlayHtml :
				( $fallbackText !== '' ? htmlspecialchars( $fallbackText, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) : '' );
		}

		return [ $overlayPlain, $overlayHtml, $noIdPlain, $noIdHtml ];
	}

	/**
	 * Image helper behind:
	 * - {{#hsgimg: ...}} (canonical)
	 *
	 * Inline vs thumbnail is controlled by the "inline" flag:
	 * - inline=1 / yes / true → inline text link opener
	 * - otherwise → thumbnail with MW-like thumb wrapper (empty inline param ignored)
	 *
	 * Usage (positional):
	 * {{#hsgimg: File:Example.jpg | hsgid=MyGallery | width=208 | caption=Nice image }}
	 *
	 * Usage (named):
	 * {{#hsgimg: source=File:Example.jpg | hsgid=MyGallery | width=208 | caption=Nice image }}
	 *
	 * Recognized attributes:
	 * - source : URL or File: title (primary if not given positionally)
	 * - hsgid/id : slideshow group id
	 * - width : max width in px (thumbs only; templates can provide defaults)
	 * - caption : descriptive caption text
	 * - title : heading/label text
	 * - linktext : inline link text (inline variant only)
	 * - inline : flag as above
	 */
	public static function onFunctionHsgImg( Parser $parser, ...$params ) {
		[ $content, $attributes ] = self::parseParserFunctionArgs( $params, 'source' );

		if ( $content === '' ) {
			return '';
		}

		// -----------------------------------------------------------------
		// 1. Inline vs thumb (same semantics as renderYouTubeHtml)
		// -----------------------------------------------------------------
		$inlineMode = false;
		if ( array_key_exists( 'inline', $attributes ) ) {
			$val = $attributes['inline'];
			unset( $attributes['inline'] );

			if ( is_string( $val ) ) {
				$val = strtolower( trim( $val ) );
			}

			// Only override when the param is non-empty; empty template params keep the default.
			if ( $val !== '' && $val !== null ) {
				if ( $val === false || $val === 0 || $val === '0' || $val === 'no' || $val === 'false' ) {
					$inlineMode = false;
				} elseif ( $val === true || $val === 1 || $val === '1' || $val === 'yes' || $val === 'true' ) {
					$inlineMode = true;
				}
			}
		}

		$hideCaptionFlag = false;
		if ( array_key_exists( 'nocaption', $attributes ) ) {
			$hideCaptionFlag = self::isTruthy( $attributes['nocaption'] );
			unset( $attributes['nocaption'] );
		} elseif ( array_key_exists( 'hidecaption', $attributes ) ) {
			$hideCaptionFlag = self::isTruthy( $attributes['hidecaption'] );
			unset( $attributes['hidecaption'] );
		}

		$tileFlag = false;
		foreach ( $attributes as $k => $v ) {
			$kLower = strtolower( (string)$k );
			if ( $kLower === 'tile' || $kLower === 'tiles' || $kLower === 'tiling' ) {
				$tileFlag = self::isTruthy( $v );
				unset( $attributes[$k] );
				break;
			}
		}

		// -----------------------------------------------------------------
		// 2. Normalise title / caption / linktext (unescaped)
		// -----------------------------------------------------------------
		$titleRaw = isset( $attributes['title'] ) ? trim( (string)$attributes['title'] ) : '';
		$captionRaw = isset( $attributes['caption'] ) ? trim( (string)$attributes['caption'] ) : '';

		// Combined caption used for alt / thumb caption / overlay:
		// - "Title | Caption" if both present
		// - else Caption → Title → Source
		if ( $titleRaw !== '' && $captionRaw !== '' ) {
			$captionDisplay = $titleRaw . ' | ' . $captionRaw;
		} elseif ( $captionRaw !== '' ) {
			$captionDisplay = $captionRaw;
		} elseif ( $titleRaw !== '' ) {
			$captionDisplay = $titleRaw;
		} else {
			$captionDisplay = 'Image';
		}

		// Visible link text for INLINE variant.
		$linkTextRaw = isset( $attributes['linktext'] ) ? trim( (string)$attributes['linktext'] ) : '';
		if ( $linkTextRaw === '' ) {
			if ( $titleRaw !== '' ) {
				$linkTextRaw = $titleRaw;
			} elseif ( $captionRaw !== '' ) {
				$linkTextRaw = $captionRaw;
			} else {
				$linkTextRaw = 'Image';
			}
		}

		$captionEsc = htmlspecialchars( $captionDisplay, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		$linkTextEsc = htmlspecialchars( $linkTextRaw, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );

		// -----------------------------------------------------------------
		// 3. Resolve target: external URL vs File:
		// -----------------------------------------------------------------
		$href = $content;
		$titleObj = Title::newFromText( $content );
		$fileObj = null;

		if ( $titleObj instanceof Title && $titleObj->inNamespace( NS_FILE ) ) {
			$fileObj = \MediaWiki\MediaWikiServices::getInstance()
				->getRepoGroup()
				->findFile( $titleObj );
			if ( $fileObj ) {
				$href = $fileObj->getUrl();
			}
		}

		$hrefEsc = htmlspecialchars( $href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );

		// -----------------------------------------------------------------
		// 4. Gallery id (optional)
		// -----------------------------------------------------------------
		$groupId = isset( $attributes['hsgid'] ) ? trim( (string)$attributes['hsgid'] )
			: ( isset( $attributes['id'] ) ? trim( (string)$attributes['id'] ) : '' );
		if ( $groupId === '' ) {
			$groupId = null;
		}

		// -----------------------------------------------------------------
		// 5. INLINE VARIANT (text link opener)
		// -----------------------------------------------------------------
		if ( $inlineMode ) {
			if ( $groupId === null ) {
				$groupId = uniqid( 'hsg-', true );
			}

			$thumbId = uniqid( 'hsg-thumb-', true );

			[ $captionPlain, $captionHtml, $captionPlainNoId ] = self::assembleCaptionBundle(
				$groupId,
				$titleRaw,
				$captionRaw !== '' ? $captionRaw : $captionDisplay,
				true,
				$titleObj,
				$captionDisplay
			);
			$captionEsc = htmlspecialchars( $captionPlainNoId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );

			$opts = [
				'slideshowGroup' => (string)$groupId,
				'captionText' => $captionHtml,
				'thumbnailId' => $thumbId,
			];

			$optsJson = htmlspecialchars(
				FormatJson::encode( $opts ),
				ENT_QUOTES | ENT_SUBSTITUTE,
				'UTF-8'
			);

			$s = '<a class="highslide hsg-inline hsg-thumb"';
			$s .= ' id="' . htmlspecialchars( (string)$groupId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';
			$s .= ' href="' . $hrefEsc . '"';
			$s .= ' onclick="return hs.expand(this, ' . $optsJson . ');"';
			$s .= ' title="' . $captionEsc . '"';
			$s .= ' data-hsg-caption="' . htmlspecialchars( $captionPlainNoId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';
			$s .= '>' . $linkTextEsc;
			$s .= '<img id="' . htmlspecialchars( $thumbId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';
			$s .= ' class="hsg-inline-thumb-proxy"';
			$s .= ' src="' . $hrefEsc . '"';
			$s .= ' alt=""';
			$s .= ' style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;" />';
			$s .= '</a>';

			return [
				$s,
				'noparse' => true,
				'isHTML' => true,
			];
		}

		// -----------------------------------------------------------------
		// 6. THUMBNAIL VARIANT (MW-like thumb structure)
		// -----------------------------------------------------------------
		$width = isset( $attributes['width'] ) && $attributes['width'] !== ''
			? (int)$attributes['width']
			: self::DEFAULT_THUMB_WIDTH; // canonical PHP-side default; templates can change this

		$captionBodyForParts = $captionRaw;
		// Overlay caption may include hsgid; on-page data/alt should not.
		$hasExplicitHsgId = $groupId !== null && $groupId !== '';
		[
			$captionPlainOverlay,
			$captionHtmlOverlay,
			$captionPlainThumb,
			$captionHtmlThumb
		] = self::assembleCaptionBundle(
			$groupId,
			$titleRaw,
			$captionBodyForParts,
			$hasExplicitHsgId,
			$titleObj,
			$captionDisplay
		);
		$autoHideThumbCaption = ( $captionRaw === '' && $titleRaw === '' );
		$suppressThumbCaption = $hideCaptionFlag || $autoHideThumbCaption;

		$captionEsc = htmlspecialchars( $captionPlainThumb, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );

		if ( $groupId !== null ) {
			self::$hsgId = $groupId;
			self::$hsgLabel = $groupId;
		} else {
			self::$hsgId = null;
			self::$hsgLabel = null;
		}

		// -----------------------------------------------------------------
		// PICKIPEDIA PATCH: Use actual thumbnails instead of full-size images
		// -----------------------------------------------------------------
		// For the thumbnail display (img src), use a generated thumbnail if available.
		// The href (link target) still points to the full-size image for the lightbox.
		$thumbSrc = $href; // default to full-size
		if ( $fileObj && $width > 0 ) {
			$thumb = $fileObj->transform( [ 'width' => $width ] );
			if ( $thumb && !$thumb->isError() ) {
				$thumbSrc = $thumb->getUrl();
			}
		}
		$thumbSrcEsc = htmlspecialchars( $thumbSrc, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		// -----------------------------------------------------------------
		// END PICKIPEDIA PATCH
		// -----------------------------------------------------------------

		$hs = '<a href="' . $hrefEsc . '" class="image highslide-link" title="' . $captionEsc . '">';
		// PATCHED: Use $thumbSrcEsc for the img src instead of $hrefEsc
		$hsimg = '<img class="hsimg" src="' . $thumbSrcEsc . '" alt="' . $captionEsc . '"';

		$w = (int)$width;
		if ( $w > 0 ) {
			$hsimg .= ' style="max-width: ' . $w . 'px !important; height: auto; width: auto;"';
		}

		$thumbTileAttr = $tileFlag ? ' data-hsg-tile="1"' : '';

		$s = $hs . $hsimg . ' /></a>';

		// For hsgimg thumbs we keep the original behaviour: no File object/title
		// is passed into AddHighslide (only MakeImageLink does that).
		self::AddHighslide( $s, null, $captionDisplay, null, $titleRaw, $captionBodyForParts, $groupId, $hasExplicitHsgId );

		$thumbStyle = '';
		if ( $w > 0 ) {
			$thumbStyle = ' style="width: ' . ( $w + 2 ) . 'px;"';
		}

		$captionHtml = '';
		if ( !$suppressThumbCaption && $captionPlainThumb !== '' ) {
			$captionHtml = '<div class="thumbcaption hsg-caption">' . $captionHtmlThumb . '</div>';
		}

		$s = '<div class="thumb hsg-thumb hsg-thumb-normalized"' . $thumbTileAttr . '><div class="thumbinner hsg-thumb"' . $thumbStyle . '>' .
			$s . $captionHtml . '</div></div>';

		return [ $s, 'isHTML' => true ];
	}

	/**
	 * Parser function wrapper for YouTube:
	 *
	 * By default, tags are inline and parser functions are thumbs; the inline flag overrides this:
	 * - inline=1 / yes / true → inline text link opener
	 * - otherwise → thumbnail with MW-like thumb wrapper (empty inline param ignored)
	 *
	 * Usage (positional):
	 * {{#hsgytb: https://www.youtube.com/watch?v=CODE | title=... | caption=... | autoplay }}
	 * {{#hsgytb: CODE | title=... | caption=... | autoplay }}
	 *
	 * Usage (named):
	 * {{#hsgytb: source=CODE | title=... | caption=... | width=300 | autoplay }}
	 *
	 * Rules:
	 * - primary = first non-empty param without '=' OR source=...
	 * - Remaining params as key=value attributes; bare tokens are flags.
	 */
	public static function onFunctionHsgYtb( Parser $parser, ...$params ) {
		[ $source, $attributes ] = self::parseParserFunctionArgs( $params, 'source' );

		if ( $source === '' ) {
			return '';
		}

		$html = self::renderYouTubeHtml( $source, $attributes, $parser, null, true );

		return [
			$html,
			'noparse' => true,
			'isHTML' => true
		];
	}

	/**
	 * Shared builder for YouTube links/thumbnails.
	 *
	 * Used by:
	 * - onTagHsYouTube() → <hsyoutube>…</hsyoutube>
	 * - onTagHsgYtb() → <hsgytb>…</hsgytb>
	 * - onFunctionHsgYtb() → {{#hsgytb: …}}
	 */
	private static function renderYouTubeHtml(
		$source,
		array $attributes,
		Parser $parser,
		?PPFrame $frame = null,
		bool $fromParserFunc = false
	) {
		// -----------------------------------------------------------------
		// 1. Extract video code from $source
		// -----------------------------------------------------------------
		$raw = trim( (string)$source );
		$code = '';

		// 1) Try normal URL shapes first.
		if ( preg_match( '/[?&]v=([^?&]+)/', $raw, $m ) ) {
			// https://www.youtube.com/watch?v=CODE
			$code = $m[1];
		} elseif ( preg_match( '#youtu\.be/([^?]+)#', $raw, $m ) ) {
			// https://youtu.be/CODE
			$code = $m[1];
		} elseif ( preg_match( '#/embed/([^?]+)#', $raw, $m ) ) {
			// https://www.youtube.com/embed/CODE
			$code = $m[1];
		} else {
			// 2) Fallback: treat as bare video ID if it looks like a sane token.
			if ( preg_match( '/^[A-Za-z0-9_-]+$/', $raw ) ) {
				$code = $raw;
			} else {
				return '';
			}
		}

		// -----------------------------------------------------------------
		// 2. Normalise title / caption / linktext (unescaped)
		// -----------------------------------------------------------------
		$titleRaw = isset( $attributes['title'] ) ? trim( (string)$attributes['title'] ) : '';
		$captionRaw = isset( $attributes['caption'] ) ? trim( (string)$attributes['caption'] ) : '';

		$linkTextRaw = $attributes['linktext'] ?? '';
		$linkTextRaw = is_string( $linkTextRaw ) ? trim( $linkTextRaw ) : '';

		// Visible link text (used only for INLINE links).
		if ( $linkTextRaw === '' ) {
			if ( $titleRaw !== '' ) {
				$linkTextRaw = $titleRaw;
			} elseif ( $captionRaw !== '' ) {
				$linkTextRaw = $captionRaw;
			} else {
				$linkTextRaw = 'YouTube Video';
			}
		}

		// Combined caption string for alt / caption / overlay:
		// - "Title | Caption" if both present
		// - else Caption → Title → LinkText
		if ( $titleRaw !== '' && $captionRaw !== '' ) {
			$captionDisplay = $titleRaw . ' | ' . $captionRaw;
		} elseif ( $captionRaw !== '' ) {
			$captionDisplay = $captionRaw;
		} elseif ( $titleRaw !== '' ) {
			$captionDisplay = $titleRaw;
		} else {
			$captionDisplay = $linkTextRaw;
		}

		// Title attribute prefers title, else the combined caption.
		$titleForAttr = $titleRaw !== '' ? $titleRaw : $captionDisplay;

		// -----------------------------------------------------------------
		// 3. Autoplay / width / inline mode
		// -----------------------------------------------------------------
		$autoplayOn = array_key_exists( 'autoplay', $attributes ) &&
			$attributes['autoplay'] !== '' &&
			$attributes['autoplay'] !== '0' &&
			$attributes['autoplay'] !== 0 &&
			$attributes['autoplay'] !== false;

		// Width (used only for thumbnails).
		$width = self::DEFAULT_THUMB_WIDTH;
		if ( isset( $attributes['width'] ) && $attributes['width'] !== '' ) {
			$width = (int)$attributes['width'];
			unset( $attributes['width'] );
		}

		// Determine inline mode:
		// - Tags (<hsyoutube>, <hsgytb>): default inline text
		// - Parser function (#hsgytb): default thumbnail
		$inlineMode = !$fromParserFunc;

		if ( array_key_exists( 'inline', $attributes ) ) {
			$val = $attributes['inline'];
			unset( $attributes['inline'] );

			if ( is_string( $val ) ) {
				$val = strtolower( trim( $val ) );
			}

			if ( $val !== '' && $val !== null ) {
				if ( $val === false || $val === 0 || $val === '0' || $val === 'no' || $val === 'false' ) {
					$inlineMode = false;
				} elseif ( $val === true || $val === 1 || $val === '1' || $val === 'yes' || $val === 'true' ) {
					$inlineMode = true;
				}
			}
		}

		$hideCaptionFlag = false;
		if ( array_key_exists( 'nocaption', $attributes ) ) {
			$hideCaptionFlag = self::isTruthy( $attributes['nocaption'] );
			unset( $attributes['nocaption'] );
		} elseif ( array_key_exists( 'hidecaption', $attributes ) ) {
			$hideCaptionFlag = self::isTruthy( $attributes['hidecaption'] );
			unset( $attributes['hidecaption'] );
		}

		$tileFlag = false;
		foreach ( $attributes as $k => $v ) {
			$kLower = strtolower( (string)$k );
			if ( $kLower === 'tile' || $kLower === 'tiles' || $kLower === 'tiling' ) {
				$tileFlag = self::isTruthy( $v );
				unset( $attributes[$k] );
				break;
			}
		}

		// Build player URL with query flags.
		$query = [];
		if ( $autoplayOn ) {
			$query[] = 'autoplay=1';
		}
		$query[] = 'mute=1';
		$query[] = 'autohide=1';
		$query[] = 'playlist=' . rawurlencode( $code );
		$query[] = 'loop=1';

		$href = 'https://www.youtube.com/embed/' . rawurlencode( $code ) . '?' . implode( '&', $query );

		// -----------------------------------------------------------------
		// 4. Optional gallery id so YT tiles can join image galleries (slideshowGroup analogue).
		// -----------------------------------------------------------------
		$groupId = null;
		$hasExplicitHsgId = false;
		if ( isset( $attributes['hsgid'] ) && $attributes['hsgid'] !== '' ) {
			$groupIdCandidate = trim( (string)$attributes['hsgid'] );
			if ( preg_match( '/^[A-Za-z0-9_\/-]+$/', $groupIdCandidate ) ) {
				$groupId = $groupIdCandidate;
				$hasExplicitHsgId = true;
			}
			unset( $attributes['hsgid'] );
		} elseif ( isset( $attributes['id'] ) && $attributes['id'] !== '' ) {
			// Legacy/short name.
			$groupIdCandidate = trim( (string)$attributes['id'] );
			if ( preg_match( '/^[A-Za-z0-9_\/-]+$/', $groupIdCandidate ) ) {
				$groupId = $groupIdCandidate;
				$hasExplicitHsgId = true;
			}
			unset( $attributes['id'] );
		}

		// -----------------------------------------------------------------
		// 4b. Caption assembly (overlay can include hsgid; data/alt should not)
		// -----------------------------------------------------------------
		$captionBodyForParts = $captionRaw;
		[
			$captionPlain,
			$captionHtml,
			$captionPlainNoId,
			$captionHtmlNoId
		] = self::assembleCaptionBundle(
			$groupId,
			$titleRaw,
			$captionBodyForParts,
			$hasExplicitHsgId,
			null,
			$captionDisplay
		);

		$autoHideThumbCaption = ( $captionRaw === '' && $titleRaw === '' );
		$suppressThumbCaption = $hideCaptionFlag || $autoHideThumbCaption;

		$titleEsc = htmlspecialchars(
			$captionPlainNoId !== '' ? $captionPlainNoId : $titleForAttr,
			ENT_QUOTES | ENT_SUBSTITUTE,
			'UTF-8'
		);
		$linkTextEsc = htmlspecialchars( $linkTextRaw, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		$captionPlainEsc = htmlspecialchars( $captionPlainNoId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		$dataCaption = ' data-hsg-caption="' . htmlspecialchars( $captionHtml, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';

		$dataGroup = $groupId !== null
			? ' data-hsgid="' . htmlspecialchars( $groupId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"'
			: '';

		// -----------------------------------------------------------------
		// 5. INLINE vs THUMBNAIL output
		// -----------------------------------------------------------------
		if ( $inlineMode ) {
			// INLINE TEXT LINK - always invoke Highslide via inline onclick.
			$s = '<a class="highslide link-youtube hsg-thumb"';
			$s .= ' title="' . $titleEsc . '"';
			$s .= ' href="' . htmlspecialchars( $href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';
			$s .= ' onclick="return (window.hsgOpenYouTube || hs.htmlExpand)(this, window.hsgVideoOptions || {});"';
			$s .= $dataCaption;
			if ( $dataGroup !== '' ) {
				$s .= $dataGroup;
			}
			$s .= '>';
			$s .= $linkTextEsc . '</a>';

			return $s;
		} else {
			// THUMBNAIL LINK (MW-like thumb structure)
			$thumbUrl = 'https://img.youtube.com/vi/' . rawurlencode( $code ) . '/hqdefault.jpg';
			$style = '';

			if ( $width > 0 ) {
				$style = ' style="max-width: ' . $width . 'px; height: auto; width: auto;"';
			}

			$innerStyle = $width > 0 ? ' style="width: ' . ( $width + 2 ) . 'px;"' : '';
			$thumbTileAttr = $tileFlag ? ' data-hsg-tile="1"' : '';

			$anchor = '<a class="highslide link-youtube hsg-ytb-thumb hsg-thumb"';
			$anchor .= ' title="' . $titleEsc . '"';
			$anchor .= ' href="' . htmlspecialchars( $href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"';
			$anchor .= ' onclick="return (window.hsgOpenYouTube || hs.htmlExpand)(this, window.hsgVideoOptions || {});"';
			$anchor .= $dataCaption;
			if ( $dataGroup !== '' ) {
				$anchor .= $dataGroup;
			}
			$anchor .= '>';
			$anchor .= '<img class="hsimg hsg-ytb-thumb-img" src="' .
				htmlspecialchars( $thumbUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) .
				'" alt="' . $captionPlainEsc . '"' . $style . ' />';
			$anchor .= '</a>';

			$captionHtmlBlock = ( !$suppressThumbCaption && $captionPlainNoId !== '' )
				? '<div class="thumbcaption hsg-caption">' .
					// If captionHtmlNoId is plain text, escape it.
					( strpos( $captionHtmlNoId, '<span' ) === false
						? htmlspecialchars( $captionHtmlNoId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' )
						: $captionHtmlNoId ) .
					'</div>'
				: '';

			$s = '<div class="thumb hsg-thumb hsg-thumb-normalized"' . $thumbTileAttr . '>';
			$s .= '<div class="thumbinner hsg-thumb"' . $innerStyle . '>';
			$s .= $anchor . $captionHtmlBlock;
			$s .= '</div></div>';
		}

		return $s;
	}

	public static function MakeImageLink(
		&$dummy,
		&$title,
		&$file,
		&$frameParams,
		&$handlerParams,
		&$time,
		&$res
	) {
		$galleryIdMatches = [];

		if (
			isset( $frameParams['caption'] ) &&
			preg_match( '/^(hsgid|highslide)[^:]*:/i', $frameParams['caption'] )
		) {
			// hsgid=Foo-Bar/Baz:Caption OR highslide=Foo-Bar/Baz:Caption
			preg_match(
				'/^(hsgid|highslide)=(?!:)([A-Za-z0-9_\/-]+)/i',
				$frameParams['caption'],
				$galleryIdMatches
			);

			if ( !empty( $galleryIdMatches[2] ) ) {
				// Explicit group id
				self::$hsgId = $galleryIdMatches[2];
				self::$hsgLabel = $galleryIdMatches[2]; // label starts as the explicit id
			} else {
				// No id after = → treat as "no group"
				self::$hsgId = null;
				self::$hsgLabel = null;
			}

			// Strip the hsgid=/highslide= prefix from caption/alt/title
			$frameParams['caption'] = preg_replace(
				'/^(hsgid|highslide)[^:]*:/i',
				'',
				$frameParams['caption']
			);
			if ( isset( $frameParams['alt'] ) ) {
				$frameParams['alt'] = preg_replace(
					'/^(hsgid|highslide)[^:]*:/i',
					'',
					$frameParams['alt']
				);
			}
			if ( isset( $frameParams['title'] ) ) {
				$frameParams['title'] = preg_replace(
					'/^(hsgid|highslide)[^:]*:/i',
					'',
					$frameParams['title']
				);
			}

			$res = $dummy->MakeThumbLink2( $title, $file, $frameParams, $handlerParams );
			self::AddHighslide( $res, $file, $frameParams['caption'], $title );
			return false;
		}

		return true;
	}

	/**
	 * Core decorator: take an <a><img></a> thumb string and attach Highslide
	 * semantics (slideshowGroup, caption text, MediaViewer shielding, etc.).
	 */
	private static function AddHighslide(
		&$s,
		$file,
		$caption,
		$title,
		?string $titleText = null,
		?string $captionText = null,
		?string $hsgIdText = null,
		bool $includeHsgIdInOverlay = true
	) {
		// Derive base label:
		// - if we have an explicit hsgLabel (id), use it;
		// - else if there's a File object, use its name;
		// - else fall back to the raw caption or a generic label.
		if ( self::$hsgLabel !== null && self::$hsgLabel !== '' ) {
			$label = self::$hsgLabel;
		} elseif ( $file ) {
			$label = $file->getName();
		} elseif ( $caption !== '' ) {
			$label = $caption;
		} else {
			$label = 'Member';
		}

		$titleText = $titleText !== null ? trim( $titleText ) : '';
		$captionText = $captionText !== null ? trim( $captionText ) : trim( (string)$caption );
		$hsgIdText = $hsgIdText !== null ? trim( $hsgIdText ) : $label;

		// Overlay caption (with optional hsgid) and plain text (no hsgid) for data/alt.
		[
			$displayWithId,
			$captionHtml,
			$displayNoId
		] = self::assembleCaptionBundle(
			$hsgIdText,
			$titleText,
			$captionText,
			$includeHsgIdInOverlay,
			$title instanceof Title ? $title : null,
			$label
		);

		$display = $displayNoId !== '' ? $displayNoId : $displayWithId;
		if ( $display === '' ) {
			$display = $label;
		}

		// Escape for HTML/attribute context (data/alt should use no-id string).
		$displayEsc = htmlspecialchars( $display, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );

		// Ensure gallery/group id and decide whether this is a multi-image gallery member.
		if ( self::$hsgId === null ) {
			// No explicit id: each call gets its own unique group → single-member galleries.
			self::$hsgId = uniqid( 'hsg-', true );
			self::$isHsgGroupMember = false;
		} else {
			// Explicit id: if it's the same as the last group, this is a gallery member;
			// if it's new, treat this as the first image in a new gallery.
			if ( self::$lastHsgGroupId !== null && self::$lastHsgGroupId === self::$hsgId ) {
				self::$isHsgGroupMember = true; // same group as previous
			} else {
				self::$isHsgGroupMember = false; // first in this id's group
			}
		}
		// Remember this group for next call on the page.
		self::$lastHsgGroupId = self::$hsgId;

			// Prepare JS options safely using JSON (avoids breaking on quotes).
			$opts = [
				'slideshowGroup' => (string)self::$hsgId,
				// Already HTML; Highslide treats caption as HTML fragment.
				'captionText' => $captionHtml,
			];
		// Let Highslide's global hs.numberPosition decide where the index appears
		// (we set it to 'caption' in highslide.cfg.js).
		$optsJson = htmlspecialchars(
			FormatJson::encode( $opts ),
			ENT_QUOTES | ENT_SUBSTITUTE,
			'UTF-8'
		);

		$captionData = htmlspecialchars( $display, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		$prefix = 'id="' . htmlspecialchars( (string)self::$hsgId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) .
			'" data-hsgid="' . htmlspecialchars( (string)self::$hsgId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) .
			'" data-hsg-caption="' . $captionData .
			'" onclick="return hs.expand(this, ' . $optsJson . ')" href';

		// If this is a multi-image gallery member, ensure both:
		// - legacy `.wikigallery` (BC for old CSS)
		// - canonical `.hsg-gallery` (HSG-specific hook)
		if ( self::$isHsgGroupMember ) {
			if ( preg_match( '/<img[^>]*\sclass="/i', $s ) ) {
				$s = preg_replace(
					'/(<img[^>]*\sclass=")([^"]*)"/i',
					'\\1hsg-gallery wikigallery \\2"',
					$s,
					1
				);
			} else {
				$s = preg_replace(
					'/<img /i',
					'<img class="hsg-gallery wikigallery" ',
					$s,
					1
				);
			}
		}

		// Tell MediaViewer (and friends) to stay out of HSG thumbs.
		// MediaViewer checks `$thumb.closest('.noviewer')` — so ensure the outer link has `noviewer`.
		// Also add a stable `hsg-thumb` marker for any future "no overlay" gadgets.
		if ( preg_match( '/<a[^>]*\sclass="/i', $s ) ) {
			$s = preg_replace(
				'/(<a[^>]*\sclass=")([^"]*)"/i',
				'\\1noviewer hsg-thumb \\2"',
				$s,
				1
			);
		} else {
			$s = preg_replace(
				'/<a /i',
				'<a class="noviewer hsg-thumb" ',
				$s,
				1
			);
		}

		// Update the img alt attribute to match the final (no-id) label|caption string.
		$s = preg_replace(
			'/\balt="[^"]*"/i',
			'alt="' . $displayEsc . '"',
			$s,
			1
		);

		// Inject id/onclick before first href=
		$s = preg_replace( '/href/i', $prefix, $s, 1 );

		// For File: thumbs, make the href target the full file URL.
		if ( $file ) {
			$url = $file->getUrl();
			$s = preg_replace(
				'/href="[^"]*"/i',
				'href="' . htmlspecialchars( $url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ) . '"',
				$s,
				1
			);
		}

		// Reset per-call gallery flag.
		self::$isHsgGroupMember = false;
	}
}
