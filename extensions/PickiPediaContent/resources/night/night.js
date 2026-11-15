/**
 * Night: the reader's switch between day and night (resources/night/night.less, src/Night.php).
 *
 * The page is already the right way when this runs: by the reader's system, or by their choice, which the
 * server reads from the cookie and puts on <html>. This only adds the switch among the reader's own links
 * and, when it is pressed, keeps the choice where the server, Broadside and the connectome's graph read it,
 * and where Rabbithole will: the cookie "pickipedia-mode".
 *
 * A choice holds for a year whatever the reader's system does, so while one is in force a second link sits
 * beside the switch to give it up: the cookie goes, and the page follows the system again (Justin, 15 Nov 2026).
 */
( function () {
	var COOKIE = 'pickipedia-mode';
	var ONE_YEAR = 60 * 60 * 24 * 365;
	var root = document.documentElement;
	var system = window.matchMedia ? window.matchMedia( '( prefers-color-scheme: dark )' ) : null;

	function isDark() {
		if ( root.classList.contains( 'pp-dark' ) ) {
			return true;
		}
		if ( root.classList.contains( 'pp-light' ) ) {
			return false;
		}
		return !!( system && system.matches );
	}

	function choose( mode ) {
		root.classList.remove( 'pp-dark', 'pp-light' );
		root.classList.add( 'pp-' + mode );
		var meta = document.querySelector( 'meta[name="color-scheme"]' );
		if ( meta ) {
			meta.setAttribute( 'content', mode );
		}
		document.cookie = COOKIE + '=' + mode + '; path=/; max-age=' + ONE_YEAR + '; samesite=lax';
	}

	function hasChosen() {
		return root.classList.contains( 'pp-dark' ) || root.classList.contains( 'pp-light' );
	}

	/** Give the choice up: nothing on <html>, no cookie, and the stylesheet follows the system. */
	function followSystem() {
		root.classList.remove( 'pp-dark', 'pp-light' );
		var meta = document.querySelector( 'meta[name="color-scheme"]' );
		if ( meta ) {
			meta.setAttribute( 'content', 'light dark' );
		}
		document.cookie = COOKIE + '=; path=/; max-age=0; samesite=lax';
	}

	mw.loader.using( 'mediawiki.util' ).then( function () {
		$( function () {
			var link = mw.util.addPortletLink( 'p-personal', '#', '', 'pt-night', mw.msg( 'pickipediacontent-night-switch' ) );
			if ( !link ) {
				return;
			}
			var a = link.querySelector( 'a' );
			var back = mw.util.addPortletLink( 'p-personal', '#', mw.msg( 'pickipediacontent-night-system' ), 'pt-night-system',
				mw.msg( 'pickipediacontent-night-system-title' ), null, link.nextSibling );
			function label() {
				a.textContent = isDark() ? mw.msg( 'pickipediacontent-night-day' ) : mw.msg( 'pickipediacontent-night-night' );
				a.setAttribute( 'aria-pressed', isDark() ? 'true' : 'false' );
				if ( back ) {
					back.hidden = !hasChosen();
				}
			}
			if ( back ) {
				back.querySelector( 'a' ).setAttribute( 'role', 'button' );
				back.querySelector( 'a' ).addEventListener( 'click', function ( event ) {
					event.preventDefault();
					followSystem();
					label();
				} );
			}
			a.setAttribute( 'role', 'button' );
			a.addEventListener( 'click', function ( event ) {
				event.preventDefault();
				choose( isDark() ? 'light' : 'dark' );
				label();
			} );
			if ( system && system.addEventListener ) {
				system.addEventListener( 'change', label );
			}
			label();
		} );
	} );
}() );
