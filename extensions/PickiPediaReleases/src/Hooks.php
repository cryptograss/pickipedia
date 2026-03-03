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

class Hooks implements LoadExtensionSchemaUpdatesHook {

	/**
	 * Handle schema updates
	 *
	 * Currently no custom tables needed - releases are stored as page content.
	 * This hook is reserved for future use (e.g., caching release metadata).
	 *
	 * @param DatabaseUpdater $updater
	 */
	public function onLoadExtensionSchemaUpdates( $updater ): void {
		// No schema updates needed at this time
		// Releases are stored as page content in the Release namespace

		// Future: Could add a cache table for faster API queries
		// $updater->addExtensionTable( 'release_cache', __DIR__ . '/../sql/release_cache.sql' );
	}
}
