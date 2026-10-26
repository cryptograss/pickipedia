/**
 * Blue Railroads beside user links: how many each person holds, all songs together, as magenta shows them
 * beside names (magenta services/tokens.py). Justin, to-do 25 Oct: "Blue Railroads beside user links on
 * PickiPedia too".
 *
 * Counted here, from what the wiki knows, with two Semantic MediaWiki queries: each token's Owner Address
 * (Category:Blue Railroad Tokens, kept current by the import bot), and each user page's Ethereum Address.
 * Owner addresses are matched without regard to case. Counted in the browser, not the parser, so a page's
 * cached HTML never holds a stale count; kept in localStorage ten minutes, so a reader asks once.
 */
( function () {
	'use strict';

	var KEY = 'pickipedia-blue-railroads', KEPT_MS = 10 * 60 * 1000, PAGE = 500;
	var ICON = '<svg class="ico" viewBox="0 0 16 13" aria-hidden="true"><rect x="1" y="5" width="8.5" height="5" rx="1"/>' +
		'<rect x="9" y="1.5" width="5.5" height="8.5" rx="1"/><rect x="2.8" y="1.6" width="2.2" height="3.6" rx=".5"/>' +
		'<rect x="10.4" y="3" width="2.6" height="2.4" rx=".4" fill="#fff"/><rect x="0" y="9.6" width="16" height="1.1" rx=".5"/>' +
		'<circle cx="3.6" cy="11.4" r="1.6"/><circle cx="7.4" cy="11.4" r="1.6"/><circle cx="12" cy="11.4" r="1.6"/></svg>';

	function addressOf( value ) {
		return String( value && value.fulltext !== undefined ? value.fulltext : value || '' ).trim().toLowerCase();
	}

	/** Every result of an #ask query, following its offsets: { title: printouts }. */
	function askAll( query ) {
		var api = new mw.Api(), found = {};
		function from( offset ) {
			return api.get( { action: 'ask', query: query + '|limit=' + PAGE + '|offset=' + offset, formatversion: 2 } )
				.then( function ( answer ) {
					var results = ( answer.query && answer.query.results ) || {};
					Object.keys( results ).forEach( function ( title ) { found[ title ] = results[ title ].printouts || {}; } );
					return answer[ 'query-continue-offset' ] ? from( answer[ 'query-continue-offset' ] ) : found;
				} );
		}
		return from( 0 );
	}

	/** { user name: tokens held }, for everyone holding any. */
	function counts() {
		var kept = mw.storage.getObject( KEY );
		if ( kept && Date.now() - kept.at < KEPT_MS ) {
			return $.Deferred().resolve( kept.counts ).promise();
		}
		return $.when(
			askAll( '[[Category:Blue Railroad Tokens]]|?Owner Address' ),
			askAll( '[[Ethereum Address::+]]|?Ethereum Address' )
		).then( function ( tokens, users ) {
			var heldBy = {}, out = {};
			Object.keys( tokens ).forEach( function ( title ) {
				( tokens[ title ][ 'Owner Address' ] || [] ).forEach( function ( a ) {
					a = addressOf( a );
					heldBy[ a ] = ( heldBy[ a ] || 0 ) + 1;
				} );
			} );
			Object.keys( users ).forEach( function ( title ) {
				var n = 0, seen = {};
				if ( title.indexOf( 'User:' ) !== 0 ) {
					return;
				}
				( users[ title ][ 'Ethereum Address' ] || [] ).forEach( function ( a ) {
					a = addressOf( a );
					if ( a && !seen[ a ] ) {
						seen[ a ] = true;
						n += heldBy[ a ] || 0;
					}
				} );
				if ( n ) {
					out[ title.slice( 5 ) ] = n;
				}
			} );
			mw.storage.setObject( KEY, { at: Date.now(), counts: out } );
			return out;
		} );
	}

	/** The user a link goes to, if it's a link to a user page (not a subpage, nor their talk). */
	function userOf( a ) {
		var title = a.getAttribute( 'title' ) || '', ns = mw.config.get( 'wgFormattedNamespaces' )[ 2 ] || 'User';
		title = title.replace( / \(page does not exist\)$/, '' );
		return title.indexOf( ns + ':' ) === 0 && title.indexOf( '/' ) < 0 ? title.slice( ns.length + 1 ) : null;
	}

	function decorate( $root, held ) {
		var leaderboard = mw.util.getUrl( 'Blue Railroad Leaderboard' );
		$root.find( 'a[title]' ).each( function () {
			var user = userOf( this ), n = user && held[ user.replace( /_/g, ' ' ) ];
			if ( !n || this.nextSibling && this.nextSibling.className === 'pp-blue-railroads' ) {
				return;
			}
			$( '<a>' ).addClass( 'pp-blue-railroads' ).attr( {
				href: leaderboard,
				title: user + ' holds ' + n + ' Blue Railroad token' + ( n === 1 ? '' : 's' ) + ', all songs together'
			} ).html( ICON + n ).insertAfter( this );
		} );
	}

	mw.hook( 'wikipage.content' ).add( function ( $content ) {
		if ( !$content.find( 'a[title]' ).length ) {
			return;
		}
		counts().then( function ( held ) {
			decorate( $content, held );
		} );
	} );
}() );
