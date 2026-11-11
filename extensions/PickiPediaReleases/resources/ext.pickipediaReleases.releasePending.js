/**
 * A pending Release page reloads itself once the bot has made it.
 *
 * The page is only pending for a minute or two (ReleasePending.php), so
 * this asks the wiki every 15 seconds whether it exists yet, and stops
 * after an hour: past that, the notice already says the bot may be stuck.
 */
( function () {
	var notice = document.querySelector( '.release-pending[data-release-title]' );
	if ( !notice ) {
		return;
	}
	var title = notice.getAttribute( 'data-release-title' );
	var api = new mw.Api();
	var tries = 0;
	var timer = setInterval( function () {
		if ( ++tries > 240 ) {
			clearInterval( timer );
			return;
		}
		api.get( { action: 'query', titles: title, formatversion: 2 } ).then( function ( data ) {
			var page = data.query && data.query.pages && data.query.pages[ 0 ];
			if ( page && !page.missing ) {
				clearInterval( timer );
				location.reload();
			}
		} );
	}, 15000 );
}() );
