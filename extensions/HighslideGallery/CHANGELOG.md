# Changelog
All notable changes are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [UNRELEASED]
### Added
- Optional horizontal thumbnail tiling (justified thumbnails) using `tile=1`
- Cache-busting insurance for ResourceLoader
- List item markers (`hsg-thumb-list-item`, `hsg-inline-list-item`) applied to list items containing HSG thumbs/inline entries for selective styling
- Styling for `hsg-thumb-list-item` to remove bottom margin
- Touch support: drag-to-pan bridge on coarse pointers, larger tap targets, and close button pinned to viewport top-right
- Overlay alignment uses the visual viewport for viewport-relative overlays (controls/thumbstrip) to avoid page-centered drift on mobile

### Changed


### Fixed
- Adjacent lists of the same type are merged to keep numbering/bullets continuous when HSG markup is present
- List items containing HSG thumbs drop `mw-empty-elt` and gain `hsg-thumb-list-item` for styling without affecting other list items
- Orphan thumbs now select the deepest nearby list item (up to 3 levels of mixed ol/ul/dl nesting) while keeping numbering intact


## [2.0.0] - 2025-12-09
- All testing for this release was done on MW v1.39.7 and PHP v8.3.26.

### Added
- Full expand toggle (full/fit) with zoom/pan support; `f` key uses the same toggle path.
- SVG control icons, disabled-state dimming, and configurable `wgHSGControlsPreset` layout.
- Unified caption spans/classes for images and video (`hsg-caption-gallery/title/caption`), plus optional `nocaption` to suppress thumb captions and improved fallback (`Image` instead of raw path).
- New ResourceLoader i18n strings for hover instructions, control tooltips, loading text, and member counter.
- YouTube grouping with images in the same HSG, auto-sized thumbs, and inline link support.

### Changed
- **Breaking (pre-2.0.0)**: 
  - Drops support for MediaWiki <1.39 (ResourceLoader-only, modern hooks)
  - Drops support for the old `highslide` parameter for gallery grouping ID; instead, use `hsgid`
  - Replaces legacy caption markup with span-wrapped classes (`hsg-caption-gallery/title/caption`), so some styling elements will require revision.
- Default is thumbnail when `inline` is omitted; inline links remain opt-in.
- List handling overhauled: thumbs and inline HSGs now nest correctly across ordered/unordered/description lists and mixed/deep sublists.
- Caption/data model normalized: bar-separated `title | caption` without stray `hsgid` in thumbs; user `hsgid` appears only inside the overlay.
- Highslide core tuned for overlay visibility during zoom, control alignment, and consistent disabled-state styling.

### Fixed
- Prevent slideshow/autoplay from closing the expander at end-of-run.
- Stale controlbar sprites at origin removed; thumb controls stay aligned.
- Inline list HSGs no longer break list structure; no caption duplication between images/videos.

### 2025-11-17 Fixed
- Added 'noviewer' class to prevent MediaViewer from hijacking galleries (HSGs)
- Exposed previously-obscured HSG index label
- Exposed previously-obscured HSG controls
- Improved x-browser compatibility

### 2025-11-17 Added
- New parser functions for YouTube (YT) i-frame and thumbnail (text-only YT still supported)
- Bundles Highslide JS core v5.5.0 (`highslide-full.js` with CSS and graphics assets)
- New label synonym, 'hsgid' (i.e., HighSlideGallery ID) for wiki template maintainers - 'highslide' label still supported

### 2025-11-17 Changed
- Improved YT embed functionality with new parser function and autoplay muting
- Gallery grouping is reliable and more intuitive, allowing YT and images to coexist inside a single HSG
- Modernized codebase - min required MediaWiki is now v1.39
- Modernized extension registration (Mediawiki 1.39+)
- Migrated resource loading to ResourceLoader (Mediawiki 1.39+)
- Removed deprecated PHP files (Mediawiki 1.39+)
- Reascribed GPL-2.0 license for extension, due to unportability of GPL to CC license

## [1.3.0-repack] - 2025-11-11
### Fixed (packaging only)
- Remove JSON comment from `extension.json` so Composer doesn’t break.

### 2025-11-09 Added
- Composer/Packagist support and repository metadata (`composer.json`)
- Modernize registration (`extension.json`) and tighten hooks
- Clean repo (remove stray `*.patch` files)

### 2025-11-09 Changed
- Documentation: README updated with Composer/Packagist and manual install instructions
- Updated COPYING to COPYING.md; merged INSTALL + README into README.md

## [1.3.0] - 2025-10-13
### Fixed
- `extension.json`: use `"Hooks"` (plural) and include `BeforePageDisplay`, `ImageBeforeProduceHTML`, `ParserFirstCallInit`
- General formatting/cleanup in `HighslideGallery.php`

### Added
- Load strategy: inject `highslide.js` via `BeforePageDisplay` to guarantee global `hs`
- YouTube embeds: `mute=1` for reliable autoplay; loop via `playlist={code}` + `loop=1`

### Changed
- ResourceLoader now mediates only config JS and styles
- Parser hooks modernized

## [1.1.1] - 2023-12-11
### Changed
- Bundles Highslide JS (`highslide.js` and `highslide.css`) to ensure compatibility and "just works"

## [1.1.0] - 2020-10-28
### Added
- YouTube mute fix and other minor improvements

## [1.0.0] - 2012-10-22
- Initial release
