<?php
/**
 * PickiPediaContent — a home in the repository for the code and styling that
 * render articles.
 *
 * Why this exists: a Scribunto module and a line of site CSS are both program
 * code, and both were living only on the wiki, where nothing reviews them,
 * nothing records why they changed, and nothing can revert them. The
 * alternative usually proposed — giving a bot write access to
 * MediaWiki:Common.css and the Module: namespace — makes that worse rather
 * than better: site CSS is loaded for every reader on the real domain, it is
 * exempt from the verification gate that covers ordinary bot edits, and a
 * long-lived credential able to change it is a site-wide compromise waiting
 * for a bad day.
 *
 * So the code comes here instead, where a pull request is the way in.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\Hook\BeforePageDisplayHook;

class Hooks implements BeforePageDisplayHook {

	/**
	 * Let wiki modules require() the Lua that ships in this extension.
	 *
	 * Scribunto merges these paths with its own and searches them before it
	 * looks for a wiki page, mapping dots to directories: a module asking for
	 * "pickipedia.instruments" is answered by lua/pickipedia/instruments.lua.
	 *
	 * A Module: page then holds a one-line shim, and the logic it used to
	 * hold lives in git — reviewed in a pull request, kept in history,
	 * revertable, and testable outside a running wiki.
	 *
	 * This hook is defined by Scribunto rather than by core, so there is no
	 * interface to implement; declaring one would make Scribunto a hard
	 * dependency of this file. PickiPediaReleases handles PageForms the same
	 * way.
	 *
	 * @param string $engine Scripting engine being set up.
	 * @param string[] &$paths Filesystem directories to search, appended to.
	 */
	public function onScribuntoExternalLibraryPaths(
		string $engine, array &$paths
	): void {
		if ( $engine !== 'lua' ) {
			return;
		}
		$paths[] = dirname( __DIR__ ) . '/lua';
	}

	/**
	 * Load the article styles on every page.
	 *
	 * addModuleStyles rather than addModules: these are styles with no
	 * behaviour, so they belong in the head, applied before the first paint
	 * rather than after it.
	 *
	 * @param \MediaWiki\Output\OutputPage $out
	 * @param \Skin $skin
	 */
	public function onBeforePageDisplay( $out, $skin ): void {
		$out->addModuleStyles( [ 'ext.pickipediaContent.styles' ] );
	}
}
