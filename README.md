# PickiPedia

Traditional music knowledge base powered by MediaWiki and Semantic MediaWiki.

## Architecture

- **MediaWiki core**: Downloaded at deploy time (version specified in `.env`)
- **Extensions**: Managed via composer + custom extensions in `extensions/`
- **Production**: NearlyFreeSpeech (rsync deploy)
- **Preview**: Docker on hunter (same DB, different MW version for testing)

## Quick Start (Local Development)

```bash
cp .env.example .env
# Edit .env with your settings

docker-compose up -d
```

## Deployment

Production deploys happen via Jenkins. The pipeline:
1. Pulls specified MediaWiki version (cached between builds)
2. Installs composer dependencies (SMW, HitCounters, Sentry)
3. Clones non-composer extensions (YouTube, MsUpload, TimedMediaHandler, RSS)
4. Copies configuration (secrets from Vault)
5. Rsyncs to NearlyFreeSpeech

### Adding New Extensions

When adding a new extension to the Jenkinsfile, bump `BUILD_CACHE_VERSION` in the environment block to force a fresh build. The cache key includes both the MediaWiki version and this cache version, so incrementing it will invalidate the cached MediaWiki directory and run all git clones fresh.

```groovy
environment {
    MEDIAWIKI_VERSION = '1.43.6'
    BUILD_CACHE_VERSION = '3'  // Bump this when adding extensions
    ...
}
```

## Extensions

**Via Composer** (composer.json):
- **Semantic MediaWiki**: Structured data, queries, RDF export
- **HitCounters**: Page view statistics
- **Sentry**: Error tracking (reports to GlitchTip)

**Via Git Clone** (Jenkinsfile):
- **YouTube**: YouTube video embeds
- **MsUpload**: Drag-and-drop file uploads
- **TimedMediaHandler**: Video/audio playback
- **RSS**: Embed RSS feeds in wiki pages

Custom extensions go in `extensions/`

## Configuration

- `LocalSettings.php` - Main config (tracked)
- `LocalSettings.local.php` - Secrets (generated at deploy, not tracked)

## Links

- Production: https://pickipedia.xyz
- [Semantic MediaWiki docs](https://www.semantic-mediawiki.org/)
