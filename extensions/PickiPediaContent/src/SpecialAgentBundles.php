<?php
/**
 * Special:AgentBundles: every rules bundle an agent was given, newest first,
 * and any one of them rebuilt from this wiki's revisions to read
 * (Special:AgentBundles/<id>). The list comes from magenta, where the runners
 * record them; the text never does: it is rebuilt here, and checked against
 * the sha256 the runner recorded (src/Bundles.php).
 *
 * Open to anyone, as the rules pages and the Moods are.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Title\Title;
use TextContent;

class SpecialAgentBundles extends SpecialPage {

	private const PER_PAGE = 50;

	public function __construct() {
		parent::__construct( 'AgentBundles' );
	}

	/**
	 * @param string|null $par A record's id, to read that one
	 */
	public function execute( $par ) {
		$this->setHeaders();
		$this->getOutput()->addModuleStyles( [ 'mediawiki.special' ] );
		$id = strtolower( trim( (string)( $par ?: $this->getRequest()->getVal( 'bundle', '' ) ) ) );
		if ( $id !== '' ) {
			$this->showOne( $id );
			return;
		}
		$this->showList();
	}

	private function magentaUrl( string $path, array $query = [] ): string {
		$base = rtrim( (string)$this->getConfig()->get( 'PickiPediaContentMagentaUrl' ), '/' );
		return $base . $path . ( $query ? '?' . wfArrayToCgi( $query ) : '' );
	}

	/** magenta's answer, decoded, or null if it couldn't be had. */
	private function magenta( string $path, array $query = [] ): ?array {
		$body = MediaWikiServices::getInstance()->getHttpRequestFactory()
			->get( $this->magentaUrl( $path, $query ), [ 'timeout' => 10 ], __METHOD__ );
		$data = $body === null ? null : json_decode( $body, true );
		return is_array( $data ) ? $data : null;
	}

	private function revisionLink( array $part ): string {
		$title = Title::newFromText( (string)( $part['page'] ?? '' ) );
		$label = ( $part['page'] ?? '?' ) . ' r' . ( $part['revision'] ?? '?' );
		if ( !$title || !is_int( $part['revision'] ?? null ) ) {
			return htmlspecialchars( $label );
		}
		return Html::element( 'a', [ 'href' => $title->getLocalURL( [ 'oldid' => $part['revision'] ] ) ], $label );
	}

	private function showList(): void {
		$out = $this->getOutput();
		$request = $this->getRequest();
		$query = array_filter( [
			'agent' => $request->getVal( 'agent', '' ),
			'mood' => $request->getVal( 'mood', '' ),
			'before' => $request->getVal( 'before', '' ),
			'limit' => self::PER_PAGE,
		] );
		$out->addWikiTextAsInterface( "Every rules bundle an agent of cryptograss was given as its system prompt, "
			. "newest first, as magenta recorded it: which revisions of which pages, and when it was asked for, "
			. "made and delivered. '''Read''' rebuilds one from this wiki's own revisions and checks it against "
			. "the checksum recorded when it was given." );

		$form = Html::openElement( 'form', [ 'method' => 'get', 'action' => $this->getPageTitle()->getLocalURL() ] )
			. Html::label( 'Agent ', 'ab-agent' )
			. Html::input( 'agent', $query['agent'] ?? '', 'text', [ 'id' => 'ab-agent', 'size' => 10 ] ) . ' '
			. Html::label( 'Mood ', 'ab-mood' )
			. Html::input( 'mood', $query['mood'] ?? '', 'text', [ 'id' => 'ab-mood', 'size' => 20 ] ) . ' '
			. Html::element( 'button', [ 'type' => 'submit' ], 'Show' )
			. Html::closeElement( 'form' );
		$out->addHTML( $form );

		$data = $this->magenta( '/api/bundles/', $query );
		if ( $data === null || !isset( $data['bundles'] ) ) {
			$out->addHTML( Html::errorBox( htmlspecialchars( "magenta couldn't be read just now ("
				. $this->magentaUrl( '/api/bundles/' ) . ')' ) ) );
			return;
		}
		if ( !$data['bundles'] ) {
			$out->addWikiTextAsInterface( "''No bundles recorded" . ( count( $query ) > 1 ? ' for that.' : ' yet.' ) . "''" );
			return;
		}
		$rows = Html::openElement( 'table', [ 'class' => 'wikitable' ] )
			. '<tr><th>Asked for (UTC)</th><th>Block</th><th>Agent</th><th>Mood</th><th>Delivered</th>'
			. '<th>Revisions</th><th>sha256</th><th></th></tr>';
		foreach ( $data['bundles'] as $b ) {
			if ( !preg_match( Bundles::ID, (string)( $b['id'] ?? '' ) ) ) {
				continue;
			}
			$pages = implode( '<br>', array_map( $this->revisionLink( ... ), $b['pages'] ?? [] ) );
			$notes = [];
			if ( !empty( $b['degraded'] ) ) {
				$notes[] = 'degraded';
			}
			if ( !empty( $b['error'] ) ) {
				$notes[] = 'recovery rules';
			}
			$read = Html::openElement( 'form', [ 'method' => 'get',
					'action' => $this->getPageTitle( $b['id'] )->getLocalURL() ] )
				. Html::element( 'button', [ 'type' => 'submit' ], 'Read' )
				. Html::closeElement( 'form' );
			$rows .= '<tr>'
				. Html::element( 'td', [], substr( (string)( $b['requested_at'] ?? '' ), 0, 19 ) )
				. Html::element( 'td', [], isset( $b['block'] ) && is_int( $b['block'] ) ? number_format( $b['block'] ) : '' )
				. Html::element( 'td', [], (string)( $b['agent'] ?? '' ) )
				. Html::element( 'td', [], (string)( $b['mood'] ?? '' ) )
				. Html::element( 'td', [], !empty( $b['delivered_at'] ) ? substr( (string)$b['delivered_at'], 11, 8 ) : 'never' )
				. Html::rawElement( 'td', [], $pages . ( $notes ? '<br><i>' . htmlspecialchars( implode( ', ', $notes ) ) . '</i>' : '' ) )
				. Html::element( 'td', [], substr( (string)( $b['sha256'] ?? '' ), 0, 12 ) )
				. Html::rawElement( 'td', [], $read )
				. '</tr>';
		}
		$out->addHTML( $rows . Html::closeElement( 'table' ) );
		if ( !empty( $data['before'] ) ) {
			$out->addHTML( Html::element( 'a', [ 'href' => $this->getPageTitle()->getLocalURL(
				array_merge( $query, [ 'before' => $data['before'] ] ) ) ], 'Older →' ) );
		}
	}

	/** A revision's wikitext as anyone may read it, or null: gone, hidden, or not text. */
	private function revisionText( int $revision ): ?string {
		$found = MediaWikiServices::getInstance()->getRevisionLookup()->getRevisionById( $revision );
		if ( !$found || $found->isDeleted( RevisionRecord::DELETED_TEXT ) ) {
			return null;
		}
		$content = $found->getContent( SlotRecord::MAIN, RevisionRecord::FOR_PUBLIC );
		return $content instanceof TextContent ? $content->getText() : null;
	}

	private function showOne( string $id ): void {
		$out = $this->getOutput();
		$back = Html::element( 'a', [ 'href' => $this->getPageTitle()->getLocalURL() ], '← every bundle' );
		if ( !preg_match( Bundles::ID, $id ) ) {
			$out->addHTML( Html::errorBox( 'That is not a bundle id.' ) . $back );
			return;
		}
		$path = "/api/bundles/$id/";
		$record = $this->magenta( $path );
		if ( $record === null || !isset( $record['parts'] ) || !is_array( $record['parts'] ) ) {
			$out->addHTML( Html::errorBox( htmlspecialchars( "magenta has no bundle $id, or couldn't be read just now." ) ) . $back );
			return;
		}
		$agent = (string)( $record['agent'] ?? '?' );
		$out->setPageTitle( "The rules $agent was given" . ( !empty( $record['mood'] ) ? " in #{$record['mood']}" : '' ) );

		$facts = [
			'Asked for' => $record['requested_at'] ?? '',
			'Made' => $record['produced_at'] ?? '',
			'Delivered' => $record['delivered_at'] ?: 'never: its harness did not start',
			'Block' => isset( $record['block'] ) && is_int( $record['block'] ) ? number_format( $record['block'] ) : '',
			'Session' => $record['session_id'] ?? '',
			'Harness' => $record['harness'] ?? '',
			'magenta commit' => $record['commit'] ?? '',
			'sha256 given' => $record['sha256'] ?? '',
		];
		$table = Html::openElement( 'table', [ 'class' => 'wikitable' ] );
		foreach ( $facts as $name => $value ) {
			if ( (string)$value !== '' ) {
				$table .= '<tr>' . Html::element( 'th', [], $name ) . Html::element( 'td', [], (string)$value ) . '</tr>';
			}
		}
		$table .= '<tr><th>Revisions</th><td>'
			. implode( '<br>', array_map( $this->revisionLink( ... ), array_filter( $record['parts'], 'is_array' ) ) )
			. '</td></tr>' . Html::closeElement( 'table' );
		$out->addHTML( $table );

		foreach ( (array)( $record['degraded'] ?? [] ) as $line ) {
			$out->addHTML( Html::warningBox( htmlspecialchars( "Degraded: $line" ) ) );
		}
		if ( !empty( $record['error'] ) ) {
			$out->addHTML( Html::warningBox( htmlspecialchars( "Its rules couldn't be gathered ({$record['error']}): "
				. 'it was given the recovery rules.' ) ) );
		}

		$again = Bundles::rebuild( $record['parts'], $this->revisionText( ... ) );
		if ( $again['text'] === null ) {
			$out->addHTML( Html::errorBox( htmlspecialchars( 'It cannot be rebuilt: this wiki no longer shows revision(s) '
				. implode( ', ', $again['missing'] ) . '.' ) ) );
		} elseif ( Bundles::matches( $again['text'], (string)( $record['sha256'] ?? '' ) ) ) {
			$out->addHTML( Html::successBox( htmlspecialchars( "Rebuilt from this wiki's revisions, it is identical to what "
				. "$agent was given: the sha256 matches." ) ) );
		} else {
			$out->addHTML( Html::errorBox( htmlspecialchars( "Rebuilt from this wiki's revisions, it DIFFERS from what $agent "
				. 'was given (sha256 ' . hash( 'sha256', $again['text'] ) . '). What follows is the rebuild, not what was given.' ) ) );
		}
		if ( $again['text'] !== null ) {
			$out->addHTML( Html::element( 'pre', [ 'style' => 'white-space: pre-wrap;' ], $again['text'] ) );
		}
		$out->addHTML( Html::element( 'a', [ 'href' => $this->magentaUrl( $path ) ], 'This record in magenta' ) . ' · ' . $back );
	}

	protected function getGroupName() {
		return 'wiki';
	}
}
