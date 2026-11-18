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
 *
 * "Full screen" in its bar gives the graph the whole screen (Justin, #connectome, 18 Nov 2026: "it's not obvious
 * how to get it to full-screen"). Esc then leaves full screen and the graph stays open; the next Esc closes it.
 * Where the browser can't put a page's element full screen (Safari on an iPhone couldn't, last I knew), the button
 * isn't there: on a phone the graph already takes the whole window.
 */
( function () {
	var PAGE = '/bacon',
		FILES = '/assets/connectome/',
		CORNERS = 'M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9',
		INWARD = 'M5 1v4H1M13 5H9V1M9 13V9h4M1 9h4v4',
		box, frame, from, full,
		whole = false, // full screen, as the browser last told this page (fullscreenchange)
		leftAt = 0; // when it last left full screen

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

	// Is the graph full screen now?
	function isFull() {
		return !!box && document.fullscreenElement === box;
	}

	function unfull() {
		var done = document.exitFullscreen();
		if ( done && done.catch ) {
			done.catch( function () {} );
		}
	}

	function shut() {
		if ( box && box.style.display !== 'none' ) {
			if ( isFull() ) {
				unfull();
			}
			box.style.display = 'none';
			frame.src = 'about:blank';
			if ( from && from.focus ) {
				from.focus();
			}
		}
	}

	// Esc, pressed here or in the graph: full screen is left first, and only then is the graph closed. The Esc that
	// takes the browser out of full screen may reach the graph too, which then asks to close, and the browser can
	// have let go of full screen before it says so: until it has said so, and for half a second after, Esc
	// doesn't close.
	function escape() {
		if ( isFull() ) {
			unfull();
		} else if ( !whole && Date.now() - leftAt > 500 ) {
			shut();
		}
	}

	// The full screen button says what it will do: go full screen, or leave it.
	function sayFull() {
		var on = isFull(),
			words = on ? 'Leave full screen' : 'Full screen';
		full.title = words;
		full.setAttribute( 'aria-pressed', on ? 'true' : 'false' );
		full.lastChild.textContent = words;
		full.firstChild.firstChild.setAttribute( 'd', on ? INWARD : CORNERS );
	}

	function fullButton() {
		var ns = 'http://www.w3.org/2000/svg',
			icon = document.createElementNS( ns, 'svg' ),
			path = document.createElementNS( ns, 'path' );
		full = document.createElement( 'button' );
		full.type = 'button';
		full.className = 'cc-full';
		icon.setAttribute( 'viewBox', '0 0 14 14' );
		icon.setAttribute( 'aria-hidden', 'true' );
		icon.appendChild( path );
		full.appendChild( icon );
		full.appendChild( document.createElement( 'span' ) );
		full.addEventListener( 'click', function () {
			var asked;
			if ( isFull() ) {
				unfull();
				return;
			}
			asked = box.requestFullscreen();
			if ( asked && asked.catch ) {
				asked.catch( function () {} );
			}
		} );
		document.addEventListener( 'fullscreenchange', function () {
			if ( whole && !isFull() ) {
				leftAt = Date.now();
			}
			whole = isFull();
			sayFull();
			if ( box.style.display !== 'none' ) {
				frame.focus();
			}
		} );
		sayFull();
		return full;
	}

	function open( href ) {
		if ( !box ) {
			var bar = document.createElement( 'div' ),
				close = document.createElement( 'button' );
			box = document.createElement( 'div' );
			box.id = 'cc-big';
			bar.className = 'cc-bar';
			bar.textContent = 'Bacon graph';
			close.type = 'button';
			close.className = 'cc-close';
			close.setAttribute( 'aria-label', 'Close' );
			close.textContent = '×';
			close.addEventListener( 'click', shut );
			bar.appendChild( close );
			if ( document.fullscreenEnabled && box.requestFullscreen ) {
				bar.appendChild( fullButton() );
			}
			frame = document.createElement( 'iframe' );
			frame.title = 'Bacon graph';
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
			escape();
		}
	} );

	window.addEventListener( 'message', function ( e ) {
		if ( e.origin === location.origin && e.data && e.data.connectome === 'close' ) {
			escape();
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
