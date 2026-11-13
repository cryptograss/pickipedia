/*
 * The connectome card's clicks ({{#connectome:}}, src/Connectome.php): a dot, a line or the rabbit opens the big
 * graph over the page, lit on that connection, rather than leaving the page. Esc or × closes it. Without this
 * script, the same links open the big graph as a page of its own.
 */
( function () {
	var VIEWER = '/assets/connectome/',
		box, frame;

	function shut() {
		if ( box ) {
			box.style.display = 'none';
			frame.src = 'about:blank';
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

	document.addEventListener( 'click', function ( e ) {
		var a = e.target.closest && e.target.closest( '.connectome-card a' ),
			href;
		if ( !a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ) {
			return;
		}
		href = a.getAttribute( 'href' ) || a.getAttributeNS( 'http://www.w3.org/1999/xlink', 'href' );
		if ( !href || href.indexOf( VIEWER ) !== 0 ) {
			return;
		}
		e.preventDefault();
		open( href );
	}, true );
}() );
