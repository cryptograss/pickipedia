<?php

namespace MediaWiki\Extension\PickiPediaVerification;

use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;
use MediaWiki\SpecialPage\SpecialPage;

/**
 * A "Verify all on this page" button, at the top of a page that has unverified
 * bot claims, for someone who may verify them.
 *
 * Justin, 24 Oct: "I still really want/need a 'verify all' button for a page
 * that I'm looking at." Until now verifying meant going to
 * Special:VerifyBotEdits and finding the page in a list of every page with a
 * claim; the button posts the same form that page's own row button does
 * (verify_page), and comes back here once it's done.
 *
 * Its own handler rather than a method on Hooks: tests/check-gate.php loads
 * Hooks.php against stubbed MediaWiki symbols, and this needs none of them.
 */
class PageHooks {

	private const CATEGORY = 'Pages with unverified bot claims';

	/**
	 * Hook: BeforePageDisplay
	 *
	 * @param \OutputPage $out
	 * @param \Skin $skin
	 * @return void
	 */
	public function onBeforePageDisplay( $out, $skin ): void {
		$title = $out->getTitle();
		$request = $out->getRequest();
		// The page as it is now, being read: not an old revision, a diff, an edit.
		if ( !$title || !$title->exists() || !$out->isArticle()
			|| $request->getVal( 'oldid' ) || $request->getVal( 'diff' ) ) {
			return;
		}
		$categories = array_map( static function ( $c ) {
			return str_replace( '_', ' ', $c );
		}, $out->getCategories() );
		if ( !in_array( self::CATEGORY, $categories, true ) ) {
			return;
		}
		$user = $out->getUser();
		if ( !$user->isRegistered() || $this->isBot( $user ) ) {
			return;  // a bot's verifying is no one's verifying
		}
		$services = MediaWikiServices::getInstance();
		if ( !$services->getPermissionManager()->userCan( 'edit', $user, $title ) ) {
			return;
		}

		// How many claims the reader can see marked: {{Bot_proposes}} and <proposed>.
		$html = $out->getHTML();
		$claims = substr_count( $html, 'class="bot-proposal"' )
			+ preg_match_all( '/class="pv-proposed pv-proposed--/', $html );
		$label = $claims === 1 ? '✓ Verify the 1 claim'
			: ( $claims > 1 ? "✓ Verify all $claims claims" : '✓ Verify all claims' );
		$ask = $claims === 1
			? 'Verify the 1 bot claim on this page? Its marker is removed, in one edit you can undo.'
			: 'Verify every bot claim on this page? Their markers are removed, in one edit you can undo.';

		$form = Html::rawElement( 'form', [
			'method' => 'post',
			'action' => SpecialPage::getTitleFor( 'VerifyBotEdits' )->getLocalURL(),
			'class' => 'pv-verify-all',
			'onsubmit' => 'return confirm(' . json_encode( $ask ) . ')',
		],
			Html::hidden( 'action', 'verify' ) .
			Html::hidden( 'token', $user->getEditToken() ) .
			Html::hidden( 'verify_page', (string)$title->getArticleID() ) .
			Html::hidden( 'returnto', $title->getPrefixedDBkey() ) .
			Html::element( 'button', [
				'type' => 'submit',
				'class' => 'pv-verify-all__button',
				'title' => 'You have read these and they are right: remove every bot-proposal marker on this page',
			], $label )
		);
		$out->setIndicators( [ 'pv-verify-all' => $form ] );
		$out->addModuleStyles( [ 'ext.pickipediaVerification.styles' ] );
	}

	/**
	 * In a group whose edits need verifying, and not exempt (as Hooks::isVerificationRequired).
	 */
	private function isBot( $user ): bool {
		$services = MediaWikiServices::getInstance();
		$config = $services->getMainConfig();
		$groups = $services->getUserGroupManager()->getUserGroups( $user );
		if ( array_intersect( $groups, $config->get( 'PickiPediaVerificationExemptGroups' ) ) ) {
			return false;
		}
		return (bool)array_intersect( $groups, $config->get( 'PickiPediaVerificationBotGroups' ) );
	}
}
