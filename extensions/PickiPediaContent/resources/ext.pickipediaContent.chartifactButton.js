/**
 * A "+ chartifact" button on the edit toolbar.
 *
 * Skyler, #rabbithole, 13 Nov 2026: charting a song means writing one
 * {{Chartifact}} per pass, and he wanted to add the next without typing
 * the field names out each time. The button puts a blank one where the
 * cursor is, on its own lines. The source and who transcribed it carry
 * over from the last chartifact in the box, since those rarely change
 * within a song; the section, the kind, the picker and the instrument are
 * left blank, to be filled in by ear rather than copied by mistake.
 */
( function () {
	'use strict';

	var FIELDS = [ 'section', 'kind', 'picker', 'instrument', 'source', 'transcribed by' ];
	var CARRIED = [ 'source', 'transcribed by' ];

	/** The values of the last {{Chartifact}} in the text, by field. */
	function lastChartifact( text ) {
		var re = /\{\{\s*Chartifact\s*\|([^}]*)\}\}/gi;
		var match, last = null;
		while ( ( match = re.exec( text ) ) !== null ) {
			last = match[ 1 ];
		}
		var values = {};
		if ( last ) {
			last.split( '|' ).forEach( function ( part ) {
				var eq = part.indexOf( '=' );
				if ( eq > 0 ) {
					values[ part.slice( 0, eq ).trim().toLowerCase() ] = part.slice( eq + 1 ).trim();
				}
			} );
		}
		return values;
	}

	function blankChartifact( text ) {
		var before = lastChartifact( text );
		var lines = FIELDS.map( function ( field ) {
			var value = CARRIED.indexOf( field ) !== -1 && before[ field ] ? before[ field ] : '';
			if ( field === 'source' && !value ) {
				value = 'recording';
			}
			return '|' + field + '=' + value;
		} );
		return '{{Chartifact\n' + lines.join( '\n' ) + '\n}}\n';
	}

	mw.hook( 'wikiEditor.toolbarReady' ).add( function ( $textarea ) {
		// Its own group, labelled in words: a bare + among the icons
		// said nothing of what it adds.
		$textarea.wikiEditor( 'addToToolbar', {
			section: 'main',
			groups: {
				chartifacts: {
					tools: {
						chartifact: {
							label: mw.msg( 'pickipediacontent-chartifact-button' ),
							type: 'button',
							action: {
								type: 'callback',
								execute: function () {
									$textarea.textSelection( 'encapsulateSelection', {
										pre: blankChartifact( $textarea.textSelection( 'getContents' ) ),
										peri: '',
										post: '',
										ownline: true
									} );
								}
							}
						}
					}
				}
			}
		} );
	} );

	// For the checks in tests/.
	if ( typeof module !== 'undefined' ) {
		module.exports = { blankChartifact: blankChartifact, lastChartifact: lastChartifact };
	}
}() );
