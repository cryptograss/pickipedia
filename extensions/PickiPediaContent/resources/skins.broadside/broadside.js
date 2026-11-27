/**
 * Broadside: what answers the reader (src/Posts/SkinBroadside.php).
 *
 * The page is whole when it arrives; nothing here builds or moves any of
 * it. This file only answers what a reader does:
 *
 *   - the light: the button turns the page dark or light and keeps the
 *     choice in a cookie, so the server sends the next page that way;
 *   - a link's card: point at a link and the page it leads to says what it
 *     is (api.php?action=pagecard), in a popover hung from the link;
 *   - a video that follows: one that is playing when it is scrolled out of
 *     sight goes to the place kept for it and plays on.
 *
 * Each uses what the browser has (popover, anchor positioning, view
 * transitions) and does nothing where the browser lacks it: the link is
 * still a link, the video still plays where it is.
 */
( function () {
	'use strict';

	var root = document.documentElement;
	var reduced = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	// ---- The light ----

	var COOKIE = 'pickipedia-mode';
	var ONE_YEAR = 365 * 24 * 60 * 60;
	var modeButton = document.querySelector( '.bs-mode' );

	function isDark() {
		if ( root.classList.contains( 'bs-dark' ) ) {
			return true;
		}
		return !root.classList.contains( 'bs-light' ) && !!window.matchMedia &&
			window.matchMedia( '(prefers-color-scheme: dark)' ).matches;
	}

	if ( modeButton ) {
		modeButton.setAttribute( 'aria-pressed', isDark() ? 'true' : 'false' );
		modeButton.addEventListener( 'click', function () {
			var mode = isDark() ? 'light' : 'dark';
			root.classList.toggle( 'bs-dark', mode === 'dark' );
			root.classList.toggle( 'bs-light', mode === 'light' );
			document.cookie = COOKIE + '=' + mode + '; path=/; max-age=' + ONE_YEAR + '; samesite=lax';
			var meta = document.querySelector( 'meta[name="color-scheme"]' );
			if ( meta ) {
				meta.setAttribute( 'content', mode );
			}
			modeButton.setAttribute( 'aria-pressed', mode === 'dark' ? 'true' : 'false' );
		} );
	}

	// ---- A link's card ----

	var card = document.getElementById( 'bs-card' );
	var body = document.querySelector( '.bs-body' );
	var canHang = !!card && typeof card.showPopover === 'function' && !!window.CSS && CSS.supports &&
		CSS.supports( 'position-area', 'top' ) && CSS.supports( 'anchor-name', '--a' );
	var canHover = !!window.matchMedia && window.matchMedia( '(hover: hover)' ).matches;

	if ( canHang && body ) {
		var SHOW_AFTER = 240;
		var HIDE_AFTER = 160;
		var known = new Map();   // what a link leads to -> a promise of its card
		var hung = null;         // the link the card hangs from
		var wanted = null;       // the link pointed at now
		var showTimer = null;
		var hideTimer = null;
		var articlePath = ( mw.config.get( 'wgArticlePath' ) || '/wiki/$1' ).replace( '$1', '' );

		var msg = function ( key ) {
			return mw.message( 'pickipediacontent-posts-card-' + key ).text();
		};

		/** What an address is, as far as the address says: a page here, somewhere else, or nothing to show. */
		var leadsTo = function ( a ) {
			var url;
			try {
				url = new URL( a.getAttribute( 'href' ), location.href );
			} catch ( e ) {
				return null;
			}
			if ( !/^https?:$/.test( url.protocol ) ) {
				return null;
			}
			if ( url.origin !== location.origin ) {
				return { outside: url };
			}
			if ( url.pathname === location.pathname && url.hash ) {
				return null;  // a place on this page
			}
			var title = null;
			if ( url.pathname.indexOf( articlePath ) === 0 && !url.search ) {
				try {
					title = decodeURIComponent( url.pathname.slice( articlePath.length ) );
				} catch ( e ) {
					return null;
				}
			} else if ( url.searchParams.get( 'redlink' ) === '1' ) {
				title = url.searchParams.get( 'title' );
			}
			if ( !title || /^(Special|File|Media|Image):/i.test( title ) ) {
				return null;
			}
			return { title: title.replace( /_/g, ' ' ) };
		};

		var describe = function ( a ) {
			var to = leadsTo( a );
			if ( !to ) {
				return Promise.resolve( null );
			}
			if ( to.outside ) {
				var path = ( to.outside.pathname + to.outside.search ).replace( /^\/$/, '' );
				return Promise.resolve( {
					kind: 'outside',
					label: msg( 'leaves' ),
					title: to.outside.hostname.replace( /^www\./, '' ),
					text: path
				} );
			}
			if ( !known.has( to.title ) ) {
				known.set( to.title, fetch( mw.util.wikiScript( 'api' ) + '?action=pagecard&format=json&formatversion=2&titles=' +
					encodeURIComponent( to.title ) )
					.then( function ( r ) { return r.ok ? r.json() : null; } )
					.then( function ( d ) { return d && d.pagecard && d.pagecard[ 0 ] || null; } )
					.catch( function () { known.delete( to.title ); return null; } ) );
			}
			return known.get( to.title );
		};

		var el = function ( tag, cls, text ) {
			var node = document.createElement( tag );
			node.className = cls;
			if ( text ) {
				node.textContent = text;
			}
			return node;
		};

		/** The card's inside, built from words only: nothing a page says is taken as markup. */
		var draw = function ( data, a ) {
			var kind = data.kind;
			var label = data.label || '';
			var text = data.text || '';
			if ( kind === 'missing' ) {
				text = msg( 'missing' );
			} else if ( kind === 'post' && data.post ) {
				label = [ data.post.kicker, data.post.author && data.post.author.name ].filter( Boolean ).join( ' · ' );
			} else if ( kind === 'song' ) {
				label = 'Song';
			}
			card.className = 'bs-card is-' + kind;
			card.textContent = '';
			var into = el( 'a', 'bs-card-in' );
			into.href = a.href;
			if ( data.image ) {
				var img = el( 'img', 'bs-card-img' );
				img.alt = '';
				img.decoding = 'async';
				img.addEventListener( 'error', function () { img.remove(); } );
				img.src = data.image;
				into.appendChild( img );
			}
			var words = el( 'span', 'bs-card-words' );
			if ( label ) {
				words.appendChild( el( 'span', 'bs-card-label', label ) );
			}
			words.appendChild( el( 'strong', 'bs-card-title', data.title || '' ) );
			if ( text ) {
				words.appendChild( el( 'span', 'bs-card-text', text ) );
			}
			if ( data.listen ) {
				words.appendChild( el( 'span', 'bs-card-listen', msg( 'listen' ) ) );
			}
			into.appendChild( words );
			card.appendChild( into );
		};

		var hide = function () {
			clearTimeout( showTimer );
			clearTimeout( hideTimer );
			wanted = null;
			if ( card.matches( ':popover-open' ) ) {
				card.hidePopover();
			}
			if ( hung ) {
				hung.style.removeProperty( 'anchor-name' );
				hung = null;
			}
		};

		var show = function ( a ) {
			wanted = a;
			describe( a ).then( function ( data ) {
				if ( wanted !== a || !data || data.kind === 'none' || !a.isConnected ) {
					return;
				}
				if ( hung && hung !== a ) {
					hung.style.removeProperty( 'anchor-name' );
				}
				hung = a;
				a.style.setProperty( 'anchor-name', '--bs-link' );
				draw( data, a );
				if ( !card.matches( ':popover-open' ) ) {
					card.showPopover();
				}
			} );
		};

		/** A link in the post's own words: not a picture, a footnote mark, an edit link, or a player's. */
		var linkAt = function ( target ) {
			var a = target && target.closest ? target.closest( 'a[href]' ) : null;
			if ( !a || !body.contains( a ) || a.querySelector( 'img, video' ) ||
				a.closest( '.mw-editsection, .reference, .mw-cite-backlink, .hls-video-player, .gallery, figure > a, .pp-listen-stack' )
			) {
				return null;
			}
			return a;
		};

		var later = function ( a ) {
			clearTimeout( hideTimer );
			if ( a === hung || a === wanted ) {
				return;
			}
			clearTimeout( showTimer );
			wanted = a;
			showTimer = setTimeout( function () { show( a ); }, SHOW_AFTER );
		};
		var soonGone = function () {
			clearTimeout( showTimer );
			clearTimeout( hideTimer );
			hideTimer = setTimeout( hide, HIDE_AFTER );
		};

		if ( canHover ) {
			body.addEventListener( 'mouseover', function ( e ) {
				var a = linkAt( e.target );
				if ( a ) {
					later( a );
				}
			} );
			body.addEventListener( 'mouseout', function ( e ) {
				var a = linkAt( e.target );
				if ( a && !a.contains( e.relatedTarget ) ) {
					soonGone();
				}
			} );
			// The card can be reached and read; leaving it puts it away.
			card.addEventListener( 'mouseenter', function () { clearTimeout( hideTimer ); } );
			card.addEventListener( 'mouseleave', soonGone );
		}
		// By keyboard too: a link that takes the focus shows its card.
		body.addEventListener( 'focusin', function ( e ) {
			var a = linkAt( e.target );
			if ( a && a.matches( ':focus-visible' ) ) {
				later( a );
			}
		} );
		body.addEventListener( 'focusout', soonGone );
		document.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Escape' ) {
				hide();
			}
		} );
		window.addEventListener( 'pagehide', hide );
	}

	// ---- A video that follows ----

	var dock = document.getElementById( 'bs-dock' );
	var following = null;   // { player, held, watch, size }
	var watched = new WeakSet();

	var change = function ( fn ) {
		if ( document.startViewTransition && !reduced ) {
			return document.startViewTransition( fn ).finished.catch( function () {} );
		}
		fn();
		return Promise.resolve();
	};

	var dockBar = function ( player ) {
		var bar = player.querySelector( ':scope > .bs-dockbar' );
		if ( bar ) {
			return bar;
		}
		bar = document.createElement( 'div' );
		bar.className = 'bs-dockbar';
		var back = document.createElement( 'button' );
		back.type = 'button';
		back.textContent = '↑';
		back.title = mw.message( 'pickipediacontent-posts-dock-back' ).text();
		back.setAttribute( 'aria-label', back.title );
		back.addEventListener( 'click', function () {
			if ( following && following.held ) {
				following.held.scrollIntoView( { block: 'center', behavior: reduced ? 'auto' : 'smooth' } );
			}
		} );
		var close = document.createElement( 'button' );
		close.type = 'button';
		close.textContent = '✕';
		close.title = mw.message( 'pickipediacontent-posts-dock-close' ).text();
		close.setAttribute( 'aria-label', close.title );
		close.addEventListener( 'click', function () {
			var video = player.querySelector( 'video' );
			if ( video ) {
				video.pause();
			}
			putBack();
		} );
		bar.appendChild( back );
		bar.appendChild( close );
		player.appendChild( bar );
		return bar;
	};

	/** Back where it was: what was held there goes, and the player is in the post again. */
	var putBack = function () {
		if ( !following ) {
			return Promise.resolve();
		}
		var was = following;
		following = null;
		was.watch.disconnect();
		if ( was.size ) {
			was.size.disconnect();
		}
		return change( function () {
			was.player.classList.remove( 'is-docked' );
			was.held.remove();
			if ( dock ) {
				dock.classList.remove( 'is-taken' );
				dock.style.removeProperty( 'height' );
				dock.style.removeProperty( 'aspect-ratio' );
			}
		} ).then( function () {
			was.player.style.removeProperty( 'view-transition-name' );
			watchPlace( was.player );
		} );
	};

	/** Out of the post and into the place kept for it; its own height is held where it was. */
	var follow = function ( player ) {
		if ( following ) {
			return;
		}
		var held = document.createElement( 'div' );
		held.className = 'bs-held';
		held.style.height = player.offsetHeight + 'px';
		var button = document.createElement( 'button' );
		button.type = 'button';
		button.textContent = mw.message( 'pickipediacontent-posts-dock-close' ).text();
		button.addEventListener( 'click', function () {
			var video = player.querySelector( 'video' );
			if ( video ) {
				video.pause();
			}
			putBack();
		} );
		held.appendChild( button );
		dockBar( player );
		player.style.setProperty( 'view-transition-name', 'bs-video' );

		// Scrolled back to where it was: it is put back.
		var watch = new IntersectionObserver( function ( entries ) {
			if ( entries[ entries.length - 1 ].intersectionRatio >= 0.35 ) {
				putBack();
			}
		}, { threshold: [ 0, 0.35, 1 ] } );
		following = { player: player, held: held, watch: watch, size: null };

		change( function () {
			player.parentNode.insertBefore( held, player );
			player.classList.add( 'is-docked' );
			if ( dock ) {
				dock.classList.add( 'is-taken' );
			}
		} ).then( function () {
			if ( !following || following.player !== player ) {
				return;
			}
			watch.observe( held );
			// The place kept is as tall as what is in it, so nothing beneath is covered.
			if ( dock && window.ResizeObserver && dock.offsetParent !== null ) {
				following.size = new ResizeObserver( function () {
					dock.style.setProperty( 'aspect-ratio', 'auto' );
					dock.style.setProperty( 'height', player.offsetHeight + 'px' );
				} );
				following.size.observe( player );
			}
		} );
	};

	/** Watch a player's place in the post: playing and out of sight, it follows. */
	var watchPlace = function ( player ) {
		var place = new IntersectionObserver( function ( entries ) {
			var video = player.querySelector( 'video' );
			if ( !entries[ entries.length - 1 ].isIntersecting && video && !video.paused && !video.ended && !following ) {
				place.disconnect();
				follow( player );
			}
		}, { threshold: 0 } );
		place.observe( player );
		player.bsPlace = place;
	};

	if ( body && window.IntersectionObserver ) {
		// Players are made by another script, whenever it gets to them: a video's own play is heard here,
		// on its way down (media events don't bubble up).
		document.addEventListener( 'play', function ( e ) {
			var player = e.target && e.target.closest ? e.target.closest( '.bs-body .hls-video-player' ) : null;
			if ( !player ) {
				return;
			}
			// One at a time: another that starts takes the place of the one following.
			if ( following && following.player !== player ) {
				var other = following.player.querySelector( 'video' );
				if ( other ) {
					other.pause();
				}
				putBack();
			}
			if ( !watched.has( player ) ) {
				watched.add( player );
				watchPlace( player );
			}
		}, true );
		document.addEventListener( 'ended', function ( e ) {
			if ( following && following.player.contains( e.target ) ) {
				putBack();
			}
		}, true );
	}
}() );
