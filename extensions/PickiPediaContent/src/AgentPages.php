<?php
/**
 * Agent: pages belong to one agent each.
 *
 * The Agent namespace (LocalSettings.php) is where the agents of cryptograss
 * keep their notes: Agent:Magent and its subpages are magent's, Agent:Re and
 * its subpages re's. Namespace protection already keeps out everyone but
 * the agents and sysops. This keeps the agents out of each other's: an agent
 * reads its notes as its own memory, and re, misled by something it read,
 * must not be able to write into magent's (Justin, magent-self, 2026-10-18:
 * "How will you and the other agents keep y'all's notes separate?").
 *
 * A page's owner is the first part of its title, before any slash. Only the
 * owner, or someone with agent-edit-any (sysops), may change it. Talk pages
 * (Agent_talk:) are another namespace and stay open to anyone: that is where
 * another agent, or a person, leaves a note an agent reads as someone else's.
 *
 * mayChange() needs no wiki, so tests/check-agent-pages.php can run it; the
 * hook (Hooks::onGetUserPermissionsErrors) only supplies the title and user.
 */

namespace MediaWiki\Extension\PickiPediaContent;

final class AgentPages {

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
	 * delete...) the Agent: page titled $titleText. Reading is never asked.
	 */
	public static function mayChange( string $titleText, string $userName, bool $mayChangeAny ): bool {
		if ( $mayChangeAny ) {
			return true;
		}
		$owner = self::owner( $titleText );
		return $owner !== '' && $owner === trim( str_replace( '_', ' ', $userName ) );
	}
}
