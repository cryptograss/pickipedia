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
 *
 * And a "+ chartifact" beside the Chartifacts heading's "edit source"
 * (Skyler, the same day: "right after edit source on the chartifacts
 * line"). It opens that section's editor with a blank one already added at
 * the end and the cursor in its section field.
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

	/** Put a blank chartifact at the end of the box, the cursor after "|section=". */
	function appendChartifact( $textarea ) {
		var text = $textarea.textSelection( 'getContents' ).replace( /\s+$/, '' );
		var block = blankChartifact( text );
		var joined = text + '\n\n' + block;
		$textarea.textSelection( 'setContents', joined );
		var at = text.length + 2 + block.indexOf( '|section=' ) + '|section='.length;
		$textarea.trigger( 'focus' );
		$textarea.textSelection( 'setSelection', { start: at, end: at } );
		$textarea.textSelection( 'scrollToCaretPosition' );
	}

	/** On a page as read: "+ chartifact" after the Chartifacts heading's "edit source". */
	function addHeadingLink() {
		var anchor = document.getElementById( 'Chartifacts' );
		var heading = anchor && anchor.closest( 'h2, h3, h4, .mw-heading' );
		var section = heading && heading.querySelector( '.mw-editsection' );
		if ( !section ) {
			return; // Not signed in, or no Chartifacts section.
		}
		var links = Array.prototype.slice.call( section.querySelectorAll( 'a[href*="section="]' ) );
		var source = links.filter( function ( a ) {
			return /[?&]action=edit(&|$)/.test( a.getAttribute( 'href' ) );
		} )[ 0 ];
		if ( !source || section.querySelector( '.pp-chartifact-add' ) ) {
			return;
		}
		var add = document.createElement( 'a' );
		add.className = 'pp-chartifact-add';
		add.href = source.getAttribute( 'href' ) + '&chartifact=new';
		add.textContent = mw.msg( 'pickipediacontent-chartifact-button' );
		add.title = mw.msg( 'pickipediacontent-chartifact-add-title' );
		var bar = document.createElement( 'span' );
		bar.className = 'mw-editsection-divider';
		bar.textContent = ' | ';
		source.parentNode.insertBefore( add, source.nextSibling );
		source.parentNode.insertBefore( bar, add );
	}

	if ( mw.config.get( 'wgAction' ) === 'view' ) {
		$( addHeadingLink );
	} else if ( mw.util.getParamValue( 'chartifact' ) === 'new' ) {
		// Once, when the editor first opens: a preview or a failed save
		// comes back to this same address and must not add another.
		$( function () {
			var $textarea = $( '#wpTextbox1' );
			if ( $textarea.length && mw.config.get( 'wgAction' ) === 'edit' && !$textarea.prop( 'readOnly' ) ) {
				appendChartifact( $textarea );
			}
		} );
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
