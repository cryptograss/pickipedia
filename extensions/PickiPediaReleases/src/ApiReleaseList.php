<?php
/**
 * API module for listing releases with IPFS CIDs and BitTorrent infohashes
 *
 * Usage: api.php?action=releaselist&format=json
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\PickiPediaReleases;

use ApiBase;
use MediaWiki\MediaWikiServices;
use Wikimedia\ParamValidator\ParamValidator;

class ApiReleaseList extends ApiBase {

	/**
	 * @inheritDoc
	 */
	public function execute(): void {
		$params = $this->extractRequestParams();
		$filter = $params['filter'];

		$releases = $this->getAllReleases();

		// Apply filters
		if ( $filter !== 'all' ) {
			$releases = array_filter( $releases, function ( $release ) use ( $filter ) {
				switch ( $filter ) {
					case 'ipfs':
						return !empty( $release['ipfs_cid'] );
					case 'torrent':
						return !empty( $release['bittorrent_infohash'] );
					case 'missing-torrent':
						return !empty( $release['ipfs_cid'] ) && empty( $release['bittorrent_infohash'] );
					default:
						return true;
				}
			} );
			$releases = array_values( $releases ); // Re-index
		}

		$result = $this->getResult();
		$result->addValue( null, 'releases', $releases );
		$result->addValue( null, 'count', count( $releases ) );
	}

	/**
	 * Query all pages in the Release namespace and extract their metadata
	 *
	 * @return array
	 */
	private function getAllReleases(): array {
		$services = MediaWikiServices::getInstance();
		$dbr = $services->getDBLoadBalancer()->getConnection( DB_REPLICA );
		$contentHandlerFactory = $services->getContentHandlerFactory();
		$wikiPageFactory = $services->getWikiPageFactory();
		$titleFactory = $services->getTitleFactory();

		// Get the Release namespace ID
		$nsRelease = defined( 'NS_RELEASE' ) ? NS_RELEASE : 3004;

		// Query all pages in the Release namespace
		$result = $dbr->newSelectQueryBuilder()
			->select( [ 'page_id', 'page_title' ] )
			->from( 'page' )
			->where( [
				'page_namespace' => $nsRelease,
				'page_is_redirect' => 0,
			] )
			->orderBy( 'page_title' )
			->caller( __METHOD__ )
			->fetchResultSet();

		$releases = [];

		foreach ( $result as $row ) {
			$title = $titleFactory->makeTitle( $nsRelease, $row->page_title );
			$wikiPage = $wikiPageFactory->newFromTitle( $title );
			$content = $wikiPage->getContent();

			// CID is the page title itself
			$cid = $row->page_title;

			// Get optional metadata from YAML if available
			$data = [];
			if ( $content instanceof ReleaseContent ) {
				$data = $content->getData();
			}

			$releaseInfo = [
				'page_id' => (int)$row->page_id,
				'page_title' => $row->page_title,
				'ipfs_cid' => $cid,
				'title' => $data['title'] ?? null,
				'description' => $data['description'] ?? null,
				'pinned_on' => $data['pinned_on'] ?? null,
				'bittorrent_infohash' => $data['bittorrent_infohash'] ?? null,
				'file_type' => $data['file_type'] ?? null,
				'file_size' => isset( $data['file_size'] ) ? (int)$data['file_size'] : null,
			];

			// Include trackers if present
			if ( !empty( $data['bittorrent_trackers'] ) ) {
				$releaseInfo['bittorrent_trackers'] = $data['bittorrent_trackers'];
			}

			$releases[] = $releaseInfo;
		}

		return $releases;
	}

	/**
	 * @inheritDoc
	 */
	public function getAllowedParams(): array {
		return [
			'filter' => [
				ParamValidator::PARAM_TYPE => [ 'all', 'ipfs', 'torrent', 'missing-torrent' ],
				ParamValidator::PARAM_DEFAULT => 'all',
				ApiBase::PARAM_HELP_MSG => 'apihelp-releaselist-param-filter',
			],
		];
	}

	/**
	 * @inheritDoc
	 */
	protected function getExamplesMessages(): array {
		return [
			'action=releaselist'
				=> 'apihelp-releaselist-example-all',
			'action=releaselist&filter=ipfs'
				=> 'apihelp-releaselist-example-ipfs',
		];
	}

	/**
	 * @inheritDoc
	 */
	public function getHelpUrls(): string {
		return 'https://pickipedia.xyz/wiki/Help:API';
	}

	/**
	 * @inheritDoc
	 */
	public function isReadMode(): bool {
		return true;
	}
}
