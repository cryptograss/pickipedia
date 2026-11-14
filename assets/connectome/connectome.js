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
 * pickers they have played with and the one in the middle hasn't, one of them named: as the cards on the
 * musicians' pages do toward the featured pickers. A click on one goes to them, and the way there stays drawn.
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
const FONT = { named: '700 14px Georgia, "Times New Roman", serif', subject: '700 17px Georgia, "Times New Roman", serif',
	far: '400 13px Georgia, "Times New Roman", serif',
	pill: '600 12.5px system-ui, -apple-system, "Segoe UI", sans-serif', tag: '700 12.5px Georgia, "Times New Roman", serif',
	piece: '600 13px system-ui, -apple-system, "Segoe UI", sans-serif', sub: '400 11.5px system-ui, -apple-system, "Segoe UI", sans-serif' };
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
let was = new Map();             // where each thing in sight is, by what it stands for, as the view changes
let fingers = false;             // the last pointer down was a finger or a pen: nothing hovers, so a touch asks before it acts
let held = null;                 // the mark whose sheet is open
const alone = window.parent === window;   // a page of its own, not the graph over a wiki page: its steps are the browser's too
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
	if ( v.m !== undefined ) {
		const pc = M( v.m );
		return '?' + new URLSearchParams( Object.assign( { m: G.music[ pc.m ].key }, pc.song ? { s: pc.song } : null ) );
	}
	return '?' + new URLSearchParams( v.b === undefined ? { p: first( v.a ) } : { a: first( v.a ), b: first( v.b ) } );
}

/** The view an address asks for; null when it names nothing the graph knows. (?from= and ?to= are read as a and b.) */
function parse( q ) {
	const m = q.get( 'm' ) ? K.findPiece( G, q.get( 'm' ), q.get( 's' ) ) : null;
	if ( m !== null ) {
		return { m };
	}
	const a = K.find( G, q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' ) ), b = K.find( G, q.get( 'b' ) || q.get( 'to' ) );
	return a === null ? null : ( b === null || b === a ? { a } : { a, b } );
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
	const W = Math.max( 300, svg.clientWidth ), H = Math.max( 240, svg.clientHeight );
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
function pillsFor( tie, room, most, prefer ) {
	const shown = [];
	let used = 0;
	const worth = tie.ev.filter( ( e ) => e.how >= K.STAGE && G.music[ e.m ].tier >= K.FULL );
	let pool = worth.length ? worth : tie.ev.slice( 0, 1 );        // nothing named up front: still say the one thing
	const came = prefer === undefined ? null : ( tie.ev.find( ( e ) => K.pieceFor( G, e ) === prefer ) || tie.ev.find( ( e ) => e.m === M( prefer ).m ) );
	if ( came ) {                                                 // the piece the reader came by is the one to say
		pool = [ came ].concat( pool.filter( ( e ) => e !== came ) );
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
			for ( let most = label.length; pad + wide( label, FONT.pill ) > room && most > 6; most-- ) {
				label = K.clip( n.brief, most );
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

function placePills( sc, u, v, tie, x1, x2, y, most, o, delay, prefer ) {
	const room = Math.abs( x2 - x1 );
	const fit = pillsFor( tie, room - ( most > 1 ? 52 : 0 ), most, prefer );
	const moreW = fit.more > 0 && most > 1 ? 16 + wide( '+' + fit.more + ' more', FONT.pill ) : 0;
	let x = ( x1 + x2 ) / 2 - ( fit.used + ( moreW ? moreW + 8 : 0 ) ) / 2;
	for ( const p of fit.shown ) {
		const piece = K.pieceFor( G, p.e );
		sc.pills.set( 'm' + lineKey( u, v ) + '.' + p.e.m, { stands: 'piece', piece, is: 'm' + piece, x: x + p.w / 2, y, w: p.w, label: p.label,
			glyph: p.glyph, tier: p.tier, e: p.e, u, v, o, delay, play: p.play, song: p.song } );
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
	// Those the reader came by stay, whatever their rank, and the line to each says what it is; then the closest.
	const ring = K.keeping( G, a, comp, v.keep );
	const came = new Set( ( v.keep || [] ).filter( ( k ) => G.adj[ a ].has( k ) ) );
	const want = Math.min( ring.length, H > 560 && W > 700 ? 8 : ( W > 460 || H > 500 ? 6 : 4 ) );
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
	addNode( sc, a, lay.C, 'subject', { rabbit: true, bare: true } );
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
			const at = { x: lay.C.x + ( pos.x - lay.C.x ) * 0.54, y: lay.C.y + ( pos.y - lay.C.y ) * 0.54 };
			placePills( sc, a, c.id, c.tie, at.x - room / 2, at.x + room / 2, at.y, 1, 1, 0, v.by );
		}
	} );
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
		addLine( sc, f.by, f.id, f.tie, { o: walked ? 0.95 : ( f.named ? 0.78 : 0.45 ), quiet: true, role: 'far', c: f.id, delay: 360 } );
	}
	sc.web = lay.web;
	sc.deep = !!out;
	sc.far = out ? out.fars : [];
	sc.company = comp;
	sc.shown = shown;
	sc.head = [ first( a ), pageMark( a, true ) ];
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
	addPiece( sc, v.m, lay.C, 'subject', { bare: true } );
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
			let at = K.tagAt( lay.C, pos, 24, 15, most );
			if ( at.room < Math.min( full, most ) ) {
				at = { x: pos.x + K.nudge( pos.x, Math.min( full, most ) / 2, 4, W - 4 ), y: pos.y + ( pos.below ? -32 : 32 ), room: most };
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
	const kind = me.kind === 'track' ? 'A track on ' + nm.sub : ( me.kind === 'show' ? 'A show' : 'A record' ) + ( nm.sub ? ' · ' + nm.sub : '' );
	sc.head = [ nm.name, playButton( G.music[ me.m ], me.song ) ];
	sc.sub = [ kind, ' · ', h( 'b', null, K.plural( L.cast.length, 'picker' ) ), L.named.length ?
		' on it: each line is one of them, and where else they lead' : ' on it, and none of them on anything else the sources here know' ];
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
	g.appendChild( gl );
	if ( d.bare ) {                                              // the headline names this one
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
	const p = P( d.id );
	g.textContent = '';
	g.setAttribute( 'class', 'pill tag' + ( p.page ? '' : ' nopage' ) );
	g.setAttribute( 'aria-label', p.name + instOf( d.id ) + ( d.who.length > 1 ? ' and ' + K.plural( d.who.length - 1, 'other' ) : '' ) );
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
	g.appendChild( s( 'a', { href: address( { a: d.id } ), 'aria-label': 'Go to ' + p.name }, t ) );
}

const draw = {
	node( g, d ) {
		if ( d.stands === 'piece' ) {
			drawPiece( g, d );
			return;
		}
		const p = P( d.id );
		g.textContent = '';
		g.setAttribute( 'class', 'pk ' + d.kind + ( p.page ? '' : ' nopage' ) + ( d.lit ? ' lit' : '' ) );
		g.setAttribute( 'aria-label', p.name + instOf( d.id ) );
		( d.kind === 'dot' ? layers.dots : layers.nodes ).appendChild( g );
		if ( d.kind === 'dot' ) {
			g.appendChild( s( 'circle', { class: 'halo', r: coarse ? 15 : Math.max( 12, d.r + 7 ) } ) );
			g.appendChild( s( 'circle', { class: 'dot' + ( p.page ? '' : ' hollow' ), r: d.r } ) );
			return;
		}
		const marked = d.kind !== 'far' && ( d.rabbit || p.inst );   // a ring with something in it, or a plain dot
		const R = d.kind === 'subject' ? ( marked ? 22 : 13 ) : ( d.kind === 'far' ? 5.5 : ( marked ? 14 : 9 ) );
		g.appendChild( s( 'circle', { class: 'halo', r: R + 8 } ) );
		if ( d.rabbit ) {
			g.appendChild( s( 'circle', { class: 'ring', r: R } ) );
			g.appendChild( rabbit( 0.95 ) );
		} else if ( p.inst ) {
			const size = R * 1.42;
			const img = s( 'image', { href: ICON + encodeURIComponent( p.inst.replace( / /g, '_' ) ) + '.png', x: -size / 2, y: -size / 2,
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
					{ x: d.dx || 0, y: d.below ? R + ( big ? 21 : 18 ) : -R - 8, 'text-anchor': 'middle' };
		g.appendChild( s( 'a', { href: address( { a: d.id } ), 'aria-label': 'Go to ' + p.name }, s( 'text', at, label ) ) );
	},
	line( g, d ) {
		if ( d.stands === 'thread' ) {                               // pickers, between two pieces: ink, thicker the more of them
			g.textContent = '';
			g.setAttribute( 'class', 'ln th ' + ( d.role === 'web' ? 'web ' : '' ) + ( d.quiet ? 'quiet' : '' ) );
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
		g.textContent = '';
		g.setAttribute( 'class', 'pill ' + ( d.more ? 'more' : 't' + d.tier ) + ( d.lit ? ' lit' : '' ) );
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
	node: ( d ) => [ d.stands, d.kind, d.lit, d.below, d.rabbit, d.side, d.bare, d.kind === 'dot' ? d.r.toFixed( 1 ) : '', d.label, d.dx, d.sub, d.sdx, d.play,
		d.at ? d.at.x + ' ' + d.at.y + d.at.anchor : '' ].join( '|' ),
	line: ( d ) => ( d.stands === 'thread' ? [ 'th', d.w.toFixed( 1 ), d.quiet, d.emph, d.role === 'web' ] :
		[ d.tie.played, d.tie.tier, d.w.toFixed( 1 ), d.quiet, d.emph, d.role, !!d.fine ] ).join( '|' ),
	pill: ( d ) => [ d.tag, d.label, d.extra, d.tier, d.glyph, d.w.toFixed( 0 ), d.play ].join( '|' )
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
	const to = pull( d, a, b ), from = it.fq || to;
	const q = it.q = { x: from.x + ( to.x - from.x ) * e, y: from.y + ( to.y - from.y ) * e };
	const A = `M${ a.x.toFixed( 1 ) } ${ a.y.toFixed( 1 ) }`, B = `${ b.x.toFixed( 1 ) } ${ b.y.toFixed( 1 ) }`;
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

function baconTable( a ) {
	const dist = K.distances( G, a );
	const rows = G.featured.filter( ( f ) => f !== a ).map( ( f ) => h( 'tr', { class: 'go', onclick: ( ev ) => {
		if ( !ev.target.closest( 'a' ) ) {
			go( { a, b: f } );
		}
	} }, h( 'td', null, nameLink( f ) ), h( 'td', { class: 'num' }, dist[ f ] < 0 ? '–' : String( dist[ f ] ) ) ) );
	return rows.length ? [ h( 'h3', null, 'Featured this month · Bacon number' ), h( 'table', null, rows ) ] : [];
}

function fillPanel() {
	const out = [];
	if ( view.m !== undefined ) {
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
		out.push( ...baconTable( a ) );
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
	panel.scrollTop = 0;
}

/* ------------------------------------------------------------------------------------------------------------
 * Going places
 * --------------------------------------------------------------------------------------------------------- */

function label( v ) {
	if ( v.m !== undefined ) {
		return K.called( G, M( v.m ) ).name;
	}
	return v.b === undefined ? first( v.a ) : first( v.a ) + ' ⟷ ' + first( v.b );
}

const same = ( v, w ) => !!v && !!w && v.a === w.a && v.b === w.b && v.m === w.m;

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
	stage.classList.toggle( 'dual', view.m !== undefined );
	steady();
	scene = view.m !== undefined ? pieceScene( view ) : ( view.b === undefined ? egoScene( view ) : pairScene( view.a, view.b ) );
	stage.classList.toggle( 'webbed', !!scene.web );
	stage.classList.toggle( 'deep', !!scene.deep );
	$( 'say' ).firstElementChild.replaceChildren( ...scene.head.filter( Boolean ) );
	$( 'say' ).lastElementChild.replaceChildren( ...( lost && trail.length < 2 ? [ lost ] : scene.sub ) );
	put( scene, quick );
	fillPanel();
	$( 'pa' ).value = view.m !== undefined ? '' : first( view.a );
	$( 'pb' ).value = view.m !== undefined || view.b === undefined ? '' : first( view.b );
	$( 'back' ).hidden = trail.length < 2;
	$( 'crumbs' ).replaceChildren( ...trail.slice( -4, -1 ).flatMap( ( v, i, arr ) => [
		h( 'button', { type: 'button', onclick: () => {
			trail.splice( trail.length - ( arr.length - i ) - 1 );     // back to there: it, and all since, come off
			go( v.m !== undefined ? { m: v.m } : ( v.b === undefined ? { a: v.a } : { a: v.a, b: v.b } ) );
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
	if ( !view || !scene || v.b !== undefined ) {
		return v;
	}
	const here = view.m !== undefined ? ( scene.tagged || [] ) : [ view.a, view.b ].filter( ( x ) => x !== undefined );
	if ( v.m === undefined ) {
		const keep = [ ...new Set( ( v.keep || [] ).concat( here ) ) ].filter( ( x ) => x !== v.a ).slice( 0, 3 );
		return { a: v.a, keep, by: view.m };
	}
	const pills = [ ...scene.pills.values() ].filter( ( p ) => p.stands === 'piece' && !p.more && p.piece !== v.m ).map( ( p ) => p.piece );
	return { m: v.m, hand: v.hand || here, keep: view.m !== undefined ? [ view.m ] : [ ...new Set( pills ) ].slice( 0, 2 ) };
}

/** The bar's address follows the view. On a page of its own each step is one of the browser's too, so its Back comes back. */
function stamp( step ) {
	history[ step && alone ? 'pushState' : 'replaceState' ]( null, '', address( view ) );
}

function go( v ) {
	if ( v.m === undefined && v.b === v.a ) {
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
	if ( narrow() && window.scrollY > 40 ) {                        // asked for from the list, under the graph: up to the graph
		window.scrollTo( 0, 0 );
	}
}

function choose( picked ) {
	Object.assign( sel, picked );
	show();
	if ( narrow() && window.scrollY > 0 ) {                         // the list is under the graph: bring what changed into sight
		window.scrollTo( { top: 0, behavior: still ? 'auto' : 'smooth' } );
	}
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

function aPicker( d ) {
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
			return out ? aPickerBetween( d ) : aPicker( d );
		case 'piece':
			return d.more ? theRest( d ) : ( out ? aPieceAmong( d ) : aPiece( d ) );
		case 'thread':
			return d.quiet ? null : aPickerBetween( d );
		default:
			return d.quiet ? null : aTie( d );
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
	sheet.classList.toggle( 'up', at.top + at.height / 2 > box.top + box.height * 0.58 );    // out of the way of what it's about
	sheet.hidden = false;
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

function typed() {
	const a = K.find( G, $( 'pa' ).value ), b = K.find( G, $( 'pb' ).value );
	if ( a === null && b === null ) {
		$( 'pa' ).value = view && view.a !== undefined ? first( view.a ) : '';
		return;
	}
	const next = a === null || b === null || b === a ? { a: a === null ? b : a } : { a, b };
	if ( !view || next.a !== view.a || next.b !== view.b ) {
		go( next );
	}
}
[ 'pa', 'pb' ].forEach( ( id ) => {
	$( id ).addEventListener( 'change', typed );
	$( id ).addEventListener( 'focus', ( e ) => e.target.select() );
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
	$( 'names' ).replaceChildren( ...G.people.map( ( p ) => h( 'option', { value: p.name } ) ) );
	$( 'wait' ).remove();
	const q = new URLSearchParams( location.search );
	const asked = q.get( 'm' ) || q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' );
	const v = parse( q );
	if ( v ) {
		go( v );
	} else {
		const start = G.featured.length ? G.featured[ 0 ] : 0;
		lost = asked ? `The connectome doesn't know “${ asked }” yet. Here is ${ first( start ) } instead.` : '';
		go( { a: start } );
	}
} ).catch( ( err ) => {
	// #wait is gone once the graph is read: an error after that still has to be said somewhere, and seen in the console.
	const where = $( 'wait' ) || stage.appendChild( h( 'div', { id: 'wait' } ) );
	where.textContent = "The connectome couldn't be loaded (" + err.message + '). Try again in a moment.';
	console.error( err );
} );
