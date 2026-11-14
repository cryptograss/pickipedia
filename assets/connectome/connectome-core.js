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
 *
 * Marks and what they stand for. A view draws marks: dots, pills, lines. A reader asks about what a mark
 * stands for, whatever its shape, and that is one of three things: a picker, a piece of music (a track, a
 * record, a show), or a tie (all that two pickers share). In this graph and on the cards a dot is a picker,
 * a pill is music and a line is a tie. In Rabbithole's "Your rabbithole" it is the other way about: a dot is
 * a track and a line is the picker followed from one track to the next. So nothing here, and nothing in
 * connectome.js's what(), is decided by a mark's shape: each is asked what it stands for, and the answer has
 * the same parts for all three (what it is, what the sources say, the ways further in, where to find out
 * more), which a pointer gets as a note and a finger as a sheet (Justin, #connectome, 13 Nov 2026).
 *
 * Inside out. A click on a picker goes to that picker, here, and a click on a piece of music turns the graph
 * inside out: the music becomes the circles and the pickers the lines between them (Justin, #connectome,
 * 13 Nov 2026, 23:05Z). So the same store is read both ways: adj is who a picker has played with, by the
 * music they share; pieces and on are what a piece of music leads to, by the pickers on both.
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
	return Object.assign( { people, music, adj, byName, featured: g.featured || [], month: g.month || '', songs: g.songs || {},
		plays: g.plays || {}, built: g.built || '' }, pieces( g, people, music ) );
}

/**
 * The pieces: what a circle is when the graph is turned inside out. A show; a record; and, where the sources
 * say who is on which track of a record, each such track. A record or a show is its own number in music; the
 * tracks come after. A picker's pieces (on) are the shows they're on, the tracks they're on, and a record whole
 * only where no source says which of its tracks they're on.
 *
 * One night is one piece, however many tapers taped it: two tapes of the same band on the same date are folded
 * into the first (whole says which piece a record or a show is; also, the other tapes of a night).
 */
function pieces( g, people, music ) {
	const all = music.map( ( m ) => ( { id: m.id, kind: m.kind === 'show' ? 'show' : 'record', m: m.id, song: '', also: [],
		cast: new Set( m.cast.map( ( c ) => c[ 0 ] ) ) } ) );
	const whole = music.map( ( m ) => m.id ), nights = new Map();
	for ( const m of music ) {
		const night = m.kind === 'show' && m.artist && m.date ? m.artist + '\n' + m.date : '';
		if ( night && nights.has( night ) ) {
			whole[ m.id ] = nights.get( night );
			all[ whole[ m.id ] ].also.push( m.id );
			all[ m.id ].cast.forEach( ( who ) => all[ whole[ m.id ] ].cast.add( who ) );
			all[ m.id ].cast = new Set();
		} else if ( night ) {
			nights.set( night, m.id );
		}
	}
	const trackOf = new Map();
	for ( const [ a, b, evs ] of g.ties ) {
		for ( const [ m, how, , songs ] of evs ) {
			all[ whole[ m ] ].cast.add( a ).add( b );
			if ( how !== TRACK || music[ m ].kind === 'show' ) {
				continue;                                      // a show is one piece, whoever sat in on which song
			}
			for ( const song of songs || [] ) {
				const key = m + '\n' + song;
				if ( !trackOf.has( key ) ) {
					trackOf.set( key, all.length );
					all.push( { id: all.length, kind: 'track', m, song, cast: new Set() } );
				}
				all[ trackOf.get( key ) ].cast.add( a ).add( b );
			}
		}
	}
	const on = people.map( () => [] );
	const tracked = new Set();
	for ( const p of all ) {
		p.cast = [ ...p.cast ].sort( ( x, y ) => x - y );
		if ( p.kind === 'track' ) {
			for ( const who of p.cast ) {
				on[ who ].push( p.id );
				tracked.add( who + ':' + p.m );
			}
		}
	}
	for ( const p of all ) {
		if ( p.kind !== 'track' ) {
			for ( const who of p.cast ) {
				if ( !tracked.has( who + ':' + p.m ) ) {
					on[ who ].push( p.id );
				}
			}
		}
	}
	return { pieces: all, trackOf, whole, on };
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
		// A taper's tape is known by the band and the night. Any other show has a name of its own, and what its
		// source calls the artist is where it was.
		const tape = m.key.indexOf( 'lma:' ) === 0 && !!m.artist;
		const who = tape ? m.artist : ( m.title || m.artist );
		const day = when( m.date );
		return { glyph: 'show', short: tape ? [ who, day ].filter( Boolean ).join( ' · ' ) : who, brief: who,
			long: tape ? ( m.title && m.title !== who ? m.title : who ) : [ m.artist !== who ? m.artist : '', day ].filter( Boolean ).join( ', ' ),
			songs: e.songs };
	}
	const record = [ m.artist, m.title ].filter( Boolean ).join( ' – ' ) + ( m.date ? ` (${ when( m.date ) })` : '' );
	if ( e.how === TRACK && e.songs.length ) {
		const more = e.songs.length - 1;
		return { glyph: 'track', short: e.songs[ 0 ] + ( more ? ` +${ more }` : '' ), brief: e.songs[ 0 ], long: record, songs: e.songs };
	}
	return { glyph: 'record', short: m.title || m.key, brief: m.title || m.key, long: record, songs: e.songs };
}

/**
 * Where a song on a record plays in Rabbithole, as a path on the wiki; '' when it doesn't. Only a record
 * cryptograss cut itself has its tracks there: the same song on a taper's tape is another recording.
 */
export function playOf( G, m, song ) {
	const cid = G.plays[ song ];
	return cid && m && m.kind === 'record' && m.key.indexOf( 'arthel:' ) === 0 ? '/rabbithole/?track=' + encodeURIComponent( cid ) : '';
}

/* ------------------------------------------------------------------------------------------------------------
 * Inside out: the music as the circles, the pickers as the lines
 * --------------------------------------------------------------------------------------------------------- */

/** The piece one entry of a tie stands for: the track, where the sources name one (the first of several); else the record or the show. */
export function pieceFor( G, e ) {
	const t = e.how === TRACK && e.songs.length ? trackOn( G, e.m, e.songs[ 0 ] ) : undefined;
	return t === undefined ? G.whole[ e.m ] : t;
}

/** A record's track by its song, as a piece; undefined where no source says who's on it. */
export function trackOn( G, m, song ) {
	return G.trackOf.get( m + '\n' + song );
}

/** A piece by what an address calls it: its record's or show's key, and for a track the song. null when there's none. */
export function findPiece( G, key, song ) {
	const m = G.music.findIndex( ( x ) => x.key === key );
	if ( m < 0 ) {
		return null;
	}
	const t = song ? trackOn( G, m, song ) : undefined;
	return t === undefined ? G.whole[ m ] : t;
}

/** What to call a piece: its name, a line to go under it, and the whole of it. */
export function called( G, piece ) {
	const m = G.music[ piece.m ];
	const n = naming( G, { m: piece.m, how: piece.kind === 'show' ? STAGE : RECORD, songs: [] } );
	if ( piece.kind === 'track' ) {
		return { glyph: 'track', name: piece.song, sub: m.title || m.key, long: n.long };
	}
	if ( piece.kind === 'show' ) {
		return { glyph: 'show', name: n.brief, sub: when( m.date ), long: n.long };
	}
	return { glyph: 'record', name: n.brief, sub: [ m.artist, when( m.date ) ].filter( Boolean ).join( ' · ' ), long: n.long };
}

/**
 * Where a piece's pickers lead: the other pieces they're on. Inside out, a line is the pickers two pieces share,
 * and the nearest piece is the least worth naming: the same band the next night shares everyone and says
 * nothing. What's named is the different ways on, so each named piece is reached by a different set of this
 * one's pickers. Each picker in turn (those in `hand` first: the ones the reader came by) takes the loudest
 * piece they lead to that says something new: the freest first, as everywhere; then the one the fewest others
 * here are on; then the newest. Once round, for those no line has named yet; then round again until `want` are
 * named or nothing new is left. `keep` are pieces that stay whatever their rank: where the reader came from.
 *
 * A record's own tracks aren't somewhere it leads; another track of the same record is somewhere a track leads.
 *
 * Returns { cast, named: [{ id, via }], rest: [{ id, via }] }: cast, this piece's pickers in the order they were
 * asked; via, the pickers on both, the one who chose it first.
 */
export function leads( G, id, want = 6, hand = [], keep = [] ) {
	const me = G.pieces[ id ];
	const first = new Map( hand.map( ( p, i ) => [ p, i ] ) );
	const cast = me.cast.slice().sort( ( x, y ) => ( first.has( y ) - first.has( x ) ) || ( first.get( x ) - first.get( y ) || 0 ) ||
		( G.on[ y ].length - G.on[ x ].length ) || G.people[ x ].name.localeCompare( G.people[ y ].name ) );
	const via = new Map();
	for ( const p of cast ) {
		for ( const x of G.on[ p ] ) {
			if ( x === id || ( me.kind !== 'track' && G.pieces[ x ].m === me.m ) ) {
				continue;
			}
			if ( !via.has( x ) ) {
				via.set( x, [] );
			}
			via.get( x ).push( p );
		}
	}
	const tier = ( x ) => G.music[ G.pieces[ x ].m ].tier, day = ( x ) => roughly( G.music[ G.pieces[ x ].m ].date );
	const newest = ( x, y ) => ( day( y ) - day( x ) || 0 ) || ( x - y );
	const ways = new Map( cast.map( ( p ) => [ p, [] ] ) );
	for ( const [ x, ps ] of via ) {
		ps.forEach( ( p ) => ways.get( p ).push( x ) );
	}
	for ( const list of ways.values() ) {
		list.sort( ( x, y ) => ( tier( y ) - tier( x ) ) || ( via.get( x ).length - via.get( y ).length ) || newest( x, y ) );
	}
	const named = [], taken = new Set(), said = new Set(), covered = new Set();
	const take = ( x, p ) => {
		const ps = via.get( x );
		named.push( { id: x, via: p === undefined ? ps.slice() : [ p, ...ps.filter( ( q ) => q !== p ) ] } );
		taken.add( x );
		said.add( ps.join() );
		ps.forEach( ( q ) => covered.add( q ) );
	};
	for ( const x of keep ) {
		if ( via.has( x ) && !taken.has( x ) ) {
			take( x, hand.find( ( p ) => via.get( x ).includes( p ) ) );
		}
	}
	for ( let round = 0; named.length < want; round++ ) {
		let any = false;
		for ( const p of cast ) {
			if ( named.length >= want ) {
				break;
			}
			if ( round === 0 && covered.has( p ) ) {
				continue;
			}
			const x = ways.get( p ).find( ( y ) => !taken.has( y ) && !said.has( via.get( y ).join() ) );
			if ( x !== undefined ) {
				take( x, p );
				any = true;
			}
		}
		if ( !any && round > 0 ) {
			break;
		}
	}
	const rest = [ ...via.keys() ].filter( ( x ) => !taken.has( x ) )
		.sort( ( x, y ) => ( tier( y ) - tier( x ) ) || ( via.get( y ).length - via.get( x ).length ) || newest( x, y ) )
		.map( ( x ) => ( { id: x, via: via.get( x ) } ) );
	return { cast, named, rest };
}

/**
 * A picker's company with those the reader came by first, whatever their rank: the connections that were in
 * sight stay in sight (Justin, #connectome, 13 Nov 2026). One of them who only shares a record with this picker
 * stays too. comp is company()'s; returns the same shape.
 */
export function keeping( G, id, comp, keep = [] ) {
	const first = [];
	for ( const k of keep ) {
		const tie = G.adj[ id ].get( k );
		if ( tie && k !== id && !first.some( ( c ) => c.id === k ) ) {
			first.push( comp.find( ( c ) => c.id === k ) || { id: k, tie } );
		}
	}
	return first.concat( comp.filter( ( c ) => !first.some( ( f ) => f.id === c.id ) ) );
}

/**
 * Who sits where when the view changes. wants[i] is where the i-th would be had the whole picture only slid
 * (null for one who wasn't in it). Each of those takes the free place nearest that, the first in line choosing
 * first; the newcomers fill what's left, in order. Returns each one's place, as a number in places (-1 past
 * the last place).
 */
export function seat( places, wants ) {
	const free = places.map( ( _, i ) => i );
	const out = wants.map( () => -1 );
	const far = ( p, w ) => ( p.x - w.x ) * ( p.x - w.x ) + ( p.y - w.y ) * ( p.y - w.y );
	wants.forEach( ( w, i ) => {
		if ( !w || !free.length ) {
			return;
		}
		let best = 0;
		for ( let k = 1; k < free.length; k++ ) {
			if ( far( places[ free[ k ] ], w ) < far( places[ free[ best ] ], w ) ) {
				best = k;
			}
		}
		out[ i ] = free.splice( best, 1 )[ 0 ];
	} );
	return out.map( ( at ) => ( at < 0 && free.length ? free.shift() : at ) );
}

/**
 * Where a name tag sits on the line from one circle (a, of radius ra) to another, and how wide it may be there
 * without lying over either: as near the middle of the line as leaves it the most room. A line that runs up
 * and down has room for any name; a short one that runs across may have none, and the caller puts the tag
 * elsewhere. Returns { x, y, room }.
 */
export function tagAt( a, b, ra, rb, most = 150, high = 23 ) {
	let best = null;
	for ( const f of [ 0.5, 0.55, 0.45, 0.6, 0.4, 0.65, 0.35 ] ) {
		const x = a.x + ( b.x - a.x ) * f, y = a.y + ( b.y - a.y ) * f;
		const clear = ( c, r ) => ( Math.abs( y - c.y ) >= r + high / 2 + 2 ? Infinity : Math.abs( x - c.x ) - r - 3 );
		const room = Math.max( 0, Math.min( most, 2 * Math.min( clear( a, ra ), clear( b, rb ) ) ) );
		if ( !best || room > best.room + 0.5 ) {
			best = { x, y, room };
		}
	}
	return best;
}

/**
 * How far to move something `half` wide either side of x so it stays between lo and hi: 0 when it fits where
 * it is, and to the middle of the room when the room is too small for it.
 */
export function nudge( x, half, lo, hi ) {
	if ( 2 * half >= hi - lo ) {
		return ( lo + hi ) / 2 - x;
	}
	return Math.max( lo + half, Math.min( hi - half, x ) ) - x;
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
 * la, lb (half the width of each end's name, so neither runs off the frame); gap and perRow, how far apart
 * the beads sit and how many to a row (18 and 7; wider and fewer where a finger has to tell them apart).
 * Returns { A, B, named: [{x, y, below}], dots: [{x, y}], band: {x1, x2, y} }; fewer places than asked
 * when the frame is too small for them.
 */
function ends( W, H, la, lb ) {
	const cy = Math.round( H / 2 );
	const inset = Math.max( 76, Math.min( W * 0.13, 170 ) );
	return { A: { x: Math.round( Math.max( inset, ( la || 0 ) + 12 ) ), y: cy },
		B: { x: Math.round( W - Math.max( inset, ( lb || 0 ) + 12 ) ), y: cy }, cy };
}

export function bridge( { W, H, direct, named, dots, la, lb, gap = 18, perRow = 7 } ) {
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
	const PER_ROW = Math.max( 1, perRow );
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
				dotPlaces.push( { x: Math.round( mid + ( i - ( count[ r ] - 1 ) / 2 ) * gap ), y: Math.round( y ), row: r } );
			}
		} );
	}
	dotPlaces.sort( ( p, q ) => ( ( p.row >> 1 ) - ( q.row >> 1 ) ) );
	return { A, B, named: namedPlaces, dots: dotPlaces, band: { x1: A.x, x2: B.x, y: cy } };
}

/**
 * Chains of three hops or more: a on the left, b on the right, each chain a row, the strongest in the middle.
 * levels is how many hops; chains how many rows. Returns { A, B, at( chain, level ) -> {x, y} }.
 *
 * In a narrow upright frame (a phone) a hop across is too short to say anything in, so the ladder stands up
 * (upright: true): a at the top, b at the bottom, the first chain straight down between them with room beside
 * it for names, and the others in columns to its left.
 */
export function ladder( { W, H, hops: L, chains, la, lb } ) {
	if ( W < 560 && H > W ) {
		const x0 = Math.round( Math.min( W / 2, Math.max( 150, W * 0.42 ) ) ), top = 52, bottom = H - 52;
		const colX = ( c ) => Math.round( Math.max( 22, x0 - c * Math.min( 64, ( x0 - 22 ) / Math.max( 1, chains - 1 ) ) ) );
		return { upright: true, A: { x: x0, y: top }, B: { x: x0, y: bottom },
			at: ( c, level ) => ( { x: colX( c ), y: Math.round( top + ( bottom - top ) * level / L ) } ) };
	}
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
