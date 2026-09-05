/**
 * ReleaseDraft interactive form — JS for the ReleaseDraft namespace.
 *
 * Reads draft data from mw.config.get('wgReleaseDraftData'),
 * provides:
 * - Track drag-and-drop reorder
 * - Save button: collect form data → YAML → MediaWiki edit API
 * - Finalize button: send to delivery-kid /draft-album/{id}/finalize (SSE)
 * - Blockheight date converter (Etherscan API)
 */
( function () {
	'use strict';

	var draftData = mw.config.get( 'wgReleaseDraftData' ) || {};

	// Blockheight estimation using a known reference point (more accurate than genesis)
	// The Merge (block 15537394) happened at 2022-09-15T06:42:42Z
	// Post-merge block time is exactly 12 seconds
	// Post-merge dates are anchored on a real verified block rather than the
	// Merge itself, using the measured 12.044s average rather than the 12s
	// slot time. The old form drifted ~75,000 blocks — ten days — into the
	// future. Kept in step with BlockHeight.php; change both together.
	var ANCHOR_BLOCK = 25000000;
	var ANCHOR_TS = 1777637363; // 2026-05-01T12:09:23Z, verified against a node
	var SECONDS_PER_BLOCK = 12.044;
	var MERGE_BLOCK = 15537394;
	// Was 1663220562 here and 1663224179 in PHP — two answers to the same
	// question, some 3,600s apart. Aligned on the PHP value; used only as the
	// pre/post-merge threshold now.
	var MERGE_TS = 1663224179; // 2022-09-15T06:42:59Z
	// Pre-merge: genesis to merge, ~13.3s average
	var ETH_GENESIS_TS = 1438269973;
	var PRE_MERGE_AVG = 13.3;

	// -- Helpers --

	function el( id ) {
		return document.getElementById( id );
	}

	function setStatus( msg, type ) {
		var statusEl = el( 'rd-progress-status' );
		if ( !statusEl ) {
			return;
		}
		statusEl.textContent = msg;
		statusEl.className = 'rd-progress-status' + ( type ? ' rd-status-' + type : '' );
	}

	// -- Track drag reorder --

	function initTrackDragReorder() {
		var container = el( 'rd-track-list' );
		if ( !container ) {
			return;
		}

		var dragSrc = null;

		container.addEventListener( 'dragstart', function ( e ) {
			var row = e.target.closest( '.rd-track-row' );
			if ( !row || row.getAttribute( 'draggable' ) === 'false' ) {
				return;
			}
			dragSrc = row;
			row.classList.add( 'rd-track-dragging' );
			e.dataTransfer.effectAllowed = 'move';
		} );

		container.addEventListener( 'dragover', function ( e ) {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			var row = e.target.closest( '.rd-track-row' );
			if ( row && row !== dragSrc ) {
				var rect = row.getBoundingClientRect();
				var midY = rect.top + rect.height / 2;
				if ( e.clientY < midY ) {
					container.insertBefore( dragSrc, row );
				} else {
					container.insertBefore( dragSrc, row.nextSibling );
				}
			}
		} );

		container.addEventListener( 'dragend', function () {
			if ( dragSrc ) {
				dragSrc.classList.remove( 'rd-track-dragging' );
				dragSrc = null;
			}
			renumberTracks();
		} );
	}

	function renumberTracks() {
		var container = el( 'rd-track-list' );
		if ( !container ) {
			return;
		}
		var rows = container.querySelectorAll( '.rd-track-row' );
		rows.forEach( function ( row, idx ) {
			row.dataset.idx = idx;
			var num = row.querySelector( '.rd-track-num' );
			if ( num ) {
				num.textContent = idx + 1;
			}
		} );
	}

	// -- Collect form data --

	function collectFormData() {
		var data = JSON.parse( JSON.stringify( draftData ) );
		// data.type comes from the ReleaseDraft YAML — it was set when this
		// page was first created by one of the Deliver pages or the bot:
		//   Special:DeliverRecord       → type: record
		//   Special:DeliverOtherContent → type: other
		//   Special:DeliverVideo        → type: video
		//   Blue Railroad bot           → type: blue-railroad
		// 'album' is a legacy alias for 'record'.
		var draftType = data.type || 'record';

		if ( draftType === 'record' || draftType === 'album' ) {
			// Album/record fields
			var albumTitleEl = el( 'rd-album-title' );
			var albumArtistEl = el( 'rd-artist' );
			var albumVersionEl = el( 'rd-version' );
			var albumDescriptionEl = el( 'rd-description' );

			if ( !data.album ) {
				data.album = {};
			}
			if ( albumTitleEl ) {
				data.album.title = albumTitleEl.value;
			}
			if ( albumArtistEl ) {
				data.album.artist = albumArtistEl.value;
			}
			if ( albumVersionEl ) {
				data.album.version = albumVersionEl.value;
			}
			if ( albumDescriptionEl ) {
				data.album.description = albumDescriptionEl.value;
			}

			// Tracks — collect in current DOM order (respects drag reorder)
			var trackRows = document.querySelectorAll( '.rd-track-row' );
			var tracks = [];
			trackRows.forEach( function ( row ) {
				var titleInput = row.querySelector( '.rd-track-title' );
				var metaTextarea = row.querySelector( '.rd-track-metadata' );
				var filename = row.dataset.filename || '';

				var original = ( draftData.tracks || [] ).find( function ( t ) {
					return t.filename === filename;
				} ) || {};

				tracks.push( {
					filename: filename,
					title: titleInput ? titleInput.value : ( original.title || '' ),
					metadata: metaTextarea ? metaTextarea.value : ( original.metadata || '' ),
					format: original.format || '',
					duration: original.duration || null,
					size_bytes: original.size_bytes || null
				} );
			} );
			data.tracks = tracks;
		} else if ( draftType === 'video' ) {
			// Video fields
			if ( !data.content ) {
				data.content = {};
			}
			var videoTitleEl = el( 'rd-content-title' );
			var videoDescriptionEl = el( 'rd-content-description' );
			var videoFileTypeEl = el( 'rd-content-file-type' );
			var videoVenueEl = el( 'rd-video-venue' );
			var videoPerformersEl = el( 'rd-video-performers' );

			if ( videoTitleEl ) {
				data.content.title = videoTitleEl.value;
			}
			if ( videoDescriptionEl ) {
				data.content.description = videoDescriptionEl.value;
			}
			if ( videoFileTypeEl ) {
				data.content.file_type = videoFileTypeEl.value;
			}
			if ( videoVenueEl ) {
				data.content.venue = videoVenueEl.value;
			}
			if ( videoPerformersEl ) {
				data.content.performers = videoPerformersEl.value.split( ',' ).map( function ( s ) {
					return s.trim();
				} ).filter( function ( s ) {
					return s.length > 0;
				} );
			}
		} else {
			// Content fields (other, blue-railroad, etc.)
			if ( !data.content ) {
				data.content = {};
			}
			var contentTitleEl = el( 'rd-content-title' );
			var contentDescriptionEl = el( 'rd-content-description' );
			var contentFileTypeEl = el( 'rd-content-file-type' );
			var contentSubsequentToEl = el( 'rd-content-subsequent-to' );

			if ( contentTitleEl ) {
				data.content.title = contentTitleEl.value;
			}
			if ( contentDescriptionEl ) {
				data.content.description = contentDescriptionEl.value;
			}
			if ( contentFileTypeEl ) {
				data.content.file_type = contentFileTypeEl.value;
			}
			if ( contentSubsequentToEl ) {
				data.content.subsequent_to = contentSubsequentToEl.value;
			}
		}

		// Trim points (shared across video and content forms)
		if ( data.content ) {
			var trimStartEl = el( 'rd-trim-start' );
			var trimEndEl = el( 'rd-trim-end' );
			if ( trimStartEl && trimStartEl.value.trim() ) {
				data.content.trim_start_seconds = parseTime( trimStartEl.value );
			} else {
				delete data.content.trim_start_seconds;
			}
			if ( trimEndEl && trimEndEl.value.trim() ) {
				data.content.trim_end_seconds = parseTime( trimEndEl.value );
			} else {
				delete data.content.trim_end_seconds;
			}
		}

		// Blockheight (content time — user-editable)
		var blockheightEl = el( 'rd-blockheight' );
		if ( blockheightEl && blockheightEl.value.trim() ) {
			data.blockheight = parseInt( blockheightEl.value.trim(), 10 ) || null;
		}

		// Upload blockheight (auto-captured, preserved as-is)
		var uploadBlockheightEl = el( 'rd-upload-blockheight' );
		if ( uploadBlockheightEl && uploadBlockheightEl.value ) {
			data.upload_blockheight = parseInt( uploadBlockheightEl.value, 10 ) || null;
		}

		return data;
	}

	// -- Save draft via MediaWiki API --

	function initSaveButton() {
		var saveBtn = el( 'rd-save-btn' );
		if ( !saveBtn ) {
			return;
		}

		saveBtn.addEventListener( 'click', function () {
			var originalText = saveBtn.textContent;
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';
			saveBtn.classList.add( 'rd-saving' );

			var data = collectFormData();

			// Serialize to YAML-ish format (simple key-value, MediaWiki will store as-is)
			var yaml = serializeToYaml( data );

			var api = new mw.Api();
			api.postWithEditToken( {
				action: 'edit',
				title: mw.config.get( 'wgPageName' ),
				text: yaml,
				summary: 'Update release draft metadata',
				minor: true
			} ).then( function () {
				saveBtn.textContent = 'Saved!';
				saveBtn.classList.remove( 'rd-saving' );
				saveBtn.classList.add( 'rd-saved' );
				setTimeout( function () {
					saveBtn.textContent = originalText;
					saveBtn.classList.remove( 'rd-saved' );
					saveBtn.disabled = false;
				}, 2000 );
			} ).fail( function ( code, result ) {
				saveBtn.textContent = 'Save Failed';
				saveBtn.classList.remove( 'rd-saving' );
				saveBtn.classList.add( 'rd-save-failed' );
				setStatus( 'Save failed: ' + ( result.error ? result.error.info : code ), 'error' );
				setTimeout( function () {
					saveBtn.textContent = originalText;
					saveBtn.classList.remove( 'rd-save-failed' );
					saveBtn.disabled = false;
				}, 3000 );
			} );
		} );
	}

	function serializeToYaml( data ) {
		// Build YAML manually for clean output (no library dependency)
		// This is a prototype for the future Release API (issue #60)
		var lines = [];
		// See collectFormData() for where draftType originates
		var draftType = data.type || 'record';

		// Envelope — common to all draft types
		lines.push( 'draft_id: ' + quoteYamlValue( data.draft_id || '' ) );
		lines.push( 'type: ' + quoteYamlValue( draftType ) );
		lines.push( 'source: ' + quoteYamlValue( data.source || '' ) );
		lines.push( 'commit: ' + quoteYamlValue( data.commit || '' ) );
		lines.push( 'uploader: ' + quoteYamlValue( data.uploader || '' ) );

		if ( data.blockheight ) {
			lines.push( 'blockheight: ' + data.blockheight );
		} else {
			lines.push( 'blockheight: null' );
		}

		if ( data.upload_blockheight ) {
			lines.push( 'upload_blockheight: ' + data.upload_blockheight );
		}

		// Abandonment markers (set by the abandon buttons in renderActions).
		// Preserved through serialize so subsequent saves don't lose them.
		if ( data.abandoned ) {
			lines.push( 'abandoned: true' );
			if ( data.abandoned_reason ) {
				lines.push( 'abandoned_reason: ' + quoteYamlValue( data.abandoned_reason ) );
			}
			if ( data.abandoned_keep_files ) {
				lines.push( 'abandoned_keep_files: true' );
			}
		}

		// Finalize markers — set by showFinalizeResult after the SSE
		// 'complete' event. Lets the draft page reflect post-finalize
		// state (rather than asking delivery-kid for staging files
		// that were already cleaned up by finalize).
		if ( data.status ) {
			lines.push( 'status: ' + quoteYamlValue( data.status ) );
		}
		if ( data.final_cid ) {
			lines.push( 'final_cid: ' + quoteYamlValue( data.final_cid ) );
		}
		if ( data.finalized_at ) {
			lines.push( 'finalized_at: ' + quoteYamlValue( data.finalized_at ) );
		}

		// Type-specific payload
		if ( draftType === 'record' || draftType === 'album' ) {
			lines.push( 'album:' );
			var album = data.album || {};
			lines.push( '    title: ' + quoteYamlValue( album.title || '' ) );
			lines.push( '    artist: ' + quoteYamlValue( album.artist || '' ) );
			lines.push( '    version: ' + quoteYamlValue( album.version || '' ) );
			lines.push( '    description: ' + quoteYamlValue( album.description || '' ) );

			lines.push( 'tracks:' );
			( data.tracks || [] ).forEach( function ( track ) {
				lines.push( '    -' );
				lines.push( '        filename: ' + quoteYamlValue( track.filename || '' ) );
				lines.push( '        title: ' + quoteYamlValue( track.title || '' ) );
				if ( track.format ) {
					lines.push( '        format: ' + quoteYamlValue( track.format ) );
				}
				if ( track.duration ) {
					lines.push( '        duration: ' + track.duration );
				}
				if ( track.size_bytes ) {
					lines.push( '        size_bytes: ' + track.size_bytes );
				}
				if ( track.metadata ) {
					lines.push( '        metadata: |' );
					track.metadata.split( '\n' ).forEach( function ( ml ) {
						lines.push( '            ' + ml );
					} );
				} else {
					lines.push( '        metadata: ""' );
				}
			} );
		} else if ( draftType === 'video' ) {
			// Video type
			lines.push( 'content:' );
			var vidContent = data.content || {};
			lines.push( '    title: ' + quoteYamlValue( vidContent.title || '' ) );
			lines.push( '    description: ' + quoteYamlValue( vidContent.description || '' ) );
			lines.push( '    file_type: ' + quoteYamlValue( vidContent.file_type || '' ) );
			lines.push( '    venue: ' + quoteYamlValue( vidContent.venue || '' ) );
			lines.push( '    performers:' );
			( vidContent.performers || [] ).forEach( function ( p ) {
				lines.push( '        - ' + quoteYamlValue( p ) );
			} );
			if ( vidContent.trim_start_seconds !== null && vidContent.trim_start_seconds !== undefined ) {
				lines.push( '    trim_start_seconds: ' + vidContent.trim_start_seconds );
			}
			if ( vidContent.trim_end_seconds !== null && vidContent.trim_end_seconds !== undefined ) {
				lines.push( '    trim_end_seconds: ' + vidContent.trim_end_seconds );
			}

			if ( data.files && data.files.length > 0 ) {
				lines.push( 'files:' );
				data.files.forEach( function ( f ) {
					lines.push( '    -' );
					lines.push( '        original_filename: ' + quoteYamlValue( f.original_filename || '' ) );
					lines.push( '        media_type: ' + quoteYamlValue( f.media_type || '' ) );
					if ( f.format ) {
						lines.push( '        format: ' + quoteYamlValue( f.format ) );
					}
					if ( f.duration_seconds ) {
						lines.push( '        duration_seconds: ' + f.duration_seconds );
					}
					if ( f.width ) {
						lines.push( '        width: ' + f.width );
					}
					if ( f.height ) {
						lines.push( '        height: ' + f.height );
					}
					if ( f.size_bytes ) {
						lines.push( '        size_bytes: ' + f.size_bytes );
					}
					if ( f.creation_time ) {
						lines.push( '        creation_time: ' + quoteYamlValue( f.creation_time ) );
					}
				} );
			}
		} else if ( draftType === 'blue-railroad' ) {
			// Blue Railroad — preserve all content fields through save
			lines.push( 'content:' );
			var brContent = data.content || {};
			lines.push( '    exercise: ' + quoteYamlValue( brContent.exercise || '' ) );
			lines.push( '    file_type: ' + quoteYamlValue( brContent.file_type || 'video' ) );
			if ( brContent.venue ) {
				lines.push( '    venue: ' + quoteYamlValue( brContent.venue ) );
			}
			if ( brContent.recorder ) {
				lines.push( '    recorder: ' + quoteYamlValue( brContent.recorder ) );
			}
			if ( brContent.notes ) {
				lines.push( '    notes: ' + quoteYamlValue( brContent.notes ) );
			}
			if ( brContent.participants && brContent.participants.length > 0 ) {
				lines.push( '    participants:' );
				brContent.participants.forEach( function ( p ) {
					lines.push( '        - ' + quoteYamlValue( p ) );
				} );
			}

			if ( data.files && data.files.length > 0 ) {
				lines.push( 'files:' );
				data.files.forEach( function ( f ) {
					lines.push( '    -' );
					lines.push( '        original_filename: ' + quoteYamlValue( f.original_filename || '' ) );
					lines.push( '        media_type: ' + quoteYamlValue( f.media_type || '' ) );
					if ( f.format ) {
						lines.push( '        format: ' + quoteYamlValue( f.format ) );
					}
					if ( f.duration_seconds ) {
						lines.push( '        duration_seconds: ' + f.duration_seconds );
					}
					if ( f.width ) {
						lines.push( '        width: ' + f.width );
					}
					if ( f.height ) {
						lines.push( '        height: ' + f.height );
					}
					if ( f.size_bytes ) {
						lines.push( '        size_bytes: ' + f.size_bytes );
					}
				} );
			}
		} else {
			// Content (other, etc.)
			lines.push( 'content:' );
			var content = data.content || {};
			lines.push( '    title: ' + quoteYamlValue( content.title || '' ) );
			lines.push( '    description: ' + quoteYamlValue( content.description || '' ) );
			lines.push( '    file_type: ' + quoteYamlValue( content.file_type || '' ) );
			lines.push( '    subsequent_to: ' + quoteYamlValue( content.subsequent_to || '' ) );

			if ( data.files && data.files.length > 0 ) {
				lines.push( 'files:' );
				data.files.forEach( function ( f ) {
					lines.push( '    -' );
					lines.push( '        original_filename: ' + quoteYamlValue( f.original_filename || '' ) );
					lines.push( '        media_type: ' + quoteYamlValue( f.media_type || '' ) );
					if ( f.format ) {
						lines.push( '        format: ' + quoteYamlValue( f.format ) );
					}
					if ( f.duration_seconds ) {
						lines.push( '        duration_seconds: ' + f.duration_seconds );
					}
					if ( f.width ) {
						lines.push( '        width: ' + f.width );
					}
					if ( f.height ) {
						lines.push( '        height: ' + f.height );
					}
					if ( f.size_bytes ) {
						lines.push( '        size_bytes: ' + f.size_bytes );
					}
				} );
			}
		}

		return lines.join( '\n' ) + '\n';
	}

	/**
	 * Escape a string value for safe inclusion in hand-built YAML.
	 *
	 * MediaWiki's ResourceLoader doesn't ship a YAML library, so the
	 * Deliver/ReleaseDraft JS modules construct YAML strings manually.
	 * This function wraps values in double quotes when they contain
	 * characters that YAML would otherwise interpret as syntax
	 * (colons, brackets, anchors, etc.) or when the value has
	 * leading/trailing whitespace.
	 *
	 * Empty/null values become "" (empty YAML string).
	 */
	function quoteYamlValue( val ) {
		if ( val === '' || val === null || val === undefined ) {
			return '""';
		}
		val = String( val );
		if ( /[:#\[\]{}&*!|>'"%@`\n]/.test( val ) || val.trim() !== val ) {
			return '"' + val.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' ).replace( /\n/g, '\\n' ) + '"';
		}
		return val;
	}

	// -- Finalize via delivery-kid --

	function initFinalizeButton() {
		var finalizeBtn = el( 'rd-finalize-btn' );
		if ( !finalizeBtn ) {
			return;
		}

		// Hide action buttons for logged-out users
		if ( mw.config.get( 'wgUserId' ) === null ) {
			var actionsDiv = el( 'rd-actions' );
			if ( actionsDiv ) {
				actionsDiv.innerHTML = '<p class="uc-status uc-status-error">You must be logged in to save or finalize drafts.</p>';
			}
			return;
		}

		// Hide finalize button if user lacks finalize-release permission
		if ( !mw.config.get( 'wgCanFinalize' ) ) {
			finalizeBtn.style.display = 'none';
		}

		finalizeBtn.addEventListener( 'click', function () {
			if ( isRefinalize ) {
				if ( !confirm( 'Re-finalize this draft? This will re-transcode and create a new IPFS pin with a new CID.' ) ) {
					return;
				}
			}

			var data = collectFormData();
			var draftId = data.draft_id;
			// See collectFormData() for where draftType originates
			var draftType = data.type || 'record';

			if ( !draftId ) {
				showFinalizeError( 'No draft ID — cannot finalize.' );
				return;
			}

			var apiUrl = mw.config.get( 'wgDeliveryKidUrl' );
			if ( !apiUrl ) {
				showFinalizeError( 'Delivery Kid is not configured. An admin needs to set DeliveryKidApiKey in LocalSettings.php.' );
				return;
			}

			// Use finalize token for finalization (requires finalize-release permission)
			var finalizeToken = mw.config.get( 'wgFinalizeToken' );
			if ( !finalizeToken ) {
				showFinalizeError( 'You do not have permission to finalize releases.' );
				return;
			}

			var authHeaders = {
				'X-Upload-Token': finalizeToken,
				'X-Upload-User': mw.config.get( 'wgUploadUser' ),
				'X-Upload-Timestamp': String( mw.config.get( 'wgUploadTimestamp' ) )
			};

			var headers = Object.assign( {}, authHeaders, {
				'Content-Type': 'application/json'
			} );

			var endpoint, body;

			if ( draftType === 'record' || draftType === 'album' ) {
				var album = data.album || {};
				if ( !album.title ) {
					showFinalizeError( 'Album title is required to finalize.' );
					el( 'rd-album-title' ).focus();
					return;
				}
				if ( !album.artist ) {
					showFinalizeError( 'Artist is required to finalize.' );
					el( 'rd-artist' ).focus();
					return;
				}

				if ( !confirm( 'Finalize this album? This will transcode, tag, and pin to IPFS.' ) ) {
					return;
				}

				var tracks = ( data.tracks || [] ).map( function ( t ) {
					return {
						filename: t.filename,
						title: t.title,
						metadata: t.metadata || ''
					};
				} );

				endpoint = '/draft-album/' + draftId + '/finalize';
				body = JSON.stringify( {
					album_title: album.title,
					artist: album.artist,
					description: album.description || null,
					tracks: tracks
				} );
			} else {
				// Content finalization
				var content = data.content || {};

				if ( !confirm( 'Finalize and pin to IPFS?' ) ) {
					return;
				}

				endpoint = '/draft-content/' + draftId + '/finalize';
				var finalizeBody = {
					title: content.title || null,
					description: content.description || null,
					file_type: content.file_type || null,
					subsequent_to: content.subsequent_to || null,
					transcoding_strategy: 'auto',
					metadata: {}
				};
				if ( content.trim_start_seconds != null ) {
					finalizeBody.trim_start_seconds = content.trim_start_seconds;
				}
				if ( content.trim_end_seconds != null ) {
					finalizeBody.trim_end_seconds = content.trim_end_seconds;
				}
				var preserveCheckbox = el( 'rd-preserve-original' );
				if ( preserveCheckbox && preserveCheckbox.checked ) {
					finalizeBody.preserve_original = true;
				}
				body = JSON.stringify( finalizeBody );
			}

			finalizeBtn.disabled = true;
			el( 'rd-save-btn' ).disabled = true;

			var progressDiv = el( 'rd-finalize-progress' );
			if ( progressDiv ) {
				progressDiv.style.display = '';
			}
			setProgress( 0 );
			setActiveStage( 'preparing' );
			setStatus( 'Starting finalization...', '' );
			appendLog( 'Sending finalize request to delivery-kid...' );

			fetch( apiUrl + endpoint, {
				method: 'POST',
				headers: headers,
				body: body
			} ).then( function ( resp ) {
				if ( !resp.ok ) {
					return resp.json().then( function ( err ) {
						var detail = err.detail;
						var msg;
						if ( typeof detail === 'string' ) {
							msg = detail;
						} else if ( detail && detail.error ) {
							msg = detail.error;
						} else {
							msg = JSON.stringify( err );
						}
						throw new Error( msg );
					} );
				}
				return readSSEStream( resp );
			} ).catch( function ( err ) {
				showFinalizeError( 'Finalization error: ' + err.message );
				finalizeBtn.disabled = false;
				el( 'rd-save-btn' ).disabled = false;
			} );
		} );
	}

	function showFinalizeError( msg ) {
		// Always make the progress area visible so the error is seen
		var progressDiv = el( 'rd-finalize-progress' );
		if ( progressDiv ) {
			progressDiv.style.display = '';
		}
		setStageError();
		setStatus( msg, 'error' );
		appendLog( 'ERROR: ' + msg );
	}

	function readSSEStream( resp ) {
		var reader = resp.body.getReader();
		var decoder = new TextDecoder();
		var buffer = '';

		function pump() {
			return reader.read().then( function ( result ) {
				if ( result.done ) {
					return;
				}

				buffer += decoder.decode( result.value, { stream: true } );
				var lines = buffer.split( '\n' );
				buffer = lines.pop();

				var currentEvent = '';
				for ( var i = 0; i < lines.length; i++ ) {
					var line = lines[ i ].trim();
					if ( line.indexOf( 'event:' ) === 0 ) {
						currentEvent = line.slice( 6 ).trim();
					} else if ( line.indexOf( 'data:' ) === 0 ) {
						var sseData = line.slice( 5 ).trim();
						try {
							handleSSEEvent( currentEvent, JSON.parse( sseData ) );
						} catch ( e ) {
							// skip malformed
						}
					}
				}

				return pump();
			} );
		}

		return pump();
	}

	function handleSSEEvent( event, data ) {
		if ( event === 'progress' ) {
			setProgress( data.progress || 0 );

			// Detect stage from message content
			var msg = data.message || '';
			var stage = data.stage || detectStage( msg );
			if ( stage ) {
				setActiveStage( stage );
			}

			var logMsg = msg;
			if ( data.track ) {
				logMsg += ' — ' + data.track;
			}
			setStatus( logMsg, '' );
			appendLog( logMsg, data.live === true );
		} else if ( event === 'warning' ) {
			setStatus( 'Warning: ' + data.message, '' );
			appendLog( '⚠ ' + data.message );
		} else if ( event === 'complete' ) {
			setProgress( 100 );
			setActiveStage( 'complete' );
			setStatus( 'Pinned to IPFS!', 'success' );
			appendLog( 'CID: ' + ( data.cid || 'unknown' ) );
			showFinalizeResult( data );
		} else if ( event === 'transcoding-submitted' ) {
			// Don't lie: Coconut just *started*, this is not "complete".
			// The SSE closes here because the actual work — transcode →
			// webhook → HLS pin → finalize state — happens asynchronously
			// on delivery-kid over the next 1-3 minutes. Switch the modal
			// into "waiting for webhook" mode: keep it open, poll
			// /draft-content for finalize_log updates, narrate stages as
			// they fire on the server side.
			setProgress( 60 );
			setActiveStage( 'transcoding' );
			setStatus( 'Cloud transcoding in progress (waiting for Coconut)…', '' );
			appendLog( 'Source: ' + ( data.sourceCid || 'staging' ) );
			appendLog( 'Coconut job: ' + ( data.coconutJobId || data.jobId || 'unknown' ) );
			appendLog( data.message || '' );
			showTranscodingResult( data );
			startFinalizePolling();
		} else if ( event === 'error' ) {
			setStageError();
			showFinalizeError( 'Error: ' + ( data.message || 'Unknown error' ) );
			appendLog( 'ERROR: ' + ( data.message || 'Unknown error' ) );
			var finalizeBtn = el( 'rd-finalize-btn' );
			var saveBtn = el( 'rd-save-btn' );
			if ( finalizeBtn ) {
				finalizeBtn.disabled = false;
			}
			if ( saveBtn ) {
				saveBtn.disabled = false;
			}
		}
	}

	function detectStage( msg ) {
		var lower = msg.toLowerCase();
		if ( /transcod/.test( lower ) ) {
			return 'transcoding';
		}
		if ( /tag/.test( lower ) || /vorbis/.test( lower ) || /metadata/.test( lower ) ) {
			return 'tagging';
		}
		if ( /pin/.test( lower ) || /upload/.test( lower ) || /ipfs/.test( lower ) ) {
			return 'pinning';
		}
		if ( /prepar/.test( lower ) || /start/.test( lower ) || /validat/.test( lower ) ) {
			return 'preparing';
		}
		return null;
	}

	function setActiveStage( stageName ) {
		var stages = document.querySelectorAll( '.rd-stage' );
		var reached = false;
		var passed = false;
		stages.forEach( function ( stageEl ) {
			var key = stageEl.dataset.stage;
			stageEl.classList.remove( 'rd-stage-active', 'rd-stage-done', 'rd-stage-error' );
			if ( key === stageName ) {
				stageEl.classList.add( 'rd-stage-active' );
				reached = true;
			} else if ( !reached ) {
				stageEl.classList.add( 'rd-stage-done' );
			}
		} );
	}

	function setStageError() {
		var active = document.querySelector( '.rd-stage.rd-stage-active' );
		if ( active ) {
			active.classList.remove( 'rd-stage-active' );
			active.classList.add( 'rd-stage-error' );
		}
	}

	// === Webhook-driven finalize polling ===
	//
	// For the slow Coconut path the SSE closes after 'transcoding-submitted',
	// minutes before the actual work completes server-side. We poll
	// /draft-content/{draft_id} to watch the finalize_log entries written
	// by routes/coconut.py _update_draft_finalize as the webhook processes
	// the job, and update the modal's stage chips + log + status text
	// accordingly. On terminal state we hand off to showFinalizeResult /
	// showFinalizeError just as the streaming path would.
	var finalizePollTimer = null;
	var finalizePollLastLogLen = 0;
	var finalizePollMaxMs = 15 * 60 * 1000; // 15 min hard cap; Coconut usually finishes in 1-3
	var finalizePollStartedAt = 0;

	function finalizeStageFromLogEntry( entry ) {
		// Map server-side finalize_log entry.stage onto the modal's
		// stage chips. Server emits webhook/pin/complete from the
		// webhook handler; finalize_sse_generator emits prepare/transcode/
		// tag stages earlier in the flow.
		var s = ( entry && entry.stage ) ? entry.stage.toLowerCase() : '';
		if ( s === 'prepare' || s === 'preparing' ) { return 'preparing'; }
		if ( s === 'transcode' || s === 'transcoding' || s === 'webhook' ) {
			return 'transcoding';
		}
		if ( s === 'tag' || s === 'tagging' ) { return 'tagging'; }
		if ( s === 'pin' || s === 'pinning' ) { return 'pinning'; }
		if ( s === 'complete' ) { return 'complete'; }
		return null;
	}

	function stopFinalizePolling() {
		if ( finalizePollTimer ) {
			clearInterval( finalizePollTimer );
			finalizePollTimer = null;
		}
	}

	function startFinalizePolling() {
		var draftId = ( draftData && draftData.draft_id ) || '';
		var deliveryKidUrl = mw.config.get( 'wgDeliveryKidUrl' );
		var uploadToken = mw.config.get( 'wgFinalizeToken' ) ||
			mw.config.get( 'wgUploadToken' );
		if ( !draftId || !deliveryKidUrl || !uploadToken ) {
			appendLog( '(cannot poll finalize state — missing config)' );
			return;
		}
		var headers = {
			'X-Upload-Token': uploadToken,
			'X-Upload-User': mw.config.get( 'wgUploadUser' ),
			'X-Upload-Timestamp': String( mw.config.get( 'wgUploadTimestamp' ) )
		};

		stopFinalizePolling();
		// Don't carry log-length state across separate finalize runs.
		finalizePollLastLogLen = 0;
		finalizePollStartedAt = Date.now();

		function poll() {
			if ( Date.now() - finalizePollStartedAt > finalizePollMaxMs ) {
				stopFinalizePolling();
				setStatus(
					'Stopped waiting for Coconut after 15 min — check delivery-kid logs.',
					'error'
				);
				return;
			}

			fetch( deliveryKidUrl + '/draft-content/' +
					encodeURIComponent( draftId ),
				{ headers: headers }
			).then( function ( resp ) {
				if ( !resp.ok ) { return null; }
				return resp.json();
			} ).then( function ( state ) {
				if ( !state ) { return; }

				// Replay newly-appended finalize_log entries into the
				// modal: stage chip + status text + log line each.
				var log = state.finalize_log || [];
				for ( var i = finalizePollLastLogLen; i < log.length; i++ ) {
					var entry = log[ i ];
					var msg = entry.message || '';
					var stagePrefix = entry.stage ?
						'[' + entry.stage + '] ' : '';
					appendLog( stagePrefix + msg );
					var modalStage = finalizeStageFromLogEntry( entry );
					if ( modalStage ) {
						setActiveStage( modalStage );
					}
					if ( msg && !entry.error ) {
						setStatus( msg, '' );
					}
				}
				finalizePollLastLogLen = log.length;

				// Terminal-state handoff.
				if ( state.status === 'finalized' && state.final_cid ) {
					stopFinalizePolling();
					setProgress( 100 );
					setActiveStage( 'complete' );
					var gw = ( state.preview_gateway_url ||
						deliveryKidUrl.replace( '://delivery-kid', '://ipfs.delivery-kid' ) +
						'/ipfs/' + state.final_cid );
					showFinalizeResult( {
						cid: state.final_cid,
						gateway_url: gw
					} );
				} else if ( state.status === 'finalize_failed' ) {
					stopFinalizePolling();
					setStageError();
					var errMsg = 'Finalize failed';
					if ( log.length ) {
						var last = log[ log.length - 1 ];
						if ( last && last.error ) { errMsg = last.error; }
						else if ( last && last.message ) { errMsg = last.message; }
					}
					showFinalizeError( errMsg );
				}
			} ).catch( function () {
				// Silent retry on next tick — transient blips shouldn't
				// pollute the modal log.
			} );
		}

		// Kick off immediately so the user gets the first stage update
		// without waiting a full poll interval.
		poll();
		finalizePollTimer = setInterval( poll, 3000 );
	}

	function setProgress( pct ) {
		var fill = document.querySelector( '#rd-progress-bar .uc-progress-fill' );
		if ( fill ) {
			fill.style.width = pct + '%';
		}
	}

	// The line currently being rewritten in place by live progress updates,
	// or null when the last thing logged was an ordinary event.
	var liveLogLine = null;

	// appendLog( msg )         -> add a line, as before
	// appendLog( msg, true )   -> rewrite the live line in place
	//
	// Encoding emits an update every couple of seconds. For an hour-long
	// video that is well over a thousand rows if each one is appended, which
	// buries everything that actually happened. Live updates therefore
	// overwrite a single row; the next non-live event releases it, so the
	// final progress figure stays in the log as a record.
	function appendLog( msg, live ) {
		var log = el( 'rd-progress-log' );
		if ( !log ) {
			return;
		}
		if ( live ) {
			if ( liveLogLine && liveLogLine.parentNode === log ) {
				liveLogLine.textContent = msg;
				log.scrollTop = log.scrollHeight;
				return;
			}
			liveLogLine = document.createElement( 'div' );
			liveLogLine.className = 'rd-log-live';
			liveLogLine.textContent = msg;
			log.appendChild( liveLogLine );
			log.scrollTop = log.scrollHeight;
			return;
		}
		liveLogLine = null;
		var line = document.createElement( 'div' );
		line.textContent = msg;
		log.appendChild( line );
		log.scrollTop = log.scrollHeight;
	}

	function showFinalizeResult( resultData ) {
		// Save the draft page (preserving current form data) — no Release page creation.
		// The bot will create the Release page when it processes completed drafts.
		var data = collectFormData();
		var cid = resultData.cid;
		// Record finalize state so future page loads know the staging dir
		// is gone (it was wiped by the finalize SSE handler) and can
		// render the final HLS video instead.
		if ( cid ) {
			data.final_cid = cid;
			data.status = 'finalized';
			data.finalized_at = new Date().toISOString();
		}
		var yaml = serializeToYaml( data );

		var api = new mw.Api();
		api.postWithEditToken( {
			action: 'edit',
			title: mw.config.get( 'wgPageName' ),
			text: yaml,
			summary: 'Finalized: pinned to IPFS as ' + ( cid || 'unknown' )
		} ).then( function () {
			var releaseUrl = mw.util.getUrl( 'Release:' + cid );
			setStatus( 'Pinned to IPFS! CID: ' + cid, 'success' );
			appendLog( 'Gateway: ' + ( resultData.gateway_url || '' ) );
			appendLog( 'Release page will be created by the bot.' );
			appendLog( '' );

			// Show a link to the (future) Release page
			var linkHtml = '<p><a href="' + mw.html.escape( releaseUrl ) + '">' +
				'Release:' + mw.html.escape( cid ) + '</a></p>';
			var logEl = el( 'rd-progress-log' );
			if ( logEl ) {
				logEl.innerHTML += linkHtml;
			}

			// Re-enable finalize as "Re-finalize" for redo scenarios
			enableRefinalize();
		} ).fail( function ( code, result ) {
			setStatus( 'Pinned to IPFS but failed to save draft: ' +
				( result.error ? result.error.info : code ) + '. CID: ' + cid, 'error' );
			enableRefinalize();
		} );
	}

	function showTranscodingResult( data ) {
		// Coconut cloud transcoding was submitted — save draft and show polling UI
		var formData = collectFormData();
		var yaml = serializeToYaml( formData );

		var api = new mw.Api();
		api.postWithEditToken( {
			action: 'edit',
			title: mw.config.get( 'wgPageName' ),
			text: yaml,
			summary: 'Transcoding submitted: job ' + ( data.jobId || 'unknown' )
		} ).then( function () {
			appendLog( 'Draft saved. Transcoding will complete asynchronously.' );
			appendLog( 'When transcoding finishes, the HLS output will be pinned to IPFS.' );
			appendLog( 'The bot will then create the Release page.' );
			enableRefinalize();
		} ).fail( function ( code, result ) {
			appendLog( 'Warning: failed to save draft page: ' +
				( result.error ? result.error.info : code ) );
			enableRefinalize();
		} );
	}

	var isRefinalize = false;

	function enableRefinalize() {
		var finalizeBtn = el( 'rd-finalize-btn' );
		var saveBtn = el( 'rd-save-btn' );
		if ( finalizeBtn ) {
			finalizeBtn.disabled = false;
			finalizeBtn.textContent = 'Re-finalize & Pin to IPFS';
			isRefinalize = true;
		}
		if ( saveBtn ) {
			saveBtn.disabled = false;
		}
	}

	// -- Blockheight converter --

	function initBlockheightConverter() {
		var nowBtn = el( 'rd-blockheight-now' );
		var bhInput = el( 'rd-blockheight' );
		var dateLabel = el( 'rd-blockheight-date' );
		var dateInput = el( 'rd-date-input' );

		if ( !nowBtn || !bhInput ) {
			return;
		}

		// "Current Block" button — fetch latest via public Ethereum RPC
		nowBtn.addEventListener( 'click', function () {
			nowBtn.disabled = true;
			nowBtn.textContent = 'Fetching...';

			fetch( 'https://ethereum-rpc.publicnode.com', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( {
					jsonrpc: '2.0',
					method: 'eth_blockNumber',
					params: [],
					id: 1
				} )
			} )
				.then( function ( r ) { return r.json(); } )
				.then( function ( resp ) {
					if ( resp.result ) {
						var blockNum = parseInt( resp.result, 16 );
						bhInput.value = blockNum;
						// We just fetched the current block, so the date is now
						setBlockDateToNow();
					}
				} )
				.catch( function () {
					// Fallback: estimate from current time
					var now = Math.floor( Date.now() / 1000 );
					var estimated = timestampToBlock( now );
					bhInput.value = estimated;
					updateBlockDate( estimated );
				} )
				.finally( function () {
					nowBtn.disabled = false;
					nowBtn.textContent = 'Current Block';
				} );
		} );

		// When user types a block number, estimate the date
		bhInput.addEventListener( 'change', function () {
			var val = parseInt( bhInput.value, 10 );
			if ( val > 0 ) {
				updateBlockDate( val );
			} else if ( dateLabel ) {
				dateLabel.textContent = '';
			}
		} );

		// Date picker → estimate block from date (local formula, day-level precision)
		if ( dateInput ) {
			dateInput.addEventListener( 'change', function () {
				var dateStr = dateInput.value;
				if ( !dateStr ) {
					return;
				}
				var ts = Math.floor( new Date( dateStr + 'T12:00:00Z' ).getTime() / 1000 );
				var estimated = timestampToBlock( ts );
				if ( estimated > 0 ) {
					bhInput.value = estimated;
					updateBlockDate( estimated );
				}
			} );
		}

		// Show date for existing value on load
		var existingVal = parseInt( bhInput.value, 10 );
		if ( existingVal > 0 ) {
			updateBlockDate( existingVal );
		}
	}

	function blockToTimestamp( blockNumber ) {
		if ( blockNumber >= MERGE_BLOCK ) {
			// Post-merge: exactly 12s per block from the merge point
			return ANCHOR_TS + ( ( blockNumber - ANCHOR_BLOCK ) * SECONDS_PER_BLOCK );
		}
		// Pre-merge: estimate from genesis with ~13.3s average
		return ETH_GENESIS_TS + ( blockNumber * PRE_MERGE_AVG );
	}

	function timestampToBlock( ts ) {
		if ( ts >= MERGE_TS ) {
			return ANCHOR_BLOCK + Math.round( ( ts - ANCHOR_TS ) / SECONDS_PER_BLOCK );
		}
		return Math.floor( ( ts - ETH_GENESIS_TS ) / PRE_MERGE_AVG );
	}

	function setBlockDateToNow() {
		var dateLabel = el( 'rd-blockheight-date' );
		if ( !dateLabel ) {
			return;
		}
		var date = new Date();
		dateLabel.textContent = '≈ ' + date.toLocaleDateString( 'en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		} );
	}

	function updateBlockDate( blockNumber ) {
		var dateLabel = el( 'rd-blockheight-date' );
		if ( !dateLabel ) {
			return;
		}

		dateLabel.textContent = '⏳';

		// Fetch actual block timestamp via public Ethereum RPC
		var hexBlock = '0x' + blockNumber.toString( 16 );
		fetch( 'https://ethereum-rpc.publicnode.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				jsonrpc: '2.0',
				method: 'eth_getBlockByNumber',
				params: [ hexBlock, false ],
				id: 1
			} )
		} )
			.then( function ( r ) { return r.json(); } )
			.then( function ( resp ) {
				if ( resp.result && resp.result.timestamp ) {
					var ts = parseInt( resp.result.timestamp, 16 );
					var exactDate = new Date( ts * 1000 );
					dateLabel.textContent = exactDate.toLocaleDateString( 'en-US', {
						year: 'numeric',
						month: 'long',
						day: 'numeric'
					} );
				} else {
					dateLabel.textContent = '';
				}
			} )
			.catch( function () {
				dateLabel.textContent = '';
			} );
	}

	// -- Video preview & trim --

	function formatTime( seconds ) {
		if ( seconds === null || seconds === undefined || seconds === '' ) {
			return '';
		}
		var s = parseFloat( seconds );
		if ( isNaN( s ) ) {
			return '';
		}
		var m = Math.floor( s / 60 );
		var sec = s - m * 60;
		return m + ':' + ( sec < 10 ? '0' : '' ) + sec.toFixed( 1 );
	}

	function parseTime( str ) {
		if ( !str || !str.trim() ) {
			return null;
		}
		str = str.trim();
		// Accept m:ss.s or just seconds
		var parts = str.split( ':' );
		if ( parts.length === 2 ) {
			return parseFloat( parts[ 0 ] ) * 60 + parseFloat( parts[ 1 ] );
		}
		var val = parseFloat( str );
		return isNaN( val ) ? null : val;
	}

	function updateTrimPreview() {
		var preview = el( 'rd-trim-preview' );
		if ( !preview ) {
			return;
		}
		var video = el( 'rd-video-player' );
		var startInput = el( 'rd-trim-start' );
		var endInput = el( 'rd-trim-end' );
		if ( !startInput || !endInput ) {
			return;
		}

		var start = parseTime( startInput.value );
		var end = parseTime( endInput.value );
		var duration = video ? video.duration : null;

		var parts = [];
		if ( start !== null && start > 0 ) {
			parts.push( 'trimming first ' + formatTime( start ) );
		}
		if ( end !== null && duration && end < duration ) {
			parts.push( 'trimming last ' + formatTime( duration - end ) );
		}
		if ( start !== null && end !== null ) {
			var outputDuration = end - start;
			if ( outputDuration > 0 ) {
				parts.push( 'output duration: ' + formatTime( outputDuration ) );
			}
		}
		preview.textContent = parts.length > 0 ? parts.join( ' · ' ) : '';
	}

	function initVideoPreview() {
		var video = el( 'rd-video-player' );
		if ( !video ) {
			return;
		}

		var deliveryKidUrl = mw.config.get( 'wgDeliveryKidUrl' );
		// Prefer finalize token (release group) over upload token (uploader only)
		var token = mw.config.get( 'wgFinalizeToken' ) || mw.config.get( 'wgUploadToken' );
		var user = mw.config.get( 'wgUploadUser' );
		var timestamp = mw.config.get( 'wgUploadTimestamp' );
		var gatewayUrl = mw.config.get( 'wgIpfsGatewayUrl' ) || 'https://ipfs.delivery-kid.cryptograss.live';
		var draftId = video.getAttribute( 'data-draft-id' );
		var filename = video.getAttribute( 'data-filename' );
		var previewStatus = el( 'rd-preview-status' );
		var hlsInfo = el( 'rd-hls-info' );

		if ( !deliveryKidUrl || !draftId ) {
			return;
		}

		// Finalized drafts: staging dir was wiped by the finalize SSE
		// handler, so /draft-content will 404. Render the HLS player
		// for the final CID instead — same machinery as Template:HLSVideo.
		var finalCid = draftData && draftData.final_cid;
		if ( finalCid ) {
			var container = video.parentNode;
			if ( container ) {
				container.innerHTML = '';
				var hlsDiv = document.createElement( 'div' );
				hlsDiv.className = 'hls-video-player';
				hlsDiv.setAttribute( 'data-cid', finalCid );
				hlsDiv.setAttribute( 'data-width', '100%' );
				hlsDiv.setAttribute( 'data-max-width', '800px' );
				container.appendChild( hlsDiv );
				// Common.js HLS hydrator listens on this hook.
				if ( mw.hook ) {
					mw.hook( 'wikipage.content' ).fire( $( container ) );
				}
				if ( hlsInfo ) {
					hlsInfo.innerHTML = 'Finalized — pinned at ' +
						'<a href="' + mw.html.escape( mw.util.getUrl( 'Release:' + finalCid ) ) + '">' +
						'Release:' + mw.html.escape( finalCid ) + '</a>.';
				}
			}
			return;
		}

		function setVideoSrc( src ) {
			video.src = src;
			video.style.display = '';
			if ( previewStatus ) {
				previewStatus.style.display = 'none';
			}
		}

		function showPreviewStatus( msg ) {
			if ( previewStatus ) {
				previewStatus.textContent = msg;
				previewStatus.style.display = '';
			}
			video.style.display = 'none';
		}

		// Render the preview_log array from /draft-content into the
		// rd-preview-log container. Idempotent — replaces contents on
		// each call so we can safely re-render every poll tick.
		function renderPreviewLog( log ) {
			var logEl = el( 'rd-preview-log' );
			if ( !logEl || !log || !log.length ) {
				return;
			}
			var html = '';
			log.forEach( function ( entry ) {
				var ts = ( entry.ts || '' ).replace( 'T', ' ' ).replace( /\..*$/, '' );
				var pct = entry.progress != null ? ' (' + entry.progress + '%)' : '';
				html += '<div class="rd-preview-log-entry">' +
					'<span class="rd-preview-log-ts">' + mw.html.escape( ts ) + '</span> ' +
					mw.html.escape( entry.message || '' ) +
					mw.html.escape( pct ) +
					'</div>';
			} );
			logEl.innerHTML = html;
			logEl.style.display = '';
			// Scroll the latest line into view.
			logEl.scrollTop = logEl.scrollHeight;
		}

		function loadFromStaging() {
			if ( !token || !filename ) {
				return false;
			}
			var src = deliveryKidUrl + '/staging/drafts/' +
				encodeURIComponent( draftId ) + '/' +
				encodeURIComponent( filename ) +
				'?token=' + encodeURIComponent( token ) +
				'&user=' + encodeURIComponent( user ) +
				'&timestamp=' + encodeURIComponent( timestamp );
			setVideoSrc( src );
			return true;
		}

		function pollForPreview() {
			showPreviewStatus( '⏳ Preview is being transcoded...' );
			if ( hlsInfo ) {
				hlsInfo.textContent = 'AV1 HLS transcoding in progress. Preview will appear when ready.';
			}

			var headers = {};
			if ( token ) {
				headers[ 'X-Upload-Token' ] = token;
				headers[ 'X-Upload-User' ] = user;
				headers[ 'X-Upload-Timestamp' ] = String( timestamp );
			}

			var pollInterval = setInterval( function () {
				fetch( deliveryKidUrl + '/draft-content/' + draftId, {
					headers: headers
				} ).then( function ( resp ) {
					if ( !resp.ok ) {
						return null;
					}
					return resp.json();
				} ).then( function ( data ) {
					if ( !data ) {
						return;
					}
					renderPreviewLog( data.preview_log );
					if ( data.preview_status === 'ready' && data.preview_mp4_cid ) {
						clearInterval( pollInterval );
						setVideoSrc( gatewayUrl + '/ipfs/' + data.preview_mp4_cid );
						if ( hlsInfo ) {
							hlsInfo.textContent = 'AV1 HLS transcode complete. Ready to finalize.';
						}
					} else if ( data.preview_status === 'failed' ) {
						clearInterval( pollInterval );
						// Fall back to staging if available
						if ( !loadFromStaging() ) {
							showPreviewStatus( 'Preview transcoding failed.' );
						}
						if ( hlsInfo ) {
							hlsInfo.textContent = 'Preview transcoding failed. Video will be transcoded on finalization.';
						}
					}
				} ).catch( function () {
					// Silently retry on network errors
				} );
			}, 10000 ); // Poll every 10 seconds
		}

		// Check delivery-kid for preview status
		// The preview CID lives in delivery-kid's draft state, not the wiki YAML.
		if ( token ) {
			showPreviewStatus( '⏳ Checking preview...' );
			var headers = {};
			headers[ 'X-Upload-Token' ] = token;
			headers[ 'X-Upload-User' ] = user;
			headers[ 'X-Upload-Timestamp' ] = String( timestamp );

			fetch( deliveryKidUrl + '/draft-content/' + draftId, {
				headers: headers
			} ).then( function ( resp ) {
				if ( resp.status === 403 ) {
					showPreviewStatus( 'Log in with an account that can view this draft to see a preview.' );
					return null;
				}
				if ( resp.status === 404 ) {
					// Either the draft was finalized (staging cleaned by SSE
					// handler) but the YAML wasn't updated with final_cid,
					// or staging just expired. Either way the user should
					// look at Special:Releases to find the finalized version.
					showPreviewStatus(
						'Staging cleaned up — this draft was probably finalized. ' +
						'Check Special:Releases for the pinned video.'
					);
					return null;
				}
				if ( !resp.ok ) {
					showPreviewStatus( 'Preview unavailable (' + resp.status + ').' );
					return null;
				}
				return resp.json();
			} ).then( function ( data ) {
				if ( !data ) {
					return;
				}
				renderPreviewLog( data.preview_log );
				if ( data.preview_status === 'ready' && data.preview_mp4_cid ) {
					setVideoSrc( gatewayUrl + '/ipfs/' + data.preview_mp4_cid );
					if ( hlsInfo ) {
						hlsInfo.textContent = 'AV1 HLS transcode complete. Ready to finalize.';
					}
				} else if ( data.preview_status === 'pending' || data.preview_status === 'processing' ) {
					pollForPreview();
				} else {
					loadFromStaging();
				}
			} ).catch( function () {
				loadFromStaging();
			} );
		} else {
			showPreviewStatus( 'Log in to preview video.' );
		}

		// "Set start" / "Set end" buttons grab current playback position
		var setStartBtn = el( 'rd-trim-set-start' );
		var setEndBtn = el( 'rd-trim-set-end' );
		var startInput = el( 'rd-trim-start' );
		var endInput = el( 'rd-trim-end' );

		if ( setStartBtn && startInput ) {
			setStartBtn.addEventListener( 'click', function () {
				startInput.value = formatTime( video.currentTime );
				updateTrimPreview();
			} );
		}
		if ( setEndBtn && endInput ) {
			setEndBtn.addEventListener( 'click', function () {
				endInput.value = formatTime( video.currentTime );
				updateTrimPreview();
			} );
		}
		if ( startInput ) {
			startInput.addEventListener( 'input', updateTrimPreview );
		}
		if ( endInput ) {
			endInput.addEventListener( 'input', updateTrimPreview );
		}

		// Update preview once video metadata is loaded (to know total duration)
		video.addEventListener( 'loadedmetadata', updateTrimPreview );
		updateTrimPreview();
	}

	// -- Diagnostics panel --
	//
	// Pulls draft state from delivery-kid (/draft-content/{id}) and renders
	// the persisted upload_log / finalize_log / preview_log. Justin's
	// pinning service writes one entry per phase transition, so when an
	// upload, transcode, or pin fails the cause is on disk in draft.json
	// and survives reloads. Without this panel the wiki page just shows
	// "Preview transcoding failed" as a single static line.
	//
	// Auto-expanded on any *_failed state, collapsed on success.
	// Polls every 10s while status/preview_status is in-flight.

	var DIAG_POLL_INTERVAL_MS = 10000;
	var diagPollTimer = null;

	function initDiagnostics() {
		var container = el( 'rd-diagnostics' );
		var apiUrl = mw.config.get( 'wgDeliveryKidUrl' );
		var token = mw.config.get( 'wgUploadToken' );
		var draftType = ( draftData.type || 'record' );
		var draftId = draftData.draft_id;

		if ( !container || !apiUrl || !draftId || !token ) {
			return;
		}

		// Album drafts use /draft-album/{id}, which doesn't expose logs.
		// Skip — the panel only makes sense for content drafts.
		if ( draftType === 'record' || draftType === 'album' ) {
			return;
		}

		var headers = {
			'X-Upload-Token': token,
			'X-Upload-User': mw.config.get( 'wgUploadUser' ),
			'X-Upload-Timestamp': String( mw.config.get( 'wgUploadTimestamp' ) )
		};

		function fetchAndRender() {
			fetch( apiUrl + '/draft-content/' + encodeURIComponent( draftId ), {
				headers: headers
			} ).then( function ( resp ) {
				// 404 means delivery-kid has forgotten the draft (e.g. its
				// staging dir was rebuilt). Fall back to the snapshot the
				// pinning-service wrote to ReleaseDraft:{id}/diagnostics
				// at terminal state — that page outlives delivery-kid storage.
				if ( resp.status === 404 ) {
					return loadFromWikiSnapshot();
				}
				return resp.ok ? resp.json() : null;
			} ).then( function ( data ) {
				if ( !data ) {
					return;
				}
				renderDiagnostics( container, data );
				if ( diagShouldPoll( data ) ) {
					if ( !diagPollTimer ) {
						diagPollTimer = setInterval( fetchAndRender, DIAG_POLL_INTERVAL_MS );
					}
				} else if ( diagPollTimer ) {
					clearInterval( diagPollTimer );
					diagPollTimer = null;
				}
			} ).catch( function () {
				// Silent — diagnostics are best-effort. The video preview
				// path surfaces hard fetch failures separately.
			} );
		}

		fetchAndRender();
	}

	/**
	 * Fetch ReleaseDraft:{id}/diagnostics via the MediaWiki API and parse
	 * its JSON content. Used as the fallback when delivery-kid's live
	 * /draft-content endpoint returns 404.
	 *
	 * Returns a Promise that resolves to the parsed snapshot dict (with
	 * an _from_snapshot marker for the renderer) or null if the page
	 * doesn't exist or its content isn't valid JSON.
	 */
	function loadFromWikiSnapshot() {
		var subpage = mw.config.get( 'wgPageName' ) + '/diagnostics';
		return new mw.Api().get( {
			action: 'query',
			prop: 'revisions',
			rvprop: 'content',
			rvslots: 'main',
			titles: subpage,
			formatversion: 2
		} ).then( function ( resp ) {
			var pages = ( resp.query || {} ).pages || [];
			var page = pages[ 0 ];
			if ( !page || page.missing ) {
				return null;
			}
			var rev = page.revisions && page.revisions[ 0 ];
			var content = rev && rev.slots && rev.slots.main && rev.slots.main.content;
			if ( !content ) {
				return null;
			}
			try {
				var data = JSON.parse( content );
				data._from_snapshot = true;
				return data;
			} catch ( e ) {
				return null;
			}
		} ).catch( function () {
			return null;
		} );
	}

	function diagShouldPoll( data ) {
		var status = data.status || '';
		var previewStatus = data.preview_status || '';
		return status === 'uploading' || status === 'finalizing' ||
			previewStatus === 'pending' || previewStatus === 'processing';
	}

	function renderDiagnostics( container, data ) {
		var status = data.status || 'unknown';
		var previewStatus = data.preview_status || 'none';
		var uploadLog = data.upload_log || [];
		var finalizeLog = data.finalize_log || [];
		var previewLog = data.preview_log || [];

		var failed = ( status === 'upload_failed' ) ||
			( status === 'finalize_failed' ) ||
			( previewStatus === 'failed' );
		var inFlight = ( status === 'uploading' ) || ( status === 'finalizing' ) ||
			( previewStatus === 'pending' ) || ( previewStatus === 'processing' );
		var hasAnyLog = uploadLog.length > 0 || finalizeLog.length > 0 || previewLog.length > 0;

		if ( !failed && !inFlight && !hasAnyLog ) {
			container.hidden = true;
			container.innerHTML = '';
			return;
		}
		container.hidden = false;

		var parts = [];

		// Banner
		if ( failed ) {
			var failedStage;
			var lastError;
			if ( status === 'upload_failed' ) {
				failedStage = 'Upload';
				lastError = diagFindLastError( uploadLog );
			} else if ( status === 'finalize_failed' ) {
				failedStage = 'Finalize';
				lastError = diagFindLastError( finalizeLog );
			} else {
				failedStage = 'Preview transcoding';
				lastError = diagFindLastError( previewLog );
			}
			parts.push(
				'<div class="rd-diag-banner rd-diag-banner-error">' +
					'<strong>' + mw.html.escape( failedStage ) + ' failed.</strong> ' +
					mw.html.escape( lastError || 'See log below for details.' ) +
				'</div>'
			);
		} else if ( inFlight ) {
			var inFlightLabel;
			if ( status === 'uploading' ) {
				inFlightLabel = 'Upload in progress…';
			} else if ( status === 'finalizing' ) {
				inFlightLabel = 'Finalize in progress…';
			} else {
				inFlightLabel = 'Preview transcoding in progress…';
			}
			parts.push(
				'<div class="rd-diag-banner rd-diag-banner-info">' +
					mw.html.escape( inFlightLabel ) +
				'</div>'
			);
		}

		// Collapsible details — open when failed, closed when clean/in-flight
		var openAttr = failed ? ' open' : '';
		var summaryText = data._from_snapshot ?
			'Upload diagnostics (snapshot)' :
			'Upload diagnostics';
		var details = '<details class="rd-diag-details"' + openAttr + '>';
		details += '<summary>' + mw.html.escape( summaryText ) + '</summary>';
		details += '<dl class="rd-diag-meta">';
		details += '<dt>Status</dt><dd>' + mw.html.escape( status ) + '</dd>';
		if ( previewStatus !== 'none' ) {
			details += '<dt>Preview</dt><dd>' + mw.html.escape( previewStatus ) + '</dd>';
		}
		// When the data came from the wiki snapshot (delivery-kid forgot
		// the draft), surface that fact + when the snapshot was taken so
		// users know they're looking at a frozen view.
		if ( data._from_snapshot ) {
			details += '<dt>Source</dt><dd>wiki snapshot — delivery-kid no longer has live data</dd>';
			if ( data.snapshot_at ) {
				details += '<dt>Snapshot taken</dt><dd>' + mw.html.escape( String( data.snapshot_at ) ) + '</dd>';
			}
		}
		details += '</dl>';

		if ( uploadLog.length ) {
			details += '<h4>Upload log</h4>' + diagRenderLog( uploadLog );
		}
		if ( previewLog.length ) {
			details += '<h4>Preview transcoding log</h4>' + diagRenderLog( previewLog );
		}
		if ( finalizeLog.length ) {
			details += '<h4>Finalize log</h4>' + diagRenderLog( finalizeLog );
		}
		details += '</details>';
		parts.push( details );

		container.innerHTML = parts.join( '' );
	}

	function diagRenderLog( entries ) {
		var rows = entries.map( function ( e ) {
			var ts = e.ts ? mw.html.escape( String( e.ts ) ) : '';
			var stage = mw.html.escape( e.phase || e.stage || '' );
			var msg = mw.html.escape( e.message || '' );
			var pct = ( e.progress !== null && e.progress !== undefined ) ?
				' <span class="rd-diag-pct">(' + mw.html.escape( String( e.progress ) ) + '%)</span>' : '';
			var rowCls = e.error ? 'rd-diag-row rd-diag-row-error' : 'rd-diag-row';
			var html = '<div class="' + rowCls + '">' +
				( ts ? '<span class="rd-diag-ts">' + ts + '</span> ' : '' ) +
				( stage ? '<span class="rd-diag-stage">[' + stage + ']</span> ' : '' ) +
				'<span class="rd-diag-msg">' + msg + pct + '</span>';
			if ( e.error ) {
				html += '<pre class="rd-diag-err">' + mw.html.escape( String( e.error ) ) + '</pre>';
			}
			html += '</div>';
			return html;
		} );
		return '<div class="rd-diag-log">' + rows.join( '' ) + '</div>';
	}

	function diagFindLastError( entries ) {
		for ( var i = entries.length - 1; i >= 0; i-- ) {
			if ( entries[ i ].error ) {
				return String( entries[ i ].error );
			}
		}
		// No structured error field — fall back to the last message line so
		// the banner is never blank when something went wrong.
		if ( entries.length ) {
			return entries[ entries.length - 1 ].message || null;
		}
		return null;
	}

	// -- Init --

	function initCreationTimeFallback() {
		// If the date field is empty and a video file has creation_time
		// metadata (from the camera/phone), pre-fill the date picker.
		var dateInput = el( 'rd-date-input' );
		var bhInput = el( 'rd-blockheight' );
		if ( !dateInput || dateInput.value || ( bhInput && bhInput.value ) ) {
			return;
		}
		var files = ( draftData && draftData.files ) || [];
		for ( var i = 0; i < files.length; i++ ) {
			if ( files[ i ].creation_time ) {
				var dateStr = files[ i ].creation_time.substring( 0, 10 );
				if ( /^\d{4}-\d{2}-\d{2}$/.test( dateStr ) ) {
					dateInput.value = dateStr;
					dateInput.dispatchEvent( new Event( 'change' ) );
					break;
				}
			}
		}
	}

	// Set href on every <a class="rd-download-original"> in the file tables,
	// using the upload token JS config that's freshly generated on every page
	// render. Using JS keeps the auth params out of the parser-cached HTML.
	function initDownloadLinks() {
		var deliveryKidUrl = mw.config.get( 'wgDeliveryKidUrl' );
		var token = mw.config.get( 'wgFinalizeToken' ) || mw.config.get( 'wgUploadToken' );
		var user = mw.config.get( 'wgUploadUser' );
		var timestamp = mw.config.get( 'wgUploadTimestamp' );
		if ( !deliveryKidUrl || !token ) {
			return;
		}
		var links = document.querySelectorAll( 'a.rd-download-original' );
		Array.prototype.forEach.call( links, function ( link ) {
			var draftId = link.getAttribute( 'data-draft-id' );
			var filename = link.getAttribute( 'data-filename' );
			if ( !draftId || !filename ) {
				return;
			}
			link.href = deliveryKidUrl + '/staging/drafts/' +
				encodeURIComponent( draftId ) + '/' +
				encodeURIComponent( filename ) +
				'?token=' + encodeURIComponent( token ) +
				'&user=' + encodeURIComponent( user ) +
				'&timestamp=' + encodeURIComponent( timestamp );
		} );
	}

	// Mark this draft as abandoned. Both buttons just write YAML markers —
	// the actual staging-dir cleanup (when keepFiles is false) is handled
	// out-of-band by the cleanup script that already does the equivalent
	// for delete/unpin on Releases. Single source of truth: the YAML.
	function abandonDraft( keepFiles ) {
		var draftId = ( draftData && draftData.draft_id ) || '';
		if ( !draftId ) {
			return;
		}

		var prompt_ = keepFiles
			? 'Abandon this draft and keep the uploaded files for now?\n\nReason (optional):'
			: 'Abandon this draft and flag its files for cleanup?\n\nReason (optional):';
		// eslint-disable-next-line no-alert
		var reason = window.prompt( prompt_, '' );
		if ( reason === null ) {
			return; // user cancelled
		}

		var data = collectFormData();
		data.abandoned = true;
		data.abandoned_reason = reason;
		data.abandoned_keep_files = !!keepFiles;
		var yaml = serializeToYaml( data );

		var summary = keepFiles
			? 'Abandon draft (files kept)'
			: 'Abandon draft (files flagged for cleanup)';
		if ( reason ) {
			summary += ': ' + reason;
		}

		new mw.Api().postWithEditToken( {
			action: 'edit',
			title: mw.config.get( 'wgPageName' ),
			text: yaml,
			summary: summary
		} ).then( function () {
			window.location.reload();
		} ).fail( function ( code, result ) {
			// eslint-disable-next-line no-alert
			window.alert(
				'Could not abandon: ' +
				( result && result.error ? result.error.info : code )
			);
		} );
	}

	function initAbandonButtons() {
		var keepBtn = el( 'rd-abandon-keep-btn' );
		var deleteBtn = el( 'rd-abandon-delete-btn' );
		if ( keepBtn ) {
			keepBtn.addEventListener( 'click', function () { abandonDraft( true ); } );
		}
		if ( deleteBtn ) {
			deleteBtn.addEventListener( 'click', function () { abandonDraft( false ); } );
		}
	}

	function init() {
		initTrackDragReorder();
		initSaveButton();
		initFinalizeButton();
		initBlockheightConverter();
		initVideoPreview();
		initCreationTimeFallback();
		initDownloadLinks();
		initAbandonButtons();
		initDiagnostics();
	}

	mw.loader.using( [ 'mediawiki.util', 'mediawiki.api' ] ).then( init );

}() );
