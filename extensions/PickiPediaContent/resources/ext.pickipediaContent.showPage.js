/**
 * Show: pages, as a poster.
 *
 * A mainspace page whose title starts with "Show:" (the convention from
 * before there was a namespace) is drawn as a poster: a hero built from
 * {{Show}}'s infobox, the wiki's chrome out of the way, and the setlist
 * numbered. The infobox itself is read for its fields and then taken out
 * of the page.
 *
 * This lived on the wiki, at MediaWiki:Gadget-pickipedia-show.js, where
 * nothing could test it and nothing reviewed it: a typo there was live on
 * every show page the moment it was saved. Justin, #connectome, 26 Nov
 * 2026: "Can we replace it with something testable?" So it is here, the
 * way the video player came here from MediaWiki:Common.js (#124), and
 * everything that decides what the hero says is a function that takes
 * values and returns a string -- tools/test_show_page.mjs runs those with
 * no browser under them.
 *
 * The page is read in one place (readShow), the markup written in another
 * (heroHtml), and only the first touches the DOM.
 *
 * While MediaWiki:Gadgets-definition still names the old gadget, both this
 * and it may load. Whichever is first wins: this one stops if a hero is
 * already there, and when it builds one it removes the infobox, which is
 * what the gadget looks for before it does anything.
 */
( function () {
	'use strict';

	var POSTER_WIDTH = 800;

	/**
	 * The show's own bacon graph. wgPageName comes with underscores for
	 * spaces; the graph wants the title as it is written.
	 *
	 * @param {string} pageName e.g. "Show:KyleTuttle-26482267"
	 * @return {string}
	 */
	function baconHref( pageName ) {
		return '/bacon?m=' + encodeURIComponent( 'wiki:' + String( pageName || '' ).replace( /_/g, ' ' ) );
	}

	/**
	 * A block height as people read it: 26482267 becomes 26,482,267.
	 *
	 * @param {string|number} value
	 * @return {string} the digits grouped, or the value as given if it holds none
	 */
	function formatBlock( value ) {
		var digits = String( value == null ? '' : value ).replace( /[^\d]/g, '' );
		var asInt = parseInt( digits, 10 );
		if ( isNaN( asInt ) ) {
			return String( value == null ? '' : value ).trim();
		}
		return asInt.toString().replace( /\B(?=(\d{3})+(?!\d))/g, ',' );
	}

	/**
	 * The kicker's block, linked to etherscan where the infobox linked it.
	 *
	 * @param {string} text the block as the infobox says it
	 * @param {string} href etherscan, or empty
	 * @return {string} HTML, or empty when there is no block
	 */
	function blockKicker( text, href ) {
		var formatted = formatBlock( text );
		if ( !formatted ) {
			return '';
		}
		if ( href ) {
			return '<a href="' + escapeHtml( href ) + '" target="_blank" rel="noopener">Block ' +
				formatted + '</a>';
		}
		return 'Block ' + formatted;
	}

	/**
	 * A sharper poster from a thumbnail: /220px-foo.png becomes /800px-foo.png.
	 * Anything the wiki didn't thumbnail (an SVG, say) is left as it is.
	 *
	 * @param {string} src
	 * @return {string}
	 */
	function bigPosterSrc( src ) {
		return String( src || '' ).replace( /\/(\d+)px-/, '/' + POSTER_WIDTH + 'px-' );
	}

	/**
	 * What the infobox's classes say about whether a person has checked this.
	 *
	 * @param {string[]|DOMTokenList} classes
	 * @return {string} verified, proposed, unverified, or empty
	 */
	function statusOf( classes ) {
		var list = Array.prototype.slice.call( classes || [] );
		if ( list.indexOf( 'show-verified' ) !== -1 ) {
			return 'verified';
		}
		if ( list.indexOf( 'bot-proposal' ) !== -1 ) {
			return 'proposed';
		}
		if ( list.indexOf( 'show-unverified' ) !== -1 ) {
			return 'unverified';
		}
		return '';
	}

	function escapeHtml( s ) {
		return String( s == null ? '' : s )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' );
	}

	/**
	 * The hero, from what the page said. Values that came out of the infobox
	 * as markup (the venue's link, the artists' links) are kept as markup;
	 * values that were only ever text are escaped here.
	 *
	 * @param {Object} show
	 * @param {string} show.title artists, as HTML
	 * @param {string} show.fallbackTitle used when there are no artists
	 * @param {string} show.venue as HTML
	 * @param {string} show.date human-readable, as text
	 * @param {string} show.blockText
	 * @param {string} show.blockHref
	 * @param {string} show.doors
	 * @param {string} show.show
	 * @param {string} show.price
	 * @param {string} show.ages as HTML
	 * @param {string} show.status
	 * @param {string} show.ticketsHref
	 * @param {string} show.baconHref
	 * @param {Object|null} show.image { src, href, alt, artist }
	 * @return {string}
	 */
	function heroHtml( show ) {
		var out = '';

		if ( show.status ) {
			out += '<div class="pp-status is-' + escapeHtml( show.status ) + '">' +
				escapeHtml( show.status ) + '</div>';
		}
		if ( show.date ) {
			out += '<div class="pp-date-kicker">' + escapeHtml( show.date ) + '</div>';
		}

		var kicker = [];
		var block = blockKicker( show.blockText, show.blockHref );
		if ( block ) {
			kicker.push( block );
		}
		if ( show.doors ) {
			kicker.push( 'Doors ' + escapeHtml( show.doors ) );
		}
		if ( show.show ) {
			kicker.push( 'Show ' + escapeHtml( show.show ) );
		}
		if ( kicker.length ) {
			out += '<div class="pp-kicker">' + kicker.join( '<span class="pp-sep">·</span>' ) + '</div>';
		}

		out += '<h1 class="pp-title">' + ( show.title || escapeHtml( show.fallbackTitle ) ) + '</h1>';

		if ( show.venue ) {
			out += '<p class="pp-venue">at ' + show.venue + '</p>';
		}

		var meta = [];
		if ( show.price ) {
			meta.push( '<span><span class="pp-meta-label">Price</span><span class="pp-meta-value">$' +
				escapeHtml( String( show.price ).replace( /^\$/, '' ) ) + '</span></span>' );
		}
		if ( show.ages ) {
			meta.push( '<span><span class="pp-meta-label">Ages</span><span class="pp-meta-value">' +
				show.ages + '</span></span>' );
		}
		if ( meta.length ) {
			out += '<div class="pp-meta">' + meta.join( '' ) + '</div>';
		}

		if ( show.image && show.image.src ) {
			var img = '<img src="' + escapeHtml( bigPosterSrc( show.image.src ) ) + '" alt="' +
				escapeHtml( show.image.alt || '' ) + '">';
			var wrapped = show.image.href
				? '<a class="pp-image-link" href="' + escapeHtml( show.image.href ) +
					'" title="View file details">' + img + '</a>'
				: img;
			out += '<div class="pp-image">' + wrapped +
				( show.image.artist
					? '<p class="pp-poster-credit"><span class="pp-poster-credit-label">Poster art by</span> ' +
						escapeHtml( show.image.artist ) + '</p>'
					: '' ) +
				'</div>';
		}

		var actions = [];
		if ( show.ticketsHref ) {
			actions.push( '<a href="' + escapeHtml( show.ticketsHref ) +
				'" target="_blank" rel="noopener">Tickets</a>' );
		}
		// Every show has a bacon graph, whether or not anything is drawn there
		// yet (Justin, #connectome, 26 Nov 2026: "still don't see a link from
		// show pages to their bacon graph").
		if ( show.baconHref ) {
			actions.push( '<a href="' + escapeHtml( show.baconHref ) +
				'" title="This show on a bacon graph">🥓 Bacon graph</a>' );
		}
		if ( actions.length ) {
			out += '<div class="pp-actions">' + actions.join( '' ) + '</div>';
		}

		return out;
	}

	// ---------- what touches the page ----------

	/**
	 * {{Show}} emits rows of <div><strong>Label:</strong> value</div>.
	 * Returns the value as markup, without its label.
	 *
	 * @param {Element} infobox
	 * @param {string} label
	 * @return {string}
	 */
	function fieldValue( infobox, label ) {
		var rows = infobox.querySelectorAll( 'div' );
		for ( var i = 0; i < rows.length; i++ ) {
			var strong = rows[ i ].querySelector( 'strong' );
			if ( !strong ) {
				continue;
			}
			if ( strong.textContent.replace( /[:\s]*$/, '' ).trim() !== label ) {
				continue;
			}
			var clone = rows[ i ].cloneNode( true );
			var itsLabel = clone.querySelector( 'strong' );
			if ( itsLabel ) {
				itsLabel.remove();
			}
			return clone.innerHTML.trim().replace( /^[\s:]+/, '' );
		}
		return '';
	}

	/** The one anchor in a field's markup, or null. */
	function anchorIn( html ) {
		var box = document.createElement( 'div' );
		box.innerHTML = html;
		return box.querySelector( 'a' );
	}

	/**
	 * Everything the hero needs, read off the infobox.
	 *
	 * @param {Element} infobox
	 * @param {string} pageName
	 * @param {string} title wgTitle
	 * @return {Object} as heroHtml wants it
	 */
	function readShow( infobox, pageName, title ) {
		var showtime = fieldValue( infobox, 'Showtime' );
		var blockAnchor = showtime ? anchorIn( showtime ) : null;
		var tickets = fieldValue( infobox, 'Tickets' );
		var ticketAnchor = tickets ? anchorIn( tickets ) : null;
		var img = infobox.querySelector( 'img' );
		var imgAnchor = img ? img.closest( 'a' ) : null;

		return {
			title: fieldValue( infobox, 'Artists' ),
			fallbackTitle: title.replace( /^Show:\s*/, '' ),
			venue: fieldValue( infobox, 'Venue' ),
			date: stripTags( fieldValue( infobox, 'Date' ) ),
			blockText: blockAnchor ? blockAnchor.textContent : stripTags( showtime ),
			blockHref: blockAnchor ? blockAnchor.href : '',
			doors: stripTags( fieldValue( infobox, 'Doors' ) ),
			show: stripTags( fieldValue( infobox, 'Show' ) ),
			price: stripTags( fieldValue( infobox, 'Price' ) ),
			ages: fieldValue( infobox, 'Ages' ),
			status: statusOf( infobox.classList ),
			ticketsHref: ticketAnchor ? ticketAnchor.href : '',
			baconHref: baconHref( pageName ),
			image: img ? {
				src: img.src,
				href: imgAnchor ? imgAnchor.getAttribute( 'href' ) : '',
				alt: img.alt || '',
				artist: stripTags( fieldValue( infobox, 'Poster art' ) )
			} : null
		};
	}

	/** A field's text, where the hero wants text rather than markup. */
	function stripTags( html ) {
		if ( !html ) {
			return '';
		}
		var box = document.createElement( 'div' );
		box.innerHTML = html;
		return box.textContent.trim();
	}

	/** The corner logo and the slim bar that stand in for the wiki's chrome. */
	function addChrome( body, pageName ) {
		var logo = document.createElement( 'a' );
		logo.className = 'pp-corner-logo';
		logo.href = '/wiki/Main_Page';
		logo.title = 'PickiPedia home';
		logo.innerHTML = '<img src="/images/thumb/8/80/Pickipedia-quarter-transparent.png/' +
			'400px-Pickipedia-quarter-transparent.png" alt="PickiPedia">';
		body.insertBefore( logo, body.firstChild );

		var topbar = document.createElement( 'header' );
		topbar.className = 'pickipedia-show-topbar';
		topbar.innerHTML =
			'<nav class="pickipedia-show-topbar-left">' +
				'<a href="' + mw.util.getUrl( 'Category:Shows' ) + '">← All shows</a>' +
			'</nav>' +
			'<nav class="pickipedia-show-topbar-right">' +
				'<a href="' + mw.util.getUrl( pageName, { action: 'edit' } ) + '">edit</a>' +
				'<a href="' + mw.util.getUrl( pageName, { action: 'history' } ) + '">history</a>' +
				'<a href="' + mw.util.getUrl( 'Talk:' + pageName ) + '">talk</a>' +
			'</nav>';
		body.insertBefore( topbar, logo.nextSibling );
	}

	function run() {
		if ( typeof mw === 'undefined' || !mw.config ) {
			return;
		}
		var title = mw.config.get( 'wgTitle' ) || '';
		var pageName = mw.config.get( 'wgPageName' ) || '';
		if ( mw.config.get( 'wgNamespaceNumber' ) !== 0 ) {
			return;
		}
		if ( ( mw.config.get( 'wgAction' ) || 'view' ) !== 'view' ) {
			return;
		}
		if ( title.indexOf( 'Show:' ) !== 0 ) {
			return;
		}

		var body = document.body;
		body.classList.add( 'pickipedia-show' );

		var content = document.querySelector( '.mw-parser-output' );
		if ( !content || content.querySelector( '.show-poster' ) ) {
			return;  // No content, or the old gadget got here first.
		}

		var infobox = content.querySelector( '.show-infobox' );
		if ( !infobox ) {
			return;  // A show page without {{Show}}: the setlist styling is enough.
		}

		var hero = document.createElement( 'header' );
		hero.className = 'show-poster';
		hero.innerHTML = heroHtml( readShow( infobox, pageName, title ) );
		content.insertBefore( hero, content.firstChild );

		// Out of the page, not merely hidden: the old gadget looks for it
		// before it builds anything, so taking it away stops a second hero.
		infobox.parentNode.removeChild( infobox );

		// {{Show}} also writes the bacon link into the page itself, for a
		// reader whose JavaScript never arrives. The hero has it now.
		var cta = content.querySelector( '.show-bacon-cta' );
		if ( cta ) {
			cta.parentNode.removeChild( cta );
		}
		body.classList.add( 'has-show-hero' );

		addChrome( body, pageName );
	}

	if ( typeof document !== 'undefined' && typeof mw !== 'undefined' ) {
		run();
	}

	// For tools/test_show_page.mjs. The browser has no module here.
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = {
			baconHref: baconHref,
			formatBlock: formatBlock,
			blockKicker: blockKicker,
			bigPosterSrc: bigPosterSrc,
			statusOf: statusOf,
			escapeHtml: escapeHtml,
			heroHtml: heroHtml
		};
	}
}() );
