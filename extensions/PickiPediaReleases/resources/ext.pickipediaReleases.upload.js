/**
 * Upload Content — client-side workflow for Special:UploadContent.
 *
 * Steps: Connect Wallet → Upload Files → Review Metadata → Finalize (Pin to IPFS)
 */
( function () {
	'use strict';

	var DELIVERY_KID_URL = mw.config.get( 'wgDeliveryKidUrl' );
	var currentDraftId = null;
	var currentDraftFiles = null;
	var walletAddress = null;

	// -- Helpers --

	function $( id ) {
		return document.getElementById( id );
	}

	function setStatus( elementId, message, type ) {
		var el = $( elementId );
		el.textContent = message;
		el.className = 'uc-status' + ( type ? ' uc-status-' + type : '' );
	}

	function showStep( stepId ) {
		document.querySelectorAll( '.uc-step' ).forEach( function ( el ) {
			el.classList.remove( 'uc-step-active' );
		} );
		$( stepId ).classList.add( 'uc-step-active' );
	}

	/**
	 * Sign a message with the connected wallet and return auth headers.
	 */
	async function getAuthHeaders() {
		var timestamp = Date.now();
		var message = 'Authorize Blue Railroad pinning\nTimestamp: ' + timestamp;

		try {
			var signature = await window.ethereum.request( {
				method: 'personal_sign',
				params: [ message, walletAddress ]
			} );
			return {
				'X-Signature': signature,
				'X-Timestamp': timestamp.toString()
			};
		} catch ( err ) {
			throw new Error( 'Wallet signature rejected: ' + err.message );
		}
	}

	/**
	 * Format bytes to human-readable size.
	 */
	function formatSize( bytes ) {
		var units = [ 'B', 'KB', 'MB', 'GB' ];
		var size = bytes;
		var i = 0;
		while ( size >= 1024 && i < units.length - 1 ) {
			size /= 1024;
			i++;
		}
		return size.toFixed( 1 ) + ' ' + units[ i ];
	}

	/**
	 * Format duration in seconds to mm:ss.
	 */
	function formatDuration( seconds ) {
		if ( !seconds ) {
			return '';
		}
		var m = Math.floor( seconds / 60 );
		var s = Math.floor( seconds % 60 );
		return m + ':' + ( s < 10 ? '0' : '' ) + s;
	}

	// -- Step 1: Wallet Connection --

	function initWalletStep() {
		var connectBtn = $( 'uc-connect-wallet' );

		connectBtn.addEventListener( 'click', async function () {
			if ( !window.ethereum ) {
				setStatus( 'uc-wallet-status', 'No Ethereum wallet detected. Please install MetaMask.', 'error' );
				return;
			}

			try {
				connectBtn.disabled = true;
				setStatus( 'uc-wallet-status', 'Requesting wallet connection...', '' );

				var accounts = await window.ethereum.request( {
					method: 'eth_requestAccounts'
				} );

				if ( accounts.length === 0 ) {
					setStatus( 'uc-wallet-status', 'No accounts available.', 'error' );
					connectBtn.disabled = false;
					return;
				}

				walletAddress = accounts[ 0 ];
				setStatus( 'uc-wallet-status',
					'Connected: ' + walletAddress.slice( 0, 6 ) + '...' + walletAddress.slice( -4 ),
					'success'
				);
				connectBtn.textContent = 'Connected';

				// Advance to upload step
				showStep( 'uc-step-upload' );

			} catch ( err ) {
				setStatus( 'uc-wallet-status', 'Connection failed: ' + err.message, 'error' );
				connectBtn.disabled = false;
			}
		} );
	}

	// -- Step 2: File Upload --

	function initUploadStep() {
		var dropzone = $( 'uc-dropzone' );
		var fileInput = $( 'uc-file-input' );
		var fileList = $( 'uc-file-list' );
		var uploadBtn = $( 'uc-upload-btn' );
		var selectedFiles = [];

		dropzone.addEventListener( 'click', function () {
			fileInput.click();
		} );

		dropzone.addEventListener( 'dragover', function ( e ) {
			e.preventDefault();
			dropzone.classList.add( 'uc-dropzone-active' );
		} );

		dropzone.addEventListener( 'dragleave', function () {
			dropzone.classList.remove( 'uc-dropzone-active' );
		} );

		dropzone.addEventListener( 'drop', function ( e ) {
			e.preventDefault();
			dropzone.classList.remove( 'uc-dropzone-active' );
			addFiles( e.dataTransfer.files );
		} );

		fileInput.addEventListener( 'change', function () {
			addFiles( fileInput.files );
			fileInput.value = '';
		} );

		function addFiles( newFiles ) {
			for ( var i = 0; i < newFiles.length; i++ ) {
				selectedFiles.push( newFiles[ i ] );
			}
			renderFileList();
		}

		function renderFileList() {
			fileList.innerHTML = '';
			selectedFiles.forEach( function ( file, idx ) {
				var item = document.createElement( 'div' );
				item.className = 'uc-file-item';
				item.innerHTML =
					'<span class="uc-file-name">' + mw.html.escape( file.name ) + '</span>' +
					'<span class="uc-file-size">' + formatSize( file.size ) + '</span>' +
					'<button class="uc-file-remove" data-idx="' + idx + '">&times;</button>';
				fileList.appendChild( item );
			} );

			// Bind remove buttons
			fileList.querySelectorAll( '.uc-file-remove' ).forEach( function ( btn ) {
				btn.addEventListener( 'click', function () {
					selectedFiles.splice( parseInt( btn.dataset.idx ), 1 );
					renderFileList();
				} );
			} );

			uploadBtn.disabled = selectedFiles.length === 0;
		}

		uploadBtn.addEventListener( 'click', async function () {
			if ( selectedFiles.length === 0 ) {
				return;
			}

			try {
				uploadBtn.disabled = true;
				setStatus( 'uc-upload-status', 'Signing authorization...', '' );

				var headers = await getAuthHeaders();

				setStatus( 'uc-upload-status', 'Uploading ' + selectedFiles.length + ' file(s)...', '' );

				var formData = new FormData();
				selectedFiles.forEach( function ( file ) {
					formData.append( 'files', file );
				} );

				var resp = await fetch( DELIVERY_KID_URL + '/draft-content', {
					method: 'POST',
					headers: headers,
					body: formData
				} );

				if ( !resp.ok ) {
					var err = await resp.json().catch( function () {
						return { detail: resp.statusText };
					} );
					throw new Error( err.detail || 'Upload failed' );
				}

				var draft = await resp.json();
				currentDraftId = draft.draft_id;
				currentDraftFiles = draft.files;

				setStatus( 'uc-upload-status', 'Draft created: ' + currentDraftId.slice( 0, 8 ) + '...', 'success' );

				// Advance to review
				renderReviewStep( draft );
				showStep( 'uc-step-review' );

			} catch ( err ) {
				setStatus( 'uc-upload-status', 'Upload failed: ' + err.message, 'error' );
				uploadBtn.disabled = false;
			}
		} );
	}

	// -- Step 3: Review & Metadata --

	function renderReviewStep( draft ) {
		var info = $( 'uc-draft-info' );
		var html = '<table class="wikitable">';
		html += '<tr><th>File</th><th>Type</th><th>Format</th><th>Duration</th><th>Size</th></tr>';

		draft.files.forEach( function ( f ) {
			html += '<tr>';
			html += '<td>' + mw.html.escape( f.original_filename ) + '</td>';
			html += '<td>' + mw.html.escape( f.media_type ) + '</td>';
			html += '<td>' + mw.html.escape( f.format ) + '</td>';
			html += '<td>' + formatDuration( f.duration_seconds ) + '</td>';
			html += '<td>' + formatSize( f.size_bytes ) + '</td>';
			html += '</tr>';

			// Show extra details for video/audio
			if ( f.width && f.height ) {
				html += '<tr><td></td><td colspan="4">' + f.width + 'x' + f.height;
				if ( f.video_codec ) {
					html += ' &middot; ' + mw.html.escape( f.video_codec );
				}
				if ( f.audio_codec ) {
					html += ' &middot; ' + mw.html.escape( f.audio_codec );
				}
				html += '</td></tr>';
			}
		} );

		html += '</table>';
		html += '<p class="uc-draft-expires">Draft expires: ' +
			new Date( draft.expires_at ).toLocaleString() + '</p>';

		info.innerHTML = html;

		// Pre-fill title from first file if only one
		if ( draft.files.length === 1 && draft.files[ 0 ].detected_title ) {
			$( 'uc-title' ).value = draft.files[ 0 ].detected_title;
		}

		// Show HLS option only if there's a video file
		var hasVideo = draft.files.some( function ( f ) {
			return f.media_type === 'video';
		} );
		$( 'uc-transcode-hls' ).parentElement.parentElement.style.display = hasVideo ? '' : 'none';
	}

	function initReviewStep() {
		$( 'uc-finalize-btn' ).addEventListener( 'click', async function () {
			await startFinalization();
		} );

		$( 'uc-delete-draft-btn' ).addEventListener( 'click', async function () {
			if ( !currentDraftId ) {
				return;
			}
			if ( !confirm( 'Delete this draft? This cannot be undone.' ) ) {
				return;
			}

			try {
				var headers = await getAuthHeaders();
				await fetch( DELIVERY_KID_URL + '/draft-content/' + currentDraftId, {
					method: 'DELETE',
					headers: headers
				} );
				currentDraftId = null;
				currentDraftFiles = null;
				showStep( 'uc-step-upload' );
				setStatus( 'uc-upload-status', 'Draft deleted.', '' );
			} catch ( err ) {
				setStatus( 'uc-progress-status', 'Delete failed: ' + err.message, 'error' );
			}
		} );
	}

	// -- Step 4: Finalization --

	async function startFinalization() {
		if ( !currentDraftId ) {
			return;
		}

		showStep( 'uc-step-progress' );
		setProgress( 0 );
		setStatus( 'uc-progress-status', 'Starting finalization...', '' );

		try {
			var headers = await getAuthHeaders();
			headers[ 'Content-Type' ] = 'application/json';

			var body = {
				title: $( 'uc-title' ).value || null,
				description: $( 'uc-description' ).value || null,
				file_type: $( 'uc-file-type' ).value || null,
				subsequent_to: $( 'uc-subsequent-to' ).value || null,
				transcode_hls: $( 'uc-transcode-hls' ).checked,
				metadata: {}
			};

			var resp = await fetch(
				DELIVERY_KID_URL + '/draft-content/' + currentDraftId + '/finalize',
				{
					method: 'POST',
					headers: headers,
					body: JSON.stringify( body )
				}
			);

			if ( !resp.ok ) {
				var err = await resp.json().catch( function () {
					return { detail: resp.statusText };
				} );
				throw new Error( err.detail || 'Finalization failed' );
			}

			// Read SSE stream
			var reader = resp.body.getReader();
			var decoder = new TextDecoder();
			var buffer = '';

			while ( true ) {
				var result = await reader.read();
				if ( result.done ) {
					break;
				}

				buffer += decoder.decode( result.value, { stream: true } );
				var lines = buffer.split( '\n' );
				buffer = lines.pop(); // Keep incomplete line in buffer

				var currentEvent = '';
				for ( var i = 0; i < lines.length; i++ ) {
					var line = lines[ i ].trim();
					if ( line.startsWith( 'event:' ) ) {
						currentEvent = line.slice( 6 ).trim();
					} else if ( line.startsWith( 'data:' ) ) {
						var data = line.slice( 5 ).trim();
						try {
							handleSSEEvent( currentEvent, JSON.parse( data ) );
						} catch ( e ) {
							// Skip malformed data
						}
					}
				}
			}
		} catch ( err ) {
			setStatus( 'uc-progress-status', 'Error: ' + err.message, 'error' );
		}
	}

	function handleSSEEvent( event, data ) {
		if ( event === 'progress' ) {
			setProgress( data.progress || 0 );
			setStatus( 'uc-progress-status', data.message || '', '' );

		} else if ( event === 'complete' ) {
			setProgress( 100 );
			setStatus( 'uc-progress-status', 'Pinning complete!', 'success' );
			renderResult( data );
			currentDraftId = null;

		} else if ( event === 'error' ) {
			setStatus( 'uc-progress-status', 'Error: ' + ( data.message || 'Unknown error' ), 'error' );
		}
	}

	function setProgress( pct ) {
		var fill = document.querySelector( '#uc-progress-bar .uc-progress-fill' );
		if ( fill ) {
			fill.style.width = pct + '%';
		}
	}

	function renderResult( data ) {
		var resultEl = $( 'uc-result' );
		var releaseUrl = mw.util.getUrl( 'Release:' + data.cid );

		var html = '<div class="uc-result-card">';
		html += '<h4>Content Pinned Successfully</h4>';
		html += '<table class="wikitable">';
		if ( data.title ) {
			html += '<tr><th>Title</th><td>' + mw.html.escape( data.title ) + '</td></tr>';
		}
		html += '<tr><th>CID</th><td class="release-cid-cell">' + mw.html.escape( data.cid ) + '</td></tr>';
		html += '<tr><th>Gateway</th><td><a href="' + mw.html.escape( data.gateway_url ) +
			'" target="_blank">' + mw.html.escape( data.gateway_url ) + '</a></td></tr>';
		html += '<tr><th>Pinata</th><td>' + ( data.pinata ? 'Yes' : 'No' ) + '</td></tr>';
		if ( data.subsequent_to ) {
			html += '<tr><th>Supersedes</th><td>' + mw.html.escape( data.subsequent_to ) + '</td></tr>';
		}
		html += '</table>';
		html += '<p><a href="' + mw.html.escape( releaseUrl ) +
			'" class="cdx-button cdx-button--action-progressive">View Release Page</a></p>';
		html += '<button id="uc-start-over" class="cdx-button">Upload More Content</button>';
		html += '</div>';

		resultEl.innerHTML = html;

		$( 'uc-start-over' ).addEventListener( 'click', function () {
			resultEl.innerHTML = '';
			showStep( 'uc-step-upload' );
		} );
	}

	// -- Init --

	function init() {
		if ( !DELIVERY_KID_URL ) {
			document.querySelector( '.uc-step' ).innerHTML =
				'<p class="uc-status uc-status-error">Delivery Kid URL not configured. Set $wgDeliveryKidUrl in LocalSettings.php.</p>';
			return;
		}

		initWalletStep();
		initUploadStep();
		initReviewStep();
	}

	mw.loader.using( 'mediawiki.util' ).then( init );

}() );
