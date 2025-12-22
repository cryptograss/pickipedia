# HighslideGallery (MediaWiki Extension)

HighslideGallery (HSG) delivers Highslide JS-powered overlays/slideshows for images and YouTube videos displayed as thumbnails or inline links on the page with titles and captions. Clicking a HSG thumbnail or link opens the image or video in an interactive overlay auto-sized to the viewport with ability to expand to full size with panning. See [this example](https://stepmodifications.org/wikidev/Template:Hsg).

> **Status**: actively maintained  
> **Tested**:  
>> v2.0.0 → MediaWiki 1.39  
>> v1.3.0 → MediaWiki 1.39  
>> v1.1.0 → MediaWiki 1.22  
>> v1.0.0 → MediaWiki 1.17

---

## Requirements / Compatibility
- MediaWiki 1.39+ (ResourceLoader-only, modern hooks). Older MW versions are not supported in 2.0.0.

---

## Features (2.0.0)
- Thumbnails displayed by default at 210px with ability to size as needed, but inline links are optional using `inline=1`
- Zoom toggle (full/fit) with pan inside the HSG
- Group images and YouTube videos into a single HSG gallery via `hsgid`.
- Support for opotional thumbnail layouts including justified tiling and clean arrangement in ordered/unordered lists
- Robust data model provides unique styling classes, maximizing compatibility with Mediawiki core media-handling and other media extensions.
- Thumb captions are default but optional with graceful caption fallbacks also used for image `alt` text.
- ResourceLoader-exposed i18n strings for hover instructions, control tooltips, loading text, and member counter.
- Custom `LocalSettings.php` parameter allows positioning controls at bottom of viewport (default) or over the image expander (optional) inside the HSG overlay. 

---

## Installation
If `$wgExtensionAssetsPath` is custom, update `hs.graphicsDir` in `modules/highslide.cfg.js` to match this path.

### Composer (recommended)
Add to `composer.local.json`:

```json
{
  "require": {
    "mediawikiext/highslidegallery": "^2.0"
  },
  "extra": {
    "merge-plugin": {
      "include": [
        "extensions/*/composer.json"
      ]
    }
  }
}
```

Then run:

```
composer update mediawikiext/highslidegallery -W
```

This installs into `extensions/HighslideGallery/` from Packagist.

### Manual (archive)
1) Download a tagged release (e.g., `v2.0.0`) and extract to `extensions/HighslideGallery/`.  
2) Ensure `extension.json`, `modules/`, and PHP sources are present.

### Post-install
In `LocalSettings.php`:

```php
wfLoadExtension( 'HighslideGallery' );
```

Registered hooks:
- `BeforePageDisplay` (injects Highslide core + RL modules)
- `ImageBeforeProduceHTML` (thumbnail handling)
- `ParserFirstCallInit` (tag/parser functions)
- `ResourceLoaderGetConfigVars` (JS config)

---

## Usage

### Parser functions (modern)
- Image (`#hsgimg`):  
  `{{#hsgimg:source=File:Pic.jpg|hsgid=GalleryA|width=210|title=Title|caption=Caption|inline=0|nocaption=0|linktext=Inline link text}}`
- YouTube (`#hsgytb`):  
  `{{#hsgytb:source=VIDEO_ID|hsgid=GalleryA|width=210|title=Title|caption=Caption|inline=0|autoplay=0}}`

Parameters (named; positional `source` is also accepted):
- `source` (required): `File:Title` or external URL (image) / YouTube ID or URL (video).
- `hsgid` (optional): alphanumeric slideshow gallery id; lets images/videos coexist in one overlay set.
- `width` (optional): max thumb width in px (default 210).
- `tile` (optional): truthy → enforce horizontal tiling (adds `hsg-tiles-horizontal` to the auto wrapper).
- `title` (optional): overlay title text.
- `caption` (optional): overlay caption text.
- `nocaption` (optional): truthy → hides thumb caption (overlay caption still shown).
- `inline` (optional): truthy → inline link; falsy/omitted → thumbnail (default).
- `linktext` (optional): inline link text (inline only).
- `autoplay` (YouTube only): truthy → enables autoplay (muted).

### Examples using the raw parser functions directly
- Inline image with custom link text:  
  `{{#hsgimg:source=File:Pic.jpg|hsgid=GalleryA|inline=1|linktext=See image|title=Sunset|caption=Lake view}}`
- Mixed gallery (images + video) with captions and default thumbs:  
  `{{#hsgimg:source=File:Pic1.jpg|hsgid=GalleryMixed|title=Title1|caption=Caption1}}`  
  `{{#hsgimg:source=File:Pic2.jpg|hsgid=GalleryMixed|title=Title2|caption=Caption2}}`  
  `{{#hsgytb:source=VIDEO_ID|hsgid=GalleryMixed|title=Clip|caption=Gameplay}}`

### Example template leveraging all features
```
<includeonly>
{{#if: {{{ytb|}}}
| <!-- YOUTUBE BRANCH -->
{{#hsgytb:
| source={{{ytb|}}}
| hsgid={{{hsgid|}}}
| tile={{{tile|0}}}
| width={{{width|}}}
| title={{{title|}}}
| caption={{{caption|}}}
| nocaption={{{nocaption|}}}
| inline={{{inline|}}}
| linktext={{{linktext|}}}
| autoplay={{{autoplay|}}}
}}
| <!-- IMAGE BRANCH (default when no ytb) -->
{{#hsgimg:
| source={{{img|}}}
| hsgid={{{hsgid|}}}
| tile={{{tile|0}}}
| width={{{width|}}}
| title={{{title|}}}
| caption={{{caption|}}}
| nocaption={{{nocaption|}}}
| inline={{{inline|}}}
| linktext={{{linktext|}}}
}} }}
</includeonly>
```

### Tiling layouts (opt-in)
- Default thumbs are resizable using custom `width=#px`. To tile responsively, set `tile=1` on thumbs that also declare an `hsgid`; the auto wrapper gets `hsg-tiles-horizontal`. Control sizing with CSS variables, `--hsg-tile-min`  and `--hsg-tile-gap`, in `highslide.override.dcss`.
- Inline `width=` values on thumbs are otherwise overridden inside the tiling wrappers.

### Legacy tags (still supported)
- YouTube tag: `<hsyoutube title="Trailer">https://www.youtube.com/watch?v=VIDEO_ID</hsyoutube>` (defaults to inline). Prefer `#hsgytb` for modern usage.

---

## Configuration
- `$wgHSGControlsPreset = 'stacked-top';` in `LocalSettings.php` for alternate control/thumbstrip positioning. Comment or set to `classic` for default positioning below media.
- `modules/highslide.cfg.js` for overlay behavior (margins, zoom, controls).
- `modules/highslide.override.css` for styling (SVG controls, thumbstrip, captions).

Defaults require no manual changes.

---

## Contributing
Merge requests and issues:  
https://gitlab.com/z929669/highslidegallery

---

## License
- **Extension code**: GPL-2.0-or-later  
- **Bundled library (`modules/highslide-full.js`/assets)**: MIT (license notice retained)

MIT code shipped within a GPL-2.0 project is compatible.
