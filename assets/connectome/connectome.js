/*
 * The connectome's big graph, drawn (index.html). connectome-core.js says what a view holds and where each
 * thing sits; this puts it on the page, moves it when the view changes, and answers the pointer.
 *
 * Three views, and a click never leaves them (Justin, #connectome, 13 Nov 2026, 23:05Z):
 *
 *   one picker      their company around them. A click on any picker goes to that picker: the picture slides
 *                   until they're in the middle, those who were in sight and belong stay, the line the reader
 *                   came down stays lit with what it is said on it, and the rest of their company comes in.
 *   two pickers     what they share along the middle, and who both have played with between them.
 *   one piece       a click on a piece of music turns the graph inside out: the music is the circles now, and
 *                   the pickers are the lines, each named on its line, leading to what else they're on.
 *
 * The marks: a circle is whatever the view is made of (pickers: solid with a page, open without one yet, the
 * rabbit whose company you're in; or pieces: a ring with a show, a record or a track in it); a rounded pill is
 * music on a line between pickers; a square tag is a picker on a line between pieces. Gold is a Permanent
 * Release, on a line or round a circle; plain ink a Full Release; dotted what's only counted. A green rabbit
 * beside a track's name plays it in Rabbithole.
 *
 * The ways out to a wiki page are always said as that: "page ↗" by the headline, an arrow beside a name in a
 * list, a button on a finger's sheet. A name itself goes to that picker or that piece, here.
 *
 * The web (Justin, #connectome, 14 Nov 2026): round one picker, or one piece, the lines among those around them
 * are drawn too where the frame has room, thin and behind the rest: who of the company have played with each
 * other, which of the pieces share pickers. Without room they wait for a pointer or a finger on one of them.
 *
 * A step further (Justin, #connectome, 14 Nov 2026, 02:18Z): with more room still, each of a picker's company has
 * their own way on drawn straight out from them, directly away from the picker in the middle, to a couple of
 * pickers they have played with and the one in the middle hasn't, one of them named. A click on one goes to them,
 * and the way there stays drawn.
 *
 * what() says what any mark stands for and the ways on from it; a pointer gets that as a note and a click, a
 * finger as a sheet of buttons. A thing that is in two views running keeps its place or slides to its new one,
 * whatever its shape in each: a pill that becomes a circle grows from where the pill was.
 *
 * Every string from graph.json reaches the page as text, never as markup.
 */
import * as K from './connectome-core.js';

const NS = 'http://www.w3.org/2000/svg';
const HOME = /(^|\.)pickipedia\.xyz$/.test( location.hostname ) ? '' : 'https://pickipedia.xyz';
const ICON = HOME + '/index.php?title=Special:Redirect/file/Instrument-icon-';
const FACE = HOME + '/index.php?title=Special:Redirect/file/';       // a picker's own picture, by its file's name on the wiki
const FONT = { named: '700 14px Georgia, "Times New Roman", serif', subject: '700 17px Georgia, "Times New Roman", serif',
	far: '400 13px Georgia, "Times New Roman", serif', bead: '400 11px Georgia, "Times New Roman", serif',
	pill: '600 12.5px system-ui, -apple-system, "Segoe UI", sans-serif', tag: '700 12.5px Georgia, "Times New Roman", serif',
	piece: '600 13px system-ui, -apple-system, "Segoe UI", sans-serif', sub: '400 11.5px system-ui, -apple-system, "Segoe UI", sans-serif',
	road: 'italic 400 12px Georgia, "Times New Roman", serif' };
const still = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
const FAINT = 0.22;              // between two pickers, a route through someone not named: behind the rest, still there
const STRAIGHT = { x: 0, y: 0 };
const coarse = window.matchMedia && window.matchMedia( '(pointer: coarse)' ).matches;   // a finger: bigger beads, further apart
const narrow = () => window.matchMedia( '(max-width: 760px)' ).matches;                 // the list is under the graph

const $ = ( id ) => document.getElementById( id );
const svg = $( 'g' ), stage = $( 'stage' ), tip = $( 'tip' ), panel = $( 'panel' ), sheet = $( 'sheet' );

let G = null;
let RAW = null;                   // graph.json as read: what a kept graph is cut from
let KEPT = null;                  // a kept graph in sight: { id, doc, kept, live, since, edited } (keptSay, below)
// The view: { a } one picker and their company; { a, b } two pickers and what's between; { m } one piece of music
// and where its pickers lead. With it, what the reader came by, so it stays in sight: keep (pickers, or pieces),
// hand (the pickers a piece was reached by), by (the piece a picker was reached by).
let view = null;
let sel = { picker: null };
let scene = null;
let listed = null;               // the view the list was last drawn for: its scroll is kept until the view changes
let was = new Map();             // where each thing in sight is, by what it stands for, as the view changes
let fingers = false;             // the last pointer down was a finger or a pen: nothing hovers, so a touch asks before it acts
let held = null;                 // the mark whose sheet is open
const alone = window.parent === window;   // a page of its own, not the graph over a wiki page: its steps are the browser's too
// Inside Rabbithole, as its "Your rabbithole" (Justin, #connectome, 15 Nov 2026): the player says what has been on,
// and the graph asks it to play, to open a page in its pane, to open the drawer. MINI: the few steps the dock has
// room for, until the drawer opens.
const HOST = new URLSearchParams( location.search ).get( 'host' ) === 'rabbithole' && !alone ? 'rabbithole' : '';
let MINI = new URLSearchParams( location.search ).get( 'walk' ) === 'mini';
const trail = [];
let GAME = null;                 // the challenge in play: { to, from, par, jumps, path, done, won } (challenge(), below)
const SIX = 6;                   // the jumps a challenge is won in, at most (Justin, #connectome, 19 Nov 2026)

/* ------------------------------------------------------------------------------------------------------------
 * Small tools
 * --------------------------------------------------------------------------------------------------------- */

function s( name, attrs, ...kids ) {
	const e = document.createElementNS( NS, name );
	for ( const k in attrs || {} ) {
		if ( attrs[ k ] !== null && attrs[ k ] !== undefined && attrs[ k ] !== false ) {
			e.setAttribute( k, attrs[ k ] );
		}
	}
	kids.forEach( ( c ) => e.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c ) );
	return e;
}

function h( tag, props, ...kids ) {
	const e = document.createElement( tag );
	for ( const k in props || {} ) {
		const v = props[ k ];
		if ( v === null || v === undefined || v === false ) {
			continue;
		}
		if ( k === 'class' ) {
			e.className = v;
		} else if ( k.slice( 0, 2 ) === 'on' ) {
			e.addEventListener( k.slice( 2 ), v );
		} else {
			e.setAttribute( k, v );
		}
	}
	kids.flat( Infinity ).forEach( ( c ) => {
		if ( c !== null && c !== undefined && c !== false ) {
			e.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
		}
	} );
	return e;
}

const pen = document.createElement( 'canvas' ).getContext( '2d' );
function wide( text, font ) {
	pen.font = font;
	return pen.measureText( text ).width;
}

/** A name, cut short until it fits in `room` pixels. */
function cut( name, font, room ) {
	let label = K.clip( name, 26 );
	for ( let n = label.length - 1; wide( label, font ) > room && n > 4; n-- ) {
		label = K.clip( name, n );
	}
	return label;
}

/** A name centred on x, kept between lo and hi: what to write, and how far off centre to write it. */
function fitName( name, x, lo, hi, font ) {
	const label = cut( name, font, hi - lo );
	return { label, dx: Math.round( K.nudge( x, wide( label, font ) / 2, lo, hi ) ) };
}

/**
 * A name by a place on the oval: centred on it, or leaning outward as far as the place says (K.ego: the web's
 * lines leave a picker along the oval and inward, never outward), and kept in the frame.
 */
function nameAt( name, pos, W, font ) {
	const lean = ( pos.lean || 0 ) * ( wide( K.clip( name, 26 ), font ) / 2 + 3 );
	const fit = fitName( name, pos.x + lean, 4, W - 4, font );
	return { label: fit.label, dx: Math.round( lean ) + fit.dx };
}

/** Where a name is, in the frame: `half` its width either side of its middle, from `top` to `bottom` off its place. */
function nameBox( pos, dx, half, top, bottom ) {
	return { x1: pos.x + dx - half, x2: pos.x + dx + half, y1: pos.y + top, y2: pos.y + bottom };
}

function pageUrl( title ) {
	return HOME + '/wiki/' + encodeURIComponent( title.replace( / /g, '_' ) ).replace( /%2F/g, '/' ).replace( /%3A/g, ':' );
}

function wikiUrl( path ) {
	return path && path[ 0 ] === '/' ? HOME + path : path;
}

const P = ( id ) => G.people[ id ];
const first = ( id ) => P( id ).name;
const instOf = ( id ) => P( id ).inst ? ' · ' + P( id ).inst : '';
const lineKey = ( u, v ) => 'l' + Math.min( u, v ) + '-' + Math.max( u, v );
const M = ( id ) => G.pieces[ id ];
const threadKey = ( x, y ) => 't' + Math.min( x, y ) + '-' + Math.max( x, y );

/** A few names, and how many more. */
function listNames( ids ) {
	return ids.slice( 0, 3 ).map( first ).join( ', ' ) + ( ids.length > 3 ? ` and ${ ids.length - 3 } more` : '' );
}

/** A view's address: what the bar shows, and what a link to somewhere in the graph points at. */
function address( v ) {
	const raw = rawAddress( v );
	if ( ! HOST ) {
		return raw;
	}
	// Inside Rabbithole, every step carries who it is, so a frame that reloads on an address comes back
	// hosted (a pushed step lives in the browser's history, and a reload can land on any of them).
	const q = new URLSearchParams( raw.slice( 1 ) );
	q.set( 'host', HOST );
	return '?' + q;
}

function rawAddress( v ) {
	if ( v.way ) {
		return '?' + new URLSearchParams( { p: first( GAME.to ) } );           // the way found ends where it ended
	}
	if ( v.walk ) {
		return '?' + new URLSearchParams( Object.assign( { walk: MINI ? 'mini' : '' }, HOST ? { host: HOST } : null ) );
	}
	if ( v.pg !== undefined ) {
		return '?' + new URLSearchParams( { page: v.pg } );
	}
	if ( v.playing !== undefined ) {
		return '?' + new URLSearchParams( { p: first( v.a ), playing: v.playing } );
	}
	if ( v.cut !== undefined ) {
		return '?' + new URLSearchParams( v.s !== undefined ? { s: v.s, cut: v.cut } : { cut: v.cut } );
	}
	if ( v.s !== undefined ) {
		return '?' + new URLSearchParams( { s: v.s } );
	}
	if ( v.m !== undefined ) {
		const pc = M( v.m );
		return '?' + new URLSearchParams( Object.assign( { m: G.music[ pc.m ].key }, pc.song ? { s: pc.song } : null ) );
	}
	if ( v.b === undefined ) {
		const q = { p: first( v.a ) };
		if ( ( v.keep || [] ).length ) {
			q.keep = v.keep.map( ( x ) => first( x ) ).join( ',' );
		}
		const by = v.by !== undefined && v.by !== null ? M( v.by ) : null;   // the piece come by: a show, a record, or one track of a record
		if ( by ) {
			q.by = G.music[ by.m ].key;                                   // (a track's number is not a record's: read as one, this threw, and the address stayed behind)
			if ( by.song ) {
				q.on = by.song;
			}
		}
		if ( v.via !== undefined && v.via !== null ) {
			q.via = v.via;
		}
		if ( v.turn ) {
			q.turn = v.turn;
		}
		return '?' + new URLSearchParams( q );
	}
	return '?' + new URLSearchParams( { a: first( v.a ), b: first( v.b ) } );
}

/** The view an address asks for; null when it names nothing the graph knows. (?from= and ?to= are read as a and b.) */
function parse( q ) {
	if ( q.has( 'walk' ) ) {
		return { walk: true };                                       // your rabbithole: the songs heard in Rabbithole, and who was followed
	}
	const pg = q.get( 'page' );                                  // a page's own graph: the pickers it links ({{Bacon graph of this page}})
	if ( pg && G.pages && G.pages[ pg ] ) {
		return { pg };
	}
	const m = q.get( 'm' ) ? K.findPiece( G, q.get( 'm' ), q.get( 's' ) ) : null;
	if ( m !== null ) {
		return { m };
	}
	// Rabbithole's traverse (Justin, #connectome, 18 Nov 2026): a picker taking a solo, the song on now beside them.
	// A soloist the graph doesn't know (a name it has under another, a guest): the song stays, in its own view.
	const playing = q.get( 'playing' );
	if ( playing && G.songcast && G.songcast[ playing ] ) {
		const p = K.find( G, q.get( 'p' ) || q.get( 'a' ) );
		return p !== null ? { a: p, playing } : { s: G.songcast[ playing ].song, cut: playing };
	}
	const s = q.get( 's' );                                      // a song, by name: its cut's cast (the song card's explore)
	const cut = q.get( 'cut' );                                  // a cut, by its cid: its own graph (Justin, #connectome, 01:58Z)
	if ( cut && G.songcast && G.songcast[ cut ] && ( !s || G.songcast[ cut ].song === s ) ) {
		return { s: G.songcast[ cut ].song, cut };
	}
	if ( s && G.songcast ) {
		const mine = Object.entries( G.songcast ).filter( ( [ , c ] ) => c.song === s );
		if ( mine.length ) {
			const played = G.plays[ s ] && mine.some( ( [ k ] ) => k === G.plays[ s ] ) ? G.plays[ s ] : mine[ 0 ][ 0 ];
			return { s, cut: played };
		}
	}
	const a = K.find( G, q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' ) ), b = K.find( G, q.get( 'b' ) || q.get( 'to' ) );
	if ( a === null ) {
		return null;
	}
	if ( b === null || b === a ) {
		// The way the reader came (Justin, #connectome, 13 Nov 2026): who they passed, and on what.
		const keep = ( q.get( 'keep' ) || '' ).split( ',' ).map( ( n ) => K.find( G, n ) ).filter( ( x ) => x !== null && x !== a );
		const byRaw = q.get( 'by' );
		const by = byRaw ? K.findPiece( G, byRaw, q.get( 'on' ) ) : undefined;
		const via = q.get( 'via' ), turn = parseInt( q.get( 'turn' ) || '', 10 );
		return { a, keep, by: by === null ? undefined : by, via: via || undefined, turn: turn > 0 ? turn : undefined };
	}
	return { a, b };
}

/** A plain click on a link to somewhere in the graph goes there without leaving; any other kind of click is the browser's. */
function inApp( ev, run ) {
	if ( ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button ) {
		return;
	}
	ev.preventDefault();
	run();
}

function glyph( kind ) {
	if ( kind === 'track' ) {
		return s( 'g', { class: 'gl' }, s( 'circle', { class: 'f', cx: -2, cy: 3.6, r: 2.7 } ),
			s( 'path', { d: 'M0.4 3.6V-5.2L4.6 -3.4' } ) );
	}
	if ( kind === 'record' ) {
		return s( 'g', { class: 'gl' }, s( 'circle', { r: 5.6 } ), s( 'circle', { class: 'f', r: 1.5 } ) );
	}
	return s( 'g', { class: 'gl' }, s( 'rect', { x: -6.8, y: -4.6, width: 13.6, height: 9.2, rx: 1.8 } ),
		s( 'circle', { cx: -2.9, cy: 0, r: 1.5 } ), s( 'circle', { cx: 2.9, cy: 0, r: 1.5 } ) );
}

function glyphBox( kind ) {
	const g = glyph( kind );
	g.setAttribute( 'transform', 'translate(9 9)' );
	return s( 'svg', { width: 18, height: 18, 'aria-hidden': 'true' }, g );
}

/* ------------------------------------------------------------------------------------------------------------
 * A view, as a scene: which pickers, lines and pills, and where
 * --------------------------------------------------------------------------------------------------------- */

/**
 * The frame a view is laid out in, and drawn into. A page zoomed in lays it out as if it were bigger and draws it
 * that much smaller (K.shrink), so a zoomed page shows what a page less zoomed in did (K.drawnAs). The dock, the walk
 * (own: its height is the walk's own), and a finger's screen keep their own pixels.
 */
let S = 1;                                                          // how many times smaller the drawing is than the frame's pixels
function frame( own ) {
	const cw = svg.clientWidth, ch = svg.clientHeight;
	S = MINI || own || coarse ? 1 : K.shrink( cw, ch, zoomed(), CLOSER[ closer ] );
	const W = Math.max( MINI ? 200 : 300, Math.round( cw * S ) ), H = Math.max( MINI ? 120 : 240, Math.round( ch * S ) );   // the dock's few steps: its own size
	svg.setAttribute( 'viewBox', `0 0 ${ W } ${ H }` );
	return { W, H };
}

/**
 * Closer in on the graph itself, the page staying as it is (Justin, #connectome, 17 Nov 2026: "a way to scroll-zoom
 * around the graph without also zooming the entire page"): the wheel over the graph draws it bigger or smaller, a step
 * at a time, and lays it out afresh each time, so the middle stays in the middle and the whole constellation in sight
 * (18 Nov: "I want the zoom to always keep the center in the center, and always keep the whole constellation on
 * screen"). It counts as the page's zoom does (K.drawnAs): bigger shows less, but not as much less. CLOSER: the steps,
 * as many times closer; closer: which step. It stays as it is from one view to the next, as the page's zoom does.
 */
const CLOSER = [ 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3 ];
let closer = 0;

/**
 * How far the page is zoomed in, as near as a page can tell: the window's size against the page's, the narrower
 * of the two ways (a sidebar or a docked inspector makes the other look zoomed). Over a wiki page, the wiki
 * page's window; a frame on another site can't see that, and says 1, as does a browser that doesn't tell.
 */
const LEAST_RATIO = 'bacon-least-pixel-ratio';                    // Firefox's least pixel ratio here, for K.foxZoom
function zoomed() {
	let w = window;
	if ( !alone ) {
		try {
			w = window.top;
			void w.innerWidth;
		} catch ( e ) {
			return 1;
		}
	}
	let z = Math.min( w.outerWidth / w.innerWidth, w.outerHeight / w.innerHeight );
	// Firefox gives the window's size in the page's own pixels, zoomed with it, so that says 1 at any zoom (Justin
	// didn't see the change, 17 Nov 2026: Firefox on Ubuntu). There it's read from the pixel ratio (K.foxZoom).
	if ( 'mozInnerScreenX' in w ) {
		let least = 0;
		try {
			least = +localStorage.getItem( LEAST_RATIO ) || 0;
		} catch ( e ) {}
		const fox = K.foxZoom( w.devicePixelRatio || 1, least );
		if ( fox.least !== least ) {
			try {
				localStorage.setItem( LEAST_RATIO, String( fox.least ) );
			} catch ( e ) {}
		}
		z = Math.max( Number.isFinite( z ) ? z : 1, fox.zoom );
	}
	return Number.isFinite( z ) && z > 1 ? z : 1;
}

function lineWidth( tie ) {
	return Math.max( 1.6, Math.min( 7, 1.6 + 2.1 * Math.sqrt( tie.w || 0.1 * tie.loose ) ) );
}

function dotRadius( w ) {
	return Math.max( coarse ? 4.6 : 3.2, Math.min( 8, 3.2 + 2.6 * Math.sqrt( w ) ) );
}

function newScene() {
	return { nodes: new Map(), lines: new Map(), pills: new Map(), head: '', sub: [] };
}

function addNode( sc, id, at, kind, more ) {
	sc.nodes.set( 'p' + id, Object.assign( { id, stands: 'picker', is: 'p' + id, x: at.x, y: at.y, kind, below: kind === 'subject' ? true : !!at.below, o: 1 }, more ) );
}

/**
 * Names for a view's beads, small, beside each where there's room: clear of the lines (pts) and of every name and
 * circle already set down (boxes), the strongest of the company first. all: name every bead, a crowded one straight
 * out from the middle all the same (the challenge).
 */
function nameBeads( sc, C, pts, boxes, W, H, all ) {
	const beads = [ ...sc.nodes.values() ].filter( ( d ) => d.stands === 'picker' && d.kind === 'dot' );
	for ( const d of beads ) {                                       // their circles first: no name is set down on one
		boxes.push( { x1: d.x - d.r - 2, y1: d.y - d.r - 2, x2: d.x + d.r + 2, y2: d.y + d.r + 2 } );
	}
	for ( const d of beads ) {
		const label = cut( first( d.id ), FONT.bead, 130 ), w = wide( label, FONT.bead );
		let b = K.beside( d, d.r + 2, w, 12, pts, boxes, { W, H }, { x: d.x - C.x, y: d.y - C.y } );
		if ( !b && all ) {
			const t = Math.atan2( d.y - C.y, d.x - C.x ), cx = Math.cos( t ), side = Math.abs( cx ) > 0.4;
			const x = side ? Math.sign( cx ) * ( d.r + 4 ) : 0, y = side ? 4 : ( Math.sin( t ) > 0 ? d.r + 12 : -d.r - 5 );
			const anchor = side ? ( cx > 0 ? 'start' : 'end' ) : 'middle';
			const x1 = d.x + x - ( anchor === 'start' ? 0 : anchor === 'end' ? w : w / 2 );
			b = { x, y, anchor, box: { x1, y1: d.y + y - 10, x2: x1 + w, y2: d.y + y + 3 } };
		}
		if ( b ) {
			d.label = label;
			d.at = { x: b.x, y: b.y, anchor: b.anchor };
			boxes.push( b.box );
		}
	}
}

/** Room for the two ends' names: beside each picker when the frame is wide, under it when it isn't. */
function endNames( a, b, W ) {
	const wa = wide( K.clip( first( a ), 26 ), FONT.subject ), wb = wide( K.clip( first( b ), 26 ), FONT.subject );
	const beside = W >= 700 && wa + wb + 2 * 46 < W * 0.5;
	return beside ? { la: wa + 34, lb: wb + 34, sa: 'left', sb: 'right' } :
		{ la: Math.min( wa / 2, 64 ), lb: Math.min( wb / 2, 64 ), sa: null, sb: null };
}

/** The two ends, set down: a name under its picker is kept to its own half of the frame, cut short if it must be. */
function addEnds( sc, a, b, lay, en, W ) {
	const beads = ( lay.dots || [] ).filter( ( p ) => p.y > lay.A.y ).map( ( p ) => Math.abs( p.x - W / 2 ) + 16 );
	const clear = Math.max( 20, ...beads );                         // the beads just under the middle line: the names stop short of them
	const na = en.sa ? {} : fitName( first( a ), lay.A.x, 6, W / 2 - clear, FONT.subject );
	const nb = en.sb ? {} : fitName( first( b ), lay.B.x, W / 2 + clear, W - 6, FONT.subject );
	addNode( sc, a, lay.A, 'subject', { rabbit: true, side: en.sa, label: na.label, dx: na.dx } );
	addNode( sc, b, lay.B, 'subject', { side: en.sb, label: nb.label, dx: nb.dx } );
}

function addLine( sc, u, v, tie, more ) {
	sc.lines.set( lineKey( u, v ), Object.assign( { a: 'p' + u, b: 'p' + v, u, v, tie, stands: 'tie', w: lineWidth( tie ), o: 1 }, more ) );
}

/** The best of what a tie holds, as pills that fit in `room` pixels; and how many more there are. */
function pillsFor( tie, room, most, prefer, entry ) {
	const shown = [];
	let used = 0;
	const worth = tie.ev.filter( ( e ) => e.how >= K.STAGE && G.music[ e.m ].tier >= K.FULL );
	let pool = worth.length ? worth : tie.ev.slice( 0, 1 );        // nothing named up front: still say the one thing
	// `entry`: the one to say, as fresh() chose it, its song first
	const came = entry || ( prefer === undefined ? null : ( tie.ev.find( ( e ) => K.pieceFor( G, e ) === prefer ) || tie.ev.find( ( e ) => e.m === M( prefer ).m ) ) );
	if ( came ) {                                                 // the piece the reader came by is the one to say
		pool = [ came ].concat( pool.filter( ( e ) => e.m !== came.m ) );
	}
	for ( const e of pool ) {
		if ( shown.length >= most ) {
			break;
		}
		const n = K.naming( G, e );
		const play = n.glyph === 'track' ? K.playOf( G, G.music[ e.m ], e.songs[ 0 ] ) : '';
		const pad = 34 + ( play ? 38 : 0 );                           // the glyph and the ends; and the way into Rabbithole
		let label = K.clip( n.short, 34 );
		let w = pad + wide( label, FONT.pill );
		if ( used + w > room && !shown.length ) {                     // the first one always goes in: briefer, then cut to fit
			label = n.brief;
			// a show keeps its night and gives up some of its name
			const cutTo = ( k ) => ( n.day ? K.clip( n.who, k ) + ' · ' + n.day : K.clip( n.brief, k ) );
			for ( let most = n.day ? n.who.length : label.length; pad + wide( label, FONT.pill ) > room && most > 6; most-- ) {
				label = cutTo( most );
			}
			w = pad + wide( label, FONT.pill );
		}
		if ( used + w > room && shown.length ) {
			break;
		}
		shown.push( { e, label, w, glyph: n.glyph, tier: G.music[ e.m ].tier, play, song: e.songs[ 0 ] } );
		used += w + 8;
	}
	return { shown, more: tie.ev.length - shown.length, used: Math.max( 0, used - 8 ) };
}

function placePills( sc, u, v, tie, x1, x2, y, most, o, delay, prefer, more, entry ) {
	const room = Math.abs( x2 - x1 );
	const fit = pillsFor( tie, room - ( most > 1 ? 52 : 0 ), most, prefer, entry );
	const moreW = fit.more > 0 && most > 1 ? 16 + wide( '+' + fit.more + ' more', FONT.pill ) : 0;
	let x = ( x1 + x2 ) / 2 - ( fit.used + ( moreW ? moreW + 8 : 0 ) ) / 2;
	for ( const p of fit.shown ) {
		const piece = K.pieceFor( G, p.e );
		sc.pills.set( 'm' + lineKey( u, v ) + '.' + p.e.m, Object.assign( { stands: 'piece', piece, is: 'm' + piece, x: x + p.w / 2, y, w: p.w, label: p.label,
			glyph: p.glyph, tier: p.tier, e: p.e, u, v, o, delay, play: p.play, song: p.song }, more ) );
		x += p.w + 8;
	}
	if ( moreW ) {
		sc.pills.set( 'm' + lineKey( u, v ) + '.more', { stands: 'piece', x: x + moreW / 2, y, w: moreW, label: '+' + fit.more + ' more', more: true,
			u, v, o, delay } );
	}
}

function curveMid( pa, pb, viaY ) {
	const cx = ( pa.x + pb.x ) / 2;
	return { x: 0.25 * pa.x + 0.5 * cx + 0.25 * pb.x, y: 0.25 * pa.y + 0.5 * viaY + 0.25 * pb.y };
}

function pairScene( a, b ) {
	const { W, H } = frame();
	const sc = newScene();
	const tie = G.adj[ a ].get( b ) || null;
	const all = K.mutuals( G, a, b );
	const played = all.filter( ( m ) => m.played );
	if ( !tie && !all.length ) {
		return ladderScene( a, b, W, H, sc );
	}
	const needLoose = !played.length && !( tie && tie.played );      // only looser ties join them: show those
	let pool = played.length ? played : ( needLoose ? all : [] );
	const want = Math.min( pool.length, tie ? ( H > 500 ? 6 : 4 ) : ( H > 500 ? 5 : 3 ) );
	const en = endNames( a, b, W );
	const lay = K.bridge( { W, H, direct: !!tie, named: want, dots: pool.length - want, la: en.la, lb: en.lb,
		gap: coarse ? 27 : 18, perRow: coarse ? Math.max( 3, Math.min( 7, Math.floor( ( W - 250 ) / 27 ) ) ) : 7 } );
	const placed = lay.named.length + lay.dots.length;
	const at = pool.findIndex( ( m ) => m.id === sel.picker );
	if ( at >= placed ) {                                             // picked from the list, beyond what's drawn
		pool = pool.slice();
		pool.splice( Math.max( 0, lay.named.length - 1 ), 0, pool.splice( at, 1 )[ 0 ] );
	} else if ( sel.picker !== null && at < 0 ) {
		sel.picker = null;
	}
	const lit = sel.picker !== null ? sel.picker : ( tie ? null : ( pool[ 0 ] ? pool[ 0 ].id : null ) );

	addEnds( sc, a, b, lay, en, W );
	if ( tie ) {
		addLine( sc, a, b, tie, { o: lit === null ? 1 : 0.5, role: 'direct', emph: true, w: Math.max( 4.5, lineWidth( tie ) ) } );
		placePills( sc, a, b, tie, lay.A.x + 48, lay.B.x - 48, lay.band.y, W > 900 ? 3 : ( W > 620 ? 2 : 1 ), lit === null ? 1 : 0.45, 140 );
	}
	pool.slice( 0, placed ).forEach( ( m, i ) => {
		const named = i < lay.named.length;
		const pos = named ? lay.named[ i ] : lay.dots[ i - lay.named.length ];
		const on = lit === m.id;
		const picked = sel.picker !== null;
		addNode( sc, m.id, pos, named ? 'named' : 'dot', Object.assign( { r: dotRadius( m.w ), lit: on, delay: named ? 120 + i * 45 : 330,
			o: !picked || on || !named ? 1 : 0.55, m }, named ? fitName( first( m.id ), pos.x, 4, W - 4, FONT.named ) : null ) );
		const o = on ? 1 : ( named ? ( picked ? 0.28 : 0.9 ) : ( picked ? FAINT / 2 : FAINT ) );
		const leg = { via: 'p' + m.id, o, quiet: !named && !on, emph: on, delay: named ? 160 + i * 45 : 360, role: 'leg', c: m.id };
		addLine( sc, a, m.id, m.ta, leg );
		addLine( sc, m.id, b, m.tb, leg );
		if ( on && W >= 560 ) {
			const ma = curveMid( lay.A, pos, pos.y ), mb = curveMid( pos, lay.B, pos.y );
			const half = ( pos.x - lay.A.x ) - 44;
			placePills( sc, a, m.id, m.ta, ma.x - half / 2, ma.x + half / 2, ma.y, 1, 1, 60 );
			placePills( sc, m.id, b, m.tb, mb.x - half / 2, mb.x + half / 2, mb.y, 1, 1, 60 );
		}
	} );

	sc.pool = pool;
	sc.tie = tie;
	sc.lit = lit;
	sc.loose = needLoose;
	sc.head = [ nameLink( a ), ' and ', nameLink( b ) ];
	const both = played.length;
	if ( tie && tie.played ) {
		sc.sub = [ h( 'b', null, K.together( tie ) ) ];
	} else if ( tie ) {
		sc.sub = [ K.together( tie ) ];
	} else {
		sc.sub = [ 'Never on one stage or one track, so far as the sources here say' ];
	}
	const through = sel.picker !== null && pool.find( ( m ) => m.id === sel.picker );
	if ( through ) {
		sc.sub = [ h( 'b', null, 'By way of ' + first( through.id ) ), `: ${ K.times( through.ta ) } with ${ first( a ) }, ${ K.times( through.tb ) } with ${ first( b ) }` ];
	} else if ( both ) {
		sc.sub.push( ' · ', h( 'b', null, K.plural( both, 'picker' ) ), both === 1 ? ' has played with both' : ' have played with both' );
	} else if ( needLoose && all.length ) {
		sc.sub.push( ' · ', K.plural( all.length, 'picker' ), ' on a record with each' );
	}
	return sc;
}

function ladderScene( a, b, W, H, sc ) {
	const r = K.routes( G, a, b, H > 520 ? 3 : 2 );
	const en = endNames( a, b, W );
	sc.head = [ nameLink( a ), ' and ', nameLink( b ) ];
	if ( !r ) {
		const lay = K.ladder( { W, H, hops: 1, chains: 1, la: en.la, lb: en.lb } );
		addEnds( sc, a, b, lay, en, W );
		sc.sub = [ 'No way between them yet: nobody the sources here know has played with someone who has, all the way across.' ];
		sc.none = true;
		return sc;
	}
	const lay = K.ladder( { W, H, hops: r.hops, chains: r.chains.length, la: en.la, lb: en.lb } );
	let on = r.chains.findIndex( ( c ) => c.includes( sel.picker ) );
	if ( on < 0 ) {
		on = 0;
		sel.picker = null;
	}
	if ( lay.upright ) {                                             // a phone: a at the top, b at the bottom, names beside
		addNode( sc, a, lay.A, 'subject', { rabbit: true, side: 'right', label: cut( first( a ), FONT.subject, W - lay.A.x - 42 ) } );
		addNode( sc, b, lay.B, 'subject', { side: 'right', label: cut( first( b ), FONT.subject, W - lay.B.x - 42 ) } );
	} else {
		addEnds( sc, a, b, lay, en, W );
	}
	const room = ( lay.B.x - lay.A.x ) / r.hops - 10;               // a hop's width: a name on the ladder keeps to its own rung
	r.chains.forEach( ( chain, c ) => {
		const row = c === on ? 0 : ( c < on ? c + 1 : c );          // the lit chain takes the middle row
		chain.forEach( ( id, level ) => {
			if ( level > 0 && level < r.hops && lay.upright ) {     // the lit chain named, beside; the others as beads
				const at = lay.at( row, level );
				addNode( sc, id, at, c === on ? 'named' : 'dot', c === on ?
					{ lit: true, side: 'right', label: cut( first( id ), FONT.named, W - at.x - 30 ), delay: 120, chain: c } :
					{ r: 6, o: 0.8, delay: 120 + c * 60, chain: c } );
			} else if ( level > 0 && level < r.hops ) {
				const at = lay.at( row, level );
				addNode( sc, id, Object.assign( at, { below: row === 0 || row % 2 === 0 } ), 'named',
					Object.assign( { lit: c === on, o: c === on ? 1 : 0.6, delay: 120 + c * 60, chain: c },
						fitName( first( id ), at.x, Math.max( 4, at.x - room / 2 ), Math.min( W - 4, at.x + room / 2 ), FONT.named ) ) );
			}
		} );
	} );
	r.chains.forEach( ( chain, c ) => {
		for ( let i = 0; i < chain.length - 1; i++ ) {
			const u = chain[ i ], v = chain[ i + 1 ];
			const tie = G.adj[ u ].get( v );
			const pu = sc.nodes.get( 'p' + u ), pv = sc.nodes.get( 'p' + v );
			const prev = sc.lines.get( lineKey( u, v ) );
			if ( prev && prev.o >= ( c === on ? 1 : 0.2 ) ) {
				continue;
			}
			addLine( sc, u, v, tie, { o: c === on ? 1 : 0.3, emph: c === on, role: 'hop', c: i === 0 ? v : u, delay: 160 + c * 60 } );
			if ( c === on ) {
				const span = lay.upright ? Math.min( 230, W - 2 * Math.abs( W / 2 - pu.x ) - 16 ) : Math.abs( pv.x - pu.x ) - 44;
				placePills( sc, u, v, tie, ( pu.x + pv.x ) / 2 - span / 2, ( pu.x + pv.x ) / 2 + span / 2, ( pu.y + pv.y ) / 2, 1, 1, 200 );
			}
		}
	} );
	sc.chain = r.chains[ on ];
	sc.routes = r;
	sc.sub = [ h( 'b', null, K.plural( r.hops, 'hop' ) + ' apart' ), ': never on one stage or one track, so far as the sources here say' ];
	return sc;
}

/** How far the picture slides, when what's becoming the middle is already in sight. */
function slide( is, C ) {
	const w = was.get( is );
	return w ? { x: C.x - w.x, y: C.y - w.y } : { x: 0, y: 0 };
}

/** Where something in sight would be if the whole picture slid as one; null when it isn't in sight. */
function wanted( is, pan ) {
	const w = was.get( is );
	return w ? { x: w.x + pan.x, y: w.y + pan.y } : null;
}

/**
 * How plain a line of the web is, by how far apart round the oval its two ends sit: neighbours' lines run along
 * the rim and cross nothing; the further apart, the more a line crosses, and the quieter it lies. All of them are
 * there, and each is plain when either end is pointed at.
 */
const WEB = [ 0, 0.52, 0.34, 0.17 ];
const webShade = ( bow, plain ) => ( plain ? 0.85 : WEB[ Math.min( bow.apart, WEB.length - 1 ) ] );

/**
 * A step further out, where the frame has room for it (K.ego's far): who each of the company leads on to, set
 * straight out from them, and with that where everything else in the view goes. The lines are set down first;
 * then each name where no line runs through it (K.beside); then, of the places a bead might go, those still clear.
 *
 * mine: the company round the middle; seatOf: where each sits; seats: which of lay's places that is; web: the
 * lines among them. Returns { names: for each of mine, { label, at } (at: where the text goes, from the circle);
 * fars: [{ id, tie, by, at, named, name }], those a step further; open: the places left for the rest of the company }.
 */
function further( v, lay, mine, seats, seatOf, web, W, H ) {
	const pts = [], discs = [], labels = [];
	const line = ( p, q, bow ) => pts.push( ...K.along( p, q, bow ) );
	const disc = ( p, r ) => discs.push( { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r } );
	const place = ( name, at, r, font, high, most ) => {
		const label = cut( name, font, most );
		const b = K.beside( at, r, wide( label, font ), high, pts, discs.concat( labels ), { W, H }, { x: at.x - lay.C.x, y: at.y - lay.C.y } );
		if ( b ) {
			labels.push( b.box );
		}
		return b ? { label, at: { x: b.x, y: b.y, anchor: b.anchor } } : null;
	};
	const clear = ( l, of, pad ) => K.clearOf( l, of, pad ).length === l.length;
	const on = K.beyond( G, v.a, mine.map( ( c ) => c.id ), 2, v.keep || [] ), fars = [];
	disc( lay.C, 26 );
	const mid = wide( cut( first( v.a ), FONT.subject, Math.min( 240, W - 24 ) ), FONT.subject ) / 2;
	discs.push( { x1: lay.C.x - mid, y1: lay.C.y + 22, x2: lay.C.x + mid, y2: lay.C.y + 41 } );   // the middle's own name, tucked under it
	mine.forEach( ( c, i ) => {
		const from = seatOf.get( c.id );
		line( lay.C, from );
		disc( from, 15 );
		if ( on[ i ][ 0 ] ) {                                        // the first of theirs: straight on, and named
			const at = lay.far[ seats[ i ] ].main;
			fars.push( Object.assign( { at, named: true }, on[ i ][ 0 ] ) );
			line( from, at );
			disc( at, 8 );
		}
	} );
	web.forEach( ( t ) => line( seatOf.get( t.u ), seatOf.get( t.v ), t.bow ) );
	const names = mine.map( ( c ) => place( first( c.id ), seatOf.get( c.id ), 14, FONT.named, 16, 150 ) ||
		nameAt( first( c.id ), seatOf.get( c.id ), W, FONT.named ) );
	mine.forEach( ( c, i ) => {                                      // the second: a bead, to whichever side its line keeps clear of the names
		if ( !on[ i ][ 1 ] ) {
			return;
		}
		const from = seatOf.get( c.id ), sides = lay.far[ seats[ i ] ].sides;
		const at = ( seats[ i ] % 2 ? [ sides[ 1 ], sides[ 0 ] ] : sides ).find( ( p ) => clear( K.along( from, p ).slice( 6 ), discs.concat( labels ), 5 ) );
		if ( at ) {
			fars.push( Object.assign( { at, named: false }, on[ i ][ 1 ] ) );
			line( from, at );
			disc( at, 6 );
		}
	} );
	for ( const f of fars ) {
		f.name = f.named ? place( first( f.id ), f.at, 6, FONT.far, 15, 132 ) : null;
		f.named = !!f.name;                                          // no room for the name: a bead, and the note says who
	}
	// The rest of the company: where nothing else is, and where the thin line to it from the middle crosses no name.
	const open = K.away( K.clearOf( lay.dots, discs.concat( labels ), 9 ), pts, 11 ).filter( ( p ) => clear( K.along( lay.C, p ), labels, 4 ) );
	return { names, fars, open, pts, boxes: discs.concat( labels ) };
}

function egoScene( v ) {
	const a = v.a;
	const { W, H } = frame();
	const sc = newScene();
	let comp = K.company( G, a );
	const looseOnly = !comp.length;
	if ( looseOnly ) {
		comp = K.company( G, a, true );
	}
	// Those the reader came by stay, whatever their rank, and the line to each says what it is; then the closest,
	// two at most by any one record or show while there are others to name (Justin, #connectome, 15 Nov 2026).
	// In a challenge, the goal one step away stays named among them too, never left for "others" (Justin,
	// #connectome, 19 Nov 2026, 03:21Z: "if you get to the penultimate node (ie, a picker who is one away from the
	// goal), then the goal _needs_ to be displayed, and in the big six that are nearest").
	const came = new Set( ( v.keep || [] ).filter( ( k ) => G.adj[ a ].has( k ) ) );
	const goal = GAME && !GAME.done && GAME.to !== a && G.adj[ a ].has( GAME.to ) && !came.has( GAME.to ) ? GAME.to : undefined;
	const pinned = ( c ) => came.has( c.id ) || c.id === goal;
	const queue = K.keeping( G, a, comp, goal === undefined ? v.keep : ( v.keep || [] ).concat( goal ) );
	const kept = K.fewPer( G, queue, 2, queue.filter( pinned ).length );
	const want = Math.min( kept.length, H > 560 && W > 700 ? 8 : ( W > 460 || H > 500 ? 6 : 4 ) );
	// another turn of the company, where there are more than one view names; those the reader came by stay, and the goal
	const stay = kept.filter( pinned ).length;
	const ring = K.turned( kept, stay, Math.max( 1, want - stay ), v.turn || 0 );
	const lay = K.ego( { W, H, named: want, dots: ring.length - want, far: true } );
	// Rabbithole's traverse (Justin, #connectome, 18 Nov 2026: "I want the solos to traverse to the picker, but
	// ensuring that the song still remains very visible; as big as the picker"): the one taking the solo in the
	// middle, and the song in the ring's top seat, drawn as the song's own view draws it in its middle. Going from
	// the song's view to here, the soloist moves into the middle and the song up to the top.
	const playing = v.playing !== undefined && G.songcast ? G.songcast[ v.playing ] : null;
	let songAt = null;
	if ( playing && lay.named.length > 1 ) {
		const top = lay.named.reduce( ( best, p, i ) => ( p.y < lay.named[ best ].y ? i : best ), 0 );
		songAt = lay.named[ top ];
		lay.named = lay.named.filter( ( _, i ) => i !== top );
		if ( lay.far ) {
			lay.far = lay.far.filter( ( _, i ) => i !== top );
		}
	}
	const n = lay.named.length, mine = ring.slice( 0, n );
	const pan = slide( 'p' + a, lay.C );
	const seats = K.seat( lay.named, mine.map( ( c ) => wanted( 'p' + c.id, pan ) ) );
	const seatOf = new Map( mine.map( ( c, i ) => [ c.id, lay.named[ seats[ i ] ] ] ) );
	// The web: who of the company have played with each other.
	const web = K.among( G, [ ...seatOf.keys() ], looseOnly ).map( ( t ) => Object.assign( t, { bow: K.arc( lay, seatOf.get( t.u ), seatOf.get( t.v ) ) } ) );
	// A step further, where there's room: then it says where the names and the beads go, since there are lines out as well as in.
	const out = lay.far ? further( v, lay, mine, seats, seatOf, web, W, H ) : null;
	// Each name as it will be written, so no bead is set down under one, however long it is or far it leans.
	const names = out ? out.names : mine.map( ( c, i ) => nameAt( first( c.id ), lay.named[ seats[ i ] ], W, FONT.named ) );
	const spots = out ? K.spread( out.open, ring.length - n ) : K.clearOf( lay.dots, names.map( ( nm, i ) => {
		const pos = lay.named[ seats[ i ] ];
		return nameBox( pos, nm.dx, wide( nm.label, FONT.named ) / 2, pos.below ? 18 : -36, pos.below ? 36 : -18 );
	} ), 10 );
	const shown = n + spots.length;
	const beads = K.seat( spots, ring.slice( n, shown ).map( ( c ) => wanted( 'p' + c.id, pan ) ) );
	// Where the line the reader came by says what it is: a little past halfway out, or further, until its band
	// is clear of the middle's own name (Justin, #connectome, 15 Nov 2026: a label never on the middle's name).
	const midBox = ( () => {
		const half = wide( cut( first( a ), FONT.subject, Math.min( 240, W - 24 ) ), FONT.subject ) / 2;
		const R = G.people[ a ].img ? 26 : 22, base = lay.C.y + R + 10;        // as draw.node sets the subject's name
		return { x1: lay.C.x - half - 4, y1: base - 16, x2: lay.C.x + half + 4, y2: base + 6 };
	} )();
	const homeward = ( pos, room ) => {
		let at;
		for ( const f of [ 0.54, 0.62, 0.7, 0.78, 0.86 ] ) {
			at = { x: lay.C.x + ( pos.x - lay.C.x ) * f, y: lay.C.y + ( pos.y - lay.C.y ) * f };
			if ( at.x + room / 2 < midBox.x1 || at.x - room / 2 > midBox.x2 || at.y + 13 < midBox.y1 || at.y - 13 > midBox.y2 ) {
				break;
			}
		}
		return at;
	};
	// The one in the middle is named there too, as on the cards, though the headline says who it is (Justin, #connectome, 15 Nov 2026).
	addNode( sc, a, lay.C, 'subject', { rabbit: true, label: cut( first( a ), FONT.subject, Math.min( 240, W - 24 ) ) } );
	if ( songAt ) {                                                  // the song on now, and the line from it to who's taking it
		const cuts = ( playing.on || [] ).map( ( m ) => G.music[ m ] ).filter( Boolean );
		const tier = cuts.length ? Math.max( ...cuts.map( ( c ) => c.tier ) ) : 0;
		sc.nodes.set( 'song', { stands: 'song', is: 'song', x: songAt.x, y: songAt.y, kind: 'song', o: 1, title: playing.song, tier,
			cuts: [ cuts[ 0 ] ].filter( Boolean ), cut: v.playing, above: true } );
		sc.lines.set( 'sp' + a, { a: 'song', b: 'p' + a, u: -1, v: a, tie: { played: true, tier, w: 1 }, stands: 'tie',
			w: lineWidth( { w: 1 } ), o: 1, role: 'spoke', c: a, quiet: true, delay: 120 } );
	}
	ring.slice( 0, shown ).forEach( ( c, i ) => {
		const named = i < n;
		const pos = named ? lay.named[ seats[ i ] ] : spots[ beads[ i - n ] ];
		const by = named && came.has( c.id );
		addNode( sc, c.id, pos, named ? 'named' : 'dot',
			Object.assign( { r: dotRadius( c.tie.w ), delay: named ? 80 + i * 40 : 300, tie: c.tie }, named ? names[ i ] : null ) );
		// With a step further in sight, the rest of the company are on thin lines from the middle, as on the cards:
		// then every dot says how it is reached. Without, their lines wait for a pointer.
		addLine( sc, a, c.id, c.tie, { o: named ? ( by ? 1 : 0.9 ) : ( out ? FAINT : 0 ), quiet: !named, fine: !named && !!out, emph: by,
			delay: named ? 120 + i * 40 : 300, role: 'spoke', c: c.id } );
		if ( by ) {                                                  // the line the reader came down: what it is, said on it
			const len = Math.hypot( pos.x - lay.C.x, pos.y - lay.C.y ), room = Math.max( 92, Math.min( 190, len - 64 ) );
			const at = homeward( pos, room );
			placePills( sc, a, c.id, c.tie, at.x - room / 2, at.x + room / 2, at.y, 1, 1, 0, v.by );
		}
	} );
	// The route home, said once and said straight (Justin, #connectome, 15 Nov 2026, 04:53Z): the cut's own
	// song on the line to the first one the reader passed — the record's artist, when they're not who this
	// is — with its way into Rabbithole where the cut has one. Not the tie's guess: what the page states.
	const home = G.songcast ? G.songcast[ v.via ] : null;
	if ( home && v.keep && v.keep.length ) {
		const homeId = v.keep[ 0 ] !== a && seatOf.get( v.keep[ 0 ] ) ? v.keep[ 0 ] : ( v.keep[ 1 ] !== a && seatOf.get( v.keep[ 1 ] ) ? v.keep[ 1 ] : null );
		const rec = ( home.on || [] )[ 0 ];
		if ( homeId !== null && rec !== undefined ) {
			const pos = seatOf.get( homeId ), len = Math.hypot( pos.x - lay.C.x, pos.y - lay.C.y );
			const room = Math.max( 92, Math.min( 190, len - 64 ) );
			const at = homeward( pos, room );
			placePills( sc, a, homeId, { ev: [ { m: rec, how: K.TRACK, songs: [ home.song ] } ] },
				at.x - room / 2, at.x + room / 2, at.y, 1, 1, 0, undefined );
		}
	}
	// A line says what it is wherever there's room for it to (Justin, #connectome, 15 Nov 2026: "almost always
	// label lines"): the first thing the two share, by what comes first (K.standing). Where there isn't room, and
	// on the lines to those further off, it's said when the far end is pointed at or touched.
	const said = new Set( [ ...sc.pills.values() ].map( ( p ) => lineKey( p.u, p.v ) ) );
	const taken = [ ...sc.pills.values() ].map( ( p ) => ( { x1: p.x - p.w / 2, y1: p.y - 12, x2: p.x + p.w / 2, y2: p.y + 12 } ) )
		.concat( [ { x1: lay.C.x - 30, y1: lay.C.y - 30, x2: lay.C.x + 30, y2: lay.C.y + 30 } ],
			mine.map( ( c ) => seatOf.get( c.id ) ).map( ( p ) => ( { x1: p.x - 17, y1: p.y - 17, x2: p.x + 17, y2: p.y + 17 } ) ) );
	const midName = wide( cut( first( a ), FONT.subject, Math.min( 240, W - 24 ) ), FONT.subject ) / 2;
	taken.push( { x1: lay.C.x - midName, y1: lay.C.y + 22, x2: lay.C.x + midName, y2: lay.C.y + 41 } );
	if ( songAt ) {                                                  // the song's mark and its name over it
		const half = Math.max( 34, wide( K.clip( playing.song, 30 ), FONT.named ) / 2 );
		taken.push( { x1: songAt.x - half, y1: songAt.y - 54, x2: songAt.x + half, y2: songAt.y + 34 } );
	}
	const onLine = ( from, to, f, room ) => ( { x1: from.x + ( to.x - from.x ) * f - room / 2, x2: from.x + ( to.x - from.x ) * f + room / 2, y: from.y + ( to.y - from.y ) * f } );
	// Who is named in sight: a line that says a song ends at its artist or its writer, or at another of its ensemble
	// only with them in sight (K.mayEnd; Justin, #connectome, 15 Nov 2026, 07:29Z).
	const seen = new Set( [ a, ...mine.map( ( c ) => c.id ), ...( out ? out.fars.filter( ( f ) => f.named ).map( ( f ) => f.id ) : [] ) ] );
	const whisper = ( u, id, tie, from, to, f, say ) => {           // said only when the far end is pointed at
		const room = Math.min( 200, W * 0.32 ), clearOf = ( b ) => b.x + 70 < midBox.x1 || b.x - 70 > midBox.x2 ||
			b.y + 13 < midBox.y1 || b.y - 13 > midBox.y2;
		// along the line either way, until clear of the middle's own name; nowhere clear, where it was
		const g = [ f, f + 0.08, f - 0.08, f + 0.16, f - 0.16, f + 0.24, f - 0.24 ].filter( ( x ) => x > 0.12 && x < 0.92 )
			.find( ( x ) => clearOf( { x: from.x + ( to.x - from.x ) * x, y: from.y + ( to.y - from.y ) * x } ) );
		const at = onLine( from, to, g === undefined ? f : g, room );
		placePills( sc, u, id, tie, at.x1, at.x2, at.y, 1, 0, 0, undefined, { shy: true, owner: 'p' + id, is: undefined }, say ? say.e : undefined );
	};
	// Of the things two share that come first alike, a line says one no other line here has said yet: eight
	// lines that all say "August" say less than eight that say what else there is.
	// Each song or show is said on one line only (Justin, #connectome, 15 Nov 2026): of two who share ten songs of
	// a record, the line says one no other line has, not the first by the alphabet; a line with nothing left
	// unsaid says it only when its far end is pointed at.
	const heard = new Set( [ ...sc.pills.values() ].map( ( p ) => p.piece ) );
	// a line first says what its far end was named by (fewPer's `by`), so two lines by one record or show at most;
	// and a song only where it may end at them (K.mayEnd)
	const fresh = ( tie, by, end ) => {
		for ( const say of K.sayings( G, tie, by ) ) {
			if ( !heard.has( say.piece ) && K.mayEnd( G, say.piece, end, seen ) ) {
				return say;
			}
		}
		return undefined;
	};
	ring.slice( 0, shown ).forEach( ( c, i ) => {
		const pos = i < n ? seatOf.get( c.id ) : spots[ beads[ i - n ] ], len = Math.hypot( pos.x - lay.C.x, pos.y - lay.C.y );
		if ( said.has( lineKey( a, c.id ) ) ) {
			return;
		}
		// A label lies across its line, not along it: it may be wider than the line is long, if nothing else is there.
		const room = Math.min( out ? 150 : 190, W * 0.3 ), say = fresh( c.tie, c.by, c.id ), fit = say ? pillsFor( c.tie, room, 1, say.piece, say.e ) : { shown: [] };
		const w = fit.shown.length ? fit.shown[ 0 ].w : 0;
		const f = say && i < n && w && W >= 560 && len >= 120 ? [ 0.56, 0.47, 0.65, 0.4, 0.72, 0.34 ].find( ( t ) => {
			const x = lay.C.x + ( pos.x - lay.C.x ) * t, y = lay.C.y + ( pos.y - lay.C.y ) * t;
			return !taken.some( ( b ) => x - w / 2 < b.x2 + 2 && b.x1 < x + w / 2 + 2 && y - 12 < b.y2 + 2 && b.y1 < y + 12 + 2 );
		} ) : undefined;
		if ( f === undefined ) {
			whisper( a, c.id, c.tie, lay.C, pos, 0.58, K.lineSays( G, c.tie, c.id, seen, c.by ) );
			return;
		}
		const at = onLine( lay.C, pos, f, room );
		placePills( sc, a, c.id, c.tie, at.x1, at.x2, at.y, 1, 1, 200 + i * 40, say.piece, undefined, say.e );
		heard.add( say.piece );
		taken.push( { x1: ( at.x1 + at.x2 ) / 2 - w / 2, y1: at.y - 12, x2: ( at.x1 + at.x2 ) / 2 + w / 2, y2: at.y + 12 } );
	} );
	for ( const f of out ? out.fars : [] ) {
		whisper( f.by, f.id, f.tie, seatOf.get( f.by ), f.at, 0.5, f.say );
	}
	// Between two the reader came by, a line of the web is the way they came, and stays as plain as it was.
	for ( const t of web ) {
		sc.lines.set( lineKey( t.u, t.v ), { a: 'p' + t.u, b: 'p' + t.v, u: t.u, v: t.v, tie: t.tie, stands: 'tie', role: 'web', quiet: true,
			w: lineWidth( t.tie ), o: lay.web ? webShade( t.bow, came.has( t.u ) && came.has( t.v ) ) : 0, bow: t.bow, delay: 300 } );
	}
	// A step further: each on a line straight out from the one they're reached by. The way the reader came, on
	// out past the one they came by, is as plain as it was.
	for ( const f of out ? out.fars : [] ) {
		const walked = came.has( f.by ) && ( v.keep || [] ).includes( f.id );
		addNode( sc, f.id, f.at, f.named ? 'far' : 'dot', Object.assign( { r: 3.8, by: f.by, tie: f.tie, delay: 360 }, f.name ) );
		// a line a step out answers a click with the two-hop view, middle and far end (Justin, #connectome, 15 Nov 2026)
		addLine( sc, f.by, f.id, f.tie, { o: walked ? 0.95 : ( f.named ? 0.78 : 0.45 ), role: 'far', c: f.id, delay: 360 } );
	}
	// The beads named too, small (Justin, #connectome, 17 Nov 2026: "In the challenge mode, I think every dot needs
	// to be labeled, even the tiny ones. Otherwise the game turns into a game of hover-over-the-dot-to-see ... in
	// general, I think it makes sense to put small labels on many more dots, even outside challenge mode (maybe not
	// on mobile)"): where a name has room beside its bead, clear of the lines and of every other name; in a
	// challenge every bead, the crowded ones straight out; on a finger's screen only in a challenge.
	if ( GAME || !( coarse || narrow() ) ) {
		let pts, boxes;
		if ( out ) {
			( { pts, boxes } = out );
		} else {
			pts = [];
			boxes = [ { x1: lay.C.x - 26, y1: lay.C.y - 26, x2: lay.C.x + 26, y2: lay.C.y + 26 }, midBox ];
			mine.forEach( ( c, i ) => {
				const pos = lay.named[ seats[ i ] ], nm = names[ i ];
				pts.push( ...K.along( lay.C, pos ) );
				boxes.push( { x1: pos.x - 15, y1: pos.y - 15, x2: pos.x + 15, y2: pos.y + 15 },
					nameBox( pos, nm.dx || 0, wide( nm.label, FONT.named ) / 2, pos.below ? 18 : -36, pos.below ? 36 : -18 ) );
			} );
			web.forEach( ( t ) => pts.push( ...K.along( seatOf.get( t.u ), seatOf.get( t.v ), t.bow ) ) );
		}
		nameBeads( sc, lay.C, pts, boxes.slice(), W, H, !!GAME );
	}
	sc.web = lay.web;
	sc.deep = !!out;
	sc.far = out ? out.fars : [];
	sc.company = comp;
	sc.shown = shown;
	sc.head = [ first( a ), pageMark( a, true ), ring.length > n ? h( 'button', { type: 'button', class: 'turn',
		title: `Others ${ first( a ) } has played with: ${ n - stay } more of the ${ ring.length - stay }`,
		onclick: () => go( { a, turn: ( v.turn || 0 ) + 1 } ) }, '↻ others' ) : null ];
	sc.sub = comp.length ?
		[ looseOnly ? 'On a record with ' : 'Has played with ', h( 'b', null, K.plural( comp.length, 'picker' ) ), ' the sources here know' +
			( looseOnly ? ', though none on the same track' : '' ) ] :
		[ 'Nobody the sources here know has played with them yet.' ];
	return sc;
}

/* ------------------------------------------------------------------------------------------------------------
 * Inside out: one piece of music in the middle, and where its pickers lead. The circles are pieces; a line is
 * the pickers on both ends of it, the first of them named on a tag.
 * --------------------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------------------
 * Your rabbithole: every song that has been on in Rabbithole, oldest first, and who the listener followed from each
 * to the next (Justin, #connectome, 15 Nov 2026: Rabbithole's walk "with the same UI we've built for this explorer
 * ... more like a flow chart than a constellation"). The songs are circles, as in a piece's view; a line from one
 * to the next is the picker followed, named on it; a song reached without following anyone hangs on a faint line.
 * It runs as a snake, left to right, down a row and back again (Justin, 09:42Z: "I don't like the flow chart being
 * strictly vertical"), the song on now last, and a long walk scrolls. Round each song, faint, the roads it didn't
 * take: where its other pickers lead, each a bead on a thin line, to be pointed at and gone to (the same ask:
 * "constellation-ish in the sense of showing other unused but potential connections and allowing the user to
 * explore those").
 * --------------------------------------------------------------------------------------------------------- */

let walkHops = null;                    // the walk, as Rabbithole keeps it: [{ cid, song, via, at }], oldest first
let walkNow = { cid: null, playing: false };
let walkAt = null;                      // where the walk stands, the player's `at` (magent, 16 Nov): null when it doesn't say
let walkChasing = null;                 // who is chased, by name (Justin, 15 Nov 2026: "very super bigly highlighted")
let walkFoot = true;                    // the reader is at the foot of the walk: a new song keeps them there
let road = null;                        // a road from the song on now, gone to: { cid, via }; played from there, it's that picker followed
let walkGlint = null;                   // the walk moved on its own, once: { from, to, back, t }, shown as it moves, then gone
// The snake's measures: a song's circle; the room at each side for a turn, and how far out it bows; the first row,
// from a row to the next (its names, the gap a turn's name sits in, the roads over the next row), and how far out
// a road's bead sits.
const WALK = { R: 15, side: 78, bend: 58, top: 92, pitch: 186, reach: 54 };

/** Why a line of the walk connects, said on it (Justin, 15 Nov 2026: every single line). The word rides the
 *  hop; the one you followed yourself says so by being a name alone. In the dock, too tight, the name says it. */
const WORDS = { chase: 'chased', quest: 'quested', trail: 'on the trail', next: 'queued next', record: 'next on the record', road: 'down the road' };
function whyWord( why ) {
	return ( !MINI && why && WORDS[ why ] ) || '';
}

/** The walk as a browser keeps it for Rabbithole (localStorage "rabbithole-walk"), junk tolerated. The walk
 *  is one chain of connected songs (rabbithole:blu/walk-reset, 15 Nov 2026: { current, past } — a song played
 *  cold closed the one before); an older page kept a bare array. Either way, the songs of the rabbithole you
 *  are on. */
function storedWalk() {
	try {
		const v = JSON.parse( window.localStorage.getItem( 'rabbithole-walk' ) || '[]' );
		const hops = Array.isArray( v ) ? v : ( v && typeof v === 'object' ? v.current : null );
		return Array.isArray( hops ) ? hops.filter( ( h ) => h && typeof h.cid === 'string' && h.cid ) : [];
	} catch ( e ) {
		return [];
	}
}

/** A word to Rabbithole, where the graph is its drawer; nothing anywhere else. */
function tell( msg ) {
	if ( HOST ) {
		window.parent.postMessage( Object.assign( { connectome: true }, msg ), location.origin );
	}
}

/**
 * A step's name: the song, whose it is, and a word on what it is to the walk. In the snake it hangs under the
 * circle (from its left edge at a row's left end, from its right edge at the right end, so it never runs out over
 * a turn), or, in the dock's middle, sits over it; in a single column, beside it.
 */
function stepLabel( g, d, R, href, name ) {
	const a = s( 'a', { href, 'aria-label': name } );
	const lines = [ [ '', d.label ], d.sub ? [ 'sub', d.sub ] : null, d.note ? [ 'note' + ( d.now ? ' now' : '' ), d.note ] : null ].filter( Boolean );
	const x = d.anchor === 'start' ? -R : ( d.anchor === 'end' ? R : ( d.anchor ? 0 : R + 10 ) );
	const y0 = !d.anchor ? ( lines.length > 1 ? -3 : 5 ) : ( d.up ? -R - 8 - 14 * ( lines.length - 1 ) : R + 15 );
	lines.forEach( ( [ cls, text ], k ) => {
		a.appendChild( s( 'text', { class: cls || null, x, y: y0 + k * 14 + ( !d.anchor && k ? 1 : 0 ), 'text-anchor': d.anchor || 'start' }, text ) );
	} );
	g.appendChild( a );
}

function walkScene() {
	const sc = newScene();
	const steps = K.walkSteps( G, walkHops || storedWalk() );
	const sum = K.walkSum( steps );
	// Where the walk stands (magent, 16 Nov: `at` rides the walk word beside `night`): the step you are on, not
	// the newest one — a walk can stand on a song it has heard before. Where the player doesn't say, the newest
	// step is where you stand, as it has always been drawn.
	const standing = walkAt !== null ? Math.max( 0, Math.min( walkAt, steps.length - 1 ) ) : steps.length - 1;
	const R = WALK.R;
	// Where every song goes, in a frame W wide (H tall, for the dock).
	const place = ( W, H ) => {
		// the dock: where you stand and one or two before it; one, in a narrow sidebar
		const few = W < 330 ? 2 : 3;
		const shown = MINI ? steps.slice( Math.max( 0, standing + 1 - few ), standing + 1 ) : steps;
		let lay = MINI ? K.snake( { W, n: shown.length, room: 70, side: R + 4, top: shown.length > 2 ? 64 : Math.max( 34, Math.round( ( H - 80 ) / 2 ) + R ),
			pitch: 0, most: Math.max( 1, shown.length ) } ) :
			K.snake( { W, n: shown.length, room: W >= 700 ? 200 : 150, side: WALK.side, top: WALK.top, pitch: WALK.pitch } );
		if ( lay.cols < 2 && !MINI ) {                               // no room for two to a row: one column, names beside
			lay = K.snake( { W, n: shown.length, room: W, side: Math.min( 120, Math.max( 86, W * 0.16 ) ), top: 30, pitch: 76 } );
		}
		// a long walk scrolls: the frame is as tall as the walk, and the stage scrolls it; the ensemble of the
		// song on now hangs under the last circle, and wants its room
		const need = !lay.rows ? 60 : lay.at[ lay.at.length - 1 ].y + ( lay.cols > 1 ? R + 15 + 28 + 26 : 50 ) + ( !MINI && steps.length ? 48 : 0 );
		svg.style.height = MINI ? '' : Math.max( need, stage.clientHeight - ( $( 'say' ).offsetHeight || 0 ) - ( $( 'legend' ).offsetHeight || 0 ) ) + 'px';
		return { shown, lay, W };
	};
	let { W, H } = frame( true ), fit = place( W, H );
	( { W, H } = frame( true ) );                                    // the height as set; and the width, should a scroll bar have come or gone
	if ( W !== fit.W ) {
		fit = place( W, H );
		( { W, H } = frame( true ) );
	}
	const { shown, lay } = fit, snaking = lay.cols > 1;
	const want = MINI || !snaking ? 0 : ( W >= 700 ? 3 : 2 );       // the roads not taken, round each song
	// at a row's end, two at most, all turned in, clear of the turn that comes by outside
	const roads = want ? K.walkRoads( G, steps, ( i ) => ( lay.at[ i ].anchor !== 'middle' ? Math.min( 2, want ) : want ) ) : [];
	// How wide a step's name may run: in the snake, to just short of halfway to the next song; in the dock's middle,
	// over its circle, nearly to the songs either side; in a single column, to the frame's edge.
	const room = ( p, up ) => !snaking ? Math.max( 60, W - p.x - R - 22 ) :
		( up ? 2 * lay.S - 14 : ( p.anchor === 'middle' ? lay.S - 14 : lay.S / 2 + R - 7 ) );
	shown.forEach( ( st, i ) => {
		const p = lay.at[ i ];
		const up = MINI && snaking && lay.cols === 3 && p.col === 1;   // the dock's middle song is named over it: the room is there
		const now = st.i === standing;                             // the stand: where you are, not the newest step
		const whose = st.piece !== undefined ? K.called( G, M( st.piece ) ).sub : '';
		const fresh = !MINI && st.at !== null && ( !i || dayOf( st.at ) !== dayOf( shown[ i - 1 ].at ) );   // each day says itself once
		const note = [ now ? ( walkNow.playing ? '▶ on now' : 'on now, paused' ) : ( st.again ? 'again' : '' ),
			fresh ? dayOf( st.at ) : '' ].filter( Boolean ).join( ' · ' );
		const most = room( p, up );
		const common = { step: st.i, cid: st.cid, side: snaking ? null : 'right', anchor: snaking ? ( up ? 'middle' : p.anchor ) : null, up,
			label: cut( st.song, FONT.piece, most ), sub: whose ? cut( whose, FONT.sub, most ) : '', note, now,
			lit: now, x: p.x, y: p.y, kind: 'named', o: 1, delay: 40 + i * 20 };
		if ( st.piece !== undefined ) {
			sc.nodes.set( 'w' + st.i, Object.assign( { piece: st.piece, stands: 'piece', is: 'w' + st.i }, common ) );
		} else {
			sc.nodes.set( 'w' + st.i, Object.assign( { stands: 'loose', is: 'w' + st.i }, common ) );
		}
		if ( i ) {                                                   // the way from the one before: the picker followed, said on it
			const prev = shown[ i - 1 ], a = lay.at[ i - 1 ];
			const turn = snaking && a.row !== p.row;                 // from a row's end down to the next: round the outside
			sc.lines.set( 'wl' + st.i, { a: 'w' + prev.i, b: 'w' + st.i, stands: 'thread', who: st.via !== null ? [ st.via ] : [], w: st.viaName ? 2.6 : 1.4,
				o: st.viaName ? 0.95 : 0.5, quiet: !st.viaName, emph: now, delay: 60 + i * 20, step: st.i, id: st.via,
				label: st.via !== null ? first( st.via ) : st.viaName, bend: turn ? { x: a.dir * WALK.bend, y: 0 } : null } );
			const word = whyWord( st.why );
			const name = st.via !== null ? first( st.via ) : st.viaName;
			if ( name || word ) {
				const label = cut( name ? name + ( word ? ' · ' + word : '' ) : word, FONT.tag, ( turn ? 170 : ( snaking ? lay.S - 2 * R + 6 : Math.max( 60, W - p.x - 60 ) ) ) - 28 );
				const w = 28 + wide( label, FONT.tag );
				// on a turn, where it bows out furthest, kept in the frame; in a row, halfway; in a column, between the two
				const at = turn ? { x: Math.min( Math.max( a.x + a.dir * 0.75 * WALK.bend, w / 2 + 4 ), W - w / 2 - 4 ), y: ( a.y + p.y ) / 2 } :
					( snaking ? { x: ( a.x + p.x ) / 2, y: p.y } : { x: p.x, y: ( a.y + p.y ) / 2 } );
				// a word with no one behind it (queued next, next on the record): the word alone, on the line
				sc.pills.set( 'wv' + st.i, { id: st.via, who: st.via !== null ? [ st.via ] : [],
					stands: st.viaName ? 'picker' : 'roadname', tag: true, step: st.viaName ? st.i : undefined,
					is: st.via !== null ? 'p' + st.via : undefined,
					x: Math.round( at.x ), y: Math.round( at.y ), w, label, extra: '', lit: !!name && name === walkChasing, o: 1, delay: 80 + i * 20 } );
			}
		}
		// The roads it didn't take, fanned over it. The song on now's are a little plainer and named, being the ones
		// still there to take.
		const end = p.anchor !== 'middle';
		const rs = want ? roads[ st.i ] : [];
		const fan = end ? [ -150, -110 ].slice( 0, rs.length ) : ( rs.length === 3 ? [ -134, -90, -46 ] : ( rs.length === 2 ? [ -114, -66 ] : [ -90 ] ) );
		rs.forEach( ( r, k ) => {
			const deg = p.anchor === 'start' ? -180 - fan[ k ] : fan[ k ];   // the left end's are the right end's, mirrored
			const ang = deg * Math.PI / 180, key = 'r' + st.i + '.' + r.id;
			sc.nodes.set( key, { piece: r.id, stands: 'piece', is: 'm' + r.id, kind: 'dot', road: st.i, by: r.by, who: r.via, now,
				r: Math.max( coarse ? 4.6 : 3.6, Math.min( 6.5, 2.8 + 1.1 * r.via.length ) ),
				x: p.x + WALK.reach * Math.cos( ang ), y: p.y + WALK.reach * Math.sin( ang ), o: now ? 1 : 0.8, delay: 300 + i * 12 } );
			sc.lines.set( key + '~', { a: 'w' + st.i, b: key, stands: 'thread', role: 'road', who: r.via, w: 1.2, o: now ? 0.6 : 0.4, quiet: true,
				delay: 280 + i * 12 } );
			const bx = p.x + WALK.reach * Math.cos( ang ), by = p.y + WALK.reach * Math.sin( ang ), c = Math.cos( ang );
			const side = c < -0.3 ? 'end' : ( c > 0.3 ? 'start' : 'middle' ), gap2 = 11;
			const label = cut( first( r.by ), FONT.road, 110 );
			sc.pills.set( key + 'n', { stands: 'roadname', label, anchor: side, shy: !now, owners: [ 'w' + st.i, key ], w: wide( label, FONT.road ),
				x: Math.round( side === 'middle' ? bx : bx + ( side === 'end' ? -gap2 : gap2 ) ), y: Math.round( side === 'middle' ? by - 11 : by + 4 ),
				o: now ? 1 : 0, delay: 320 + i * 12 } );
		} );
		// The ensemble of the song on now, under it (Justin, #rabbithole, 15 Nov 2026, item 5): who is on it, each
		// with what they played, and the way on — to their constellation, and, where a road not taken runs by them,
		// the play they lead to. The chased picker, if they are here, glows with them.
		if ( now && !MINI && st.cut && st.cut.pickers ) {
			const band = st.cut.pickers.filter( ( b ) => b[ 0 ] >= 0 && b[ 0 ] < G.people.length );
			const rs = roads[ st.i ] || [];
			const labels = band.map( ( b ) => cut( first( b[ 0 ] ) + ( b[ 2 ] ? ' · ' + b[ 2 ] : '' ), FONT.tag, 110 ) );
			const ws = labels.map( ( l ) => 28 + wide( l, FONT.tag ) );
			const gap = 8;
			const total = ws.reduce( ( s, w0 ) => s + w0, 0 ) + gap * Math.max( 0, band.length - 1 );
			let bx0 = p.x - total / 2;
			band.forEach( ( b, k ) => {
				const id = b[ 0 ], w = ws[ k ];
				const x = Math.min( Math.max( bx0 + w / 2, w / 2 + 4 ), W - w / 2 - 4 );
				bx0 += w + gap;
				const r = rs.find( ( q ) => q.by === id );
				let next = null;
				if ( r && HOST ) {                                   // a road the walk can still take: it plays, by this picker
					const pc = M( r.id );
					const play = pc.kind === 'track' ? K.playOf( G, G.music[ pc.m ], pc.song ) : '';
					const cid = play ? new URL( play, location.href ).searchParams.get( 'track' ) : '';
					if ( cid ) {
						next = { cid, song: pc.song, via: { name: first( id ), instrument: b[ 2 ] || b[ 1 ] || null } };
					}
				}
				sc.pills.set( 'wb' + st.i + '.' + id, { id, who: [ id ], song: st.song, cutOf: { role: b[ 1 ] || '', icon: b[ 2 ] || '' },
					stands: 'picker', is: 'p' + id, tag: true, x: Math.round( x ), y: p.y + R + 64, w, label: labels[ k ], extra: '',
					lit: first( id ) === walkChasing, o: 1, delay: 140 + k * 24, next } );
			} );
		}
	} );
	if ( walkGlint && performance.now() - walkGlint.t < 1500 ) { // the walk moved: the lines it took run a bead of
		                                                     // light, the way it went, and the step arrived at glows
		                                                     // (Justin, item 7). Once: the marks go with this draw only.
		const lo = Math.min( walkGlint.from, walkGlint.to ), hi = Math.max( walkGlint.from, walkGlint.to );
		for ( let k = lo + 1; k <= hi; k++ ) {
			const l = sc.lines.get( 'wl' + k );
			if ( l ) {
				l.glint = { back: walkGlint.back, order: k - lo - 1 };
			}
		}
		const arrived = sc.nodes.get( 'w' + walkGlint.to );
		if ( arrived ) {
			arrived.glintTo = true;
		}
	}
	walkGlint = null;
	if ( !MINI && walkFoot ) {
		requestAnimationFrame( () => {
			if ( standing >= steps.length - 1 ) {
				stage.scrollTop = stage.scrollHeight;                // the song on now is at the foot: in sight
			} else {
				const el = svg.querySelector( '[data-k="w' + standing + '"]' );
				if ( el ) {
					el.scrollIntoView( { block: 'nearest' } );       // the stand, wherever it is: in sight
				}
			}
		} );
	}
	sc.head = [ 'Your rabbithole', steps.length ? h( 'button', { type: 'button', class: 'turn',
		title: 'Forget this walk and start a new one from the song on now', onclick: () => {
			if ( HOST ) {
				tell( { clear: true } );
			} else {
				window.localStorage.removeItem( 'rabbithole-walk' );
				walkHops = [];
				show( true, true );
			}
		} }, 'start a new one' ) : null ];
	sc.sub = steps.length ?
		[ h( 'b', null, K.plural( sum.songs, 'song' ) ), sum.since ? ' since ' + dayOf( sum.since ) : '',
			sum.followed ? [ '; to ', h( 'b', null, String( sum.followed ) ), ' of them by way of someone on the one before' ] : '',
			'. A click on a song plays it again; on a name, goes to who they played with; on a faint bead, down a road not taken.',
			MINI ? '' : ' Under the song on now: who is on it, each to their constellation.' ].flat() :
		[ 'Nothing yet. Play a song in Rabbithole, then follow someone on it to the next.' ];
	return sc;
}

/** A day, as the walk heads each of its days. */
function dayOf( t ) {
	return typeof t === 'number' ? new Date( t ).toLocaleDateString( undefined, { day: 'numeric', month: 'short' } ) : '';
}

/** A step of the walk: play it again; turn it inside out; its page. Every step is a song already in the walk,
 *  so the play says where it sits (the contract of 15 Nov 2026: the graph sends { play, step }; the player
 *  marks that hop back and keeps its mode and picker — going back in the rabbithole, not starting a new one,
 *  Justin, #rabbithole, item 10). */
function aStep( d ) {
	if ( MINI ) {
		return { kind: 'your rabbithole', title: d.label, lines: [ d.sub, d.note ].filter( Boolean ), hint: 'click: open your rabbithole',
			acts: [ act( 'Open your rabbithole', () => tell( { open: true } ) ) ] };
	}
	const to = '/rabbithole/?track=' + encodeURIComponent( d.cid );
	const w = { kind: 'a song you heard', title: d.label, lines: [ d.sub, d.note ].filter( Boolean ), hint: HOST ? 'click: play it again' : 'click: play it in Rabbithole', acts: [] };
	w.acts.push( HOST ? act( 'Play it again', () => tell( { play: d.cid, step: d.step } ) )
		             : link( 'Play it in Rabbithole', HOME + to, 'play' ) );
	if ( d.piece !== undefined ) {
		w.acts.push( act( "Who's on it, and where they lead", () => go( { m: d.piece } ) ) );
	}
	if ( d.now && G.songcast && G.songcast[ d.cid ] ) {          // the song on now: its card (Justin, item 5)
		w.acts.push( act( "The song's card: its ensemble, and where they lead", () => go( { cut: d.cid } ) ) );
	}
	if ( G.songs[ d.label ] || G.songs[ walkSong( d ) ] ) {
		w.acts.push( link( "The song's page", pageUrl( 'Song:' + walkSong( d ) ), 'page' ) );
	}
	return w;
}

function walkSong( d ) {
	const st = K.walkSteps( G, walkHops || storedWalk() )[ d.step ];
	return st ? st.song : d.label;
}

/** The one followed from a step to the next: to them, here. */
function aVia( d ) {
	if ( MINI ) {
		return { kind: 'your rabbithole', title: d.label, lines: [ 'followed to the next song' ], hint: 'click: open your rabbithole',
			acts: [ act( 'Open your rabbithole', () => tell( { open: true } ) ) ] };
	}
	if ( d.id === null || d.id < 0 ) {
		return { kind: 'a picker', title: d.label, lines: [ 'followed to the next song', 'not in the connectome yet' ], hint: '', acts: [] };
	}
	return { kind: 'a picker you followed', title: first( d.id ), lines: [ 'followed to the next song' + instOf( d.id ) ], hint: 'click: who they played with',
		acts: [ act( 'Go to ' + first( d.id ), () => go( { a: d.id } ) ), pageAct( d.id ) ] };
}

/**
 * A road the walk didn't take: where it goes, from which song and by whom, and the ways on. A click goes to it, as
 * any bead in the graph does; from the song on now, a road that plays in Rabbithole can be taken, following its
 * picker there, and the walk says so on the line to it.
 */
function aRoad( d ) {
	const pc = M( d.piece ), m = G.music[ pc.m ], c = K.called( G, pc );
	const from = K.walkSteps( G, walkHops || storedWalk() )[ d.road ];
	const play = pc.kind === 'track' ? K.playOf( G, m, pc.song ) : '';
	const cid = play ? new URL( play, location.href ).searchParams.get( 'track' ) : '';
	const on = cid && G.songcast[ cid ] ? G.songcast[ cid ].pickers.find( ( x ) => x[ 0 ] === d.by ) : null;
	const via = { name: P( d.by ).name, instrument: on ? on[ 2 ] || on[ 1 ] || null : null };
	const take = d.now && cid && HOST ? { cid, via } : null;       // from the song on now: the road is still there to take
	const w = { kind: 'a road not taken · ' + ( pc.kind === 'show' ? 'a show' : ( pc.kind === 'track' ? 'a track' : 'a record' ) ),
		title: c.name + ( pc.kind === 'show' && c.sub ? ' · ' + c.sub : '' ),
		lines: [ pc.kind === 'track' ? 'on ' + c.long : ( pc.kind === 'show' ? c.long : c.sub ),
			'from ' + ( from ? K.clip( from.song, 30 ) : 'a song you heard' ) + ', by way of ' + listNames( d.who ) ],
		hint: 'click: go to it', acts: [ act( 'Go to ' + K.clip( c.name, 30 ), () => {
			road = take;
			go( { m: d.piece, hand: d.who } );
		} ) ] };
	if ( take ) {
		w.acts.push( act( 'Follow ' + first( d.by ) + ' to it', () => tell( { play: cid, via } ) ) );
	}
	w.acts.push( ...waysOut( pc ).filter( ( x ) => !( take && x.kind === 'play' ) ), act( 'Go to ' + first( d.by ), () => go( { a: d.by } ) ) );
	return w;
}

/**
 * Where Rabbithole's traverse asks the graph to go (Justin, #connectome, 18 Nov 2026: "I'd like for the walk to happen
 * within the bacon graph of the song by default"): an address, ?cut= for the song on now, ?p=…&playing= for whoever is
 * taking it on that song. There, as a move rather than a step in the browser's history, so the player's back button
 * stays the player's; or, naming nothing the graph holds, word back, and the player shows the song's page instead.
 * Before the graph is read, the last ask waits for it.
 */
let hostTo = null;
let booted = false;                      // the graph's first view is shown: a go() after it is someone moving it
function goFromHost( to ) {
	if ( typeof to !== 'string' ) {
		return;
	}
	if ( !G ) {
		hostTo = to;
		return;
	}
	hostTo = null;
	const v = parse( new URLSearchParams( to.replace( /^\?/, '' ) ) );
	if ( !v ) {
		tell( { missing: to } );
		return;
	}
	if ( !same( v, view ) ) {
		go( v, true );
	}
}

// What Rabbithole says: the walk, the song on now, whether it plays, and whether the drawer is open; or, from its
// traverse, where the graph in its pane should go.
window.addEventListener( 'message', ( ev ) => {
	if ( !HOST || ev.origin !== location.origin || ev.source !== window.parent || !ev.data ) {
		return;
	}
	if ( ev.data.rabbithole === 'go' ) {
		goFromHost( ev.data.to );
		return;
	}
	if ( ev.data.rabbithole !== 'walk' ) {
		return;
	}
	const d = ev.data;
	if ( road && Array.isArray( d.hops ) && ( !walkHops || d.hops.length !== walkHops.length ) ) {
		road = null;
	}
	walkHops = Array.isArray( d.hops ) ? d.hops : walkHops;
	walkChasing = d.chasing || null;
	if ( typeof d.night === 'boolean' ) {                        // night as the player has it (Justin, #rabbithole, 15 Nov 2026,
		                                                     // item 5: the drawer "in dark mode even if the page is light"):
		                                                     // in the frame the player says, not this page's own reading
		document.documentElement.classList.toggle( 'pp-dark', d.night );
		document.documentElement.classList.toggle( 'pp-light', !d.night );
	}
	const wasAt = walkAt, wasCid = walkNow.cid;
	walkNow = { cid: d.now || null, playing: !!d.playing };
	walkAt = typeof d.at === 'number' ? d.at : null;
	if ( G && ( wasCid || wasAt !== null ) ) {                   // the walk moved on its own (Justin, item 7: webamp's back
		                                                     // and forth "need to trigger an animation in the 'Your
		                                                     // Rabbithole' bacon graph area"): the line it took shows
		                                                     // it. The stand (`at`) says where; by cid when the player
		                                                     // is one that doesn't send it yet.
		const steps = K.walkSteps( G, walkHops || [] );
		let from = null, to = null;
		if ( typeof wasAt === 'number' && typeof walkAt === 'number' && wasAt !== walkAt ) {
			from = wasAt;
			to = walkAt;
		} else if ( walkAt === null && wasCid && d.now && wasCid !== d.now ) {
			from = steps.findIndex( ( st ) => st.cid === wasCid );
			to = steps.findIndex( ( st ) => st.cid === d.now );
		}
		if ( from !== null && to !== null && from >= 0 && to >= 0 && from !== to ) {
			walkGlint = { from, to, back: to < from, t: performance.now() };
		}
	}
	const mini = d.mode === 'mini';
	if ( mini !== MINI ) {
		MINI = mini;
		document.body.classList.toggle( 'mini', MINI );
		walkFoot = true;
		if ( G && !( view && view.walk ) ) {
			trail.length = 0;
			go( { walk: true } );                                    // the drawer shut: back to the walk
			return;
		}
	}
	if ( G && view && view.walk ) {
		show( true, true );
	}
} );

document.body.classList.toggle( 'mini', MINI );
if ( HOST ) {
	document.body.classList.add( 'in-rabbithole' );
	// Ways out, inside the player: a song plays there, and a page opens in its pane, not over the player.
	document.addEventListener( 'click', ( ev ) => {
		const a = ev.target.closest && ev.target.closest( 'a[href]' );
		if ( !a || a.id === 'faqlink' || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey ) {
			return;                                                  // the FAQ opens over the graph here too (openFaq)
		}
		const u = new URL( a.getAttribute( 'href' ), location.href );
		// the wiki's own links, whether this page is served from the wiki (all one origin) or from a preview of it
		if ( u.origin !== location.origin && !( HOME && u.origin === new URL( HOME ).origin ) ) {
			return;
		}
		if ( u.pathname.indexOf( '/rabbithole/' ) === 0 && u.searchParams.get( 'track' ) ) {
			ev.preventDefault();
			ev.stopPropagation();
			const cid = u.searchParams.get( 'track' );
			if ( road && road.cid === cid ) {
				tell( { play: cid, via: road.via } );
			} else if ( view && view.walk === undefined && view.b === undefined && view.a !== undefined && view.a >= 0 && view.a < G.people.length ) {
				// In one picker's constellation, a play is that picker followed: they led you here (the
				// ensemble of the song on now, Justin, #rabbithole, 15 Nov 2026, item 5), and the walk
				// says so on the hop. Two pickers in view is the two-picker view; its roads say who.
				const on = G.songcast[ cid ] && G.songcast[ cid ].pickers.find( ( x ) => x[ 0 ] === view.a );
				tell( { play: cid, via: { name: first( view.a ), instrument: on ? ( on[ 2 ] || on[ 1 ] || null ) : null } } );
			} else {
				tell( { play: cid } );
			}
		} else if ( u.pathname.indexOf( '/wiki/' ) === 0 || ( u.pathname.indexOf( '/index.php' ) === 0 && u.searchParams.get( 'title' ) ) ) {
			ev.preventDefault();
			ev.stopPropagation();
			const title = u.pathname.indexOf( '/wiki/' ) === 0 ? decodeURIComponent( u.pathname.slice( 6 ) ) : u.searchParams.get( 'title' );
			tell( { page: title.replace( /_/g, ' ' ) } );
		}
	}, true );
}
stage.addEventListener( 'scroll', () => {
	if ( view && view.walk ) {
		walkFoot = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 30;
	}
} );

function addPiece( sc, id, at, kind, more ) {
	sc.nodes.set( 'q' + id, Object.assign( { piece: id, stands: 'piece', is: 'm' + id, x: at.x, y: at.y, kind, below: !!at.below, o: 1 }, more ) );
}

/** A piece's name and the line under it, kept in the frame; and where it plays, when it does. */
function pieceLabel( id, pos, W ) {
	const pc = M( id ), c = K.called( G, pc );
	const play = pc.kind === 'track' ? K.playOf( G, G.music[ pc.m ], pc.song ) : '';
	const name = nameAt( K.clip( c.name, 24 ), pos, W - ( play ? 40 : 0 ), FONT.piece );
	const sub = c.sub ? nameAt( K.clip( c.sub, 24 ), pos, W, FONT.sub ) : null;
	return { label: name.label, dx: name.dx, sub: sub ? sub.label : '', sdx: sub ? sub.dx : 0, play };
}

function pieceScene( v ) {
	const { W, H } = frame();
	const sc = newScene();
	const me = M( v.m ), nm = K.called( G, me );
	const L = K.leads( G, v.m, W > 700 && H > 520 ? 6 : ( W > 460 ? 5 : 4 ), v.hand || [], v.keep || [] );
	const lay = K.ego( { W, H, named: L.named.length, dots: L.rest.length } );
	const n = lay.named.length;
	const pan = slide( 'm' + v.m, lay.C );
	const seats = K.seat( lay.named, L.named.slice( 0, n ).map( ( x ) => wanted( 'm' + x.id, pan ) ) );
	// Each piece's name and the line under it, as they will be written, so no bead is set down under them.
	const names = L.named.slice( 0, n ).map( ( x, i ) => pieceLabel( x.id, lay.named[ seats[ i ] ], W ) );
	const spots = K.clearOf( lay.dots, names.map( ( nm, i ) => {
		const pos = lay.named[ seats[ i ] ], half = wide( nm.label, FONT.piece ) / 2, under = nm.sub ? wide( nm.sub, FONT.sub ) / 2 : 0;
		const x1 = Math.min( nm.dx - half, nm.sdx - under ), x2 = Math.max( nm.dx + half + ( nm.play ? 40 : 0 ), nm.sdx + under );
		return nameBox( pos, ( x1 + x2 ) / 2, ( x2 - x1 ) / 2, pos.below ? 19 : ( nm.sub ? -49 : -36 ), pos.below ? ( nm.sub ? 50 : 36 ) : -19 );
	} ), 10 );
	const all = L.named.concat( L.rest ).slice( 0, n + spots.length );
	const beads = K.seat( spots, all.slice( n ).map( ( x ) => wanted( 'm' + x.id, pan ) ) );
	const own = pieceLabel( v.m, { x: lay.C.x, y: lay.C.y }, W );
	addPiece( sc, v.m, lay.C, 'subject', Object.assign( { below: true }, own ) );
	// The middle's name and the line under it (whose a cut is, its record's artist: Justin, #connectome, 15 Nov
	// 2026), as drawPiece sets them: no tag goes on them.
	const ownHalf = Math.max( wide( own.label, FONT.piece ), own.sub ? wide( own.sub, FONT.sub ) : 0 ) / 2 + ( own.play ? 40 : 0 ) + 8;
	const middle = { x1: lay.C.x - ownHalf, y1: lay.C.y + 26, x2: lay.C.x + ownHalf, y2: lay.C.y + ( own.sub ? 60 : 46 ) };
	all.forEach( ( x, i ) => {
		const named = i < n;
		const pos = named ? lay.named[ seats[ i ] ] : spots[ beads[ i - n ] ];
		const by = named && ( v.keep || [] ).includes( x.id );
		addPiece( sc, x.id, pos, named ? 'named' : 'dot', Object.assign( { who: x.via, r: Math.max( coarse ? 4.6 : 3.4, Math.min( 7, 2.6 + 1.1 * x.via.length ) ),
			delay: named ? 80 + i * 40 : 300 }, named ? names[ i ] : null ) );
		sc.lines.set( threadKey( v.m, x.id ), { a: 'q' + v.m, b: 'q' + x.id, px: v.m, py: x.id, who: x.via, stands: 'thread',
			w: Math.min( 5.5, 1.5 + 0.8 * x.via.length ), o: named ? ( by ? 1 : 0.9 ) : 0, quiet: !named, emph: by, delay: named ? 120 + i * 40 : 300 } );
		if ( named ) {
			// The picker, named on their line where the line has room clear of both circles. A phone's short lines
			// have none: there the tag sits against the piece, on the side the line comes in by.
			const extra = x.via.length > 1 ? ' +' + ( x.via.length - 1 ) : '', ew = wide( extra, FONT.sub );
			const full = 28 + wide( K.clip( first( x.via[ 0 ] ), 26 ), FONT.tag ) + ew;
			const most = Math.min( 176, W * 0.42 );
			let at = K.tagAt( lay.C, pos, 24, 15, most, 23, [ middle ], Math.min( full, most ) );
			if ( at.room < Math.min( full, most ) ) {
				// against the piece, on the side the line comes in by; or, where that is on the middle's name, the other
				const x = pos.x + K.nudge( pos.x, Math.min( full, most ) / 2, 4, W - 4 ), half = Math.min( full, most ) / 2;
				const onName = ( y ) => x + half > middle.x1 && x - half < middle.x2 && y + 12 > middle.y1 && y - 12 < middle.y2;
				const y = pos.y + ( pos.below ? -32 : 32 );
				at = { x, y: onName( y ) ? pos.y + ( pos.below ? 32 : -32 ) : y, room: most };
			}
			const label = cut( first( x.via[ 0 ] ), FONT.tag, at.room - 28 - ew );
			sc.pills.set( 'w' + threadKey( v.m, x.id ), { id: x.via[ 0 ], who: x.via, stands: 'picker', is: 'p' + x.via[ 0 ], tag: true, px: v.m, py: x.id,
				x: Math.round( at.x ), y: Math.round( at.y ), w: 28 + wide( label, FONT.tag ) + ew, label, extra, o: 1, delay: 160 + i * 40 } );
		}
	} );
	// The same web, of pieces: which of those round the middle have pickers on both.
	const kept = v.keep || [];
	const round = all.slice( 0, n ).map( ( x, i ) => ( { id: x.id, at: lay.named[ seats[ i ] ] } ) );
	round.forEach( ( x, i ) => round.slice( i + 1 ).forEach( ( y ) => {
		const who = K.between( G, x.id, y.id );
		if ( who.length ) {
			const bow = K.arc( lay, x.at, y.at );
			sc.lines.set( threadKey( x.id, y.id ), { a: 'q' + x.id, b: 'q' + y.id, px: x.id, py: y.id, who, stands: 'thread', role: 'web', quiet: true,
				w: Math.min( 5.5, 1.5 + 0.8 * who.length ), o: lay.web ? webShade( bow, kept.includes( x.id ) && kept.includes( y.id ) ) : 0, bow, delay: 300 } );
		}
	} ) );
	sc.web = lay.web;
	sc.leads = L;
	sc.tagged = [ ...new Set( L.named.flatMap( ( x ) => x.via ) ) ];
	const kind = me.kind === 'track' ? 'A track on ' + nm.on : ( me.kind === 'show' ? 'A show' : 'A record' ) + ( nm.sub ? ' · ' + nm.sub : '' );
	sc.head = [ h( 'span', { class: 'kind' }, glyphBox( nm.glyph ) ), nm.name + ( me.kind === 'show' && nm.sub ? ' · ' + nm.sub : '' ), playButton( G.music[ me.m ], me.song ) ];
	sc.sub = [ kind, ' · ', h( 'b', null, K.plural( L.cast.length, 'picker' ) ), L.named.length ?
		' on it: each line is one of them, and where else they lead' : ' on it, and none of them on anything else the sources here know' ];
	return sc;
}

/* ------------------------------------------------------------------------------------------------------------
 * A song: its cut's cast round it, each with what the cut's credits gave them, and the web among them of
 * everywhere else (Justin, #rabbithole, 15 Nov 2026, 00:23Z: the song-centred card; K.songcast has the cast).
 * --------------------------------------------------------------------------------------------------------- */

/**
 * A page's own bacon graph (Justin, #connectome, 17 Nov 2026, 19:39Z, and at 20:50Z, of the page's card: "It feels
 * like I'm supposed to be able to click"): the page in the middle, the pickers it links round it (graph.json's
 * pages, from the page's own links), the web of who of them played together, and a step out from each to who else
 * they've played with. Being on the page together joins them here and only here (19:42Z): the spokes say nothing,
 * and from any of them the reader goes on by real connections, bringing nothing of the page along (carry).
 */
function pageScene( v ) {
	const { W, H } = frame();
	const sc = newScene();
	const ids = ( G.pages[ v.pg ] || [] ).filter( ( id ) => id >= 0 && id < G.people.length );
	const onPage = new Set( ids );
	const chosen = new Map();
	for ( const id of ids ) {
		for ( const [ o, tie ] of ( G.adj[ id ] || [] ) ) {
			if ( !tie.played || onPage.has( o ) ) {
				continue;
			}
			const was = chosen.get( o );
			if ( !was || tie.ev.length > was.tie.ev.length || ( tie.ev.length === was.tie.ev.length && tie.w > was.tie.w ) ) {
				chosen.set( o, { id: o, tie, by: id } );
			}
		}
	}
	const outer = [ ...chosen.values() ].sort( ( x, y ) => ( y.tie.ev.length - x.tie.ev.length ) || ( y.tie.w - x.tie.w ) )
		.slice( 0, W > 700 && H > 560 ? 20 : ( W > 460 || H > 500 ? 12 : 8 ) );
	const lay = K.ego( { W, H, named: Math.min( ids.length, 12 ), dots: outer.length } );
	const n = lay.named.length, mine = ids.slice( 0, n );
	const pan = slide( 'page', lay.C );
	const seats = K.seat( lay.named, mine.map( ( id ) => wanted( 'p' + id, pan ) ) );
	const seatOf = new Map( mine.map( ( id, i ) => [ id, lay.named[ seats[ i ] ] ] ) );
	for ( const id of mine ) {						// a spoke to each: on the page together, which says nothing more
		sc.lines.set( 'sp' + id, { a: 'page', b: 'p' + id, u: -1, v: id, tie: { played: false, tier: 0, w: 0.2 },
			stands: 'tie', w: lineWidth( { w: 0.2 } ), o: 0.5, role: 'spoke', c: id, quiet: true, fine: true, delay: 120 } );
	}
	const web = K.among( G, mine, false ).map( ( t ) => Object.assign( t, { bow: K.arc( lay, seatOf.get( t.u ), seatOf.get( t.v ) ) } ) );
	for ( const t of web ) {
		sc.lines.set( lineKey( t.u, t.v ), { a: 'p' + t.u, b: 'p' + t.v, u: t.u, v: t.v, tie: t.tie, stands: 'tie', role: 'web', quiet: true,
			w: lineWidth( t.tie ), o: lay.web ? webShade( t.bow, false ) : 0, bow: t.bow, delay: 300 } );
	}
	sc.nodes.set( 'page', { stands: 'page', is: 'page', x: lay.C.x, y: lay.C.y, kind: 'page', o: 1, title: v.pg, count: ids.length } );
	mine.forEach( ( id ) => {
		addNode( sc, id, seatOf.get( id ), 'named', Object.assign( { delay: 180 }, nameAt( first( id ), seatOf.get( id ), W, FONT.named ) ) );
	} );
	if ( outer.length ) {
		const seated = outer.slice( 0, lay.dots.length );
		const taken = mine.map( ( id ) => {
			const pos = seatOf.get( id ), nm = nameAt( first( id ), pos, W, FONT.named );
			return { x: pos.x + nm.dx, y: pos.y + ( pos.below ? 24 : -32 ), w: wide( nm.label, FONT.named ) / 2 + 3 };
		} );
		const clash = ( b, d ) => Math.abs( b.x - d.x ) < b.w + d.w && Math.abs( b.y - d.y ) < 22;
		// each one a step out sits, as near as there's room, by the one on the page whose company they are, so
		// the line out to them is short and crosses nothing (the strongest first, as the list is ordered)
		const turn = ( pt ) => Math.atan2( pt.y - lay.C.y, pt.x - lay.C.x );
		const open = lay.dots.map( ( d, k ) => k );
		const oseats = seated.map( ( c ) => {
			const want = turn( seatOf.get( c.by ) );
			let best = 0, gap = Infinity;
			open.forEach( ( k, at ) => {
				const d = Math.abs( Math.atan2( Math.sin( turn( lay.dots[ k ] ) - want ), Math.cos( turn( lay.dots[ k ] ) - want ) ) );
				if ( d < gap ) {
					gap = d;
					best = at;
				}
			} );
			return open.splice( best, 1 )[ 0 ];
		} );
		seated.forEach( ( c, i ) => {
			const at = lay.dots[ oseats[ i ] ], nm = nameAt( first( c.id ), at, W, FONT.far );
			const box = { x: at.x + nm.dx, y: at.y + ( at.below ? 24 : -14 ), w: wide( nm.label, FONT.far ) / 2 + 2 };
			const hit = taken.some( ( b ) => clash( b, box ) );
			if ( !hit ) {
				taken.push( box );
			}
			addNode( sc, c.id, at, hit ? 'dot' : 'far', Object.assign( { r: 4, by: c.by, tie: c.tie, delay: 360 }, hit ? {} : nm ) );
			addLine( sc, c.by, c.id, c.tie, { o: 0.4, quiet: true, fine: true, role: 'far', c: c.id, delay: 360 } );
		} );
		sc.far = seated.map( ( c, i ) => ( { id: c.id, at: lay.dots[ oseats[ i ] ], tie: c.tie, by: c.by } ) );
	}
	sc.web = lay.web;
	sc.head = [ h( 'b', null, v.pg ), ' ', h( 'a', { class: 'page', href: pageUrl( v.pg ), target: '_top' }, 'page ↗' ) ];
	sc.sub = [ h( 'b', null, K.plural( ids.length, 'picker' ) ), ' this page links; a line between two: they played together. ',
		'Being on the page together counts here, and nowhere else.' ];
	return sc;
}

function songScene( v ) {
	const scd = G.songcast[ v.cut ], { W, H } = frame();
	const sc = newScene();
	const ids = scd.pickers.map( ( p ) => p[ 0 ] ).filter( ( id ) => id >= 0 && id < G.people.length );
	const rolesOf = new Map( scd.pickers.map( ( p ) => [ p[ 0 ], { role: p[ 1 ] || '', icon: p[ 2 ] || '' } ] ) );
	const cuts = ( scd.on || [] ).map( ( m ) => G.music[ m ] ).filter( Boolean );
	const tier = cuts.length ? Math.max( ...cuts.map( ( c ) => c.tier ) ) : 0;
	// The constellation around the cut (Justin, #connectome, 15 Nov 2026, 04:53Z): a step out from each of
	// the cast to who else they've played with — the song's ecosystem, not just its ensemble. Each picker
	// lends their loudest few; the strongest of those stand named, the rest as beads.
	const inCut = new Set( ids );
	const chosen = new Map();
	for ( const id of ids ) {
		for ( const [ o, tie ] of ( G.adj[ id ] || [] ) ) {
			if ( !tie.played || inCut.has( o ) ) {
				continue;
			}
			const was = chosen.get( o );
			if ( !was || tie.ev.length > was.tie.ev.length || ( tie.ev.length === was.tie.ev.length && tie.w > was.tie.w ) ) {
				chosen.set( o, { id: o, tie, by: id } );
			}
		}
	}
	const outer = [ ...chosen.values() ].sort( ( x, y ) => ( y.tie.ev.length - x.tie.ev.length ) || ( y.tie.w - x.tie.w ) )
		.slice( 0, W > 700 && H > 560 ? 20 : ( W > 460 || H > 500 ? 12 : 8 ) );
	const lay = K.ego( { W, H, named: Math.min( ids.length, 12 ), dots: outer.length } );
	const n = lay.named.length, mine = ids.slice( 0, n );
	const pan = slide( 'c' + v.cut, lay.C );
	const seats = K.seat( lay.named, mine.map( ( id ) => wanted( 'c' + v.cut + '·' + id, pan ) ) );
	const seatOf = new Map( mine.map( ( id, i ) => [ id, lay.named[ seats[ i ] ] ] ) );
	for ( const id of mine ) {						// a spoke to each of the cast: it says nothing itself, the picker does
		sc.lines.set( 'sp' + id, { a: 'song', b: 'p' + id, u: -1, v: id, tie: { played: true, tier, w: 0.35 },
			stands: 'tie', w: lineWidth( { w: 0.35 } ), o: 0.95, role: 'spoke', c: id, quiet: true, delay: 120 } );
	}
	// The web: who of the cast have played together. What brought them here is the ring itself, so a line
	// stands only where they share something else as well.
	const web = K.among( G, mine, false )
		.filter( ( t ) => t.tie.ev.some( ( e ) => !cuts.some( ( c ) => c.id === e.m ) ) )
		.map( ( t ) => Object.assign( t, { bow: K.arc( lay, seatOf.get( t.u ), seatOf.get( t.v ) ) } ) );
	for ( const t of web ) {
		sc.lines.set( lineKey( t.u, t.v ), { a: 'p' + t.u, b: 'p' + t.v, u: t.u, v: t.v, tie: t.tie, stands: 'tie', role: 'web', quiet: true,
			w: lineWidth( t.tie ), o: lay.web ? webShade( t.bow, false ) : 0, bow: t.bow, delay: 300 } );
	}
	sc.nodes.set( 'song', { stands: 'song', is: 'song', x: lay.C.x, y: lay.C.y, kind: 'song', o: 1, title: scd.song, tier,
		cuts: [ cuts[ 0 ] ].filter( Boolean ), cut: v.cut } );
	mine.forEach( ( id ) => {
		const nm = nameAt( first( id ), seatOf.get( id ), W, FONT.named );
		addNode( sc, id, seatOf.get( id ), 'named', Object.assign( { cutOf: rolesOf.get( id ) || { role: '', icon: '' }, song: scd.song, delay: 180 }, nm ) );
	} );
	if ( outer.length ) {
		const seated = outer.slice( 0, lay.dots.length );
		// The far names go only where no name sits: the ecosystem reads by shape first, and the sweep keeps
		// the rule that no two names touch. A far node without room is a bead; the sheet still says who.
		const taken = mine.map( ( id ) => {
			const pos = seatOf.get( id ), nm = nameAt( first( id ), pos, W, FONT.named );
			return { x: pos.x + nm.dx, y: pos.y + ( pos.below ? 24 : -32 ), w: wide( nm.label, FONT.named ) / 2 + 3 };
		} );
		const clash = ( b, d ) => Math.abs( b.x - d.x ) < b.w + d.w && Math.abs( b.y - d.y ) < 22;
		const oseats = K.seat( lay.dots, seated.map( ( c ) => wanted( 'c' + v.cut + '·o' + c.id, pan ) ) );
		seated.forEach( ( c, i ) => {
			const at = lay.dots[ oseats[ i ] ], nm = nameAt( first( c.id ), at, W, FONT.far );
			const box = { x: at.x + nm.dx, y: at.y + ( at.below ? 24 : -14 ), w: wide( nm.label, FONT.far ) / 2 + 2 };
			const hit = taken.some( ( b ) => clash( b, box ) );
			if ( !hit ) {
				taken.push( box );
			}
			addNode( sc, c.id, at, hit ? 'dot' : 'far', Object.assign( { r: 4, by: c.by, tie: c.tie, delay: 360 }, hit ? {} : nm ) );
			addLine( sc, c.by, c.id, c.tie, { o: 0.4, quiet: true, fine: true, role: 'far', c: c.id, delay: 360 } );
		} );
		sc.far = seated.map( ( c, i ) => ( { id: c.id, at: lay.dots[ oseats[ i ] ], tie: c.tie, by: c.by } ) );
	}
	sc.web = lay.web;
	sc.head = [ h( 'b', null, scd.song ), h( 'a', { class: 'play', href: HOME + '/rabbithole/?track=' + encodeURIComponent( v.cut ),
		target: '_top', title: 'Play ' + scd.song + ' in Rabbithole', 'aria-label': 'Play ' + scd.song + ' in Rabbithole' }, playMark() ) ];
	sc.sub = [ 'On ', h( 'b', null, cuts[ 0 ] ? cuts[ 0 ].title : 'no cut the sources name' ),
		scd.number ? ', track ' + scd.number : '', scd.recorded ? ', recorded ' + scd.recorded : '', ' · ',
		h( 'b', null, K.plural( ids.length, 'picker' ) ), ' the page puts on this cut' ];
	return sc;
}

/* ------------------------------------------------------------------------------------------------------------
 * The scene, on the page: made once, then moved
 * --------------------------------------------------------------------------------------------------------- */

const layers = {};
[ 'faint', 'lines', 'dots', 'pills', 'nodes' ].forEach( ( n ) => {
	layers[ n ] = s( 'g', { class: 'L-' + n } );
	svg.appendChild( layers[ n ] );
} );
const live = { node: new Map(), line: new Map(), pill: new Map() };
let raf = 0;

function rabbit( scale ) {
	return s( 'g', { class: 'rab', transform: `scale(${ scale }) translate(1 2)` },
		s( 'ellipse', { cx: -5, cy: -12, rx: 2.2, ry: 6.5, transform: 'rotate(-8 -5 -12)' } ),
		s( 'ellipse', { cx: -1, cy: -11, rx: 2.2, ry: 6.5, transform: 'rotate(22 -1 -11)' } ),
		s( 'ellipse', { cx: 3, cy: 5, rx: 9, ry: 6.5 } ), s( 'circle', { cx: 7, cy: 5, r: 6 } ),
		s( 'circle', { cx: -6, cy: -2, r: 5.2 } ), s( 'circle', { cx: 13, cy: 2, r: 2.6 } ),
		s( 'ellipse', { cx: -2, cy: 11, rx: 4.5, ry: 1.8 } ), s( 'circle', { class: 'eye', cx: -7.6, cy: -3, r: 1 } ) );
}

/** The way into Rabbithole, on the graph: a green chip with the rabbit and a play mark, its left end at x. */
function playChip( x, y, to, song ) {
	const say = 'Play ' + song + ' in Rabbithole', r = rabbit( 0.4 );
	r.setAttribute( 'transform', `translate(${ ( x + 10.5 ).toFixed( 1 ) } ${ y + 0.5 }) scale(0.4)` );
	return s( 'a', { class: 'play', href: HOME + to, target: '_top', 'aria-label': say }, s( 'title', null, say ),
		s( 'rect', { x: x.toFixed( 1 ), y: y - 9, width: 33, height: 18, rx: 9 } ), r,
		s( 'path', { class: 'tri', d: `M${ ( x + 21.5 ).toFixed( 1 ) } ${ y - 4.5 }v9l7.5 -4.5z` } ) );
}

const noCover = new Set();                                         // pictures that wouldn't load: not asked for again

/**
 * A record's own art inside its ring, where its Record page names one (Justin, #connectome, 15 Nov 2026: "where
 * there is an image, let's use that"); the ring stays over it, so the colour still says how free it is. Returns
 * false where there is none; a picture that won't load gives way, and `again` draws the mark without it.
 */
function cover( g, file, R, again ) {
	if ( !file || noCover.has( file ) ) {
		return false;
	}
	const r = R - 2;
	const img = s( 'image', { class: 'face', href: FACE + encodeURIComponent( file.replace( / /g, '_' ) ) + '&width=120', x: -r, y: -r,
		width: 2 * r, height: 2 * r, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `circle(${ r }px at ${ r }px ${ r }px)`, 'aria-hidden': 'true' } );
	img.addEventListener( 'error', () => {
		noCover.add( file );
		again();
	} );
	g.appendChild( img );
	g.appendChild( s( 'circle', { class: 'ring rim', r: R } ) );
	return true;
}

/** A circle that is a piece of music: a ring as free as the piece is, and inside it what kind of piece. */
function drawPiece( g, d ) {
	const pc = M( d.piece ), c = K.called( G, pc );
	g.textContent = '';
	g.setAttribute( 'class', 'pk mu ' + d.kind + ' t' + G.music[ pc.m ].tier + ( d.lit ? ' lit' : '' ) );
	g.setAttribute( 'aria-label', [ c.name, c.sub ].filter( Boolean ).join( ', ' ) );
	( d.kind === 'dot' ? layers.dots : layers.nodes ).appendChild( g );
	if ( d.kind === 'dot' ) {
		g.appendChild( s( 'circle', { class: 'halo', r: coarse ? 15 : Math.max( 12, d.r + 7 ) } ) );
		g.appendChild( s( 'circle', { class: 'bead', r: d.r } ) );
		return;
	}
	const R = d.kind === 'subject' ? 24 : 15;
	const gl = glyph( c.glyph );
	gl.setAttribute( 'transform', `scale(${ d.kind === 'subject' ? 1.9 : 1.25 })` );
	g.appendChild( s( 'circle', { class: 'halo', r: R + 8 } ) );
	g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
	if ( !cover( g, G.music[ pc.m ].art, R, () => drawPiece( g, d ) ) ) {
		g.appendChild( gl );
	}
	if ( d.bare ) {                                              // the headline names this one
		return;
	}
	if ( d.step !== undefined ) {                                // a step of a walk: named as the walk's layout hangs it
		stepLabel( g, d, R, address( { m: d.piece } ), c.name );
		return;
	}
	const y = d.below ? R + 17 : ( d.sub ? -R - 21 : -R - 8 );
	const name = s( 'a', { href: address( { m: d.piece } ), 'aria-label': 'Go to ' + c.name }, s( 'text', { x: d.dx || 0, y, 'text-anchor': 'middle' }, d.label ) );
	if ( d.sub ) {
		name.appendChild( s( 'text', { class: 'sub', x: d.sdx || 0, y: y + 14, 'text-anchor': 'middle' }, d.sub ) );
	}
	g.appendChild( name );
	if ( d.play ) {
		g.appendChild( playChip( ( d.dx || 0 ) + wide( d.label, FONT.piece ) / 2 + 5, y - 4.5, d.play, pc.song ) );
	}
}

/** A picker on a line between two pieces: a tag with their name, and how many more are on both. */
function drawTag( g, d ) {
	const p = d.id !== null && d.id >= 0 ? P( d.id ) : { name: d.label, page: '' };
	g.textContent = '';
	g.setAttribute( 'class', 'pill tag' + ( d.lit ? ' lit' : '' ) + ( p.page ? '' : ' nopage' ) );
	g.setAttribute( 'aria-label', p.name + ( d.id !== null && d.id >= 0 ? instOf( d.id ) : '' ) + ( d.who.length > 1 ? ' and ' + K.plural( d.who.length - 1, 'other' ) : '' ) );
	layers.pills.appendChild( g );
	if ( coarse ) {
		g.appendChild( s( 'rect', { class: 'reach', x: -d.w / 2 - 4, y: -21, width: d.w + 8, height: 42 } ) );
	}
	g.appendChild( s( 'rect', { x: -d.w / 2, y: -11.5, width: d.w, height: 23, rx: 5 } ) );
	g.appendChild( s( 'circle', { class: 'dot' + ( p.page ? '' : ' hollow' ), cx: -d.w / 2 + 11, cy: 0, r: 3.6 } ) );
	const t = s( 'text', { x: -d.w / 2 + 20, y: 4.3 }, d.label );
	if ( d.extra ) {
		t.appendChild( s( 'tspan', { class: 'n' }, d.extra ) );
	}
	g.appendChild( d.id !== null && d.id >= 0 ? s( 'a', { href: address( { a: d.id } ), 'aria-label': 'Go to ' + p.name }, t ) : t );
}

const draw = {
	node( g, d ) {
		if ( d.stands === 'piece' ) {
			drawPiece( g, d );
			return;
		}
		if ( d.stands === 'loose' ) {                                // a song of the walk the graph has no cut for: its name, and nothing vouched for
			g.textContent = '';
			g.setAttribute( 'class', 'pk mu named t0' + ( d.lit ? ' lit' : '' ) );
			g.setAttribute( 'aria-label', d.label + ', a song' );
			layers.nodes.appendChild( g );
			g.appendChild( s( 'circle', { class: 'halo', r: 23 } ) );
			g.appendChild( s( 'circle', { class: 'ring', r: 15 } ) );
			const gl = glyph( 'track' );
			gl.setAttribute( 'transform', 'scale(1.25)' );
			g.appendChild( gl );
			stepLabel( g, d, 15, '/rabbithole/?track=' + encodeURIComponent( d.cid ), d.label );
			return;
		}
		if ( d.stands === 'page' ) {                                 // a page's own graph: the page in the middle, its name a way to it
			g.textContent = '';
			g.setAttribute( 'class', 'pk page' );
			g.setAttribute( 'aria-label', d.title + ', a page' );
			layers.nodes.appendChild( g );
			g.appendChild( s( 'circle', { class: 'halo', r: 32 } ) );
			g.appendChild( s( 'circle', { class: 'ring', r: 24 } ) );
			g.appendChild( s( 'g', { class: 'sheet', transform: 'scale(1.2)' },
				s( 'path', { class: 'leaf', d: 'M-7 -11 h9 l5 5 v17 h-14 z' } ),
				s( 'path', { class: 'writ', d: 'M2 -11 v5 h5 M-4 -1 h8 M-4 3 h8 M-4 7 h5' } ) ) );
			g.appendChild( s( 'a', { href: pageUrl( d.title ), target: '_top', 'aria-label': 'The page: ' + d.title },
				s( 'text', { y: 46, 'text-anchor': 'middle' }, K.clip( d.title, 30 ) ) ) );
			return;
		}
		if ( d.stands === 'song' ) {
			g.textContent = '';
			g.setAttribute( 'class', 'pk song t' + ( d.tier || 0 ) );
			g.setAttribute( 'aria-label', d.title + ', a song' );
			layers.nodes.appendChild( g );
			g.appendChild( s( 'circle', { class: 'halo', r: 32 } ) );
			g.appendChild( s( 'circle', { class: 'ring', r: 24 } ) );
			if ( !cover( g, d.cuts && d.cuts[ 0 ] ? d.cuts[ 0 ].art : '', 24, () => draw.node( g, d ) ) ) {
				const gl = glyph( 'track' );
				gl.setAttribute( 'transform', 'scale(1.9)' );
				g.appendChild( gl );
			}
			const to = d.cut ? '/rabbithole/?track=' + encodeURIComponent( d.cut ) : '';
			// Named, as every middle is (Justin, #connectome, 15 Nov 2026), over whatever of the web runs under the name.
			g.appendChild( s( 'a', { href: G.songs[ d.title ] ? pageUrl( 'Song:' + d.title ) : address( { s: d.title, cut: d.cut } ),
				'aria-label': 'About ' + d.title }, s( 'text', { y: d.above ? -40 : 46, 'text-anchor': 'middle' }, K.clip( d.title, 30 ) ) ) );
			if ( to ) {
				g.appendChild( playChip( 28, 0, to, d.title ) );
			}
			return;
		}
		const p = P( d.id );
		// On a song's ring the instrument is the cut's own (magent, #connectome, 15 Nov 2026: Skyler Golden
		// played bass on August, however his page says guitar); the icon tries it and falls back to a dot.
		const onCut = d.song !== undefined && d.cutOf;
		const inst = onCut ? ( d.cutOf.icon || '' ) : p.inst;
		g.textContent = '';
		g.setAttribute( 'class', 'pk ' + d.kind + ( p.page ? '' : ' nopage' ) + ( d.lit ? ' lit' : '' ) );
		g.setAttribute( 'aria-label', p.name + ( onCut && d.cutOf.role ? ' · ' + d.cutOf.role : instOf( d.id ) ) );
		( d.kind === 'dot' ? layers.dots : layers.nodes ).appendChild( g );
		if ( d.kind === 'dot' ) {
			g.appendChild( s( 'circle', { class: 'halo', r: coarse ? 15 : Math.max( 12, d.r + 7 ) } ) );
			g.appendChild( s( 'circle', { class: 'dot' + ( p.page ? '' : ' hollow' ), r: d.r } ) );
			if ( d.label && d.at ) {                                 // a bead's own name, small (nameBeads)
				g.appendChild( s( 'text', { class: 'bead-name', x: d.at.x, y: d.at.y, 'text-anchor': d.at.anchor }, d.label ) );
			}
			return;
		}
		// Their own picture, where their page gives one, in place of the rabbit or the instrument (Justin,
		// #connectome, 15 Nov 2026); the note still says what they play. A picture that won't load gives way
		// to what would have been there.
		const face = d.kind !== 'far' && p.img ? p.img : '';
		const marked = d.kind !== 'far' && ( d.rabbit || inst || face );	// a ring with something in it, or a plain dot
		const R = d.kind === 'subject' ? ( face ? 26 : ( marked ? 22 : 13 ) ) : ( d.kind === 'far' ? 5.5 : ( face ? 16 : ( marked ? 14 : 9 ) ) );
		g.appendChild( s( 'circle', { class: 'halo', r: R + 8 } ) );
		if ( face ) {
			const img = s( 'image', { class: 'face', href: FACE + encodeURIComponent( face.replace( / /g, '_' ) ) + '&width=120', x: -R, y: -R, width: 2 * R, height: 2 * R,
				preserveAspectRatio: 'xMidYMid slice', 'clip-path': `circle(${ R }px at ${ R }px ${ R }px)`, 'aria-hidden': 'true' } );
			img.addEventListener( 'error', () => {
				p.img = '';
				draw.node( g, d );
			} );
			g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
			g.appendChild( img );
			g.appendChild( s( 'circle', { class: 'ring rim', r: R } ) );
		} else if ( d.rabbit ) {
			g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
			g.appendChild( rabbit( 0.95 ) );
		} else if ( inst ) {
			const size = R * 1.42;
			const img = s( 'image', { href: ICON + encodeURIComponent( inst.replace( / /g, '_' ) ) + '.png', x: -size / 2, y: -size / 2,
				width: size, height: size, 'aria-hidden': 'true' } );
			img.addEventListener( 'error', () => {
				img.replaceWith( s( 'circle', { class: 'dot', r: 4 } ) );
			} );
			g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
			g.appendChild( img );
		} else {
			g.appendChild( s( 'circle', { class: 'dot big' + ( p.page ? '' : ' hollow' ), r: R } ) );
		}
		if ( d.bare ) {                                              // the headline names this one
			return;
		}
		const big = d.kind === 'subject';
		const label = d.label || K.clip( p.name, 26 );
		const at = d.at ? { x: d.at.x, y: d.at.y, 'text-anchor': d.at.anchor } :   // where the scene found it room (K.beside)
			d.side === 'left' ? { x: -R - 12, y: 6, 'text-anchor': 'end' } :
				d.side === 'right' ? { x: R + 12, y: 6, 'text-anchor': 'start' } :
					// the middle's name tucked in tight, its top just over the circle's rim, clear of the pills on the
					// lines out of it (Justin, #connectome, 15 Nov 2026)
					{ x: d.dx || 0, y: d.below ? R + ( big ? 10 : 18 ) : -R - 8, 'text-anchor': 'middle' };
		g.appendChild( s( 'a', { href: address( { a: d.id } ), 'aria-label': 'Go to ' + p.name }, s( 'text', at, label ) ) );
	},
	line( g, d ) {
		if ( d.stands === 'thread' ) {                               // pickers, between two pieces: ink, thicker the more of them
			g.textContent = '';
			g.setAttribute( 'class', 'ln th ' + ( d.role === 'web' || d.role === 'road' ? d.role + ' ' : '' ) + ( d.quiet ? 'quiet' : '' ) );
			( d.quiet ? layers.faint : layers.lines ).appendChild( g );
			g.appendChild( s( 'path', { class: 'core th' + ( d.emph ? ' on' : '' ),
				'stroke-width': ( d.role === 'web' ? Math.max( 1, d.w * 0.28 ) : d.w + ( d.emph ? 1 : 0 ) ).toFixed( 1 ) } ) );
			if ( !d.quiet ) {
				g.appendChild( s( 'path', { class: 'hit' } ) );
			}
			return;
		}
		const t = d.tie;
		const gold = t.played && t.tier === K.PERMANENT;
		const cls = !t.played ? 't0' : 't' + t.tier;
		g.textContent = '';
		const far = d.role === 'far', fine = d.role === 'web' || far || d.fine;
		g.setAttribute( 'class', 'ln ' + ( fine ? 'fine ' : '' ) + ( d.role === 'web' ? 'web ' : '' ) + ( far ? 'far ' : '' ) + ( d.quiet ? 'quiet' : '' ) );
		( d.quiet ? layers.faint : layers.lines ).appendChild( g );
		if ( fine ) {                                                // the web, the ways on, the rest of the company: the same marks, half as heavy
			g.appendChild( s( 'path', { class: gold ? 'thread' : 'core ' + cls,
				'stroke-width': ( cls === 't0' ? 1.3 : Math.max( far ? 1.5 : 1.1, d.w * ( far ? 0.42 : 0.32 ) ) ).toFixed( 1 ) } ) );
		} else if ( gold && d.emph ) {                               // the one that's lit: gold, with ink down the middle
			g.appendChild( s( 'path', { class: 'glow', 'stroke-width': ( d.w + 7 ).toFixed( 1 ) } ) );
			g.appendChild( s( 'path', { class: 'core t2', 'stroke-width': Math.max( 1.8, d.w * 0.42 ).toFixed( 1 ) } ) );
		} else if ( gold ) {                                         // a gold thread
			g.appendChild( s( 'path', { class: 'thread', 'stroke-width': Math.max( 2.2, d.w * 0.62 ).toFixed( 1 ) } ) );
		} else {
			g.appendChild( s( 'path', { class: 'core ' + cls, 'stroke-width': ( cls === 't0' ? 1.6 : Math.max( 1.4, d.w * ( d.emph ? 0.6 : 0.42 ) ) ).toFixed( 1 ) } ) );
		}
		if ( !d.quiet ) {
			g.appendChild( s( 'path', { class: 'hit' } ) );
		}
	},
	pill( g, d ) {
		if ( d.tag ) {
			drawTag( g, d );
			return;
		}
		if ( d.stands === 'roadname' ) {                             // who a road not taken goes by, at its bead
			g.textContent = '';
			g.setAttribute( 'class', 'pill rn' + ( d.shy ? ' shy' : '' ) );
			layers.pills.appendChild( g );
			g.appendChild( s( 'text', { x: 0, y: 0, 'text-anchor': d.anchor }, d.label ) );
			return;
		}
		if ( d.stands === 'day' ) {                                  // a day of the walk, heading its songs
			g.textContent = '';
			g.setAttribute( 'class', 'day' );
			layers.pills.appendChild( g );
			g.appendChild( s( 'text', { x: 0, y: 0 }, d.label ) );
			return;
		}
		g.textContent = '';
		g.setAttribute( 'class', 'pill ' + ( d.more ? 'more' : 't' + d.tier ) + ( d.lit ? ' lit' : '' ) + ( d.shy ? ' shy' : '' ) );
		layers.pills.appendChild( g );
		if ( coarse ) {                                              // more to land on than can be seen
			g.appendChild( s( 'rect', { class: 'reach', x: -d.w / 2 - 4, y: -21, width: d.w + 8, height: 42 } ) );
		}
		g.appendChild( s( 'rect', { x: -d.w / 2, y: -12, width: d.w, height: 24, rx: 12 } ) );
		if ( d.more ) {
			g.appendChild( s( 'text', { x: 0, y: 4.3, 'text-anchor': 'middle' }, d.label ) );
			return;
		}
		const gl = glyph( d.glyph );
		gl.setAttribute( 'transform', `translate(${ -d.w / 2 + 14 } 0)` );
		g.appendChild( gl );
		g.appendChild( s( 'text', { x: -d.w / 2 + 25, y: 4.3 }, d.label ) );
		if ( d.play ) {                                              // a track that plays: the rabbit takes you there
			g.appendChild( playChip( d.w / 2 - 37, 0, d.play, d.song ) );
		}
	}
};

/** The way into Rabbithole, small: a rabbit and a play mark. */
function playMark() {
	const r = rabbit( 0.4 );
	r.setAttribute( 'transform', 'translate(9 9.5) scale(0.4)' );
	return s( 'svg', { class: 'pm', width: 30, height: 18, viewBox: '0 0 30 18', 'aria-hidden': 'true' }, r, s( 'path', { class: 'tri', d: 'M19.5 4.5v9l7.5 -4.5z' } ) );
}

/** Beside a track's name, wherever it's written: the button that plays it in Rabbithole, when it plays there. */
function playButton( m, song ) {
	const to = K.playOf( G, m, song );
	return to ? h( 'a', { class: 'play', href: HOME + to, target: '_top', title: 'Play ' + song + ' in Rabbithole',
		'aria-label': 'Play ' + song + ' in Rabbithole' }, playMark() ) : null;
}

const sig = {
	node: ( d ) => [ d.stands, d.kind, d.lit, d.below, d.rabbit, d.side, d.anchor, d.up, d.bare, d.kind === 'dot' ? d.r.toFixed( 1 ) : '', d.label, d.dx, d.sub, d.sdx, d.play, d.note,
		d.at ? d.at.x + ' ' + d.at.y + d.at.anchor : '', d.title, d.cut, d.above ].join( '|' ),   // a song's: which, and its name over or under it
	line: ( d ) => ( d.stands === 'thread' ? [ 'th', d.w.toFixed( 1 ), d.quiet, d.emph, d.role ] :
		[ d.tie.played, d.tie.tier, d.w.toFixed( 1 ), d.quiet, d.emph, d.role, !!d.fine ] ).join( '|' ),
	pill: ( d ) => [ d.stands, d.tag, d.label, d.extra, d.tier, d.glyph, d.w.toFixed( 0 ), d.play, !!d.shy, d.anchor, !!d.lit ].join( '|' )
};

/**
 * The walk moving, said on the line it took: a bead of light runs it, the way it went (Justin, #rabbithole,
 * 15 Nov 2026, item 7: webamp's back and forth "need to trigger an animation in the 'Your Rabbithole' bacon
 * graph area, show advancing through a picker or going back to the previous track"). One draw carries the
 * ask; a redraw takes the bead with it, and the run stops on its own.
 */
function spark( it, glint ) {
	const dot = s( 'circle', { class: 'spark', r: 3.2, opacity: 0 } );
	it.el.appendChild( dot );
	const t0 = performance.now() + ( glint.order || 0 ) * 430, ms = 620;
	const tick = ( t ) => {
		if ( ! dot.isConnected ) {
			return;                                                  // redrawn: the line it rode on is gone
		}
		const path = it.el.querySelector( '.core' );
		const u = ( t - t0 ) / ms;
		if ( ! path || u < 0 ) {
			requestAnimationFrame( tick );
			return;
		}
		if ( u >= 1 ) {
			dot.remove();
			return;
		}
		const e = u * u * ( 3 - 2 * u );
		const at = path.getPointAtLength( ( glint.back ? 1 - e : e ) * path.getTotalLength() );
		dot.setAttribute( 'cx', at.x.toFixed( 1 ) );
		dot.setAttribute( 'cy', at.y.toFixed( 1 ) );
		dot.setAttribute( 'opacity', ( Math.sin( Math.PI * u ) * 0.95 ).toFixed( 2 ) );
		requestAnimationFrame( tick );
	};
	requestAnimationFrame( tick );
}

/** The step arrived at glows once: here you are. */
function pulse( g ) {
	const ring = s( 'circle', { class: 'spark-ring', r: 4 } );
	g.appendChild( ring );
	const t0 = performance.now(), ms = 750;
	const tick = ( t ) => {
		if ( ! ring.isConnected ) {
			return;
		}
		const u = ( t - t0 ) / ms;
		if ( u >= 1 ) {
			ring.remove();
			return;
		}
		ring.setAttribute( 'r', ( 4 + 22 * u ).toFixed( 1 ) );
		ring.setAttribute( 'opacity', ( 0.9 * ( 1 - u ) ).toFixed( 2 ) );
		requestAnimationFrame( tick );
	};
	requestAnimationFrame( tick );
}

function sync( kind, next, now ) {
	const have = live[ kind ];
	for ( const [ key, d ] of next ) {
		let it = have.get( key );
		const fresh = !it;
		if ( fresh ) {
			// What was in sight in another shape starts from where that was: a pill that is a circle now grows from the pill.
			const born = kind !== 'line' && d.is ? was.get( d.is ) : null;
			it = { el: s( 'g', { 'data-k': key, 'data-kind': kind, tabindex: kind === 'line' ? null : 0, role: kind === 'line' ? null : 'button' } ),
				x: born ? born.x : d.x, y: born ? born.y : d.y, o: 0, born: !!born };
			have.set( key, it );
		}
		const sg = sig[ kind ]( d );
		if ( it.sig !== sg ) {
			draw[ kind ]( it.el, d );
			it.sig = sg;
		}
		Object.assign( it, { d, fx: it.x, fy: it.y, fo: it.o, fq: it.q || null, tx: d.x, ty: d.y, to: d.o === undefined ? 1 : d.o, t0: now,
			delay: fresh && !it.born ? ( d.delay || 0 ) : 0, dead: false } );
		if ( kind === 'line' && d.glint ) {
			spark( it, d.glint );
		} else if ( kind === 'node' && d.glintTo ) {
			pulse( it.el );
		}
	}
	for ( const [ key, it ] of have ) {
		if ( !next.has( key ) && !it.dead ) {
			Object.assign( it, { fx: it.x, fy: it.y, fo: it.o, fq: it.q || null, tx: it.x, ty: it.y, to: 0, t0: now, delay: 0, dead: true } );
		}
	}
}

/**
 * Where a line's curve is drawn toward, from the middle of the straight line between its ends: nowhere for a
 * straight one; up or down to the picker a way round goes by; for the web, as far as K.arc said.
 */
function pull( d, a, b ) {
	if ( d.via ) {
		const v = live.node.get( d.via );
		return v ? { x: 0, y: v.y - ( a.y + b.y ) / 2 } : STRAIGHT;
	}
	return d.bow || STRAIGHT;
}

/**
 * A line as it is now, e of the way through a change of view. Its ends are wherever the things at them are; its
 * bow goes from what it was (fq) to what the view asks, so a line that was straight and is a curve now bends as
 * its ends slide, and doesn't jump.
 */
function pathOf( it, e ) {
	const d = it.d, a = live.node.get( d.a ), b = live.node.get( d.b );
	if ( !a || !b ) {
		return null;
	}
	const A = `M${ a.x.toFixed( 1 ) } ${ a.y.toFixed( 1 ) }`, B = `${ b.x.toFixed( 1 ) } ${ b.y.toFixed( 1 ) }`;
	if ( d.bend ) {                                              // a walk's turn from one row to the next: out and round, both ends level
		it.q = STRAIGHT;
		return `${ A }C${ ( a.x + d.bend.x ).toFixed( 1 ) } ${ a.y.toFixed( 1 ) } ${ ( b.x + d.bend.x ).toFixed( 1 ) } ${ b.y.toFixed( 1 ) } ${ B }`;
	}
	const to = pull( d, a, b ), from = it.fq || to;
	const q = it.q = { x: from.x + ( to.x - from.x ) * e, y: from.y + ( to.y - from.y ) * e };
	return Math.abs( q.x ) + Math.abs( q.y ) < 0.05 ? A + 'L' + B :
		`${ A }Q${ ( ( a.x + b.x ) / 2 + q.x ).toFixed( 1 ) } ${ ( ( a.y + b.y ) / 2 + q.y ).toFixed( 1 ) } ${ B }`;
}

function put( next, quick ) {
	const D = quick || still ? 0 : 420;
	const now = performance.now();
	sync( 'node', next.nodes, now );
	sync( 'pill', next.pills, now );
	sync( 'line', next.lines, now );
	cancelAnimationFrame( raf );
	const tick = ( t ) => {
		let busy = false;
		for ( const kind of [ 'node', 'pill', 'line' ] ) {
			for ( const [ key, it ] of live[ kind ] ) {
				const span = it.dead ? D * 0.5 : D;
				const u = span ? Math.min( 1, Math.max( 0, ( t - it.t0 - it.delay ) / span ) ) : 1;
				const e = u * u * ( 3 - 2 * u );
				it.x = it.fx + ( it.tx - it.fx ) * e;
				it.y = it.fy + ( it.ty - it.fy ) * e;
				it.o = it.fo + ( it.to - it.fo ) * e;
				if ( u < 1 ) {
					busy = true;
				} else if ( it.dead ) {
					it.el.remove();
					live[ kind ].delete( key );
					continue;
				}
				it.el.setAttribute( 'opacity', it.o.toFixed( 3 ) );
				if ( kind === 'line' ) {
					const p = pathOf( it, e );
					if ( p ) {
						for ( const c of it.el.children ) {
							c.setAttribute( 'd', p );
						}
					}
				} else {
					it.el.setAttribute( 'transform', `translate(${ it.x.toFixed( 1 ) } ${ it.y.toFixed( 1 ) })` );
				}
			}
		}
		if ( busy ) {
			raf = requestAnimationFrame( tick );
		}
	};
	if ( D ) {
		raf = requestAnimationFrame( tick );
	} else {
		tick( now + 1e6 );
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * The panel: the same view as a list, each thing with where a reader can check it
 * --------------------------------------------------------------------------------------------------------- */

function sourceName( url ) {
	if ( /archive\.org/.test( url ) ) {
		return 'Live Music Archive';
	}
	if ( /discogs\.com/.test( url ) ) {
		return 'Discogs';
	}
	if ( /musicbrainz\.org/.test( url ) ) {
		return 'MusicBrainz';
	}
	if ( /github\.com\/cryptograss\/arthel/.test( url ) ) {
		return "cryptograss's own notes";
	}
	return 'the source';
}

function badge( tier ) {
	return h( 'span', { class: 'badge t' + tier }, K.TIER_NAME[ tier ] );
}

/** A picker's name, off the graph: it goes to them, here. Asked for in a new tab, it opens the graph on them. */
function nameLink( id ) {
	const p = P( id );
	return h( 'a', { class: 'who' + ( p.page ? '' : ' new' ), href: address( { a: id } ), title: 'Go to ' + p.name + ( p.page ? '' : ' (no page yet)' ),
		onclick: ( ev ) => inApp( ev, () => go( { a: id } ) ) }, p.name );
}

/** A way out to a wiki page, said as one: an arrow beside a name. */
function outMark( href, say, words ) {
	return h( 'a', { class: 'out', href, target: '_top', title: say, 'aria-label': say }, words || '↗' );
}

/** The way out to a picker's page: an arrow beside their name in a list; in words (say) beside the headline. */
function pageMark( id, say ) {
	const p = P( id );
	if ( !p.page && !say ) {
		return null;
	}
	return outMark( pageUrl( p.name ), p.page ? p.name + "'s page" : 'Start ' + p.name + "'s page", say ? ( p.page ? 'page ↗' : 'no page yet: start it ↗' ) : '' );
}

function pageButton( id ) {
	const p = P( id );
	return h( 'a', { class: 'page' + ( p.page ? '' : ' new' ), href: pageUrl( p.name ), target: '_top' },
		p.page ? p.name + "'s page" : 'Start ' + p.name + "'s page" );
}

function evidence( tie, limit ) {
	const hand = [ tie.a, tie.b ];
	const rows = tie.ev.slice( 0, limit || tie.ev.length ).map( ( e ) => {
		const m = G.music[ e.m ], n = K.naming( G, e );
		const songs = e.songs.length ? e.songs.slice( 0, 4 ).map( ( song, i ) => {
			const t = m.kind === 'show' ? undefined : K.trackOn( G, e.m, song );
			return [ i ? ', ' : '', t === undefined ? '“' + K.clip( song, 60 ) + '”' :
				h( 'a', { href: address( { m: t } ), title: 'Go to ' + song, onclick: ( ev ) => inApp( ev, () => go( { m: t, hand } ) ) }, song ), playButton( m, song ) ];
		} ).concat( e.songs.length > 4 ? [ ` and ${ e.songs.length - 4 } more` ] : [] ) : null;
		return h( 'li', { class: 'go', onclick: ( ev ) => {
			if ( !ev.target.closest( 'a' ) ) {
				go( { m: K.pieceFor( G, e ), hand } );
			}
		} },
		h( 'span', { class: 'mark' }, glyphBox( n.glyph === 'track' ? 'record' : n.glyph ) ),
		h( 'span', { class: 'body' },
			h( 'div', { class: 't' }, m.kind === 'show' ? n.short : n.long, m.page ? outMark( wikiUrl( m.page ), m.kind === 'show' ? "The show's page" : "The record's page" ) : null ),
			songs ? h( 'div', { class: 's' }, songs ) : null,
			e.how === K.RECORD ? h( 'div', { class: 's' }, 'same record; no source puts them on the same track' ) : null,
			h( 'div', { class: 's' }, badge( m.tier ), ' ', m.source ? h( 'a', { href: m.source, target: '_blank', rel: 'noopener' }, sourceName( m.source ) + ' ↗' ) : null ) ) );
	} );
	const out = [ h( 'ul', null, rows ) ];
	if ( limit && tie.ev.length > limit ) {
		out.push( h( 'div', { class: 'acts' }, h( 'button', { type: 'button', onclick: ( ev ) => {
			ev.target.closest( '.acts' ).replaceWith( ...evidence( { a: tie.a, b: tie.b, ev: tie.ev.slice( limit ) } ) );
		} }, `${ tie.ev.length - limit } more` ) ) );
	}
	return out;
}

function pairHead( u, v, tie, open ) {
	return h( 'h3', { class: 'row' }, h( 'span', null, `${ first( u ) } & ${ first( v ) } · ${ K.times( tie ) || 'nothing yet' }` ),
		open ? h( 'button', { type: 'button', class: 'mini', onclick: () => go( { a: u, b: v } ) }, 'open these two' ) : null );
}

/** A picker in a list: the name goes to them, the arrow to their page, the rest of the row to what the row says. */
function personRow( id, note, act, under ) {
	return h( 'li', { class: 'go', 'data-p': id, onclick: ( ev ) => {
		if ( !ev.target.closest( 'a' ) ) {
			act();
		}
	}, onmouseenter: () => warm( 'p' + id, true ), onmouseleave: () => warm( 'p' + id, false ) },
	h( 'span', { class: 'body' }, nameLink( id ), pageMark( id ), h( 'span', { class: 's' }, instOf( id ) ), under ? h( 'div', { class: 's' }, under ) : null ),
	note ? h( 'span', { class: 'n' }, note ) : null );
}

/** The ways out from a piece: Rabbithole where it plays, its pages on the wiki, and every source that says it. */
function waysOut( pc ) {
	const m = G.music[ pc.m ], out = [];
	const play = pc.kind === 'track' ? K.playOf( G, m, pc.song ) : '';
	if ( play ) {
		out.push( link( 'Play ' + pc.song, HOME + play, 'play' ) );
	}
	if ( pc.kind === 'track' && G.songs[ pc.song ] ) {
		out.push( link( "The song's page", wikiUrl( G.songs[ pc.song ] ), 'page' ) );
	}
	if ( m.page ) {
		out.push( link( m.kind === 'show' ? "The show's page" : "The record's page", wikiUrl( m.page ), 'page' ) );
	}
	for ( const t of [ pc.m ].concat( pc.also || [] ) ) {
		if ( G.music[ t ].source ) {
			out.push( link( 'Check it at ' + sourceName( G.music[ t ].source ) + ' ↗', G.music[ t ].source, 'source' ) );
		}
	}
	return out;
}

/** A piece in a list: the row goes to it; who leads there is said under it. */
function pieceRow( x ) {
	const pc = M( x.id ), c = K.called( G, pc );
	return h( 'li', { class: 'go', onclick: ( ev ) => {
		if ( !ev.target.closest( 'a' ) ) {
			go( { m: x.id, hand: x.via } );
		}
	}, onmouseenter: () => warm( 'q' + x.id, true ), onmouseleave: () => warm( 'q' + x.id, false ) },
	h( 'span', { class: 'mark' }, glyphBox( c.glyph ) ),
	h( 'span', { class: 'body' }, h( 'div', { class: 't' }, c.name, playButton( G.music[ pc.m ], pc.song ) ),
		c.sub ? h( 'div', { class: 's' }, c.sub ) : null, h( 'div', { class: 's' }, 'by way of ' + listNames( x.via ) ) ) );
}

function piecePanel() {
	const pc = M( view.m ), m = G.music[ pc.m ], c = K.called( G, pc ), L = scene.leads;
	// What each played, as the source wrote it. A track's source says it for the whole record, so a track says none.
	const roles = new Map( pc.kind === 'track' ? [] : [ pc.m ].concat( pc.also ).flatMap( ( t ) => G.music[ t ].cast ) );
	const ways = L.named.concat( L.rest );
	return [
		h( 'h2', null, c.name, playButton( m, pc.song ) ),
		h( 'p', { class: 'sub' }, pc.kind === 'track' ? 'A track on ' + c.long : ( c.long || c.sub ) ),
		h( 'p', null, badge( m.tier ) ),
		h( 'div', { class: 'acts' }, waysOut( pc ).filter( ( a ) => a.kind !== 'play' ).map( ( a ) => h( 'a', { class: a.kind, href: a.href,
			target: a.kind === 'source' ? '_blank' : '_top', rel: a.kind === 'source' ? 'noopener' : null }, a.label ) ) ),
		h( 'h3', null, `On it, of the pickers here · ${ L.cast.length }` ),
		h( 'ul', null, L.cast.slice( 0, 80 ).map( ( id ) => personRow( id, null, () => go( { a: id } ), roles.get( id ) || null ) ) ),
		L.cast.length > 80 ? h( 'p', { class: 'sub' }, `and ${ L.cast.length - 80 } more` ) : null,
		ways.length ? h( 'h3', null, `Where they lead · ${ ways.length }` ) : null,
		h( 'ul', null, ways.slice( 0, 60 ).map( pieceRow ) ),
		ways.length > 60 ? h( 'p', { class: 'sub' }, `and ${ ways.length - 60 } more` ) : null
	];
}

function fillPanel() {
	const out = [];
	if ( view.walk ) {
		panel.replaceChildren();                                     // the walk is its own list: nothing beside it
		return;
	}
	if ( view.way ) {
		const { way, steps } = K.wayOf( G, GAME.path );
		out.push( h( 'h2', null, 'Your way to ' + first( GAME.to ) ),
			h( 'p', { class: 'sub' }, `${ K.plural( GAME.jumps, 'jump' ) }; the fewest it can be done in is ${ K.plural( GAME.par, 'hop' ) }` ),
			h( 'ul', null, way.map( ( id, i ) => personRow( id, i === 0 ? 'where you started' :
				( steps[ i - 1 ].tie ? K.times( steps[ i - 1 ].tie ) + ' with ' + first( steps[ i - 1 ].u ) : 'typed in' ), () => go( { a: id } ) ) ) ),
			tellBox( first( GAME.to ), gameFrom() ) );
	} else if ( view.pg !== undefined ) {
		const ids = G.pages[ view.pg ] || [];
		out.push( h( 'h2', null, view.pg ), h( 'p', { class: 'sub' }, h( 'a', { href: pageUrl( view.pg ), target: '_top' }, 'the page ↗' ) ),
			h( 'h3', null, `The pickers it links · ${ ids.length }` ),
			h( 'ul', null, ids.map( ( id ) => personRow( id, P( id ).inst || null, () => go( { a: id } ) ) ) ) );
	} else if ( view.cut !== undefined && G.songcast[ view.cut ] ) {
		const scd = G.songcast[ view.cut ];
		const cut = ( scd.on || [] ).map( ( m ) => G.music[ m ] ).filter( Boolean )[ 0 ];
		out.push( h( 'h2', null, scd.song ), h( 'p', { class: 'sub' }, cut ? 'on ' + cut.title
			+ ( scd.number ? ', track ' + scd.number : '' ) + ( scd.recorded ? ', recorded ' + scd.recorded : '' )
			: 'no cut the sources name' ) );
		if ( scd.pickers.length ) {
			out.push( h( 'h3', null, `On this cut · ${ scd.pickers.length }` ), h( 'ul', null, scd.pickers.map( ( [ id, roles ] ) =>
				personRow( id, roles || 'no instrument said', () => go( { a: id } ) ) ) ) );
		}
	} else if ( view.m !== undefined ) {
		out.push( ...piecePanel() );
	} else if ( view.b === undefined ) {
		const a = view.a;
		out.push( h( 'h2', null, first( a ) ), P( a ).inst ? h( 'p', { class: 'sub' }, P( a ).inst ) : null,
			h( 'div', { class: 'acts' }, pageButton( a ) ) );
		if ( scene.company.length ) {
			out.push( h( 'h3', null, `Has played with · ${ scene.company.length }` ),
				h( 'ul', null, scene.company.slice( 0, GAME && !GAME.done ? Infinity : 80 ).map( ( c ) => personRow( c.id, K.times( c.tie ), () => go( { a, b: c.id } ) ) ) ) );
			if ( scene.company.length > 80 && !( GAME && !GAME.done ) ) {     // in a challenge, all of them: the search box is put away
				out.push( h( 'p', { class: 'sub' }, `and ${ scene.company.length - 80 } more: find one in the box up top` ) );
			}
		}
		if ( scene.far && scene.far.length ) {
			out.push( h( 'h3', null, `A step further · ${ scene.far.length }` ),
				h( 'ul', null, scene.far.map( ( f ) => personRow( f.id, K.times( f.tie ), () => go( { a, b: f.id } ), 'by way of ' + first( f.by ) ) ) ) );
		}
	} else {
		const { a, b } = view;
		const c = scene.chain ? null : scene.lit;
		if ( scene.chain ) {
			out.push( h( 'h2', null, scene.chain.map( first ).join( ' → ' ) ) );
			for ( let i = 0; i < scene.chain.length - 1; i++ ) {
				const u = scene.chain[ i ], v = scene.chain[ i + 1 ];
				out.push( pairHead( u, v, G.adj[ u ].get( v ), true ), ...evidence( G.adj[ u ].get( v ), 4 ) );
			}
			out.push( h( 'div', { class: 'acts' }, scene.chain.slice( 1, -1 ).map( pageButton ) ) );
		} else if ( c !== null && sel.picker !== null ) {
			const m = scene.pool.find( ( x ) => x.id === c );
			out.push( h( 'div', { class: 'acts' }, h( 'button', { type: 'button', onclick: () => choose( { picker: null } ) }, '← ' + first( a ) + ' & ' + first( b ) ) ),
				h( 'h2', null, `${ first( a ) } → ${ first( c ) } → ${ first( b ) }` ),
				h( 'p', { class: 'sub' }, first( c ) + instOf( c ) ),
				h( 'div', { class: 'acts' }, pageButton( c ), h( 'button', { type: 'button', onclick: () => go( { a: c } ) }, 'Go to ' + first( c ) ) ),
				pairHead( a, c, m.ta, true ), ...evidence( m.ta, 5 ), pairHead( c, b, m.tb, true ), ...evidence( m.tb, 5 ) );
		} else {
			out.push( h( 'h2', null, `${ first( a ) } & ${ first( b ) }` ),
				h( 'div', { class: 'acts' }, pageButton( a ), pageButton( b ) ) );
			if ( scene.tie ) {
				out.push( h( 'h3', { id: 'together' }, `Together · ${ K.times( scene.tie ) }` ), ...evidence( scene.tie, 8 ) );
			}
			if ( scene.pool && scene.pool.length ) {
				out.push( h( 'h3', null, ( scene.loose ? 'On a record with each · ' : 'Both have played with · ' ) + scene.pool.length ),
					h( 'ul', null, scene.pool.slice( 0, 80 ).map( ( m ) => personRow( m.id, null, () => choose( { picker: m.id } ),
						`${ K.times( m.ta ) } with ${ first( a ) } · ${ K.times( m.tb ) } with ${ first( b ) }` ) ) ) );
			}
			if ( scene.none ) {
				out.push( h( 'p', { class: 'sub' }, 'The connectome grows with every source it reads. Know a record or a tape that joins them? Say so on their pages.' ) );
			}
		}
	}
	if ( !view.way && view.pg === undefined && view.a !== undefined && view.b === undefined && view.m === undefined && view.cut === undefined ) {
		out.push( tellBox( first( view.a ), GAME ? gameFrom() : 'the bacon graph of ' + first( view.a ) ) );
	}
	out.push( h( 'p', { class: 'foot' }, `${ G.people.length } pickers, ${ G.music.length } records and shows that join them. Built ${ K.when( G.built ) }. `,
		h( 'a', { href: 'connectome.sqlite', download: '' }, 'The whole store (SQLite)' ) ) );
	panel.replaceChildren( ...out.flat().filter( Boolean ) );
	if ( listed !== view ) {                                     // a new view's list starts at its top; a click in this one keeps its place
		panel.scrollTop = 0;
		listed = view;
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * The challenge (Justin, #connectome, 17 Nov 2026, 17:40Z): /bacon/challenge/<name> drops the reader at a random
 * picker three or four hops out, and they find their way to <name>, picker by picker. Each step to another picker
 * is a jump. There: a little confetti, then the way they took, drawn as a chain (the flowchart's shape, pickers
 * for steps), with its songs to play in Rabbithole and a box for a connection the graph doesn't know.
 * --------------------------------------------------------------------------------------------------------- */

/** A challenge to find `to`, starting at `from` when it is given and leads there, else where challengeStart says. */
function challenge( to, from ) {
	const d = from !== undefined && from !== to ? K.playedDistances( G, from )[ to ] : -1;
	const start = d > 0 ? { from, par: d } : K.challengeStart( G, to );
	document.body.classList.add( 'challenge' );
	if ( !start ) {
		GAME = null;
		lost = `Nobody the sources here know leads to ${ first( to ) } yet, so there's no way to find them. Here they are.`;
		go( { a: to } );
		gameSay();
		return;
	}
	GAME = { to, from: start.from, par: start.par, jumps: 0, path: [ start.from ], done: false, won: false };
	trail.length = 0;
	go( { a: start.from } );
	gameSay();
}

/** A challenge to find `to` from a track (the Oracle's): through it, whoever on it the reader picks is where they start.
 *  The track opens as its song's view where there is one, the pickers round it (K.trackView). */
function challengeDoor( to, piece ) {
	document.body.classList.add( 'challenge' );
	GAME = { to, door: { piece, view: K.trackView( G, piece ), name: K.called( G, M( piece ) ).name }, from: undefined, par: undefined,
		jumps: 0, path: [], done: false, won: false };
	trail.length = 0;
	go( GAME.door.view );
	gameSay();
}

/** Whether a view is the track a challenge came in by. */
function atDoor( v ) {
	const d = GAME && GAME.door;
	return !!d && v.a === undefined && ( d.view.cut !== undefined ? v.cut === d.view.cut : v.m === d.piece );
}

/**
 * After each step: a new picker in the middle is a jump, and the goal is the end of it. The jumps are the chain the
 * reader is on, from the start to here: back to a picker on it, and the chain unwinds to there, as the way at the
 * foot of the graph does (Justin, #connectome, 19 Nov 2026, 03:46Z). Six or fewer to the goal wins.
 */
function gameStep() {
	if ( GAME.done ) {
		return;
	}
	if ( atDoor( view ) ) {
		GAME.path.length = 0;                                        // back at the track they came in by: no one picked yet
		GAME.jumps = 0;
		gameSay();
		return;
	}
	if ( view.a === undefined || view.b !== undefined || view.m !== undefined || view.way || view.walk ) {
		return;
	}
	const at = GAME.path.lastIndexOf( view.a );
	if ( at >= 0 ) {
		GAME.path.length = at + 1;                                   // back to where they'd been: the chain unwinds to there
	} else if ( !GAME.path.length ) {
		GAME.path.push( view.a );                                    // through the track: whoever they picked on it is the start
		GAME.from = view.a;
		const d = K.playedDistances( G, view.a )[ GAME.to ];
		GAME.par = d >= 0 ? d : undefined;
	} else {
		const last = GAME.path[ GAME.path.length - 1 ];
		const tie = G.adj[ last ].get( view.a );
		if ( !( tie && tie.played ) ) {                              // a step further out: two jumps, by way of the one between
			const mid = K.bridgeOf( G, last, view.a, view.keep || [] );
			if ( mid !== undefined ) {
				GAME.path.push( mid );
			}
		}
		GAME.path.push( view.a );
	}
	GAME.jumps = Math.max( 0, GAME.path.length - 1 );
	if ( view.a === GAME.to ) {
		GAME.done = true;
		GAME.won = GAME.jumps <= SIX;
		if ( GAME.won ) {
			confetti();
		}
		setTimeout( () => {                                         // a moment to see who they found, then the way there
			if ( GAME && GAME.done && view.a === GAME.to ) {
				go( { way: true } );
			}
		}, still ? 300 : 1400 );
	}
	gameSay();
}

/** Where a note from the box says the visitor was: the challenge and where it started. */
function gameFrom() {
	return GAME ? `the challenge to find ${ first( GAME.to ) }, from ${ GAME.from !== undefined ? first( GAME.from ) : GAME.door.name }` : '';
}

/** The game's bar: whom to find, the jumps, and, at the end, the ways on. */
function gameSay() {
	const bar = $( 'game' );
	bar.hidden = !document.body.classList.contains( 'challenge' );
	if ( bar.hidden ) {
		return;
	}
	if ( document.activeElement !== $( 'goal' ) && GAME ) {
		$( 'goal' ).value = first( GAME.to );
	}
	if ( !GAME ) {
		$( 'jumps' ).replaceChildren();
		$( 'after' ).replaceChildren();
		return;
	}
	const par = GAME.par !== undefined ? ` It can be done in ${ GAME.par }.` : '';
	$( 'jumps' ).replaceChildren( ...( !GAME.path.length ? [ h( 'b', null, `Pick anyone on ${ GAME.door.name } to start` ), ', then six jumps or less' ] :
		GAME.done ? ( GAME.won ?
		[ h( 'b', null, `Found in ${ K.plural( GAME.jumps, 'jump' ) }: you win!` ), GAME.par !== undefined && GAME.jumps <= GAME.par ? ' The fewest there are! 🎯' : par ] :
		[ h( 'b', null, `Found, in ${ GAME.jumps } jumps: more than six.` ), ' Grab a banjo. 🪕' ] ) :
		GAME.jumps > SIX ? [ h( 'b', null, `${ GAME.jumps } jumps: past six.` ), " Back up, or it's the banjo. 🪕" ] :
		[ h( 'b', null, `${ GAME.jumps } of ${ SIX } jumps` ), ` · from ${ first( GAME.from ) }` + ( GAME.par !== undefined ? `, it can be done in ${ GAME.par }` : '' ) ] ) );
	const after = [];
	if ( GAME.done ) {
		after.push( h( 'button', { type: 'button', onclick: () => go( { way: true } ) }, 'Your way' ),
			h( 'button', { type: 'button', onclick: () => go( { a: GAME.from, b: GAME.to } ) }, 'The shortest' ) );
		const plays = K.wayPlays( G, K.wayOf( G, GAME.path ).steps );
		if ( plays.length ) {
			after.push( h( 'a', { class: 'play-way', href: HOME + plays[ 0 ].to, target: '_top', title: 'Play ' + plays[ 0 ].song + ' in Rabbithole' },
				playMark(), ' Play it in Rabbithole' ) );
		}
	}
	$( 'after' ).replaceChildren( ...after );
	const restart = $( 'restart' );
	restart.textContent = GAME.done ? 'New game' : 'New start';
	restart.title = GAME.done ? 'Someone new to find, from somewhere new' : 'Start again from somewhere else';
	restart.classList.toggle( 'again', GAME.done );
	pathSay();
}

/** A little confetti, once, over the graph; none for a reader who has asked for less motion. */
function confetti() {
	if ( still ) {
		return;
	}
	const box = $( 'confetti' );
	const hues = [ '#1976d2', '#c2185b', '#e65100', '#7b1fa2', '#00838f' ];   // not gold: gold means a Permanent Release
	box.replaceChildren( ...Array.from( { length: 34 }, ( _, i ) => h( 'i', { style: `left:${ ( 4 + Math.random() * 92 ).toFixed( 1 ) }%;` +
		`background:${ hues[ i % hues.length ] };animation-delay:${ ( Math.random() * 0.35 ).toFixed( 2 ) }s;` +
		`--dx:${ Math.round( ( Math.random() * 2 - 1 ) * 70 ) }px;--r:${ Math.round( Math.random() * 720 - 360 ) }deg` } ) ) );
	box.hidden = false;
	setTimeout( () => {
		box.hidden = true;
		box.replaceChildren();
	}, 2300 );
}

/** The way taken, as a chain from where they started to whom they found: each step's line says what joins the two. */
function wayScene() {
	const { W, H } = frame();
	const sc = newScene();
	const { way, steps } = K.wayOf( G, GAME.path );
	const a = way[ 0 ], b = way[ way.length - 1 ];
	const L = Math.max( 1, steps.length );
	const en = endNames( a, b, W );
	const lay = K.ladder( { W, H, hops: L, chains: 1, la: en.la, lb: en.lb } );
	if ( lay.upright ) {
		addNode( sc, a, lay.A, 'subject', { rabbit: true, side: 'right', label: cut( first( a ), FONT.subject, W - lay.A.x - 42 ) } );
		addNode( sc, b, lay.B, 'subject', { side: 'right', label: cut( first( b ), FONT.subject, W - lay.B.x - 42 ) } );
	} else {
		addEnds( sc, a, b, lay, en, W );
	}
	const room = ( lay.B.x - lay.A.x ) / L - 10;
	way.slice( 1, -1 ).forEach( ( id, i ) => {
		const level = i + 1;
		const at = lay.at( 0, level );
		addNode( sc, id, lay.upright ? at : Object.assign( at, { below: level % 2 === 0 } ), 'named', lay.upright ?
			{ lit: true, side: 'right', label: cut( first( id ), FONT.named, W - at.x - 30 ), delay: 120 + level * 90 } :
			Object.assign( { lit: true, delay: 120 + level * 90 }, fitName( first( id ), at.x, Math.max( 4, at.x - room / 2 ), Math.min( W - 4, at.x + room / 2 ), FONT.named ) ) );
	} );
	steps.forEach( ( st, i ) => {
		if ( !st.tie ) {
			return;                                                  // typed in: no line to draw
		}
		const pu = sc.nodes.get( 'p' + st.u ), pv = sc.nodes.get( 'p' + st.v );
		addLine( sc, st.u, st.v, st.tie, { emph: true, role: 'hop', c: i === 0 ? st.v : st.u, delay: 160 + i * 90 } );
		const span = lay.upright ? Math.min( 230, W - 2 * Math.abs( W / 2 - pu.x ) - 16 ) : Math.abs( pv.x - pu.x ) - 44;
		placePills( sc, st.u, st.v, st.tie, ( pu.x + pv.x ) / 2 - span / 2, ( pu.x + pv.x ) / 2 + span / 2, ( pu.y + pv.y ) / 2, 1, 1, 200 + i * 90 );
	} );
	sc.chain = way;
	sc.head = [ 'Your way to ', nameLink( GAME.to ), ' ', h( 'button', { type: 'button', class: 'turn again', title: 'Someone new to find, from somewhere new', onclick: newGame }, 'New game' ) ];
	sc.sub = [ h( 'b', null, K.plural( GAME.jumps, 'jump' ) ), ` from ${ first( GAME.from ) }` + ( GAME.par !== undefined ? `; the fewest it can be done in is ${ K.plural( GAME.par, 'hop' ) }` : '' ) ];
	return sc;
}

/**
 * "Know a connection? Tell us." (Justin, 17:40Z; re's spec, Cryptograss:Bacon graphs/Discovery, "The box"): plain
 * text, up to 2,000 characters, to Cryptograss talk:Connection inbox, written there by a system account so a
 * signed-out visitor's address is never published. The wiki keeps it as text: nothing in it is run or followed.
 */
function tellBox( about, from ) {
	const what = h( 'input', { type: 'text', maxlength: 200, value: about, 'aria-label': 'Who or what the connection is about' } );
	const note = h( 'textarea', { maxlength: 2000, rows: 4, placeholder: 'Who played with whom, and where: a record, a show, a night you were there. A way to reach you, if you want an answer.' } );
	const said = h( 'p', { class: 'sub', role: 'status' } );
	const send = h( 'button', { type: 'button', onclick: async () => {
		const text = note.value.trim(), who = what.value.trim();
		if ( !text ) {
			said.textContent = 'Write the connection first.';
			return;
		}
		if ( !who ) {
			// re's module (pickipedia:re/connection-note) takes no note without it.
			said.textContent = 'Say who or what it’s about.';
			return;
		}
		send.disabled = true;
		said.textContent = 'Sending…';
		try {
			const t = await wiki( { action: 'query', meta: 'tokens' } );
			// The caps are the module's own: about and from 200, the note 2,000.
			const r = await wiki( { action: 'connectionnote', about: who.slice( 0, 200 ), from: from.slice( 0, 200 ),
				note: text.slice( 0, 2000 ), token: t.query.tokens.csrftoken }, true );
			if ( r.connectionnote && r.connectionnote.result === 'Success' ) {
				note.value = '';
				said.replaceChildren( 'Thank you: it’s in the ', h( 'a', { href: HOME + '/wiki/Cryptograss_talk:Connection_inbox', target: '_top' }, 'inbox' ),
					'. If it turns into a walk, the link goes there too.' );
				return;
			}
			throw new Error( r.error ? r.error.info || r.error.code : 'no answer' );
		} catch ( err ) {
			said.replaceChildren( 'It didn’t go through (' + err.message + '). You can write it on the ',
				h( 'a', { href: HOME + '/wiki/Cryptograss_talk:Connection_inbox', target: '_top' }, 'inbox page' ), ' itself.' );
		} finally {
			send.disabled = false;
		}
	} }, 'Send' );
	return h( 'details', { class: 'tell' }, h( 'summary', null, 'Know a connection we don’t? Tell us' ),
		h( 'p', { class: 'sub' }, 'Plain text, read by a person. It’s public on the wiki, so leave contact info only if you want it seen.' ),
		what, note, h( 'div', { class: 'acts' }, send ), said );
}

/* ------------------------------------------------------------------------------------------------------------
 * Going places
 * --------------------------------------------------------------------------------------------------------- */

function label( v ) {
	if ( v.way ) {
		return 'Your way to ' + first( GAME.to );
	}
	if ( v.walk ) {
		return 'Your rabbithole';
	}
	if ( v.pg !== undefined ) {
		return v.pg;
	}
	if ( v.cut !== undefined && G.songcast[ v.cut ] ) {
		const c = G.songcast[ v.cut ];
		return c.song + ( c.on && c.on.length ? ' · ' + G.music[ c.on[ 0 ] ].title : '' );
	}
	if ( v.s !== undefined ) {
		return v.s;
	}
	if ( v.m !== undefined ) {
		const c = K.called( G, M( v.m ) );
		return c.name + ( c.glyph === 'show' && c.sub ? ' · ' + c.sub : '' );
	}
	return v.b === undefined ? first( v.a ) : first( v.a ) + ' ⟷ ' + first( v.b );
}

const same = ( v, w ) => !!v && !!w && v.a === w.a && v.b === w.b && v.m === w.m && v.s === w.s && v.cut === w.cut && v.pg === w.pg &&
	v.playing === w.playing;

/** Where each thing in sight is now, by what it stands for: a picker ('p' and their number) or a piece ('m' and its). */
function whereabouts() {
	const at = new Map();
	for ( const kind of [ 'node', 'pill' ] ) {
		for ( const [ , it ] of live[ kind ] ) {
			if ( !it.dead && it.d.is && !at.has( it.d.is ) ) {
				at.set( it.d.is, { x: it.x, y: it.y } );
			}
		}
	}
	return at;
}

/** Where each thing in a scene comes to rest, by what it stands for. */
function settled( sc ) {
	const at = new Map();
	for ( const part of [ sc.nodes, sc.pills ] ) {
		for ( const d of part.values() ) {
			if ( d.is && !at.has( d.is ) ) {
				at.set( d.is, { x: d.x, y: d.y } );
			}
		}
	}
	return at;
}

let turned = 0;                  // when the view last changed
let lost = '';                   // an address that named nothing the graph knows: said under the headline until the reader moves on

/**
 * The legend says what's in sight, and what's in sight goes by the room there is: the web wants so much, the step
 * further more. Were an entry coming in to wrap the legend onto another line, the frame would lose that line, the
 * view might no longer have the room, the entry would go, the frame would get its line back, and round again for
 * ever (seen at 1280 by 734 to 746, 14 Nov 2026, before this). So the legend is always as tall as it would be
 * with everything in it that a frame this wide could ever show.
 */
function steady() {
	const legend = $( 'legend' );
	const most = K.ego( { W: svg.clientWidth * ( coarse || MINI ? 1 : K.shrink( 1, 1, zoomed() ) ), H: 4000, named: 8, dots: 0, far: true } );   // as wide as it may ever be laid out
	legend.style.minHeight = '';
	stage.classList.remove( 'webbed', 'deep' );
	stage.classList.add( ...[ most.web && 'webbed', most.far && 'deep' ].filter( Boolean ) );
	const tall = legend.offsetHeight;
	stage.classList.remove( 'webbed', 'deep' );                      // show() says which of them the view has, once it knows
	legend.style.minHeight = tall + 'px';
	stage.style.setProperty( '--legend', tall + 'px' );             // the QR code sits just above it
}

/** Show the view. again: the same view, laid out afresh because the frame changed; everyone keeps the seat they had. */
function show( quick, again ) {
	was = again && scene ? settled( scene ) : whereabouts();
	if ( !again ) {
		turned = performance.now();
	}
	stage.classList.toggle( 'dual', view.m !== undefined || !!view.walk );
	stage.classList.toggle( 'walking', !!view.walk );
	document.querySelector( 'main' ).classList.toggle( 'walking', !!view.walk );
	steady();
	scene = view.way ? wayScene() : view.walk ? walkScene( view ) : view.pg !== undefined ? pageScene( view ) : view.cut !== undefined ? songScene( view ) : view.m !== undefined ? pieceScene( view ) : ( view.b === undefined ? egoScene( view ) : pairScene( view.a, view.b ) );
	stage.classList.toggle( 'webbed', !!scene.web );
	stage.classList.toggle( 'deep', !!scene.deep );
	$( 'say' ).firstElementChild.replaceChildren( ...scene.head.filter( Boolean ) );
	$( 'say' ).lastElementChild.replaceChildren( ...( lost && trail.length < 2 ? [ lost ] : scene.sub ) );
	put( scene, quick );
	keptSay();
	qrSay();
	fillPanel();
	$( 'pa' ).value = view.way || view.walk || view.pg !== undefined || view.cut !== undefined || view.s !== undefined ? '' : ( view.m !== undefined ? '' : first( view.a ) );
	$( 'pb' ).value = view.way || view.walk || view.pg !== undefined || view.m !== undefined || view.b === undefined ? '' : first( view.b );
	$( 'back' ).hidden = trail.length < 2;
	pathSay();
	document.title = label( view ) + ' · the connectome';
	closeSheet();
	hush();
}

/**
 * What stays in sight on the way from this view to the next: the connections the reader came by (Justin,
 * #connectome, 13 Nov 2026). Going to a picker, the pickers this view was about; going to a piece, the pickers
 * of the line it was on, and the other pieces named in sight; from one piece to the next, the one left behind.
 */
function carry( v ) {
	if ( !view || !scene || v.walk || v.way || v.pg !== undefined || v.b !== undefined || v.cut !== undefined || v.s !== undefined ||
		v.playing !== undefined ) {
		return v;                                                    // two pickers, a cut, a page or a solo: a view of its own, nothing brought along
	}
	if ( view.pg !== undefined ) {
		return v;                                                    // out of a page's graph: being on it together is no connection
	}
	// Out of a cut's graph (Justin, #connectome, 15 Nov 2026, 04:53Z): the way back is the cut itself — the
	// record's artist first, then the song's writer where they're on it, then the rest of the cut's ensemble
	// (K.homeward; 07:29Z); the line says the song, and plays it where the cut states a track.
	if ( v.a !== undefined && view.cut !== undefined && G.songcast && G.songcast[ view.cut ] ) {
		const entry = G.songcast[ view.cut ];
		const keep = K.homeward( entry, v.a ).slice( 0, 3 );
		const rec = ( entry.on || [] )[ 0 ];
		const track = rec !== undefined ? K.trackOn( G, rec, entry.song ) : undefined;
		return { a: v.a, keep, by: track !== undefined ? track : rec, via: view.cut };
	}
	if ( v.turn !== undefined && v.a === view.a && view.b === undefined && view.m === undefined ) {
		return { a: v.a, turn: v.turn, keep: view.keep, by: view.by, via: view.via };   // another turn: the same way in
	}
	const here = view.m !== undefined ? ( scene.tagged || [] ) : [ view.a, view.b ].filter( ( x ) => x !== undefined );
	if ( v.m === undefined ) {
		const keep = [ ...new Set( ( v.keep || [] ).concat( here ) ) ].filter( ( x ) => x !== v.a ).slice( 0, 3 );
		return { a: v.a, keep, by: view.m };
	}
	const pills = [ ...scene.pills.values() ].filter( ( p ) => p.stands === 'piece' && !p.more && !p.shy && p.piece !== v.m ).map( ( p ) => p.piece );
	return { m: v.m, hand: v.hand || here, keep: view.m !== undefined ? [ view.m ] : [ ...new Set( pills ) ].slice( 0, 2 ) };
}

/** The bar's address follows the view. Each step forward is one of the browser's too, so its Back comes back —
 *  the graph on a wiki page and the walk in Rabbithole's drawer alike (Justin, #rabbithole, 15 Nov 2026,
 *  item 4: after exploring from "your rabbithole", the back button "needs to take you back to your
 *  rabbithole graph"). A step back is the browser's as well: popstate, below, shows it. */
function stamp( step ) {
	// Out of a kept graph, at /bacon/<id>, the address is the page's own again: a bare ?p= would stay under the id.
	const at = KEPT ? '/bacon/' + KEPT.id : ( keptAt() ? '/bacon' : '' ) + address( view );
	history[ step ? 'pushState' : 'replaceState' ]( null, '', at );
}

function go( v, quiet ) {
	oracleDone();
	const left = !!KEPT && !!view;
	if ( left ) {
		v = leaveKept( v );                  // a click that goes further goes into today's graph
	}
	if ( !v.walk && !v.way && v.pg === undefined && v.m === undefined && v.s === undefined && v.b === v.a ) {
		v = { a: v.a };
	}
	view = carry( v );
	sel = { picker: null };
	trail.push( view );
	if ( trail.length > 60 ) {
		trail.shift();
	}
	show();
	stamp( !quiet && ( trail.length > 1 || left || fromOracle ) );
	fromOracle = false;
	if ( booted && !quiet ) {
		// The reader moved the graph, not Rabbithole's traverse: the player turns traverse off, and back on if
		// this is the song on now (Justin, #connectome, 18 Nov 2026).
		tell( { moved: true, cut: view.cut || null } );
	}
	// The page stays where the reader has it (Justin, #connectome, 15 Nov 2026: not to the top on every click).
	if ( GAME ) {
		gameStep();
	}
}

function choose( picked ) {
	Object.assign( sel, picked );
	show();
}

function back() {
	if ( trail.length < 2 ) {
		return;
	}
	history.back();                          // the browser's step, wherever the graph lives: popstate, below, shows it.
	                                         // One history, one way back — the ← here and the browser's Back agree.
}

/* ------------------------------------------------------------------------------------------------------------
 * The Oracle of Bluegrass Bacon: what /bacon opens on (Justin, #connectome, 19 Nov 2026, 07:10Z). A rocker of two,
 * challenge (the six degrees of bluegrass bacon) and explore (find music and connections and pickers). In a
 * challenge, whom to find, filled in from the address when it names someone, and "random" for someone else. Under
 * it, four mini constellations at random, each a track of a Permanent studio release or a picker on one
 * (K.oraclePick); a click on one begins there.
 * --------------------------------------------------------------------------------------------------------- */

const ORACLE = { mode: 'explore', goal: null };
let fromOracle = false;          // the first step out of the Oracle is one of the browser's too, so its Back comes back here

/** Open the Oracle: mode 'explore' or 'challenge'; goal, whom to find (someone at random when not given). */
function oracleSay( mode, goal, note ) {
	const box = $( 'oracle' );
	ORACLE.mode = mode;
	ORACLE.goal = mode !== 'challenge' ? null : ( goal !== undefined && goal !== null ? goal : K.oracleGoal( G ) );
	GAME = null;
	document.body.classList.toggle( 'challenge', mode === 'challenge' );
	document.body.classList.add( 'intro' );
	box.querySelectorAll( 'input[name="oracle-mode"]' ).forEach( ( r ) => {
		r.checked = r.value === mode;
	} );
	box.querySelector( '.ask' ).hidden = mode !== 'challenge';
	box.querySelector( '.note' ).textContent = note || '';
	oracleGoalSay();
	oracleMinis();
	box.hidden = false;
	gameSay();
	pathSay();
	document.title = 'The Oracle of Bluegrass Bacon';
	history.replaceState( null, '', mode === 'challenge' && ORACLE.goal !== null ? challengeAddress( ORACLE.goal ) : '/bacon' );
}

function oracleDone() {
	if ( $( 'oracle' ).hidden ) {
		return;
	}
	$( 'oracle' ).hidden = true;
	document.body.classList.remove( 'intro' );
}

/** Whom to find, in the box, and the rule, with their name a link to their page. */
function oracleGoalSay() {
	const box = $( 'oracle' );
	const rules = box.querySelector( '.rules' );
	if ( ORACLE.goal === null ) {
		box.querySelector( '#oracle-goal' ).value = '';
		rules.textContent = ORACLE.mode === 'challenge' ? 'Nobody here can be found from anywhere yet.' : '';
		return;
	}
	const to = P( ORACLE.goal );
	if ( document.activeElement !== box.querySelector( '#oracle-goal' ) ) {
		box.querySelector( '#oracle-goal' ).value = to.name;
	}
	const who = to.page ? h( 'a', { href: pageUrl( to.name ), target: '_top', title: to.name + "'s page on PickiPedia" }, to.name ) : h( 'b', null, to.name );
	rules.replaceChildren( 'Find ', who, " in six jumps or less and you win. Fail, and you'll have to play the banjo. In an otherwise decent and upstanding band. Forever." );
}

/** The four to start from, drawn small. */
function oracleMinis() {
	const box = $( 'oracle' );
	const picked = K.oraclePick( G, ORACLE.mode === 'challenge' ? ORACLE.goal : undefined );
	box.querySelector( '.pick' ).textContent = picked.length ? 'Pick where to start:' :
		'Nowhere here leads to them yet. Try someone else.';
	box.querySelector( '.minis' ).replaceChildren( ...picked.map( miniEl ) );
}

/** One mini constellation: a track and who's on it, or a picker and who they've played with most, as the graph draws them. */
function miniEl( it ) {
	const W = 200, H = 150, C = { x: 100, y: 70 };
	const svg = s( 'svg', { class: 'mini-g', viewBox: `0 0 ${ W } ${ H }`, 'aria-hidden': 'true' } );
	const around = ( it.kind === 'track' ? M( it.piece ).cast.slice() : K.company( G, it.id ).map( ( c ) => c.id ) ).slice( 0, 6 );
	const pts = around.map( ( id, i ) => {
		const a = -Math.PI / 2 + ( i + 0.5 ) * 2 * Math.PI / around.length;
		return { id, x: C.x + 62 * Math.cos( a ), y: C.y + 46 * Math.sin( a ), up: Math.sin( a ) < -0.3 };
	} );
	for ( const p of pts ) {
		svg.appendChild( s( 'line', { class: 'glow', x1: C.x, y1: C.y, x2: p.x, y2: p.y, 'stroke-width': 5 } ) );
		svg.appendChild( s( 'line', { class: 'core t2', x1: C.x, y1: C.y, x2: p.x, y2: p.y, 'stroke-width': 1.4 } ) );
	}
	const face = ( g, file, r ) => {
		if ( !file ) {
			return false;
		}
		const img = s( 'image', { class: 'face', href: FACE + encodeURIComponent( file.replace( / /g, '_' ) ) + '&width=90', x: -r, y: -r, width: 2 * r, height: 2 * r,
			preserveAspectRatio: 'xMidYMid slice', 'clip-path': `circle(${ r }px at ${ r }px ${ r }px)` } );
		img.addEventListener( 'error', () => img.remove() );
		g.appendChild( img );
		g.appendChild( s( 'circle', { class: 'ring rim', r } ) );
		return true;
	};
	for ( const p of pts ) {
		const g = s( 'g', { class: 'pk named', transform: `translate(${ p.x },${ p.y })` } );
		g.appendChild( s( 'circle', { class: 'ring', r: 8.5, 'stroke-width': 1.5 } ) );
		face( g, P( p.id ).img, 8.5 );
		// Each name over or under its own picker, inside the card, so no name runs into the next card's.
		g.appendChild( s( 'text', { class: 'mini-name', x: 0, y: p.up ? -12.5 : 19.5, 'text-anchor': 'middle' }, K.clip( first( p.id ), 13 ) ) );
		svg.appendChild( g );
	}
	const mid = s( 'g', { class: it.kind === 'track' ? 'pk mu subject t2' : 'pk subject', transform: `translate(${ C.x },${ C.y })` } );
	mid.appendChild( s( 'circle', { class: 'ring', r: 20 } ) );
	if ( it.kind === 'track' ) {
		if ( !cover( mid, G.music[ M( it.piece ).m ].art, 20, () => {} ) ) {
			const gl = glyph( 'track' );
			gl.setAttribute( 'transform', 'scale(1.5)' );
			mid.appendChild( gl );
		}
	} else if ( !face( mid, P( it.id ).img, 20 ) ) {
		mid.appendChild( rabbit( 0.8 ) );
	}
	svg.appendChild( mid );
	const c = it.kind === 'track' ? K.called( G, M( it.piece ) ) : null;
	const name = c ? c.name : first( it.id );
	const sub = c ? 'a track on ' + c.on : ( P( it.id ).inst || 'a picker' ) + ( around.length ? ', with ' + K.plural( K.company( G, it.id ).length, 'picker' ) : '' );
	return h( 'button', { type: 'button', class: 'mini ' + it.kind, title: ( ORACLE.mode === 'challenge' ? 'Start the challenge from ' : 'Start at ' ) + name,
		onclick: () => oracleBegin( it ) }, svg, h( 'b', null, name ), h( 'span', null, sub ) );
}

/** Begin where the reader picked: in a challenge, the game from there; else the graph there. */
function oracleBegin( it ) {
	const goal = ORACLE.mode === 'challenge' ? ORACLE.goal : null;
	fromOracle = true;
	if ( goal !== null ) {
		if ( it.kind === 'picker' ) {
			challenge( goal, it.id );
		} else {
			challengeDoor( goal, it.piece );
		}
		return;
	}
	document.body.classList.remove( 'challenge' );
	trail.length = 0;
	go( it.kind === 'picker' ? { a: it.id } : K.trackView( G, it.piece ) );
}

$( 'oracle' ).querySelectorAll( 'input[name="oracle-mode"]' ).forEach( ( r ) => r.addEventListener( 'change', () => {
	if ( G && r.checked ) {
		oracleSay( r.value, r.value === 'challenge' ? ORACLE.goal || undefined : undefined );
	}
} ) );
$( 'oracle' ).querySelector( '.random' ).addEventListener( 'click', () => {
	if ( !G ) {
		return;
	}
	let to = K.oracleGoal( G );
	for ( let i = 0; i < 6 && to === ORACLE.goal; i++ ) {
		to = K.oracleGoal( G );                                      // someone other than who it was
	}
	oracleSay( 'challenge', to );
} );
$( 'oracle-goal' ).addEventListener( 'change', () => {
	const to = G ? K.find( G, $( 'oracle-goal' ).value ) : null;
	if ( to === null ) {
		$( 'oracle' ).querySelector( '.note' ).textContent = `The connectome doesn't know “${ $( 'oracle-goal' ).value.trim() }” yet.`;
		return;
	}
	if ( to !== ORACLE.goal ) {
		oracleSay( 'challenge', to );
	}
} );

/* ------------------------------------------------------------------------------------------------------------
 * The way you came, at the foot of the graph (Justin, #connectome, 19 Nov 2026, 03:46Z: "at the bottom, let's keep
 * a flow-chart style graph going of where you've jumped, so that when you go back it kinda unwinds ... In fact -
 * let's do that everywhere, even outside challenge mode!"). Each place is a step, joined to the one before by an
 * arrow, the newest at the right; a step back takes the last ones off, the last first; a click on one goes back
 * there. In a challenge the steps are the chain of jumps the reader is on, each arrow numbered, and the goal waits
 * at the end. Not in Rabbithole's frames, where the player moves the graph.
 * --------------------------------------------------------------------------------------------------------- */

const drawnPath = [];            // the steps drawn, in order: { key, li }

/** A view as a step on the way: its key (one place twice in a row is one step), what it's called, the way back. */
function stepOf( v ) {
	if ( v.pg !== undefined ) {
		return { key: 'g' + v.pg, kind: 'page', label: v.pg, to: { pg: v.pg } };
	}
	if ( v.cut !== undefined || v.s !== undefined ) {
		return { key: 'c' + ( v.cut !== undefined ? v.cut : v.s ), kind: 'music', label: label( v ), to: v.cut !== undefined ? { cut: v.cut, s: v.s } : { s: v.s } };
	}
	if ( v.m !== undefined ) {
		return { key: 'm' + v.m, kind: 'music', label: label( v ), to: { m: v.m } };
	}
	if ( v.b !== undefined ) {
		return { key: 'p' + v.a + '-' + v.b, kind: 'pair', label: first( v.a ) + ' ⟷ ' + first( v.b ), to: { a: v.a, b: v.b } };
	}
	return { key: 'p' + v.a, kind: 'picker', id: v.a, label: first( v.a ), to: { a: v.a } };
}

/** The steps to draw: the challenge's chain, or the places the reader has been, each with where it is in the trail. */
function pathSteps() {
	if ( GAME ) {
		const door = GAME.door ? [ { key: 'door' + GAME.door.piece, kind: 'music', label: GAME.door.name, to: GAME.door.view, door: true } ] : [];
		return door.concat( GAME.path.map( ( id, j ) => ( { key: 'j' + j + '.' + id, kind: 'picker', id, label: first( id ), to: { a: id }, jump: j } ) ) );
	}
	const out = [];
	trail.forEach( ( v, ti ) => {
		if ( v.walk || v.way || v.playing !== undefined || ( v.a === undefined && v.m === undefined && v.cut === undefined && v.s === undefined && v.pg === undefined ) ) {
			return;
		}
		const st = Object.assign( stepOf( v ), { ti } );
		if ( out.length && out[ out.length - 1 ].key === st.key ) {
			out[ out.length - 1 ] = st;                              // another turn of the same place: still one step
		} else {
			out.push( st );
		}
	} );
	return out;
}

/** Back to a step: the chain unwinds to it, or the trail does, as the crumbs did. */
function pathBack( st ) {
	if ( GAME && st.door ) {
		if ( !atDoor( view ) ) {
			go( st.to );                                             // back to the track they came in by
		}
		return;
	}
	if ( GAME ) {
		if ( st.id !== view.a || view.b !== undefined || view.m !== undefined ) {
			go( { a: st.id } );
		}
		return;
	}
	if ( st.ti >= trail.length - 1 ) {
		return;
	}
	trail.splice( st.ti );                                       // it, and all since, come off; go() puts it back on
	go( st.to );
}

function stepEl( st, i ) {
	const p = st.kind === 'picker' ? P( st.id ) : null;
	const face = p && p.img ? h( 'img', { class: 'face', src: FACE + encodeURIComponent( p.img.replace( / /g, '_' ) ) + '&width=60', alt: '' } ) : null;
	if ( face ) {
		face.addEventListener( 'error', () => face.replaceWith( h( 'span', { class: 'mark picker', 'aria-hidden': 'true' } ) ) );
	}
	const n = GAME ? st.jump : undefined;                           // a jump's number; none into the track's first picker
	const hop = i > 0 ? h( 'span', { class: 'hop' + ( n > SIX ? ' over' : '' ), 'aria-hidden': 'true' }, n > 0 ? h( 'i', null, String( n ) ) : null ) : null;
	return h( 'li', { class: 'step ' + st.kind }, hop,
		h( 'button', { type: 'button', title: 'Back to ' + st.label, onclick: () => pathBack( st ) },
			face || h( 'span', { class: 'mark ' + st.kind, 'aria-hidden': 'true' } ), h( 'span', { class: 'nm' }, st.label ) ) );
}

function pathSay() {
	const nav = $( 'path' ), ol = nav.firstElementChild;
	const steps = !view || !G || HOST || view.way || view.walk ? [] : pathSteps();
	let keep = 0;
	while ( keep < steps.length && keep < drawnPath.length && steps[ keep ].key === drawnPath[ keep ].key ) {
		keep++;
	}
	// What's gone comes off the end, the last first: the way unwinds.
	drawnPath.splice( keep ).reverse().forEach( ( x, i ) => {
		x.li.classList.add( 'going' );
		x.li.style.transitionDelay = ( still ? 0 : i * 60 ) + 'ms';
		setTimeout( () => x.li.remove(), still ? 0 : 330 + i * 60 );
	} );
	const fresh = steps.slice( keep ).map( ( st, i ) => ( { key: st.key, li: stepEl( st, keep + i ) } ) );
	let at = keep ? drawnPath[ keep - 1 ].li : null;
	fresh.forEach( ( x, i ) => {
		x.li.classList.add( 'coming' );
		x.li.style.transitionDelay = ( still ? 0 : i * 60 ) + 'ms';
		if ( at ) {
			at.after( x.li );
		} else {
			ol.prepend( x.li );
		}
		at = x.li;
	} );
	drawnPath.push( ...fresh );
	drawnPath.forEach( ( x, i ) => x.li.classList.toggle( 'here', i === drawnPath.length - 1 ) );
	// In a challenge, whom they're finding, at the end of the way, as far off as they still are.
	const ghost = ol.querySelector( ':scope > li.goal' );
	if ( ghost ) {
		ghost.remove();
	}
	if ( GAME && !GAME.done && drawnPath.length ) {
		ol.append( h( 'li', { class: 'goal' }, h( 'span', { class: 'hop far', 'aria-hidden': 'true' } ),
			h( 'span', { class: 'target' }, '🎯 ', first( GAME.to ) ) ) );
	}
	nav.hidden = steps.length < ( GAME ? 1 : 2 );                 // outside a challenge, one place is no way yet
	stage.style.setProperty( '--path', nav.hidden ? '0px' : nav.offsetHeight + 'px' );   // the QR code sits above it too
	if ( fresh.length ) {
		void ol.offsetWidth;                                     // laid out closed, so they open
		fresh.forEach( ( x ) => x.li.classList.remove( 'coming' ) );
	}
	if ( !nav.hidden ) {                                         // the newest in sight, once the new ones have opened
		nav.scrollTo( { left: nav.scrollWidth, behavior: still ? 'auto' : 'smooth' } );
		setTimeout( () => nav.scrollTo( { left: nav.scrollWidth, behavior: still ? 'auto' : 'smooth' } ), still ? 0 : 380 );
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * A bacon graph kept as shared (Justin, #connectome, 16 Nov 2026): "a permalink that I can copy and paste to
 * someone and share that exact thing so they can explore all the same nodes, all the same connections". 🔗
 * keeps the view on the wiki as a page, Bacon:<id> (K.keep: the part of graph.json it stands on), and copies
 * /bacon/<id>. Opened, it is drawn from what was kept, by the same scenes; today's graph says what has changed
 * since, and a click that goes further goes into today's graph.
 * --------------------------------------------------------------------------------------------------------- */

/** The kept graph this address names, or ''. */
function keptAt() {
	const m = /^\/bacon\/([0-9a-z]{11})\/?$/.exec( location.pathname );
	return m && K.KEPT_ID.test( m[ 1 ] ) ? m[ 1 ] : '';
}

/** Everything drawn goes, at once: the next view is of another graph, whose numbers are not this one's. */
function forget() {
	for ( const kind of Object.keys( live ) ) {
		for ( const it of live[ kind ].values() ) {
			it.el.remove();
		}
		live[ kind ].clear();
	}
	was = new Map();
	scene = null;
	view = null;
	trail.length = 0;
}

/** The view to keep, as its page will hold it: who's in sight, the view's address, and the graph under them. */
function keptDoc( kind ) {
	const nodes = [ ...scene.nodes.values() ], tags = [ ...scene.pills.values() ].filter( ( p ) => p.stands === 'picker' );
	const pickers = [ ...new Set( nodes.filter( ( n ) => n.stands === 'picker' ).map( ( n ) => n.id )
		.concat( tags.flatMap( ( p ) => [ p.id, ...( p.who || [] ) ] ) ).filter( ( id ) => typeof id === 'number' ) ) ];
	const musics = [];
	const piece = ( id ) => {
		if ( id !== undefined && id !== null && M( id ) ) {
			musics.push( M( id ).m, ...( M( id ).also || [] ) );
		}
	};
	nodes.filter( ( n ) => n.stands === 'piece' ).forEach( ( n ) => piece( n.piece ) );
	[ view.m, view.by ].forEach( piece );
	[ view.cut, view.via ].forEach( ( cid ) => cid && G.songcast && G.songcast[ cid ] && musics.push( ...( G.songcast[ cid ].on || [] ) ) );
	const q = new URLSearchParams( rawAddress( view ).slice( 1 ) );
	q.delete( 'turn' );                          // the kept graph holds only who was in sight: its first turn is them
	// Whose every tie is kept: a constellation's middle, since who of their company is drawn is chosen from all of
	// it; a record's or a show's own pickers, since what else of theirs is drawn is chosen from all they're on.
	const hubs = kind === 'c' ? [ view.a ] : ( view.m !== undefined && M( view.m ) ? M( view.m ).cast : [] );
	return { bacon: 1, kind, view: '?' + q, built: RAW.built || '', on: pickers.map( first ), graph: K.keep( RAW, pickers, musics, hubs ) };
}

/** The kept graph's page: who's in it, as links (so each picker's page knows), and what was kept, unseen. */
function keptPage( id, doc, text ) {
	const named = doc.on.map( ( n ) => '* ' + ( /^[^#<>[\]{}|]+$/.test( n ) ? '[[:' + n + ']]' : n.replace( /[#<>[\]{}|]/g, '' ) ) );
	return `{{Bacon graph|kind=${ doc.kind }|id=${ id }|built=${ doc.built }|view=${ doc.view }}}\n${ named.join( '\n' ) }\n` +
		`<pre class="bacon-graph-data" style="display:none">${ text }</pre>\n`;
}

async function wiki( params, post ) {
	const q = new URLSearchParams( Object.assign( { format: 'json', formatversion: 2 }, params ) );
	const r = await fetch( '/api.php' + ( post ? '' : '?' + q ), post ? { method: 'POST', body: q, credentials: 'same-origin' } :
		{ credentials: 'same-origin', cache: 'no-store' } );
	if ( !r.ok ) {
		throw new Error( 'the wiki answered ' + r.status );
	}
	return r.json();
}

/** Keep the view in sight, and its link: { url, how }, how being 'kept', 'again' (a kept graph's own) or 'today' (not signed in). */
async function share() {
	if ( KEPT ) {
		return { url: location.origin + '/bacon/' + KEPT.id, how: 'again' };
	}
	const kind = K.kindOf( view );
	const doc = keptDoc( kind ), text = K.keptText( doc ), id = await K.keptId( kind, text );
	const who = await wiki( { action: 'query', meta: 'userinfo|tokens', type: 'csrf' } );
	if ( who.query.userinfo.anon ) {
		return { url: location.origin + '/bacon' + doc.view, how: 'today' };
	}
	const r = await wiki( { action: 'edit', title: 'Bacon:' + id, text: keptPage( id, doc, text ), summary: 'A bacon graph, kept as shared',
		createonly: 1, assert: 'user', token: who.query.tokens.csrftoken }, true );
	if ( !( r.edit && r.edit.result === 'Success' ) && !( r.error && r.error.code === 'articleexists' ) ) {
		throw new Error( r.error ? r.error.info || r.error.code : 'the wiki kept nothing' );
	}
	return { url: location.origin + '/bacon/' + id, how: 'kept' };
}

const SHARED = {
	kept: [ 'Kept as it is now, and the link copied.', 'Kept as it is now. Its link:' ],
	again: [ 'Copied: the link to this graph as it was kept.', 'The link to this graph as it was kept:' ],
	today: [ 'Copied a link to this view as it stands today. Sign in to the wiki to keep it as it is now.',
		'Sign in to the wiki to keep this graph as it is now. A link to it as it stands today:' ]
};

/** 🔗: the link goes to the clipboard as the click asked (a promise of it, which Safari needs), and is shown, to copy by hand. */
function onShare() {
	const btn = $( 'share' ), box = $( 'shared' );
	btn.disabled = true;
	const job = share();
	let copied = null;
	if ( window.ClipboardItem && navigator.clipboard && navigator.clipboard.write ) {
		copied = navigator.clipboard.write( [ new ClipboardItem( { 'text/plain': job.then( ( r ) => new Blob( [ r.url ], { type: 'text/plain' } ) ) } ) ] );
	} else if ( navigator.clipboard && navigator.clipboard.writeText ) {
		copied = job.then( ( r ) => navigator.clipboard.writeText( r.url ) );
	}
	Promise.allSettled( [ job, copied ] ).then( ( [ done, clip ] ) => {
		btn.disabled = false;
		if ( done.status === 'rejected' ) {
			console.error( done.reason );
			box.replaceChildren( h( 'span', null, "Couldn't keep this graph: " + ( ( done.reason && done.reason.message ) || done.reason ) + '.' ) );
		} else {
			const ok = !!copied && clip.status === 'fulfilled';
			box.replaceChildren( h( 'span', null, SHARED[ done.value.how ][ ok ? 0 : 1 ] ),
				h( 'input', { readonly: true, value: done.value.url, 'aria-label': 'The link', onfocus: ( e ) => e.target.select() } ) );
		}
		box.hidden = false;
		clearTimeout( onShare.t );
		onShare.t = setTimeout( () => {
			box.hidden = true;
		}, 15000 );
	} );
}

/** Out of a kept graph, into today's: the view asked for, said as an address in the kept graph, read in today's. */
function leaveKept( v ) {
	const there = new URLSearchParams( rawAddress( carry( v ) ).slice( 1 ) );
	G = KEPT.live;
	KEPT = null;
	forget();
	return parse( there ) || { a: K.landing( G ) };
}

/** A kept graph, opened: drawn from what was kept, with today's graph kept aside to say what has changed since. */
async function openKept( id ) {
	const live = KEPT ? KEPT.live : G;
	let doc = null, edited = false;
	try {
		const r = await fetch( '/index.php?' + new URLSearchParams( { title: 'Bacon:' + id, action: 'raw' } ), { cache: 'no-cache' } );
		const m = r.ok ? /<pre class="bacon-graph-data"[^>]*>([\s\S]*?)<\/pre>/.exec( await r.text() ) : null;
		if ( m ) {
			doc = JSON.parse( m[ 1 ].trim() );
			edited = await K.keptId( id[ 0 ], m[ 1 ].trim() ) !== id;
		}
	} catch ( err ) {
		console.error( err );
	}
	G = live;
	KEPT = null;
	forget();
	if ( !doc || !doc.graph ) {
		const start = K.landing( G );
		lost = `No bacon graph is kept as “${ id }”. Here is ${ first( start ) } instead.`;
		history.replaceState( null, '', '/bacon' );
		go( { a: start } );
		return;
	}
	const kept = K.build( doc.graph );
	KEPT = { id, doc, kept, live, since: K.since( kept, live, doc.on || [] ), edited };
	G = kept;
	view = parse( new URLSearchParams( doc.view ) ) || { a: 0 };
	trail.push( view );
	sel = { picker: null };
	lost = '';
	show();
	history.replaceState( null, '', '/bacon/' + id + ( HOST ? '?host=' + HOST : '' ) );
}

/**
 * The QR code in the corner (Justin, #connectome, 16 Nov 2026: "always a QR code visible. So if I'm showing someone
 * one, they can take a QR code of it with their phone and pick up right where I left off"): this view's own
 * address, or a kept graph's, as a reader would open it, not as Rabbithole frames it. Not for the walk, which
 * lives in the browser it was walked in.
 */
let qrFor = '';
function qrSay() {
	const box = $( 'qr' );
	box.hidden = MINI || !view || !!view.walk || !!view.way;            // the way found is a moment, not a place to pick up
	if ( box.hidden ) {
		return;
	}
	const here = /^\/bacon(\/|$)/.test( location.pathname ) ? '/bacon' : location.pathname.replace( /[^/]*$/, '' );
	const url = location.origin + ( KEPT ? '/bacon/' + KEPT.id : here + rawAddress( view ) );
	if ( url === qrFor ) {
		return;
	}
	qrFor = url;
	const p = K.qrPath( K.qrCode( url, 'L' ) );
	const pic = box.querySelector( 'svg' );
	pic.setAttribute( 'viewBox', `0 0 ${ p.side } ${ p.side }` );
	pic.firstElementChild.setAttribute( 'd', p.d );
	box.setAttribute( 'aria-label', 'A QR code of this view, ' + url + ': scan it to pick up here on a phone' );
}

/** What a kept graph says of itself, above it, and its lines marked where a source has gone since. */
function keptSay() {
	const box = $( 'kept' );
	box.hidden = !KEPT;
	$( 'share' ).hidden = MINI || !K.kindOf( view );
	for ( const it of live.line.values() ) {
		const d = it.d, st = KEPT && d && d.stands === 'tie' ? KEPT.since.state.get( K.pairName( first( d.u ), first( d.v ) ) ) : '';
		it.el.classList.toggle( 'kept-changed', st === 'changed' );
		it.el.classList.toggle( 'kept-gone', st === 'gone' );
	}
	if ( !KEPT ) {
		return;
	}
	const { since: n, doc } = KEPT;
	const lines = [];
	if ( n.changed || n.gone ) {
		lines.push( [ n.changed && K.plural( n.changed, 'line has', 'lines have' ) + ' lost a source since (dashed)',
			n.gone && K.plural( n.gone, 'line has', 'lines have' ) + ' lost every source (dotted)' ].filter( Boolean ).join( ', and ' ) + '.' );
	} else {
		lines.push( 'Every line in it still stands.' );
	}
	if ( n.grown ) {
		lines.push( K.plural( n.grown, 'new tie', 'new ties' ) + ' among these pickers since.' );
	}
	if ( KEPT.edited ) {
		lines.push( 'Its page has been edited since it was kept.' );
	}
	const today = new URLSearchParams( doc.view.slice( 1 ) );
	if ( HOST ) {
		today.set( 'host', HOST );                   // inside Rabbithole, the graph stays Rabbithole's
	}
	box.replaceChildren( h( 'b', null, `A ${ K.KINDS[ KEPT.id[ 0 ] ] }, kept as shared` ), doc.built ? ` from the graph of ${ doc.built }. ` : '. ',
		lines.join( ' ' ) + ' ', h( 'a', { href: '/bacon?' + today }, 'See it as it is today →' ) );
}

window.addEventListener( 'popstate', () => {
	if ( keptAt() ) {                           // back to a kept graph
		if ( G && ( !KEPT || KEPT.id !== keptAt() ) ) {
			openKept( keptAt() );
		}
		return;
	}
	if ( KEPT ) {                               // forward again, out of one
		G = KEPT.live;
		KEPT = null;
		forget();
	}
	const v = G && parse( new URLSearchParams( location.search ) );
	if ( !v ) {
		const goal = G ? K.challengeOf( location.pathname, location.search ) : null;
		if ( goal !== null ) {                                       // back to the Oracle, in a challenge
			const to = goal ? K.find( G, goal ) : null;
			oracleSay( 'challenge', to !== null ? to : undefined );
		} else if ( G && /^\/bacon\/?$/.test( location.pathname ) && !location.search ) {
			oracleSay( 'explore' );                                  // back to the Oracle
		}
		return;
	}
	if ( trail.length > 1 && same( v, trail[ trail.length - 2 ] ) ) {   // a step back: as it was shown before
		trail.pop();
		view = trail[ trail.length - 1 ];
	} else {
		view = carry( v );
		trail.push( view );
	}
	sel = { picker: null };
	show();
	if ( GAME ) {
		gameStep();                                                  // back in a challenge: the chain unwinds with it
	}
} );

/* ------------------------------------------------------------------------------------------------------------
 * The pointer, and the keys
 * --------------------------------------------------------------------------------------------------------- */

function say( at, title, lines, hint ) {
	tip.replaceChildren( h( 'b', null, title ), ...lines.filter( Boolean ).map( ( l ) => h( 'div', null, l ) ),
		hint ? h( 'span', { class: 'do' }, hint ) : null );
	tip.hidden = false;
	const box = stage.getBoundingClientRect(), r = at.getBoundingClientRect();
	const w = tip.offsetWidth, ht = tip.offsetHeight;
	const x = Math.max( 6, Math.min( box.width - w - 6, r.left + r.width / 2 - box.left - w / 2 ) );
	let y = r.top - box.top - ht - 8;
	if ( y < 6 ) {
		y = r.bottom - box.top + 8;
	}
	tip.style.left = x + 'px';
	tip.style.top = y + 'px';
}

function hush() {
	tip.hidden = true;
	svg.querySelectorAll( '.hot, .held' ).forEach( ( e ) => e.classList.remove( 'hot', 'held' ) );
}

/** Light a picker and the lines that reach them. */
function warm( key, on ) {
	const it = live.node.get( key );
	if ( !it ) {
		return;
	}
	it.el.classList.toggle( 'hot', on );
	for ( const [ , ln ] of live.line ) {
		if ( !ln.dead && ( ln.d.a === key || ln.d.b === key ) && ( ln.d.role !== 'direct' ) ) {
			ln.el.classList.toggle( 'hot', on );
		}
	}
	for ( const [ , pl ] of live.pill ) {                           // and what the line to them is, where it isn't said already
		if ( !pl.dead && pl.d.shy && ( pl.d.owner === key || ( pl.d.owners && pl.d.owners.includes( key ) ) ) ) {
			pl.el.classList.toggle( 'hot', on );
		}
	}
}

/** Where the web's lines lead from one of those round the middle: other( line ) says the far end, for a line that has this one at an end. */
function webFrom( other ) {
	return [ ...scene.lines.values() ].filter( ( l ) => l.role === 'web' ).map( other ).filter( ( x ) => x !== undefined );
}

/** Who one of the company leads on to, of those in sight a step further out. */
function onward( id ) {
	return ( scene.far || [] ).filter( ( f ) => f.by === id ).map( ( f ) => f.id );
}

function tieLines( u, v ) {
	const t = G.adj[ u ].get( v );
	if ( !t ) {
		return [];
	}
	const top = t.ev[ 0 ] ? K.naming( G, t.ev[ 0 ] ) : null;
	return [ `with ${ first( u ) }: ${ K.times( t ) }` + ( top && t.ev.length === 1 ? ` (${ K.clip( top.short, 40 ) })` : '' ) ];
}

/* ------------------------------------------------------------------------------------------------------------
 * What a mark stands for: a picker, a piece of music, or a tie (connectome-core.js's notes say why it is
 * asked this way). Each answer has the same parts:
 *
 *   kind    a word or two for what it is
 *   title   its name
 *   lines   what the sources say of it, here
 *   hint    what a click does, for the note beside a pointer
 *   acts    the ways on from it, the first being what a click does: { label, run } goes further into the
 *           graph; { label, href, kind: 'page' | 'play' | 'source' } leaves for a page, Rabbithole or a source
 * --------------------------------------------------------------------------------------------------------- */

const act = ( label, run ) => ( { label, run, kind: 'in' } );
const link = ( label, href, kind ) => ( { label, href, kind } );
const pageAct = ( id ) => link( P( id ).page ? first( id ) + "'s page" : 'Start ' + first( id ) + "'s page", pageUrl( first( id ) ), 'page' );

/** A picker a step further out: nobody the one in the middle has a tie to, but one of their company has played with them. */
function aFar( d ) {
	const id = d.id, name = first( id ), by = d.by;
	const also = K.company( G, id ).filter( ( c ) => c.id !== by && G.adj[ view.a ].has( c.id ) ).length;
	return { kind: 'a picker' + instOf( id ) + ' · two hops out', title: name, tipTitle: name + instOf( id ),
		lines: [ `two hops from ${ first( view.a ) }, by way of ${ first( by ) }` + ( also ? ` and ${ K.plural( also, 'other' ) }` : '' ), ...tieLines( by, id ) ],
		hint: 'click: go to ' + name,
		acts: [ act( 'Go to ' + name, () => go( { a: id, keep: [ by ] } ) ),
			act( `${ first( view.a ) } & ${ name }: the ways between`, () => go( { a: view.a, b: id } ) ), pageAct( id ) ] };
}

function aSong( d ) {
	const w = { kind: 'a song', title: d.title, tipTitle: d.title + ', a song', lines: [], hint: 'click a picker round it: go to them', acts: [] };
	if ( d.cuts && d.cuts.length ) {
		w.lines.push( 'on ' + d.cuts.map( ( c ) => c.title ).join( ', ' ) + ( d.cuts[ 0 ].date ? ', ' + d.cuts[ 0 ].date : '' ) );
	} else {
		w.lines.push( 'no cut the sources name' );
	}
	if ( G.plays[ d.title ] ) {
		w.lines.push( 'it plays in Rabbithole: the ▶ beside its name' );
	}
	return w;
}

/** A picker on a page's own graph: who of the page's own they played with; one a step out, whose company they're in. */
function aPickerOfPage( d ) {
	const id = d.id, name = first( id );
	const w = { kind: 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ), lines: [], hint: 'click: go to ' + name,
		acts: [ act( 'Go to ' + name, () => go( { a: id } ) ), pageAct( id ) ] };
	if ( d.by !== undefined && d.tie ) {
		w.kind += ' · a step out';
		w.lines.push( K.together( d.tie ) + ' with ' + first( d.by ) );
	} else {
		const here = ( G.pages[ view.pg ] || [] ).filter( ( o ) => o !== id && G.adj[ id ].has( o ) && G.adj[ id ].get( o ).played );
		w.lines.push( here.length ? 'played with ' + listNames( here ) + ', of those on the page' : 'played with none of the others on the page' );
	}
	return w;
}

/** The page in the middle of its own graph: what's round it, and the way to it. */
function aPage( d ) {
	return { kind: 'a page', title: d.title, tipTitle: d.title + ', a page',
		lines: [ K.plural( d.count, 'picker' ) + ' it links, round it', 'being on it together counts here, and nowhere else' ],
		hint: 'click a picker round it: go to them', acts: [ link( 'Open the page ↗', pageUrl( d.title ), 'page' ) ] };
}

/** A picker on a song's ring: what this cut's credits gave them, and where else they lead. */
function aPickerOfSong( d ) {
	const id = d.id, name = first( id ), role = d.cutOf ? d.cutOf.role : '';
	const w = { kind: 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ), lines: [],
		hint: 'click: go to ' + name, acts: [ act( 'Go to ' + name, () => go( { a: id } ) ) ] };
	if ( d.next ) {                                              // a road the walk can take from the song on now
		w.acts.push( act( 'Follow ' + name + ' to ' + K.clip( d.next.song, 28 ), () => tell( { play: d.next.cid, via: d.next.via } ) ) );
	}
	w.lines.push( role ? 'on this cut: ' + role : 'on this cut, and no instrument the sources name' );
	const web = webFrom( ( l ) => ( l.u === id ? l.v : ( l.v === id ? l.u : undefined ) ) );
	if ( web.length ) {
		w.lines.push( `and with ${ K.plural( web.length, 'other' ) } here: ${ listNames( web ) }` );
	}
	w.lines.push( K.plural( K.company( G, id ).length, 'picker' ) + ' played with, everywhere the sources know' );
	w.acts.push( pageAct( id ) );
	return w;
}

function aPicker( d ) {
	if ( view.pg !== undefined ) {
		return aPickerOfPage( d );
	}
	if ( d.song !== undefined ) {
		return aPickerOfSong( d );
	}
	if ( d.by !== undefined ) {
		return aFar( d );
	}
	const id = d.id, name = first( id );
	const w = { kind: 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ), lines: [], hint: 'click: go to ' + name, acts: [] };
	const goTo = act( 'Go to ' + name, () => go( { a: id } ) );
	if ( view.b === undefined ) {
		if ( id === view.a ) {
			w.lines.push( P( id ).page ? '' : 'no page yet' );
			w.hint = 'click anyone around them: go to them';
		} else if ( !d.tie ) {                                       // a step on the way a challenge was found by: no one in the middle to share with
			w.lines.push( P( id ).page ? '' : 'no page yet' );
			w.acts.push( goTo );
		} else {
			const top = K.naming( G, d.tie.ev[ 0 ] );
			const web = webFrom( ( l ) => ( l.u === id ? l.v : ( l.v === id ? l.u : undefined ) ) );
			w.lines.push( K.together( d.tie ), K.clip( top.short, 44 ) + ( d.tie.ev.length > 1 ? `, and ${ d.tie.ev.length - 1 } more` : '' ),
				web.length ? `and with ${ K.plural( web.length, 'other' ) } here: ${ listNames( web ) }` : '',
				onward( id ).length ? 'and on to ' + listNames( onward( id ) ) : '' );
			w.acts.push( goTo, act( `${ name } & ${ first( view.a ) }: what they share`, () => go( { a: view.a, b: id } ) ) );
		}
	} else if ( id === view.a || id === view.b ) {
		w.lines.push( K.plural( K.company( G, id ).length, 'picker' ) + ' played with' );
		w.acts.push( goTo );
	} else {
		const on = sel.picker === id;
		w.lines.push( ...tieLines( view.a, id ), ...tieLines( view.b, id ) );
		w.acts.push( goTo, act( scene.chain ? 'Light this way across' : ( on ? 'Let go of ' + name : 'Light the way through ' + name ),
			() => choose( { picker: on ? null : id } ) ) );
	}
	w.acts.push( pageAct( id ) );
	return w;
}

/** A picker who is a line: on a tag, or the line itself, between the piece in the middle and another. */
function aPickerBetween( d ) {
	const id = d.who[ 0 ], name = first( id );
	const w = { kind: ( d.who.length > 1 ? K.plural( d.who.length, 'picker' ) + ' on both · ' : '' ) + 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ),
		lines: [ 'on both ' + K.called( G, M( d.px ) ).name + ' and ' + K.called( G, M( d.py ) ).name, d.who.length > 1 ? 'as ' + ( d.who.length > 2 ? 'are ' : 'is ' ) + listNames( d.who.slice( 1 ) ) : '' ],
		hint: 'click: go to ' + name, acts: d.who.slice( 0, 4 ).map( ( p ) => act( 'Go to ' + first( p ), () => go( { a: p, keep: d.who } ) ) ) };
	w.acts.push( pageAct( id ) );
	return w;
}

function theRest( d ) {
	return { kind: 'more of the same', title: d.label, lines: [ 'everything they share is in the list' ], hint: '', acts: [ act( 'See the list', () => {
		choose( { picker: d.u === view.a && d.v === view.b ? null : sel.picker } );
		const top = $( 'together' );
		if ( top ) {
			top.scrollIntoView( { block: 'start' } );
		}
	} ) ] };
}

/** A piece of music on a line between two pickers. Its click turns the graph inside out, with the piece in the middle. */
function aPiece( d ) {
	const pc = M( d.piece ), m = G.music[ d.e.m ], n = K.naming( G, d.e );
	const w = { kind: m.kind === 'show' ? 'a show' : ( n.glyph === 'track' ? ( d.e.songs.length > 1 ? 'tracks on a record' : 'a track' ) : 'a record' ),
		title: n.short, lines: [ n.long !== n.short ? n.long : '', d.e.songs.length > 1 ? d.e.songs.slice( 0, 6 ).join( ', ' ) + ( d.e.songs.length > 6 ? ', …' : '' ) : '',
			K.TIER_NAME[ m.tier ] + ' · ' + sourceName( m.source ) ], hint: "click: go to it · who's on it, and where they lead",
		acts: [ act( 'Go to ' + K.clip( K.called( G, pc ).name, 30 ), () => go( { m: d.piece, hand: [ d.u, d.v ] } ) ) ] };
	for ( const song of d.e.songs.slice( 0, 3 ) ) {
		const to = K.playOf( G, m, song );
		if ( to ) {
			w.acts.push( link( 'Play ' + song, HOME + to, 'play' ) );
		}
	}
	if ( m.page ) {
		w.acts.push( link( m.kind === 'show' ? "The show's page" : "The record's page", wikiUrl( m.page ), 'page' ) );
	}
	if ( m.source ) {
		w.acts.push( link( 'Check it at ' + sourceName( m.source ) + ' ↗', m.source, 'source' ) );
	}
	return w;
}

/** A piece of music that is a circle: the one in the middle, or one its pickers lead to. */
function aPieceAmong( d ) {
	const pc = M( d.piece ), m = G.music[ pc.m ], c = K.called( G, pc );
	const w = { kind: pc.kind === 'show' ? 'a show' : ( pc.kind === 'track' ? 'a track' : 'a record' ), title: c.name + ( pc.kind === 'show' && c.sub ? ' · ' + c.sub : '' ),
		lines: [ pc.kind === 'track' ? 'on ' + c.long : ( pc.kind === 'show' ? c.long : c.sub ) ], hint: 'click: go to it', acts: [] };
	if ( d.piece === view.m ) {
		w.lines.push( K.plural( pc.cast.length, 'picker' ) + ' on it, of those the sources here name' );
		w.hint = 'click a picker on a line: go to them';
	} else {
		const web = webFrom( ( l ) => ( l.px === d.piece ? l.py : ( l.py === d.piece ? l.px : undefined ) ) );
		w.lines.push( 'by way of ' + listNames( d.who ), web.length ? `shares pickers with ${ K.plural( web.length, 'other' ) } here` : '' );
		w.acts.push( act( 'Go to ' + K.clip( c.name, 30 ), () => go( { m: d.piece, hand: d.who } ) ) );
	}
	w.lines.push( K.TIER_NAME[ m.tier ] + ' · ' + sourceName( m.source ) );
	w.acts.push( ...waysOut( pc ) );
	return w;
}

/** A line a step out from the middle: how the far one is reached, and the way to see them and the middle together. */
function aFarLine( d ) {
	const t = d.tie, top = K.naming( G, t.ev[ 0 ] );
	return { kind: 'two hops', title: `${ first( view.a ) } ⟷ ${ first( d.c ) }`,
		lines: [ `by way of ${ first( d.u ) }: ${ K.together( t ) }`, K.clip( top.short, 44 ) ], hint: 'click: open these two',
		acts: [ act( 'Open these two', () => go( { a: view.a, b: d.c } ) ) ] };
}

function aTie( d ) {
	const t = d.tie, top = K.naming( G, t.ev[ 0 ] );
	const w = { kind: 'two pickers', title: `${ first( d.u ) } & ${ first( d.v ) }`,
		lines: [ K.together( t ), K.clip( top.short, 44 ) + ( t.ev.length > 1 ? `, and ${ t.ev.length - 1 } more` : '' ) ], hint: '', acts: [] };
	if ( view.b === undefined ) {
		w.hint = 'click: open these two';
		w.acts.push( act( 'Open these two', () => go( { a: view.a, b: d.c } ) ) );
	} else if ( d.role === 'direct' ) {
		w.acts.push( act( 'Everything they share', () => {
			choose( { picker: null } );
			if ( narrow() && $( 'together' ) ) {
				$( 'together' ).scrollIntoView( { block: 'start' } );
			}
		} ) );
	} else {
		w.hint = 'click: light this way across';
		w.acts.push( act( 'Light this way across', () => choose( { picker: d.c } ) ), act( 'Open these two', () => go( { a: d.u, b: d.v } ) ) );
	}
	return w;
}

function what( g ) {
	const kind = g.dataset.kind, it = live[ kind ].get( g.dataset.k );
	if ( !it || it.dead ) {
		return null;
	}
	const d = it.d, out = view.m !== undefined;                      // out: the graph is inside out
	switch ( d.stands ) {
		case 'picker':
			return d.step !== undefined ? aVia( d ) : ( out ? aPickerBetween( d ) : aPicker( d ) );
		case 'piece':
		case 'loose':
			return d.road !== undefined ? aRoad( d ) : d.step !== undefined ? aStep( d ) : ( d.more ? theRest( d ) : ( out ? aPieceAmong( d ) : aPiece( d ) ) );
		case 'song':
			return aSong( d );
		case 'page':
			return aPage( d );
		case 'thread':
			return d.quiet ? null : ( d.step !== undefined ? aVia( d ) : aPickerBetween( d ) );
		case 'day':
		case 'roadname':
			return null;
		default:
			return d.quiet ? null : ( d.role === 'far' ? aFarLine( d ) : aTie( d ) );
	}
}

function hover( g ) {
	const w = what( g );
	if ( !w ) {
		return;
	}
	if ( g.dataset.kind === 'node' ) {
		warm( g.dataset.k, true );
	} else {
		g.classList.add( 'hot' );
	}
	say( g, w.tipTitle || w.title, w.lines, w.hint );
}

function click( g ) {
	const w = what( g ), go1 = w && w.acts[ 0 ];
	if ( go1 && go1.run ) {
		go1.run();
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * A finger. It can't hover, so its first touch asks and doesn't act: a sheet says what was touched, with every
 * way on from it as a button and × (or a touch on the open graph) to go back to exploring. A second touch on
 * the same mark does what a click does. A finger is blunt, too: the picker nearest the touch is the one meant,
 * not whichever bead's halo happens to lie on top.
 * --------------------------------------------------------------------------------------------------------- */

function openSheet( g ) {
	const w = what( g );
	if ( !w ) {
		return;
	}
	closeSheet();
	held = g.dataset.k;
	g.classList.add( 'held' );
	if ( g.dataset.kind === 'node' ) {
		warm( held, true );
	} else {
		g.classList.add( 'hot' );
	}
	const go1 = w.acts[ 0 ];
	sheet.replaceChildren( ...[
		h( 'button', { type: 'button', class: 'x', 'aria-label': 'Back to the graph', onclick: closeSheet }, '×' ),
		h( 'div', { class: 'k' }, w.kind ),
		h( 'b', null, w.title ),
		...w.lines.filter( Boolean ).map( ( l ) => h( 'div', { class: 'l' }, l ) ),
		h( 'div', { class: 'acts' }, w.acts.map( ( a ) => a.href ?
			h( 'a', { class: a.kind, href: a.href, target: a.kind === 'source' ? '_blank' : '_top', rel: a.kind === 'source' ? 'noopener' : null },
				a.kind === 'play' ? playMark() : null, a.label ) :
			h( 'button', { type: 'button', class: a === go1 ? 'in first' : 'in', onclick: () => {
				closeSheet();
				a.run();
			} }, a.label ) ) ),
		go1 && go1.run ? h( 'div', { class: 'again' }, 'or touch it again' ) : null ].filter( Boolean ) );
	const at = g.getBoundingClientRect(), box = stage.getBoundingClientRect();
	// Out of the way of what it's about: on the other half of the frame, and no taller than the room there, or
	// "touch it again" would have nothing left to touch (seen at phone size, 15 Nov 2026: a tall sheet lay on its own mark).
	const up = at.top + at.height / 2 > box.top + box.height / 2;
	sheet.classList.toggle( 'up', up );
	sheet.style.maxHeight = '';
	sheet.hidden = false;
	const space = ( up ? at.top - box.top : box.bottom - at.bottom ) - 18;
	if ( sheet.offsetHeight > space ) {
		sheet.style.maxHeight = Math.max( 110, space ) + 'px';
	}
}

function closeSheet() {
	if ( held !== null ) {
		held = null;
		sheet.hidden = true;
		hush();
	}
}

/** The mark a pointer is on; for a finger, the picker nearest it within reach, before any line or bead under it. */
function pick( e ) {
	const g = e.target.closest( '[data-k]' );
	if ( !fingers || ( g && g.dataset.kind === 'pill' ) ) {
		return g;
	}
	const at = new DOMPoint( e.clientX, e.clientY ).matrixTransform( svg.getScreenCTM().inverse() );
	const x = at.x, y = at.y;                                       // in the drawing's own units
	let best = null, reach = 30;
	for ( const [ , it ] of live.node ) {
		const dist = it.dead || it.o < 0.05 ? Infinity : Math.hypot( it.x - x, it.y - y );
		if ( dist < reach ) {
			reach = dist;
			best = it.el;
		}
	}
	return best || g;
}

document.addEventListener( 'pointerdown', ( e ) => {
	fingers = e.pointerType === 'touch' || e.pointerType === 'pen';
}, true );

let wheeled = 0, wheelSum = 0;
svg.addEventListener( 'wheel', ( e ) => {
	if ( MINI || !view || view.walk ) {
		return;                                                      // the walk scrolls, and the dock is too small to go closer
	}
	e.preventDefault();
	wheelSum += e.deltaMode === 1 ? e.deltaY * 16 : ( e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY );
	if ( Math.abs( wheelSum ) < 40 ) {
		return;                                                      // a notch is 100 (Chrome) or 3 lines (Firefox); a trackpad nudges
	}
	const to = Math.max( 0, Math.min( CLOSER.length - 1, closer + ( wheelSum < 0 ? 1 : -1 ) ) );
	wheelSum = 0;
	if ( to !== closer ) {
		closer = to;
		cancelAnimationFrame( wheeled );
		wheeled = requestAnimationFrame( () => show( true, true ) );
	}
}, { passive: false } );
svg.addEventListener( 'pointerover', ( e ) => {
	if ( e.pointerType && e.pointerType !== 'mouse' ) {
		return;                                                      // a finger doesn't hover: its touch opens the sheet
	}
	const g = e.target.closest( '[data-k]' );
	hush();
	if ( g ) {
		hover( g );
	}
} );
svg.addEventListener( 'pointerleave', () => {
	if ( held === null ) {
		hush();
	}
} );
svg.addEventListener( 'focusin', ( e ) => {
	if ( fingers ) {
		return;                                                      // a touch gives the mark the focus too: the sheet answers it
	}
	const g = e.target.closest( '[data-k]' );
	hush();
	if ( g ) {
		hover( g );
	}
} );
svg.addEventListener( 'focusout', () => {
	if ( held === null ) {
		hush();
	}
} );
svg.addEventListener( 'click', ( e ) => {
	const a = e.target.closest( 'a' );
	if ( a && ( a.classList.contains( 'play' ) || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) ) {
		return;                                                      // the way into Rabbithole, or a new tab asked for: the browser goes
	}
	if ( a ) {
		e.preventDefault();                                          // a name goes where its mark goes: to them, here
	}
	const g = pick( e );
	if ( fingers ) {
		if ( svg.contains( document.activeElement ) ) {
			document.activeElement.blur();                           // a touch isn't the keyboard: no ring left round the mark
		}
		if ( g && g.dataset.k === held ) {                           // touched again: go on in
			closeSheet();
			click( g );
		} else if ( g ) {
			openSheet( g );
		} else if ( held !== null ) {
			closeSheet();
		} else if ( sel.picker !== null ) {
			choose( { picker: null } );
		}
		return;
	}
	if ( g ) {
		click( g );
	} else if ( sel.picker !== null ) {
		choose( { picker: null } );
	}
} );
svg.addEventListener( 'keydown', ( e ) => {
	const g = e.target.closest && e.target.closest( '[data-k]' );
	if ( g && ( e.key === 'Enter' || e.key === ' ' ) && !e.target.closest( 'a' ) ) {
		e.preventDefault();
		click( g );
	}
} );

document.addEventListener( 'keydown', ( e ) => {
	if ( e.key !== 'Escape' ) {
		return;
	}
	if ( !$( 'faq' ).hidden ) {
		closeFaq();
	} else if ( held !== null ) {
		closeSheet();
	} else if ( sel.picker !== null ) {
		choose( { picker: null } );
	} else if ( window.parent !== window ) {
		window.parent.postMessage( { connectome: 'close' }, location.origin );
	}
} );

/*
 * The FAQ (Justin, #connectome, 18 Nov 2026, 17:39Z: "a FAQ for TOoBB, on a wiki page, that will be available in the
 * styling of the graph, and linked from it"). The words are the wiki page's, Cryptograss:Bacon graphs/FAQ, asked for
 * each time it opens, so an edit there shows here at once; only the look is this page's. The bar's FAQ is a real link
 * to that page (a new tab, or no script, gets the page itself); a plain click opens it over the graph instead, and
 * ?faq in the address opens it from the start. What the wiki marks as not yet checked by a person stays marked.
 */
const FAQ_PAGE = 'Cryptograss:Bacon_graphs/FAQ';
let faqFrom = null;

/** The wiki's HTML for the page, made inert here: no script, style, frame or form, no on* or javascript:, and each
 *  link told where to open (the graph's own in this frame, the wiki's over it, anywhere else in a new tab). */
function faqBody( html ) {
	const doc = new DOMParser().parseFromString( html, 'text/html' );
	doc.querySelectorAll( 'script, style, link, meta, iframe, object, embed, form, input, button, textarea, select, .toc, #toc, .mw-editsection' )
		.forEach( ( e ) => e.remove() );
	doc.querySelectorAll( '*' ).forEach( ( e ) => {
		[ ...e.attributes ].forEach( ( at ) => {
			if ( /^on/i.test( at.name ) || ( /href|src|action/i.test( at.name ) && /^\s*(javascript|data|vbscript):/i.test( at.value ) ) ) {
				e.removeAttribute( at.name );
			}
		} );
	} );
	doc.querySelectorAll( 'a[href]' ).forEach( ( a ) => {
		const href = a.getAttribute( 'href' );
		if ( href.charAt( 0 ) === '#' ) {
			return;
		}
		const u = new URL( href, location.href );
		if ( u.origin !== location.origin ) {
			a.target = '_blank';
			a.rel = 'noopener';
		} else {
			a.target = /^\/bacon(\/|$)/.test( u.pathname ) ? '_self' : '_top';
		}
	} );
	return [ ...doc.body.childNodes ];
}

function openFaq( from ) {
	const box = $( 'faq' ), body = box.querySelector( '.faq-body' );
	faqFrom = from || document.activeElement;
	box.hidden = false;
	box.scrollTop = 0;
	$( 'faqlink' ).setAttribute( 'aria-expanded', 'true' );
	body.replaceChildren( h( 'p', { class: 'faq-note' }, 'Asking the wiki…' ) );
	box.querySelector( '.x' ).focus();
	wiki( { action: 'parse', page: FAQ_PAGE, prop: 'text', disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 } ).then( ( r ) => {
		if ( !r.parse || !r.parse.text ) {
			throw new Error( r.error ? r.error.info : 'no page' );
		}
		body.replaceChildren( ...faqBody( r.parse.text ) );
		if ( body.querySelector( '.bot-proposal' ) ) {
			body.prepend( h( 'p', { class: 'faq-note' }, 'What\'s marked unverified was written by an emergent and hasn\'t been checked by a person yet.' ) );
		}
	} ).catch( () => {
		body.replaceChildren( h( 'p', {}, "The answers didn't come. ", h( 'a', { href: '/wiki/' + FAQ_PAGE, target: '_top' }, 'Read them on PickiPedia ↗' ) ) );
	} );
}

function closeFaq() {
	$( 'faq' ).hidden = true;
	$( 'faqlink' ).setAttribute( 'aria-expanded', 'false' );
	if ( faqFrom && faqFrom.focus && document.contains( faqFrom ) ) {
		faqFrom.focus();
	}
}

$( 'faqlink' ).addEventListener( 'click', ( e ) => {
	if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
		return;
	}
	e.preventDefault();
	if ( $( 'faq' ).hidden ) {
		openFaq( e.currentTarget );
	} else {
		closeFaq();
	}
} );
$( 'faq' ).querySelector( '.x' ).addEventListener( 'click', closeFaq );
if ( new URLSearchParams( location.search ).has( 'faq' ) ) {
	openFaq();
}

$( 'back' ).addEventListener( 'click', back );
$( 'share' ).addEventListener( 'click', onShare );
$( 'qr' ).addEventListener( 'click', () => $( 'qr' ).classList.toggle( 'big' ) );

let finder = new Map();          // everything the boxes can find, by its name in small letters (K.catalogue)

/** What a box holds: a picker, a song's cut, a show, a record, a track; or nothing the graph knows. */
function found( box ) {
	const hit = finder.get( $( box ).value.trim().toLowerCase() );
	return hit ? hit.view : null;
}

/**
 * A box was filled. A song, a show or a record has the view to itself, whichever box it was typed in; two pickers
 * are shown together; one picker alone.
 */
function typed( ev ) {
	const here = found( ev.target.id ), x = found( 'pa' ), y = found( 'pb' );
	if ( here && here.a === undefined ) {
		if ( !same( view, here ) ) {
			go( here );
		}
		return;
	}
	const a = x && x.a !== undefined ? x.a : null, b = y && y.a !== undefined ? y.a : null;
	if ( a === null && b === null ) {
		$( 'pa' ).value = view && view.a !== undefined ? first( view.a ) : '';
		return;
	}
	const next = a === null || b === null || b === a ? { a: a === null ? b : a } : { a, b };
	if ( !view || next.a !== view.a || next.b !== view.b || view.m !== undefined || view.s !== undefined ) {
		go( next );
	}
}
[ 'pa', 'pb' ].forEach( ( id ) => {
	$( id ).addEventListener( 'change', typed );
	$( id ).addEventListener( 'focus', ( e ) => e.target.select() );
} );

// The drawer (Justin, #connectome, 15 Nov 2026): the list folds away at any width, and stays as the reader left
// it. The graph's frame grows into the room, and the observer below lays the view out again.
const drawer = $( 'drawer' ), mainEl = drawer.parentElement;
function fold( shut ) {
	mainEl.classList.toggle( 'shut', shut );
	drawer.setAttribute( 'aria-expanded', String( !shut ) );
	drawer.title = shut ? 'Show the list' : 'Hide the list';
	drawer.querySelector( '.chev' ).textContent = shut ? '‹' : '›';
	drawer.querySelector( '.word' ).textContent = shut ? 'Show the list' : 'Hide the list';
}
try {
	fold( localStorage.getItem( 'connectome-list' ) === 'shut' );
} catch ( e ) {}                                                   // storage refused: the list starts open
drawer.addEventListener( 'click', () => {
	const shut = !mainEl.classList.contains( 'shut' );
	fold( shut );
	try {
		localStorage.setItem( 'connectome-list', shut ? 'shut' : 'open' );
	} catch ( e ) {}
} );

/** A challenge's own address: /bacon/challenge/<name>, an underscore for a space. */
function challengeAddress( to ) {
	return '/bacon/challenge/' + encodeURIComponent( first( to ) ).replace( /%20/g, '_' );
}

// Another name in the box: that one's challenge, at its own address.
$( 'goal' ).addEventListener( 'change', () => {
	const to = G ? K.find( G, $( 'goal' ).value ) : null;
	if ( to === null || ( GAME && to === GAME.to ) ) {
		return;
	}
	oracleSay( 'challenge', to );
} );
$( 'restart' ).addEventListener( 'click', () => {
	if ( G && GAME ) {
		if ( GAME.done ) {
			newGame();
		} else {
			oracleSay( 'challenge', GAME.to );                       // the same one to find, from somewhere new: pick where
		}
	}
} );

/**
 * A new game: someone new to find, from somewhere new, on its landing (Justin, #connectome, 19 Nov 2026, 05:44Z:
 * "When you get to the end, it needs to be easy to start a new game with a new goal and new starting place").
 */
function newGame() {
	let to = K.oracleGoal( G );
	for ( let i = 0; i < 6 && GAME && to === GAME.to; i++ ) {
		to = K.oracleGoal( G );                                      // someone other than the one just found, when there is
	}
	if ( to === null ) {
		return;
	}
	oracleSay( 'challenge', to );
}

let sized = 0;
new ResizeObserver( () => {
	cancelAnimationFrame( sized );
	sized = requestAnimationFrame( () => {
		if ( G && view ) {
			// A new view's own headline can wrap and so resize the frame a moment after it is shown: that mustn't
			// cut its slide short. Any other resize is a window being dragged, and nothing swims after it.
			show( performance.now() - turned > 700, true );
		}
	} );
} ).observe( svg );

/* ------------------------------------------------------------------------------------------------------------ */

// While the graph's data is on its way, the walk still says itself out of the browser's own store (Justin,
// #rabbithole, 15 Nov 2026, item 5: the dock "seems to be blank"): the songs it holds, named, the one followed
// named between. Gone once the graph is read — the drawn walk takes over.
if ( new URLSearchParams( location.search ).has( 'walk' ) ) {
	const all = storedWalk();
	const hops = all.slice( -4 );
	const boot = h( 'div', { class: 'walk-boot', id: 'walk-boot' } );
	if ( all.length > hops.length ) {
		boot.appendChild( h( 'span', { class: 'arrow' }, '…' ) );
	}
	hops.forEach( ( hop, i ) => {
		if ( i ) {
			boot.appendChild( h( 'span', { class: 'arrow' }, hop.via && hop.via.name ? hop.via.name + ' →' : '→' ) );
		}
		boot.appendChild( h( 'b', null, hop.song || hop.cid.slice( 0, 8 ) ) );
	} );
	stage.insertBefore( boot, stage.firstChild );
}

// graph.json is beside this script, wherever the page is: /bacon, or the old address.
fetch( new URL( 'graph.json', import.meta.url ) ).then( ( r ) => {
	if ( !r.ok ) {
		throw new Error( r.status );
	}
	return r.json();
} ).then( ( g ) => {
	RAW = g;
	G = K.build( g );
	const all = K.catalogue( G );
	finder = new Map( all.map( ( x ) => [ x.label.toLowerCase(), x ] ) );
	$( 'names' ).replaceChildren( ...all.map( ( x ) => h( 'option', { value: x.label } ) ) );
	$( 'wait' ).remove();
	const bootPills = $( 'walk-boot' );
	if ( bootPills ) {
		bootPills.remove();
	}
	if ( keptAt() ) {
		openKept( keptAt() );
		return;
	}
	const goal = K.challengeOf( location.pathname, location.search );
	if ( goal !== null ) {
		// No one named (/bacon/challenge): someone at random, and the address names them, so a reload or a link keeps them.
		const to = goal === '' ? K.oracleGoal( G ) : K.find( G, goal );
		if ( to !== null ) {
			const here = K.find( G, new URLSearchParams( location.search ).get( 'p' ) );     // a reload mid-game starts from there
			if ( here !== null ) {
				challenge( to, here );
			} else {
				oracleSay( 'challenge', to );
			}
			booted = true;
			return;
		}
		lost = goal ? `The connectome doesn't know “${ goal }” yet, so there's no one to find. Here is someone it knows.` :
			'Nobody here can be found from anywhere yet. Here is someone the connectome knows.';
	}
	const q = new URLSearchParams( location.search );
	const asked = q.get( 'm' ) || q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' );
	const v = parse( q );
	if ( v ) {
		go( v );
	} else if ( !asked && !HOST && !MINI && !q.get( 'cut' ) && !q.get( 'playing' ) && !lost ) {
		oracleSay( 'explore' );                                      // nothing asked for: the Oracle
	} else {
		if ( q.get( 'cut' ) || q.get( 'playing' ) ) {
			tell( { missing: location.search } );                    // Rabbithole's traverse asked for a song the graph doesn't hold
		}
		const start = K.landing( G );
		lost = asked ? `The connectome doesn't know “${ asked }” yet. Here is ${ first( start ) } instead.` : '';
		go( { a: start } );
	}
	booted = true;
	if ( hostTo !== null ) {
		goFromHost( hostTo );
	}
} ).catch( ( err ) => {
	// #wait is gone once the graph is read: an error after that still has to be said somewhere, and seen in the console.
	const where = $( 'wait' ) || stage.appendChild( h( 'div', { id: 'wait' } ) );
	where.textContent = "The connectome couldn't be loaded (" + err.message + '). Try again in a moment.';
	console.error( err );
} );
