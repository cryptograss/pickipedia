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
		if ( $unmarked !== null ) {
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

		// In a strict namespace, what the page already says stays, in its
		// place, unless its going is proposed too. The allowance above (a
		// bot may take back what it wrote, unmarked) is right for an article,
		// where a removed claim claims nothing. It is wrong for instructions,
		// where "never push to main" taken away changes what an agent does as
		// much as a new line would, and a page with nothing proposed on it is
		// read by the runner as one a person stood behind. So here a removal
		// is a proposal: the line stays, struck through, until verified
		// (Justin, emergence, 27 Oct 2026).
		$strict = $config->get( 'PickiPediaVerificationStrictNamespaces' );
		if ( in_array( $title->getNamespace(), $strict ) ) {
			$unkept = $this->firstUnkeptOldLine( $previousText, $text );
			if ( $unkept !== null ) {
				wfDebugLog( 'PickiPediaVerification',
					"Unmarked removal on {$title->getPrefixedText()}: {$unkept}"
				);
				$status->fatal( 'pickipediaverification-bot-needs-removal-marker' );
				$status->value = false;
				return false;
			}
		}

		return true;
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
	 * The first line of the page that this edit takes away, or moves, without
	 * proposing it (strict namespaces only).
	 *
	 * Every non-blank line of the old text must turn up in the new text in
	 * the same order, or inside a <proposed action="remove"> marker. A moved
	 * line fails the order test, on purpose: moving "never push to main"
	 * under a line that contradicts it changes the page's meaning as surely
	 * as removing it. To move a line, propose its removal and add it again,
	 * marked.
	 *
	 * @param string|null $oldText Wikitext before the edit, or null on page
	 *   creation, where nothing can have been taken away.
	 * @param string $newText Wikitext being saved.
	 * @return string|null The first old line not kept, or null if every
	 *   line is kept or its removal is proposed.
	 */
	private function firstUnkeptOldLine( ?string $oldText, string $newText ): ?string {
		if ( $oldText === null ) {
			return null;
		}
		$old = [];
		foreach ( explode( "\n", $oldText ) as $line ) {
			$normalized = $this->normalizeLine( $line );
			if ( $normalized !== '' ) {
				$old[] = $normalized;
			}
		}

		[ $kept, $removed ] = $this->keptAndRemovedLines( explode( "\n", $newText ) );
		$removedLeft = array_count_values( $removed );

		$at = 0;
		foreach ( $old as $line ) {
			if ( ( $removedLeft[$line] ?? 0 ) > 0 ) {
				$removedLeft[$line]--;
				continue;
			}
			$found = false;
			for ( $i = $at, $n = count( $kept ); $i < $n; $i++ ) {
				if ( $kept[$i] === $line ) {
					$at = $i + 1;
					$found = true;
					break;
				}
			}
			if ( !$found ) {
				return $line;
			}
		}
		return null;
	}

	/**
	 * The new text's lines, split into the ones that stay on the page and
	 * the ones a <proposed action="remove"> marker says are to go.
	 *
	 * Block form, the tags on their own lines, covers the lines between
	 * them; inline form covers the rest of its own line, with the tags
	 * taken out, so "* <proposed action="remove">foo</proposed>" proposes
	 * removing "* foo". The tag lines of the block form count as kept, so
	 * a removal proposed earlier and still pending is itself a line of the
	 * page that stays put.
	 *
	 * @param string[] $lines Lines of the text being saved.
	 * @return array{0: string[], 1: string[]} [kept, removed], normalized,
	 *   blanks dropped.
	 */
	private function keptAndRemovedLines( array $lines ): array {
		$kept = [];
		$removed = [];
		$opens = '/<proposed\b[^>]*\baction\s*=\s*["\']?remove\b[^>]*>/i';
		$closes = '/<\/proposed\s*>/i';
		$inRemoval = false;
		foreach ( $lines as $line ) {
			$normalized = $this->normalizeLine( $line );
			if ( $inRemoval ) {
				if ( preg_match( $closes, $line ) ) {
					$inRemoval = false;
					$before = $this->normalizeLine( preg_replace( $closes, '', $line ) );
					if ( $before !== '' ) {
						$removed[] = $before;
					}
					$kept[] = $this->normalizeLine( '</proposed>' );
					continue;
				}
				if ( $normalized !== '' ) {
					$removed[] = $normalized;
				}
				continue;
			}
			if ( preg_match( $opens, $line, $open ) ) {
				if ( preg_match( $closes, $line ) ) {
					// Inline: the line's own text, tags off, is what goes.
					$inner = $this->normalizeLine( preg_replace( [ $opens, $closes ], '', $line ) );
					if ( $inner !== '' ) {
						$removed[] = $inner;
					}
					continue;
				}
				$inRemoval = true;
				$kept[] = $this->normalizeLine( $open[0] );
				continue;
			}
			if ( $normalized !== '' ) {
				$kept[] = $normalized;
			}
		}
		return [ $kept, $removed ];
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
		if ( $trimmed === '' ||
			str_starts_with( $trimmed, '==' ) ||
			str_starts_with( $trimmed, '[[Category:' ) ||
			str_starts_with( $trimmed, '{|' ) ||
			str_starts_with( $trimmed, '|}' ) ||
			str_starts_with( $trimmed, '|' ) ||
			str_starts_with( $trimmed, '!' ) ||
			$trimmed === '}}'
		) {
			return true;
		}

		// A list item that is nothing but a link — a See also entry, a
		// navigation list — asserts only that two pages are related, and the
		// bot middleware deliberately leaves those bare for that reason.
		//
		// The gate has to agree with it. When the two halves of this disagree
		// the result is not a stricter wiki, it is a bot that cannot write a
		// See also section at all: the middleware declines to mark the line,
		// the gate then refuses the whole edit, and the rejection names a line
		// nobody can fix. Add descriptive text after the link and it stops
		// being navigation, becomes a claim, gets marked, and is judged.
		return (bool)preg_match( '/^[*#:;]+\s*\[\[[^\]]+\]\]\s*$/', $trimmed );
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
