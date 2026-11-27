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
 * list, a button on the sheet a finger's hold opens. A name itself goes to that picker or that piece, here.
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
 * finger as a tap that goes and, held still, a sheet of buttons. A thing that is in two views running keeps its place or slides to its new one,
 * whatever its shape in each: a pill that becomes a circle grows from where the pill was.
 *
 * Every string from graph.json reaches the page as text, never as markup.
 */
import * as K from './connectome-core.js';

const NS = 'http://www.w3.org/2000/svg';
const HOME = /(^|\.)pickipedia\.xyz$/.test( location.hostname ) ? '' : 'https://pickipedia.xyz';
const ICON = HOME + '/index.php?title=Special:Redirect/file/Instrument-icon-';
const FACE = HOME + '/index.php?title=Special:Redirect/file/';       // a picker's own picture, by its file's name on the wiki
/*
 * How big the graph's words are written beside its marks. Justin, #connectome, 20 Nov 2026, 02:42Z: "on desktop at
 * least, text needs to be about 25% bigger per graph-zoom-level than it current is. It's difficult to get robust
 * readable names and also a vibrant graph in the same view." So at every step of zoom a name, a pill's words and a
 * tag's are a quarter bigger than the circles and lines were drawn for, and a view holds what it held. T is that,
 * set with the frame (frame()): 1 on a finger's screen, in the dock and in the walk, which keep their own sizes.
 * FONT says each kind of word at T, for measuring; the stylesheet writes them at --t, which frame() sets alike.
 * tx( n ): a length that is a word's (its height, the room a name may take) at T. down( px ): how much lower a
 * word of px sits under its mark, so that its top stays where it was.
 */
const TEXT = 1.25;
let T = 1;
const SERIF = 'Georgia, "Times New Roman", serif', SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const KINDS = { named: [ '700', 14, SERIF ], subject: [ '700', 17, SERIF ], far: [ '400', 13, SERIF ], bead: [ '400', 11, SERIF ],
	pill: [ '600', 12.5, SANS ], tag: [ '700', 12.5, SERIF ], piece: [ '600', 13, SANS ], own: [ '600', 17, SANS ], sub: [ '400', 11.5, SANS ],
	road: [ 'italic 400', 12, SERIF ], inst: [ '400', 12, SERIF ] };
const FONT = {};
Object.keys( KINDS ).forEach( ( k ) => Object.defineProperty( FONT, k, { get: () => `${ KINDS[ k ][ 0 ] } ${ +( KINDS[ k ][ 1 ] * T ).toFixed( 3 ) }px ${ KINDS[ k ][ 2 ] }` } ) );
const tx = ( n ) => Math.round( n * T * 10 ) / 10;
const down = ( px ) => Math.round( ( T - 1 ) * 0.74 * px );
const still = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
const FAINT = 0.22;              // between two pickers, a route through someone not named: behind the rest, still there
const STRAIGHT = { x: 0, y: 0 };
const coarse = window.matchMedia && window.matchMedia( '(pointer: coarse)' ).matches;   // a finger: bigger beads, further apart
const narrow = () => window.matchMedia( '(max-width: 760px)' ).matches;                 // the list is under the graph

const $ = ( id ) => document.getElementById( id );
const svg = $( 'g' ), stage = $( 'stage' ), tip = $( 'tip' ), sheet = $( 'sheet' );

let G = null;
let RAW = null;                   // graph.json as read: what a kept graph is cut from
let KEPT = null;                  // a kept graph in sight: { id, doc, kept, live, since, edited } (keptSay, below)
// The view: { a } one picker and their company; { a, b } two pickers and what's between; { m } one piece of music
// and where its pickers lead. With it, what the reader came by, so it stays in sight: keep (pickers, or pieces),
// hand (the pickers a piece was reached by), by (the piece a picker was reached by).
let view = null;
let sel = { picker: null };
let scene = null;
let was = new Map();             // where each thing in sight is, by what it stands for, as the view changes
let fingers = false;             // the last pointer down was a finger or a pen: nothing hovers, so a touch asks before it acts
let held = null;                 // the mark whose sheet is open
const alone = window.parent === window;   // a page of its own, not the graph over a wiki page: its steps are the browser's too
// Inside Rabbithole, as its "Your rabbithole" (Justin, #connectome, 15 Nov 2026): the player says what has been on,
// and the graph asks it to play, to open a page in its pane, to open the drawer. MINI: the few steps the dock has
// room for, until the drawer opens.
const HOST = new URLSearchParams( location.search ).get( 'host' ) === 'rabbithole' && !alone ? 'rabbithole' : '';
// One shell (Justin, #connectome, 19 Nov 2026: "I want to be sure that we don't have parallel logical paths
// happening ... precisely the same application state"; 20:45Z: "build one shell in place of the dock"). /bacon is
// Rabbithole's own app, with this page as the graph in its pane (shell=1) whether the reader came by /bacon or by
// the player. There the shell keeps the one history: a step here is said to it (`at`), it puts the step in the
// browser's history and the address, and Back and Forward come here as its word (`step`). The search bar and the
// way come show while the reader steers (the shell's traverse mode off), and stand aside while the music does.
const SHELL = HOST && new URLSearchParams( location.search ).get( 'shell' ) === '1';
let steering = SHELL && new URLSearchParams( location.search ).get( 'steer' ) === '1';
// One bar (Justin, #connectome, 21 Nov 2026, 01:56Z: "integrate the top bar of rabbithole with the top bar of
// /bacon/ ... Let's get all that stuff on one unified top bar"). A shell that has the link, the FAQ and the way to
// PickiPedia on its own bar says so in the frame's address (bar=1), and this page puts its own bar away for good;
// the shell's buttons then ask for the two that are this page's work ({ rabbithole: 'bar', act: 'share' | 'faq' }).
// A shell that doesn't say so (Rabbithole as it was before) leaves this page its bar.
const BARLESS = SHELL && new URLSearchParams( location.search ).get( 'bar' ) === '1';
let freshStep = false;            // the shell opened a graph as a step of its own: this view gets a number of its own
let MINI = new URLSearchParams( location.search ).get( 'walk' ) === 'mini';
const trail = [];
// Each step as it was drawn, so that going back brings it back as it was (Justin, #connectome, 19 Nov 2026: "back
// to the previous state entirely, with the same related pickers in the same positions"). A view is laid out from
// where things were in the view before it, so the same address reached another way draws differently; what was
// drawn is kept, and Back, Forward and a step of the strip put it back.
const drawn = new WeakMap();      // a view -> { scene, fit, box, S, sel }: as it was last drawn, and the frame it was drawn for
const steps = new Map();          // one of the browser's entries, by its number -> { view, trail, g }
const SESSION = Math.random().toString( 36 ).slice( 2 );   // this load of the page: its numbers mean nothing to another
let stepAt = 0, stepSeq = 0;      // the number of the entry in sight, and the last number given out
let asDrawn = null;               // for one show(): what to draw the view as, a view brought back
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

/**
 * A picker's name, with what they play on a line of its own under it (Justin, #connectome, 23 Nov 2026, 19:02Z: "let's
 * put their instrument underneath (ie, have a line-break)"). `role` as a cut's page says it ("guitar; six-whistle"):
 * all of it where that fits the frame, the first where only that does, else nothing. { label, dx, inst }: the name as
 * nameAt has it, placed so the wider of the two lines stays in the frame; inst the second line's words ('' for none).
 */
function playsAs( name, role, pos, W, font ) {
	const nm = nameAt( name, pos, W, font );
	const all = String( role || '' ).split( ';' ).map( ( r ) => r.trim() ).filter( Boolean );
	for ( const inst of all.length ? [ all.join( ', ' ), all[ 0 ] ] : [] ) {
		const half = Math.max( wide( nm.label, font ), wide( inst, FONT.inst ) ) / 2;
		if ( inst.length <= 40 && 2 * half <= W - 8 ) {
			const lean = ( pos.lean || 0 ) * ( half + 3 );
			return { label: nm.label, dx: Math.round( lean ) + Math.round( K.nudge( pos.x + lean, half, 4, W - 4 ) ), inst };
		}
	}
	return Object.assign( nm, { inst: '' } );
}

/** A name's second line, what they play: set, changed or taken away, the name moved to keep both clear of its mark. */
const INST_LH = 15;
function instLine( text, inst ) {
	let span = text.querySelector( 'tspan.inst' );
	const y = parseFloat( text.dataset.y ) || 0, up = parseFloat( text.dataset.up ) || 0;
	if ( !inst ) {
		if ( span ) {
			span.remove();
		}
		text.setAttribute( 'y', y );
		return;
	}
	if ( !span ) {
		span = s( 'tspan', { class: 'inst' } );
		text.appendChild( span );
	}
	span.setAttribute( 'x', text.getAttribute( 'x' ) || 0 );
	span.setAttribute( 'dy', tx( INST_LH ) );
	if ( span.textContent !== inst ) {
		span.textContent = inst;
	}
	text.setAttribute( 'y', y - tx( up ) );
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
	if ( SHELL ) {
		q.set( 'shell', '1' );
		if ( BARLESS ) {
			q.set( 'bar', '1' );
		}
	}
	return '?' + q;
}

/** This page's address as the shell's own: without what says it is hosted. */
function shellAddress() {
	const q = new URLSearchParams( location.search );
	[ 'host', 'shell', 'steer', 'bar' ].forEach( ( k ) => q.delete( k ) );
	const query = q.toString();
	return location.pathname + ( query ? '?' + query : '' );
}

/** In the shell: where the graph is now, for its address and its history; `step`, one the reader took. */
function tellAt( step ) {
	if ( SHELL ) {
		tell( { at: shellAddress(), step: !!step, n: stepAt, s: SESSION, title: document.title } );
	}
}

function rawAddress( v ) {
	// the middle's card: asked for by a click on the middle; a soloist's view (playing) has it unless it was put away
	const card = v.way || v.walk ? '' : ( cardFirst( v ) ? ( v.card === false ? '&card=0' : '' ) : ( v.card ? '&card=1' : '' ) );
	return rawAddress0( v ) + card;
}

function rawAddress0( v ) {
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
	// the two, and the record whose tracks the reader asked to see spread out between them (its "+n")
	return '?' + new URLSearchParams( Object.assign( { a: first( v.a ), b: first( v.b ) }, v.rec !== undefined && G.music[ v.rec ] ? { rec: G.music[ v.rec ].key } : null ) );
}

/** The view an address asks for; null when it names nothing the graph knows. (?from= and ?to= are read as a and b.) */
function parse( q ) {
	const v = parse0( q );
	if ( v && q.get( 'card' ) === '1' && cardable( v ) ) {
		v.card = true;
	} else if ( v && q.get( 'card' ) === '0' && cardFirst( v ) ) {
		v.card = false;
	}
	return v;
}

/** A view with one thing in its middle that has a card: a picker's own, a song's cut. */
// A show has a card too (Justin, #connectome, 22 Nov 2026, 21:55Z: "Let's have a card for the shows too, like we do
// with pickers"): a record or a track in the middle has none.
const showView = ( v ) => v.m !== undefined && !!M( v.m ) && M( v.m ).kind === 'show';
const cardable = ( v ) => !!v && !v.walk && !v.way && v.pg === undefined && ( v.m === undefined || showView( v ) ) && v.b === undefined &&
	( v.cut !== undefined || v.a !== undefined || v.m !== undefined );
/** Is the middle's card out? Asked for; or the view is a soloist's, the music's own, and nobody put it away. */
// Out from the start: the soloist's, while the music steers; and a show's that has a picture of its own, so the picture is
// seen (Justin, #connectome, 26 Nov 2026: "if there's a photo of the show, it makes sense to show that").
const cardFirst = ( v ) => v.playing !== undefined || ( showView( v ) && !!G.music[ M( v.m ).m ].art );
const cardOn = ( v ) => cardable( v ) && ( cardFirst( v ) ? v.card !== false : !!v.card );
/** Out, or away again: a step of its own, so Back puts it as it was. */
const cardTurn = () => go( Object.assign( {}, view, { card: cardOn( view ) ? ( cardFirst( view ) ? false : undefined ) : true } ) );

function parse0( q ) {
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
	const rec = q.get( 'rec' ) ? K.findPiece( G, q.get( 'rec' ) ) : null;
	return rec !== null && rec !== undefined ? { a, b, rec: M( rec ).m } : { a, b };
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
function words( t ) {
	T = t;
	svg.style.setProperty( '--t', String( t ) );
}
function frame( own ) {
	const cw = svg.clientWidth, ch = svg.clientHeight;
	S = MINI || own || coarse ? 1 : K.shrink( cw, ch, zoomed(), CLOSER[ closer ] );
	words( MINI || own || coarse ? 1 : TEXT );
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
		const label = cut( first( d.id ), FONT.bead, tx( 130 ) ), w = wide( label, FONT.bead );
		let b = K.beside( d, d.r + 2, w, tx( 12 ), pts, boxes, { W, H }, { x: d.x - C.x, y: d.y - C.y } );
		if ( !b && all ) {
			const t = Math.atan2( d.y - C.y, d.x - C.x ), cx = Math.cos( t ), side = Math.abs( cx ) > 0.4;
			const x = side ? Math.sign( cx ) * ( d.r + 4 ) : 0, y = side ? tx( 4 ) : ( Math.sin( t ) > 0 ? d.r + 12 + down( 11 ) : -d.r - 5 );
			const anchor = side ? ( cx > 0 ? 'start' : 'end' ) : 'middle';
			const x1 = d.x + x - ( anchor === 'start' ? 0 : anchor === 'end' ? w : w / 2 );
			b = { x, y, anchor, box: { x1, y1: d.y + y - tx( 10 ), x2: x1 + w, y2: d.y + y + tx( 3 ) } };
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
function pillsFor( tie, room, most, prefer, entry, bare ) {
	const shown = [];
	let used = 0;
	const worth = tie.ev.filter( ( e ) => e.how >= K.STAGE && G.music[ e.m ].tier >= K.FULL );
	let pool = worth.length ? worth : tie.ev.slice( 0, 1 );        // nothing named up front: still say the one thing
	// `entry`: the one to say, as fresh() chose it, its song first
	const came = entry || ( prefer === undefined ? null : ( tie.ev.find( ( e ) => K.pieceFor( G, e ) === prefer ) || tie.ev.find( ( e ) => e.m === M( prefer ).m ) ) );
	if ( came ) {                                                 // the piece the reader came by is the one to say
		pool = [ came ].concat( pool.filter( ( e ) => ( came.one !== undefined ? e !== came : e.m !== came.m ) ) );
	}
	for ( const e of pool ) {
		if ( shown.length >= most ) {
			break;
		}
		const n = K.naming( G, e );
		const play = n.glyph === 'track' ? K.playOf( G, G.music[ e.m ], e.songs[ 0 ] ) : '';
		const watch = videoOf( G.music[ e.m ] );                     // a video of it: a ▶ to watch it, in the graph
		// A show's set stones ride inside its pill, at its right end (Justin, #connectome, 22 Nov 2026, 21:55Z: "Let's
		// put the set stones _inside_ the show pill"): their room is the pill's too.
		const stones = n.glyph === 'show' ? K.stonesOf( G, K.pieceFor( G, e ) ).length : 0;
		// The words are fitted to the room as before; the stones make the pill that much longer, so a show with
		// stones is never named shorter for having them.
		const pad = 34 + ( play || watch ? 38 : 0 ), gemW = stones ? gemsIn( stones ) + 4 : 0;   // the glyph and the ends; Rabbithole's way; the stones
		// a show's year stays whole at the end of it, however much of the rest is cut
		const yearEnd = n.glyph === 'show' && n.year ? ' · ' + n.year : '';
		// a song's "+n" stays whole at the end of it too: a name and its author too long for a pill give up the author
		let label = yearEnd ? K.clip( n.short.slice( 0, -yearEnd.length ), 34 - yearEnd.length ) + yearEnd :
			( n.glyph === 'track' && n.short.length > 34 ? K.clip( n.song, 34 - n.plus.length ) + n.plus : K.clip( n.short, 34 ) );
		let w = pad + gemW + wide( label, FONT.pill );
		if ( used + w - gemW > room && !shown.length ) {                     // the first one always goes in: briefer, then cut to fit
			label = n.brief;
			const fits = ( text ) => pad + wide( text, FONT.pill ) <= room;
			// cut a name to fit beside `tail`, never under six letters
			const shrink = ( name, tail ) => {
				let text = name + tail;
				for ( let most = name.length; !fits( text ) && most > 6; most-- ) {
					text = K.clip( name, most ) + tail;
				}
				return text;
			};
			if ( fits( label ) && !( n.glyph === 'track' && n.sur ) ) {
				// as it is
			} else if ( n.glyph === 'show' && n.crew ) {
				// A show with its band named keeps the band and the year, and gives up its own name or place first
				// (Justin, 22 Nov 2026: "The band name is crucial"); where even the band won't go whole, the band is cut.
				// Not past the point where two of a band's nights would read alike: with no room for eight letters of
				// the night's own name beside the band, the name and the year, as before, and the band in its line.
				const yr = n.year ? ' · ' + n.year : '';
				label = fits( K.clip( n.crew + ' · ' + n.who, n.crew.length + 11 ) + yr ) ? shrink( n.crew + ' · ' + n.who, yr ) :
					( fits( K.clip( n.who, 10 ) + yr ) ? shrink( n.who, yr ) : shrink( n.who, '' ) );
			} else if ( n.glyph === 'track' ) {
				// a song gives up its author's first names, then its author (that is `brief`), then letters of its
				// name, never its "+n"
				const sur = n.sur ? n.song + ' · ' + n.sur + n.plus : '';
				label = sur && fits( sur ) ? sur : ( fits( n.brief ) ? n.brief : shrink( n.song, n.plus ) );
			} else if ( n.named ) {
				// a show with a name of its own gives up its night before any of its name (K.naming)
				label = shrink( n.who, '' );
			} else if ( n.placed ) {
				// one known by where it was keeps the place, with as much of its night as fits beside it: the day,
				// the month, the year (K.nights). Where not even the year fits beside the whole of it, the year stays
				// only if ten letters of the place still fit with it: "Ryman Audito…" says more than "Ryman… · 2025",
				// and the pill's own mark says it is a show.
				const night = n.year && fits( n.who + ' · ' + n.year ) ? n.year : '';
				const year = n.year ? ' · ' + n.year : '';
				// A short place keeps its year though that runs a little past the room: two summers at Town Park
				// are two labels, not one twice.
				const near = year && pad + wide( n.who + year, FONT.pill ) <= room + 28;
				label = night ? n.who + ' · ' + night : ( near ? n.who + year :
					( year && fits( K.clip( n.who, 10 ) + year ) && !fits( n.who ) ? shrink( n.who, year ) : shrink( n.who, '' ) ) );
			} else {
				// a show known by its band keeps its night and gives up some of its name; a record is cut as it is
				label = n.year ? shrink( n.who, ' · ' + n.year ) : shrink( n.brief, '' );
			}
			// `bare`: where even that is wider than the room, a show says the least that is its own: its name or its
			// place alone, or the night alone for one known by its band. Six letters of a name and a block height
			// are 232 wide, on a line that may have 150 between two faces.
			if ( bare && !fits( label ) && n.glyph === 'show' ) {
				label = n.crew ? shrink( n.crew, '' ) : ( n.named || n.placed ? shrink( n.who, '' ) : ( n.year || label ) );
			}
			w = pad + gemW + wide( label, FONT.pill );
		}
		if ( used + w > room && shown.length && n.glyph === 'track' && n.by ) {     // a song after the first: its author's surname, then none, before not at all
			const sur = n.song + ' · ' + n.sur + n.plus;
			label = sur.length <= 34 && used + pad + wide( sur, FONT.pill ) <= room ? sur : K.clip( n.song, 34 - n.plus.length ) + n.plus;
			w = pad + wide( label, FONT.pill );
		}
		if ( used + w > room && shown.length ) {
			break;
		}
		shown.push( { e, label, w, glyph: n.glyph, tier: G.music[ e.m ].tier, play, watch, song: e.songs[ 0 ], stones } );
		used += w + 8;
	}
	return { shown, more: tie.ev.length - shown.length, used: Math.max( 0, used - 8 ) };
}

function placePills( sc, u, v, tie, x1, x2, y, most, o, delay, prefer, more, entry, bare ) {
	const room = Math.abs( x2 - x1 );
	const fit = pillsFor( tie, room - ( most > 1 ? 52 : 0 ), most, prefer, entry, bare );
	const moreW = fit.more > 0 && most > 1 ? 16 + wide( '+' + fit.more + ' more', FONT.pill ) : 0;
	let x = ( x1 + x2 ) / 2 - ( fit.used + ( moreW ? moreW + 8 : 0 ) ) / 2;
	for ( const p of fit.shown ) {
		const piece = K.pieceFor( G, p.e );
		sc.pills.set( 'm' + lineKey( u, v ) + '.' + p.e.m, Object.assign( { stands: 'piece', piece, is: 'm' + piece, x: x + p.w / 2, y, w: p.w, label: p.label,
			glyph: p.glyph, tier: p.tier, e: p.e, u, v, o, delay, play: p.play, watch: p.watch, song: p.song }, more ) );
		x += p.w + 8;
	}
	if ( moreW ) {
		sc.pills.set( 'm' + lineKey( u, v ) + '.more', { stands: 'piece', x: x + moreW / 2, y, w: moreW, label: '+' + fit.more + ' more', more: true,
			u, v, o, delay } );
	}
}

/**
 * The room the middle's card takes, in the frame's upper right corner: its size on the page, and its box in the
 * drawing's own measure, which nothing of the graph is set down in. One size whatever it says, so the words
 * arriving never re-lay the graph.
 *
 * Justin, #connectome, 20 Nov 2026, 19:41Z: "it can afford to be a _little_ bigger ... I still want it to include
 * the first 3 or so details from their MusicianInfo card. And the picture can be maybe 30% bigger." So it holds
 * a picture of 84px (58 on the small one, from 64 and 44), the name, and what their page says they do. How big it
 * may be is what the ring leaves of the corner, which goes by the drawing's shape (each was swept for marks under it):
 *   `side`, a drawing 675px wide or more (Rabbithole's pane on a laptop, now that no list stands beside the
 *     graph): the picture beside everything, 300 to 430px wide (0.44 of the drawing) and 130 to 180 high (0.24 of
 *     it; from 21 Nov, 23:27Z to 22 Nov, 00:55Z, 166 to 236 high with a 109px picture, which Justin found awkward:
 *     the picture opens a closer look instead, zoomOpen). It was 300 by 104 to 150, which
 *     held some 40 characters of each line. Justin, #connectome, 21 Nov 2026,
 *     01:56Z: "The cards can be much longer now that you've made room - we can afford ~200 characters of the first
 *     three items instead of 40 or whatever we're doing now." At the pane's size (909 by 734) it is 400 by 176:
 *     eight lines of some 48 characters among the three, so a long line has about 190 where the others are short.
 *     The ring is set down below the card as far as the frame has room under it (egoScene): a taller card moves the
 *     ring down, and past that room stands beside the ring's top seats;
 *   520 to 675px wide and 640 tall: 208 to 269px by 176 to 200, the picture and the name in a row, the lines under;
 *   `tower`, 440 to 520px wide and 560 tall or more (the pane on a 1280px laptop): the song's name beside a
 *     soloist comes to within 150px of the corner there, so 150px by 212, the picture over the name over the lines;
 *   `compact`, under 440px wide and over 500 tall (a phone with the graph alone: a ring of six in a narrow frame,
 *     with a name 90px under the top and 150 from the side): the size it was, 150px by 80, a 44px picture, one line;
 *   `small`, anything else (a phone in Rabbithole; a low window): up to 200px by 126, laid as the second.
 */
const SIDE = { w: 430, h: 180 }, MID_H = 200;       // the most a card beside a wide drawing takes, and the height of one on a middling drawing
function cardRoom( W ) {
	const wide = svg.clientWidth || W, tall = svg.clientHeight || 0, k = W / wide;
	// A song's own card says its name and a line or two: the size it had, so the ring round a song keeps all its pickers.
	const song = !!view && view.cut !== undefined && view.playing === undefined;
	const side = !song && wide >= 675, tower = !song && wide >= 440 && wide < 520 && tall >= 560, compact = !song && wide < 440 && tall > 500;
	const small = song ? wide < 520 : ( !side && !tower && !compact && !( wide >= 520 && tall >= 640 ) );
	const cw = Math.round( song ? Math.max( 150, Math.min( 236, wide * 0.3 ) ) : ( side ? Math.max( 300, Math.min( SIDE.w, wide * 0.44 ) ) : ( tower || compact ? 150 :
		( small ? Math.max( 160, Math.min( 200, wide * 0.46 ) ) : Math.max( 208, Math.min( 269, wide * 0.4 ) ) ) ) ) );
	const ch = Math.round( song ? ( wide < 520 ? 80 : 100 ) :
		( side ? Math.max( 130, Math.min( SIDE.h, tall * 0.24 ) ) : ( tower ? 212 : ( compact ? 80 : ( small ? 126 : Math.max( 176, Math.min( MID_H, tall * 0.28 ) ) ) ) ) ) );
	return { cw, ch, side, tower, compact, small, box: { x1: W - ( cw + 14 ) * k, y1: -1e5, x2: 1e5, y2: ( ch + 14 ) * k } };
}

/** K.ego's ring, with a place left empty at the upper right when the middle's card is out (K.gapFor). */
function ringFor( o, card ) {
	if ( !card ) {
		return K.ego( o );
	}
	const g = K.gapFor( o.named, !!o.over );
	const lay = K.ego( Object.assign( {}, o, { turn: g.turn } ) );
	lay.named = lay.named.filter( ( _, i ) => i !== g.gap );
	if ( lay.far ) {
		lay.far = lay.far.filter( ( _, i ) => i !== g.gap );
	}
	return lay;
}

/** Nothing small under the card: a bead or one a step further out that came to stand in its corner goes, with its lines and what they say. */
function clearCard( sc, W ) {
	const b = cardRoom( W ).box;
	// A bead by its own size, and by its name's where it has one written beside it (nameBeads); one a step out by
	// its name's, which is always written beside it.
	const under = ( d ) => {
		if ( d.kind === 'far' ) {
			return d.x > b.x1 - tx( 110 ) && d.y < b.y2 + tx( 20 );
		}
		if ( d.x > b.x1 - 12 && d.y < b.y2 + 12 ) {
			return true;
		}
		if ( d.label && d.at ) {
			const w = wide( d.label, FONT.bead ), x1 = d.x + d.at.x - ( d.at.anchor === 'start' ? 0 : ( d.at.anchor === 'end' ? w : w / 2 ) );
			return x1 + w > b.x1 - 6 && d.y + d.at.y - tx( 10 ) < b.y2 + 6;
		}
		return false;
	};
	for ( const [ key, d ] of [ ...sc.nodes ] ) {
		if ( ( d.kind === 'dot' || d.kind === 'far' ) && under( d ) ) {
			sc.nodes.delete( key );
			for ( const part of [ sc.lines, sc.pills ] ) {
				for ( const [ k, l ] of [ ...part ] ) {
					if ( l.a === key || l.b === key || l.owner === key ) {
						part.delete( k );
					}
				}
			}
		}
	}
	return sc;
}

/* ------------------------------------------------------------------------------------------------------------
 * Two pickers: the rainbow between them (Justin, #connectome, 19 Nov 2026: "Showing a single path is boring. Give
 * me a full rainbow for their directs, and also a multi-hop rainbow for their two hops; fill the screen with the
 * richness of the ecosystem connecting them"). K.rainbow says where each strand goes; these say what's on them.
 * From the straight line outward: what the two share, a strand each; whoever has played with both, a strand each;
 * those only on a record with each, as beads; and the ways across by two pickers, outermost.
 * --------------------------------------------------------------------------------------------------------- */

const ROW = 15;                  // half the room a strand with names on it takes
const TURN = 0.4;                // how much of its length a branch of a trunk takes to reach its own picker's arc: it runs level for the rest
const R_OF = ( id ) => ( P( id ).img ? 16 : ( P( id ).inst ? 14 : 9 ) );      // a named picker's circle, as draw.node draws it
const nameMark = ( id ) => ( { r: R_OF( id ), w: wide( K.clip( first( id ), 26 ), FONT.named ) + 4 } );
/** How far apart the two ends stand, as K.rainbow will set them: what a hop of a way across has for its name and what it says. */
function spanOf( W, en ) {
	const inset = Math.max( 76, Math.min( W * 0.13, 170 ) );
	return W - Math.max( inset, en.la + 12 ) - Math.max( inset, en.lb + 12 );
}
const strandWidth = ( e ) => Math.max( 1.6, Math.min( 5, 1.6 + 2.1 * Math.sqrt( e.w || 0.1 ) ) );

const beadMark = ( id, r ) => ( { r: Math.min( 6, r ), w: wide( cut( first( id ), FONT.bead, 130 ), FONT.bead ) + 3, small: true } );

/**
 * A picker set down where the rainbow put them: named beside their circle (or under it, on the straight line), a
 * bead with its name small beside it, or a bead alone where no name would go.
 */
function addOnStrand( sc, id, mk, more, bead ) {
	const side = ( R, y ) => ( { x: mk.at === 'right' ? R + 5 : -R - 5, y, anchor: mk.at === 'right' ? 'start' : 'end' } );
	if ( bead || !mk.named ) {
		const r = Math.min( 6, more.r || 5 );
		addNode( sc, id, mk, 'dot', Object.assign( { tight: true }, bead && mk.named ? { label: cut( first( id ), FONT.bead, 130 ), at: side( r, 3.5 ) } : null, more, { r } ) );
	} else if ( mk.at === 'under' ) {
		addNode( sc, id, Object.assign( {}, mk, { below: true } ), 'named', Object.assign( { label: cut( first( id ), FONT.named, more.room || 200 ) }, more ) );
	} else {
		addNode( sc, id, mk, 'named', Object.assign( { at: side( R_OF( id ), 5 ) }, more ) );
	}
}

/** How the two ends are named, for K.rainbow: nothing is set down on them. */
function endsNamed( a, b, en ) {
	const R = ( id, rabbit ) => ( P( id ).img ? 26 : ( rabbit || P( id ).inst ? 22 : 13 ) );
	return { a: { w: wide( K.clip( first( a ), 26 ), FONT.subject ), side: en.sa, r: R( a, true ) },
		b: { w: wide( K.clip( first( b ), 26 ), FONT.subject ), side: en.sb, r: R( b, false ) } };
}

/**
 * What a hop of a lit way is, said on it: where a pill is clear of the pickers, names and pills already set down, a
 * briefer one where the full one finds nowhere, and then the least it can say (a show its night alone). A hop with
 * no room even for that says nothing here: the line is still the tie, and a click on it opens its two pickers.
 *
 * It used to end by lapping a show's pill 17px onto the hop's own two pickers, so a show kept its night however
 * short the hop: on the running site that put a label's body into a face on 3 of 60 pairs (21 Nov 2026), up to
 * 9.6px in. A face is never under a label (re and Justin, #connectome, 20 Nov 2026): now the last try touches the
 * rim of a picker's ground and no more.
 */
function sayHop( sc, lay, h, t1, t2, u, v, tie, room ) {
	const free = ( box ) => !lay.taken.some( ( q ) => box.x1 < q.x2 && box.x2 > q.x1 && box.y1 < q.y2 && box.y2 > q.y1 );
	const boxAt = ( p, w ) => ( { x1: p.x - w / 2 - 3, y1: p.y - 12, x2: p.x + w / 2 + 3, y2: p.y + 12 } );
	const put = ( p, part, box, bare ) => {
		lay.taken.push( box );
		placePills( sc, u, v, tie, p.x - room * part / 2, p.x + room * part / 2, p.y, 1, 1, 60, undefined, undefined, undefined, bare );
	};
	for ( const [ part, bare ] of [ [ 1, false ], [ 0.72, false ], [ 0.5, false ], [ 0.5, true ], [ 0.34, true ] ] ) {
		const w = pillsFor( tie, room * part, 1, undefined, undefined, bare ).used;
		for ( const f of [ 0.5, 0.38, 0.62, 0.26, 0.74 ] ) {
			const p = K.onArc( lay.A, lay.B, h, t1 + ( t2 - t1 ) * f );
			if ( free( boxAt( p, w ) ) ) {
				put( p, part, boxAt( p, w ), bare );
				return;
			}
		}
	}
	// At the hop's middle, its ends as far as the rim of the ground its own two pickers stand on.
	const w = pillsFor( tie, room * 0.34, 1, undefined, undefined, true ).used, mid = K.onArc( lay.A, lay.B, h, ( t1 + t2 ) / 2 );
	if ( free( boxAt( mid, w - 10 ) ) ) {
		put( mid, 0.34, boxAt( mid, w ), true );
	}
}

function pairScene( a, b, rec, plain ) {
	const { W, H } = frame();
	const sc = newScene();
	const whole = G.adj[ a ].get( b ) || null;
	// A record the two share several tracks of says one of them on a line and "+n" for the rest. Asked for by its
	// "+n" (Justin, #connectome, 20 Nov 2026, 14:16Z: "if we have '+<n>' in there, that needs to do something.
	// Probably a rainbow graph showing all those songs in between the two, with other involved pickers as hops
	// where relevant"), that record is spread out here: a strand to each of its tracks, named, before the rest of
	// what the two share; and those who are on that record with both come first among the ways by one picker.
	const spread = rec !== undefined && whole ? whole.ev.find( ( e ) => e.m === rec && e.how === K.TRACK && e.songs.length > 1 ) : null;
	const tie = spread ? Object.assign( {}, whole, { ev: spread.songs.map( ( song ) => Object.assign( {}, spread, { songs: [ song ], one: song } ) )
		.concat( whole.ev.filter( ( e ) => e !== spread ) ) } ) : whole;
	const onRec = ( t ) => !!t && t.ev.some( ( e ) => e.m === rec );
	const all = K.mutuals( G, a, b );
	if ( spread ) {
		all.sort( ( x, y ) => ( onRec( y.ta ) && onRec( y.tb ) ? 1 : 0 ) - ( onRec( x.ta ) && onRec( x.tb ) ? 1 : 0 ) );      // a stable sort: otherwise as they were
	}
	const played = all.filter( ( m ) => m.played );
	if ( !tie && !all.length ) {
		return ladderScene( a, b, W, H, sc );
	}
	const needLoose = !played.length && !( tie && tie.played );      // only looser ties join them: show those
	let pool = played.length ? played : ( needLoose ? all : [] );
	const rest = needLoose ? [] : all.filter( ( m ) => !m.played );  // on a record with each, and never on a stage with both: beads
	const en = endNames( a, b, W );
	const small = W < 560, TOP = 20, BOTTOM = 20;

	// What the two share: the loudest few said on their strands, the rest thin strands round them.
	const usual = small ? 1 : ( H > 640 ? 4 : ( H > 460 ? 3 : 2 ) );
	// what's said on the straight line keeps clear of a name under either end
	const pillRoom = Math.max( 96, Math.min( 300, W * 0.36, W - 2 * 76 - ( en.sa ? 0 : en.la + en.lb ) ) );
	const sharing = ( evs ) => {
		// the record spread out: every track of it named, as far as the frame's height goes with three rows left for the ways round
		const said = Math.min( evs.length, spread ? Math.max( usual, Math.min( spread.songs.length, Math.floor( ( H - TOP - BOTTOM ) / ( 2 * ROW ) ) - 3 ) ) : usual );
		const thin = Math.min( evs.length - said, H > 460 ? 12 : 6 );
		return evs.slice( 0, said + thin ).map( ( e, i ) => ( { e, fit: i < said ? pillsFor( tie, pillRoom, 1, undefined, e ).shown[ 0 ] : null } ) );
	};
	const tallOf = ( list ) => list.reduce( ( sum, x ) => sum + ( x.fit ? 2 * ROW : 6 ), 0 );

	// Those who share one show or record with an end, on one trunk (Justin, #connectome, 21 Nov 2026, 01:56Z: "A way
	// to make relationship rainbows look less chaotic: Share initial connections on one side ... Make this a
	// single line emerging from one side, then have a pill for the show, and then have it branch into the three
	// (or more) common pickers that the two ends of the rainbow share, and then back into one line (with another
	// fully shared pill, if one is available) connecting all the way to the other picker."). Where the frame is
	// wide enough for what the trunk says and a branch each way, and as many of a group as it is tall enough for:
	// the rest of them, and every group there is no room for, are ways of their own as before. One whose way is
	// lit is out of their group, on the straight line. A record spread out keeps the old shape: its tracks are
	// what that view is for.
	const trunked = [], inTrunk = new Set(), onTrunk = new Set(), everyone = pool;
	if ( !spread && !plain ) {
		const across = spanOf( W, en ) - 2 * 38 - 120;              // less the ends' own room and the least two branches take (K.fork)
		// The room there is, as K.rainbow will hand it out: over the straight line and under it, each strand to
		// the side less taken. What the two share is counted whole here, though what a trunk says will not be a
		// strand of its own: so a trunk planned for is a trunk there is room for.
		const sides = [ Math.round( H / 2 ) - TOP, H - BOTTOM - Math.round( H / 2 ) ], edge = [ 0, 0 ];
		let begun = false;
		const seat = ( half, take ) => {
			if ( !begun ) {
				if ( half > Math.min( sides[ 0 ], sides[ 1 ] ) ) {
					return false;
				}
				if ( take ) {
					edge[ 0 ] = edge[ 1 ] = half;
					begun = true;
				}
				return true;
			}
			let side = edge[ 0 ] <= edge[ 1 ] ? 0 : 1;
			if ( edge[ side ] + 2 * half > sides[ side ] + 0.5 ) {
				side = 1 - side;
			}
			if ( edge[ side ] + 2 * half > sides[ side ] + 0.5 ) {
				return false;
			}
			if ( take ) {
				edge[ side ] += 2 * half;
			}
			return true;
		};
		if ( sel.picker !== null || !tie ) {
			seat( 34, true );                                          // a lit way on the straight line
		}
		sharing( tie ? tie.ev : [] ).forEach( ( x ) => seat( x.fit ? ROW : 3, true ) );
		for ( const g of K.trunks( G, pool.filter( ( m ) => m.id !== sel.picker ).slice( 0, 40 ), { most: 6 } ).groups ) {
			const says = ( e, room ) => pillsFor( { ev: [ e ] }, room, 1, undefined, e, true ).shown[ 0 ];
			const each = Math.max( 92, Math.min( 240, ( across - 24 ) / 2 ) );
			const key = says( g.say, g.far ? each : Math.min( 240, across - 34 ) );
			let far = g.far ? says( g.far.say, each ) : null;
			const forkOf = ( fw ) => ( g.side === 'a' ? K.fork( W, H, en.la, en.lb, key.w, fw ) : K.fork( W, H, en.la, en.lb, fw, key.w ) );
			let at = forkOf( far ? far.w : 0 );
			if ( !at && far ) {                                         // no room to say both: the far end's trunk says nothing
				far = null;
				at = forkOf( 0 );
			}
			if ( !at ) {
				continue;
			}
			const room = Math.max( 64, Math.min( 200, 2 * ( 1 - TURN ) * ( at.fan + 16 ) - 6 ) );     // a name under its circle: no wider than the branches run level either side
			const mark = ( m ) => ( { r: R_OF( m.id ), w: Math.min( room, wide( first( m.id ), FONT.named ) ) } );
			let members = g.members.slice();
			while ( members.length > 1 && !seat( K.trunkHalf( members.map( mark ), at ), false ) ) {
				members = members.slice( 0, -1 );
			}
			if ( members.length < 2 ) {
				continue;
			}
			seat( K.trunkHalf( members.map( mark ), at ), true );
			trunked.push( { g, members, key, far, room, marks: members.map( mark ) } );
			members.forEach( ( m ) => inTrunk.add( m.id ) );
			onTrunk.add( K.pieceFor( G, g.say ) );
			if ( far ) {
				onTrunk.add( K.pieceFor( G, g.far.say ) );
			}
		}
		pool = pool.filter( ( m ) => !inTrunk.has( m.id ) );
	}
	// Each piece is said once ([[Cryptograss:Bacon graphs/Priority]], rule 5): what a trunk says is not a strand of its own as well.
	const shared = sharing( tie ? tie.ev.filter( ( e ) => !onTrunk.has( K.pieceFor( G, e ) ) ) : [] );

	// The room left, in strands with names on them: most to those who have played with both, some to the ways by two.
	const span = H - TOP - BOTTOM - tallOf( shared ) - trunked.reduce( ( sum, x ) => sum + 2 * K.trunkHalf( x.marks, K.fork( W, H, en.la, en.lb, x.g.side === 'a' ? x.key.w : ( x.far ? x.far.w : 0 ), x.g.side === 'a' ? ( x.far ? x.far.w : 0 ) : x.key.w ) ), 0 );
	const rows = Math.max( trunked.length ? 0 : 1, Math.floor( span / ( 2 * ROW ) ) );
	const twos = K.ways( G, a, b, Math.min( 8, Math.max( rows - pool.length, Math.round( rows * 0.3 ) ) ), pool.map( ( m ) => m.id ).concat( [ ...inTrunk ] ) );
	const onTwo = new Set( twos.flat() );
	const named = Math.max( 0, Math.min( pool.length, rows - twos.length ) );
	const beads = pool.slice( named ).concat( rest ).filter( ( m ) => !onTwo.has( m.id ) );
	const beadRoom = Math.max( 0, Math.min( 60, Math.floor( ( span - 2 * ROW * ( named + twos.length ) ) / 13 ) ) );
	const ways = pool.slice( 0, named ).map( ( m ) => ( { m } ) ).concat( beads.map( ( m, i ) => ( { m, bead: true, spare: i >= beadRoom } ) ), twos.map( ( chain ) => ( { chain } ) ) );

	// The lit way takes the straight line, its pickers named under it and its hops said; with none lit, what the
	// two share has it. One picked from the list who had no room is lit all the same.
	const onWay = ( x ) => ( x.m ? x.m.id === sel.picker : x.chain.slice( 1, -1 ).includes( sel.picker ) );
	let litWay = sel.picker !== null ? ways.find( onWay ) : null;
	if ( !litWay ) {
		sel.picker = null;
		litWay = tie ? null : ways[ 0 ];
	}
	const picked = sel.picker !== null;
	const lit = litWay ? ( litWay.m ? litWay.m.id : sel.picker ) : null;
	const hop = spanOf( W, en ) / 3;
	const under = ( id, room ) => ( { r: R_OF( id ), w: Math.min( room, wide( first( id ), FONT.named ) ), under: true } );
	const is = ( litWay ? [ litWay ] : [] ).concat( shared, trunked, ways.filter( ( x ) => x !== litWay && !x.spare ) );
	const pillAt = ( x, end ) => ( ( x.g.side === end ? x.key : x.far ) || { w: 0 } ).w;      // how wide what a trunk says at this end is
	const strands = is.map( ( x ) => ( x.g ? { half: 0, marks: [], group: { marks: x.marks, wa: pillAt( x, 'a' ), wb: pillAt( x, 'b' ) } } : x.e ? ( x.fit ? { half: ROW, marks: [ { pill: true, w: x.fit.w } ] } : { half: 3, marks: [] } ) :
		x === litWay ? { half: 34, marks: x.m ? [ under( x.m.id, 200 ) ] : x.chain.slice( 1, -1 ).map( ( id ) => under( id, hop - 12 ) ) } :
			x.m ? { half: x.bead ? 6.5 : ROW, marks: [ x.bead ? beadMark( x.m.id, dotRadius( x.m.w ) ) : nameMark( x.m.id ) ] } :
				{ half: ROW, marks: x.chain.slice( 1, -1 ).map( nameMark ) } ) );

	const lay = K.rainbow( { W, H, la: en.la, lb: en.lb, strands, top: TOP, bottom: BOTTOM, fill: 3, names: endsNamed( a, b, en ) } );
	if ( is.some( ( x, i ) => x.g && !lay.strands[ i ] ) ) {      // a trunk the frame turned out to have no room for: none of its pickers is left out for it
		return pairScene( a, b, rec, true );
	}

	addEnds( sc, a, b, lay, en, W );
	const bow = ( st, t1, t2 ) => K.arcBow( lay.A, lay.B, st.h, t1, t2 );
	is.forEach( ( x, i ) => {
		const st = lay.strands[ i ];
		if ( !st ) {
			return;
		}
		if ( x.g ) {                                                 // a trunk: one line from an end, what it is, a branch to each of its pickers, and one line on
			const gr = st.group, o = picked ? 0.28 : 0.9;
			x.members.forEach( ( m, k ) => {
				const row = gr.rows[ k ], leg = { o, role: 'leg', c: m.id, delay: 170 + i * 30 + k * 20 };
				addOnStrand( sc, m.id, row, { r: dotRadius( m.w ), delay: 130 + i * 30 + k * 20, o: picked ? 0.55 : 1, m, room: x.room } );
				addLine( sc, a, m.id, m.ta, Object.assign( { pts: K.run( lay.A, lay.B, st.h, row.h, gr.tF, gr.tM, 0, TURN, 30 ), pin: [ false, true ] }, leg ) );
				addLine( sc, m.id, b, m.tb, Object.assign( { pts: K.run( lay.A, lay.B, row.h, st.h, gr.tM, gr.tJ, 1 - TURN, 1, 30 ), pin: [ true, false ] }, leg ) );
			} );
			const heavy = Math.min( 5.5, 2.4 + 0.55 * x.members.length );
			for ( const end of [ 'a', 'b' ] ) {
				const mine = x.g.side === end, id = end === 'a' ? a : b, fit = mine ? x.key : x.far, at = end === 'a' ? gr.pa : gr.pb;
				// what this stretch is: the piece the group goes by; at the far end the other piece all of them
				// share with it, where there was room to say so, or the same one, where they share that with
				// both; else only that their ways on are one line here
				const say = mine ? x.g.say : ( fit ? x.g.far.say : ( x.g.same ? x.g.say : null ) );
				const pts = end === 'a' ? K.run( lay.A, lay.B, st.h, st.h, 0, gr.tF, 0, 1, 8 ) : K.run( lay.A, lay.B, st.h, st.h, gr.tJ, 1, 0, 1, 8 );
				const ties = x.members.map( ( m ) => ( end === 'a' ? m.ta : m.tb ) );
				const more = { a: 'p' + id, b: undefined, u: id, v: x.members[ 0 ].id, pts, pin: end === 'a' ? [ true, false ] : [ false, true ], role: 'trunk', w: heavy, o: picked ? 0.4 : 1, delay: 110 + i * 30 };
				if ( say ) {
					const piece = K.pieceFor( G, say );
					sc.lines.set( 'tk' + end + i, Object.assign( { tie: { ev: [ say ], played: say.how >= K.STAGE, tier: G.music[ say.m ].tier }, e: say, piece, stands: 'piece', strand: true }, more ) );
					if ( fit && at ) {
						sc.pills.set( 'mtk' + end + say.m, { stands: 'piece', piece, is: 'm' + piece, x: at.x, y: at.y, w: fit.w, label: fit.label, glyph: fit.glyph, tier: fit.tier,
							e: say, u: id, v: x.members[ 0 ].id, o: picked ? 0.4 : 1, delay: 150 + i * 30, play: fit.play, song: fit.song } );
					}
				} else {
					sc.lines.set( 'tk' + end + i, Object.assign( { tie: { ev: [], played: ties.every( ( t ) => t.played ), tier: Math.min( ...ties.map( ( t ) => t.tier ) ) }, stands: 'tie', quiet: true }, more ) );
				}
			}
			return;
		}
		if ( x.e ) {                                                 // something the two share: its own arc, end to end
			const piece = K.pieceFor( G, x.e ), o = lit === null ? 1 : 0.4;
			const key = lineKey( a, b ) + '.' + x.e.m + ( x.e.one !== undefined ? '·' + x.e.one : '' );            // a track of the record spread out: a strand of its own
			sc.lines.set( 's' + key, { a: 'p' + a, b: 'p' + b, u: a, v: b, tie, e: x.e, piece, stands: 'piece', strand: true,
				role: 'direct', fine: !x.fit, emph: x === shared[ 0 ] && lit === null, w: strandWidth( x.e ) + ( x.fit ? 1.5 : 0 ), o: x.fit ? o : o * 0.8,
				bow: bow( st, 0, 1 ), delay: 100 + i * 25 } );
			if ( x.fit ) {
				const mk = st.marks[ 0 ], p = x.fit;
				sc.pills.set( 'm' + key, { stands: 'piece', piece, is: 'm' + piece, x: mk.x, y: mk.y, w: p.w, label: p.label,
					glyph: p.glyph, tier: p.tier, e: p.e, u: a, v: b, o, delay: 140 + i * 25, play: p.play, watch: p.watch, song: p.song } );
			}
			return;
		}
		if ( x.m ) {                                                 // someone with a tie to both: a to them to b
			const m = x.m, mk = st.marks[ 0 ], on = x === litWay, bead = x.bead && !on, plain = !bead && mk.named;
			addOnStrand( sc, m.id, mk, { r: dotRadius( m.w ), lit: on, delay: plain ? 120 + i * 30 : 330, o: !picked || on || !plain ? 1 : 0.55, m, room: 200 }, bead );
			const leg = { o: on ? 1 : ( plain ? ( picked ? 0.28 : 0.9 ) : ( picked ? FAINT / 2 : ( m.played ? 0.5 : FAINT ) ) ), quiet: !plain && !on, fine: !plain && !on,
				emph: on, delay: plain ? 160 + i * 30 : 360, role: 'leg', c: m.id };
			addLine( sc, a, m.id, m.ta, Object.assign( { bow: bow( st, 0, mk.t ) }, leg ) );
			addLine( sc, m.id, b, m.tb, Object.assign( { bow: bow( st, mk.t, 1 ) }, leg ) );
			if ( on && !small ) {
				const room = Math.min( 230, ( lay.B.x - lay.A.x ) / 2 - 50 );
				sayHop( sc, lay, st.h, 0, mk.t, a, m.id, m.ta, room );
				sayHop( sc, lay, st.h, mk.t, 1, m.id, b, m.tb, room );
			}
			return;
		}
		const chain = x.chain, on = x === litWay, ts = [ 0, ...st.marks.map( ( mk ) => mk.t ), 1 ];
		chain.slice( 1, -1 ).forEach( ( id, k ) => {                 // a way by two: a, one, the other, b
			addOnStrand( sc, id, st.marks[ k ], { lit: on, delay: 200 + i * 30, o: !picked || on ? 1 : 0.55, chain: i, room: hop - 12 } );
		} );
		for ( let k = 0; k < chain.length - 1; k++ ) {
			const u = chain[ k ], v = chain[ k + 1 ], t = G.adj[ u ].get( v );
			addLine( sc, u, v, t, { bow: bow( st, ts[ k ], ts[ k + 1 ] ), o: on ? 1 : ( picked ? 0.28 : 0.8 ), emph: on, role: 'hop', c: k === 0 ? v : u, delay: 240 + i * 30 } );
			if ( on && !small ) {
				sayHop( sc, lay, st.h, ts[ k ], ts[ k + 1 ], u, v, t, Math.min( 210, hop - 44 ) );
			}
		}
		if ( on ) {
			sc.chain = chain;
		}
	} );

	sc.pool = everyone;
	sc.tie = whole;
	sc.lit = lit;
	sc.loose = needLoose;
	sc.ways = twos;
	sc.head = [ nameLink( a ), ' and ', nameLink( b ) ];
	const both = played.length;
	if ( spread ) {
		sc.sub = [ h( 'b', null, K.plural( spread.songs.length, 'track' ) + ' together on ' + K.clip( K.naming( G, spread ).long, 60 ) ), ' · ', K.together( whole ), ' in all' ];
	} else if ( tie && tie.played ) {
		sc.sub = [ h( 'b', null, K.together( tie ) ) ];
	} else if ( tie ) {
		sc.sub = [ K.together( tie ) ];
	} else {
		sc.sub = [ 'Never on one stage or one track, so far as the sources here say' ];
	}
	const through = picked && pool.concat( rest ).find( ( m ) => m.id === sel.picker );
	if ( sc.chain ) {
		sc.sub = [ h( 'b', null, 'By way of ' + listNames( sc.chain.slice( 1, -1 ) ) ) ];
	} else if ( through ) {
		sc.sub = [ h( 'b', null, 'By way of ' + first( through.id ) ), `: ${ K.times( through.ta ) } with ${ first( a ) }, ${ K.times( through.tb ) } with ${ first( b ) }` ];
	} else if ( both ) {
		sc.sub.push( ' · ', h( 'b', null, K.plural( both, 'picker' ) ), both === 1 ? ' has played with both' : ' have played with both' );
	} else if ( needLoose && all.length ) {
		sc.sub.push( ' · ', K.plural( all.length, 'picker' ), ' on a record with each' );
	}
	const byTwo = is.filter( ( x, i ) => x.chain && lay.strands[ i ] ).length;    // the outermost strands, said: what they are
	if ( byTwo && !sc.chain && !through ) {
		sc.sub.push( ' · ', K.plural( byTwo, 'way' ) + ' across by two pickers' );
	}
	return sc;
}

/**
 * Two pickers three hops apart or more: every shortest way across that shares no picker with another is a strand
 * of the rainbow, the loudest along the straight line; and whoever else sits on a shortest way is a bead at their
 * own hop, tied to the loudest of those before and after them in sight.
 */
function farScene( a, b, W, H, sc, r, en ) {
	const TOP = 20, BOTTOM = 20, L = r.hops, hop = spanOf( W, en ) / L;
	let on = r.chains.findIndex( ( c ) => c.includes( sel.picker ) );
	if ( on < 0 ) {
		on = 0;
		sel.picker = null;
	}
	const picked = sel.picker !== null;
	// The lit way takes the straight line, its pickers named under it and every hop said; the others, round it.
	const chains = [ r.chains[ on ], ...r.chains.filter( ( c, i ) => i !== on ) ];
	const strands = chains.map( ( chain, c ) => ( { half: c ? ROW + 1 : 34, at: chain.slice( 1, -1 ).map( ( id, k ) => ( k + 1 ) / L ),
		marks: chain.slice( 1, -1 ).map( ( id ) => ( c ? nameMark( id ) : { r: R_OF( id ), w: Math.min( hop - 12, wide( first( id ), FONT.named ) ), under: true } ) ) } ) );
	const others = [];
	const most = Math.max( ...r.others.map( ( level ) => level.length ), 0 );
	for ( let k = 0; k < most && others.length < 40; k++ ) {             // a few from each hop in turn
		r.others.forEach( ( level, i ) => {
			if ( level[ k ] !== undefined ) {
				others.push( { id: level[ k ], level: i + 1 } );
			}
		} );
	}
	others.forEach( ( o ) => strands.push( { half: 6.5, marks: [ beadMark( o.id, 5 ) ], at: [ o.level / L ] } ) );
	const lay = K.rainbow( { W, H, la: en.la, lb: en.lb, strands, top: TOP, bottom: BOTTOM, fill: 3, names: endsNamed( a, b, en ) } );
	addEnds( sc, a, b, lay, en, W );
	const level = Array.from( { length: L + 1 }, () => [] );          // who is in sight at each hop
	level[ 0 ].push( a );
	level[ L ].push( b );
	const shown = [];
	chains.forEach( ( chain, c ) => {
		const st = lay.strands[ c ];
		if ( !st ) {
			return;
		}
		shown.push( chain );
		const lit = c === 0, ts = [ 0, ...st.marks.map( ( mk ) => mk.t ), 1 ];
		chain.slice( 1, -1 ).forEach( ( id, k ) => {
			addOnStrand( sc, id, st.marks[ k ], { lit, o: lit || !picked ? 1 : 0.6, delay: 120 + c * 40, chain: c, room: hop - 12 } );
			level[ k + 1 ].push( id );
		} );
		for ( let k = 0; k < L; k++ ) {
			const u = chain[ k ], v = chain[ k + 1 ], tie = G.adj[ u ].get( v );
			addLine( sc, u, v, tie, { bow: K.arcBow( lay.A, lay.B, st.h, ts[ k ], ts[ k + 1 ] ), o: lit ? 1 : ( picked ? 0.3 : 0.75 ), emph: lit, role: 'hop',
				c: k === 0 ? v : u, delay: 160 + c * 40 } );
			if ( lit && W >= 560 ) {
				sayHop( sc, lay, st.h, ts[ k ], ts[ k + 1 ], u, v, tie, Math.min( 220, hop - 44 ) );
			}
		}
	} );
	// Whoever else is on a shortest way: a bead at their own hop. One a hop from an end hangs from it by its own
	// strand; any other tie of theirs to someone in sight crosses the rainbow, and lies faint behind it.
	others.forEach( ( o, i ) => {
		const st = lay.strands[ chains.length + i ];
		if ( !st ) {
			return;
		}
		const mk = st.marks[ 0 ];
		addOnStrand( sc, o.id, mk, { r: 5, delay: 360, o: 1 }, true );
		for ( const [ near, t1, t2 ] of [ [ level[ o.level - 1 ], 0, mk.t ], [ level[ o.level + 1 ], mk.t, 1 ] ] ) {
			const best = near.filter( ( u ) => G.adj[ u ].has( o.id ) ).sort( ( u, v ) => K.loudness( G.adj[ v ].get( o.id ) ) - K.loudness( G.adj[ u ].get( o.id ) ) )[ 0 ];
			if ( best !== undefined ) {
				const along = best === a || best === b;
				addLine( sc, best, o.id, G.adj[ best ].get( o.id ), { o: along ? 0.5 : FAINT * 0.6, quiet: true, fine: true, role: 'leg', c: o.id, delay: 380,
					bow: along ? K.arcBow( lay.A, lay.B, st.h, t1, t2 ) : undefined } );
			}
		}
	} );
	sc.chain = shown[ 0 ];
	sc.routes = r;
	sc.sub = [ h( 'b', null, K.plural( r.hops, 'hop' ) + ' apart' ), ': never on one stage or one track, so far as the sources here say' ];
	if ( shown.length > 1 ) {
		sc.sub.push( ' · ', h( 'b', null, K.plural( shown.length, 'way' ) + ' across' ), ' that share no picker' );
	}
	return sc;
}

function ladderScene( a, b, W, H, sc ) {
	const standing = W < 560 && H > W;                              // a phone: the ladder stands up (K.ladder)
	const r = K.routes( G, a, b, standing ? ( H > 520 ? 3 : 2 ) : Math.max( 2, Math.floor( ( H - 40 ) / ( 2 * ROW + 2 ) ) ) );
	const en = endNames( a, b, W );
	sc.head = [ nameLink( a ), ' and ', nameLink( b ) ];
	if ( r && !standing ) {
		return farScene( a, b, W, H, sc, r, en );
	}
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
	// One of the band the middle has no tie with has a seat here all the same (egoScene's `apart`): not a step further too.
	const seated = new Set( mine.map( ( c ) => c.id ) ), strangers = mine.filter( ( c ) => c.apart ).length;
	const on = K.beyond( G, v.a, mine.map( ( c ) => c.id ), 2 + strangers, v.keep || [] )
		.map( ( l ) => ( strangers ? l.filter( ( f ) => !seated.has( f.id ) ).slice( 0, 2 ) : l ) ), fars = [];
	disc( lay.C, 26 );
	const mid = wide( cut( first( v.a ), FONT.subject, Math.min( tx( 240 ), W - 24 ) ), FONT.subject ) / 2;
	discs.push( { x1: lay.C.x - mid, y1: lay.C.y + 22, x2: lay.C.x + mid, y2: lay.C.y + 22 + tx( 19 ) } );   // the middle's own name, tucked under it
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
	const names = mine.map( ( c ) => place( first( c.id ), seatOf.get( c.id ), 14, FONT.named, tx( 16 ), tx( 150 ) ) ||
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
		f.name = f.named ? place( first( f.id ), f.at, 6, FONT.far, tx( 15 ), tx( 132 ) ) : null;
		f.named = !!f.name;                                          // no room for the name: a bead, and the note says who
	}
	// The rest of the company: where nothing else is, and where the thin line to it from the middle crosses no name.
	const open = K.away( K.clearOf( lay.dots, discs.concat( labels ), 9 ), pts, 11 ).filter( ( p ) => clear( K.along( lay.C, p ), labels, 4 ) );
	return { names, fars, open, pts, boxes: discs.concat( labels ) };
}

/** Where along the line come down its label may lie, from the middle (0) to the far end (1): a little past halfway first, then out and in by turns. */
const WAY = [ 0.56, 0.6, 0.52, 0.64, 0.48, 0.68, 0.44, 0.72, 0.4, 0.76, 0.36, 0.8, 0.32, 0.84, 0.28, 0.88 ];

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
	// Rabbithole's traverse (Justin, #connectome, 18 Nov 2026: "I want the solos to traverse to the picker, but
	// ensuring that the song still remains very visible; as big as the picker"): the one taking the solo in the
	// middle, and the song in the ring's top seat, drawn as the song's own view draws it in its middle. Going from
	// the song's view to here, the soloist moves into the middle and the song to the seat they left (below).
	const playing = v.playing !== undefined && G.songcast ? G.songcast[ v.playing ] : null;
	// And the rest of the band round them the whole time (Justin, #connectome, 20 Nov 2026, 19:41Z: "whoever is next
	// in order of solos is already shown. Otherwise, it jumps to someone who is, at the time the jump starts, off
	// the page ... it probably just makes sense to keep the ensemble visible the whole time"): everyone else on the
	// cut holds a named seat ahead of the soloist's other company, the same seat from one solo to the next. `band`:
	// those of them the soloist has a tie with; `apart`: those the sources tie to nobody here, who are on the song
	// all the same, and hang on a line from it.
	const others = playing ? K.bandOf( G, playing, a ) : [];
	const band = others.filter( ( id ) => G.adj[ a ].has( id ) ), apart = others.filter( ( id ) => !G.adj[ a ].has( id ) );
	const inBand = new Set( band );
	const pinned = ( c ) => came.has( c.id ) || c.id === goal || inBand.has( c.id );
	const queue = K.keeping( G, a, comp, band.concat( goal === undefined ? ( v.keep || [] ) : ( v.keep || [] ).concat( goal ) ) );
	const kept = K.fewPer( G, queue, 2, queue.filter( pinned ).length );
	const carded = cardOn( v );                                     // their card in the upper right corner: one seat fewer round them
	// The places round the middle: as many as the frame names, and while a song plays as many as its band takes
	// (K.bandSeats: with the song's own and the card's empty one), where the frame holds them.
	const usual = H > 560 && W > 700 ? 8 : ( W > 460 || H > 500 ? 6 : 4 );
	const want = playing ? K.bandSeats( others.length, usual, carded, W, H ) : Math.min( kept.length, usual );
	// another turn of the company, where there are more than one view names; those the reader came by stay, and the goal
	const stay = kept.filter( pinned ).length + apart.length;
	const ring = K.turned( kept, stay - apart.length, Math.max( 1, want - stay ), v.turn || 0 );
	ring.splice( band.length, 0, ...apart.map( ( id ) => ( { id, tie: { w: 0.35, ev: [], played: false }, apart: true } ) ) );
	// How many of the company are left for beads: all but those the ring names (a place is the card's, where it is
	// out, and one the song's while it plays).
	const places = want - ( carded && want > 2 ? 1 : 0 );
	const need = Math.max( 0, ring.length - places + ( playing && places > 1 ? 1 : 0 ) );
	const lay = ringFor( { W, H, named: want, dots: playing && carded ? Math.ceil( need * 1.5 ) + 2 : need, far: true, over: !!playing }, carded );
	// The card's corner, in the drawing's own measure: nothing named is set down under it.
	const corner = carded ? cardRoom( W ).box : null;
	if ( playing && carded ) {
		// Nothing small pointing up at the card while the music steers (the same message: "maybe we can reduce the
		// number of small one pointing to the upper-right if rabbithole is playing"): no bead in the upper right,
		// and the beads there would have been are spread round the rest.
		lay.dots = K.spread( lay.dots.filter( ( p ) => !( p.x > lay.C.x + 20 && p.y < lay.C.y - 20 ) ), need + 2 );
	}
	if ( corner && lay.named.length ) {
		// The ring sits clear below the card: where its top place would be under the card's corner, the whole of
		// it is set down lower, as far as the frame has room under it.
		// By the named places alone, which are the same for every one of a band: the ring is as low for each solo.
		const top = Math.min( ...lay.named.map( ( p ) => p.y ) ), foot = Math.max( ...lay.named.map( ( p ) => p.y ) );
		// (Not playing, a seat's name may be written over and beside it, a step further being in sight: the room for that.)
		const lower = Math.round( Math.max( 0, Math.min( corner.y2 + ( playing ? 30 : 24 + tx( 18 ) ) - top, H - 44 - tx( 18 ) - foot ) ) );
		if ( lower > 0 ) {
			const drop = ( p ) => {
				p.y += lower;
			};
			[ lay.C, ...lay.named, ...lay.dots ].forEach( drop );
			( lay.far || [] ).forEach( ( f ) => [ f.main, ...f.sides ].forEach( drop ) );
			lay.dots = lay.dots.filter( ( p ) => p.y < H - 10 );
		}
	}
	let songAt = null;
	if ( playing && lay.named.length > 1 ) {
		// the top seat; where the card's corner comes down over that one, the highest that is clear of it
		const under = ( p ) => !!corner && p.x + 62 > corner.x1 && p.y - 26 < corner.y2;       // its mark, and the way into Rabbithole beside it
		const high = ( from ) => from.reduce( ( best, i ) => ( best < 0 || lay.named[ i ].y < lay.named[ best ].y ? i : best ), -1 );
		const all = lay.named.map( ( _, i ) => i ), clear = all.filter( ( i ) => !under( lay.named[ i ] ) );
		// Not always the top seat (Justin, #connectome, 22 Nov 2026, 00:55Z: "now the song's node just always sits on
		// top; it feels really awkward ... I think I retract that. Not sure if there's a middle ground"). The middle
		// ground: the song and the first soloist trade places. Out of the song's own view, the song goes to the seat
		// the soloist has left for the middle, and keeps that seat from one solo to the next, as the band keeps
		// theirs. Only with nothing in sight to go by (a song come on with the graph) does it take the top seat.
		// (The song was in the middle when it is nearer the middle than half the ring: the ring may have been set down
		// lower under the card since, so not where the middle is now.)
		const ringR = Math.min( ...lay.named.map( ( p ) => Math.hypot( p.x - lay.C.x, p.y - lay.C.y ) ) );
		const from = was.get( 'song' ), mid = from && Math.hypot( from.x - lay.C.x, from.y - lay.C.y ) < ringR / 2;
		const aim = from && !mid ? from : was.get( 'p' + a );
		const free = clear.length ? clear : all;
		const top = aim ? free.reduce( ( best, i ) => ( Math.hypot( lay.named[ i ].x - aim.x, lay.named[ i ].y - aim.y ) <
			Math.hypot( lay.named[ best ].x - aim.x, lay.named[ best ].y - aim.y ) ? i : best ), free[ 0 ] ) : high( free );
		songAt = lay.named[ top ];
		lay.named = lay.named.filter( ( _, i ) => i !== top );
		if ( lay.far ) {
			lay.far = lay.far.filter( ( _, i ) => i !== top );
		}
	}
	const n = lay.named.length, mine = ring.slice( 0, n );
	// While a song plays nothing slides: each of the band wants the seat they have, and the one whose solo is over
	// (they were in the middle) the seat the next one has left. Otherwise the whole picture slides as one.
	const pan = playing ? { x: 0, y: 0 } : slide( 'p' + a, lay.C );
	const left = playing ? was.get( 'p' + a ) : null;
	const wantOf = ( is ) => {
		const w = wanted( is, pan );
		return w && left && Math.hypot( w.x - lay.C.x, w.y - lay.C.y ) < 24 ? left : w;
	};
	const seats = K.seat( lay.named, mine.map( ( c ) => wantOf( 'p' + c.id ) ) );
	const seatOf = new Map( mine.map( ( c, i ) => [ c.id, lay.named[ seats[ i ] ] ] ) );
	// The web: who of the company have played with each other.
	const web = K.among( G, [ ...seatOf.keys() ], looseOnly ).map( ( t ) => Object.assign( t, { bow: K.arc( lay, seatOf.get( t.u ), seatOf.get( t.v ) ) } ) );
	// A step further, where there's room: then it says where the names and the beads go, since there are lines out as well as in.
	const out = lay.far ? further( v, lay, mine, seats, seatOf, web, W, H ) : null;
	// Each name as it will be written, so no bead is set down under one, however long it is or far it leans.
	// A name over a seat beside the card's corner ends where the card begins, as one by the frame's edge ends there.
	const edge = ( pos ) => ( corner && !pos.below && pos.y - 18 - tx( 18 ) < corner.y2 + 4 && pos.x < corner.x1 ? Math.min( W, corner.x1 - 2 ) : W );
	// Nor on the song's mark, where a seat beside the song's has its name in the song's own row: it ends short of it.
	const nameFor = ( name, pos ) => {
		let lo = 4, hi = edge( pos ) - 4;
		if ( songAt ) {
			const y1 = pos.below ? pos.y + 18 : pos.y - 18 - tx( 18 ), y2 = pos.below ? pos.y + 18 + tx( 18 ) : pos.y - 18;
			if ( y2 > songAt.y - 34 && y1 < songAt.y + 34 ) {
				if ( pos.x < songAt.x ) {
					hi = Math.min( hi, songAt.x - 38 );
				} else {
					lo = Math.max( lo, songAt.x + 68 );
				}
			}
		}
		const lean = ( pos.lean || 0 ) * ( wide( K.clip( name, 26 ), FONT.named ) / 2 + 3 );
		const fit = fitName( name, pos.x + lean, lo, Math.max( hi, lo + 40 ), FONT.named );
		return { label: fit.label, dx: Math.round( lean ) + fit.dx };
	};
	const names = out ? out.names : mine.map( ( c, i ) => nameFor( first( c.id ), lay.named[ seats[ i ] ] ) );
	// No bead on the song's mark or under its name, now the song may sit in any seat: a bead's own name is written
	// beside it, so the room kept is a name's width either side.
	const offSong = ( p ) => !songAt || Math.abs( p.x - songAt.x ) > 78 || p.y < songAt.y - 52 - tx( 17 ) || p.y > songAt.y + 46;
	const spots = ( out ? K.spread( out.open.filter( offSong ), ring.length - n ) : K.clearOf( lay.dots.filter( offSong ), names.map( ( nm, i ) => {
		const pos = lay.named[ seats[ i ] ];
		return nameBox( pos, nm.dx, wide( nm.label, FONT.named ) / 2, pos.below ? 18 : -18 - tx( 18 ), pos.below ? 18 + tx( 18 ) : -18 );
	} ), 10 ) );
	const shown = n + spots.length;
	const beads = K.seat( spots, ring.slice( n, shown ).map( ( c ) => wantOf( 'p' + c.id ) ) );
	// Where the line the reader came by says what it is: a little past halfway out, or further, until its band
	// is clear of the middle's own name (Justin, #connectome, 15 Nov 2026: a label never on the middle's name).
	const midBox = ( () => {
		const half = wide( cut( first( a ), FONT.subject, Math.min( tx( 240 ), W - 24 ) ), FONT.subject ) / 2;
		const R = G.people[ a ].img ? 26 : 22, base = lay.C.y + R + 10 + down( 17 );        // as draw.node sets the subject's name
		return { x1: lay.C.x - half - 4, y1: base - tx( 16 ), x2: lay.C.x + half + 4, y2: base + 6 };
	} )();
	// The one in the middle is named there too, as on the cards, though the headline says who it is (Justin, #connectome, 15 Nov 2026).
	addNode( sc, a, lay.C, 'subject', { rabbit: true, label: cut( first( a ), FONT.subject, Math.min( tx( 240 ), W - 24 ) ) } );
	// The song's name, over it: between whatever is named to either side of it in its own row, the card's corner
	// among them, and cut short where that leaves it less room than it takes.
	const songName = ( () => {
		if ( !songAt ) {
			return null;
		}
		const y1 = songAt.y - 40 - tx( 17 ), y2 = songAt.y - 36;   // written as a middle's name is (FONT.subject), with the paper round its letters
		let lo = 7, hi = W - 7;
		const keep = ( x1, x2 ) => {
			if ( x1 > songAt.x ) {
				hi = Math.min( hi, x1 - 9 );
			} else if ( x2 < songAt.x ) {
				lo = Math.max( lo, x2 + 9 );
			}
		};
		if ( corner && y1 < corner.y2 + 4 ) {
			keep( corner.x1, 1e5 );
		}
		mine.forEach( ( c, i ) => {
			const pos = lay.named[ seats[ i ] ], nm = names[ i ];
			if ( pos.y + 16 > y1 && pos.y - 16 < y2 ) {                // their mark
				keep( pos.x - 16, pos.x + 16 );
			}
			if ( !out && nm ) {                                      // and their name, where this view says where names go
				const b = nameBox( pos, nm.dx || 0, wide( nm.label, FONT.named ) / 2, pos.below ? 18 : -18 - tx( 18 ), pos.below ? 18 + tx( 18 ) : -18 );
				if ( b.y2 > y1 && b.y1 < y2 ) {
					keep( b.x1, b.x2 );
				}
			}
		} );
		return fitName( K.clip( playing.song, 30 ), songAt.x, lo, Math.max( hi, lo + 40 ), FONT.subject );
	} )();
	const songHalf = songName ? Math.max( 34, wide( songName.label, FONT.subject ) / 2 + 3 ) : 0, songDx = songName ? songName.dx : 0;
	if ( songAt ) {                                                  // the song on now, and the line from it to who's taking it
		const cuts = ( playing.on || [] ).map( ( m ) => G.music[ m ] ).filter( Boolean );
		const tier = cuts.length ? Math.max( ...cuts.map( ( c ) => c.tier ) ) : 0;
		sc.nodes.set( 'song', { stands: 'song', is: 'song', x: songAt.x, y: songAt.y, kind: 'song', o: 1, title: playing.song, tier,
			cuts: [ cuts[ 0 ] ].filter( Boolean ), cut: v.playing, above: true, dx: songDx, label: songName.label } );
		sc.lines.set( 'sp' + a, { a: 'song', b: 'p' + a, u: -1, v: a, tie: { played: true, tier, w: 1 }, stands: 'tie',
			w: lineWidth( { w: 1 } ), o: 1, role: 'spoke', c: a, quiet: true, delay: 120 } );
	}
	// What stands in the drawing before any line says what it is: the middle and its name, each named face, and the
	// names as written (bigger words reach further along the lines than the circles do), the song's mark and name.
	const settled = [ { x1: lay.C.x - 30, y1: lay.C.y - 30, x2: lay.C.x + 30, y2: lay.C.y + 30 } ]
		.concat( mine.map( ( c ) => seatOf.get( c.id ) ).map( ( p ) => ( { x1: p.x - 17, y1: p.y - 17, x2: p.x + 17, y2: p.y + 17 } ) ) );
	if ( out ) {
		settled.push( ...out.boxes );
	} else {
		mine.forEach( ( c, i ) => {
			const pos = seatOf.get( c.id );
			settled.push( nameBox( pos, names[ i ].dx || 0, wide( names[ i ].label, FONT.named ) / 2, pos.below ? 18 : -18 - tx( 18 ), pos.below ? 18 + tx( 18 ) : -18 ) );
		} );
	}
	const midName = wide( cut( first( a ), FONT.subject, Math.min( tx( 240 ), W - 24 ) ), FONT.subject ) / 2;
	settled.push( { x1: lay.C.x - midName, y1: lay.C.y + 22, x2: lay.C.x + midName, y2: lay.C.y + 22 + tx( 19 ) } );
	if ( songAt ) {                                                  // the song's mark and its name over it
		settled.push( { x1: songAt.x + songDx - songHalf, y1: songAt.y - 40 - tx( 17 ), x2: songAt.x + Math.max( songDx + songHalf, 34 ), y2: songAt.y + 34 } );
	}
	const labelled = () => [ ...sc.pills.values() ].map( ( p ) => ( { x1: p.x - p.w / 2, y1: p.y - 12, x2: p.x + p.w / 2, y2: p.y + 12 } ) );
	/**
	 * The line the reader came down, saying what it is: a little past halfway out, or wherever along it the label
	 * lies clear of every face, every name and the labels already down. A label lies across its line, so on a line
	 * that runs level it has only the run between the two faces: there it is cut to fit, a show down to its night
	 * alone. Where nothing fits, the faces keep the room, and the line says it when its far end is pointed at.
	 *
	 * It was set down unlooked-at, as wide as it came (re, #connectome, 20 Nov 2026, 21:53Z: at Jonathan Mann, come
	 * by Jake Stargel, "the 'Moon Factory' label and a show label sit on top of Jake's and Justin's circles").
	 * Justin, the same day, 19:41Z: "always show on one of the main spokes whatever we clicked to get there."
	 */
	const onTheWay = ( id, pos, tie, prefer ) => {
		const len = Math.hypot( pos.x - lay.C.x, pos.y - lay.C.y ), busy = labelled().concat( settled, [ midBox ] );
		const point = ( f ) => ( { x: lay.C.x + ( pos.x - lay.C.x ) * f, y: lay.C.y + ( pos.y - lay.C.y ) * f } );
		const clearAt = ( w ) => WAY.find( ( f ) => {
			const { x, y } = point( f );
			return x - w / 2 > 3 && x + w / 2 < W - 3 && !busy.some( ( b ) => x - w / 2 < b.x2 + 2 && b.x1 < x + w / 2 + 2 && y - 12 < b.y2 + 2 && b.y1 < y + 12 + 2 );
		} );
		// as wide as it was first, a show with some of its name; then cut tighter and tighter, a show to its night alone
		const room0 = Math.max( 92, Math.min( 190, len - 64 ) );
		const rungs = [ [ room0, false ] ].concat( [ 150, 120, 96, 72 ].filter( ( r ) => r < room0 ).map( ( r ) => [ r, true ] ) );
		for ( const [ room, bare ] of rungs ) {
			const fit = pillsFor( tie, room, 1, prefer, undefined, bare );
			const f = fit.shown.length ? clearAt( fit.shown[ 0 ].w ) : undefined;
			if ( f !== undefined ) {
				const at = point( f );
				placePills( sc, a, id, tie, at.x - room / 2, at.x + room / 2, at.y, 1, 1, 0, prefer, undefined, undefined, bare );
				return;
			}
		}
		const at = point( 0.58 ), room = Math.min( 200, W * 0.32 );
		placePills( sc, a, id, tie, at.x - room / 2, at.x + room / 2, at.y, 1, 0, 0, prefer, { shy: true, owner: 'p' + id, is: undefined } );
	};
	ring.slice( 0, shown ).forEach( ( c, i ) => {
		const named = i < n;
		const pos = named ? lay.named[ seats[ i ] ] : spots[ beads[ i - n ] ];
		const by = named && came.has( c.id );
		addNode( sc, c.id, pos, named ? 'named' : 'dot',
			Object.assign( { r: dotRadius( c.tie.w ), delay: named ? 80 + i * 40 : 300, tie: c.apart ? undefined : c.tie }, named ? names[ i ] : null ) );
		if ( c.apart ) {                                             // on the song, and tied to the soloist by nothing the sources name: the song's line says so
			if ( songAt ) {
				sc.lines.set( 'sp' + c.id, { a: 'song', b: 'p' + c.id, u: -1, v: c.id, tie: { played: true, tier: 0, w: 0.35 }, stands: 'tie',
					w: lineWidth( { w: 0.35 } ), o: named ? 0.6 : 0, role: 'spoke', c: c.id, quiet: true, fine: !named, delay: 300 } );
			}
			return;
		}
		// With a step further in sight, the rest of the company are on thin lines from the middle, as on the cards:
		// then every dot says how it is reached. Without, their lines wait for a pointer.
		addLine( sc, a, c.id, c.tie, { o: named ? ( by ? 1 : 0.9 ) : ( out ? FAINT : 0 ), quiet: !named, fine: !named && !!out, emph: by,
			delay: named ? 120 + i * 40 : 300, role: 'spoke', c: c.id } );
	} );
	// The line the reader came down says what it is, on it: once every face and name is set down, so it lies over none.
	ring.slice( 0, n ).forEach( ( c, i ) => {
		if ( !c.apart && came.has( c.id ) ) {
			onTheWay( c.id, lay.named[ seats[ i ] ], c.tie, v.by );
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
			onTheWay( homeId, seatOf.get( homeId ), { ev: [ { m: rec, how: K.TRACK, songs: [ home.song ] } ] }, undefined );
		}
	}
	// A line says what it is wherever there's room for it to (Justin, #connectome, 15 Nov 2026: "almost always
	// label lines"): the first thing the two share, by what comes first (K.standing). Where there isn't room, and
	// on the lines to those further off, it's said when the far end is pointed at or touched.
	const said = new Set( [ ...sc.pills.values() ].map( ( p ) => lineKey( p.u, p.v ) ) );
	const taken = labelled().concat( settled );
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
		if ( c.apart || said.has( lineKey( a, c.id ) ) ) {
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
					nameBox( pos, nm.dx || 0, wide( nm.label, FONT.named ) / 2, pos.below ? 18 : -18 - tx( 18 ), pos.below ? 18 + tx( 18 ) : -18 ) );
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
		svg.style.height = MINI ? '' : Math.max( need, stage.clientHeight - ( $( 'say' ).offsetHeight || 0 ) ) + 'px';
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
let hostFresh = false;
function goFromHost( to, fresh ) {
	if ( typeof to !== 'string' ) {
		return;
	}
	if ( !G ) {
		hostTo = to;
		hostFresh = !!fresh;
		return;
	}
	hostTo = null;
	const v = parse( new URLSearchParams( to.replace( /^\?/, '' ) ) );
	if ( !v ) {
		tell( { missing: to } );
		return;
	}
	if ( !same( v, view ) || !$( 'oracle' ).hidden ) {
		freshStep = !!fresh;             // opened as a step of the shell's own: the view before keeps its number, and its drawing
		go( v, true );
	}
}

/**
 * The shell's word that the reader went Back or Forward to a step of the graph's: this page's address becomes that
 * step's, and the step comes back as the browser's own popstate would bring it, as it was drawn where this page
 * drew it.
 */
function stepFromShell( d ) {
	if ( !SHELL || typeof d.to !== 'string' || !G ) {
		return;
	}
	const u = new URL( d.to, location.origin );
	if ( u.origin !== location.origin || !/^\/bacon(\/|$)/.test( u.pathname ) ) {
		return;
	}
	u.searchParams.set( 'host', HOST );
	u.searchParams.set( 'shell', '1' );
	history.replaceState( typeof d.n === 'number' && d.n > 0 ? { bacon: d.n, session: d.s } : null, '', u.pathname + u.search );
	comeTo( history.state );
}

// What Rabbithole says: the walk, the song on now, whether it plays, and whether the drawer is open; or, from its
// traverse, where the graph in its pane should go.
/*
 * The ensemble list's lights, on the graph too (Justin, #connectome, 20 Nov 2026, 14:16Z: "The effects in the
 * ensemble chart are looking great. I want to also see them in some form in the bacon graph. If a picker is
 * visible and they get a flourish, show the flourish in the graph as well as the ensemble list. Same for solos,
 * etc. Let's make the effects give the sense of a match between the ensemble list and the bacon graph").
 * Rabbithole says what its list shows ({ rabbithole: 'fx', playing, band: [ { name, title, scene, singing,
 * enter, light: { kind, color, level, pulse } } ] }), each time it changes; whoever of that band is in sight here
 * wears a ring round their mark for it: steady and green while they take the lead, dashed for a pickup, and the
 * list's own colour and beat for a flourish, a spotlight or the whole band's flash. Paused with the song.
 */
let FX = null;
/*
 * Two flashes on a picker's mark, each once (Justin, #connectome, 23 Nov 2026, 18:30Z): pink on everybody of a song's
 * band when the song starts, traverse or not ("If you're looking at a bacon graph when a song starts, let's always
 * give a nice pink flash to everybody in the ensemble of that song"), and orange on one who comes in ("whenever
 * someone goes from 'out' to 'in'"). A mark drawn a moment later, when the graph has moved to the song, still gets
 * the song's flash: it holds for START_MS, and a mark (an element) has each flash once.
 */
const START_MS = 2500, ENTER_MS = 1500;
const flashes = { start: { at: -Infinity, ids: new Set(), on: new WeakSet() }, enter: new Map(), track: null };
let fxWas = new Map();                                              // what the band was at the last word: id -> { scene, enter }
function flash( el, kind ) {
	const main = el.querySelector( 'image.face, circle.dot, circle.ring' );
	const r = main ? ( parseFloat( main.getAttribute( 'r' ) ) || parseFloat( main.getAttribute( 'width' ) ) / 2 || 8 ) : 8;
	const ring = s( 'circle', { class: 'fxs fxs-' + kind, r: r + ( r < 7 ? 4 : 6 ) } );
	ring.addEventListener( 'animationend', () => ring.remove() );
	setTimeout( () => ring.remove(), 3000 );                            // a hidden frame runs no animation to its end
	el.insertBefore( ring, el.firstChild );
}

/**
 * What the band says a picker plays now, on the line under their name; where the band says nothing, what the view
 * drew. A name over its mark moves up a line to make room, one beside it half a line (instLine).
 */
function sayInst( el, d, inst ) {
	const text = el.querySelector( ':scope > a > text' );
	if ( text ) {
		instLine( text, inst || d.inst || '' );
	}
}

function fxApply() {
	if ( !G ) {
		return;
	}
	const band = new Map();
	for ( const b of FX && Array.isArray( FX.band ) ? FX.band : [] ) {
		const byTitle = b.title ? K.find( G, b.title ) : null;
		const id = byTitle !== null ? byTitle : K.find( G, b.name );         // a chart's "Justin Holmes" is the page's, and the graph's, "Justin Myles Holmes"
		if ( id !== null ) {
			band.set( id, b );
		}
	}
	svg.classList.toggle( 'fx-paused', !FX || !FX.playing );
	const now = performance.now();
	for ( const [ , it ] of live.node ) {
		const d = it.d, el = it.el;
		const b = !it.dead && d.stands === 'picker' ? band.get( d.id ) : null;
		const light = b && b.light ? b.light : null;
		if ( !it.dead && d.stands === 'picker' && d.kind !== 'dot' ) {
			// in brackets, what they have in hand on the song on now, as the list has it (Justin, 23 Nov 2026: "A song
			// is currently playing in rabbithole for which we have ensemble metadata (and in this case, it makes sense
			// to also change instruments consistent with the rabbithole display)")
			sayInst( el, d, b && b.instrument ? String( b.instrument ) : '' );
			if ( b && now - flashes.start.at < START_MS && flashes.start.ids.has( d.id ) && !flashes.start.on.has( el ) ) {
				flashes.start.on.add( el );
				flash( el, 'start' );
			}
			const came = b ? flashes.enter.get( d.id ) : undefined;
			if ( came !== undefined && now - came < ENTER_MS ) {
				flashes.enter.delete( d.id );
				flash( el, 'enter' );
			}
		}
		const on = {
			'fx-lead': !!b && b.scene === 'lead', 'fx-pickup': !!b && b.scene === 'pickup', 'fx-enter': !!b && !!b.enter,
			'fx-flourish': !!light && light.kind === 'flourish', 'fx-glow': !!light && light.kind === 'spotlight', 'fx-band': !!light && light.kind === 'bandFlash',
		};
		const any = Object.values( on ).some( Boolean );
		let ring = el.querySelector( 'circle.fxr' );
		if ( !any ) {
			if ( ring ) {
				ring.remove();
				el.classList.remove( 'fx', ...Object.keys( on ) );
			}
			continue;
		}
		if ( !ring ) {
			const main = el.querySelector( 'image.face, circle.dot, circle.ring' );
			const r = main ? ( parseFloat( main.getAttribute( 'r' ) ) || parseFloat( main.getAttribute( 'width' ) ) / 2 || 8 ) : 8;
			ring = s( 'circle', { class: 'fxr', r: r + ( r < 7 ? 4 : 6 ) } );
			el.insertBefore( ring, el.firstChild );
		}
		el.classList.add( 'fx' );
		for ( const [ name, yes ] of Object.entries( on ) ) {
			el.classList.toggle( name, yes );
		}
		if ( light ) {
			ring.style.setProperty( '--fx-color', String( light.color || '' ).replace( /[^\w\s(),.%#-]/g, '' ) );
			ring.style.setProperty( '--fx-level', String( Math.max( 0.35, Math.min( 1.3, Number( light.level ) || 0.7 ) ) ) );
			ring.style.setProperty( '--fx-pulse', Math.max( 0.5, Math.min( 6, Number( light.pulse ) || 1.2 ) ) + 's' );
		}
	}
}

/**
 * What changed in the band since its last word: a song begun (a track not flashed yet, playing), or somebody coming
 * in (the list's `enter`, or a scene of 'out' that is no longer). Each is flashed by fxApply on the marks in sight.
 */
function fxHeard( fx ) {
	const band = Array.isArray( fx.band ) ? fx.band : [];
	const idOf = ( b ) => {
		const byTitle = b.title ? K.find( G, b.title ) : null;
		return byTitle !== null ? byTitle : K.find( G, b.name );
	};
	const now = performance.now(), is = new Map();
	for ( const b of band ) {
		const id = G ? idOf( b ) : null;
		if ( id !== null ) {
			is.set( id, { scene: b.scene || null, enter: !!b.enter } );
		}
	}
	// the song: its track, as Rabbithole says it; from a Rabbithole that doesn't say, who is in its band
	const track = fx.track || ( band.length ? 'band:' + band.map( ( b ) => b.name ).sort().join( '|' ) : null );
	if ( fx.playing && track && track !== flashes.track && is.size ) {
		flashes.track = track;
		flashes.start = { at: now, ids: new Set( is.keys() ), on: new WeakSet() };
	}
	if ( track === flashes.track && !( now - flashes.start.at < START_MS ) ) {
		// coming in, once the song is under way: at its start everybody is coming in, and the pink says so
		for ( const [ id, b ] of is ) {
			const was = fxWas.get( id );
			if ( was && ( ( b.enter && !was.enter ) || ( was.scene === 'out' && b.scene !== 'out' ) ) ) {
				flashes.enter.set( id, now );
			}
		}
	}
	fxWas = is;
}

window.addEventListener( 'message', ( ev ) => {
	if ( !HOST || ev.origin !== location.origin || ev.source !== window.parent || !ev.data ) {
		return;
	}
	if ( ev.data.rabbithole === 'go' ) {
		goFromHost( ev.data.to, ev.data.fresh );
		return;
	}
	if ( ev.data.rabbithole === 'step' ) {
		stepFromShell( ev.data );
		return;
	}
	if ( ev.data.rabbithole === 'fx' ) {
		FX = ev.data;                                                // what the ensemble list is showing now
		fxHeard( FX );
		fxApply();
		return;
	}
	if ( ev.data.rabbithole === 'bar' ) {                        // the shell's bar, pressed: the link, or the FAQ
		barAct( ev.data.act );
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
	if ( SHELL && typeof d.steering === 'boolean' && d.steering !== steering ) {
		steering = d.steering;                                       // the reader steers, or the music does: the bar and the way come, or neither
		document.body.classList.toggle( 'steering', steering );
	document.body.classList.toggle( 'shell', !!SHELL );
		if ( G && view ) {
			pathSay();
		}
	}
	if ( typeof d.night === 'boolean' ) {                        // night as the player has it (Justin, #rabbithole, 15 Nov 2026,
		                                                     // item 5: the drawer "in dark mode even if the page is light"):
		                                                     // in the frame the player says, not this page's own reading
		document.documentElement.classList.toggle( 'pp-dark', d.night );
		document.documentElement.classList.toggle( 'pp-light', !d.night );
	}
	const wasAt = walkAt, wasCid = walkNow.cid;
	walkNow = { cid: d.now || null, playing: !!d.playing };
	playSay();
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
	document.body.classList.toggle( 'steering', steering );
	document.body.classList.toggle( 'shell', !!SHELL );
	document.body.classList.toggle( 'barless', !!BARLESS );
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
function pieceLabel( id, pos, W, own ) {
	const pc = M( id ), c = K.called( G, pc );
	const play = pc.kind === 'track' ? K.playOf( G, G.music[ pc.m ], pc.song ) : '';
	// the one in the middle is written bigger (the stylesheet's .pk.subject), and is measured as written
	const name = nameAt( K.clip( c.name, 24 ), pos, W - ( play ? 40 : 0 ), own ? FONT.own : FONT.piece );
	const sub = c.sub ? nameAt( K.clip( c.sub, 24 ), pos, W, FONT.sub ) : null;
	return { label: name.label, dx: name.dx, sub: sub ? sub.label : '', sdx: sub ? sub.dx : 0, play };
}

/*
 * A show in the middle (Justin, #connectome, 26 Nov 2026, 01:46Z and 02:15Z): the show, and beside it whoever it is
 * billed to, each act its own mark, the main act the biggest ("the three central nodes: the show itself and the two
 * bands, with the main act more prominent. Maybe four actually if we include the venue"); the venue under it; the
 * show's picture where it has one (its card, out from the start). Round them only who was on its stage, each on a
 * spoke from their act, with what they played where the source says; and lines between those of them who have
 * played together anywhere else ("Let's still show links _between the people in the ensemble_ ... Just no two-hop
 * edges"). An act led by a picker is that picker's own mark (Kyle Tuttle at Dee's); one with no leader (BKH & JC,
 * Yonder Mountain String Band) is a mark of its own, with its name.
 */
const SHOW_RING = 16;            // pickers round a show, named; past that, beads
const SHOW_LEAST = 10;          // lines a show's graph draws at the least, filled out with its pickers' own other music (K.fillFor)
function showScene( v ) {
	const { W, H } = frame();
	const sc = newScene();
	const me = M( v.m ), nm = K.called( G, me ), m = G.music[ me.m ];
	const roles = new Map( ( m.cast || [] ).map( ( c ) => [ c[ 0 ], c[ 1 ] || '' ] ) );
	const cast = me.cast.filter( ( id ) => id >= 0 && id < G.people.length );
	const onStage = new Set( cast );
	const acts = K.actsOf( G, me.m ).map( ( a ) => Object.assign( {}, a, { members: a.members.filter( ( id ) => onStage.has( id ) ) } ) )
		.filter( ( a ) => a.members.length );
	// a merged night's other tape may put somebody on stage in no act: they join the main act
	const banded = new Set( acts.flatMap( ( a ) => a.members ) );
	if ( acts.length ) {
		acts[ 0 ].members = acts[ 0 ].members.concat( cast.filter( ( id ) => !banded.has( id ) ) );
	}
	const leaders = new Set( acts.map( ( a ) => a.lead ).filter( ( id ) => id !== null && onStage.has( id ) ) );
	const actOf = new Map();                                      // a picker -> the index of their act
	acts.forEach( ( a, i ) => a.members.forEach( ( id ) => actOf.has( id ) || actOf.set( id, i ) ) );
	const ring = cast.filter( ( id ) => !leaders.has( id ) );
	const carded = cardOn( v );
	const shown = Math.min( ring.length, SHOW_RING );
	const lay = ringFor( { W, H, named: shown + ( carded && shown > 1 ? 1 : 0 ), dots: Math.max( 0, ring.length - shown ) }, carded );
	const C = lay.C;
	// The middle's own room: the acts beside the show and the venue under it, each with its name, clear of one another;
	// the ring is then set out past them, as far as the frame allows
	const narrowFrame = W < 520;
	const dx = narrowFrame ? Math.max( 78, Math.min( 105, W * 0.24 ) ) : Math.max( 110, Math.min( 150, W * 0.12 ) );
	const dy = narrowFrame ? 92 : Math.max( 96, Math.min( 120, H * 0.15 ) );
	// One act: it stands right under the show, the show's poster bigger over it, the venue under the act (Justin,
	// #connectome, 27 Nov 2026, 05:59Z: "if there's only one main act, it looks weird to have it off to the left. It
	// seems like it needs to be stacked right under the show, maybe with the show poster")
	const stack = acts.length === 1;
	const S = stack ? { x: C.x, y: Math.round( C.y - dy * 0.62 ) } : C;              // the show's own place
	const venueClip = narrowFrame ? 16 : 30, venueHalf = m.venue ? Math.min( venueClip, String( m.venue ).length ) * 4.3 + 8 : 0;
	const rxMin = stack ? Math.max( narrowFrame ? 110 : 150, venueHalf + ( narrowFrame ? 34 : 80 ) ) : dx + ( narrowFrame ? 64 : 120 );
	const ryMin = stack ? Math.round( dy * 1.5 ) + ( narrowFrame ? 62 : 70 ) : dy + ( narrowFrame ? 70 : 64 );
	for ( const p of lay.named.concat( lay.dots ) ) {
		const vx = p.x - C.x, vy = p.y - C.y, e = Math.hypot( vx / rxMin, vy / ryMin );
		if ( e > 0 && e < 1 ) {
			p.x = Math.round( Math.max( 50, Math.min( W - 50, C.x + vx / e ) ) );
			p.y = Math.round( Math.max( 40, Math.min( H - 40, C.y + vy / e ) ) );
		}
	}
	const rx = Math.max( rxMin, ...lay.named.map( ( p ) => Math.abs( p.x - C.x ) ) );
	const ry = Math.max( ryMin, ...lay.named.map( ( p ) => Math.abs( p.y - C.y ) ) );
	const actAt = stack ? [ { x: C.x, y: Math.round( C.y + dy * 0.5 ) } ] : [ { x: C.x - dx, y: C.y - dy * 0.12 }, { x: C.x + dx, y: C.y - dy * 0.12 },
		{ x: C.x - dx * 0.62, y: C.y - dy * 0.95 }, { x: C.x + dx * 0.62, y: C.y - dy * 0.95 } ];
	const venueAt = stack ? { x: C.x, y: Math.round( C.y + dy * 1.5 ) } : { x: C.x, y: C.y + dy };
	const posterR = stack && m.art ? ( narrowFrame ? 36 : 42 ) : 30;
	// The show
	const named = K.naming( G, { m: me.m, how: K.STAGE, songs: [] } ), night = K.night( m.date );
	// its own name, else where it was, else whose it was; and the night under that. A year alone names nothing (Justin,
	// #connectome, 27 Nov 2026, 06:09Z: "what are the nodes that say only "2026"?  That's not a good name.")
	const called = named.who || night || 'a show';
	addPiece( sc, v.m, S, 'subject', { below: true, big: posterR, label: K.clip( called, 30 ),
		sub: called === night ? '' : K.clip( night, 28 ), dx: 0, sdx: 0, delay: 0 } );
	// The acts: a leader's own mark, or the act's
	const actKey = [];
	acts.slice( 0, actAt.length ).forEach( ( a, i ) => {
		const at = actAt[ i ];
		if ( a.lead !== null && onStage.has( a.lead ) ) {
			actKey[ i ] = 'p' + a.lead;
			const rest = K.actRest( a.title, first( a.lead ) );
			// under their name, the rest of the act's name ("and the Immutable String Band"), else what they played
			const plays = String( roles.get( a.lead ) || '' ).split( ';' ).map( ( r ) => r.trim() ).filter( Boolean ).join( ', ' );
			// named over the mark, where under it is the show's own name's row; under it, where it stands under the show
			addNode( sc, a.lead, at, a.main ? 'subject' : 'named', { below: stack, act: a.title, lead: true,
				inst: K.clip( rest || plays, 34 ), label: K.clip( first( a.lead ), 26 ), delay: 60 } );
		} else {
			actKey[ i ] = 'act' + i;
			sc.nodes.set( 'act' + i, { stands: 'act', is: 'act' + i, x: at.x, y: at.y, kind: a.main ? 'subject' : 'named', o: 1, delay: 60, above: !stack,
				title: a.title || 'the band', members: a.members, main: a.main, page: G.wikipages[ a.title ] || '' } );
		}
		sc.lines.set( 'sa' + i, { a: 'q' + v.m, b: actKey[ i ], u: -1, v: -1, tie: { played: true, tier: m.tier, w: 1 }, stands: 'tie',
			w: a.main ? 3.2 : 2.2, o: 0.95, role: 'spoke', quiet: true, delay: 80 } );
	} );
	// The venue, where the source says one
	if ( m.venue ) {
		sc.nodes.set( 'venue', { stands: 'venue', is: 'venue', x: venueAt.x, y: venueAt.y, kind: 'named', o: 1, delay: 90,
			title: m.venue, city: m.city || '', page: G.wikipages[ m.venue ] || '', clip: venueClip } );
		sc.lines.set( 'sv', { a: stack ? actKey[ 0 ] : 'q' + v.m, b: 'venue', u: -1, v: -1, tie: { played: true, tier: m.tier, w: 0.5 }, stands: 'tie',
			w: 1.4, o: 0.8, role: 'spoke', quiet: true, delay: 90 } );
	}
	// Who else was on stage, round them, each as near their act's side as the ring allows
	const pan = slide( 'm' + v.m, S );
	const toward = ( id ) => {
		const i = actOf.get( id ), at = i !== undefined && i < actAt.length ? actAt[ i ] : C;
		const ax = at.x - C.x, ay = at.y - C.y, len = Math.hypot( ax, ay ) || 1;
		return i === undefined || stack ? wanted( 'm' + v.m + '·' + id, pan ) : { x: C.x + ( ax / len ) * rx, y: C.y + ( ay / len ) * ry };
	};
	const mine = ring.slice( 0, lay.named.length );
	const seats = K.seat( lay.named, mine.map( toward ) );
	const seatOf = new Map( mine.map( ( id, i ) => [ id, lay.named[ seats[ i ] ] ] ) );
	for ( const id of mine ) {
		const i = actOf.get( id ), from = i !== undefined && actKey[ i ] ? actKey[ i ] : 'q' + v.m;
		sc.lines.set( 'sp' + id, { a: from, b: 'p' + id, u: -1, v: id, tie: { played: true, tier: m.tier, w: 0.35 }, stands: 'tie',
			w: lineWidth( { w: 0.35 } ), o: 0.9, role: 'spoke', c: id, quiet: true, delay: 120 } );
		addNode( sc, id, seatOf.get( id ), 'named', Object.assign( { delay: 180, act: i !== undefined ? acts[ i ].title : '' },
			playsAs( first( id ), roles.get( id ) || '', seatOf.get( id ), W, FONT.named ) ) );
	}
	ring.slice( mine.length ).forEach( ( id, k ) => {
		if ( lay.dots[ k ] ) {
			addNode( sc, id, lay.dots[ k ], 'dot', { r: 4, delay: 300 } );
		}
	} );
	// Lines between those of the show who have played together anywhere else: never anyone who wasn't on its stage.
	// Each thing two of them share besides this night is a strand of its own, a rainbow between them (Justin,
	// #connectome, 27 Nov 2026, 02:13Z: "still looks very bare ... Rainbow graphs between the existing pickers might
	// help?"): the freest where one line alone would lie, the rest beside it by turns (K.elsewhere, K.besides). A
	// spoke from a leader is the first already: what else they share lies beside it.
	const drawn = new Set( [ ...mine, ...leaders ] );
	const posOf = ( id ) => seatOf.get( id ) || ( sc.nodes.get( 'p' + id ) ) || C;
	const most = narrowFrame ? 5 : 9, gap = narrowFrame ? 4.5 : 6;
	// what a strand keeps off: the show and its name, the venue and its, the acts, and those of the stage it doesn't
	// end at (K.clearSteps); a strand with no clear way is left out
	const wide = ( text, px ) => Math.max( 34, String( text || '' ).length * px / 2 + 6 );
	const own = sc.nodes.get( 'q' + v.m ), ownW = wide( own.label, 10 );       // each mark's circle, and its name under it, a box each
	const ownR = posterR + 4;
	const marks = [ { k: 'q' + v.m, x1: S.x - ownR, x2: S.x + ownR, y1: S.y - ownR, y2: S.y + ownR },
		{ k: 'q' + v.m, x1: S.x - ownW, x2: S.x + ownW, y1: S.y + ownR - 6, y2: S.y + ownR + ( own.sub ? 38 : 20 ) } ];
	if ( sc.nodes.has( 'venue' ) ) {
		marks.push( { k: 'venue', x1: venueAt.x - 20, x2: venueAt.x + 20, y1: venueAt.y - 20, y2: venueAt.y + 20 },
			{ k: 'venue', x1: venueAt.x - wide( K.clip( m.venue, venueClip ), 8.4 ), x2: venueAt.x + wide( K.clip( m.venue, venueClip ), 8.4 ), y1: venueAt.y + 18, y2: venueAt.y + 42 } );
	}
	actKey.forEach( ( key, i ) => {
		const at = actAt[ i ], nd = sc.nodes.get( key ), name = nd.label || nd.title || '';
		marks.push( { k: key, x1: at.x - Math.max( 30, wide( name, 10 ) ), x2: at.x + Math.max( 30, wide( name, 10 ) ), y1: at.y - ( stack ? 30 : 52 ), y2: at.y + ( stack ? 52 : 30 ) } );
	} );
	for ( const [ id, p ] of seatOf ) {
		marks.push( { k: 'p' + id, x1: p.x - 13, x2: p.x + 13, y1: p.y - 13, y2: p.y + 13 } );
	}
	const keepOff = ( ...ends ) => marks.filter( ( b ) => !ends.includes( b.k ) );
	for ( const t of K.among( G, [ ...drawn ], false ) ) {
		const also = K.elsewhere( G, t.tie, v.m, most );
		if ( !also.length ) {
			continue;                                                 // this show is all they share
		}
		const pa = posOf( t.u ), pb = posOf( t.v ), boxes = keepOff( 'p' + t.u, 'p' + t.v );
		const spoke = ( x, y ) => leaders.has( x ) && actKey[ actOf.get( y ) ] === 'p' + x;
		let base = STRAIGHT, taken = false;
		if ( spoke( t.u, t.v ) || spoke( t.v, t.u ) ) {
			const who = leaders.has( t.u ) ? t.v : t.u, sp = sc.lines.get( 'sp' + who );
			if ( sp ) {                                               // the spoke from their leader says it: what else they share
				// and bends round the show's name where the straight way runs through it
				const k = K.clearSteps( pa, pb, STRAIGHT, 1, 2 * gap, boxes, { W, H } )[ 0 ];
				base = k ? K.strandBow( pa, pb, STRAIGHT, k, 2 * gap ) : STRAIGHT;
				Object.assign( sp, { tie: t.tie, quiet: false, u: t.u, v: t.v, role: 'shared', w: Math.max( sp.w, lineWidth( t.tie ) * 0.7 ), o: 1, bow: base } );
				taken = true;
			}
		} else if ( seatOf.has( t.u ) && seatOf.has( t.v ) ) {
			base = K.arc( lay, pa, pb );
		}
		K.clearSteps( pa, pb, base, also.length, gap, boxes, { taken, W, H } ).forEach( ( k, i ) => {
			if ( k === null ) {
				return;
			}
			const x = also[ i ];
			sc.lines.set( 'ss' + lineKey( t.u, t.v ) + '.' + x.piece, { a: 'p' + t.u, b: 'p' + t.v, u: t.u, v: t.v, tie: t.tie, e: x.e, piece: x.piece,
				stands: 'piece', strand: true, role: 'shared', fine: true, w: strandWidth( x.e ), o: 0.85, bow: K.strandBow( pa, pb, base, k, gap ),
				delay: 300 + i * 18 } );
		} );
	}
	// A stage that shares little besides this night: filled out to SHOW_LEAST lines with its pickers' own other shows
	// and records (K.fillFor), each a bead past its picker, away from the middle, where it lies clear (its tip and its
	// sheet say what it is);
	// never anyone who wasn't on the stage (Justin, #connectome, 27 Nov 2026, 02:13Z and 05:15Z)
	const said = [ ...sc.lines.values() ].filter( ( l ) => !l.quiet ).length;
	if ( said < SHOW_LEAST ) {
		const strung = new Set( [ ...sc.lines.values() ].filter( ( l ) => l.strand ).map( ( l ) => l.piece ) );
		const fill = K.fillFor( G, [ ...leaders, ...mine ], v.m, strung, SHOW_LEAST - said, narrowFrame ? 2 : 4 );
		const over = ( p, q ) => p.x1 < q.x2 && p.x2 > q.x1 && p.y1 < q.y2 && p.y2 > q.y1;
		const room = marks.slice();
		for ( const [ id, p ] of seatOf ) {                           // the ring's names, under their circles
			const half = wide( first( id ), FONT.named ) / 2 + 4;
			room.push( { x1: p.x - half, x2: p.x + half, y1: p.y + 8, y2: p.y + 42 } );
		}
		if ( carded ) {
			room.push( cardRoom( W ).box );
		}
		const many = new Map(), nth = new Map();
		fill.forEach( ( f ) => many.set( f.id, ( many.get( f.id ) || 0 ) + 1 ) );
		fill.forEach( ( f, i ) => {
			const p = posOf( f.id ), j = nth.get( f.id ) || 0, n = many.get( f.id );
			// out from the middle, past its picker; the act under the show has its own to either side, not down the column
			const column = stack && actKey[ 0 ] === 'p' + f.id, side = column ? Math.ceil( ( j % 2 ? n - 1 : n ) / 2 ) : n;
			const out = column ? ( j % 2 ? 0 : Math.PI ) : Math.atan2( p.y - C.y, p.x - C.x ), k = column ? Math.floor( j / 2 ) : j;
			nth.set( f.id, j + 1 );
			const R = narrowFrame ? 52 : 70;
			for ( const r of [ R, R + 34, R - 18 ] ) {
				for ( const s of [ 0, 1, -1, 2, -2, 3, -3 ] ) {
					const a = out + ( k - ( side - 1 ) / 2 ) * 0.42 + s * 0.26;
					const at = { x: Math.round( p.x + Math.cos( a ) * r ), y: Math.round( p.y + Math.sin( a ) * r ), below: true };
					const box = { x1: at.x - 10, x2: at.x + 10, y1: at.y - 10, y2: at.y + 10 };   // a bead: its tip says what and when
					if ( box.x1 < 4 || box.x2 > W - 4 || box.y1 < 4 || box.y2 > H - 4 || room.some( ( b ) => over( box, b ) ) ) {
						continue;
					}
					room.push( box );
					addPiece( sc, f.piece, at, 'dot', { r: narrowFrame ? 5 : 5.5, who: [ f.id ], delay: 380 + i * 30 } );
					sc.lines.set( 'sf' + f.id + '.' + f.piece, { a: 'p' + f.id, b: 'q' + f.piece, u: f.id, v: -1, stands: 'tie', role: 'spoke', quiet: true, fine: true,
						tie: { played: true, tier: G.music[ M( f.piece ).m ].tier, w: 0.3 }, w: 1.1, o: 0.65, delay: 360 + i * 30 } );
					return;
				}
			}
		} );
	}
	sc.web = false;
	sc.head = [ h( 'span', { class: 'kind' }, glyphBox( nm.glyph ) ), nm.name + ( nm.sub ? ' · ' + nm.sub : '' ) ];
	const billed = acts.length ? acts.map( ( a ) => a.title || ( a.lead !== null ? first( a.lead ) : '' ) ).filter( Boolean ) : [];
	sc.sub = [ 'A show · ', h( 'b', null, K.plural( cast.length, 'picker' ) ), ' on its stage',
		billed.length ? [ ' · ', billed.join( ', then ' ) ] : '', ring.length > mine.length ? ` (${ mine.length } of them named)` : '' ].flat();
	return sc;
}

function pieceScene( v ) {
	if ( showView( v ) ) {
		return showScene( v );
	}
	const { W, H } = frame();
	const sc = newScene();
	const me = M( v.m ), nm = K.called( G, me );
	const L = K.leads( G, v.m, W > 700 && H > 520 ? 6 : ( W > 460 ? 5 : 4 ), v.hand || [], v.keep || [] );
	const carded = cardOn( v );
	const lay = ringFor( { W, H, named: L.named.length + ( carded ? 1 : 0 ), dots: L.rest.length }, carded );   // a show's card: its corner's place left empty
	if ( carded && lay.named.length ) {
		// and the ring set down clear below the card, as a picker's is (egoScene), so far as the frame has room under it:
		// a name and the line under it are written over a seat
		const corner = cardRoom( W ).box, top = Math.min( ...lay.named.map( ( p ) => p.y ) ), foot = Math.max( ...lay.named.map( ( p ) => p.y ) );
		const lower = Math.round( Math.max( 0, Math.min( corner.y2 + 24 + tx( 30 ) - top, H - 44 - tx( 30 ) - foot ) ) );
		if ( lower > 0 ) {
			[ lay.C, ...lay.named, ...lay.dots ].forEach( ( p ) => {
				p.y += lower;
			} );
			lay.dots = lay.dots.filter( ( p ) => p.y < H - 10 );
		}
	}
	const n = lay.named.length;
	const pan = slide( 'm' + v.m, lay.C );
	const seats = K.seat( lay.named, L.named.slice( 0, n ).map( ( x ) => wanted( 'm' + x.id, pan ) ) );
	// Each piece's name and the line under it, as they will be written, so no bead is set down under them.
	const names = L.named.slice( 0, n ).map( ( x, i ) => pieceLabel( x.id, lay.named[ seats[ i ] ], W ) );
	const written = names.map( ( nm, i ) => {
		const pos = lay.named[ seats[ i ] ], half = wide( nm.label, FONT.piece ) / 2, under = nm.sub ? wide( nm.sub, FONT.sub ) / 2 : 0;
		const x1 = Math.min( nm.dx - half, nm.sdx - under ), x2 = Math.max( nm.dx + half + ( nm.play ? 40 : 0 ), nm.sdx + under );
		return nameBox( pos, ( x1 + x2 ) / 2, ( x2 - x1 ) / 2, pos.below ? 19 : -19 - tx( nm.sub ? 30 : 17 ), pos.below ? 19 + tx( nm.sub ? 31 : 17 ) : -19 );
	} );
	const spots = K.clearOf( lay.dots, written, 10 );
	const all = L.named.concat( L.rest ).slice( 0, n + spots.length );
	const beads = K.seat( spots, all.slice( n ).map( ( x ) => wanted( 'm' + x.id, pan ) ) );
	const own = pieceLabel( v.m, { x: lay.C.x, y: lay.C.y }, W, true );
	addPiece( sc, v.m, lay.C, 'subject', Object.assign( { below: true }, own ) );
	// The middle's name and the line under it (whose a cut is, its record's artist: Justin, #connectome, 15 Nov
	// 2026), as drawPiece sets them: no tag goes on them.
	const ownHalf = Math.max( wide( own.label, FONT.own ), own.sub ? wide( own.sub, FONT.sub ) : 0 ) / 2 + ( own.play ? 40 : 0 ) + 8;
	const middle = { x1: lay.C.x - ownHalf, y1: lay.C.y + 26, x2: lay.C.x + ownHalf, y2: lay.C.y + 26 + tx( own.sub ? 38 : 24 ) };
	const tags = [];                                                 // the tags set down so far: none goes on a name, or on another
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
			const most = Math.min( tx( 176 ), W * 0.42 );
			let at = K.tagAt( lay.C, pos, 24, 15, most, 23, [ middle ].concat( written, tags ), Math.min( full, most ) );
			if ( at.room < Math.min( full, most ) ) {
				// against the piece, on the side its name isn't; where that is on the middle's name or another's, out
				// beyond its own name; nowhere clear, where it was first put
				const x = pos.x + K.nudge( pos.x, Math.min( full, most ) / 2, 4, W - 4 ), half = Math.min( full, most ) / 2;
				const taken = [ middle ].concat( written, tags );
				const on = ( y ) => y < 14 || y > H - 14 || taken.some( ( o ) => x + half > o.x1 && x - half < o.x2 && y + 12 > o.y1 && y - 12 < o.y2 );
				const mine = written[ i ], y = pos.y + ( pos.below ? -32 : 32 );
				const past = pos.below ? mine.y2 + 15 : mine.y1 - 15;
				at = { x, y: !on( y ) ? y : ( !on( past ) ? past : y ), room: most };
			}
			const label = cut( first( x.via[ 0 ] ), FONT.tag, at.room - 28 - ew );
			const tagHalf = ( 28 + wide( label, FONT.tag ) + ew ) / 2;
			tags.push( { x1: at.x - tagHalf, y1: at.y - 12, x2: at.x + tagHalf, y2: at.y + 12 } );
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
		const clash = ( b, d ) => Math.abs( b.x - d.x ) < b.w + d.w && Math.abs( b.y - d.y ) < tx( 22 );
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
	// the song's card out: everyone on it keeps a seat, round a ring with one more place, the upper right one left empty
	const lay = ringFor( { W, H, named: Math.min( ids.length, 12 ) + ( cardOn( v ) && ids.length > 1 ? 1 : 0 ), dots: outer.length }, cardOn( v ) );
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
	// Each of the cast with what they play on it, in brackets (Justin, #connectome, 23 Nov 2026, 18:30Z: "show
	// instruments in parenthesis along with pickers ... You're centered on a song for which we have ensemble
	// metadata"): all the cut's page gives them where that fits, the first where only that does, else the name alone.
	const castName = ( id ) => playsAs( first( id ), ( rolesOf.get( id ) || { role: '' } ).role, seatOf.get( id ), W, FONT.named );
	mine.forEach( ( id ) => {
		addNode( sc, id, seatOf.get( id ), 'named', Object.assign( { cutOf: rolesOf.get( id ) || { role: '', icon: '' }, song: scd.song, delay: 180 }, castName( id ) ) );
	} );
	if ( outer.length ) {
		const seated = outer.slice( 0, lay.dots.length );
		// The far names go only where no name sits: the ecosystem reads by shape first, and the sweep keeps
		// the rule that no two names touch. A far node without room is a bead; the sheet still says who.
		// a name, and the line under it of what they play, each a box a far name must keep clear of
		const taken = mine.flatMap( ( id ) => {
			const pos = seatOf.get( id ), nm = castName( id ), y = pos.y + ( pos.below ? 24 : -32 - ( nm.inst ? tx( INST_LH ) : 0 ) );
			return [ { x: pos.x + nm.dx, y, w: wide( nm.label, FONT.named ) / 2 + 3 } ].concat( nm.inst ?
				[ { x: pos.x + nm.dx, y: y + tx( INST_LH ), w: wide( nm.inst, FONT.inst ) / 2 + 3 } ] : [] );
		} );
		const clash = ( b, d ) => Math.abs( b.x - d.x ) < b.w + d.w && Math.abs( b.y - d.y ) < tx( 22 );
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
	sc.sub = [ 'On ', h( 'b', null, cuts[ 0 ] ? cuts[ 0 ].title : 'no cut the sources name' ), cuts[ 0 ] ? K.byArtist( cuts[ 0 ] ) : '',
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

/*
 * Videos (Justin, #connectome, 24 Nov 2026, 03:04Z: "Connections between pickers can have copyleft videos, shown in frame,
 * ready-to-play"; 19:27Z: a video is a source like a recording, evidence that a thing happened or the thing itself). A
 * video Release that names who is in it is a night of its own in the connectome, `video:<cid>` (connectome_store.py);
 * its pill has a ▶, and the ▶ opens the video's own Release page over the graph, its player and all, the graph
 * staying where it is under it. One player, the wiki's: its formats, its warnings, its subtitles.
 */
function videoOf( m ) {
	return m && /^video:[A-Za-z0-9]+$/.test( m.key ) ? m.key.slice( 6 ) : '';
}
function watchChip( x, y, cid, name ) {
	const say = 'Watch ' + name;
	return s( 'a', { class: 'watch', href: HOME + '/wiki/Release:' + cid, target: '_top', 'aria-label': say, 'data-cid': cid, 'data-say': name },
		s( 'title', null, say ), s( 'rect', { x: x.toFixed( 1 ), y: y - 9, width: 33, height: 18, rx: 9 } ),
		s( 'path', { class: 'tri', d: `M${ ( x + 12.5 ).toFixed( 1 ) } ${ y - 5.5 }v11l9.5 -5.5z` } ) );
}
function watchOpen( cid, name ) {
	const el = $( 'watch' ), page = HOME + '/wiki/Release:' + cid;
	el.replaceChildren(
		h( 'div', { class: 'watch-top' }, h( 'b', null, name || 'A video' ),
			h( 'a', { href: page, target: '_blank', rel: 'noopener', title: 'Its page on PickiPedia, in a new tab' }, 'its page ↗' ),
			h( 'button', { type: 'button', class: 'x', 'aria-label': 'Back to the graph', title: 'Back to the graph', onclick: watchClose }, '×' ) ),
		h( 'iframe', { src: page, title: name || 'A video', allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: '',
			onload: ( ev ) => watchBare( ev.target ) } ) );
	el.hidden = false;
	el.querySelector( 'button.x' ).focus( { preventScroll: true } );
}
/**
 * The page in the frame with the wiki's furniture put away: the player, its speeds and captions, and nothing round them.
 * The page is this site's own, so the frame can be told; where it can't (another origin), it shows as it is.
 */
const WATCH_BARE = `#column-one, #p-cactions, #p-personal, #footer, #siteSub, #contentSub, #jump-to-nav, #firstHeading, #catlinks,
	.mw-indicators, .printfooter, #mw-content-text > :not( .release-info ), .release-info > :not( .hls-video-player ):not( .pp-video-speed ):not( .pp-captions ),
	.release-info table { display: none !important; }
	#globalWrapper, #column-content, #content { margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; }
	#content { padding: 8px !important; } body { background: transparent !important; }
	.hls-video-player, .hls-video-player video { width: 100% !important; max-width: none !important; }
	.hls-video-player video { height: calc( 100vh - 64px ) !important; object-fit: contain; background: #000; }`;
function watchBare( frame ) {
	try {
		const doc = frame.contentDocument;
		if ( doc && doc.head && !doc.getElementById( 'bacon-bare' ) ) {
			const st = doc.createElement( 'style' );
			st.id = 'bacon-bare';
			st.textContent = WATCH_BARE;
			doc.head.appendChild( st );
		}
	} catch ( e ) {
		// another origin: the page as it is
	}
}
function watchClose() {
	const el = $( 'watch' );
	if ( !el.hidden ) {
		el.hidden = true;
		el.replaceChildren();                                        // the frame goes, and its sound with it
	}
}

const noCover = new Set();                                         // pictures that wouldn't load: not asked for again

/**
 * A show's band with no one leader (a mark of heads), or the place it was (a roof): its name under it, the way to its
 * page where the wiki has one. The main act's mark is the bigger.
 */
function drawShowMark( g, d ) {
	const band = d.stands === 'act', R = band ? ( d.main ? 24 : 17 ) : ( d.page ? 17 : 13 );
	g.textContent = '';
	g.setAttribute( 'class', 'pk mark ' + d.stands + ( d.main ? ' main' : '' ) + ( d.page ? '' : ' nopage' ) + ( d.lit ? ' lit' : '' ) );
	g.setAttribute( 'aria-label', d.title + ( band ? ', the band' : ', where it was' ) );
	layers.nodes.appendChild( g );
	g.appendChild( s( 'circle', { class: 'halo', r: R + 8 } ) );
	g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
	const k = R / 17;
	g.appendChild( band ?
		s( 'g', { class: 'heads', transform: `scale(${ k.toFixed( 2 ) })` },
			s( 'circle', { cx: -6.5, cy: -3, r: 3.2 } ), s( 'circle', { cx: 6.5, cy: -3, r: 3.2 } ), s( 'circle', { cx: 0, cy: -5.5, r: 3.6 } ),
			s( 'path', { d: 'M-12 8c0-5 3-7 5.5-7s5.5 2 5.5 7M1 8c0-5 3-7 5.5-7s5.5 2 5.5 7M-6 8c0-6 3-8.5 6-8.5s6 2.5 6 8.5z' } ) ) :
		s( 'path', { class: 'roof', transform: `scale(${ k.toFixed( 2 ) })`, d: 'M-9 1L0-8l9 9M-6.5-1.5V8h13v-9.5M-2 8V3h4v5' } ) );
	const y = d.above ? -R - 9 : R + 17 + down( band && d.main ? 17 : 13 );
	const words = s( 'text', { x: 0, y, 'text-anchor': 'middle' }, K.clip( d.title, d.clip || 30 ) );    // clip: shorter on a phone (showScene)
	if ( !band && d.city ) {
		words.appendChild( s( 'tspan', { class: 'inst', x: 0, dy: tx( 15 ) }, K.clip( d.city, d.clip || 30 ) ) );
	}
	g.appendChild( d.page ? s( 'a', { href: wikiUrl( d.page ), target: '_top', 'aria-label': d.title + ': its page on PickiPedia' }, words ) : words );
}


/**
 * A record's own art inside its ring, where its Record page names one (Justin, #connectome, 15 Nov 2026: "where
 * there is an image, let's use that"), and a show's poster (22 Nov 2026); the ring stays over it, so the colour still says how free it is. Returns
 * false where there is none; a picture that won't load gives way, and `again` draws the mark without it.
 */
function cover( g, file, R, again ) {
	if ( !file || noCover.has( file ) ) {
		return false;
	}
	const r = R - 2;
	// A show's poster from a tape is a small picture's own address (archive.org's IIIF); anything else is a wiki file.
	const src = /^https:\/\//.test( file ) ? file : FACE + encodeURIComponent( file.replace( / /g, '_' ) ) + '&width=120';
	const img = s( 'image', { class: 'face', href: src, x: -r, y: -r,
		width: 2 * r, height: 2 * r, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `circle(${ r }px at ${ r }px ${ r }px)`, 'aria-hidden': 'true' } );
	img.addEventListener( 'error', () => {
		noCover.add( file );
		again();
	} );
	g.appendChild( img );
	g.appendChild( s( 'circle', { class: 'ring rim', r: R } ) );
	return true;
}

/**
 * A show's set stones, as a cluster of gems centred on x, y: each a diamond in its stone's three colours, outside
 * in, as arthel draws them. Three at most, then "+n". Each says what it is to a pointer resting on it; the show's
 * note and sheet say the rest. Nothing for a piece with none. GEM times the size they were (Justin, #connectome,
 * 22 Nov 2026, 20:12Z: "the set stones need to be much, much larger"): a gem 14px across is 34.
 */
const GEM = 2.4;
const PILL_GEM = 0.6;                                                         // inside a pill: 20px tall, in a pill of 24
const gemsIn = ( n ) => gemsWide( n ) * GEM * PILL_GEM;                       // the room a pill's stones take
const gemsWide = ( n ) => ( Math.min( 3, n ) * 13 + 1 + ( n > 3 ? 18 : 0 ) );     // the cluster's width at size 1
function gems( piece, x, y, size = 1 ) {
	const all = K.stonesOf( G, piece );
	if ( !all.length ) {
		return null;
	}
	const read = G.stonesRead && G.stonesRead.block ? ` Read at Arbitrum block ${ G.stonesRead.block.toLocaleString( 'en-US' ) }.` : '';
	const k = size * GEM, left = x - gemsWide( all.length ) * k / 2;
	const g = s( 'g', { class: 'gems', transform: `translate(${ left.toFixed( 1 ) } ${ y.toFixed( 1 ) }) scale(${ k.toFixed( 2 ) })`,
		'aria-label': K.plural( all.length, 'set stone' ) } );
	all.slice( 0, 3 ).forEach( ( st, i ) => {
		const at = 7 + i * 13, gem = s( 'g', { class: 'gem', transform: `translate(${ at } 0)` },
			s( 'title', null, `Set stone #${ st.token }: ${ K.stoneSays( st ) }.${ read }` ) );
		[ 7, 4.6, 2.3 ].forEach( ( r, j ) => gem.appendChild( s( 'path', { d: `M0 ${ -r }L${ r } 0L0 ${ r }L${ -r } 0Z`,
			style: 'fill:' + K.nes( st.color[ j ] ), class: j ? 'in' : 'cut' } ) ) );
		g.appendChild( gem );
	} );
	if ( all.length > 3 ) {
		g.appendChild( s( 'text', { class: 'n', x: 41, y: tx( 3.5 ) }, '+' + ( all.length - 3 ) ) );
	}
	return g;
}

/**
 * A cut's chartifacts, as a mark on its circle's upper left (Justin, #connectome, 22 Nov 2026, 20:12Z, of "a small
 * mark on the song's own circle wherever `Chartifact of cut` names that cut": "that seems like a reasonable starting
 * place"): a leaf of staff paper with how many. It says each pass to a pointer resting on it, and goes to the song
 * page's Chartifacts. Nothing for a cut with none.
 */
function chartMark( cut, song ) {
	const charts = cut && G.songcast[ cut ] && G.songcast[ cut ].charts;
	if ( !charts || !charts.length ) {
		return null;
	}
	const says = charts.map( ( [ section, kind, picker, inst ] ) => [ section, kind ].filter( Boolean ).join( ', ' ) + ': ' + picker + ( inst ? ' (' + inst + ')' : '' ) );
	const mark = s( 'g', { class: 'charts', transform: 'translate(-36 -30) scale(1.2)' },
		s( 'title', null, K.plural( charts.length, 'chartifact' ) + ' of this cut:\n' + says.join( '\n' ) ),
		s( 'rect', { class: 'leaf', x: -10, y: -12, width: 20, height: 24, rx: 2 } ),
		s( 'path', { class: 'staff', d: 'M-6 -6h12M-6 -3h12M-6 0h12M-6 3h12M-6 6h12' } ),
		s( 'circle', { class: 'count-bg', cx: 9, cy: 10, r: 7.5 } ),
		s( 'text', { class: 'count', x: 9, y: 13, 'text-anchor': 'middle' }, String( charts.length ) ) );
	return G.songs[ song ] ? s( 'a', { href: pageUrl( 'Song:' + song ) + '#Chartifacts', target: '_top', 'aria-label': K.plural( charts.length, 'chartifact' ) + ' of ' + song }, mark ) : mark;
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
		const bg = gems( d.piece, 0, -d.r - 14, 0.6 );                // over the bead
		if ( bg ) {
			g.appendChild( bg );
		}
		return;
	}
	const R = d.big ? ( d.big > 1 ? d.big : 30 ) : ( d.kind === 'subject' ? 24 : 15 );     // big: a number is the radius (a show's poster)
	const gl = glyph( c.glyph );
	gl.setAttribute( 'transform', `scale(${ d.kind === 'subject' ? 1.9 : 1.25 })` );
	g.appendChild( s( 'circle', { class: 'halo', r: R + 8 } ) );
	g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
	if ( !cover( g, G.music[ pc.m ].art, R, () => drawPiece( g, d ) ) ) {
		g.appendChild( gl );
	}
	const cg = gems( d.piece, R * 0.75, -R - 6, d.kind === 'subject' ? 1 : 0.75 );   // on the circle's upper right
	if ( cg ) {
		g.appendChild( cg );
	}
	if ( d.bare ) {                                              // the headline names this one
		return;
	}
	if ( d.step !== undefined ) {                                // a step of a walk: named as the walk's layout hangs it
		stepLabel( g, d, R, address( { m: d.piece } ), c.name );
		return;
	}
	const y = d.below ? R + 17 + down( d.kind === 'subject' ? 17 : 13 ) : ( d.sub ? -R - 7 - tx( 14 ) : -R - 8 );
	const name = s( 'a', { href: address( { m: d.piece } ), 'aria-label': 'Go to ' + c.name }, s( 'text', { x: d.dx || 0, y, 'text-anchor': 'middle' }, d.label ) );
	if ( d.sub ) {
		name.appendChild( s( 'text', { class: 'sub', x: d.sdx || 0, y: y + tx( 14 ), 'text-anchor': 'middle' }, d.sub ) );
	}
	g.appendChild( name );
	if ( d.play ) {
		g.appendChild( playChip( ( d.dx || 0 ) + wide( d.label, d.kind === 'subject' ? FONT.own : FONT.piece ) / 2 + 5, y - tx( 4.5 ), d.play, pc.song ) );
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
	const t = s( 'text', { x: -d.w / 2 + 20, y: tx( 4.3 ) }, d.label );
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
		if ( d.stands === 'act' || d.stands === 'venue' ) {          // a show's band with no one leader, or where it was (showScene)
			drawShowMark( g, d );
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
				s( 'text', { y: 46 + down( 17 ), 'text-anchor': 'middle' }, K.clip( d.title, 30 ) ) ) );
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
				'aria-label': 'About ' + d.title }, s( 'text', { x: d.dx || 0, y: d.above ? -40 : 46 + down( 17 ), 'text-anchor': 'middle' }, d.label || K.clip( d.title, 30 ) ) ) );
			if ( to ) {
				g.appendChild( playChip( 28, 0, to, d.title ) );
			}
			const ch = chartMark( d.cut, d.title );
			if ( ch ) {
				g.appendChild( ch );
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
			// a bead on a strand of the rainbow has others close over and under it: its ground is kept to itself
			g.appendChild( s( 'circle', { class: 'halo', r: d.tight ? d.r + 3 : ( coarse ? 15 : Math.max( 12, d.r + 7 ) ) } ) );
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
			d.side === 'left' ? { x: -R - 12, y: tx( 6 ), 'text-anchor': 'end' } :
				d.side === 'right' ? { x: R + 12, y: tx( 6 ), 'text-anchor': 'start' } :
					// the middle's name tucked in tight, its top just over the circle's rim, clear of the pills on the
					// lines out of it (Justin, #connectome, 15 Nov 2026)
					{ x: d.dx || 0, y: d.below ? R + ( big ? 10 + down( 17 ) : 18 + down( 14 ) ) : -R - 8, 'text-anchor': 'middle' };
		const text = s( 'text', at, label );
		// what they play, on a line under the name: the song on now may change it (fxApply). A name over its mark goes up a
		// line for it, one beside its mark half a line, one under it stays.
		text.dataset.y = at.y;
		text.dataset.up = d.at || d.below ? 0 : ( d.side ? INST_LH / 2 : INST_LH );
		instLine( text, d.inst || '' );
		g.appendChild( s( 'a', { href: address( { a: d.id } ), 'aria-label': 'Go to ' + p.name }, text ) );
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
		// A strand between two pickers is one thing they share, and is marked as that thing is; any other line, as all of it.
		const t = d.strand ? { played: d.e.how >= K.STAGE, tier: G.music[ d.e.m ].tier } : d.tie;
		const gold = t.played && t.tier === K.PERMANENT;
		const cls = !t.played ? 't0' : 't' + t.tier;
		g.textContent = '';
		const far = d.role === 'far', fine = d.role === 'web' || far || d.fine;
		g.setAttribute( 'class', 'ln ' + ( fine ? 'fine ' : '' ) + ( d.role === 'web' ? 'web ' : '' ) + ( far ? 'far ' : '' ) + ( d.strand ? 'strand ' : '' ) + ( d.quiet ? 'quiet' : '' ) );
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
			g.appendChild( s( 'text', { x: 0, y: tx( 4.3 ), 'text-anchor': 'middle' }, d.label ) );
			return;
		}
		const gl = glyph( d.glyph );
		gl.setAttribute( 'transform', `translate(${ -d.w / 2 + 14 } 0)` );
		g.appendChild( gl );
		// "+n": the other tracks of the record these two share. A mark of its own: its click spreads them out between the two.
		const plus = spreads( d ) ? /^(.*\S)\s(\+\d+)$/.exec( d.label ) : null;
		const t = s( 'text', { x: -d.w / 2 + 25, y: tx( 4.3 ) }, plus ? plus[ 1 ] + ' ' : d.label );
		if ( plus ) {
			const n = s( 'tspan', { class: 'plus' }, plus[ 2 ] );
			n.appendChild( s( 'title', null, `All ${ d.e.songs.length } tracks ${ first( d.u ) } and ${ first( d.v ) } share on it` ) );
			t.appendChild( n );
		}
		g.appendChild( t );
		if ( d.play ) {                                              // a track that plays: the rabbit takes you there
			g.appendChild( playChip( d.w / 2 - 37, 0, d.play, d.song ) );
		} else if ( d.watch ) {                                      // a video of it: watched here, over the graph
			g.appendChild( watchChip( d.w / 2 - 37, 0, d.watch, K.called( G, M( K.pieceFor( G, d.e ) ) ).name ) );
		}
		// inside the pill, at its right end, as tall as it is (pillsFor gave them the room)
		const n = d.piece !== undefined ? K.stonesOf( G, d.piece ).length : 0;
		const pg = n ? gems( d.piece, d.w / 2 - 6 - gemsIn( n ) / 2, 0, PILL_GEM ) : null;
		if ( pg ) {
			g.appendChild( pg );
		}
	}
};

/*
 * A pill's "+n", opened: the tracks two pickers share on that record, listed right under it, the graph staying where
 * it is (Justin, #connectome, 23 Nov 2026, 18:30Z: "The behavior of "+<n>" in song pills is counter-intuitive - I think
 * it makes more sense for the graph to stay put and just drop down the list of items right there. If there are more
 * than a certain number ... then have a "more..." which will go to the rainbow chart (ie, the current behavior)").
 * Each track goes to it, as its pill would; as many as the room under the pill holds, eight at most, and past that
 * "more…" to the rainbow. Escape, a click outside it, or the graph moving puts it away.
 */
const DROP_MOST = 8, DROP_ROW = 34;
function openDrop( d, pill ) {
	const el = $( 'drop' ), stage = $( 'stage' ).getBoundingClientRect(), at = pill.getBoundingClientRect();
	const below = stage.bottom - at.bottom - 12, above = at.top - stage.top - 12, down = below >= Math.min( above, 4 * DROP_ROW ) || below >= above;
	const fits = Math.max( 3, Math.floor( ( ( down ? below : above ) - 16 ) / DROP_ROW ) );
	const songs = d.e.songs, most = Math.min( DROP_MOST, fits );
	const shown = songs.length > most ? songs.slice( 0, most - 1 ) : songs;
	const m = G.music[ d.e.m ];
	const row = ( song ) => {
		const piece = K.pieceFor( G, Object.assign( {}, d.e, { songs: [ song, ...songs.filter( ( x ) => x !== song ) ] } ) );
		const by = K.authorsOf( G, song ), who = by === null ? '' : ( by === K.TRAD ? 'trad.' : by.join( ' & ' ) );
		const b = h( 'button', { type: 'button', role: 'menuitem', class: 'drop-song', title: 'Go to ' + song,
			onclick: () => {
				closeDrop();
				go( { m: piece, hand: [ d.u, d.v ] } );
			} }, h( 'span', { class: 'drop-name' }, song ), who ? h( 'i', { class: 'drop-by' }, who ) : null );
		const to = K.playOf( G, m, song );
		return h( 'li', { role: 'none' }, b, to ? h( 'a', { class: 'drop-play', href: HOME + to, target: '_top', title: 'Play ' + song + ' in Rabbithole',
			'aria-label': 'Play ' + song + ' in Rabbithole' }, '▶' ) : null );
	};
	const items = shown.map( row );
	if ( shown.length < songs.length ) {
		items.push( h( 'li', { role: 'none' }, h( 'button', { type: 'button', role: 'menuitem', class: 'drop-more',
			title: `All ${ songs.length } tracks ${ first( d.u ) } and ${ first( d.v ) } share on it, spread out between them`,
			onclick: () => {
				closeDrop();
				spreadOut( d );
			} }, `more… (all ${ songs.length })` ) ) );
	}
	el.replaceChildren( h( 'p', { class: 'drop-head' }, K.plural( songs.length, 'track' ) + ' on ' + K.clip( m.title || m.key, 40 ) ), h( 'ul', null, ...items ) );
	el.hidden = false;
	const w = el.offsetWidth, x = Math.max( 4, Math.min( stage.width - w - 4, at.left + at.width / 2 - stage.left - w / 2 ) );
	el.style.left = x + 'px';
	el.style.top = down ? ( at.bottom - stage.top + 6 ) + 'px' : '';
	el.style.bottom = down ? '' : ( stage.bottom - at.top + 6 ) + 'px';
	const go1 = el.querySelector( 'button' );
	if ( go1 && !fingers ) {
		go1.focus( { preventScroll: true } );
	}
}
function closeDrop() {
	const el = $( 'drop' );
	if ( !el.hidden ) {
		el.hidden = true;
		el.replaceChildren();
	}
}

/** Does this pill's "+n" lead anywhere: several tracks of one record, between two pickers who are both known, not already spread out. */
function spreads( d ) {
	return !!d.e && d.e.how === K.TRACK && d.e.songs && d.e.songs.length > 1 && d.u >= 0 && d.v >= 0 && !!G.adj[ d.u ] && G.adj[ d.u ].has( d.v ) &&
		!( view.b !== undefined && view.rec === d.e.m && lineKey( view.a, view.b ) === lineKey( d.u, d.v ) );
}
const spreadOut = ( d ) => go( { a: d.u, b: d.v, rec: d.e.m } );

/** The way into Rabbithole, small: a rabbit and a play mark. */
function playMark() {
	const r = rabbit( 0.4 );
	r.setAttribute( 'transform', 'translate(9 9.5) scale(0.4)' );
	return s( 'svg', { class: 'pm', width: 30, height: 18, viewBox: '0 0 30 18', 'aria-hidden': 'true' }, r, s( 'path', { class: 'tri', d: 'M19.5 4.5v9l7.5 -4.5z' } ) );
}

/**
 * No way to play what is playing (Justin, #connectome, 21 Nov 2026, 01:56Z: "when a new track stars playing, it
 * goes to the center of the bacon chart, but its play button is still there, which is weird because... it's
 * already playing"). Every play button here is a link to Rabbithole with the track in its address; the player says
 * which track is on and whether it plays (walkNow). The ones for that track are put away while it plays, and are
 * back when it is paused or another is on. Looked at whenever a view is drawn and whenever the player speaks.
 */
function playSay() {
	const on = walkNow.playing ? walkNow.cid : null;
	for ( const a of document.querySelectorAll( 'a.play' ) ) {
		const href = a.getAttribute( 'href' ) || '', at = href.indexOf( '?' );
		const cid = at < 0 ? null : new URLSearchParams( href.slice( at ) ).get( 'track' );
		a.classList.toggle( 'on-now', !!on && cid === on );
	}
}

/** Beside a track's name, wherever it's written: the button that plays it in Rabbithole, when it plays there. */
function playButton( m, song ) {
	const to = K.playOf( G, m, song );
	return to ? h( 'a', { class: 'play', href: HOME + to, target: '_top', title: 'Play ' + song + ' in Rabbithole',
		'aria-label': 'Play ' + song + ' in Rabbithole' }, playMark() ) : null;
}

const sig = {
	node: ( d ) => [ d.stands, d.kind, d.lit, d.below, d.rabbit, d.side, d.anchor, d.up, d.bare, d.kind === 'dot' ? d.r.toFixed( 1 ) + ( d.tight ? 't' : '' ) : '', d.label, d.dx, d.sub, d.sdx, d.play, d.note,
		d.at ? d.at.x + ' ' + d.at.y + d.at.anchor : '', d.title, d.cut, d.above, d.clip ].join( '|' ),   // a song's: which, and its name over or under it
	line: ( d ) => ( d.stands === 'thread' ? [ 'th', d.w.toFixed( 1 ), d.quiet, d.emph, d.role ] :
		[ d.strand ? 's' + d.e.m : d.tie.played, d.tie.tier, d.w.toFixed( 1 ), d.quiet, d.emph, d.role, !!d.fine ] ).join( '|' ),
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
			it.wd = null;                                                // drawn afresh: its paths have no shape yet (put's tick)
		}
		Object.assign( it, { d, fx: it.x, fy: it.y, fo: it.o, fq: it.q || null, tx: d.x, ty: d.y, to: d.o === undefined ? 1 : d.o, t0: now,
			delay: fresh && !it.born ? ( d.delay || 0 ) * WAIT : 0, dead: false } );
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
 * straight one; for a stretch of a strand between two pickers, as far as K.arcBow said; for the web, as K.arc did.
 */
function pull( d, a, b ) {
	return d.bow || STRAIGHT;
}

/**
 * A line as it is now, e of the way through a change of view. Its ends are wherever the things at them are; its
 * bow goes from what it was (fq) to what the view asks, so a line that was straight and is a curve now bends as
 * its ends slide, and doesn't jump.
 */
function pathOf( it, e ) {
	const d = it.d, a = live.node.get( d.a ), b = live.node.get( d.b );
	if ( d.pts ) {
		// A stretch of a trunk, or a branch of one (pairScene): its own run of points. An end that is a picker
		// (pin) goes where they are while they slide, and the run leans after it.
		const n = d.pts.length - 1, p0 = d.pts[ 0 ], p1 = d.pts[ n ];
		const da = d.pin[ 0 ] && a ? { x: a.x - p0.x, y: a.y - p0.y } : STRAIGHT, db = d.pin[ 1 ] && b ? { x: b.x - p1.x, y: b.y - p1.y } : STRAIGHT;
		it.q = STRAIGHT;
		return 'M' + d.pts.map( ( p, i ) => ( p.x + da.x * ( 1 - i / n ) + db.x * ( i / n ) ).toFixed( 1 ) + ' ' + ( p.y + da.y * ( 1 - i / n ) + db.y * ( i / n ) ).toFixed( 1 ) ).join( 'L' );
	}
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

/**
 * How long a view takes to slide into place, and how much of each mark's own wait it keeps. It was 420 ms with the
 * waits whole, which had the last bead arrive 720 ms after a click (Justin, #connectome, 20 Nov 2026: "clicking
 * around the graph feels clunky"): now the last is in by 450 ms, and there are fewer frames to draw.
 */
const SLIDE = 300, WAIT = 0.5;

function put( next, quick ) {
	const D = quick || still ? 0 : SLIDE;
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
				// Only what changed is written (wo, wt, wd: as last written). Most of a view is not moving while it
				// changes: what leaves fades where it stands, what arrives fades in where it will be, and only what
				// stays slides. Writing every mark's place and every line's shape on every frame had the browser lay
				// out and paint the whole drawing each frame: a click took a second of a laptop's main thread, in
				// frames of 70 ms (Justin, #connectome, 20 Nov 2026: "clicking around the graph feels clunky").
				const o = it.o.toFixed( 3 );
				if ( it.wo !== o ) {
					it.el.setAttribute( 'opacity', it.wo = o );
				}
				if ( kind === 'line' ) {
					const p = pathOf( it, e );
					if ( p && it.wd !== p ) {
						it.wd = p;
						for ( const c of it.el.children ) {
							c.setAttribute( 'd', p );
						}
					}
				} else {
					const at = `translate(${ it.x.toFixed( 1 ) } ${ it.y.toFixed( 1 ) })`;
					if ( it.wt !== at ) {
						it.el.setAttribute( 'transform', it.wt = at );
					}
				}
			}
		}
		if ( busy ) {
			raf = requestAnimationFrame( tick );
		} else {
			svg.classList.remove( 'sliding' );
		}
	};
	svg.classList.toggle( 'sliding', !!D );                          // no easing of a line's shade by the stylesheet while this sets it frame by frame
	if ( D ) {
		raf = requestAnimationFrame( tick );
	} else {
		tick( now + 1e6 );
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * Ways out: a picker's name and page, a piece's pages and sources. There was a list beside the graph that said the
 * view over again with these in it; it is gone (Justin, #connectome, 21 Nov 2026, 01:56Z: "The "middle" drawer
 * (with <picker>'s page and "has played with") now seems superfluous. Nix it. We can add that information later
 * on the wiki page."), and the graph has its room.
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

const same = ( v, w ) => !!v && !!w && v.a === w.a && v.b === w.b && v.rec === w.rec && cardOn( v ) === cardOn( w ) && v.m === w.m && v.s === w.s && v.cut === w.cut && v.pg === w.pg &&
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

/** Show the view. again: the same view, laid out afresh because the frame changed; everyone keeps the seat they had. */
/** The frame a view is drawn for: its size, and what else sets the drawing's scale. A view is put back as drawn only into the same frame. */
function fitNow() {
	return [ svg.clientWidth, svg.clientHeight, zoomed(), closer, MINI, coarse ].join( ' ' );
}

function show( quick, again ) {
	const kept = asDrawn;
	asDrawn = null;
	// A view brought back, into another frame than it was drawn for (the window resized since, the player docked):
	// laid out afresh, with everything wanting the place it had.
	was = kept ? settled( kept.scene ) : again && scene ? settled( scene ) : whereabouts();
	if ( !again ) {
		turned = performance.now();
	}
	stage.classList.toggle( 'dual', view.m !== undefined || !!view.walk );
	stage.classList.toggle( 'walking', !!view.walk );
	document.querySelector( 'main' ).classList.toggle( 'walking', !!view.walk );
	if ( kept ) {
		// What stands round the graph first (its headline, the way come), since those set the frame it is measured by.
		$( 'say' ).firstElementChild.replaceChildren( ...kept.scene.head.filter( Boolean ) );
		$( 'say' ).lastElementChild.replaceChildren( ...kept.scene.sub );
		$( 'back' ).hidden = trail.length < 2;
		pathSay();
	}
	if ( kept && kept.fit === fitNow() && !view.walk && !view.way ) {
		scene = kept.scene;                                          // as it was drawn: nothing laid out again
		S = kept.S;
		words( kept.T );
		svg.setAttribute( 'viewBox', kept.box );
	} else {
		scene = view.way ? wayScene() : view.walk ? walkScene( view ) : view.pg !== undefined ? pageScene( view ) : view.cut !== undefined ? songScene( view ) : view.m !== undefined ? pieceScene( view ) : ( view.b === undefined ? egoScene( view ) : pairScene( view.a, view.b, view.rec ) );
		if ( cardOn( view ) ) {
			clearCard( scene, frame().W );                           // nothing small left under the card's corner
		}
	}
	if ( !view.walk && !view.way ) {
		drawn.set( view, { scene, fit: fitNow(), box: svg.getAttribute( 'viewBox' ), S, T, sel: Object.assign( {}, sel ) } );
	}
	stage.classList.toggle( 'carded', cardOn( view ) );
	stage.classList.toggle( 'webbed', !!scene.web );
	stage.classList.toggle( 'deep', !!scene.deep );
	$( 'say' ).firstElementChild.replaceChildren( ...scene.head.filter( Boolean ) );
	$( 'say' ).lastElementChild.replaceChildren( ...( lost && trail.length < 2 ? [ lost ] : scene.sub ) );
	put( scene, quick );
	keptSay();
	cardSay();
	fxApply();
	qrSay();
	qrRoom( quick );
	playSay();
	$( 'back' ).hidden = trail.length < 2;
	if ( !kept ) {
		pathSay();
	}
	document.title = K.pageTitle( { challenge: !!GAME, a: view.way || view.walk || view.a === undefined || view.a === null ? '' : first( view.a ),
		b: view.way || view.walk || view.b === undefined ? '' : first( view.b ), of: label( view ) } );
	closeSheet();
	closeDrop();
	hush();
}

/**
 * What stays in sight on the way from this view to the next: the connections the reader came by (Justin,
 * #connectome, 13 Nov 2026). Going to a picker, the pickers this view was about; going to a piece, the pickers
 * of the line it was on, and the other pieces named in sight; from one piece to the next, the one left behind.
 */
function carry( v ) {
	if ( view && cardable( v ) && cardable( view ) && v.a === view.a && v.cut === view.cut && v.playing === view.playing && cardOn( v ) !== cardOn( view ) ) {
		return v;                                                    // the same view with its card out, or put away: the way in as it was
	}
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
	if ( step || freshStep || !stepAt ) {
		stepAt = ++stepSeq;
	}
	freshStep = false;
	steps.set( stepAt, { view, trail: trail.slice(), g: G } );
	if ( steps.size > 240 ) {
		steps.delete( steps.keys().next().value );                   // the oldest: Back to it lays it out afresh
	}
	// In the shell the step is the shell's to put in the browser's history: one history, the pane's pages and the
	// graph's steps in the order they were taken. This page's own address follows, for its links and its QR.
	history[ step && !SHELL ? 'pushState' : 'replaceState' ]( { bacon: stepAt, session: SESSION }, '', at );
	tellAt( step );
}

/** A view brought back, to be shown as it was drawn; its selection with it. */
function bringBack( v ) {
	view = v;
	asDrawn = drawn.get( v ) || null;
	sel = Object.assign( { picker: null }, asDrawn ? asDrawn.sel : null );
}

function go( v, quiet, asWas ) {
	oracleDone();
	const left = !!KEPT && !!view;
	if ( left ) {
		v = leaveKept( v );                  // a click that goes further goes into today's graph
		asWas = false;
	}
	if ( !v.walk && !v.way && v.pg === undefined && v.m === undefined && v.s === undefined && v.b === v.a ) {
		v = { a: v.a };
	}
	if ( asWas ) {
		bringBack( v );                      // a step of the way come back to, by the strip: as it was drawn
	} else {
		view = carry( v );
		sel = { picker: null };
	}
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

/*
 * What losing costs, from the wiki (Justin, #connectome, 21 Nov 2026, 01:56Z: "Let's make the text "Fail, and
 * you'll have to play the banjo. In an otherwise decent and upstanding band." part of a series of wiki-defined
 * phrases so that other can add to them, much like the slogans on the front page of magenta"). As Magenta:Slogans
 * is read: the page PickiPedia:Bacon taunts, one to a line that starts with *. Asked for once, as this page opens,
 * so it is in by the time the graph is; no page, an empty one, no answer in three seconds: the line it always was.
 * A taunt is words: quotes and links written wiki-fashion are read as their words, and it is set down as text.
 */
const TAUNT = "Fail, and you'll have to play the banjo. In an otherwise decent and upstanding band. Forever.";
const TAUNTS_PAGE = 'PickiPedia:Bacon_taunts';
let taunts = [];
function tauntsFrom( text ) {
	return String( text || '' ).split( '\n' ).filter( ( l ) => /^\*[^*]/.test( l ) )
		.map( ( l ) => l.slice( 1 ).replace( /\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1' ).replace( /'{2,}/g, '' ).replace( /<[^>]*>/g, '' ).replace( /\s+/g, ' ' ).trim() )
		.filter( ( l ) => l.length > 0 && l.length <= 240 ).slice( 0, 300 );
}
( function () {
	const stop = typeof AbortController === 'function' ? new AbortController() : null;
	const t = setTimeout( () => stop && stop.abort(), 3000 );
	fetch( HOME + '/index.php?title=' + TAUNTS_PAGE + '&action=raw&maxage=300&smaxage=300', stop ? { signal: stop.signal } : {} )
		.then( ( r ) => ( r.ok ? r.text() : '' ) ).then( ( text ) => {
			taunts = tauntsFrom( text );
		} ).catch( () => {} ).then( () => clearTimeout( t ) );
}() );
function taunt() {
	return taunts.length ? taunts[ Math.floor( Math.random() * taunts.length ) ] : TAUNT;
}
let fromOracle = false;          // the first step out of the Oracle is one of the browser's too, so its Back comes back here

/** Open the Oracle: mode 'explore' or 'challenge'; goal, whom to find (someone at random when not given). */
function oracleSay( mode, goal, note, again ) {
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
	box.querySelector( '.find' ).hidden = mode !== 'explore';
	if ( !again ) {
		$( 'pa' ).value = $( 'pb' ).value = '';
	}
	if ( mode !== 'challenge' || !again || !ORACLE.taunt ) {
		ORACLE.taunt = taunt();                                      // one for this asking; come back to by Back, the one it had
	}
	box.querySelector( '.note' ).textContent = note || '';
	oracleGoalSay();
	oracleMinis( again );
	box.hidden = false;
	gameSay();
	pathSay();
	document.title = K.pageTitle( { oracle: true, challenge: mode === 'challenge' } );
	history.replaceState( null, '', ( mode === 'challenge' && ORACLE.goal !== null ? challengeAddress( ORACLE.goal ) : '/bacon' ) + hosted() );
	stepAt = 0;                                                  // the Oracle is no step of the graph's: the next view takes a number of its own
	tellAt( false );
}

/** What an address this page writes for itself carries in Rabbithole, so a reload of the frame comes back hosted. */
function hosted() {
	return HOST ? '?host=' + HOST + ( SHELL ? '&shell=1' + ( BARLESS ? '&bar=1' : '' ) + ( steering ? '&steer=1' : '' ) : '' ) : '';
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
	rules.replaceChildren( 'Find ', who, ' in six jumps or less and you win. ' + ( ORACLE.taunt || TAUNT ) );
}

/** The four to start from, drawn small. */
function oracleMinis( again ) {
	const box = $( 'oracle' );
	// Come back to by the browser's Back, the Oracle offers the four it offered (the same mode and goal): "back to the
	// previous state entirely" (Justin, #connectome, 19 Nov 2026).
	const key = ORACLE.mode + ' ' + ORACLE.goal;
	const picked = again && ORACLE.offered && ORACLE.offered.key === key && ORACLE.offered.g === G ? ORACLE.offered.picked :
		K.oraclePick( G, ORACLE.mode === 'challenge' ? ORACLE.goal : undefined );
	ORACLE.offered = { key, picked, g: G };
	box.querySelector( '.pick' ).textContent = !picked.length ? 'Nowhere here leads to them yet. Try someone else.' :
		( ORACLE.mode === 'challenge' ? 'Pick where to start:' : 'Or start with one of these:' );   // under the two boxes, in explore
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
	const old = trail[ st.ti ];
	trail.splice( st.ti );                                       // it, and all since, come off; go() puts it back on
	go( old, false, true );                                      // as it was when they were there
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
			face || h( 'span', { class: 'mark ' + st.kind, 'aria-hidden': 'true' } ), h( 'span', { class: 'nm' }, st.label ),
			st.to && st.to.m !== undefined ? gemsInline( st.to.m ) : null ) );
}

/** A show's gems in a line of text (the path's steps): the same marks, in an svg of their own; null for none. */
function gemsInline( piece ) {
	const all = K.stonesOf( G, piece ).length, k = 0.5 * GEM, w = gemsWide( all ) * k + 1, h = 15 * k;
	const g = all ? gems( piece, w / 2, 0, 0.5 ) : null;
	if ( !g ) {
		return null;
	}
	return s( 'svg', { class: 'gems-inline', width: w.toFixed( 1 ), height: h.toFixed( 1 ), viewBox: `0 ${ ( -h / 2 ).toFixed( 1 ) } ${ w.toFixed( 1 ) } ${ h.toFixed( 1 ) }` }, g );
}

function pathSay() {
	const nav = $( 'path' ), ol = nav.firstElementChild;
	const steps = !view || !G || ( HOST && !steering ) || view.way || view.walk ? [] : pathSteps();
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
	$( 'pathx' ).hidden = !!GAME;                                // a challenge's chain is the game's own: it has its restart
	stage.style.setProperty( '--path', nav.hidden ? '0px' : nav.offsetHeight + 'px' );   // the QR code sits above it too
	if ( fresh.length ) {
		void ol.offsetWidth;                                     // laid out closed, so they open
		fresh.forEach( ( x ) => x.li.classList.remove( 'coming' ) );
	}
	if ( !nav.hidden ) {                                         // the newest in sight, once the new ones have opened
		nav.scrollTo( { left: nav.scrollWidth, behavior: still ? 'auto' : 'smooth' } );
		// at a frame, where the page is laid out anyway: from a timer it had the page laid out again in mid-slide
		setTimeout( () => requestAnimationFrame( () => nav.scrollTo( { left: 1e6, behavior: still ? 'auto' : 'smooth' } ) ), still ? 0 : 380 );
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

/**
 * The shell's bar, pressed (BARLESS): its link button does what 🔗 does here, its FAQ what FAQ does. What they show
 * is this page's own, under where the bar was: the line with the link, the answers over the graph. With no graph
 * to keep (the Oracle), the link is the front page's own, or the challenge's.
 */
function barAct( act ) {
	if ( act === 'faq' ) {
		if ( $( 'faq' ).hidden ) {
			openFaq();
		} else {
			closeFaq();
		}
	} else if ( act === 'share' ) {
		if ( G && view && $( 'oracle' ).hidden && K.kindOf( view ) ) {
			onShare();
			return;
		}
		const box = $( 'shared' ), url = location.origin + ( ORACLE.mode === 'challenge' && ORACLE.goal !== null ? challengeAddress( ORACLE.goal ) : '/bacon' );
		const copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText( url ) : Promise.reject( new Error( 'no clipboard' ) );
		copied.then( () => true, () => false ).then( ( ok ) => {
			box.replaceChildren( h( 'span', null, ok ? 'Copied: the link to this page.' : 'The link to this page:' ),
				h( 'input', { readonly: true, value: url, 'aria-label': 'The link', onfocus: ( e ) => e.target.select() } ) );
			box.hidden = false;
			clearTimeout( onShare.t );
			onShare.t = setTimeout( () => {
				box.hidden = true;
			}, 15000 );
		} );
	}
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
		history.replaceState( null, '', '/bacon' + hosted() );
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
	history.replaceState( null, '', '/bacon/' + id + hosted() );
	stepAt = 0;
	tellAt( false );
}

/**
 * The QR code in the graph's corner (Justin, #connectome, 16 Nov 2026: "always a QR code visible. So if I'm showing someone
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

/**
 * What a picker's page says they do: the first lines of the box {{MusicianInfo}} draws there (its list,
 * ul.thinkingentity-verbs), in the wiki's own words and with its links, each to about 200 characters (DOES_LONG;
 * the longest of the cast's was 194 when this was written). Asked of the wiki once a picker, by the
 * explorer itself, so the card is the same in Rabbithole and out of it. A page with no such list, or no answer:
 * no lines. Each line is its parts in order: a string, or { t, href } for a link to a page that exists. Every line
 * is kept whole: the card takes the first DOES, cut, and the closer look (zoomOpen) all of them.
 */
const DOES = 3, DOES_LONG = 200;
const doesOf = new Map();
/** A line's parts, ended at about `most` characters: on a word, with an ellipsis, a link kept whole or left out. */
function clipLine( line, most ) {
	const out = [];
	let n = 0;
	for ( const x of line ) {
		const t = typeof x === 'string' ? x : x.t;
		if ( n + t.length <= most ) {
			out.push( x );
			n += t.length;
			continue;
		}
		if ( typeof x === 'string' ) {
			const cut = t.slice( 0, Math.max( 0, most - n ) ), at = cut.lastIndexOf( ' ' );
			const kept = ( at > 0 ? cut.slice( 0, at ) : ( n ? '' : cut ) ).replace( /[\s,;:.\u2014-]+$/, '' );
			if ( kept ) {
				out.push( kept );
			}
		}
		const last = out.length - 1;
		if ( last >= 0 && typeof out[ last ] === 'string' ) {
			out[ last ] = out[ last ].replace( /[\s,;:.\u2014-]+$/, '' ) + '…';
		} else {
			out.push( '…' );
		}
		return out;
	}
	return out;
}
function doesFrom( html ) {
	const list = html ? new DOMParser().parseFromString( html, 'text/html' ).querySelector( 'ul.thinkingentity-verbs' ) : null;
	const parts = ( node, out ) => {
		for ( const c of node.childNodes ) {
			if ( c.nodeType === 3 ) {
				out.push( c.nodeValue );
			} else if ( c.nodeType === 1 && c.tagName === 'A' && !c.classList.contains( 'new' ) && /^\/wiki\//.test( c.getAttribute( 'href' ) || '' ) ) {
				out.push( { t: c.textContent, href: c.getAttribute( 'href' ) } );
			} else if ( c.nodeType === 1 ) {
				parts( c, out );                                         // bold, italics, a link to no page yet: their words
			}
		}
		return out;
	};
	return list ? [ ...list.children ].filter( ( li ) => li.tagName === 'LI' ).map( ( li ) => parts( li, [] ) )
		.filter( ( line ) => line.some( ( x ) => ( typeof x === 'string' ? x : x.t ).trim() ) ) : [];
}
function cardDoes( name ) {
	if ( !doesOf.has( name ) ) {
		const q = new URLSearchParams( { action: 'parse', page: name, prop: 'text', redirects: 1, disableeditsection: 1, disablelimitreport: 1,
			format: 'json', formatversion: 2, maxage: 600, smaxage: 600 } );
		if ( HOME ) {
			q.set( 'origin', '*' );                                  // a preview of the wiki's files asks the wiki from outside
		}
		doesOf.set( name, fetch( HOME + '/api.php?' + q ).then( ( r ) => ( r.ok ? r.json() : Promise.reject( new Error( String( r.status ) ) ) ) )
			.then( ( d ) => doesFrom( d && d.parse && d.parse.text ) )
			.catch( () => {
				doesOf.delete( name );                               // no answer this time: asked again when they next come round
				return [];
			} ) );
	}
	return doesOf.get( name );
}

/**
 * The lines under the name share out what room the card has: a line each first, the last ones left out where even
 * that won't go; then any line that is cut gets another, in order, while there is room (to fourteen: a line of
 * 200 characters in the narrowest card that has the room). Nothing is cut mid-line.
 */
function cardFit( el ) {
	const ul = el.querySelector( '.card-does' ), lis = ul ? [ ...ul.children ] : [];
	if ( !lis.length ) {
		return;
	}
	lis.forEach( ( li ) => {
		li.hidden = false;
		li.style.setProperty( '--n', 1 );
	} );
	const lh = parseFloat( getComputedStyle( lis[ 0 ] ).lineHeight ), gap = parseFloat( getComputedStyle( ul ).rowGap ) || 0, room = ul.clientHeight + 0.5;
	const n = Math.max( 0, Math.min( lis.length, Math.floor( ( room + gap ) / ( lh + gap ) ) ) );
	lis.forEach( ( li, i ) => {
		li.hidden = i >= n;
	} );
	let spare = n ? Math.floor( ( room - n * lh - ( n - 1 ) * gap ) / lh ) : 0;
	for ( let lines = 2; spare > 0 && lines <= 14; lines++ ) {
		for ( const li of lis.slice( 0, n ) ) {
			if ( spare > 0 && li.scrollHeight > li.clientHeight + 1 ) {
				li.style.setProperty( '--n', lines );
				spare--;
			}
		}
	}
}

/**
 * The card of the one in the middle, in the graph's upper right corner, where the ring has left a place empty
 * (Justin, #connectome, 20 Nov 2026, 14:16Z). A picker's: their picture, their name as the way to their page, and
 * the first three things their page's {{MusicianInfo}} says they do (19:41Z: "it doesn't need to show instrument
 * or 'Has played...' details"). No page, or a page that says none: the picture and the name. A song's: its name
 * and what the headline's second line says. It is the soloist's card in Rabbithole, where the music's own view has
 * no headline and Rabbithole no band under the graph.
 */
let cardFor = null;              // whose lines the card is waiting on
const faceOf = ( p, wide ) => FACE + encodeURIComponent( p.img.replace( / /g, '_' ) ) + '&width=' + wide;
const lineParts = ( line ) => line.map( ( x ) => ( typeof x === 'string' ? x : h( 'a', { href: HOME + x.href, target: '_top' }, x.t ) ) );

/**
 * The card, closer: the picture big; the name, to their page; what they play; every line their page's box says, whole;
 * and who in the connectome they have played with most, each a way to them. Over the drawing, which stays as it is.
 */
let zoomFor = null;
function zoomOpen( id ) {
	const el = $( 'zoom' ), p = P( id );
	zoomFor = id;
	const does = h( 'ul', { class: 'zoom-does' } );
	const most = K.company( G, id ).slice( 0, 6 );
	const withThem = most.length ? h( 'p', { class: 'zoom-page' }, 'Played most with ', ...most.flatMap( ( c, i ) => [
		i ? ( i === most.length - 1 ? ' and ' : ', ' ) : '',
		h( 'a', { href: '#', onclick: ( ev ) => {
			ev.preventDefault();
			zoomClose();
			go( { a: c.id } );
		} }, P( c.id ).name ) ] ), K.company( G, id ).length > most.length ? ' (of ' + K.plural( K.company( G, id ).length, 'picker' ) + ')' : '', '.' ) : null;
	const box = h( 'div', { class: 'zoom-box' + ( p.img ? '' : ' nopic' ) }, ...[
		p.img ? h( 'img', { src: faceOf( p, 640 ), alt: p.name } ) : null,
		h( p.page ? 'a' : 'b', p.page ? { class: 'zoom-name', href: pageUrl( p.name ), target: '_top', title: p.name + "'s page on PickiPedia" } : { class: 'zoom-name' }, p.name ),
		p.inst ? h( 'p', { class: 'zoom-inst' }, p.inst ) : null,
		does,
		withThem,
		h( 'button', { type: 'button', class: 'x', 'aria-label': 'Close', title: 'Close', onclick: zoomClose }, '\u00d7' ) ].filter( Boolean ) );
	el.replaceChildren( box );
	el.onclick = ( ev ) => {
		if ( ev.target === el ) {
			zoomClose();                                             // a press outside the box
		}
	};
	el.hidden = false;
	box.querySelector( '.x' ).focus( { preventScroll: true } );
	if ( p.page ) {
		cardDoes( p.name ).then( ( lines ) => {
			if ( zoomFor === id && does.isConnected ) {
				does.replaceChildren( ...lines.map( ( line ) => h( 'li', null, ...lineParts( line ) ) ) );
			}
		} );
	}
}
/** Where a show's poster comes from: a small picture's own address (archive.org's IIIF), or a wiki file. */
const posterOf = ( art, wide ) => ( /^https:\/\//.test( art ) ? art.replace( /!240,240/, '!' + wide + ',' + wide ) :
	FACE + encodeURIComponent( art.replace( / /g, '_' ) ) + '&width=' + wide );

/** A show's card: its poster, its name, and what K.showSays says of it; the poster opens the closer look (showZoom). */
function showCard( el ) {
	const pc = M( view.m ), m = G.music[ pc.m ], c = K.called( G, pc );
	const pic = m.art ? h( 'img', { src: posterOf( m.art, 240 ), alt: '' } ) : null;
	const face = pic ? h( 'button', { type: 'button', class: 'card-face', title: 'A closer look at ' + c.name, 'aria-label': 'A closer look at ' + c.name,
		onclick: () => showZoom( pc.id ) }, pic ) : null;
	if ( pic ) {
		pic.addEventListener( 'error', () => {
			face.remove();
			el.classList.add( 'nopic' );
			cardFit( el );
		} );
	}
	el.classList.toggle( 'nopic', !face );
	const href = m.page ? wikiUrl( m.page ) : m.source;
	const name = href ? h( 'a', { class: 'card-name', href, target: '_top' }, c.name ) : h( 'b', { class: 'card-name' }, c.name );
	const does = h( 'ul', { class: 'card-does' }, ...K.showSays( G, pc, false ).map( ( line ) => h( 'li', null, line ) ) );
	el.replaceChildren( ...[ face, name, does ].filter( Boolean ) );
	requestAnimationFrame( () => cardFit( el ) );
}

/** A show, closer: its poster big, everything K.showSays says with every stone, and who played, each a way to them. */
function showZoom( id ) {
	const el = $( 'zoom' ), pc = M( id ), m = G.music[ pc.m ], c = K.called( G, pc );
	zoomFor = 'm' + id;
	const roles = new Map( ( m.cast || [] ).map( ( [ p, role ] ) => [ p, role ] ) );
	const who = pc.cast.filter( ( p ) => P( p ) ).map( ( p ) => [ p, roles.get( p ) || '' ] );
	const href = m.page ? wikiUrl( m.page ) : m.source;
	const box = h( 'div', { class: 'zoom-box' + ( m.art ? '' : ' nopic' ) }, ...[
		m.art ? h( 'img', { src: posterOf( m.art, 800 ), alt: c.name } ) : null,
		h( href ? 'a' : 'b', href ? { class: 'zoom-name', href, target: '_top' } : { class: 'zoom-name' }, c.name ),
		h( 'ul', { class: 'zoom-does' }, ...K.showSays( G, pc, true ).map( ( line ) => h( 'li', null, line ) ) ),
		who.length ? h( 'p', { class: 'zoom-page' }, 'On stage: ', ...who.flatMap( ( [ p, role ], i ) => [ i ? ', ' : '',
			h( 'a', { href: '#', onclick: ( ev ) => {
				ev.preventDefault();
				zoomClose();
				go( { a: p } );
			} }, P( p ).name ), role ? ' (' + role + ')' : '' ] ), '.' ) : null,
		h( 'button', { type: 'button', class: 'x', 'aria-label': 'Close', title: 'Close', onclick: zoomClose }, '\u00d7' ) ].filter( Boolean ) );
	el.replaceChildren( box );
	el.onclick = ( ev ) => {
		if ( ev.target === el ) {
			zoomClose();
		}
	};
	el.hidden = false;
	box.querySelector( '.x' ).focus( { preventScroll: true } );
}

function zoomClose() {
	const el = $( 'zoom' );
	if ( el.hidden ) {
		return;
	}
	el.hidden = true;
	el.replaceChildren();
	zoomFor = null;
}

function cardSay() {
	const el = $( 'card' ), on = !!view && cardOn( view );
	el.hidden = !on;
	cardFor = null;
	if ( !on ) {
		return;
	}
	const { cw, ch, side, tower, compact, small } = cardRoom( frame().W );
	el.style.width = cw + 'px';
	el.style.height = ch + 'px';
	// The graph's own corner: under the headline where there is one, else right under the bar (Justin, #connectome,
	// 21 Nov 2026, 23:27Z: "It can also move all the way up so it's just underneath the top bar").
	const head = $( 'say' ).offsetHeight || 0;
	el.style.top = ( head ? head + 8 : 4 ) + 'px';
	el.classList.toggle( 'side', side );
	el.classList.toggle( 'tower', tower );
	el.classList.toggle( 'compact', compact );
	el.classList.toggle( 'small', small );
	if ( view.cut !== undefined && view.playing === undefined ) {
		const more = scene.sub.map( ( x ) => ( typeof x === 'string' ? x : x.cloneNode( true ) ) );
		el.classList.add( 'nopic' );
		// its second line, in italics, who wrote it (Justin, #connectome, 23 Nov 2026, 18:30Z: "say 'by <author(s)>' or
		// 'traditional'"), where its page says; a song whose page says neither has no line for it
		const song = G.songcast[ view.cut ].song, by = K.bySays( G, song );
		const rest = h( 'span', { class: 'card-more' }, ...more );
		el.replaceChildren( ...[ h( 'b', { class: 'card-name' }, song ), by ? h( 'i', { class: 'card-by' }, by ) : null, rest ].filter( Boolean ) );
		// as many whole lines of the rest as the card has room for under them, none cut through
		rest.style.setProperty( '-webkit-line-clamp', '2' );
		const lh = parseFloat( getComputedStyle( rest ).lineHeight ) || 17;
		const lines = Math.max( 1, Math.floor( ( rest.clientHeight + 0.5 ) / lh ) );
		rest.style.setProperty( '-webkit-line-clamp', String( lines ) );
		rest.style.setProperty( 'line-clamp', String( lines ) );
		rest.style.maxHeight = lines * lh + 'px';
		return;
	}
	if ( showView( view ) ) {
		showCard( el );
		return;
	}
	const p = P( view.a ), id = view.a;
	const pic = p.img ? h( 'img', { src: faceOf( p, 180 ), alt: '' } ) : null;
	// The picture opens the card closer (Justin, #connectome, 22 Nov 2026, 00:55Z: "let the user click it to get a
	// photo in a modal box of some kind, with the picker info extended - essentially zooming in on the card and
	// giving more").
	const face = pic ? h( 'button', { type: 'button', class: 'card-face', title: 'A closer look at ' + p.name, 'aria-label': 'A closer look at ' + p.name,
		onclick: () => zoomOpen( id ) }, pic ) : null;
	if ( face ) {                                                    // a picture that won't come: the name has its room
		pic.addEventListener( 'error', () => {
			face.remove();
			el.classList.add( 'nopic' );
			cardFit( el );
		} );
	}
	el.classList.toggle( 'nopic', !face );
	const does = h( 'ul', { class: 'card-does' } );
	el.replaceChildren( ...[ face,
		h( 'a', { class: 'card-name' + ( p.page ? '' : ' new' ), href: pageUrl( p.name ), target: '_top', title: p.page ? p.name + "'s page on PickiPedia" : 'Start ' + p.name + "'s page" }, p.name ),
		does ].filter( Boolean ) );
	if ( !p.page ) {
		return;
	}
	const who = cardFor = p.name;
	cardDoes( p.name ).then( ( lines ) => {
		if ( cardFor !== who || !does.isConnected ) {
			return;                                                  // the card is someone else's by now
		}
		does.replaceChildren( ...lines.slice( 0, DOES ).map( ( line ) => h( 'li', null, ...lineParts( clipLine( line, DOES_LONG ) ) ) ) );
		cardFit( el );
	} );
}

/**
 * The code in the corner, out of the way of the drawing: its own size where nothing of the graph comes to stand
 * under it, a small mark of itself where a name or a mark does. Looked at once the view has slid into place.
 */
let qrLook = 0;
function qrRoom( quick ) {
	clearTimeout( qrLook );
	const look = () => {
		const box = $( 'qr' );
		if ( box.hidden || box.classList.contains( 'big' ) ) {
			return;
		}
		box.classList.remove( 'tight' );
		const r = box.getBoundingClientRect();
		// Only the marks that have come to stand near its corner are asked where they are, by where the view put
		// them: asking every word and circle of the drawing cost a laptop some 50 ms, a second after every click.
		const m = svg.getScreenCTM(), near = [];
		for ( const kind of m ? [ 'node', 'pill' ] : [] ) {
			for ( const [ , it ] of live[ kind ] ) {
				if ( !it.dead && it.to > 0.05 && m.a * it.tx + m.e > r.left - 280 && m.d * it.ty + m.f > r.top - 70 ) {
					near.push( it.el );
				}
			}
		}
		box.classList.toggle( 'tight', near.some( ( g ) => [ ...g.querySelectorAll( 'text, circle, image, rect:not( .reach )' ) ].some( ( el ) => {
			const b = el.getBoundingClientRect();
			return b.width > 0 && b.right > r.left - 4 && b.left < r.right + 4 && b.bottom > r.top - 4 && b.top < r.bottom + 4;
		} ) ) );
	};
	if ( quick ) {
		look();
	}
	qrLook = setTimeout( look, SLIDE + 380 );                        // once the view has slid into place
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

window.addEventListener( 'popstate', () => comeTo( history.state ) );

/** Back or Forward brought the reader here: the browser's own popstate, or in the shell its word (stepFromShell). */
function comeTo( state ) {
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
	// A step this page drew, back or forward: the view as it was drawn, and the way to it as it was then.
	const step = G && state && state.session === SESSION ? steps.get( state.bacon ) : null;
	const v = step && step.g === G ? step.view : G && parse( new URLSearchParams( location.search ) );
	if ( !v ) {
		const goal = G ? K.challengeOf( location.pathname, location.search ) : null;
		if ( goal !== null ) {                                       // back to the Oracle, in a challenge
			const to = goal ? K.find( G, goal ) : null;
			oracleSay( 'challenge', to !== null ? to : undefined, '', true );
		} else if ( G && /^\/bacon\/?$/.test( location.pathname ) && !shellAddress().includes( '?' ) ) {
			oracleSay( 'explore', undefined, '', true );             // back to the Oracle
		}
		return;
	}
	oracleDone();
	if ( step && step.g === G ) {
		stepAt = state.bacon;
		trail.length = 0;
		trail.push( ...step.trail );
		bringBack( v );
	} else if ( trail.length > 1 && same( v, trail[ trail.length - 2 ] ) ) {   // a step back: as it was shown before
		trail.pop();
		bringBack( trail[ trail.length - 1 ] );
	} else {
		view = carry( v );
		trail.push( view );
		sel = { picker: null };
	}
	show();
	if ( GAME ) {
		gameStep();                                                  // back in a challenge: the chain unwinds with it
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * The pointer, and the keys
 * --------------------------------------------------------------------------------------------------------- */

function say( at, ...parts ) {
	tip.replaceChildren( ...parts.filter( Boolean ) );
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
	// A song's own graph has a song in its middle and nobody: there the far one is a step out from one of the
	// song's pickers, and that is all there is to say. (It read view.a all the same, and threw: no note at a
	// hover, and a click that did nothing. Found 20 Nov 2026 on Darol Anger at Paint Exchange.)
	const mid = view.a !== undefined && G.adj[ view.a ] ? view.a : undefined;
	const also = mid === undefined ? 0 : K.company( G, id ).filter( ( c ) => c.id !== by && G.adj[ mid ].has( c.id ) ).length;
	return { kind: 'a picker' + instOf( id ) + ( mid === undefined ? ' · a step out' : ' · two hops out' ), title: name, tipTitle: name + instOf( id ),
		lines: [ mid === undefined ? `has played with ${ first( by ) }, who is on this` : `two hops from ${ first( mid ) }, by way of ${ first( by ) }` + ( also ? ` and ${ K.plural( also, 'other' ) }` : '' ), ...tieLines( by, id ) ],
		hint: 'click: go to ' + name,
		acts: [ act( 'Go to ' + name, () => go( { a: id, keep: [ by ] } ) ),
			...( mid === undefined ? [] : [ act( `${ first( mid ) } & ${ name }: the ways between`, () => go( { a: mid, b: id } ) ) ] ), pageAct( id ) ] };
}

function aSong( d ) {
	const w = { kind: 'a song', title: d.title, tipTitle: d.title + ', a song', lines: [], hint: 'click a picker round it: go to them', acts: [] };
	if ( d.cuts && d.cuts.length ) {
		w.lines.push( 'on ' + d.cuts.map( ( c ) => K.recordBy( c ) ).join( ', ' ) + ( d.cuts[ 0 ].date ? ', ' + d.cuts[ 0 ].date : '' ) );
	} else {
		w.lines.push( 'no cut the sources name' );
	}
	if ( G.plays[ d.title ] ) {
		w.lines.push( 'it plays in Rabbithole: the ▶ beside its name' );
	}
	if ( view.cut !== undefined && view.playing === undefined ) {       // the song in its own middle: its card, out and away
		w.hint = cardOn( view ) ? 'click: put its card away' : 'click: its card · click a picker round it: go to them';
		w.acts.push( act( cardOn( view ) ? 'Put its card away' : 'Its card', cardTurn ) );
	} else if ( d.cut !== undefined && G.songcast[ d.cut ] ) {            // the song on now, beside who's taking it: its own graph
		w.hint = 'click: go to ' + d.title;
		w.acts.push( act( 'Go to ' + d.title, () => go( { s: d.title, cut: d.cut } ) ) );
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
			w.hint = cardOn( view ) ? 'click: put their card away' : 'click: their card · click anyone around them: go to them';
			w.acts.push( act( cardOn( view ) ? 'Put their card away' : name + "'s card", cardTurn ) );
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

/** One who was on the stage of the show in the middle: whose act they were in, what they played, who else here they've played with. */
function aShowPicker( d ) {
	const id = d.id, name = first( id ), plays = d.inst && !d.lead ? ' · ' + d.inst : instOf( id );
	const also = [ ...new Set( [ ...scene.lines.values() ].filter( ( l ) => l.role === 'shared' && ( l.u === id || l.v === id ) ).map( ( l ) => ( l.u === id ? l.v : l.u ) ) ) ];
	const w = { kind: ( d.lead ? 'whose show it was · ' : 'on its stage · ' ) + 'a picker' + plays, title: name, tipTitle: name + plays,
		lines: [ d.act ? ( d.lead ? d.act : 'with ' + d.act ) : '', also.length ? 'has played elsewhere with ' + listNames( also ) + ', here too' : '' ],
		hint: 'click: go to ' + name, acts: [ act( 'Go to ' + name, () => go( { a: id } ) ) ] };
	w.acts.push( pageAct( id ) );
	return w;
}

/** A line between two of a show's stage: everything else they share; it opens the two of them. */
function aShowTie( d ) {
	const t = d.tie, top = K.naming( G, t.ev[ 0 ] );
	return { kind: 'two pickers of this show', title: `${ first( d.u ) } & ${ first( d.v ) }`,
		lines: [ K.together( t ), K.clip( top.short, 44 ) + ( t.ev.length > 1 ? `, and ${ t.ev.length - 1 } more` : '' ) ], hint: 'click: open these two',
		acts: [ act( 'Open these two', () => go( { a: d.u, b: d.v } ) ) ] };
}

/** A strand between two of a show's stage: one thing they share besides it. It goes there; the two of them are the next way on. */
function aShowStrand( d ) {
	const w = aPiece( d );
	w.kind += ` · ${ first( d.u ) } & ${ first( d.v ) } both on it`;
	w.acts.splice( 1, 0, act( 'Open these two', () => go( { a: d.u, b: d.v } ) ) );
	return w;
}

/** A show's band with no one leader, or where it was: its name, and its page where the wiki has one. */
function aShowMark( d ) {
	const band = d.stands === 'act';
	const w = { kind: band ? ( d.main ? 'the main act' : 'an act' ) : 'where it was', title: d.title,
		lines: band ? [ K.plural( d.members.length, 'picker' ) + ': ' + listNames( d.members.slice( 0, 8 ) ) + ( d.members.length > 8 ? ', …' : '' ) ] : [ d.city || '' ],
		hint: d.page ? 'click: its page on PickiPedia' : '', acts: [] };
	if ( d.page ) {
		w.acts.push( link( 'Its page on PickiPedia ↗', wikiUrl( d.page ), 'page' ) );
	}
	return w;
}

/** A picker who is a line: on a tag, or the line itself, between the piece in the middle and another. */
function aPickerBetween( d ) {
	const id = d.who[ 0 ], name = first( id );
	const w = { kind: ( d.who.length > 1 ? K.plural( d.who.length, 'picker' ) + ' on both · ' : '' ) + 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ),
		lines: [ 'on both ' + K.called( G, M( d.px ) ).name + ' and ' + K.called( G, M( d.py ) ).name, d.who.length > 1 ? 'as ' + ( d.who.length > 2 ? 'are ' : 'is ' ) + listNames( d.who.slice( 1 ) ) : '' ],
		hint: 'click: go to ' + name, choice: d.who.length > 1,
		acts: d.who.slice( 0, 4 ).map( ( p ) => act( 'Go to ' + first( p ), () => go( { a: p, keep: d.who } ) ) ) };
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
/** A show's set stones, in a line for its note and sheet: '' for none. */
function stonesLine( piece ) {
	const all = K.stonesOf( G, piece );
	return all.length ? '◆ ' + K.plural( all.length, 'set stone' ) + ': ' + all.slice( 0, 3 ).map( K.stoneSays ).join( '; ' ) +
		( all.length > 3 ? '; and ' + ( all.length - 3 ) + ' more' : '' ) : '';
}

function aPiece( d ) {
	const pc = M( d.piece ), m = G.music[ d.e.m ], n = K.naming( G, d.e );
	const w = { kind: m.kind === 'show' ? 'a show' : ( n.glyph === 'track' ? ( d.e.songs.length > 1 ? 'tracks on a record' : 'a track' ) : 'a record' ),
		title: n.short, lines: [ n.long !== n.short ? n.long : '', d.e.songs.length > 1 ? d.e.songs.slice( 0, 6 ).join( ', ' ) + ( d.e.songs.length > 6 ? ', …' : '' ) : '',
			stonesLine( d.piece ), K.TIER_NAME[ m.tier ] + ' · ' + sourceName( m.source ) ], hint: "click: go to it · who's on it, and where they lead",
		acts: [ act( 'Go to ' + K.clip( K.called( G, pc ).name, 30 ), () => go( { m: d.piece, hand: [ d.u, d.v ] } ) ) ] };
	if ( spreads( d ) ) {
		w.hint = `click: go to it · click +${ d.e.songs.length - 1 }: the list of all ${ d.e.songs.length } tracks`;
		w.acts.push( act( `All ${ d.e.songs.length } tracks ${ first( d.u ) } & ${ first( d.v ) } share on it`, () => spreadOut( d ) ) );
	}
	if ( videoOf( m ) ) {                                             // a video of it: watched here
		w.acts.push( act( 'Watch it', () => watchOpen( videoOf( m ), K.called( G, pc ).name ) ) );
	}
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
		if ( cardable( view ) ) {                                     // a show in the middle: its card, out and away
			w.hint = ( cardOn( view ) ? 'click: put its card away' : 'click: its card' ) + ' · click a picker on a line: go to them';
			w.acts.push( act( cardOn( view ) ? 'Put its card away' : 'Its card', cardTurn ) );
		}
	} else {
		const web = webFrom( ( l ) => ( l.px === d.piece ? l.py : ( l.py === d.piece ? l.px : undefined ) ) );
		w.lines.push( 'by way of ' + listNames( d.who ), web.length ? `shares pickers with ${ K.plural( web.length, 'other' ) } here` : '' );
		w.acts.push( act( 'Go to ' + K.clip( c.name, 30 ), () => go( { m: d.piece, hand: d.who } ) ) );
	}
	w.lines.push( stonesLine( d.piece ), K.TIER_NAME[ m.tier ] + ' · ' + sourceName( m.source ) );
	if ( videoOf( m ) ) {                                             // a video of it: watched here
		w.acts.push( act( 'Watch it', () => watchOpen( videoOf( m ), c.name ) ) );
	}
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

/**
 * The records a tie holds several tracks of, as ways to each spread out between the two: what the "+n" on its
 * pill does, for a line whose pills aren't drawn (a phone's ring draws none; seen on the live site, 20 Nov 2026).
 */
function spreadActs( t, a, b ) {
	return t.ev.filter( ( e ) => e.how === K.TRACK && e.songs && e.songs.length > 1 ).slice( 0, 3 )
		.map( ( e ) => act( `All ${ e.songs.length } tracks on ${ K.clip( G.music[ e.m ].title || G.music[ e.m ].key, 26 ) }`, () => go( { a, b, rec: e.m } ) ) );
}

function aTie( d ) {
	const t = d.tie, top = K.naming( G, t.ev[ 0 ] );
	const w = { kind: 'two pickers', title: `${ first( d.u ) } & ${ first( d.v ) }`,
		lines: [ K.together( t ), K.clip( top.short, 44 ) + ( t.ev.length > 1 ? `, and ${ t.ev.length - 1 } more` : '' ) ], hint: '', acts: [] };
	if ( view.b === undefined ) {
		w.hint = 'click: open these two';
		w.acts.push( act( 'Open these two', () => go( { a: view.a, b: d.c } ) ), ...spreadActs( t, view.a, d.c ) );
	} else if ( d.role === 'direct' ) {
		w.acts.push( act( 'Everything they share', () => {
			choose( { picker: null } );
			if ( narrow() && $( 'together' ) ) {
				$( 'together' ).scrollIntoView( { block: 'start' } );
			}
		} ) );
	} else {
		// Justin, #connectome, 21 Nov 2026, 01:56Z: "In a rainbow chart, if I click on a linking line, it ought to
		// bring me directly to the full rainbow for those two, instead of changing who is in the middle of the
		// existing rainbow graph. And of course, 'back' needs to take me back to the previous rainbow." Lighting
		// the way was the click until then; it is the sheet's second button now, and a held finger's.
		w.hint = 'click: open these two';
		w.acts.push( act( 'Open these two', () => go( { a: d.u, b: d.v } ) ), act( 'Light this way across', () => choose( { picker: d.c } ) ) );
	}
	return w;
}

function what( g ) {
	const kind = g.dataset.kind, it = live[ kind ].get( g.dataset.k );
	if ( !it || it.dead ) {
		return null;
	}
	const d = it.d, out = view.m !== undefined;                      // out: the graph is inside out
	if ( showView( view ) && !d.step ) {                                // a show in the middle: its own marks (showScene)
		if ( d.stands === 'picker' && !d.tag ) {
			return aShowPicker( d );
		}
		if ( d.stands === 'act' || d.stands === 'venue' ) {
			return aShowMark( d );
		}
		if ( d.stands === 'tie' ) {
			return d.quiet ? null : aShowTie( d );
		}
		if ( d.stands === 'piece' && d.strand ) {
			return aShowStrand( d );
		}
	}
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
	if ( view.walk ) {                                               // your rabbithole: a song heard says its own note, as it did
		say( g, h( 'b', null, w.tipTitle || w.title ), ...w.lines.filter( Boolean ).map( ( l ) => h( 'div', null, l ) ),
			w.hint ? h( 'span', { class: 'do' }, w.hint ) : null );
		return;
	}
	const t = tipFor( g );
	if ( t ) {
		say( g, t.when ? h( 'div', { class: 'when' }, t.when ) : null, t.who ? h( 'div', null, t.who ) : null );
	}
}

/**
 * What a pointer resting on a mark is told (Justin, #connectome, 20 Nov 2026, 19:41Z: "The tooltip on hover is
 * _way_ too much. It's very distracting. I don't think a tooltip is really required for pickers at all, and for
 * shows/songs, make it very terse, just showing the date and ensemble"). A picker, wherever they stand: nothing.
 * A line between two pickers: nothing. A show, a record, a track or a song: when it was, and who is on it of
 * those the sources here name, six at most and then how many more. null: no note. The lines and names a pointer
 * lights are lit as before, and the sheet a held finger opens says all it did.
 */
const TIP_NAMES = 6;
function tipFor( g ) {
	const it = live[ g.dataset.kind ].get( g.dataset.k ), d = it && !it.dead ? it.d : null;
	let when = '', where = '', cast = [];
	if ( !d ) {
		return null;
	}
	if ( d.stands === 'song' ) {
		const entry = d.cut !== undefined && G.songcast ? G.songcast[ d.cut ] : null;
		when = ( entry && entry.recorded ) || ( d.cuts && d.cuts[ 0 ] ? K.when( d.cuts[ 0 ].date ) : '' );
		cast = entry ? entry.pickers.map( ( x ) => x[ 0 ] ).filter( ( id ) => id >= 0 && P( id ) ) : [];
	} else if ( ( d.stands === 'piece' || d.stands === 'loose' ) && !d.more && d.piece !== undefined && M( d.piece ) ) {
		const pc = M( d.piece ), m = G.music[ pc.m ];
		when = K.when( m.date );
		// a show that says where it was: whose it was, at what or where, and the town, before its night (Justin,
		// #connectome, 21 Nov 2026); its label may be cut to a few letters of this
		if ( m.kind === 'show' && ( m.name || m.venue || m.city ) ) {
			const n = K.naming( G, { m: pc.m, how: K.STAGE, songs: [] } );
			where = [ n.band && n.who !== n.band ? n.band + ' at ' + n.who : n.who, n.place ].filter( Boolean ).join( ', ' );
		}
		cast = pc.cast || [];
	} else {
		return null;
	}
	const who = cast.slice( 0, TIP_NAMES ).map( first ).join( ', ' ) + ( cast.length > TIP_NAMES ? ` and ${ cast.length - TIP_NAMES } more` : '' );
	return when || who || where ? { when: [ where, when ].filter( Boolean ).join( ' · ' ), who } : null;
}

function click( g ) {
	const w = what( g ), go1 = w && w.acts[ 0 ];
	if ( go1 && go1.run ) {
		go1.run();
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * A finger. It can't hover. Its tap does what a click does: it goes. Holding a mark still (HOLD ms) opens a
 * sheet saying what's under the finger, with the other ways on from it as buttons and × (or a touch on the open
 * graph) to go back to exploring. (Justin, #connectome, 20 Nov 2026, 02:08Z: "on mobile, it might work better
 * if clicking once navigates, and click-and-hold brings up the infobox (then we don't need the 'Go to <picker>'
 * button)". Until then the first touch asked and the second went.) What a tap does has no button on the sheet;
 * its last line says it. A mark with nowhere to go (the one in the middle) opens its sheet at a tap, so no touch
 * does nothing. A finger is blunt, too: the picker nearest the touch is the one meant, not whichever bead's
 * halo happens to lie on top.
 * --------------------------------------------------------------------------------------------------------- */

const HOLD = 400;                // ms a finger stays put before it's asking, not going: Android's own long press
let press = null;                // a finger down on a mark and not yet moved: { id, x, y, g, timer }
let heldNow = false;             // this touch opened the sheet: the click a browser may send as it lifts isn't a tap

function unpress() {
	if ( press ) {
		clearTimeout( press.timer );
		press = null;
	}
}

/** The finger stayed: say what it's on. Whichever comes first asks for it, the timer or the browser's long press. */
function holdOpen() {
	const g = press && press.g;
	unpress();
	if ( !g || !g.isConnected || !what( g ) ) {
		return;
	}
	heldNow = true;
	openSheet( g );
	if ( navigator.vibrate ) {
		navigator.vibrate( 8 );                                      // where a phone can: felt, as its own long press is
	}
}

function openSheet( g, tapped ) {
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
	// A tap does the first: no button for it where the hint says so. Several of a kind (the pickers on one line)
	// are a choice, and stay.
	const go1 = w.acts[ 0 ], taps = !!( go1 && go1.run ), said = taps && !!w.hint && !w.choice;
	const acts = w.acts.filter( ( a ) => !( said && a === go1 ) );
	const foot = w.hint && ( taps || !/^click:/.test( w.hint ) ) ? w.hint.replace( /^click/, 'tap' ) : '';
	// Opened by a tap, there being nowhere to go: the one place the graph says a hold asks about anything.
	const more = tapped ? 'hold a finger on anything: what it is' : '';
	sheet.replaceChildren( ...[
		h( 'button', { type: 'button', class: 'x', 'aria-label': 'Back to the graph', onclick: closeSheet }, '×' ),
		h( 'div', { class: 'k' }, w.kind ),
		h( 'b', null, w.title ),
		...w.lines.filter( Boolean ).map( ( l ) => h( 'div', { class: 'l' }, l ) ),
		acts.length ? h( 'div', { class: 'acts' }, acts.map( ( a ) => a.href ?
			h( 'a', { class: a.kind, href: a.href, target: a.kind === 'source' ? '_blank' : '_top', rel: a.kind === 'source' ? 'noopener' : null },
				a.kind === 'play' ? playMark() : null, a.label ) :
			h( 'button', { type: 'button', class: a === go1 ? 'in first' : 'in', onclick: () => {
				closeSheet();
				a.run();
			} }, a.label ) ) ) : null,
		foot ? h( 'div', { class: 'again' }, foot ) : null,
		more ? h( 'div', { class: 'again' }, more ) : null ].filter( Boolean ) );
	const at = g.getBoundingClientRect(), box = stage.getBoundingClientRect();
	// Out of the way of what it's about: on the other half of the frame, and no taller than the room there, or
	// its mark would have nothing left to tap (seen at phone size, 15 Nov 2026: a tall sheet lay on its own mark).
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

svg.addEventListener( 'pointerdown', ( e ) => {
	unpress();                                                       // a second finger is a pinch, not a hold
	heldNow = false;
	if ( !fingers || !e.isPrimary ) {
		return;
	}
	const g = pick( e );
	if ( g ) {
		press = { id: e.pointerId, x: e.clientX, y: e.clientY, g, timer: setTimeout( holdOpen, HOLD ) };
	}
} );
document.addEventListener( 'pointermove', ( e ) => {
	if ( press && e.pointerId === press.id && Math.hypot( e.clientX - press.x, e.clientY - press.y ) > 10 ) {
		unpress();                                                   // it moved: a scroll or a slip
	}
}, true );
[ 'pointerup', 'pointercancel' ].forEach( ( on ) => document.addEventListener( on, unpress, true ) );
// A phone's own long press: its menu for a link (a name here is one) would cover the sheet. A mouse keeps its menu.
svg.addEventListener( 'contextmenu', ( e ) => {
	if ( fingers ) {
		e.preventDefault();
		holdOpen();
	}
} );
svg.addEventListener( 'dragstart', ( e ) => {
	if ( fingers ) {
		e.preventDefault();                                          // nor does a held name get dragged off
	}
} );

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
		return;                                                      // a finger doesn't hover: holding still opens the sheet
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
/**
 * The "+n" a click means. Under a pointer, the mark itself. Under a finger it is 14px by 12, so a tap beside it, on
 * its end of its pill, means it too (seen at 390x844 on the live site, 20 Nov 2026).
 */
function plusAt( e ) {
	const on = e.target.closest( 'tspan.plus' );
	if ( on || !fingers ) {
		return on;
	}
	const pill = e.target.closest( 'g.pill' ), n = pill && pill.querySelector( 'tspan.plus' );
	if ( !n ) {
		return null;
	}
	const b = n.getBoundingClientRect();
	return e.clientX > b.left - 12 && e.clientX < b.right + 12 ? n : null;
}

svg.addEventListener( 'click', ( e ) => {
	const a = e.target.closest( 'a' );
	if ( a && a.classList.contains( 'watch' ) && !( e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) ) {
		e.preventDefault();                                          // a video's ▶: it plays here, the graph under it
		closeSheet();
		hush();
		watchOpen( a.dataset.cid, a.dataset.say );
		return;
	}
	if ( a && ( a.classList.contains( 'play' ) || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) ) {
		return;                                                      // the way into Rabbithole, or a new tab asked for: the browser goes
	}
	if ( a ) {
		e.preventDefault();                                          // a name goes where its mark goes: to them, here
	}
	const plus = plusAt( e ), pg = plus && plus.closest( 'g[data-kind]' ), pit = pg && live[ pg.dataset.kind ].get( pg.dataset.k );
	if ( pit && !pit.dead && spreads( pit.d ) ) {                    // a pill's "+n": the tracks, listed under it, the graph where it is
		closeSheet();
		hush();
		openDrop( pit.d, pg );
		return;
	}
	if ( !$( 'drop' ).hidden ) {                                     // a click anywhere else puts the list away, and does nothing more
		closeDrop();
		return;
	}
	const g = pick( e );
	if ( fingers ) {
		if ( svg.contains( document.activeElement ) ) {
			document.activeElement.blur();                           // a touch isn't the keyboard: no ring left round the mark
		}
		if ( heldNow ) {                                             // the finger that held, lifting
			heldNow = false;
			return;
		}
		const w = g && what( g );
		if ( w && w.acts[ 0 ] && w.acts[ 0 ].run ) {                 // a tap goes
			closeSheet();
			w.acts[ 0 ].run();
		} else if ( w && g.dataset.k !== held ) {                    // nowhere to go from it: say what it is
			openSheet( g, true );
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
	if ( !$( 'watch' ).hidden ) {
		watchClose();
	} else if ( !$( 'drop' ).hidden ) {
		closeDrop();
	} else if ( !$( 'zoom' ).hidden ) {
		zoomClose();
	} else if ( !$( 'faq' ).hidden ) {
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
	// What the list beside the graph held and nothing else did: the way to tell us of a connection, and the store.
	const on = G && view && !view.walk && !view.way && view.pg === undefined && view.m === undefined && view.cut === undefined && view.a !== undefined && $( 'oracle' ).hidden;
	box.querySelector( '.faq-tell' ).replaceChildren( ...( G ? [
		tellBox( GAME ? first( GAME.to ) : ( on ? first( view.a ) : '' ), GAME ? gameFrom() : ( on ? 'the bacon graph of ' + first( view.a ) : 'the bacon graph' ) ),
		h( 'p', { class: 'foot' }, `${ G.people.length } pickers, ${ G.music.length } records and shows that join them. Built ${ K.when( G.built ) }. `,
			h( 'a', { href: HOME + '/assets/connectome/connectome.sqlite', download: '' }, 'The whole store (SQLite)' ) ) ] : [] ) );
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
// The way come, let go (Justin, #connectome, 20 Nov 2026, 19:41Z: "The path at the bottom is feeling a little
// unwieldy. It needs like an 'x' to start over"). The view in sight stays as it is drawn, and is where the way
// starts now; this step of the history remembers the shorter way, and Back still goes back to the ones before.
$( 'pathx' ).firstElementChild.addEventListener( 'click', () => {
	if ( GAME || !view || trail.length < 2 ) {
		return;
	}
	trail.splice( 0, trail.length - 1 );
	$( 'back' ).hidden = true;
	pathSay();
	stamp( false );
} );
$( 'share' ).addEventListener( 'click', onShare );
$( 'qr' ).addEventListener( 'click', () => {
	$( 'qr' ).classList.toggle( 'big' );
	qrRoom( true );
} );
// The key: open while its button is pressed in (a finger, a keyboard), and for a mouse while it is on it.
// Escape, or a press anywhere else, closes it.
function keyed( on ) {
	stage.classList.toggle( 'keyed', on );
	$( 'key' ).setAttribute( 'aria-expanded', String( on ) );
}
// A mouse on the button or on the key (never a finger, whose hover sticks): by the script, since a browser's own
// word on whether it can hover is not to be had everywhere (headless Firefox says it can't).
let peekOff = 0;
for ( const el of [ $( 'key' ), $( 'legend' ) ] ) {
	el.addEventListener( 'pointerenter', ( e ) => {
		if ( e.pointerType === 'mouse' ) {
			clearTimeout( peekOff );
			stage.classList.add( 'peek' );
		}
	} );
	el.addEventListener( 'pointerleave', () => {
		clearTimeout( peekOff );
		peekOff = setTimeout( () => stage.classList.remove( 'peek' ), 140 );      // time to cross from the button to the key
	} );
}
$( 'key' ).addEventListener( 'click', ( e ) => {
	e.stopPropagation();
	keyed( !stage.classList.contains( 'keyed' ) );
} );
document.addEventListener( 'click', ( e ) => {
	if ( stage.classList.contains( 'keyed' ) && !e.target.closest( '#legend' ) ) {
		keyed( false );
	}
} );
document.addEventListener( 'keydown', ( e ) => {
	if ( e.key === 'Escape' && stage.classList.contains( 'keyed' ) ) {
		keyed( false );
	}
} );

let finder = new Map();          // everything the boxes can find, by its name in small letters (K.catalogue)

/** What a box holds: a picker, a song's cut, a show, a record, a track; or nothing the graph knows. */
function found( box ) {
	const hit = finder.get( $( box ).value.trim().toLowerCase() );
	return hit ? hit.view : null;
}

/**
 * The two boxes, on the front page (Justin, #connectome, 21 Nov 2026, 01:56Z: "Let's get rid of the two text inputs
 * to find pickers at the top. Instead, under "explore", above the four pickers, let's have those boxes, but change
 * their default help text to "start with" and "find a path to (optional)""). They are filled in and then sent
 * (Enter, or "go"): a box that went as soon as it was filled would leave before the second, which is optional, could
 * be. A song, a show or a record has the view to itself; two pickers are shown together; one picker alone.
 */
function typed( ev ) {
	ev.preventDefault();
	const note = $( 'oracle' ).querySelector( '.note' ), said = [ 'pa', 'pb' ].map( ( id ) => $( id ).value.trim() );
	if ( !G ) {
		return;
	}
	const x = found( 'pa' ), y = found( 'pb' ), lost = said.find( ( t, i ) => t && !( i ? y : x ) );
	if ( lost !== undefined ) {
		note.textContent = `The connectome doesn't know “${ lost.slice( 0, 80 ) }” yet.`;
		return;
	}
	if ( !x && !y ) {
		note.textContent = 'Name a picker, a song, a show or a record to start with.';
		return;
	}
	const one = x || y, other = x && y && y !== x ? y : null;
	const next = one.a === undefined ? one : ( other && other.a !== undefined && other.a !== one.a ? { a: one.a, b: other.a } : { a: one.a } );
	note.textContent = '';
	fromOracle = true;
	document.body.classList.remove( 'challenge' );
	trail.length = 0;
	go( next );
}
$( 'oracle' ).querySelector( '.find' ).addEventListener( 'submit', typed );
[ 'pa', 'pb' ].forEach( ( id ) => $( id ).addEventListener( 'focus', ( e ) => e.target.select() ) );

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
		// Out of sight (a frame put away behind a page has no size), or the same frame the view in sight was drawn
		// for: nothing to lay out. Laid out for no room at all, the drawing was lost by the time it was seen again.
		const d = view && drawn.get( view );
		if ( !svg.clientWidth || !svg.clientHeight || ( d && d.scene === scene && d.fit === fitNow() ) ) {
			return;
		}
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
	} else if ( !asked && ( !HOST || SHELL ) && !MINI && !q.get( 'cut' ) && !q.get( 'playing' ) && !lost ) {
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
		goFromHost( hostTo, hostFresh );
	}
} ).catch( ( err ) => {
	// #wait is gone once the graph is read: an error after that still has to be said somewhere, and seen in the console.
	const where = $( 'wait' ) || stage.appendChild( h( 'div', { id: 'wait' } ) );
	where.textContent = "The connectome couldn't be loaded (" + err.message + '). Try again in a moment.';
	console.error( err );
} );
