/**
 * Deliver Video — direct upload to delivery-kid from browser.
 *
 * After upload+analysis, creates a ReleaseDraft wiki page (type: video)
 * with venue/performers metadata and redirects there.
 * The ReleaseDraft namespace handles review, metadata editing, and finalization.
 */
( function () {
	'use strict';

	var API_URL = mw.config.get( 'wgDeliveryKidUrl' );
	var AUTH_HEADERS = {
		'X-Upload-Token': mw.config.get( 'wgUploadToken' ),
		'X-Upload-User': mw.config.get( 'wgUploadUser' ),
		'X-Upload-Timestamp': String( mw.config.get( 'wgUploadTimestamp' ) )
	};

	// -- Helpers --

	function el( id ) {
		return document.getElementById( id );
	}

	function setStatus( elementId, message, type ) {
		var e = el( elementId );
		e.textContent = message;
		e.className = 'uc-status' + ( type ? ' uc-status-' + type : '' );
	}

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

	function quote( val ) {
		if ( val === '' || val === null || val === undefined ) {
			return '""';
		}
		val = String( val );
		if ( /[:#\[\]{}&*!|>'"%@`\n]/.test( val ) || val.trim() !== val ) {
			return '"' + val.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' ).replace( /\n/g, '\\n' ) + '"';
		}
		return val;
	}

	// -- File Upload --

	function initUploadStep() {
		var dropzone = el( 'dv-dropzone' );
		var fileInput = el( 'dv-file-input' );
		var fileList = el( 'dv-file-list' );
		var uploadBtn = el( 'dv-upload-btn' );
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

			fileList.querySelectorAll( '.uc-file-remove' ).forEach( function ( btn ) {
				btn.addEventListener( 'click', function () {
					selectedFiles.splice( parseInt( btn.dataset.idx ), 1 );
					renderFileList();
				} );
			} );

			uploadBtn.disabled = selectedFiles.length === 0;
		}

		uploadBtn.addEventListener( 'click', function () {
			if ( selectedFiles.length === 0 ) {
				return;
			}
			doUpload( selectedFiles );
		} );
	}

	function doUpload( files ) {
		var uploadBtn = el( 'dv-upload-btn' );
		var progressBar = el( 'dv-upload-progress' );
		var progressFill = progressBar.querySelector( '.uc-progress-fill' );

		uploadBtn.disabled = true;
		progressBar.style.display = '';
		setStatus( 'dv-upload-status', 'Uploading ' + files.length + ' file(s)...', '' );

		var formData = new FormData();
		files.forEach( function ( file ) {
			formData.append( 'files', file );
		} );

		var xhr = new XMLHttpRequest();
		xhr.open( 'POST', API_URL + '/draft-content' );

		// Set auth headers
		Object.keys( AUTH_HEADERS ).forEach( function ( key ) {
			xhr.setRequestHeader( key, AUTH_HEADERS[ key ] );
		} );

		xhr.upload.addEventListener( 'progress', function ( e ) {
			if ( e.lengthComputable ) {
				var pct = Math.round( ( e.loaded / e.total ) * 100 );
				progressFill.style.width = pct + '%';
				setStatus( 'dv-upload-status',
					'Uploading... ' + formatSize( e.loaded ) + ' / ' + formatSize( e.total ) +
					' (' + pct + '%)', '' );
			}
		} );

		xhr.addEventListener( 'load', function () {
			progressBar.style.display = 'none';

			if ( xhr.status !== 200 ) {
				var errMsg;
				try {
					var err = JSON.parse( xhr.responseText );
					var detail = err.detail;
					if ( typeof detail === 'string' ) {
						errMsg = detail;
					} else if ( detail && detail.error ) {
						errMsg = detail.error;
					} else if ( Array.isArray( detail ) ) {
						errMsg = detail.map( function ( d ) { return d.msg || JSON.stringify( d ); } ).join( '; ' );
					} else {
						errMsg = JSON.stringify( err );
					}
				} catch ( e ) {
					errMsg = xhr.status + ' ' + xhr.statusText + ': ' + xhr.responseText.slice( 0, 200 );
				}
				setStatus( 'dv-upload-status',
					'Upload failed (' + xhr.status + '): ' + errMsg, 'error' );
				uploadBtn.disabled = false;
				return;
			}

			var draft = JSON.parse( xhr.responseText );
			setStatus( 'dv-upload-status',
				'Draft created. ' + draft.files.length + ' file(s) analyzed. Creating draft page...', 'success' );

			createReleaseDraftPage( draft );
		} );

		xhr.addEventListener( 'error', function () {
			progressBar.style.display = 'none';
			setStatus( 'dv-upload-status', 'Network error during upload.', 'error' );
			uploadBtn.disabled = false;
		} );

		xhr.send( formData );
	}

	// -- Create ReleaseDraft wiki page and redirect --

	function createReleaseDraftPage( draft ) {
		var draftId = draft.draft_id;
		var pageName = 'ReleaseDraft:' + draftId;

		var yaml = buildVideoYaml( draftId, draft );

		var api = new mw.Api();
		api.postWithEditToken( {
			action: 'edit',
			title: pageName,
			text: yaml,
			summary: 'New video draft: ' + draft.files.length + ' file(s) uploaded',
			createonly: true
		} ).then( function () {
			window.location.href = mw.util.getUrl( pageName );
		} ).fail( function ( code, result ) {
			if ( code === 'articleexists' ) {
				window.location.href = mw.util.getUrl( pageName );
			} else {
				setStatus( 'dv-upload-status',
					'Failed to create draft page: ' + ( result.error ? result.error.info : code ), 'error' );
				el( 'dv-upload-btn' ).disabled = false;
			}
		} );
	}

	function buildVideoYaml( draftId, draft ) {
		// Collect metadata from form fields
		var title = ( el( 'dv-title' ) || {} ).value || '';
		var venue = ( el( 'dv-venue' ) || {} ).value || '';
		var performersRaw = ( el( 'dv-performers' ) || {} ).value || '';
		var description = ( el( 'dv-description' ) || {} ).value || '';

		var performers = performersRaw.split( ',' ).map( function ( s ) {
			return s.trim();
		} ).filter( function ( s ) {
			return s.length > 0;
		} );

		var lines = [];
		lines.push( 'draft_id: ' + draftId );
		lines.push( 'type: video' );
		lines.push( 'source: special-deliver-video' );
		lines.push( 'commit: ' + ( draft.commit || 'unknown' ) );
		lines.push( 'uploader: ' + quote( mw.config.get( 'wgUploadUser' ) || '' ) );
		lines.push( 'blockheight: null' );
		lines.push( 'content:' );
		lines.push( '    title: ' + quote( title ) );
		lines.push( '    description: ' + quote( description ) );
		lines.push( '    file_type: ""' );
		lines.push( '    venue: ' + quote( venue ) );
		lines.push( '    performers:' );
		performers.forEach( function ( p ) {
			lines.push( '        - ' + quote( p ) );
		} );

		lines.push( 'files:' );
		( draft.files || [] ).forEach( function ( f ) {
			lines.push( '    -' );
			lines.push( '        original_filename: ' + quote( f.original_filename ) );
			lines.push( '        media_type: ' + quote( f.media_type || '' ) );
			lines.push( '        format: ' + quote( f.format || '' ) );
			if ( f.duration_seconds ) {
				lines.push( '        duration_seconds: ' + f.duration_seconds );
			}
			if ( f.width ) {
				lines.push( '        width: ' + f.width );
			}
			if ( f.height ) {
				lines.push( '        height: ' + f.height );
			}
			if ( f.video_codec ) {
				lines.push( '        video_codec: ' + quote( f.video_codec ) );
			}
			if ( f.audio_codec ) {
				lines.push( '        audio_codec: ' + quote( f.audio_codec ) );
			}
			if ( f.size_bytes ) {
				lines.push( '        size_bytes: ' + f.size_bytes );
			}
		} );

		return lines.join( '\n' ) + '\n';
	}

	// -- Init --

	function init() {
		if ( !API_URL ) {
			el( 'dv-step-upload' ).innerHTML =
				'<p class="uc-status uc-status-error">Delivery Kid URL not configured.</p>';
			return;
		}

		initUploadStep();
	}

	mw.loader.using( [ 'mediawiki.util', 'mediawiki.api' ] ).then( init );

}() );
