/**
 * A page that is a tiding on magenta says so at its foot, in a small magenta
 * box linking to the discussion there (Justin, #interfaces, 13 Nov 2026).
 * magenta says whether it is, and the words: Magenta:Interface's
 * wiki-tiding-banner. Not a tiding, or magenta away: nothing is shown.
 */
( function () {
	'use strict';
	var base = mw.config.get( 'wgPickiPediaMagenta' );
	var title = mw.config.get( 'wgPageName' );
	if ( !base || !title || !window.fetch ) {
		return;
	}
	fetch( base + '/api/wiki/tiding/?title=' + encodeURIComponent( title.replace( /_/g, ' ' ) ) )
		.then( function ( r ) { return r.ok ? r.json() : {}; } )
		.then( function ( found ) {
			if ( !found || !found.tiding || !/^https:\/\//.test( found.tiding ) ) {
				return;
			}
			var box = document.createElement( 'a' );
			box.className = 'pp-tiding-banner';
			box.href = found.tiding;
			var mark = document.createElement( 'span' );
			mark.className = 'pp-tiding-banner__mark';
			mark.setAttribute( 'aria-hidden', 'true' );
			var words = document.createElement( 'span' );
			words.className = 'pp-tiding-banner__words';
			words.textContent = found.words || '';
			var go = document.createElement( 'span' );
			go.className = 'pp-tiding-banner__go';
			go.setAttribute( 'aria-hidden', 'true' );
			go.textContent = '→';
			box.appendChild( mark );
			box.appendChild( words );
			box.appendChild( go );
			// At the article's foot, above its categories (Justin, 13 Nov: "the bottom of the
			// article instead of the top").
			var content = document.getElementById( 'mw-content-text' );
			if ( content ) {
				content.parentNode.insertBefore( box, content.nextSibling );
			}
		} )
		.catch( function () {} );
}() );
