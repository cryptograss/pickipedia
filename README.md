# PickiPedia

Traditional music knowledge base powered by MediaWiki and Semantic MediaWiki.

## Architecture

- **MediaWiki core**: Downloaded at build time (version set in the Jenkinsfile)
- **Extensions**: Managed via composer + custom extensions in `extensions/`
- **Production**: the PickiPedia VPS (5.78.112.39). MediaWiki runs in Docker as
  `pickipedia-wiki` (`php:8.2-apache`) behind Caddy; MariaDB is installed on the host,
  not containerised. Provisioned by Ansible from `cryptograss/maybelle-config`
  (`pickipedia-vps/ansible`), run via `maybelle/scripts/deploy-pickipedia-remote.py`.
- **Preview**: Docker on hunter (same DB, different MW version for testing)

## Quick Start (Local Development)

```bash
cp .env.example .env
# Edit .env with your settings

docker-compose up -d
```

## Deployment

Building and deploying are **two separate jobs**, and they can disagree. This matters when
you are reading the commit in the page footer: that comes from `build-info.php`, which is
stamped at build time, so it can be ahead of what is actually serving.

**Build** — Jenkins job `pickipedia-build` on maybelle, cron `*/5 * * * *`, builds this
repo's `production` branch:
1. Pulls the specified MediaWiki version (cached between builds)
2. Installs composer dependencies (SMW, HitCounters, Sentry)
3. Clones non-composer extensions (YouTube, MsUpload, TimedMediaHandler, RSS)
4. Copies configuration (secrets from Vault)
5. Writes `build-info.php` (block height + commit — this is what the page footer shows)
6. Rsyncs the result to `/var/jenkins_home/pickipedia_stage/` and drops a `.deploy-ready` marker

**Deploy** — the `cron-health` job's *pickipedia rsync (VPS deploy)* stage picks up that
marker and rsyncs the staged build to the VPS. It logs to `/var/log/pickipedia-deploy.log`
and can be held indefinitely by `/var/jenkins_home/.pickipedia-deploy-paused`. A build
therefore does **not** imply a deploy.

**Provisioning** — changes to the server itself (packages, Caddy, MariaDB, the wiki
container, `maintenance/update.php`) come from Ansible in `cryptograss/maybelle-config`
under `pickipedia-vps/ansible`, run with `maybelle/scripts/deploy-pickipedia-remote.py`.
That is a different operation again from either of the above.

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
