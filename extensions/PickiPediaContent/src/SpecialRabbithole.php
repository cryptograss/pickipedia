<?php
/**
 * Special:Rabbithole — the bridge back into /rabbithole/ after Special:UserLogin.
 *
 * MediaWiki's login form returns only to a wiki Title (Title::newFromText),
 * so a plain login link from Rabbithole fell back to Main_Page (Skyler,
 * #interfaces, 15 Nov 2026: signing in from August in Rabbithole landed on
 * the main page instead of back in August). Linking Special:UserLogin with
 * returnto=Special:Rabbithole&returntoquery=... brings the reader here with
 * the player's query intact, and this redirects straight to /rabbithole/.
 */

namespace MediaWiki\Extension\PickiPediaContent;

use MediaWiki\SpecialPage\UnlistedSpecialPage;

class SpecialRabbithole extends UnlistedSpecialPage {

	public function __construct() {
		parent::__construct( 'Rabbithole' );
	}

	/**
	 * The /rabbithole/ relative address for this request's query parameters,
	 * dropping MediaWiki's own `title` routing parameter.
	 */
	public static function targetUrl( array $query ): string {
		unset( $query['title'] );
		$qs = http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		return '/rabbithole/' . ( $qs !== '' ? '?' . $qs : '' );
	}

	/**
	 * @param string|null $par Unused
	 */
	public function execute( $par ) {
		$this->getOutput()->redirect(
			self::targetUrl( $this->getRequest()->getQueryValues() )
		);
	}
}
