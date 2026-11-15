/**
 * Night: the reader's switch between day and night (resources/night/night.less, src/Night.php).
 *
 * The page is already the right way when this runs: by the reader's system, or by their choice, which the
 * server reads from the cookie and puts on <html>. This only adds the switch among the reader's own links
 * and, when it is pressed, keeps the choice where the server, Broadside, the connectome's graph and
 * Rabbithole all read it: the cookie "pickipedia-mode".
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

	mw.loader.using( 'mediawiki.util' ).then( function () {
		$( function () {
			var link = mw.util.addPortletLink( 'p-personal', '#', '', 'pt-night', mw.msg( 'pickipediacontent-night-switch' ) );
			if ( !link ) {
				return;
			}
			var a = link.querySelector( 'a' );
			function label() {
				a.textContent = isDark() ? mw.msg( 'pickipediacontent-night-day' ) : mw.msg( 'pickipediacontent-night-night' );
				a.setAttribute( 'aria-pressed', isDark() ? 'true' : 'false' );
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
