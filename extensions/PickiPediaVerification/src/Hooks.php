<?php

namespace MediaWiki\Extension\PickiPediaVerification;

use MediaWiki\Hook\EditFilterMergedContentHook;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\User\UserGroupManager;
use IContextSource;
use Content;
use TextContent;
use Status;
use MediaWiki\MediaWikiServices;

/**
 * Hooks for PickiPediaVerification extension.
 *
 * Intercepts edits from bot accounts and ensures they include
 * verification markers (status=proposed or Bot_proposes template).
 * Rejects bot edits that don't follow the verification workflow.
 */
class Hooks implements EditFilterMergedContentHook {

	private UserGroupManager $userGroupManager;

	public function __construct( UserGroupManager $userGroupManager ) {
		$this->userGroupManager = $userGroupManager;
	}

	/**
	 * Hook: EditFilterMergedContent
	 *
	 * Validates that bot edits include verification markers.
	 * Rejects edits that don't comply with the verification workflow.
	 *
	 * @param IContextSource $context
	 * @param Content $content
	 * @param Status $status
	 * @param string $summary
	 * @param User $user
	 * @param bool $minoredit
	 * @return bool
	 */
	public function onEditFilterMergedContent(
		$context,
		$content,
		$status,
		$summary,
		$user,
		$minoredit
	) {
		$config = MediaWikiServices::getInstance()->getMainConfig();
		$title = $context->getTitle();

		// Never apply to infrastructure namespaces or any talk page.
		// Talk pages are for discussion — bot/agent posts there shouldn't be
		// gated behind verification; that's where humans and agents coordinate.
		$exemptNamespaces = [ NS_MEDIAWIKI, NS_TEMPLATE, NS_CATEGORY, 828 /* Module */ ];
		if ( in_array( $title->getNamespace(), $exemptNamespaces, true ) || $title->isTalkPage() ) {
			return true;
		}

		// Only apply to configured namespaces
		$allowedNamespaces = $config->get( 'PickiPediaVerificationNamespaces' );
		if ( !in_array( $title->getNamespace(), $allowedNamespaces ) ) {
			return true;
		}

		// Check if user is in a bot group
		if ( !$this->isVerificationRequired( $user, $config ) ) {
			return true;
		}

		// Only handle text content
		if ( !$content instanceof TextContent ) {
			return true;
		}

		$text = $content->getText();

		// Every line this edit adds must carry a marker of its own.
		//
		// The check used to ask whether the page held a marker *anywhere*, and
		// passed the edit if it did. On a page with nothing pending that is the
		// same question; on a page with one proposal outstanding it is no
		// question at all, and a bot could append whatever it liked beside it.
		// That is the opposite of the failure mode you want from a gate, and it
		// got worse exactly when the wiki got busier — a page mid-review is
		// precisely a page carrying a marker (pickipedia#91).
		//
		// An edit that asserts nothing new still has nothing to mark. Removing a
		// paragraph, reverting a bot's own edit, or reordering existing lines
		// all leave content the bot is entitled to write; refusing those means a
		// bot can write something it is then forbidden from taking back.
		$previousText = $this->getCurrentText( $title );
		$unmarked = $this->firstUnmarkedNewLine( $previousText, $text );
		if ( $unmarked === null ) {
			return true;
		}

		// Reject the edit with helpful message
		wfDebugLog( 'PickiPediaVerification',
			"Unmarked new content on {$title->getPrefixedText()}: {$unmarked}"
		);
		$status->fatal( 'pickipediaverification-bot-needs-proposed' );
		$status->value = false;

		wfDebugLog( 'PickiPediaVerification',
			"Rejected bot edit from {$user->getName()} on {$title->getPrefixedText()} - missing verification markers"
		);

		return false;
	}

	/**
	 * Current saved wikitext of a page.
	 *
	 * @param \Title $title Page being edited.
	 * @return string|null Wikitext, or null if the page does not exist yet or
	 *   holds something other than text.
	 */
	private function getCurrentText( $title ): ?string {
		$revision = MediaWikiServices::getInstance()
			->getRevisionLookup()
			->getRevisionByTitle( $title );
		if ( !$revision ) {
			// Page creation. Everything in it is new, so it needs marking.
			return null;
		}

		$content = $revision->getContent( SlotRecord::MAIN );
		return $content instanceof TextContent ? $content->getText() : null;
	}

	/**
	 * The first line this edit adds that carries no marker, if there is one.
	 *
	 * Line-set comparison rather than a positional diff: moving a paragraph
	 * introduces no new assertion, so it should not demand a marker. Changing
	 * a line does count, because the changed line is one nobody has verified.
	 *
	 * Returns the offending line rather than a bare bool so the rejection can
	 * say what it objected to. A bot author staring at "missing verification
	 * markers" on a hundred-line edit needs to know which line.
	 *
	 * @param string|null $oldText Wikitext before the edit, or null on page
	 *   creation — where every line is new, which is correct.
	 * @param string $newText Wikitext being saved.
	 * @return string|null The first unmarked new line, or null if the edit is
	 *   acceptable.
	 */
	private function firstUnmarkedNewLine( ?string $oldText, string $newText ): ?string {
		$existing = [];
		foreach ( explode( "\n", $oldText ?? '' ) as $line ) {
			$normalized = $this->normalizeLine( $line );
			if ( $normalized !== '' ) {
				$existing[$normalized] = true;
			}
		}

		$lines = explode( "\n", $newText );
		$marked = $this->markedLines( $lines );

		foreach ( $lines as $i => $line ) {
			$normalized = $this->normalizeLine( $line );
			if ( $normalized === '' ) {
				continue;
			}
			// Already on the page. Moving or reindenting a line is not an
			// assertion, so it needs no marker.
			if ( isset( $existing[$normalized] ) ) {
				continue;
			}
			if ( $marked[$i] ) {
				continue;
			}
			if ( $this->cannotCarryMarker( $line ) ) {
				continue;
			}
			return $normalized;
		}

		return null;
	}

	/**
	 * Lines that have nowhere to put a marker.
	 *
	 * A heading, a category link and a table row all carry claims — a
	 * [[Category:Grammy Award winners]] asserts as much as a sentence does —
	 * but none of them has anywhere to hang a marker without breaking what it
	 * is. Wrapping a heading stops it being a heading; wrapping a table row
	 * breaks the table.
	 *
	 * So they are exempted, knowingly, and that is a real narrowing of this
	 * gate rather than a tidy-up. The alternative is refusing every bot edit
	 * that adds a section, which would stop the bots doing the job they exist
	 * for. The claims that ride in this way stay visible in RecentChanges and
	 * in the category listings themselves, which is a weaker check than
	 * verification but not no check at all.
	 *
	 * @param string $line Raw line.
	 * @return bool True if the line cannot be marked and is therefore allowed.
	 */
	private function cannotCarryMarker( string $line ): bool {
		$trimmed = trim( $line );
		return $trimmed === '' ||
			str_starts_with( $trimmed, '==' ) ||
			str_starts_with( $trimmed, '[[Category:' ) ||
			str_starts_with( $trimmed, '{|' ) ||
			str_starts_with( $trimmed, '|}' ) ||
			str_starts_with( $trimmed, '|' ) ||
			str_starts_with( $trimmed, '!' ) ||
			$trimmed === '}}';
	}

	/**
	 * Which lines a proposal marker covers.
	 *
	 * Markers are not all one line long, which is why this cannot be a simple
	 * per-line regex. A <proposed> tag opens and closes around a block, and a
	 * template's status parameter can sit on any line of a call that runs to a
	 * dozen. Both have to mark every line they span, or the gate rejects the
	 * body of a marker it just accepted the opening of.
	 *
	 * @param string[] $lines Lines of the text being saved.
	 * @return bool[] Parallel array; true where a marker covers the line.
	 */
	private function markedLines( array $lines ): array {
		$marked = array_fill( 0, count( $lines ), false );

		// <proposed> regions, opening and closing lines included.
		$inTag = false;
		foreach ( $lines as $i => $line ) {
			if ( $inTag ) {
				$marked[$i] = true;
				if ( preg_match( '/<\/proposed\s*>/i', $line ) ) {
					$inTag = false;
				}
				continue;
			}
			if ( preg_match( '/<proposed[\s>]/i', $line ) ) {
				$marked[$i] = true;
				$inTag = !preg_match( '/<\/proposed\s*>/i', $line );
			}
		}

		// Inline {{Bot_proposes}} marks its own line.
		foreach ( $lines as $i => $line ) {
			if ( preg_match( '/\{\{Bot_proposes/i', $line ) ) {
				$marked[$i] = true;
			}
		}

		// A template call carrying status=proposed marks the whole call. The
		// parameter can appear on any line of it, so the call has to be read to
		// its closing braces before the question can be answered, and only then
		// can the lines behind it be marked.
		$depth = 0;
		$start = null;
		$hasStatus = false;
		foreach ( $lines as $i => $line ) {
			if ( $start === null && str_contains( $line, '{{' ) ) {
				$start = $i;
				$hasStatus = false;
				$depth = 0;
			}
			if ( $start === null ) {
				continue;
			}
			if ( preg_match( '/\|\s*status\s*=\s*(proposed|unverified)/i', $line ) ) {
				$hasStatus = true;
			}
			$depth += substr_count( $line, '{{' ) - substr_count( $line, '}}' );
			if ( $depth <= 0 ) {
				if ( $hasStatus ) {
					for ( $j = $start; $j <= $i; $j++ ) {
						$marked[$j] = true;
					}
				}
				$start = null;
				$hasStatus = false;
				$depth = 0;
			}
		}

		return $marked;
	}

	/**
	 * Reduce a line to a form that ignores reindentation and rewrapping.
	 *
	 * @param string $line Raw line.
	 * @return string Normalized line; empty string for blank lines.
	 */
	private function normalizeLine( string $line ): string {
		return trim( preg_replace( '/\s+/', ' ', $line ) );
	}

	/**
	 * Check if user is in a group that requires verification.
	 */
	private function isVerificationRequired( $user, $config ): bool {
		$userGroups = $this->userGroupManager->getUserGroups( $user );

		// Check if user is in an exempt group (bypasses verification entirely)
		$exemptGroups = $config->get( 'PickiPediaVerificationExemptGroups' );
		if ( !empty( array_intersect( $userGroups, $exemptGroups ) ) ) {
			return false;
		}

		// Check if user is in a bot group (requires verification)
		$botGroups = $config->get( 'PickiPediaVerificationBotGroups' );
		return !empty( array_intersect( $userGroups, $botGroups ) );
	}

	/**
	 * Check if content is properly marked as proposed/unverified.
	 *
	 * Whole-text question, and deliberately no longer the gate's own: asking it
	 * of a page rather than of an edit is what let unmarked content ride in
	 * beside a pending proposal (pickipedia#91). Kept for callers that really
	 * do mean "does this text contain a marker" — markedLines() is what the
	 * gate uses now.
	 */
	private function isProperlyMarked( string $text ): bool {
		// Check for a <proposed> tag. Preferred over {{Bot_proposes}} for
		// anything containing pipes — see ParserHooks for why.
		if ( preg_match( '/<proposed[\s>]/i', $text ) ) {
			return true;
		}

		// Check for Bot_proposes template
		if ( preg_match( '/\{\{Bot_proposes/i', $text ) ) {
			return true;
		}

		// Check for status=proposed in template parameters
		if ( preg_match( '/\|\s*status\s*=\s*proposed/i', $text ) ) {
			return true;
		}

		// Check for status=unverified
		if ( preg_match( '/\|\s*status\s*=\s*unverified/i', $text ) ) {
			return true;
		}

		return false;
	}
}
