/*
 * The connectome card's clicks ({{#connectome:}}, src/Connectome.php): a dot, a line or the rabbit goes to the big
 * graph at /bacon, the page itself, at the address a reader at /bacon has for the same view. So a card is a way into
 * the one app, as /bacon's front page is, and both land in the same state at the same address (Justin, #connectome,
 * 26 Nov 2026, 02:15Z: "It still seems like entering from a musician page on the wiki results in a very different
 * state than entering from /bacon/. Even if I go 'full-screen' from the picker page entrance, they look nothing
 * alike. I want for entering from either point to result in exactly the same state. Same URLs too."). Back comes
 * back to this page.
 *
 * Until then a click opened the explorer alone over the page in a frame (host=page), with a bar of its own and a
 * "Full screen" button (18 Nov 2026): a second way of showing the graph, and the state /bacon never has.
 *
 * A card's links already name /bacon, as /bacon writes them (tools/connectome_card.py), and need no script to go
 * there. A page parsed before the move (16 Nov 2026) still says the old address, /assets/connectome/, which the server
 * sends on to /bacon with its query; this script writes /bacon on such a link as soon as the pointer comes near the
 * card, so the click goes straight there (and a new tab with it), and asks for the graph's files then too, so the
 * first click doesn't wait on them.
 */
( function () {
	var PAGE = '/bacon',
		FILES = '/assets/connectome/',
		XLINK = 'http://www.w3.org/1999/xlink',
		asked = false; // the graph's files, asked for ahead of the first click

	// A card's link at the old address, as /bacon's; null for any other link.
	function moved( href ) {
		var u;
		try {
			u = new URL( href, location.href );
		} catch ( err ) {
			return null;
		}
		if ( u.origin !== location.origin || u.pathname.indexOf( FILES ) !== 0 || /\.(json|js|css|png|svg)$/.test( u.pathname ) ) {
			return null;
		}
		return PAGE + u.search;
	}

	function fix( card ) {
		Array.prototype.forEach.call( card.querySelectorAll( 'a' ), function ( a ) {
			var href = a.getAttribute( 'href' ) || a.getAttributeNS( XLINK, 'href' ),
				to = href && moved( href );
			if ( to ) {
				a.setAttribute( 'href', to );
				if ( a.hasAttributeNS( XLINK, 'href' ) ) {
					a.setAttributeNS( XLINK, 'href', to );
				}
			}
		} );
	}

	function near( e ) {
		var card = e.target.closest && e.target.closest( '.connectome-card' );
		if ( !card ) {
			return;
		}
		fix( card );
		if ( !asked ) {
			asked = true;
			[ 'graph.json', 'connectome.js', 'connectome-core.js', 'connectome.css' ].forEach( function ( file ) {
				var link = document.createElement( 'link' );
				link.rel = 'prefetch';
				link.href = FILES + file;
				document.head.appendChild( link );
			} );
		}
	}

	// A pointer near a card, or a finger on it, or the keyboard on one of its links: all come before the click.
	document.addEventListener( 'pointerover', near, true );
	document.addEventListener( 'pointerdown', near, true );
	document.addEventListener( 'focusin', near, true );
}() );
