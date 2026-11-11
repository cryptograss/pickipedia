<?php
/**
 * What a Release page says before it exists, when its release is already pinned.
 *
 * A finalize pins the release and saves its ReleaseDraft with the summary
 * "Finalized: pinned to IPFS as <cid>". The Release page itself is made
 * later, by the bot (blue-railroad-import, release_draft.py, which finds
 * drafts by that same summary). Until it runs, Release:<cid> was a bare
 * "There is currently no text in this page", which reads as if the release
 * were lost (Justin, 11 Nov 2026, on Release:QmNogi…).
 *
 * So a missing Release page whose CID a draft has finalized says so, names
 * the bot and the draft, and reloads itself once the page exists.
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use Wikimedia\Rdbms\IExpression;
use Wikimedia\Rdbms\LikeValue;

class ReleasePending {

	/** Minutes after a finalize past which a missing page means the bot is stuck. */
	private const STUCK_AFTER_MINUTES = 15;

	/**
	 * The finalize of this CID, if a ReleaseDraft has one.
	 *
	 * @param string $cid
	 * @param string $bot The bot's account, passed over when a person also saved it
	 * @return array{draft: Title, timestamp: string, user: string}|null
	 */
	public static function finalizeOf( string $cid, string $bot = '' ): ?array {
		// A CID is base58 or base32: refusing anything else keeps the LIKE
		// below free of wildcards and the lookup off subpages (/Metadata).
		if ( !preg_match( '/^[A-Za-z0-9]{40,100}$/', $cid ) ) {
			return null;
		}
		$dbr = MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		$rows = $dbr->newSelectQueryBuilder()
			->select( [ 'page_namespace', 'page_title', 'rev_timestamp', 'actor_name' ] )
			->from( 'revision' )
			->join( 'page', null, 'rev_page = page_id' )
			->join( 'comment', null, 'rev_comment_id = comment_id' )
			->join( 'actor', null, 'rev_actor = actor_id' )
			->where( [ 'page_namespace' => NS_RELEASEDRAFT ] )
			// The bot's own test (release_draft.find_cid_from_history), so this
			// page says "pending" exactly when the bot will make it.
			->where( $dbr->expr( 'comment_text', IExpression::LIKE,
				new LikeValue( $dbr->anyString(), 'pinned to IPFS as ' . $cid ) ) )
			->orderBy( 'rev_timestamp', 'DESC' )
			->limit( 5 )
			->caller( __METHOD__ )
			->fetchResultSet();
		// delivery-kid saves the draft as the bot when it pins, and the
		// person's browser saves it again a second later with the same
		// summary. "Finalized by" means the person, when they're there.
		$row = null;
		foreach ( $rows as $candidate ) {
			$row = $row ?? $candidate;
			if ( $candidate->actor_name !== $bot ) {
				$row = $candidate;
				break;
			}
		}
		if ( !$row ) {
			return null;
		}
		return [
			'draft' => Title::makeTitle( (int)$row->page_namespace, $row->page_title ),
			'timestamp' => wfTimestamp( TS_UNIX, $row->rev_timestamp ),
			'user' => $row->actor_name,
		];
	}

	/**
	 * The notice, in place of "There is currently no text in this page".
	 *
	 * @param string $cid
	 * @param array $finalize From finalizeOf()
	 * @param string $bot The account that makes Release pages
	 * @param string $gateway IPFS gateway, without a trailing slash
	 * @return string HTML
	 */
	public static function notice( string $cid, array $finalize, string $bot, string $gateway ): string {
		$minutes = (int)floor( ( time() - (int)$finalize['timestamp'] ) / 60 );
		$ago = $minutes < 1 ? 'less than a minute ago'
			: ( $minutes === 1 ? 'a minute ago' : "$minutes minutes ago" );
		$draft = $finalize['draft'];
		$botLink = Html::element( 'a',
			[ 'href' => Title::makeTitle( NS_USER, $bot )->getLocalURL() ], $bot );
		$draftLink = Html::element( 'a',
			[ 'href' => $draft->getLocalURL() ], $draft->getPrefixedText() );
		$userLink = Html::element( 'a',
			[ 'href' => Title::makeTitle( NS_USER, $finalize['user'] )->getLocalURL() ],
			$finalize['user'] );

		$html = Html::rawElement( 'p', [ 'class' => 'release-pending-lead' ],
			Html::element( 'strong', [], 'Release pending ' ) .
			Html::rawElement( 'strong', [], $botLink ) .
			Html::element( 'strong', [], ' activity from ' ) .
			Html::rawElement( 'strong', [], $draftLink ) .
			Html::element( 'strong', [], '.' ) );
		$html .= Html::rawElement( 'p', [],
			'It was pinned to IPFS and finalized by ' . $userLink . ' ' .
			htmlspecialchars( $ago ) . '. The bot makes the Release page from the draft, ' .
			'usually within a couple of minutes. This page reloads itself when it’s ready.' );

		if ( $minutes >= self::STUCK_AFTER_MINUTES ) {
			$html .= Html::element( 'p', [ 'class' => 'release-pending-stuck' ],
				"That's longer than the bot usually takes, so it may be stuck: " .
				'check its Jenkins job.' );
		}

		$html .= Html::rawElement( 'p', [],
			'Meanwhile, it’s already on IPFS: ' .
			Html::element( 'a', [ 'href' => "$gateway/ipfs/$cid", 'class' => 'external' ],
				"$gateway/ipfs/$cid" ) );

		return Html::rawElement( 'div', [
			'class' => 'release-pending',
			'data-release-title' => 'Release:' . $cid,
		], $html );
	}
}
