/*
 * The connectome card's clicks ({{#connectome:}}, src/Connectome.php): a dot, a line or the rabbit opens the big
 * graph over the page, lit on that connection, rather than leaving the page. Esc or × closes it. Without this
 * script, the same links open the big graph as a page of its own.
 *
 * The big graph is its own page in a frame (/bacon), so the keys go to it while it's open: it tells this page
 * when Esc was pressed in there. Its files (in assets/connectome/) are asked for as soon as the pointer comes
 * near a card, so the first click doesn't wait on them.
 *
 * A card's link names the page at /bacon or at its old address, /assets/connectome/: a page parsed before the
 * move still says the old one. Either opens /bacon, with the link's query.
 */
( function () {
	var PAGE = '/bacon',
		FILES = '/assets/connectome/',
		box, frame, from;

	// Where in the frame a card's link goes, or null for a link that isn't to the big graph.
	function graphOf( href ) {
		var u;
		try {
			u = new URL( href, location.href );
		} catch ( err ) {
			return null;
		}
		if ( u.origin !== location.origin ||
			( u.pathname !== PAGE && u.pathname !== PAGE + '/' && u.pathname.indexOf( FILES ) !== 0 ) ) {
			return null;
		}
		return PAGE + u.search;
	}

	function shut() {
		if ( box && box.style.display !== 'none' ) {
			box.style.display = 'none';
			frame.src = 'about:blank';
			if ( from && from.focus ) {
				from.focus();
			}
		}
	}

	function open( href ) {
		if ( !box ) {
			var bar = document.createElement( 'div' ),
				close = document.createElement( 'button' );
			box = document.createElement( 'div' );
			box.id = 'cc-big';
			bar.className = 'cc-bar';
			bar.textContent = 'The connectome';
			close.type = 'button';
			close.className = 'cc-close';
			close.setAttribute( 'aria-label', 'Close' );
			close.textContent = '×';
			close.addEventListener( 'click', shut );
			bar.appendChild( close );
			frame = document.createElement( 'iframe' );
			frame.title = 'The connectome';
			frame.addEventListener( 'load', function () {
				if ( box.style.display !== 'none' ) {
					frame.focus();
				}
			} );
			box.appendChild( bar );
			box.appendChild( frame );
			document.body.appendChild( box );
		}
		frame.src = href;
		box.style.display = 'block';
	}

	document.addEventListener( 'keydown', function ( e ) {
		if ( e.key === 'Escape' ) {
			shut();
		}
	} );

	window.addEventListener( 'message', function ( e ) {
		if ( e.origin === location.origin && e.data && e.data.connectome === 'close' ) {
			shut();
		}
	} );

	document.addEventListener( 'pointerover', function near( e ) {
		if ( e.target.closest && e.target.closest( '.connectome-card' ) ) {
			document.removeEventListener( 'pointerover', near, true );
			[ 'graph.json', 'connectome.js', 'connectome-core.js', 'connectome.css' ].forEach( function ( file ) {
				var link = document.createElement( 'link' );
				link.rel = 'prefetch';
				link.href = FILES + file;
				document.head.appendChild( link );
			} );
		}
	}, true );

	document.addEventListener( 'click', function ( e ) {
		var a = e.target.closest && e.target.closest( '.connectome-card a' ),
			href;
		if ( !a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ) {
			return;
		}
		href = a.getAttribute( 'href' ) || a.getAttributeNS( 'http://www.w3.org/1999/xlink', 'href' );
		href = href && graphOf( href );
		if ( !href ) {
			return;
		}
		e.preventDefault();
		from = a;
		open( href );
	}, true );
}() );
