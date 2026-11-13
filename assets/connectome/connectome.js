/*
 * The connectome's big graph, drawn (index.html). connectome-core.js says what a view holds and where each
 * thing sits; this puts it on the page, moves it when the view changes, and answers the pointer.
 *
 * The marks, the same as on the cards and in Rabbithole: a circle is a picker (solid with a page, open
 * without one yet; the rabbit is whose company you're in); a pill is music (a track, a record, a taped show);
 * a line is the music two pickers share: gold for a Permanent Release, plain ink for a Full Release, dotted
 * for what's only counted. A name is a link to that picker's page; the circle is the way further in.
 *
 * Every string from graph.json reaches the page as text, never as markup.
 */
import * as K from './connectome-core.js';

const NS = 'http://www.w3.org/2000/svg';
const HOME = /(^|\.)pickipedia\.xyz$/.test( location.hostname ) ? '' : 'https://pickipedia.xyz';
const ICON = HOME + '/index.php?title=Special:Redirect/file/Instrument-icon-';
const FONT = { named: '700 14px Georgia, "Times New Roman", serif', subject: '700 17px Georgia, "Times New Roman", serif',
	pill: '600 12.5px system-ui, -apple-system, "Segoe UI", sans-serif' };
const still = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

const $ = ( id ) => document.getElementById( id );
const svg = $( 'g' ), stage = $( 'stage' ), tip = $( 'tip' ), panel = $( 'panel' );

let G = null;
let view = null;                 // { a } one picker and their company; { a, b } two pickers and what's between
let sel = { picker: null, music: null };
let scene = null;
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
	return Math.max( 3.2, Math.min( 8, 3.2 + 2.6 * Math.sqrt( w ) ) );
}

function newScene() {
	return { nodes: new Map(), lines: new Map(), pills: new Map(), head: '', sub: [] };
}

function addNode( sc, id, at, kind, more ) {
	sc.nodes.set( 'p' + id, Object.assign( { id, x: at.x, y: at.y, kind, below: kind === 'subject' ? true : !!at.below, o: 1 }, more ) );
}

/** Room for the two ends' names: beside each picker when the frame is wide, under it when it isn't. */
function endNames( a, b, W ) {
	const wa = wide( K.clip( first( a ), 26 ), FONT.subject ), wb = wide( K.clip( first( b ), 26 ), FONT.subject );
	const beside = W >= 700 && wa + wb + 2 * 46 < W * 0.5;
	return beside ? { la: wa + 34, lb: wb + 34, sa: 'left', sb: 'right' } : { la: wa / 2, lb: wb / 2, sa: null, sb: null };
}

function addLine( sc, u, v, tie, more ) {
	sc.lines.set( lineKey( u, v ), Object.assign( { a: 'p' + u, b: 'p' + v, u, v, tie, w: lineWidth( tie ), o: 1 }, more ) );
}

/** The best of what a tie holds, as pills that fit in `room` pixels; and how many more there are. */
function pillsFor( tie, room, most ) {
	const shown = [];
	let used = 0;
	const worth = tie.ev.filter( ( e ) => e.how >= K.STAGE && G.music[ e.m ].tier >= K.FULL );
	const pool = worth.length ? worth : tie.ev.slice( 0, 1 );      // nothing named up front: still say the one thing
	for ( const e of pool ) {
		if ( shown.length >= most ) {
			break;
		}
		const n = K.naming( G, e );
		let label = K.clip( n.short, 34 );
		let w = 34 + wide( label, FONT.pill );
		if ( used + w > room && !shown.length ) {                     // the first one always goes in: briefer, then cut to fit
			label = n.brief;
			for ( let cut = label.length; 34 + wide( label, FONT.pill ) > room && cut > 6; cut-- ) {
				label = K.clip( n.brief, cut );
			}
			w = 34 + wide( label, FONT.pill );
		}
		if ( used + w > room && shown.length ) {
			break;
		}
		shown.push( { e, label, w, glyph: n.glyph, tier: G.music[ e.m ].tier } );
		used += w + 8;
	}
	return { shown, more: tie.ev.length - shown.length, used: Math.max( 0, used - 8 ) };
}

function placePills( sc, u, v, tie, x1, x2, y, most, o, delay ) {
	const room = Math.abs( x2 - x1 );
	const fit = pillsFor( tie, room - ( most > 1 ? 52 : 0 ), most );
	const moreW = fit.more > 0 && most > 1 ? 16 + wide( '+' + fit.more + ' more', FONT.pill ) : 0;
	let x = ( x1 + x2 ) / 2 - ( fit.used + ( moreW ? moreW + 8 : 0 ) ) / 2;
	for ( const p of fit.shown ) {
		sc.pills.set( 'm' + lineKey( u, v ) + '.' + p.e.m, { x: x + p.w / 2, y, w: p.w, label: p.label, glyph: p.glyph, tier: p.tier,
			e: p.e, u, v, o, delay, lit: sel.music === p.e.m } );
		x += p.w + 8;
	}
	if ( moreW ) {
		sc.pills.set( 'm' + lineKey( u, v ) + '.more', { x: x + moreW / 2, y, w: moreW, label: '+' + fit.more + ' more', more: true,
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
	const want = Math.min( pool.length, tie ? ( H > 560 ? 6 : 4 ) : ( H > 560 ? 5 : 3 ) );
	const en = endNames( a, b, W );
	const lay = K.bridge( { W, H, direct: !!tie, named: want, dots: pool.length - want, la: en.la, lb: en.lb } );
	const placed = lay.named.length + lay.dots.length;
	const at = pool.findIndex( ( m ) => m.id === sel.picker );
	if ( at >= placed ) {                                             // picked from the list, beyond what's drawn
		pool = pool.slice();
		pool.splice( Math.max( 0, lay.named.length - 1 ), 0, pool.splice( at, 1 )[ 0 ] );
	} else if ( sel.picker !== null && at < 0 ) {
		sel.picker = null;
	}
	const lit = sel.picker !== null ? sel.picker : ( tie ? null : ( pool[ 0 ] ? pool[ 0 ].id : null ) );

	addNode( sc, a, lay.A, 'subject', { rabbit: true, side: en.sa } );
	addNode( sc, b, lay.B, 'subject', { side: en.sb } );
	if ( tie ) {
		addLine( sc, a, b, tie, { o: lit === null ? 1 : 0.5, role: 'direct', emph: true, w: Math.max( 4.5, lineWidth( tie ) ) } );
		placePills( sc, a, b, tie, lay.A.x + 48, lay.B.x - 48, lay.band.y, W > 900 ? 3 : ( W > 620 ? 2 : 1 ), lit === null ? 1 : 0.45, 140 );
	}
	pool.slice( 0, placed ).forEach( ( m, i ) => {
		const named = i < lay.named.length;
		const pos = named ? lay.named[ i ] : lay.dots[ i - lay.named.length ];
		const on = lit === m.id;
		const picked = sel.picker !== null;
		addNode( sc, m.id, pos, named ? 'named' : 'dot', { r: dotRadius( m.w ), lit: on, delay: named ? 120 + i * 45 : 330,
			o: !picked || on || !named ? 1 : 0.55, m } );
		const o = on ? 1 : ( named ? ( picked ? 0.28 : 0.9 ) : 0 );
		const leg = { via: 'p' + m.id, o, quiet: !named && !on, emph: on, delay: named ? 160 + i * 45 : 360, role: 'leg', c: m.id };
		addLine( sc, a, m.id, m.ta, leg );
		addLine( sc, m.id, b, m.tb, leg );
		if ( on ) {
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
		addNode( sc, a, lay.A, 'subject', { rabbit: true, side: en.sa } );
		addNode( sc, b, lay.B, 'subject', { side: en.sb } );
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
	addNode( sc, a, lay.A, 'subject', { rabbit: true, side: en.sa } );
	addNode( sc, b, lay.B, 'subject', { side: en.sb } );
	r.chains.forEach( ( chain, c ) => {
		const row = c === on ? 0 : ( c < on ? c + 1 : c );          // the lit chain takes the middle row
		chain.forEach( ( id, level ) => {
			if ( level > 0 && level < r.hops ) {
				addNode( sc, id, Object.assign( lay.at( row, level ), { below: row === 0 || row % 2 === 0 } ), 'named',
					{ lit: c === on, o: c === on ? 1 : 0.6, delay: 120 + c * 60, chain: c } );
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
				const span = Math.abs( pv.x - pu.x ) - 44;
				placePills( sc, u, v, tie, ( pu.x + pv.x ) / 2 - span / 2, ( pu.x + pv.x ) / 2 + span / 2, ( pu.y + pv.y ) / 2, 1, 1, 200 );
			}
		}
	} );
	sc.chain = r.chains[ on ];
	sc.routes = r;
	sc.sub = [ h( 'b', null, K.plural( r.hops, 'hop' ) + ' apart' ), ': never on one stage or one track, so far as the sources here say' ];
	return sc;
}

function egoScene( a ) {
	const { W, H } = frame();
	const sc = newScene();
	let comp = K.company( G, a );
	const looseOnly = !comp.length;
	if ( looseOnly ) {
		comp = K.company( G, a, true );
	}
	const want = Math.min( comp.length, H > 560 && W > 700 ? 8 : ( W > 460 ? 6 : 4 ) );
	const lay = K.ego( { W, H, named: want, dots: comp.length - want } );
	addNode( sc, a, lay.C, 'subject', { rabbit: true, bare: true } );
	comp.slice( 0, lay.named.length + lay.dots.length ).forEach( ( c, i ) => {
		const named = i < lay.named.length;
		addNode( sc, c.id, named ? lay.named[ i ] : lay.dots[ i - lay.named.length ], named ? 'named' : 'dot',
			{ r: dotRadius( c.tie.w ), delay: named ? 80 + i * 40 : 300, tie: c.tie } );
		addLine( sc, a, c.id, c.tie, { o: named ? 0.9 : 0, quiet: !named, delay: named ? 120 + i * 40 : 300, role: 'spoke', c: c.id } );
	} );
	sc.company = comp;
	sc.shown = lay.named.length + lay.dots.length;
	sc.head = [ nameLink( a ) ];
	sc.sub = comp.length ?
		[ looseOnly ? 'On a record with ' : 'Has played with ', h( 'b', null, K.plural( comp.length, 'picker' ) ), ' the sources here know' +
			( looseOnly ? ', though none on the same track' : '' ) ] :
		[ 'Nobody the sources here know has played with them yet.' ];
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

const draw = {
	node( g, d ) {
		const p = P( d.id );
		g.textContent = '';
		g.setAttribute( 'class', 'pk ' + d.kind + ( p.page ? '' : ' nopage' ) + ( d.lit ? ' lit' : '' ) );
		g.setAttribute( 'aria-label', p.name + instOf( d.id ) );
		( d.kind === 'dot' ? layers.dots : layers.nodes ).appendChild( g );
		if ( d.kind === 'dot' ) {
			g.appendChild( s( 'circle', { class: 'halo', r: Math.max( 12, d.r + 7 ) } ) );
			g.appendChild( s( 'circle', { class: 'dot' + ( p.page ? '' : ' hollow' ), r: d.r } ) );
			return;
		}
		const marked = d.rabbit || p.inst;                           // a ring with something in it, or a plain dot
		const R = d.kind === 'subject' ? ( marked ? 22 : 13 ) : ( marked ? 14 : 9 );
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
		const label = K.clip( p.name, 26 );
		const at = d.side === 'left' ? { x: -R - 12, y: 6, 'text-anchor': 'end' } :
			d.side === 'right' ? { x: R + 12, y: 6, 'text-anchor': 'start' } :
				{ y: d.below ? R + ( big ? 21 : 18 ) : -R - 8, 'text-anchor': 'middle' };
		g.appendChild( s( 'a', { href: pageUrl( p.name ), target: '_top', 'aria-label': p.name + ( p.page ? ': the page' : ': no page yet' ) },
			s( 'text', at, label ) ) );
	},
	line( g, d ) {
		const t = d.tie;
		const gold = t.played && t.tier === K.PERMANENT;
		const cls = !t.played ? 't0' : 't' + t.tier;
		g.textContent = '';
		g.setAttribute( 'class', 'ln ' + ( d.quiet ? 'quiet' : '' ) );
		( d.quiet ? layers.faint : layers.lines ).appendChild( g );
		if ( gold && d.emph ) {                                      // the one that's lit: gold, with ink down the middle
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
		g.textContent = '';
		g.setAttribute( 'class', 'pill ' + ( d.more ? 'more' : 't' + d.tier ) + ( d.lit ? ' lit' : '' ) );
		layers.pills.appendChild( g );
		g.appendChild( s( 'rect', { x: -d.w / 2, y: -12, width: d.w, height: 24, rx: 12 } ) );
		if ( d.more ) {
			g.appendChild( s( 'text', { x: 0, y: 4.3, 'text-anchor': 'middle' }, d.label ) );
			return;
		}
		const gl = glyph( d.glyph );
		gl.setAttribute( 'transform', `translate(${ -d.w / 2 + 14 } 0)` );
		g.appendChild( gl );
		g.appendChild( s( 'text', { x: -d.w / 2 + 25, y: 4.3 }, d.label ) );
	}
};

const sig = {
	node: ( d ) => [ d.kind, d.lit, d.below, d.rabbit, d.side, d.bare, d.kind === 'dot' ? d.r.toFixed( 1 ) : '' ].join( '|' ),
	line: ( d ) => [ d.tie.played, d.tie.tier, d.w.toFixed( 1 ), d.quiet, d.emph ].join( '|' ),
	pill: ( d ) => [ d.label, d.tier, d.lit, d.glyph, d.w.toFixed( 0 ) ].join( '|' )
};

function sync( kind, next, now ) {
	const have = live[ kind ];
	for ( const [ key, d ] of next ) {
		let it = have.get( key );
		const fresh = !it;
		if ( fresh ) {
			it = { el: s( 'g', { 'data-k': key, 'data-kind': kind, tabindex: kind === 'line' ? null : 0, role: kind === 'line' ? null : 'button' } ),
				x: d.x, y: d.y, o: 0 };
			have.set( key, it );
		}
		const sg = sig[ kind ]( d );
		if ( it.sig !== sg ) {
			draw[ kind ]( it.el, d );
			it.sig = sg;
		}
		Object.assign( it, { d, fx: it.x, fy: it.y, fo: it.o, tx: d.x, ty: d.y, to: d.o === undefined ? 1 : d.o, t0: now,
			delay: fresh ? ( d.delay || 0 ) : 0, dead: false } );
	}
	for ( const [ key, it ] of have ) {
		if ( !next.has( key ) && !it.dead ) {
			Object.assign( it, { fx: it.x, fy: it.y, fo: it.o, tx: it.x, ty: it.y, to: 0, t0: now, delay: 0, dead: true } );
		}
	}
}

function pathOf( d ) {
	const a = live.node.get( d.a ), b = live.node.get( d.b );
	if ( !a || !b ) {
		return null;
	}
	if ( d.via ) {
		const v = live.node.get( d.via );
		return `M${ a.x.toFixed( 1 ) } ${ a.y.toFixed( 1 ) }Q${ ( ( a.x + b.x ) / 2 ).toFixed( 1 ) } ${ ( v ? v.y : ( a.y + b.y ) / 2 ).toFixed( 1 ) } ${ b.x.toFixed( 1 ) } ${ b.y.toFixed( 1 ) }`;
	}
	return `M${ a.x.toFixed( 1 ) } ${ a.y.toFixed( 1 ) }L${ b.x.toFixed( 1 ) } ${ b.y.toFixed( 1 ) }`;
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
					const p = pathOf( it.d );
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

function nameLink( id ) {
	const p = P( id );
	return h( 'a', { class: 'who' + ( p.page ? '' : ' new' ), href: pageUrl( p.name ), target: '_top',
		title: p.page ? p.name + "'s page" : p.name + ': no page yet' }, p.name );
}

function pageButton( id ) {
	const p = P( id );
	return h( 'a', { class: 'page' + ( p.page ? '' : ' new' ), href: pageUrl( p.name ), target: '_top' },
		p.page ? p.name + "'s page" : 'Start ' + p.name + "'s page" );
}

function evidence( tie, limit ) {
	const rows = tie.ev.slice( 0, limit || tie.ev.length ).map( ( e ) => {
		const m = G.music[ e.m ], n = K.naming( G, e );
		const songs = e.songs.length ? e.songs.slice( 0, 4 ).map( ( song, i ) => [ i ? ', ' : '', G.songs[ song ] ?
			h( 'a', { href: wikiUrl( G.songs[ song ] ), target: '_top' }, song ) : '“' + K.clip( song, 60 ) + '”' ] )
			.concat( e.songs.length > 4 ? [ ` and ${ e.songs.length - 4 } more` ] : [] ) : null;
		return h( 'li', { class: 'go' + ( sel.music === e.m ? ' hot' : '' ), onclick: ( ev ) => {
			if ( !ev.target.closest( 'a' ) ) {
				choose( { music: e.m, pair: [ tie.a, tie.b ] } );
			}
		} },
		h( 'span', { class: 'mark' }, glyphBox( n.glyph === 'track' ? 'record' : n.glyph ) ),
		h( 'span', { class: 'body' },
			h( 'div', { class: 't' }, m.kind === 'show' ? n.short : ( m.page ? h( 'a', { href: wikiUrl( m.page ), target: '_top' }, n.long ) : n.long ) ),
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

/** A picker in a list: the name goes to the page, the rest of the row goes further in. */
function personRow( id, note, act, under ) {
	return h( 'li', { class: 'go', 'data-p': id, onclick: ( ev ) => {
		if ( !ev.target.closest( 'a' ) ) {
			act();
		}
	}, onmouseenter: () => warm( 'p' + id, true ), onmouseleave: () => warm( 'p' + id, false ) },
	h( 'span', { class: 'body' }, nameLink( id ), h( 'span', { class: 's' }, instOf( id ) ), under ? h( 'div', { class: 's' }, under ) : null ),
	note ? h( 'span', { class: 'n' }, note ) : null );
}

function musicPanel( mId, pair ) {
	const m = G.music[ mId ];
	const title = m.kind === 'show' ? ( m.artist || m.title ) : m.title;
	const tie = G.adj[ pair[ 0 ] ].get( pair[ 1 ] );
	const shared = tie && tie.ev.find( ( e ) => e.m === mId );
	const on = m.cast.slice().sort( ( x, y ) => ( pair.includes( y[ 0 ] ) - pair.includes( x[ 0 ] ) ) || first( x[ 0 ] ).localeCompare( first( y[ 0 ] ) ) );
	return [
		h( 'div', { class: 'acts' }, h( 'button', { type: 'button', onclick: () => choose( { music: null } ) }, '← ' + first( pair[ 0 ] ) + ' & ' + first( pair[ 1 ] ) ) ),
		h( 'h2', null, m.page ? h( 'a', { href: wikiUrl( m.page ), target: '_top' }, title ) : title ),
		h( 'p', { class: 'sub' }, [ m.kind === 'show' ? ( m.artist && m.title !== m.artist ? m.title : K.when( m.date ) ) :
			[ m.artist, K.when( m.date ) ].filter( Boolean ).join( ' · ' ) ] ),
		h( 'p', null, badge( m.tier ), ' ', m.source ? h( 'a', { href: m.source, target: '_blank', rel: 'noopener' }, 'Check it at ' + sourceName( m.source ) + ' ↗' ) : null ),
		shared && shared.songs.length ? [ h( 'h3', null, `${ first( pair[ 0 ] ) } & ${ first( pair[ 1 ] ) }, together on` ),
			h( 'ul', null, shared.songs.slice( 0, 40 ).map( ( song ) => h( 'li', null, h( 'span', { class: 'mark' }, glyphBox( 'track' ) ),
				h( 'span', { class: 'body' }, G.songs[ song ] ? h( 'a', { class: 't', href: wikiUrl( G.songs[ song ] ), target: '_top' }, song ) :
					h( 'span', { class: 't' }, song ) ) ) ) ) ] : null,
		h( 'h3', null, `On it, of the pickers here · ${ on.length }` ),
		h( 'ul', null, on.slice( 0, 60 ).map( ( [ id, roles ] ) => h( 'li', { class: 'go', onclick: ( ev ) => {
			if ( !ev.target.closest( 'a' ) ) {
				go( { a: id } );
			}
		} }, h( 'span', { class: 'body' }, nameLink( id ), roles ? h( 'div', { class: 's' }, roles ) : null ) ) ) ),
		on.length > 60 ? h( 'p', { class: 'sub' }, `and ${ on.length - 60 } more` ) : null
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
	if ( sel.music !== null && sel.pair ) {
		out.push( ...musicPanel( sel.music, sel.pair ) );
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
				h( 'div', { class: 'acts' }, pageButton( c ), h( 'button', { type: 'button', onclick: () => go( { a: c } ) }, first( c ) + "'s company" ) ),
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
	return v.b === undefined ? first( v.a ) : first( v.a ) + ' ⟷ ' + first( v.b );
}

function show( quick ) {
	scene = view.b === undefined ? egoScene( view.a ) : pairScene( view.a, view.b );
	$( 'say' ).firstElementChild.replaceChildren( ...scene.head );
	$( 'say' ).lastElementChild.replaceChildren( ...scene.sub );
	put( scene, quick );
	fillPanel();
	$( 'pa' ).value = first( view.a );
	$( 'pb' ).value = view.b === undefined ? '' : first( view.b );
	$( 'back' ).hidden = trail.length < 2;
	$( 'crumbs' ).replaceChildren( ...trail.slice( -4, -1 ).flatMap( ( v, i, arr ) => [
		h( 'button', { type: 'button', onclick: () => {
			trail.splice( trail.length - ( arr.length - i ) - 1 );     // back to there: it, and all since, come off
			go( v );
		} }, label( v ) ), ' › ' ] ) );
	const q = new URLSearchParams( view.b === undefined ? { p: first( view.a ) } : { a: first( view.a ), b: first( view.b ) } );
	history.replaceState( null, '', '?' + q );
	document.title = label( view ) + ' · the connectome';
	hush();
}

function go( v ) {
	if ( v.b === v.a ) {
		v = { a: v.a };
	}
	view = v;
	sel = { picker: null, music: null };
	trail.push( v );
	if ( trail.length > 60 ) {
		trail.shift();
	}
	show();
}

function choose( what ) {
	Object.assign( sel, what );
	if ( what.picker !== undefined && what.music === undefined ) {
		sel.music = null;
	}
	show();
}

function back() {
	if ( trail.length > 1 ) {
		trail.pop();
		view = trail[ trail.length - 1 ];
		sel = { picker: null, music: null };
		show();
	}
}

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
	svg.querySelectorAll( '.hot' ).forEach( ( e ) => e.classList.remove( 'hot' ) );
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

function tieLines( u, v ) {
	const t = G.adj[ u ].get( v );
	if ( !t ) {
		return [];
	}
	const top = t.ev[ 0 ] ? K.naming( G, t.ev[ 0 ] ) : null;
	return [ `with ${ first( u ) }: ${ K.times( t ) }` + ( top && t.ev.length === 1 ? ` (${ K.clip( top.short, 40 ) })` : '' ) ];
}

function hover( g ) {
	const kind = g.dataset.kind, it = live[ kind ].get( g.dataset.k );
	if ( !it || it.dead ) {
		return;
	}
	const d = it.d;
	if ( kind === 'node' ) {
		warm( g.dataset.k, true );
		const title = first( d.id ) + instOf( d.id );
		if ( view.b === undefined ) {
			if ( d.id === view.a ) {
				say( g, title, [ P( d.id ).page ? '' : 'no page yet' ], 'click anyone around them: what the two share' );
			} else {
				const top = K.naming( G, d.tie.ev[ 0 ] );
				say( g, title, [ K.together( d.tie ), K.clip( top.short, 44 ) + ( d.tie.ev.length > 1 ? `, and ${ d.tie.ev.length - 1 } more` : '' ) ],
					'click: what they share with ' + first( view.a ) );
			}
		} else if ( d.id === view.a || d.id === view.b ) {
			say( g, title, [ K.plural( K.company( G, d.id ).length, 'picker' ) + ' played with' ], 'click: their whole company · the name goes to the page' );
		} else {
			say( g, title, [ ...tieLines( view.a, d.id ), ...tieLines( view.b, d.id ) ],
				scene.chain ? 'click: light this way across' : ( d.lit && sel.picker === d.id ? 'click again to let go' : 'click: light the way through ' + first( d.id ) ) );
		}
	} else if ( kind === 'pill' ) {
		g.classList.add( 'hot' );
		if ( d.more ) {
			say( g, d.label, [ 'everything they share is in the list' ], '' );
		} else {
			const m = G.music[ d.e.m ], n = K.naming( G, d.e );
			say( g, n.short, [ n.long !== n.short ? n.long : '', d.e.songs.length > 1 ? d.e.songs.slice( 0, 6 ).join( ', ' ) + ( d.e.songs.length > 6 ? ', …' : '' ) : '',
				K.TIER_NAME[ m.tier ] + ' · ' + sourceName( m.source ) ], "click: who's on it" );
		}
	} else if ( kind === 'line' && !d.quiet ) {
		g.classList.add( 'hot' );
		const t = d.tie, top = K.naming( G, t.ev[ 0 ] );
		say( g, `${ first( d.u ) } & ${ first( d.v ) }`, [ K.together( t ), K.clip( top.short, 44 ) + ( t.ev.length > 1 ? `, and ${ t.ev.length - 1 } more` : '' ) ],
			d.role === 'direct' ? '' : ( view.b === undefined ? 'click: open these two' : 'click: light this way across' ) );
	}
}

function click( g ) {
	const kind = g.dataset.kind, it = live[ kind ].get( g.dataset.k );
	if ( !it || it.dead ) {
		return;
	}
	const d = it.d;
	if ( kind === 'node' ) {
		if ( view.b === undefined ) {
			if ( d.id !== view.a ) {
				go( { a: view.a, b: d.id } );
			}
		} else if ( d.id === view.a || d.id === view.b ) {
			go( { a: d.id } );
		} else {
			choose( { picker: sel.picker === d.id ? null : d.id } );
		}
	} else if ( kind === 'pill' ) {
		if ( d.more ) {
			choose( { picker: d.u === view.a && d.v === view.b ? null : sel.picker, music: null } );
			const top = $( 'together' );
			if ( top ) {
				top.scrollIntoView( { block: 'start' } );
			}
		} else {
			choose( { music: sel.music === d.e.m ? null : d.e.m, pair: [ d.u, d.v ] } );
		}
	} else if ( kind === 'line' ) {
		if ( view.b === undefined ) {
			go( { a: view.a, b: d.c } );
		} else if ( d.role === 'direct' ) {
			choose( { picker: null, music: null } );
		} else {
			choose( { picker: d.c } );
		}
	}
}

svg.addEventListener( 'pointerover', ( e ) => {
	const g = e.target.closest( '[data-k]' );
	hush();
	if ( g ) {
		hover( g );
	}
} );
svg.addEventListener( 'pointerleave', hush );
svg.addEventListener( 'focusin', ( e ) => {
	const g = e.target.closest( '[data-k]' );
	hush();
	if ( g ) {
		hover( g );
	}
} );
svg.addEventListener( 'focusout', hush );
svg.addEventListener( 'click', ( e ) => {
	if ( e.target.closest( 'a' ) ) {
		return;                                                      // a name: the browser goes to the page
	}
	const g = e.target.closest( '[data-k]' );
	if ( g ) {
		click( g );
	} else if ( sel.picker !== null || sel.music !== null ) {
		choose( { picker: null, music: null } );
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
	if ( sel.picker !== null || sel.music !== null ) {
		choose( { picker: null, music: null } );
	} else if ( window.parent !== window ) {
		window.parent.postMessage( { connectome: 'close' }, location.origin );
	}
} );

$( 'back' ).addEventListener( 'click', back );

function typed() {
	const a = K.find( G, $( 'pa' ).value ), b = K.find( G, $( 'pb' ).value );
	if ( a === null ) {
		$( 'pa' ).value = view ? first( view.a ) : '';
		return;
	}
	const next = b === null || b === a ? { a } : { a, b };
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
			show( true );
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
	const a = K.find( G, q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' ) ), b = K.find( G, q.get( 'b' ) || q.get( 'to' ) );
	if ( a === null ) {
		const start = G.featured.length ? G.featured[ 0 ] : 0;
		go( { a: start } );
		if ( q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' ) ) {
			$( 'say' ).lastElementChild.replaceChildren( `The connectome doesn't know “${ q.get( 'a' ) || q.get( 'from' ) || q.get( 'p' ) }” yet. Here is ${ first( start ) } instead.` );
		}
	} else {
		go( b === null ? { a } : { a, b } );
	}
} ).catch( ( err ) => {
	$( 'wait' ).textContent = "The connectome couldn't be loaded (" + err.message + '). Try again in a moment.';
} );
