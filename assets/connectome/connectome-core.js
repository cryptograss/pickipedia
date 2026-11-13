/*
 * The connectome's big graph: what it knows and what it decides. Nothing in here touches the page, so
 * tools/test_connectome_core.mjs can run all of it; connectome.js draws what this says.
 *
 * Justin, #connectome, 13 Nov 2026: at first only the routes between the two pickers that were clicked, one
 * hop and two; a few names in any view and the rest faded behind them; Permanent Releases loudest, Full
 * Releases shown, anything else counted but not named up front; every click fast. So nothing here simulates
 * anything: a view is a handful of pickers chosen by how much they've played together, set down at places
 * worked out from the size of the frame.
 *
 * graph.json is tools/connectome_graph.py's; its notes say what each field means.
 */

export const TRACK = 3, STAGE = 2, RECORD = 1;     // how two pickers are on one record or show
export const PERMANENT = 2, FULL = 1, UNKNOWN = 0;  // PickiPedia:Release_Types
const BOOST = [ 0.35, 0.7, 1 ];                     // how much music counts toward closeness, by how free it is
const LOOSE = 0.1;                                  // a same-record tie, beside a played-with one

export const TIER_NAME = [ 'not known to be DRM-free', 'Full Release', 'Permanent Release' ];

/* ------------------------------------------------------------------------------------------------------------
 * The graph, indexed
 * --------------------------------------------------------------------------------------------------------- */

export function build( g ) {
	const people = g.people.map( ( [ name, page, inst ], id ) => ( { id, name, page: !!page, inst: inst || '' } ) );
	const music = g.music.map( ( [ key, kind, artist, date, title, tier, source, page ], id ) =>
		( { id, key, kind, artist, date, title, tier, source, page: page || '', cast: ( g.cast && g.cast[ id ] ) || [] } ) );
	const adj = people.map( () => new Map() );
	for ( const [ a, b, evs ] of g.ties ) {
		const tie = summarize( a, b, evs.map( ( [ m, how, w, songs ] ) => ( { m, how, w, songs: songs || [] } ) ), music );
		adj[ a ].set( b, tie );
		adj[ b ].set( a, tie );
	}
	const byName = new Map( people.map( ( p ) => [ p.name.toLowerCase(), p.id ] ) );
	return { people, music, adj, byName, featured: g.featured || [], month: g.month || '', songs: g.songs || {},
		built: g.built || '' };
}

/**
 * Roughly when, for putting the newest first and for nothing else: sources write dates their own ways (a day,
 * a year, "3 April, 2024", and cryptograss's shows by Ethereum block). Never shown; -Infinity when it can't tell.
 */
export function roughly( date ) {
	const s = String( date || '' ).trim();
	let m = /^block (\d+)$/.exec( s );
	if ( m ) {
		const n = +m[ 1 ];                               // 12 seconds a block since the merge; about 13.3 before it
		return n >= 15537394 ? 1663224179 + ( n - 15537394 ) * 12 : 1438269973 + n * 13.3;
	}
	const t = Date.parse( /^\d{4}$/.test( s ) ? s + '-01-01' : s );
	if ( !isNaN( t ) ) {
		return t / 1000;
	}
	m = /\b(1[89]|20)\d\d\b/.exec( s );
	return m ? Date.parse( m[ 0 ] + '-01-01' ) / 1000 : -Infinity;
}

function byProminence( music ) {
	return ( x, y ) => ( ( y.how >= STAGE ) - ( x.how >= STAGE ) ) ||
		( music[ y.m ].tier - music[ x.m ].tier ) ||
		( roughly( music[ y.m ].date ) - roughly( music[ x.m ].date ) || 0 ) ||
		( x.m - y.m );
}

/** Everything two pickers share, added up. */
export function summarize( a, b, ev, music ) {
	ev.sort( byProminence( music ) );
	const t = { a, b, ev, w: 0, loose: 0, eff: 0, times: 0, shows: 0, records: 0, tracks: 0, looseRecords: 0, tier: UNKNOWN,
		played: false };
	let bestLoose = UNKNOWN;
	for ( const e of ev ) {
		const m = music[ e.m ];
		if ( e.how >= STAGE ) {
			t.w += e.w;
			t.eff += e.w * BOOST[ m.tier ];
			t.times++;
			if ( m.kind === 'show' ) {
				t.shows++;
			} else {
				t.records++;
				t.tracks += e.songs.length;
			}
			t.tier = Math.max( t.tier, m.tier );
		} else {
			t.loose += e.w;
			t.eff += LOOSE * e.w * BOOST[ m.tier ];
			t.looseRecords++;
			bestLoose = Math.max( bestLoose, m.tier );
		}
	}
	t.played = t.times > 0;
	if ( !t.played ) {
		t.tier = bestLoose;
	}
	return t;
}

/**
 * How loud a tie is, wherever it's decided who gets named. Playing together comes before only sharing a record;
 * then the freest music the two share, because a Permanent Release is always more prominent than anything else
 * (Justin, #connectome, 13 Nov 2026), however much there is of the rest; then how much of it, by eff.
 */
export function loudness( tie ) {
	return ( tie.played ? 2e6 : 0 ) + tie.tier * 4e5 + Math.min( tie.eff, 3e5 );
}

export function find( G, name ) {
	const id = G.byName.get( String( name || '' ).trim().toLowerCase() );
	return id === undefined ? null : id;
}

/** The pickers someone has played with (or, with loose, also shared a record with), the loudest first. */
export function company( G, id, loose = false ) {
	const out = [];
	for ( const [ o, tie ] of G.adj[ id ] ) {
		if ( tie.played || loose ) {
			out.push( { id: o, tie } );
		}
	}
	return out.sort( ( x, y ) => ( loudness( y.tie ) - loudness( x.tie ) ) || ( y.tie.w - x.tie.w ) ||
		G.people[ x.id ].name.localeCompare( G.people[ y.id ].name ) );
}

/**
 * Who both have played with, other than each other: the two-hop routes between them. A route is as free as its
 * less free leg, and as strong as its weaker one. Those who played with both come first, and one who only shares
 * a record with either comes after; then the freest routes, so one that's Permanent on both legs is never passed
 * over for one with a CD in it; then the strongest; and of two as strong, the one closer on its other leg.
 */
export function mutuals( G, a, b ) {
	const out = [];
	const [ small, big ] = G.adj[ a ].size <= G.adj[ b ].size ? [ a, b ] : [ b, a ];
	for ( const [ c, t1 ] of G.adj[ small ] ) {
		if ( c === a || c === b ) {
			continue;
		}
		const t2 = G.adj[ big ].get( c );
		if ( !t2 ) {
			continue;
		}
		const [ ta, tb ] = small === a ? [ t1, t2 ] : [ t2, t1 ];
		out.push( { id: c, ta, tb, played: ta.played && tb.played, legs: ( ta.played ? 1 : 0 ) + ( tb.played ? 1 : 0 ),
			eff: Math.min( ta.eff, tb.eff ), both: ta.eff + tb.eff, w: Math.min( ta.w || LOOSE * ta.loose, tb.w || LOOSE * tb.loose ),
			tier: Math.min( ta.tier, tb.tier ) } );
	}
	return out.sort( ( x, y ) => ( y.legs - x.legs ) || ( y.tier - x.tier ) || ( y.eff - x.eff ) || ( y.both - x.both ) ||
		( y.w - x.w ) || G.people[ x.id ].name.localeCompare( G.people[ y.id ].name ) );
}

/** Hops from one picker to every other; -1 where there's no way. A same-record tie counts as a hop. */
export function distances( G, src ) {
	const dist = new Int32Array( G.people.length ).fill( -1 );
	let frontier = [ src ];
	dist[ src ] = 0;
	while ( frontier.length ) {
		const next = [];
		for ( const u of frontier ) {
			for ( const v of G.adj[ u ].keys() ) {
				if ( dist[ v ] < 0 ) {
					dist[ v ] = dist[ u ] + 1;
					next.push( v );
				}
			}
		}
		frontier = next;
	}
	return dist;
}

/**
 * The shortest routes between two pickers who are three or more hops apart: up to `want` chains, each the
 * loudest left (a chain is as loud as its quietest hop: see loudness), and the other pickers who sit on a
 * shortest route.
 * Returns { hops, chains: [[a, .., b]], others: [[ids at hop 1], .., [ids at hop L-1]] }, or null with no way.
 */
export function routes( G, a, b, want = 3 ) {
	const da = distances( G, a );
	const L = da[ b ];
	if ( L < 0 ) {
		return null;
	}
	const db = distances( G, b );
	const on = [];                                      // on[i]: who sits i hops from a on some shortest route
	for ( let i = 0; i <= L; i++ ) {
		on.push( [] );
	}
	for ( let v = 0; v < G.people.length; v++ ) {
		if ( da[ v ] >= 0 && db[ v ] >= 0 && da[ v ] + db[ v ] === L ) {
			on[ da[ v ] ].push( v );
		}
	}
	const chains = [];
	const used = new Set();
	for ( let n = 0; n < want; n++ ) {
		// The loudest chain through pickers not yet used: widest-path, level by level.
		const best = new Map( [ [ a, { s: Infinity, prev: null } ] ] );
		for ( let i = 1; i <= L; i++ ) {
			for ( const v of on[ i ] ) {
				if ( used.has( v ) ) {
					continue;
				}
				let pick = null;
				for ( const u of on[ i - 1 ] ) {
					const from = best.get( u );
					const tie = G.adj[ u ].get( v );
					if ( !from || !tie ) {
						continue;
					}
					const s = Math.min( from.s, loudness( tie ) );
					if ( !pick || s > pick.s ) {
						pick = { s, prev: u };
					}
				}
				if ( pick ) {
					best.set( v, pick );
				}
			}
		}
		if ( !best.has( b ) ) {
			break;
		}
		const chain = [];
		for ( let v = b; v !== null; v = best.get( v ).prev ) {
			chain.unshift( v );
		}
		chains.push( chain );
		chain.slice( 1, -1 ).forEach( ( v ) => used.add( v ) );
		if ( L === 1 ) {
			break;
		}
	}
	const others = on.slice( 1, L ).map( ( level ) => level.filter( ( v ) => !used.has( v ) ) );
	return { hops: L, chains, others };
}

/** The Bacon number: hops from one picker to another, or -1. */
export function hops( G, a, b ) {
	return distances( G, a )[ b ];
}

/* ------------------------------------------------------------------------------------------------------------
 * Saying it
 * --------------------------------------------------------------------------------------------------------- */

const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];

/** A date as the source wrote it, made easier to read where its shape is certain. */
export function when( date ) {
	const s = String( date || '' ).trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec( s );
	if ( m && +m[ 2 ] >= 1 && +m[ 2 ] <= 12 ) {
		return `${ +m[ 3 ] } ${ MONTHS[ +m[ 2 ] - 1 ] } ${ m[ 1 ] }`;
	}
	m = /^block (\d+)$/.exec( s );
	if ( m ) {
		return 'block ' + m[ 1 ].replace( /\B(?=(\d{3})+(?!\d))/g, ',' );
	}
	return s;
}

export function plural( n, one, many ) {
	return `${ n } ${ n === 1 ? one : ( many || one + 's' ) }`;
}

/** "3 shows and 2 records together", "3 tracks on 2 records together", "on 1 record apart: ...". */
export function together( tie ) {
	if ( !tie ) {
		return '';
	}
	if ( !tie.played ) {
		return 'on ' + plural( tie.looseRecords, 'record' ) + ' apart: no source puts them on the same track';
	}
	const parts = [];
	if ( tie.shows ) {
		parts.push( plural( tie.shows, 'show' ) );
	}
	if ( tie.records ) {
		parts.push( ( tie.tracks > tie.records ? plural( tie.tracks, 'track' ) + ' on ' : '' ) + plural( tie.records, 'record' ) );
	}
	return parts.join( ' and ' ) + ' together';
}

/** The same, short: "3 shows", "2 records", "same record". */
export function times( tie ) {
	if ( !tie ) {
		return '';
	}
	if ( !tie.played ) {
		return 'same record';
	}
	const parts = [];
	if ( tie.shows ) {
		parts.push( plural( tie.shows, 'show' ) );
	}
	if ( tie.records ) {
		parts.push( plural( tie.records, 'record' ) );
	}
	return parts.join( ', ' );
}

/** What to call one record or show two pickers share: its short name, a briefer one for a tight spot, and the whole of it. */
export function naming( G, e ) {
	const m = G.music[ e.m ];
	if ( m.kind === 'show' ) {
		const who = m.artist || m.title;
		const day = when( m.date );
		const short = m.artist ? [ who, day ].filter( Boolean ).join( ' · ' ) : who;
		return { glyph: 'show', short, brief: who, long: [ m.title && m.title !== who ? m.title : who, m.artist ? '' : day ].filter( Boolean ).join( ', ' ),
			songs: e.songs };
	}
	const record = [ m.artist, m.title ].filter( Boolean ).join( ' – ' ) + ( m.date ? ` (${ when( m.date ) })` : '' );
	if ( e.how === TRACK && e.songs.length ) {
		const more = e.songs.length - 1;
		return { glyph: 'track', short: e.songs[ 0 ] + ( more ? ` +${ more }` : '' ), brief: e.songs[ 0 ], long: record, songs: e.songs };
	}
	return { glyph: 'record', short: m.title || m.key, brief: m.title || m.key, long: record, songs: e.songs };
}

export function clip( s, n ) {
	s = String( s );
	return s.length <= n ? s : s.slice( 0, Math.max( 1, n - 1 ) ).trimEnd() + '…';
}

/* ------------------------------------------------------------------------------------------------------------
 * Where things go. All in the frame's own pixels; nothing moves once it's placed.
 * --------------------------------------------------------------------------------------------------------- */

/**
 * Two pickers and what lies between them: a on the left, b on the right, the direct tie along the middle,
 * and whoever both have played with in a column between, the closest nearest the middle.
 *
 * opts: W, H, direct (is there a tie along the middle), named, dots (how many of each are wanted),
 * la, lb (half the width of each end's name, so neither runs off the frame).
 * Returns { A, B, named: [{x, y, below}], dots: [{x, y}], band: {x1, x2, y} }; fewer places than asked
 * when the frame is too small for them.
 */
function ends( W, H, la, lb ) {
	const cy = Math.round( H / 2 );
	const inset = Math.max( 76, Math.min( W * 0.13, 170 ) );
	return { A: { x: Math.round( Math.max( inset, ( la || 0 ) + 12 ) ), y: cy },
		B: { x: Math.round( W - Math.max( inset, ( lb || 0 ) + 12 ) ), y: cy }, cy };
}

export function bridge( { W, H, direct, named, dots, la, lb } ) {
	const { A, B, cy } = ends( W, H, la, lb );
	const mid = Math.round( W / 2 );
	const room = cy - 34;                                // above the middle line, and below it
	const step = Math.max( 64, Math.min( 108, ( room - 28 ) / 3 ) );   // 28: a name under the lowest picker
	const perSide = Math.max( 1, Math.floor( ( room - 28 ) / step + 0.001 ) );
	const places = [];
	if ( !direct ) {
		places.push( { x: mid, y: cy, below: true } );
	}
	for ( let k = 1; k <= perSide; k++ ) {
		places.push( { x: mid, y: Math.round( cy - k * step ), below: false } );
		places.push( { x: mid, y: Math.round( cy + k * step ), below: true } );
	}
	const namedPlaces = places.slice( 0, Math.max( 0, named ) );

	// The rest: small rows of beads in the same column, in the gaps between the names, nearest the middle first,
	// as many above the middle line as below it.
	const rows = [];
	for ( let k = 0; k < perSide; k++ ) {
		if ( k === 0 ) {
			rows.push( cy - step / 2, cy + step / 2 + ( direct ? 0 : 9 ) );
		} else if ( step - 52 >= 18 ) {
			rows.push( cy - ( k + 0.5 ) * step - 10, cy + ( k + 0.5 ) * step + 10 );
		}
	}
	const PER_ROW = 7;
	const count = rows.map( () => 0 );
	let left = Math.max( 0, Math.min( dots, rows.length * PER_ROW ) );
	for ( let pair = 0; pair < rows.length && left > 0; pair += 2 ) {
		const here = Math.min( left, 2 * PER_ROW );
		count[ pair ] = Math.ceil( here / 2 );
		count[ pair + 1 ] = Math.floor( here / 2 );
		left -= here;
	}
	const dotPlaces = [];
	for ( let i = 0; i < PER_ROW; i++ ) {                 // across the rows, so the closest sit nearest the middle
		rows.forEach( ( y, r ) => {
			if ( i < count[ r ] ) {
				dotPlaces.push( { x: Math.round( mid + ( i - ( count[ r ] - 1 ) / 2 ) * 18 ), y: Math.round( y ), row: r } );
			}
		} );
	}
	dotPlaces.sort( ( p, q ) => ( ( p.row >> 1 ) - ( q.row >> 1 ) ) );
	return { A, B, named: namedPlaces, dots: dotPlaces, band: { x1: A.x, x2: B.x, y: cy } };
}

/**
 * Chains of three hops or more: a on the left, b on the right, each chain a row, the strongest in the middle.
 * levels is how many hops; chains how many rows. Returns { A, B, at( chain, level ) -> {x, y} }.
 */
export function ladder( { W, H, hops: L, chains, la, lb } ) {
	const { A, B, cy } = ends( W, H, la, lb );
	const step = Math.max( 70, Math.min( 120, ( H - 120 ) / Math.max( 1, chains ) ) );
	const rowY = ( c ) => Math.round( cy + ( c === 0 ? 0 : ( c % 2 ? -1 : 1 ) * Math.ceil( c / 2 ) * step ) );
	return { A, B, at: ( c, level ) => ( { x: Math.round( A.x + ( B.x - A.x ) * level / L ), y: rowY( c ) } ) };
}

/**
 * One picker and their company: the picker in the middle, the closest around them on an oval that starts a
 * quarter step past noon (nobody sits at twelve or at six, as on the cards), and the rest in two wider ovals.
 * Returns { C, named: [{x, y, below, angle}], dots: [{x, y}] }.
 */
export function ego( { W, H, named, dots } ) {
	const C = { x: Math.round( W / 2 ), y: Math.round( H / 2 ) };
	const ry = Math.max( 84, Math.min( H * 0.29, 230 ) );
	const rx = Math.max( 110, Math.min( W * 0.3, ry * 1.9 ) );
	const out = { C, named: [], dots: [], rx, ry };
	const n = Math.max( 0, named );
	for ( let i = 0; i < n; i++ ) {
		const deg = -90 + 360 / n / 4 + ( 360 / n ) * i;
		const rad = deg * Math.PI / 180;
		const y = C.y + ry * Math.sin( rad );
		out.named.push( { x: Math.round( C.x + rx * Math.cos( rad ) ), y: Math.round( y ), below: y > C.y + 1, angle: deg } );
	}
	// The rest sit on two wider ovals, clear of the names above and below each named picker, spread evenly
	// round the first before the second takes any.
	const per = n * 3 || 12;
	let left = Math.max( 0, dots );
	[ [ 1.36, 1.42 ], [ 1.58, 1.68 ] ].filter( ( [ , fy ] ) => ry * fy < H / 2 - 10 ).forEach( ( [ fx, fy ], ring ) => {
		const free = [];
		for ( let i = 0; i < per; i++ ) {
			const rad = ( -90 + ( 360 / per ) * ( i + ( ring ? 1 : 0.5 ) ) ) * Math.PI / 180;
			const x = C.x + Math.min( rx * fx, W / 2 - 16 ) * Math.cos( rad ), y = C.y + ry * fy * Math.sin( rad );
			const crowded = out.named.some( ( p ) => Math.abs( x - p.x ) < 74 &&
				( p.below ? ( y > p.y && y < p.y + 64 ) : ( y < p.y && y > p.y - 64 ) ) );
			if ( !crowded ) {
				free.push( { x: Math.round( x ), y: Math.round( y ) } );
			}
		}
		const take = Math.min( left, free.length );
		for ( let i = 0; i < take; i++ ) {
			out.dots.push( free[ Math.floor( i * free.length / take ) ] );
		}
		left -= take;
	} );
	return out;
}
