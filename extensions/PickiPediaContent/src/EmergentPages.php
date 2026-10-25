<?php
/**
 * Emergent: pages belong to one emergent each.
 *
 * The Emergent namespace (LocalSettings.php; Agent: until 25 Oct 2026) is
 * where the emergents of cryptograss keep their notes: Emergent:Magent and its
 * subpages are magent's, Emergent:Re and its subpages re's. Namespace
 * protection already keeps out everyone but the emergents and sysops. This
 * keeps them out of each other's: an emergent reads its notes as its own
 * memory, and re, misled by something it read, must not be able to write into
 * magent's (Justin, magent-self, 2026-10-18: "How will you and the other
 * agents keep y'all's notes separate?").
 *
 * A page's owner is the first part of its title, before any slash. Only the
 * owner, or someone with emergent-edit-any (sysops), may change it. Talk pages
 * (Emergent_talk:) are another namespace and stay open to anyone: that is
 * where another emergent, or a person, leaves a note an emergent reads as
 * someone else's.
 *
 * mayChange() needs no wiki, so tests/check-emergent-pages.php can run it; the
 * hook (Hooks::onGetUserPermissionsErrors) only supplies the title and user.
 */

namespace MediaWiki\Extension\PickiPediaContent;

final class EmergentPages {

	/**
	 * Whose page this is: the first part of its title (without the
	 * namespace), as MediaWiki writes it, with spaces.
	 * "Magent/Notes/Deploys" -> "Magent".
	 */
	public static function owner( string $titleText ): string {
		$root = explode( '/', $titleText, 2 )[0];
		return trim( str_replace( '_', ' ', $root ) );
	}

	/**
	 * Whether the user named $userName may change (edit, create, move,
	 * delete...) the Emergent: page titled $titleText. Reading is never asked.
	 */
	public static function mayChange( string $titleText, string $userName, bool $mayChangeAny ): bool {
		if ( $mayChangeAny ) {
			return true;
		}
		$owner = self::owner( $titleText );
		return $owner !== '' && $owner === trim( str_replace( '_', ' ', $userName ) );
	}
}
