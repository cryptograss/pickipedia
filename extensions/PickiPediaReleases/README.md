# PickiPediaReleases

MediaWiki extension providing a `Release:` namespace with YAML content model for tracking IPFS CIDs and BitTorrent infohashes.

## Overview

This extension creates a canonical source for release metadata that pinning services (maybelle, delivery-kid) can sync from. Each Release page stores structured data as YAML, rendered as HTML for human viewing.

## Installation

1. Clone/copy to `extensions/PickiPediaReleases/`
2. Add `symfony/yaml` to composer.json:
   ```json
   "symfony/yaml": "^6.0 || ^7.0"
   ```
3. Run `composer install`
4. Add to LocalSettings.php:
   ```php
   wfLoadExtension( 'PickiPediaReleases' );
   ```
5. Run `php maintenance/run.php update` to register the namespace

## Usage

### Creating a Release

Navigate to `Release:Your-Release-Name` and create a page with YAML content:

```yaml
title: Blue Railroad Train (Squats) - 2026-01-10
ipfs_cid: QmXyz123abc456def789...

# Optional fields
bittorrent_infohash: abc123def456789abcdef123456789abcdef1234
file_type: video/mp4
file_size: 157286400
description: Justin and Skyler doing squats to Blue Railroad Train
created_at: 2026-01-10T19:09:11Z
bittorrent_trackers:
  - udp://tracker.opentrackr.org:1337
  - udp://tracker.openbittorrent.com:6969
```

### Required Fields

- `title` - Human-readable title for the release
- `ipfs_cid` - IPFS content identifier (CIDv0 or CIDv1)

### Optional Fields

- `bittorrent_infohash` - 40-character hex infohash
- `bittorrent_trackers` - List of tracker URLs
- `file_type` - MIME type (e.g., video/mp4)
- `file_size` - Size in bytes
- `description` - Human-readable description
- `created_at` - ISO 8601 timestamp
- `source_url` - Original source URL

## API

### List Releases

```
GET /api.php?action=releaselist&format=json
```

Parameters:
- `filter`: 'all' (default), 'ipfs', 'torrent', 'missing-torrent'

Response:
```json
{
  "releases": [
    {
      "page_id": 123,
      "page_title": "Blue-Railroad-2026-01-10",
      "title": "Blue Railroad Train (Squats) - 2026-01-10",
      "ipfs_cid": "QmXyz123...",
      "bittorrent_infohash": "abc123...",
      "file_type": "video/mp4",
      "file_size": 157286400,
      "valid": true
    }
  ],
  "count": 1
}
```

### Raw YAML

```
GET /wiki/Release:Name?action=raw
```

Returns the raw YAML content for machine parsing.

## Pinning Service Integration

Pinning services can sync releases with:

```javascript
async function syncReleases() {
  const response = await fetch(
    'https://pickipedia.xyz/api.php?action=releaselist&format=json'
  );
  const data = await response.json();

  for (const release of data.releases) {
    if (release.ipfs_cid) {
      await pinCid(release.ipfs_cid);
    }
    if (release.bittorrent_infohash) {
      await seedTorrent(release.bittorrent_infohash, release.title);
    }
  }
}
```

## Namespace

- **Release (NS_RELEASE)**: ID 3004 - Content pages
- **Release_talk (NS_RELEASE_TALK)**: ID 3005 - Discussion pages

## Configuration

```php
// Required fields for validation (default: title, ipfs_cid)
$wgReleaseRequiredFields = ['title', 'ipfs_cid'];
```

## License

GPL-2.0-or-later
