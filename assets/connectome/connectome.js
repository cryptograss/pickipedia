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
	far: '400 13px Georgia, "Times New Roman", serif',
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
	if ( v.walk ) {
		return '?' + new URLSearchParams( Object.assign( { walk: MINI ? 'mini' : '' }, HOST ? { host: HOST } : null ) );
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
	const m = q.get( 'm' ) ? K.findPiece( G, q.get( 'm' ), q.get( 's' ) ) : null;
	if ( m !== null ) {
		return { m };
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

function frame() {
	const W = Math.max( MINI ? 200 : 300, svg.clientWidth ), H = Math.max( MINI ? 120 : 240, svg.clientHeight );   // the dock's few steps: its own size
	svg.setAttribute( 'viewBox', `0 0 ${ W } ${ H }` );
	return { W, H };
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
	return { names, fars, open };
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
	const came = new Set( ( v.keep || [] ).filter( ( k ) => G.adj[ a ].has( k ) ) );
	const queue = K.keeping( G, a, comp, v.keep );
	const kept = K.fewPer( G, queue, 2, queue.filter( ( c ) => came.has( c.id ) ).length );
	const want = Math.min( kept.length, H > 560 && W > 700 ? 8 : ( W > 460 || H > 500 ? 6 : 4 ) );
	// another turn of the company, where there are more than one view names; those the reader came by stay
	const stay = kept.filter( ( c ) => came.has( c.id ) ).length;
	const ring = K.turned( kept, stay, Math.max( 1, want - stay ), v.turn || 0 );
	const lay = K.ego( { W, H, named: want, dots: ring.length - want, far: true } );
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
let walkFoot = true;                    // the reader is at the foot of the walk: a new song keeps them there
let road = null;                        // a road from the song on now, gone to: { cid, via }; played from there, it's that picker followed
// The snake's measures: a song's circle; the room at each side for a turn, and how far out it bows; the first row,
// from a row to the next (its names, the gap a turn's name sits in, the roads over the next row), and how far out
// a road's bead sits.
const WALK = { R: 15, side: 78, bend: 58, top: 92, pitch: 186, reach: 54 };

/** The walk as a browser keeps it for Rabbithole (localStorage "rabbithole-walk"), junk tolerated. */
function storedWalk() {
	try {
		const v = JSON.parse( window.localStorage.getItem( 'rabbithole-walk' ) || '[]' );
		return Array.isArray( v ) ? v.filter( ( h ) => h && typeof h.cid === 'string' && h.cid ) : [];
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
	const R = WALK.R;
	// Where every song goes, in a frame W wide (H tall, for the dock).
	const place = ( W, H ) => {
		const shown = MINI ? steps.slice( W < 330 ? -2 : -3 ) : steps;  // the dock: the song on now and two before it; one, in a narrow sidebar
		let lay = MINI ? K.snake( { W, n: shown.length, room: 70, side: R + 4, top: shown.length > 2 ? 64 : Math.max( 34, Math.round( ( H - 80 ) / 2 ) + R ),
			pitch: 0, most: Math.max( 1, shown.length ) } ) :
			K.snake( { W, n: shown.length, room: W >= 700 ? 200 : 150, side: WALK.side, top: WALK.top, pitch: WALK.pitch } );
		if ( lay.cols < 2 && !MINI ) {                               // no room for two to a row: one column, names beside
			lay = K.snake( { W, n: shown.length, room: W, side: Math.min( 120, Math.max( 86, W * 0.16 ) ), top: 30, pitch: 76 } );
		}
		// a long walk scrolls: the frame is as tall as the walk, and the stage scrolls it
		const need = !lay.rows ? 60 : lay.at[ lay.at.length - 1 ].y + ( lay.cols > 1 ? R + 15 + 28 + 26 : 50 );
		svg.style.height = MINI ? '' : Math.max( need, stage.clientHeight - ( $( 'say' ).offsetHeight || 0 ) - ( $( 'legend' ).offsetHeight || 0 ) ) + 'px';
		return { shown, lay, W };
	};
	let { W, H } = frame(), fit = place( W, H );
	( { W, H } = frame() );                                          // the height as set; and the width, should a scroll bar have come or gone
	if ( W !== fit.W ) {
		fit = place( W, H );
		( { W, H } = frame() );
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
		const now = st.i === steps.length - 1;
		const whose = st.piece !== undefined ? K.called( G, M( st.piece ) ).sub : '';
		const fresh = !MINI && st.at !== null && ( !i || dayOf( st.at ) !== dayOf( shown[ i - 1 ].at ) );   // each day says itself once
		const note = [ now ? ( walkNow.cid === st.cid && walkNow.playing ? '▶ on now' : 'on now, paused' ) : ( st.again ? 'again' : '' ),
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
			if ( st.viaName ) {
				const name = st.via !== null ? first( st.via ) : st.viaName;
				const label = cut( name, FONT.tag, ( turn ? 170 : ( snaking ? lay.S - 2 * R + 6 : Math.max( 60, W - p.x - 60 ) ) ) - 28 );
				const w = 28 + wide( label, FONT.tag );
				// on a turn, where it bows out furthest, kept in the frame; in a row, halfway; in a column, between the two
				const at = turn ? { x: Math.min( Math.max( a.x + a.dir * 0.75 * WALK.bend, w / 2 + 4 ), W - w / 2 - 4 ), y: ( a.y + p.y ) / 2 } :
					( snaking ? { x: ( a.x + p.x ) / 2, y: p.y } : { x: p.x, y: ( a.y + p.y ) / 2 } );
				sc.pills.set( 'wv' + st.i, { id: st.via, who: st.via !== null ? [ st.via ] : [], stands: 'picker', is: st.via !== null ? 'p' + st.via : undefined,
					tag: true, step: st.i, x: Math.round( at.x ), y: Math.round( at.y ), w, label, extra: '', o: 1, delay: 80 + i * 20 } );
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
	} );
	if ( !MINI && walkFoot ) {
		requestAnimationFrame( () => {
			stage.scrollTop = stage.scrollHeight;                    // the song on now is at the foot: in sight
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
			'. A click on a song plays it again; on a name, goes to who they played with; on a faint bead, down a road not taken.' ].flat() :
		[ 'Nothing yet. Play a song in Rabbithole, then follow someone on it to the next.' ];
	return sc;
}

/** A day, as the walk heads each of its days. */
function dayOf( t ) {
	return typeof t === 'number' ? new Date( t ).toLocaleDateString( undefined, { day: 'numeric', month: 'short' } ) : '';
}

/** A step of the walk: play it again; turn it inside out; its page. */
function aStep( d ) {
	if ( MINI ) {
		return { kind: 'your rabbithole', title: d.label, lines: [ d.sub, d.note ].filter( Boolean ), hint: 'click: open your rabbithole',
			acts: [ act( 'Open your rabbithole', () => tell( { open: true } ) ) ] };
	}
	const to = '/rabbithole/?track=' + encodeURIComponent( d.cid );
	const w = { kind: 'a song you heard', title: d.label, lines: [ d.sub, d.note ].filter( Boolean ), hint: HOST ? 'click: play it again' : 'click: play it in Rabbithole', acts: [] };
	w.acts.push( HOST ? act( 'Play it again', () => tell( { play: d.cid } ) ) : link( 'Play it in Rabbithole', HOME + to, 'play' ) );
	if ( d.piece !== undefined ) {
		w.acts.push( act( "Who's on it, and where they lead", () => go( { m: d.piece } ) ) );
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

// What Rabbithole says: the walk, the song on now, whether it plays, and whether the drawer is open.
window.addEventListener( 'message', ( ev ) => {
	if ( !HOST || ev.origin !== location.origin || ev.source !== window.parent || !ev.data || ev.data.rabbithole !== 'walk' ) {
		return;
	}
	const d = ev.data;
	if ( road && Array.isArray( d.hops ) && ( !walkHops || d.hops.length !== walkHops.length ) ) {
		road = null;
	}
	walkHops = Array.isArray( d.hops ) ? d.hops : walkHops;
	walkNow = { cid: d.now || null, playing: !!d.playing };
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
		if ( !a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey ) {
			return;
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
			tell( road && road.cid === cid ? { play: cid, via: road.via } : { play: cid } );
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
	g.setAttribute( 'class', 'pill tag' + ( p.page ? '' : ' nopage' ) );
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
				'aria-label': 'About ' + d.title }, s( 'text', { y: 46, 'text-anchor': 'middle' }, K.clip( d.title, 30 ) ) ) );
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
		d.at ? d.at.x + ' ' + d.at.y + d.at.anchor : '' ].join( '|' ),
	line: ( d ) => ( d.stands === 'thread' ? [ 'th', d.w.toFixed( 1 ), d.quiet, d.emph, d.role ] :
		[ d.tie.played, d.tie.tier, d.w.toFixed( 1 ), d.quiet, d.emph, d.role, !!d.fine ] ).join( '|' ),
	pill: ( d ) => [ d.stands, d.tag, d.label, d.extra, d.tier, d.glyph, d.w.toFixed( 0 ), d.play, !!d.shy, d.anchor ].join( '|' )
};

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
	if ( view.cut !== undefined && G.songcast[ view.cut ] ) {
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
				h( 'ul', null, scene.company.slice( 0, 80 ).map( ( c ) => personRow( c.id, K.times( c.tie ), () => go( { a, b: c.id } ) ) ) ) );
			if ( scene.company.length > 80 ) {
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
	out.push( h( 'p', { class: 'foot' }, `${ G.people.length } pickers, ${ G.music.length } records and shows that join them. Built ${ K.when( G.built ) }. `,
		h( 'a', { href: 'connectome.sqlite', download: '' }, 'The whole store (SQLite)' ) ) );
	panel.replaceChildren( ...out.flat().filter( Boolean ) );
	if ( listed !== view ) {                                     // a new view's list starts at its top; a click in this one keeps its place
		panel.scrollTop = 0;
		listed = view;
	}
}

/* ------------------------------------------------------------------------------------------------------------
 * Going places
 * --------------------------------------------------------------------------------------------------------- */

function label( v ) {
	if ( v.walk ) {
		return 'Your rabbithole';
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

const same = ( v, w ) => !!v && !!w && v.a === w.a && v.b === w.b && v.m === w.m && v.s === w.s && v.cut === w.cut;

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
	const most = K.ego( { W: svg.clientWidth, H: 4000, named: 8, dots: 0, far: true } );
	legend.style.minHeight = '';
	stage.classList.remove( 'webbed', 'deep' );
	stage.classList.add( ...[ most.web && 'webbed', most.far && 'deep' ].filter( Boolean ) );
	const tall = legend.offsetHeight;
	stage.classList.remove( 'webbed', 'deep' );                      // show() says which of them the view has, once it knows
	legend.style.minHeight = tall + 'px';
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
	scene = view.walk ? walkScene( view ) : view.cut !== undefined ? songScene( view ) : view.m !== undefined ? pieceScene( view ) : ( view.b === undefined ? egoScene( view ) : pairScene( view.a, view.b ) );
	stage.classList.toggle( 'webbed', !!scene.web );
	stage.classList.toggle( 'deep', !!scene.deep );
	$( 'say' ).firstElementChild.replaceChildren( ...scene.head.filter( Boolean ) );
	$( 'say' ).lastElementChild.replaceChildren( ...( lost && trail.length < 2 ? [ lost ] : scene.sub ) );
	put( scene, quick );
	fillPanel();
	$( 'pa' ).value = view.walk || view.cut !== undefined || view.s !== undefined ? '' : ( view.m !== undefined ? '' : first( view.a ) );
	$( 'pb' ).value = view.walk || view.m !== undefined || view.b === undefined ? '' : first( view.b );
	$( 'back' ).hidden = trail.length < 2;
	$( 'crumbs' ).replaceChildren( ...trail.slice( -4, -1 ).flatMap( ( v, i, arr ) => [
		h( 'button', { type: 'button', onclick: () => {
			trail.splice( trail.length - ( arr.length - i ) - 1 );     // back to there: it, and all since, come off
			go( v.walk ? { walk: true } : v.m !== undefined ? { m: v.m } : ( v.b === undefined ? { a: v.a } : { a: v.a, b: v.b } ) );
		} }, label( v ) ), ' › ' ] ) );
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
	if ( !view || !scene || v.walk || v.b !== undefined || v.cut !== undefined || v.s !== undefined ) {
		return v;                                                    // two pickers, or a cut: a view of its own, with nothing brought along
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

/** The bar's address follows the view. On a page of its own each step is one of the browser's too, so its Back comes back. */
function stamp( step ) {
	history[ step && alone ? 'pushState' : 'replaceState' ]( null, '', address( view ) );
}

function go( v ) {
	if ( !v.walk && v.m === undefined && v.s === undefined && v.b === v.a ) {
		v = { a: v.a };
	}
	view = carry( v );
	sel = { picker: null };
	trail.push( view );
	if ( trail.length > 60 ) {
		trail.shift();
	}
	show();
	stamp( trail.length > 1 );
	// The page stays where the reader has it (Justin, #connectome, 15 Nov 2026: not to the top on every click).
}

function choose( picked ) {
	Object.assign( sel, picked );
	show();
}

function back() {
	if ( trail.length < 2 ) {
		return;
	}
	if ( alone ) {
		history.back();                                              // the browser's step; popstate, below, shows it
		return;
	}
	trail.pop();
	view = trail[ trail.length - 1 ];
	sel = { picker: null };
	show();
	stamp( false );
}

window.addEventListener( 'popstate', () => {
	const v = G && parse( new URLSearchParams( location.search ) );
	if ( !v ) {
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

/** A picker on a song's ring: what this cut's credits gave them, and where else they lead. */
function aPickerOfSong( d ) {
	const id = d.id, name = first( id ), role = d.cutOf ? d.cutOf.role : '';
	const w = { kind: 'a picker' + instOf( id ), title: name, tipTitle: name + instOf( id ), lines: [],
		hint: 'click: go to ' + name, acts: [ act( 'Go to ' + name, () => go( { a: id } ) ) ] };
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
	const box = svg.getBoundingClientRect();
	const x = e.clientX - box.left, y = e.clientY - box.top;
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
	if ( held !== null ) {
		closeSheet();
	} else if ( sel.picker !== null ) {
		choose( { picker: null } );
	} else if ( window.parent !== window ) {
		window.parent.postMessage( { connectome: 'close' }, location.origin );
	}
} );

$( 'back' ).addEventListener( 'click', back );

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

fetch( 'graph.json' ).then( ( r ) => {
	if ( !r.ok ) {
		throw new Error( r.status );
	}
	return r.json();
} ).then( ( g ) => {
	G = K.build( g );
	const all = K.catalogue( G );
	finder = new Map( all.map( ( x ) => [ x.label.toLowerCase(), x ] ) );
	$( 'names' ).replaceChildren( ...all.map( ( x ) => h( 'option', { value: x.label } ) ) );
	$( 'wait' ).remove();
	const q = new URLSearchParams( location.search );
	const asked = q.get( 'm' ) || q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' );
	const v = parse( q );
	if ( v ) {
		go( v );
	} else {
		const start = K.landing( G );
		lost = asked ? `The connectome doesn't know “${ asked }” yet. Here is ${ first( start ) } instead.` : '';
		go( { a: start } );
	}
} ).catch( ( err ) => {
	// #wait is gone once the graph is read: an error after that still has to be said somewhere, and seen in the console.
	const where = $( 'wait' ) || stage.appendChild( h( 'div', { id: 'wait' } ) );
	where.textContent = "The connectome couldn't be loaded (" + err.message + '). Try again in a moment.';
	console.error( err );
} );
