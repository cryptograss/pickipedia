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
 *
 * The web. Round one picker, their company is a star, and a star says one picker and their contacts. Where
 * there's room, the lines among the company are drawn too, thin and behind: who of them have played with each
 * other. Each is the far leg of a two-hop way round, and together they say that this is a community (Justin,
 * #connectome, 14 Nov 2026, 00:59Z). Inside out it is the same web, of pieces: which of them share pickers.
 *
 * A step further. With more room still, each of the company has their own way on drawn straight out from them,
 * directly away from the picker in the middle: who they have played with that the one in the middle has not,
 * a couple each, one of them named (Justin, #connectome, 14 Nov 2026, 02:18Z). Then the rest of the company are
 * small dots on thin lines from the middle, as on the cards, so every dot in sight says how it is reached: a line
 * from the middle is one hop, a line from one of the company is two.
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
	const people = g.people.map( ( [ name, page, inst, img ], id ) => ( { id, name, page: !!page, inst: inst || '', img: img || '' } ) );
	const music = g.music.map( ( [ key, kind, artist, date, title, tier, source, page, art ], id ) =>
		( { id, key, kind, artist, date, title, tier, source, page: page || '', art: art || '', cast: ( g.cast && g.cast[ id ] ) || [] } ) );
	const adj = people.map( () => new Map() );
	for ( const [ a, b, evs ] of g.ties ) {
		const tie = summarize( a, b, evs.map( ( [ m, how, w, songs ] ) => ( { m, how, w, songs: songs || [] } ) ), music );
		adj[ a ].set( b, tie );
		adj[ b ].set( a, tie );
	}
	const byName = new Map( people.map( ( p ) => [ p.name.toLowerCase(), p.id ] ) );
	return Object.assign( { people, music, adj, byName, featured: g.featured || [], month: g.month || '', songs: g.songs || {},
		songcast: g.songcast || {}, plays: g.plays || {}, built: g.built || '',
		pages: g.pages || {} }, makers( g, music, byName ), pieces( g, people, music ) );   // pages: a page's own graph's pickers, and no tie
}

/**
 * Whose each record is, and who wrote each song (Justin, #connectome, 15 Nov 2026, 07:29Z: at the other end of a
 * song's line, its recording artist first, then its writer). made, for each record: the pickers who made it,
 * graph.json's own list (each picker its artist credit names, as the wiki knows them) or, from a file without
 * one, each name in the credit that is a picker's here; and a cut's {{Record|artist=}}. wrote: a record and a
 * song (songKey) -> whoever the Song page says wrote it, of those on the cut.
 */
function makers( g, music, byName ) {
	const made = music.map( ( m, i ) => ( m.kind === 'show' ? [] : ( g.made ? ( g.made[ i ] || [] ).slice() : credited( m.artist, byName ) ) ) );
	const wrote = new Map();
	for ( const c of Object.values( g.songcast || {} ) ) {
		for ( const m of c.on || [] ) {
			if ( made[ m ] && typeof c.artist === 'number' && c.artist >= 0 && !made[ m ].includes( c.artist ) ) {
				made[ m ].push( c.artist );
			}
			const k = m + '\n' + songKey( c.song );
			wrote.set( k, [ ...new Set( ( wrote.get( k ) || [] ).concat( ( c.writers || [] ).filter( ( w ) => w >= 0 ) ) ) ] );
		}
	}
	return { made, wrote };
}

/** Where an artist credit names several: "Jerry Garcia, David Grisman", "Johnny Campbell & The Bluegrass Drifters"; not "Emory Gordy, Jr.". As connectome_graph.py's. */
const CREDIT_SPLIT = /\s*(?:,(?!\s*(?:jr|sr)\b)|&|\/|\band\b)\s*/i;

/** The pickers an artist credit names, as connectome_graph.py's credited(): the whole credit, then each name in it, that is a picker's. */
function credited( artist, byName ) {
	const s = String( artist || '' ).trim();
	const ids = ( s ? [ s, ...s.split( CREDIT_SPLIT ) ] : [] ).map( ( x ) => byName.get( x.trim().toLowerCase() ) ).filter( ( x ) => x !== undefined );
	return [ ...new Set( ids ) ];
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

/**
 * Which kind of connection comes first, wherever it is decided what to show (Justin, #connectome, 15 Nov 2026):
 * first the studio tracks that are Permanent Releases (Creative Commons, deadhead-compatible); then the shows
 * that are; then the studio tracks that are Full Releases (DRM-free); then the other shows. After those, what he
 * didn't name: a studio track not known to be DRM-free, and last a record two only share, never a track of it.
 *
 * m: a record or a show; how: TRACK, STAGE or RECORD. The higher, the sooner.
 */
export function standing( m, how ) {
	if ( how < STAGE ) {
		return 0;
	}
	const show = m.kind === 'show';
	if ( m.tier === PERMANENT ) {
		return show ? 4 : 5;
	}
	return show ? 2 : ( m.tier === FULL ? 3 : 1 );
}

/** A piece's standing: a track's or a show's own; a record whole, where no source says who is on which track, after them all. */
export function pieceStanding( G, piece ) {
	const m = G.music[ piece.m ];
	return piece.kind === 'record' ? 0.2 * m.tier : standing( m, piece.kind === 'show' ? STAGE : TRACK );
}

function byProminence( music ) {
	return ( x, y ) => ( standing( music[ y.m ], y.how ) - standing( music[ x.m ], x.how ) ) ||
		( music[ y.m ].tier - music[ x.m ].tier ) ||
		( roughly( music[ y.m ].date ) - roughly( music[ x.m ].date ) || 0 ) ||
		( x.m - y.m );
}

/** Everything two pickers share, added up. */
export function summarize( a, b, ev, music ) {
	ev.sort( byProminence( music ) );
	const t = { a, b, ev, w: 0, loose: 0, eff: 0, times: 0, shows: 0, records: 0, tracks: 0, looseRecords: 0, tier: UNKNOWN,
		rank: 0, played: false };
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
			t.rank = Math.max( t.rank, standing( m, e.how ) );
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
 * then the best standing of anything the two share (see standing: a Permanent studio track, a Permanent show, a
 * Full studio track, another show, in that order: Justin, #connectome, 15 Nov 2026), however much there is of
 * the rest; then how much of it, by eff. Two who only share a record: the freest such record first.
 */
export function loudness( tie ) {
	return tie.rank * 1e6 + ( tie.played ? 0 : tie.tier * 1e5 ) + Math.min( tie.eff, 9e4 );
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

/** How many a picker has played with, at least, for the graph to open on them (see landable). */
export const LANDING_COMPANY = 6;

/**
 * Who the graph may open on when the address names nothing (Justin, #connectome, 18 Nov 2026: "as much as I love
 * Jason, let's not always start with him. Just pick a random person with: Six or more direct connections; At least
 * one permanent release studio appearance"): whoever has played with six or more and is on a track, or on a record
 * where no source says which track, that's a Permanent Release. A show doesn't count, however free.
 */
export function landable( G ) {
	const out = [];
	G.people.forEach( ( p, i ) => {
		const studio = G.on[ i ].some( ( pc ) => G.pieces[ pc ].kind !== 'show' && G.music[ G.pieces[ pc ].m ].tier === PERMANENT );
		if ( studio && company( G, i ).length >= LANDING_COMPANY ) {
			out.push( i );
		}
	} );
	return out;
}

/**
 * Where the graph opens when the address names nothing: one of landable()'s, picked at random each time. Where there
 * is nobody such (a small kept graph), whoever with a page has played with the most, as it was until 18 Nov 2026.
 * The featured pickers are set aside (Justin, #connectome, 15 Nov 2026). rand: Math.random, but for the tests.
 */
export function landing( G, rand = Math.random ) {
	const pool = landable( G );
	if ( pool.length ) {
		return pool[ Math.min( pool.length - 1, Math.floor( rand() * pool.length ) ) ];
	}
	let best = 0, most = -1;
	G.people.forEach( ( p, i ) => {
		const n = p.page ? company( G, i ).length : -1;
		if ( n > most ) {
			best = i;
			most = n;
		}
	} );
	return best;
}

/**
 * A picker's company in the order a view names them, a few to a record or a show (Justin, #connectome, 15 Nov 2026:
 * "Priority list as described above, but only at most two 1-hop connections from any given record or show, unless
 * there are no other connecting objects available"). Down the company by what comes first (standing()), each goes by
 * the best thing they share with the middle that hasn't already brought in `cap` others; one whose every shared
 * record and show is full waits, and those waiting come after everyone else, in their own order, so they're named
 * only when nobody else is left to name. The first `fixed` (those the reader came by) stay first, as they are, and
 * count toward the cap. Each is returned with `by`: the entry they're named by (none, for those who waited).
 *
 * Who comes in by a song (Justin, #connectome, 15 Nov 2026, 07:29Z: "When examining who to show at the other end of
 * a link, in the case of a Song, prioritize in this order: 1. the recording artist who made it, 2. the song writer if
 * they're on the track, 3. another person from the ensemble if 1 and 2 already exist in the constellation"): of
 * those who'd come in by one record as near the front as each other, its artist first, then the song's writer, so
 * the first of a record's places is never given to a sideman while the one who made it waits.
 */
export function fewPer( G, comp, cap = 2, fixed = 0 ) {
	const used = new Map(), out = [];
	const take = ( c, e ) => {
		if ( e ) {
			used.set( e.m, ( used.get( e.m ) || 0 ) + 1 );
		}
		out.push( Object.assign( {}, c, { by: e } ) );
	};
	const best = ( c ) => {                                       // the first by standing of what they share that has room
		let at = null, high = -1, mine = 3;                          // of equals, one whose song it is (claim())
		for ( const e of c.tie.ev ) {
			const s = ( used.get( e.m ) || 0 ) < cap ? standing( G.music[ e.m ], e.how ) : -1;
			const k = s >= 0 ? claim( G, c.id, e ) : 3;
			if ( s > high || ( s === high && k < mine ) ) {
				at = e;
				high = s;
				mine = k;
			}
		}
		return { at, high, mine };
	};
	comp.slice( 0, fixed ).forEach( ( c ) => take( c, c.tie.ev.reduce( ( x, e ) => ( standing( G.music[ e.m ], e.how ) >
		standing( G.music[ x.m ], x.how ) ? e : x ), c.tie.ev[ 0 ] ) ) );
	const left = comp.slice( fixed );
	for ( ;; ) {
		let pick = -1, by = null, high = -1, mine = 3;
		left.forEach( ( c, i ) => {
			const b = best( c );
			// of equals, the song's recording artist, then its writer (Justin, 07:29Z); then the first in the company's own order
			if ( b.high > high || ( b.high === high && b.high >= 0 && b.mine < mine ) ) {
				pick = i;
				by = b.at;
				high = b.high;
				mine = b.mine;
			}
		} );
		if ( pick < 0 ) {
			break;
		}
		take( left.splice( pick, 1 )[ 0 ], by );
	}
	return out.concat( left.map( ( c ) => Object.assign( {}, c, { by: undefined } ) ) );
}

/**
 * Another turn of a picker's company (Justin, #connectome, 15 Nov 2026: "a button to cycle connections"): those
 * the reader came by stay first (`kept` of them), and the rest come round `per` at a time, so turn 1 names the
 * next `per` of them, and so on round to the start. Returns the ring in its new order.
 */
export function turned( ring, kept, per, turn ) {
	const rest = ring.slice( kept );
	if ( !turn || per <= 0 || rest.length <= per ) {
		return ring;
	}
	const k = ( turn * per ) % rest.length;
	return ring.slice( 0, kept ).concat( rest.slice( k ), rest.slice( 0, k ) );
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
			tier: Math.min( ta.tier, tb.tier ), rank: Math.min( ta.rank, tb.rank ) } );
	}
	return out.sort( ( x, y ) => ( y.legs - x.legs ) || ( y.rank - x.rank ) || ( y.tier - x.tier ) || ( y.eff - x.eff ) || ( y.both - x.both ) ||
		( y.w - x.w ) || G.people[ x.id ].name.localeCompare( G.people[ y.id ].name ) );
}

/**
 * The web among some pickers: every tie between two of them who have played together (or, with loose, who share
 * a record), each once, in the order the pickers were given. Round one picker these are the far legs of the
 * two-hop ways from them to their own company: who of the company have played with each other.
 */
export function among( G, ids, loose = false ) {
	const out = [];
	for ( let i = 0; i < ids.length; i++ ) {
		for ( let j = i + 1; j < ids.length; j++ ) {
			const tie = ids[ i ] === ids[ j ] ? null : G.adj[ ids[ i ] ].get( ids[ j ] );
			if ( tie && ( tie.played || loose ) ) {
				out.push( { u: ids[ i ], v: ids[ j ], tie } );
			}
		}
	}
	return out;
}

/**
 * The pickers on both of two pieces: what a line between them stands for, inside out. Those on the most pieces
 * first (they lead the furthest), then by name.
 */
export function between( G, x, y ) {
	const there = new Set( G.pieces[ y ].cast );
	return G.pieces[ x ].cast.filter( ( p ) => there.has( p ) ).sort( ( p, q ) => ( G.on[ q ].length - G.on[ p ].length ) ||
		G.people[ p ].name.localeCompare( G.people[ q ].name ) );
}

/**
 * A step further out from a picker: for each of those round them (ring, in order), up to `per` pickers that one
 * has played with and the picker in the middle has no tie to at all, not even a shared record. Each is two hops
 * from the middle, and is given once, under the one of the ring they have played with the most loudly (see
 * loudness); a ring picker left short takes, of those nobody has yet, the ones they have played with.
 *
 * `prefer` are the pickers the reader came by. One of them who is two hops out now comes first, and under the
 * ring picker the reader came by too, where they have played together: the way walked stays the way drawn.
 *
 * A line out to one of them says a song only where they may stand at its end (mayEnd: its artist or its writer, or
 * else someone of its ensemble with its artist and writer in view; Justin, #connectome, 15 Nov 2026, 07:29Z). One
 * whose every line out would say a song that isn't theirs, with its artist out of sight, isn't named; unless the
 * reader came that way.
 *
 * Returns, for each of the ring in turn, [{ id, tie, by, say }]: tie, theirs with the ring picker `by`; say, what
 * the line says ({ piece, e }, as lineSays()).
 */
export function beyond( G, id, ring, per = 2, prefer = [] ) {
	const near = new Set( [ id, ...G.adj[ id ].keys() ] );
	const seen = new Set( [ id, ...ring ] );
	const first = new Map( prefer.map( ( p, i ) => [ p, i ] ) );
	const rank = ( o ) => ( first.has( o ) ? first.get( o ) : Infinity );
	const best = new Map();                              // each one two hops out: the way in
	ring.forEach( ( s, i ) => {
		for ( const [ o, tie ] of G.adj[ s ] ) {
			if ( !tie.played || near.has( o ) ) {
				continue;
			}
			const say = lineSays( G, tie, o, seen ), walked = first.has( o ) && first.has( s ) ? 1 : 0, was = best.get( o );
			if ( !say && !walked ) {
				continue;
			}
			if ( !was || walked > was.walked || ( walked === was.walked && loudness( tie ) > loudness( was.tie ) ) ) {
				best.set( o, { id: o, tie, by: s, i, walked, say } );
			}
		}
	} );
	const order = ( x, y ) => ( rank( x.id ) - rank( y.id ) || 0 ) || ( loudness( y.tie ) - loudness( x.tie ) ) || ( y.tie.w - x.tie.w ) ||
		G.people[ x.id ].name.localeCompare( G.people[ y.id ].name );
	const out = ring.map( () => [] ), shown = new Set();
	for ( const f of [ ...best.values() ].sort( order ) ) {
		if ( out[ f.i ].length < per ) {
			out[ f.i ].push( { id: f.id, tie: f.tie, by: f.by, say: f.say } );
			shown.add( f.id );
		}
	}
	ring.forEach( ( s, i ) => {                           // left short: any they have played with whom nobody has yet
		if ( out[ i ].length >= per ) {
			return;
		}
		const spare = [];
		for ( const [ o, tie ] of G.adj[ s ] ) {
			const say = tie.played && !near.has( o ) && !shown.has( o ) ? lineSays( G, tie, o, seen ) : undefined;
			if ( say ) {
				spare.push( { id: o, tie, by: s, say } );
			}
		}
		for ( const f of spare.sort( order ).slice( 0, per - out[ i ].length ) ) {
			out[ i ].push( f );
			shown.add( f.id );
		}
	} );
	return out;
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

/**
 * Ways across by two pickers: a, x, y, b, where a has played with x, x with y and y with b, and neither x nor y is
 * one of `skip` (those who have a tie to both ends are drawn as ways by one picker). Up to `want` of them, the
 * loudest first (a way is as loud as its quietest hop: see loudness), and no picker on two of them: each is its
 * own arc of the rainbow between the two (Justin, #connectome, 19 Nov 2026: "a multi-hop rainbow for their two hops").
 * Returns [[a, x, y, b]].
 */
export function ways( G, a, b, want = 4, skip = [] ) {
	const out = new Set( [ a, b, ...skip ] );
	const found = [];
	for ( const [ x, t1 ] of G.adj[ a ] ) {
		if ( !t1.played || out.has( x ) ) {
			continue;
		}
		const l1 = loudness( t1 );
		for ( const [ y, t2 ] of G.adj[ x ] ) {
			const t3 = t2.played && !out.has( y ) ? G.adj[ b ].get( y ) : null;
			if ( t3 && t3.played ) {
				found.push( { x, y, s: Math.min( l1, loudness( t2 ), loudness( t3 ) ), sum: l1 + loudness( t2 ) + loudness( t3 ) } );
			}
		}
	}
	found.sort( ( p, q ) => ( q.s - p.s ) || ( q.sum - p.sum ) || G.people[ p.x ].name.localeCompare( G.people[ q.x ].name ) ||
		G.people[ p.y ].name.localeCompare( G.people[ q.y ].name ) );
	const chains = [], used = new Set();
	for ( const f of found ) {
		if ( chains.length >= want ) {
			break;
		}
		if ( !used.has( f.x ) && !used.has( f.y ) ) {
			chains.push( [ a, f.x, f.y, b ] );
			used.add( f.x ).add( f.y );
		}
	}
	return chains;
}

/** The Bacon number: hops from one picker to another, or -1. */
export function hops( G, a, b ) {
	return distances( G, a )[ b ];
}

/* ------------------------------------------------------------------------------------------------------------
 * The challenge (Justin, #connectome, 17 Nov 2026, 17:40Z): /bacon/challenge/Vickie_Vaughn puts the reader at a
 * random picker some hops from Vickie, and they find their way to her, picker by picker, the jumps counted.
 * --------------------------------------------------------------------------------------------------------- */

/** Whom an address asks the reader to find: /bacon/challenge/<name>, an underscore for a space, or
 *  ?challenge=<name>. '' when it asks for a challenge and names no one (/bacon/challenge: challengeGoal finds
 *  someone); null when it asks for no challenge. */
export function challengeOf( pathname, search ) {
	const m = /\/bacon\/challenge(?:\/([^/?#]*))?\/?$/.exec( pathname || '' );
	let raw = m ? m[ 1 ] || '' : new URLSearchParams( search || '' ).get( 'challenge' );
	if ( raw === null ) {
		return null;
	}
	if ( m ) {
		try {
			raw = decodeURIComponent( raw );
		} catch ( e ) {}                                             // a stray % in the address: read as written
	}
	return raw.replace( /_/g, ' ' ).replace( /\s+/g, ' ' ).trim();
}

/**
 * Whom to find when the challenge's address names no one (Justin, #connectome, 19 Nov 2026, 03:19Z: "target the
 * URL first, or a random person if nobody in the URL"): someone at random from landable()'s, the pickers the graph
 * may open on, for whom there's somewhere `band` jumps out to start (as challengeStart starts); failing them, anyone
 * with a page; failing them, anyone at all; and failing a start that far out, anyone a start leads to at all. null
 * when nobody can be found from anywhere. rand: Math.random, but for the tests.
 */
export function challengeGoal( G, rand = Math.random, band = [ 3, 4 ] ) {
	const pools = [ landable( G ), G.people.filter( ( p ) => p.page ).map( ( p ) => p.id ), G.people.map( ( p ) => p.id ) ];
	for ( const [ lo, hi ] of [ band, [ 1, Infinity ] ] ) {
		for ( const pool of pools ) {
			const left = pool.slice();
			while ( left.length ) {
				const to = left.splice( Math.min( left.length - 1, Math.floor( rand() * left.length ) ), 1 )[ 0 ];
				if ( playedDistances( G, to ).some( ( x ) => x >= lo && x <= hi ) ) {
					return to;
				}
			}
		}
	}
	return null;
}

/**
 * Where a challenge starts: a picker `band` jumps (playedDistances) from the goal (3 or 4: far enough to need finding, near enough to
 * find), else as far as anyone is, at least one hop. Of those, the ones with a page, when there are three or more,
 * so a reader lands somewhere with a face and not always the same one; chosen with rand (Math.random's shape). { from, par } (par: the fewest jumps there), or
 * null when nobody the sources know leads to the goal.
 */
export function challengeStart( G, to, rand = Math.random, band = [ 3, 4 ] ) {
	const d = playedDistances( G, to );
	const at = ( lo, hi ) => {
		const all = G.people.filter( ( p ) => d[ p.id ] >= lo && d[ p.id ] <= hi );
		const paged = all.filter( ( p ) => p.page );
		return ( paged.length >= 3 ? paged : all ).map( ( p ) => p.id );      // a choice among faces, or among everyone
	};
	let pool = at( band[ 0 ], band[ 1 ] );
	if ( !pool.length ) {
		let most = 0;
		for ( const x of d ) {
			most = Math.max( most, x );
		}
		pool = most >= 1 ? at( most, most ) : [];
	}
	if ( !pool.length ) {
		return null;
	}
	const from = pool[ Math.min( pool.length - 1, Math.floor( rand() * pool.length ) ) ];
	return { from, par: d[ from ] };
}

/**
 * Where the Oracle offers to start (Justin, #connectome, 19 Nov 2026, 07:10Z: "four mini constellations ... randomly
 * chosen, but each either itself a permanent-release studio track or a picker with a 1-degree connection to one"):
 * every track of a Permanent Release that isn't a show, then every picker on one of them.
 * Returns [{ kind: 'track', piece } | { kind: 'picker', id }].
 */
export function oracleItems( G ) {
	const tracks = G.pieces.filter( ( p ) => p.kind === 'track' && G.music[ p.m ].kind !== 'show' && G.music[ p.m ].tier === PERMANENT );
	const pickers = [ ...new Set( tracks.flatMap( ( t ) => t.cast ) ) ].sort( ( x, y ) => x - y );
	return tracks.map( ( t ) => ( { kind: 'track', piece: t.id } ) ).concat( pickers.map( ( id ) => ( { kind: 'picker', id } ) ) );
}

/**
 * n of oracleItems() at random (rand: Math.random's shape), tracks and pickers both where both are to be had. With a
 * goal (a challenge), none that is the goal or has them on it, nor any the goal can't be reached from; of the rest,
 * those three to six jumps from the goal first (a track: from the nearest picker on it), then the nearer and the
 * farther. So it can come back with fewer than n.
 */
export function oraclePick( G, goal, rand = Math.random, n = 4 ) {
	const d = goal === undefined || goal === null ? null : playedDistances( G, goal );
	const far = ( it ) => itemJumps( G, d, it );
	const shuffled = ( list ) => shuffle( list, rand );
	const items = oracleItems( G );
	const order = d ? [ ( x ) => x >= 3 && x <= 6, ( x ) => x >= 1 && x < 3, ( x ) => x > 6 && x < Infinity ]
		.flatMap( ( fits ) => shuffled( items.filter( ( it ) => fits( far( it ) ) ) ) ) : shuffled( items );
	// One of each kind first, where there is one, as early in the order as it comes; then the order.
	const out = [];
	for ( const kind of [ 'track', 'picker' ] ) {
		const it = order.find( ( x ) => x.kind === kind );
		if ( it && out.length < n ) {
			out.push( it );
		}
	}
	for ( const it of order ) {
		if ( out.length >= n ) {
			break;
		}
		if ( !out.includes( it ) ) {
			out.push( it );
		}
	}
	return order.filter( ( it ) => out.includes( it ) );           // in the order's own order: the best first
}

/** How many jumps an Oracle item is from the goal, given playedDistances from it (d): a track, by its nearest picker;
 *  0 where it is the goal or has them on it; -1 or Infinity where nothing leads there. */
function itemJumps( G, d, it ) {
	if ( it.kind === 'picker' ) {
		return d[ it.id ];
	}
	const ds = G.pieces[ it.piece ].cast.map( ( id ) => d[ id ] );
	return ds.some( ( x ) => x === 0 ) ? 0 : Math.min( ...ds.filter( ( x ) => x > 0 ).concat( [ Infinity ] ) );
}

function shuffle( list, rand ) {
	const out = list.slice();
	for ( let i = out.length - 1; i > 0; i-- ) {
		const j = Math.min( i, Math.floor( rand() * ( i + 1 ) ) );
		[ out[ i ], out[ j ] ] = [ out[ j ], out[ i ] ];
	}
	return out;
}

/**
 * Whom the Oracle sets to find when nobody is named: someone four of its starting places are three to six jumps
 * from, so the game from any of them is worth playing (its places are all near one another, and challengeGoal's
 * pick is often a jump or two from them). Of landable()'s at random, then anyone with a page; `tries` of each at
 * most; failing four, whoever had the most; failing all, challengeGoal's.
 */
export function oracleGoal( G, rand = Math.random, tries = 80 ) {
	const items = oracleItems( G );
	let best = null, most = 0;
	for ( const pool of [ landable( G ), G.people.filter( ( p ) => p.page ).map( ( p ) => p.id ) ] ) {
		for ( const to of shuffle( pool, rand ).slice( 0, tries ) ) {
			const d = playedDistances( G, to );
			const n = items.filter( ( it ) => {
				const x = itemJumps( G, d, it );
				return x >= 3 && x <= 6;
			} ).length;
			if ( n >= 4 ) {
				return to;
			}
			if ( n > most ) {
				best = to;
				most = n;
			}
		}
	}
	return best !== null ? best : challengeGoal( G, rand );
}

/** Where a track is drawn: its song's own view where a page charts a cut of it (the pickers round the song), else
 *  the track as a piece. */
export function trackView( G, piece ) {
	const pc = G.pieces[ piece ];
	const cuts = Object.entries( G.songcast || {} ).filter( ( [ , c ] ) => c.song === pc.song );
	const cut = cuts.find( ( [ , c ] ) => ( c.on || [] ).includes( pc.m ) ) || cuts[ 0 ];
	return cut ? { s: cut[ 1 ].song, cut: cut[ 0 ] } : { m: piece };
}

/** Hops along lines of playing together only (tie.played): a challenge's jumps are the ones the list and the ring
 *  offer, and two who only share a record are no step there. */
export function playedDistances( G, src ) {
	const dist = new Int32Array( G.people.length ).fill( -1 );
	let frontier = [ src ];
	dist[ src ] = 0;
	while ( frontier.length ) {
		const next = [];
		for ( const u of frontier ) {
			for ( const [ v, tie ] of G.adj[ u ] ) {
				if ( tie.played && dist[ v ] < 0 ) {
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
 * The way a reader went, as a chain: each picker they stood at, in order, with a loop cut out wherever they came
 * back to someone (all between comes off). steps: each step's two pickers and the tie between them, null where
 * they never shared anything (a step taken by typing a name, not along a line).
 */
export function wayOf( G, path ) {
	const way = [];
	for ( const id of path ) {
		const at = way.indexOf( id );
		if ( at >= 0 ) {
			way.length = at + 1;
		} else {
			way.push( id );
		}
	}
	return { way, steps: way.slice( 1 ).map( ( v, i ) => ( { u: way[ i ], v, tie: G.adj[ way[ i ] ].get( v ) || null } ) ) };
}

/** Who stands between two pickers a step apart, having played with both: one of `prefer` if any is, else the
 *  first; undefined when nobody does. A click on someone a step further out is two jumps, by way of this one. */
export function bridgeOf( G, u, v, prefer = [] ) {
	const both = [];
	for ( const [ m, t ] of G.adj[ u ] ) {
		const back = G.adj[ m ].get( v );
		if ( t.played && back && back.played && m !== v ) {
			both.push( m );
		}
	}
	return both.find( ( m ) => prefer.includes( m ) ) ?? both[ 0 ];
}

/** The songs along a way that play in Rabbithole, in the order walked, each once: [{ m, song, to }], to being
 *  playOf's address. */
export function wayPlays( G, steps ) {
	const out = [], seen = new Set();
	for ( const st of steps ) {
		for ( const e of st.tie ? st.tie.ev : [] ) {
			for ( const song of e.songs ) {
				const to = playOf( G, G.music[ e.m ], song );
				if ( to && !seen.has( song ) ) {
					seen.add( song );
					out.push( { m: e.m, song, to } );
				}
			}
		}
	}
	return out;
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
		// A show is known by the band and the night, where its source names the band: a taper's tape, and
		// cryptograss's own shows (Justin, #connectome, 15 Nov 2026: by the band, not the show's title).
		// Any other goes by its own name.
		const tape = !!m.artist;
		const who = tape ? m.artist : ( m.title || m.artist );
		const day = when( m.date );
		// A show says its night wherever it is named, so it is never taken for a band or a picker (Justin,
		// #connectome, 15 Nov 2026); `day` is kept apart, so a tight spot cuts the name and keeps the night.
		const dated = [ who, day ].filter( Boolean ).join( ' · ' );
		return { glyph: 'show', short: dated, brief: dated, who, day,
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

/**
 * What a line between two pickers says, of what they share that no other line in sight has said (`heard`, the
 * pieces said so far): Justin, #connectome, 15 Nov 2026, "try not to use the same connecting show/song more than
 * once". Their entries in the order they come (see standing), the ones named up front where there are any; within
 * a record, each song they share on it in turn, so two who share ten songs need not say the alphabet's first.
 * Returns { piece, e }, e with the song to say first; undefined when everything has been said.
 */
export function unsaid( G, tie, heard ) {
	for ( const say of sayings( G, tie ) ) {
		if ( !heard.has( say.piece ) ) {
			return say;
		}
	}
	return undefined;
}

/**
 * Everything a line between two pickers may say, in the order it's said: what they share that is named up front (on
 * one stage or one track, a Full or Permanent Release; where there's nothing such, the first thing), the entry
 * `first` first, and each song of a track on its own. Yields { piece, e }, e with that song first.
 */
export function* sayings( G, tie, first = null ) {
	const ev = tie.ev.filter( ( e ) => e.how >= STAGE && G.music[ e.m ].tier >= FULL );
	const pool = ev.length ? ev : tie.ev.slice( 0, 1 );
	for ( const e of ( first && pool.includes( first ) ? [ first ].concat( pool.filter( ( x ) => x !== first ) ) : pool ) ) {
		for ( const song of ( e.how === TRACK && e.songs.length ? e.songs : [ null ] ) ) {
			const one = song === null ? e : Object.assign( {}, e, { songs: [ song, ...e.songs.filter( ( x ) => x !== song ) ] } );
			yield { piece: pieceFor( G, one ), e: one };
		}
	}
}

/**
 * Whose a song is, of those on the track: its recording artists (made) and whoever its Song page says wrote it
 * (wrote). null for a piece that is no one song: a show, a record whole.
 */
export function whose( G, piece ) {
	const pc = G.pieces[ piece ];
	if ( !pc || pc.kind !== 'track' ) {
		return null;
	}
	const on = ( x ) => pc.cast.includes( x );
	return { artists: ( ( G.made || [] )[ pc.m ] || [] ).filter( on ),
		writers: ( ( G.wrote && G.wrote.get( pc.m + '\n' + songKey( pc.song ) ) ) || [] ).filter( on ) };
}

/**
 * May a line that says this piece end at `end`, with `seen` in view (a Set of the pickers named there, the middle
 * among them)? At the other end of a song's line (Justin, #connectome, 15 Nov 2026, 07:29Z): 1 the recording artist
 * who made it; 2 the writer, if they're on the track; 3 another of the ensemble, if 1 and 2 are in the view already.
 * So a song may end at its artist or its writer, and at anyone else only where an artist of it and a writer of it
 * (of those on the track: one who isn't can't stand at the end of its line) are in sight. A show, or a record whole,
 * may end anywhere.
 */
export function mayEnd( G, piece, end, seen ) {
	const o = whose( G, piece );
	if ( !o || o.artists.includes( end ) || o.writers.includes( end ) ) {
		return true;
	}
	const there = ( xs ) => !xs.length || xs.some( ( x ) => seen.has( x ) );
	return there( o.artists ) && there( o.writers );
}

/**
 * How near the front of a song's line someone stands, by one entry of their tie (07:29Z): 0, the recording artist of
 * its record; 1, the writer of one of its songs; 2, anyone else, and anyone at a show.
 */
export function claim( G, who, e ) {
	if ( !e || e.how !== TRACK || !e.songs || !e.songs.length || !G.made ) {
		return 2;
	}
	if ( ( G.made[ e.m ] || [] ).includes( who ) ) {
		return 0;
	}
	return e.songs.some( ( s ) => ( ( G.wrote && G.wrote.get( e.m + '\n' + songKey( s ) ) ) || [] ).includes( who ) ) ? 1 : 2;
}

/** What a line ending at `end` says of a tie, with `seen` in view: the first of its sayings() that may end there (mayEnd); undefined when none may. */
export function lineSays( G, tie, end, seen, first = null ) {
	for ( const say of sayings( G, tie, first ) ) {
		if ( mayEnd( G, say.piece, end, seen ) ) {
			return say;
		}
	}
	return undefined;
}

/* ------------------------------------------------------------------------------------------------------------
 * Your rabbithole: the songs a listener has heard in Rabbithole, and who they followed from each to the next
 * --------------------------------------------------------------------------------------------------------- */

/**
 * The picker a walk's step was made by, as the graph knows them: by name; else, of those on the cut, the one whose
 * first and last names are these (a cut's page may write "Justin Holmes" for Justin Myles Holmes). null where
 * nobody here answers to it.
 */
function walker( G, name, cut ) {
	const id = find( G, name );
	if ( id !== null || !name ) {
		return id;
	}
	const words = String( name ).toLowerCase().split( /\s+/ ).filter( Boolean );
	const on = cut ? cut.pickers.map( ( p ) => p[ 0 ] ).filter( ( x ) => x >= 0 ) : [];
	const like = on.filter( ( x ) => {
		const w = G.people[ x ].name.toLowerCase().split( /\s+/ );
		return words.length > 1 && w[ 0 ] === words[ 0 ] && w[ w.length - 1 ] === words[ words.length - 1 ];
	} );
	return like.length === 1 ? like[ 0 ] : null;
}

/**
 * A walk as the graph knows it (Justin, #connectome, 15 Nov 2026: Rabbithole's "Your rabbithole" drawn as the
 * explorer draws). hops: Rabbithole's walk, oldest first: { cid, song, via: { name, instrument } | null, at }.
 * Each step: the cut the cid plays (songcast) and the piece it is in the graph (the track where the cut's record
 * has one, else the record), the song's name, who the listener followed to it (`via`, an id or null; `viaName`,
 * as the walk wrote it), when, and `again`, how many times the same song was on before in this walk.
 */
export function walkSteps( G, hops ) {
	const seen = new Map();
	return ( hops || [] ).filter( ( h ) => h && h.cid ).map( ( h, i ) => {
		const cut = G.songcast[ h.cid ] || null;
		const rec = cut && cut.on && cut.on.length ? cut.on[ 0 ] : undefined;
		const track = rec !== undefined ? trackOn( G, rec, cut.song ) ?? trackLike( G, rec, cut.song ) : undefined;
		const piece = track !== undefined ? track : ( rec !== undefined ? G.whole[ rec ] : undefined );
		const song = cut ? cut.song : String( h.song || '' ).replace( /^Song:/, '' ) || h.cid.slice( 0, 10 );
		const key = songKey( song );
		const again = seen.get( key ) || 0;
		seen.set( key, again + 1 );
		const viaName = h.via && h.via.name ? h.via.name : null;
		return { i, cid: h.cid, cut, piece, song, rec, via: viaName ? walker( G, viaName, cut ) : null, viaName,
			instrument: h.via && h.via.instrument ? h.via.instrument : '', why: h.why || null,
			at: typeof h.at === 'number' ? h.at : null, again };
	} );
}

/**
 * A song's name as two spellings of it agree: "Barlow's Jig" and "Barlows Jig", "Gm☕" and "Gm" (a Song page and a
 * record's track list don't always spell a song alike).
 */
export function songKey( name ) {
	return String( name || '' ).toLowerCase().normalize( 'NFKD' ).replace( /[\p{M}'’]/gu, '' ).replace( /[^\p{L}\p{N}]+/gu, ' ' ).trim();
}

/** A record's track whose song is spelled another way: the one track there whose name agrees with this one, if one does. */
function trackLike( G, m, song ) {
	const k = songKey( song ), like = G.pieces.map( ( pc, x ) => x ).filter( ( x ) => G.pieces[ x ].kind === 'track' && G.pieces[ x ].m === m &&
		songKey( G.pieces[ x ].song ) === k );
	return like.length === 1 ? like[ 0 ] : undefined;
}

/** What a walk comes to: how many songs, how many of them reached by following someone, and since when. */
export function walkSum( steps ) {
	const at = steps.map( ( s ) => s.at ).filter( ( t ) => t !== null );
	return { songs: steps.length, followed: steps.filter( ( s ) => s.viaName ).length, since: at.length ? Math.min( ...at ) : null };
}

/**
 * Where a walk's songs sit, as a snake (Justin, #connectome, 15 Nov 2026: "go left to right, and then down a row
 * and right-to-left, and keep going thusly"): as many to a row as the frame has room for, every other row running
 * back, so the line from the end of one row to the start of the next turns at the frame's edge.
 * W: the frame's width; n: how many songs; room: the least a song needs across; side: from the frame's edge to the
 * first and last place in a row (a turn goes round out there); top: the first row; pitch: from a row to the next;
 * most: the most to a row.
 * Each place: x and y, its row, its column (0 at the left), which way its row runs (1 to the right, -1 back), and
 * how its name hangs under it, so that no name runs out over a turn: from its left edge at the left end, from its
 * right edge at the right end, else from its middle.
 */
export function snake( { W, n, room, side, top, pitch, most = Infinity } ) {
	const inner = Math.max( 0, W - 2 * side );
	const cols = Math.max( 1, Math.min( most, Math.floor( inner / room ) + 1 ) );
	const S = cols > 1 ? inner / ( cols - 1 ) : 0;
	const at = [];
	for ( let i = 0; i < n; i++ ) {
		const row = Math.floor( i / cols ), dir = row % 2 ? -1 : 1, c = i % cols;
		const col = dir > 0 ? c : cols - 1 - c;
		at.push( { x: side + col * S, y: top + row * pitch, row, col, dir,
			anchor: cols < 2 ? 'middle' : ( col === 0 ? 'start' : ( col === cols - 1 ? 'end' : 'middle' ) ) } );
	}
	return { cols, S, rows: n ? Math.floor( ( n - 1 ) / cols ) + 1 : 0, at };
}

/**
 * The roads a walk didn't take (Justin, #connectome, 15 Nov 2026: "constellation-ish in the sense of showing other
 * unused but potential connections and allowing the user to explore those"): from each song, where its pickers lead
 * that the walk hasn't been. Each picker's road is the one place that comes first by Justin's order (standing():
 * Creative Commons studio tracks, Creative Commons shows, DRM-free studio tracks, other shows), then the one fewest
 * others of the song's pickers are on, so the road is that picker's own; then the newest. The pickers who have
 * carried the walk least come first: those are the connections it hasn't used. Never the one followed on from the
 * song (their road is the line to the next), one road to a picker, and a place is a road once in the whole walk,
 * from the newest song that has it: the song on now chooses first. A song is the same place under any record, and
 * a song the walk has heard is no road.
 * The pickers are the cut's own, as its page names them: the graph may know a cut only as its record, and everyone
 * on a record isn't on every song of it.
 * want: how many from step i, a number or a function of i. Returns, for each step, [{ id: the piece, by: the picker
 * it goes by, via: every picker of the song's on it, `by` first }].
 */
export function walkRoads( G, steps, want = 3 ) {
	const many = typeof want === 'function' ? want : () => want;
	const place = ( x ) => {
		const pc = G.pieces[ x ];
		return pc.kind === 'track' ? 'song:' + songKey( pc.song ) : 'piece:' + x;
	};
	const avoid = new Set();
	const carried = new Map();                                      // a picker: how many of the walk's songs they're on
	for ( const st of steps ) {
		avoid.add( 'song:' + songKey( st.song ) );
		if ( st.piece !== undefined ) {
			avoid.add( 'piece:' + st.piece );
			if ( st.rec !== undefined ) {
				avoid.add( 'piece:' + G.whole[ st.rec ] );              // being on a record the walk has been on is no road
			}
		}
		for ( const p of new Set( castOf( G, st ) ) ) {
			carried.set( p, ( carried.get( p ) || 0 ) + 1 );
		}
	}
	const all = steps.map( () => [] );
	for ( let i = steps.length - 1; i >= 0; i-- ) {
		const st = steps[ i ], n = many( i );
		if ( st.piece === undefined || !( n > 0 ) ) {
			continue;
		}
		const next = steps[ i + 1 ], out = next && next.via !== null ? next.via : -1;
		const cast = [ ...new Set( castOf( G, st ) ) ];
		const via = new Map();
		for ( const p of cast ) {
			for ( const x of G.on[ p ] ) {
				if ( !avoid.has( place( x ) ) ) {
					via.set( x, ( via.get( x ) || [] ).concat( [ p ] ) );
				}
			}
		}
		const tier = ( x ) => pieceStanding( G, G.pieces[ x ] ), day = ( x ) => roughly( G.music[ G.pieces[ x ].m ].date );
		const order = ( x, y ) => ( tier( y ) - tier( x ) ) || ( via.get( x ).length - via.get( y ).length ) || ( day( y ) - day( x ) || 0 ) || ( x - y );
		const who = cast.filter( ( p ) => p !== out ).sort( ( a, b ) => ( carried.get( a ) - carried.get( b ) ) ||
			( G.on[ b ].length - G.on[ a ].length ) || G.people[ a ].name.localeCompare( G.people[ b ].name ) );
		for ( const p of who ) {
			if ( all[ i ].length >= n ) {
				break;
			}
			const best = [ ...via.keys() ].filter( ( x ) => !avoid.has( place( x ) ) && via.get( x ).includes( p ) ).sort( order )[ 0 ];
			if ( best !== undefined ) {
				avoid.add( place( best ) );
				all[ i ].push( { id: best, by: p, via: [ p ].concat( via.get( best ).filter( ( q ) => q !== p ) ) } );
			}
		}
	}
	return all;
}

/** Who is on one step of a walk: the cut's own pickers where the walk has the cut, else whoever the graph has on its piece. */
function castOf( G, st ) {
	if ( st.cut ) {
		return st.cut.pickers.map( ( p ) => p[ 0 ] ).filter( ( p ) => p >= 0 && G.on[ p ] );
	}
	return st.piece !== undefined ? G.pieces[ st.piece ].cast : [];
}

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
		// A cut says whose it is, under its name; the record it's on is in its long name and the headline
		// (Justin, #connectome, 15 Nov 2026). No artist said: the record. `on`, the record it's on, says whose
		// that is too (recordBy).
		return { glyph: 'track', name: piece.song, sub: m.artist || m.title || m.key, on: recordBy( m ), long: n.long };
	}
	if ( piece.kind === 'show' ) {
		// A band and a night of theirs often have one name. A show always says it is one (Justin, #connectome, 15 Nov 2026).
		return { glyph: 'show', name: n.who, sub: [ 'live', when( m.date ) ].filter( Boolean ).join( ' · ' ), long: n.long };
	}
	return { glyph: 'record', name: n.brief, sub: [ m.artist, when( m.date ) ].filter( Boolean ).join( ' · ' ), long: n.long };
}

/**
 * Whose a record is, as a line says it after the record's title: " by " and its artist credit, as its source
 * gives it. Nothing where no artist is credited, or for "Various", Discogs' word for a compilation: no one's.
 */
export function byArtist( m ) {
	const a = String( m.artist || '' ).trim();
	return a && !/^various( artists)?$/i.test( a ) ? ' by ' + a : '';
}

/**
 * What a view is called where its name stands alone: the browser's tab, and the card a shared link shows (Justin,
 * #connectome, 20 Nov 2026, his titles word for word: bare /bacon "The Oracle of Bluegrass Bacon", a challenge "The
 * Six Degrees of Bluegrass Bacon", two pickers "Bluegrass Bacon from <a> to <b>"). Any other view is "Bluegrass
 * Bacon: " and what it is of, which is mine. A crawler runs no script, so the card's title is written by the web
 * server from the address alone (rabbithole: public/bacon.html): his three are the same there, and the others as
 * near as an address tells (a song's name without its record).
 *
 * @param {{oracle?: boolean, challenge?: boolean, a?: string, b?: string, of?: string}} v
 */
export function pageTitle( v ) {
	if ( v.challenge ) {
		return 'The Six Degrees of Bluegrass Bacon';
	}
	if ( v.oracle ) {
		return 'The Oracle of Bluegrass Bacon';
	}
	if ( v.a && v.b ) {
		return 'Bluegrass Bacon from ' + v.a + ' to ' + v.b;
	}
	return v.of ? 'Bluegrass Bacon: ' + v.of : 'The Oracle of Bluegrass Bacon';
}

/**
 * A record as a line names it: its title and whose it is. "It says 'a track on Vowel Sounds' - it needs to say
 * the artist's name as well" (Justin, #connectome, 19 Nov 2026): a track on Vowel Sounds by Justin Myles Holmes.
 */
export function recordBy( m ) {
	return ( m.title || m.key ) + byArtist( m );
}

/**
 * Everything the boxes up top can find (Justin, #connectome, 15 Nov 2026: not only pickers): every picker by
 * name; every cut of a song the pages state; and every show, record and track that has pickers on it. A name
 * here says what kind of thing it is unless it is a picker, since a band, its record and a night of theirs can
 * all be called the same. A track with a cut of its own is found as the cut. The first to take a name keeps it.
 * Returns [{ label, view }]: view, what go() takes ({ a }, { s, cut } or { m }).
 */
export function catalogue( G ) {
	const out = [], taken = new Set();
	const put = ( label, view ) => {
		if ( label && !taken.has( label.toLowerCase() ) ) {
			taken.add( label.toLowerCase() );
			out.push( { label, view } );
		}
	};
	G.people.forEach( ( p ) => put( p.name, { a: p.id } ) );
	const cut = new Set();
	for ( const [ key, c ] of Object.entries( G.songcast || {} ) ) {
		const on = c.on && c.on.length ? recordBy( G.music[ c.on[ 0 ] ] ) : '';
		cut.add( c.song );
		put( c.song + ' · song' + ( on ? ' on ' + on : '' ), { s: c.song, cut: key } );
	}
	for ( const pc of G.pieces ) {
		const c = called( G, pc );
		if ( !pc.cast.length || ( pc.kind === 'track' && cut.has( pc.song ) ) ) {
			continue;                                        // folded into another tape of its night; or found as its cut
		}
		put( pc.kind === 'show' ? [ c.name, c.sub ].filter( Boolean ).join( ' · ' ) :
			( pc.kind === 'track' ? c.name + ' · track on ' + c.on : c.name + ' · record' + ( c.sub ? ', ' + c.sub : '' ) ), { m: pc.id } );
	}
	return out;
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
	const tier = ( x ) => pieceStanding( G, G.pieces[ x ] ), day = ( x ) => roughly( G.music[ G.pieces[ x ].m ].date );
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
 * Who stands at the other end of the way home from a cut, in order (Justin, #connectome, 15 Nov 2026, 07:29Z):
 * the recording artist who made it; then whoever the song page says wrote it, where they are on the track; then
 * the others of the cut's ensemble, as the page lists them. Whoever is already the middle of the view (`a`)
 * stands there already, so the next one does: from the artist's own view, the writer, or else the ensemble.
 *
 * entry: a songcast entry ({ artist, writers, pickers }). Returns picker ids, each once.
 */
export function homeward( entry, a ) {
	const out = [];
	const add = ( x ) => {
		if ( x != null && x >= 0 && x !== a && !out.includes( x ) ) {
			out.push( x );
		}
	};
	add( entry.artist );
	( entry.writers || [] ).forEach( add );
	( entry.pickers || [] ).forEach( ( p ) => add( p[ 0 ] ) );
	return out;
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
 * The rest of a cut's band, for the view of one of them taking a solo: every other picker the song's page puts
 * on the cut and the graph knows, in the page's order, each once.
 */
export function bandOf( G, cut, soloist ) {
	const out = [];
	for ( const p of ( cut && cut.pickers ) || [] ) {
		const id = p[ 0 ];
		if ( Number.isInteger( id ) && id >= 0 && id < G.people.length && id !== soloist && !out.includes( id ) ) {
			out.push( id );
		}
	}
	return out;
}

/**
 * How many places the ring has while a song plays (Justin, #connectome, 20 Nov 2026, 19:41Z: "keep the ensemble
 * visible the whole time"): a place for each of the band, one for the song, and with the card out one left empty
 * for it; never fewer than the frame names anyway (`usual`), and never more than the frame holds. It is the same
 * for every one of the band taking a solo, whoever else they have played with, so the ring is the same ring from
 * one solo to the next and everyone keeps their seat. A frame too small for the whole band names as many as it
 * holds; the rest are beads.
 *
 * band: how many others are on the cut. carded: the middle's card is out. W, H: the frame, in the drawing's
 * measure. Returns the places asked of ego(): the song's and the card's among them.
 */
export function bandSeats( band, usual, carded, W, H ) {
	const extra = 1 + ( carded ? 1 : 0 );
	const holds = W >= 520 && H >= 600 ? 10 : ( ( W >= 520 && H >= 440 ) || ( W >= 440 && H >= 640 ) ? 8 : ( W >= 340 && H >= 400 ? 6 : 4 ) );
	return Math.min( Math.max( band + extra, usual ), Math.max( holds, usual ) );
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
export function tagAt( a, b, ra, rb, most = 150, high = 23, avoid = [], want = 0 ) {
	let best = null;
	for ( const f of [ 0.5, 0.55, 0.45, 0.6, 0.4, 0.65, 0.35, 0.7 ] ) {
		const x = a.x + ( b.x - a.x ) * f, y = a.y + ( b.y - a.y ) * f;
		const clear = ( c, r ) => ( Math.abs( y - c.y ) >= r + high / 2 + 2 ? Infinity : Math.abs( x - c.x ) - r - 3 );
		let room = Math.max( 0, Math.min( most, 2 * Math.min( clear( a, ra ), clear( b, rb ) ) ) );
		// nor on a name: a tag `want` wide here (or as wide as there is room) over one of `avoid` has no room at all
		const half = Math.min( room, want || room ) / 2;
		if ( avoid.some( ( o ) => x + half > o.x1 && x - half < o.x2 && y + high / 2 > o.y1 && y - high / 2 < o.y2 ) ) {
			room = 0;
		}
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
 * Where two pickers stand with what lies between them: a on the left, b on the right, on the frame's middle line.
 * la, lb: half the width of each end's name, or all of it where it's written beside its picker, so neither runs
 * off the frame.
 */
function ends( W, H, la, lb ) {
	const cy = Math.round( H / 2 );
	const inset = Math.max( 76, Math.min( W * 0.13, 170 ) );
	return { A: { x: Math.round( Math.max( inset, ( la || 0 ) + 12 ) ), y: cy },
		B: { x: Math.round( W - Math.max( inset, ( lb || 0 ) + 12 ) ), y: cy }, cy };
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

/* ------------------------------------------------------------------------------------------------------------
 * The rainbow between two pickers (Justin, #connectome, 19 Nov 2026: "Showing a single path is boring. Give me a
 * full rainbow for their directs, and also a multi-hop rainbow for their two hops; fill the screen with the
 * richness of the ecosystem connecting them").
 *
 * Every way from one to the other is a strand: an arc from a to b that stands some height over the straight line
 * between them at its middle, or under it. Two such arcs meet only at their ends, so no strand crosses another,
 * however many there are. What a strand goes by (a piece of music the two share, a picker who has played with
 * both, two pickers in a chain) sits on it; the strands are stacked outward from the straight line, over and
 * under by turns, until the frame is full.
 * --------------------------------------------------------------------------------------------------------- */

/** The point t of the way along the arc from A to B that stands h over the straight line at its middle (h < 0: under). */
export function onArc( A, B, h, t ) {
	const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot( dx, dy ) || 1, k = 4 * h * t * ( 1 - t );
	return { x: A.x + dx * t + ( dy / len ) * k, y: A.y + dy * t - ( dx / len ) * k };
}

/** That arc's stretch from t1 to t2, as a line's bow: how far its curve is pulled from the middle of the straight line between its ends. */
export function arcBow( A, B, h, t1, t2 ) {
	const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot( dx, dy ) || 1, k = 2 * h * ( t2 - t1 ) * ( t2 - t1 );
	return { x: ( dy / len ) * k, y: -( dx / len ) * k };
}

const hits = ( p, q ) => p.x1 < q.x2 && p.x2 > q.x1 && p.y1 < q.y2 && p.y2 > q.y1;
const ALONG = [ 0.5, 0.36, 0.64, 0.25, 0.75, 0.43, 0.57, 0.3, 0.7, 0.2, 0.8 ];   // where along its strand a mark may sit, the middle first

/**
 * Where the strands go, and where on each its marks sit.
 *
 * opts: W, H; la, lb (as ends()); names, how the ends are named ({ a: { w, side, r }, b: { w, side, r } }: side 'left'
 * or 'right' of the picker, or null for under it; r, the picker's circle), so nothing is set down on them; top, bottom, the room to leave at
 * the frame's edges; strands, from the straight line outward, each
 *   { half, marks: [{ r, w, pill, small, under }], at }
 * half: the room the strand wants on either side of itself at its middle. A mark is a circle of radius r with a
 * name w wide beside it (w 0: no name; small: a bead's small name; under: the name goes under the circle, not
 * beside it), or a pill w wide (pill: true) centred on the strand. The first strand is the straight line itself.
 * fill: with room to spare, how many times further apart the strands may stand to fill the frame.
 *
 * Returns { A, B, taken (every box set down), strands: [ null | { h, side, marks: [{ t, x, y, named, at: 'right' | 'left' | 'under' | null }] } ] }: null
 * for a strand the frame had no room for. A name that would lie on another mark or run off the frame is tried
 * further along the strand and on the mark's other side; with nowhere clear, the mark is set down without it
 * (named: false). Of several marks on one strand, each one's name is tried first on the side away from the others,
 * so the stretch of the strand between them is left in sight.
 */
export function rainbow( { W, H, la, lb, names = {}, strands: asked, top = 18, bottom = 18, fill = 1 } ) {
	const { A, B, cy } = ends( W, H, la, lb );
	const room = [ cy - top, H - bottom - cy ];              // over the straight line, and under it
	// With fewer strands than the frame has room for, they stand further apart, up to `fill` times, and fill it:
	// as far as the fuller side of the straight line allows.
	const need = [ 0, 0 ];
	asked.forEach( ( st, i ) => {
		if ( i === 0 ) {
			need[ 0 ] = need[ 1 ] = st.half;
		} else {
			need[ need[ 0 ] <= need[ 1 ] ? 0 : 1 ] += 2 * st.half;
		}
	} );
	const wide = Math.max( 1, Math.min( fill, room[ 0 ] / Math.max( 1, need[ 0 ] ), room[ 1 ] / Math.max( 1, need[ 1 ] ) ) );
	const strands = asked.map( ( st ) => Object.assign( {}, st, { half: st.half * wide } ) );
	const edge = [ 0, 0 ];                                   // how far out each side is taken
	const taken = [];
	for ( const [ P, nm ] of [ [ A, names.a ], [ B, names.b ] ] ) {
		taken.push( { x1: P.x - 32, y1: P.y - 32, x2: P.x + 32, y2: P.y + 32 } );
		if ( nm && nm.side ) {
			taken.push( nm.side === 'left' ? { x1: P.x - 40 - nm.w, y1: P.y - 12, x2: P.x - 32, y2: P.y + 12 } :
				{ x1: P.x + 32, y1: P.y - 12, x2: P.x + 40 + nm.w, y2: P.y + 12 } );
		} else if ( nm ) {
			const r = nm.r || 22;                               // the name is tucked up to the circle's rim (draw.node)
			taken.push( { x1: P.x - nm.w / 2 - 8, y1: Math.min( P.y + 32, P.y + r - 3 ), x2: P.x + nm.w / 2 + 8, y2: P.y + r + 18 } );
		}
	}
	let first = true;
	const out = strands.map( ( st, i ) => {
		let side = edge[ 0 ] <= edge[ 1 ] ? 0 : 1, h;
		if ( first ) {
			h = 0;
		} else {
			if ( edge[ side ] + 2 * st.half > room[ side ] + 0.5 ) {
				side = 1 - side;
			}
			if ( edge[ side ] + 2 * st.half > room[ side ] + 0.5 ) {
				return null;
			}
			h = edge[ side ] + st.half;
		}
		const sign = side === 0 ? 1 : -1, n = st.marks.length;
		const boxOf = ( m, p, at ) => {
			if ( m.pill ) {
				return [ { x1: p.x - m.w / 2 - 3, y1: p.y - 14, x2: p.x + m.w / 2 + 3, y2: p.y + 14 } ];
			}
			const pad = m.small ? 3.5 : 2, b = [ { x1: p.x - m.r - pad, y1: p.y - m.r - pad, x2: p.x + m.r + pad, y2: p.y + m.r + pad } ];
			if ( at === 'under' ) {
				b.push( { x1: p.x - m.w / 2, y1: p.y + m.r + 4, x2: p.x + m.w / 2, y2: p.y + m.r + 22 } );
			} else if ( at ) {
				const x1 = at === 'right' ? p.x + m.r + 5 : p.x - m.r - 5 - m.w, tall = m.small ? 8 : 9;
				b.push( { x1, y1: p.y - tall, x2: x1 + m.w, y2: p.y + tall } );
			}
			return b;
		};
		const clear = ( bs ) => bs.every( ( b ) => b.x1 >= 3 && b.x2 <= W - 3 && !taken.some( ( q ) => hits( b, q ) ) );
		// One mark: anywhere along, each strand starting somewhere else, so the marks fill the frame and don't
		// stand in a column. More: spread evenly, and all slid together a little either way. `at`: where the
		// strand's marks belong (a picker's place in a chain), and a little either way of that.
		const lead = n === 1 && st.marks[ 0 ].pill ? ALONG : [ 0, 1, 2 ].map( ( k ) => ALONG[ ( i + k ) % 3 ] ).concat( ALONG.slice( 3 ) );
		const tries = st.at ? [ 0, -0.04, 0.04, -0.08, 0.08 ].map( ( s ) => st.at.map( ( t ) => t + s ) ) :
			n === 1 ? lead.map( ( t ) => [ t ] ) :
				[ 0, -0.25, 0.25, -0.45, 0.45 ].map( ( s ) => st.marks.map( ( m, k ) => ( k + 1 + s ) / ( n + 1 ) ) );
		let best = null;
		for ( const ts of tries ) {
			const got = st.marks.map( ( m, k ) => {
				const p = onArc( A, B, sign * h, ts[ k ] );
				for ( const at of ( m.pill || !m.w ? [ null ] : m.under ? [ 'under' ] : ( ( n > 1 ? ts[ k ] < 0.5 : ts[ k ] > 0.6 ) ? [ 'left', 'right' ] : [ 'right', 'left' ] ) ) ) {
					if ( clear( boxOf( m, p, at ) ) ) {
						return { t: ts[ k ], x: p.x, y: p.y, named: !!at || !!m.pill, at, ok: true };
					}
				}
				return { t: ts[ k ], x: p.x, y: p.y, named: false, at: null, ok: !m.pill && clear( boxOf( m, p, null ) ) };
			} );
			const score = got.reduce( ( sum, g, k ) => sum + ( g.named || !st.marks[ k ].w ? 2 : 0 ) + ( g.ok ? 1 : 0 ), 0 );
			if ( !best || score > best.score ) {
				best = { got, score };
			}
			if ( score === 3 * n ) {
				break;
			}
		}
		best.got.forEach( ( g, k ) => taken.push( ...boxOf( st.marks[ k ], g, g.at ) ) );
		if ( first ) {
			edge[ 0 ] = edge[ 1 ] = st.half;
			first = false;
		} else {
			edge[ side ] = h + st.half;
		}
		return { h: sign * h, side, marks: best.got };
	} );
	return { A, B, cy, taken, strands: out };
}

const LEAN = 56;                                    // about half a name's width: how far a name at the side leans out
const DEEP = 1.75;                                  // the outer oval, for those a step further out: this many times the inner

/**
 * The places that are clear of some boxes ({x1, y1, x2, y2}) by `pad` all round. ego() keeps its beads clear of
 * where a name of the usual length would be; what draws the names knows how long each one is, and asks this for
 * the places that are clear of them as written.
 */
export function clearOf( places, boxes, pad = 0 ) {
	return places.filter( ( p ) => !boxes.some( ( b ) => p.x > b.x1 - pad && p.x < b.x2 + pad && p.y > b.y1 - pad && p.y < b.y2 + pad ) );
}

/** The places at least `far` from every one of some points (see along(): the points of the lines drawn). */
export function away( places, pts, far ) {
	return places.filter( ( p ) => !pts.some( ( q ) => Math.abs( q.x - p.x ) < far && Math.abs( q.y - p.y ) < far &&
		Math.hypot( q.x - p.x, q.y - p.y ) < far ) );
}

/** n of a list, taken evenly through it: all of it when it has no more than n. */
export function spread( list, n ) {
	const take = Math.max( 0, Math.min( n, list.length ) );
	return Array.from( { length: take }, ( _, i ) => list[ Math.floor( i * list.length / take ) ] );
}

/**
 * Points along a line from p to q, about `step` pixels apart, both ends among them: straight, or bowed as far
 * as `bow` says (what arc() returns: how far the curve's control point is from the middle of the straight line).
 */
export function along( p, q, bow, step = 5 ) {
	const cx = ( p.x + q.x ) / 2 + ( bow ? bow.x : 0 ), cy = ( p.y + q.y ) / 2 + ( bow ? bow.y : 0 );
	const n = Math.max( 1, Math.ceil( ( Math.hypot( cx - p.x, cy - p.y ) + Math.hypot( q.x - cx, q.y - cy ) ) / step ) ), out = [];
	for ( let i = 0; i <= n; i++ ) {
		const t = i / n, u = 1 - t;
		out.push( { x: u * u * p.x + 2 * u * t * cx + t * t * q.x, y: u * u * p.y + 2 * u * t * cy + t * t * q.y } );
	}
	return out;
}

/**
 * Where a name goes beside its circle so that no line runs through it. Places all round the circle are tried,
 * every thirty degrees, hard by it and then a little and a little more away: beside it, over and under it, and
 * at each corner between. A place is out when the name would lie on a box already taken (`boxes`: the other
 * names, the other circles) or leave the frame. Of the rest, the one with the most room between it and the lines
 * wins; once that room is `enough`, the one furthest `out` (the way away from the middle) does, and the nearer
 * the circle the better, so names sit alike where they can and no further off than they must.
 *
 * at: the circle's middle; r: its radius; w, h: the name's width and height; pts: points along every line drawn
 * (see along()); frame: { W, H }; out: { x, y }, a direction.
 * Returns { x, y, anchor, box, room }: x, y, where the text starts, from the circle's middle; anchor, which end
 * of the text that is (start, middle, end); box, where the name is, in the frame. null when no place is free.
 */
export function beside( at, r, w, h, pts, boxes, frame, out = { x: 0, y: -1 }, enough = 12 ) {
	const base = h * 0.78, len = Math.hypot( out.x, out.y ) || 1;
	const near = pts.filter( ( q ) => Math.abs( q.x - at.x ) < w + r + 60 && Math.abs( q.y - at.y ) < h + r + 60 );   // only what comes near can matter
	let best = null;
	for ( const gap of [ 7, 17, 29 ] ) {
		for ( let deg = 0; deg < 360; deg += 30 ) {
			const R = r + gap, cx = Math.cos( deg * Math.PI / 180 ), sy = Math.sin( deg * Math.PI / 180 );
			const anchor = cx > 0.3 ? 'start' : ( cx < -0.3 ? 'end' : 'middle' );
			const dx = R * cx - ( anchor === 'start' ? 0 : ( anchor === 'end' ? w : w / 2 ) );
			const dy = R * sy - ( sy < -0.3 ? h : ( sy > 0.3 ? 0 : h / 2 ) );
			const box = { x1: at.x + dx, y1: at.y + dy, x2: at.x + dx + w, y2: at.y + dy + h };
			// A box round this circle itself is not in the way: every place here is set clear of the circle already.
			if ( box.x1 < 4 || box.y1 < 2 || box.x2 > frame.W - 4 || box.y2 > frame.H - 2 ||
				boxes.some( ( b ) => !( at.x > b.x1 && at.x < b.x2 && at.y > b.y1 && at.y < b.y2 ) &&
					box.x1 < b.x2 + 3 && b.x1 < box.x2 + 3 && box.y1 < b.y2 + 3 && b.y1 < box.y2 + 3 ) ) {
				continue;
			}
			let room = Infinity;
			for ( const q of near ) {
				const ex = Math.max( box.x1 - q.x, 0, q.x - box.x2 ), ey = Math.max( box.y1 - q.y, 0, q.y - box.y2 );
				if ( ex < room && ey < room ) {
					room = Math.min( room, Math.hypot( ex, ey ) );
				}
			}
			const mx = dx + w / 2, my = dy + h / 2;
			// How far out it is counts only as it gets clear of the lines: never a reason to lie on one.
			const value = Math.min( room, enough ) * ( 1 + 0.2 * ( mx * out.x + my * out.y ) / ( ( Math.hypot( mx, my ) || 1 ) * len ) ) - 0.03 * gap;
			if ( !best || value > best.value + 1e-9 ) {
				best = { x: Math.round( R * cx ), y: Math.round( dy + base ), anchor, box, room, value };
			}
		}
	}
	return best;
}

/**
 * The frame in which a picker's view shows all it can: eight named (connectome.js egoScene: H > 560 and W > 700)
 * and the step further out (ego: W >= 736 and H >= 488). A change to either changes this.
 */
export const ROOMY = { W: 737, H: 561 };

/**
 * The zoom a bacon graph is drawn as, zoomed in to zoom (1 at 100%): four tenths of the way there. Justin, #connectome,
 * 17 Nov 2026: "At 150-160% zoom, I want to see more like what we currently see at 100-120. At 180, I'd still like to
 * see more like what we currently have around 130-160." And 18 Nov: "I just want to see slightly more detail at
 * slightly higher zoom levels". So 150% is drawn as 120%, 180% as 132%, 200% as 140%, 300% as 180%: each step in
 * draws it bigger and shows less, as the plain zoom did, but less so. Never less than 100%, never more than the zoom.
 */
export const ZOOM_COUNTS = 0.4;
export function drawnAs( zoom ) {
	return 1 + ZOOM_COUNTS * ( Math.max( 1, zoom ) - 1 );
}

/**
 * How many times smaller to draw a bacon graph than its frame's own pixels. The page zoomed in: as many as make its
 * zoom look like drawnAs() of it, and no more than lays the frame out as ROOMY, where everything is in sight already.
 * closer: the graph's own zoom, the wheel's, on top of the page's: drawn that much bigger again, as drawnAs() counts
 * it, and laid out in that much less, so it shows less; under 1 then. W and H are the frame's pixels; zoom is the
 * page's (1 at 100%).
 */
export function shrink( W, H, zoom, closer = 1 ) {
	const need = Math.ceil( Math.max( ROOMY.W / W, ROOMY.H / H ) * 100 ) / 100;   // up: the frame laid out is ROOMY at least
	const z = Math.max( 1, zoom );
	const s = Math.max( 1, Math.min( need, Math.floor( z / drawnAs( z ) * 100 ) / 100 ) );
	return closer > 1 ? Math.round( s * drawnAs( z ) / drawnAs( z * closer ) * 100 ) / 100 : s;
}

/**
 * Firefox's zoom, from its pixel ratio r. Firefox gives the window's size zoomed with the page, so the pixel ratio is
 * all a page has, and that's the zoom times the screen's own ratio: a page can't tell the two apart. The screen's is
 * taken as 2 where r is 2 or more and 1 below it, but never as more than the least ratio this browser has shown the
 * bacon graphs (least, kept between visits; never taken under 1): a plain screen at 200% read as 100% (Justin, 18 Nov
 * 2026), and now reads 200% once it has been here at anything less. Returns the zoom, and the least ratio to keep.
 */
export function foxZoom( r, least ) {
	const low = Math.max( 1, Math.min( r, least > 0 ? least : r ) );
	return { zoom: r / Math.min( r >= 2 ? 2 : 1, low ), least: low };
}

/**
 * A ring of n places with one of them left empty at the upper right, for the card of the one in the middle
 * (Justin, #connectome, 20 Nov 2026, 14:16Z: "form the graph with only five spokes instead of six ... And show it
 * in the upper-right corner, where we have no sixth spoke"). Returns { turn, gap }: how far round to turn ego()'s
 * ring so a place stands at the upper right (45 degrees up), and which place that is, to be left out. The turn
 * is at most half a step. Where it would stand anyone straight over or under the middle (within 8 degrees; a
 * ring of eight), the ring isn't turned, and the place nearest the upper right is the one left out. Two places
 * or fewer: turned clear of the corner, nobody left out (gap -1).
 *
 * over: a place straight over the middle is no bar to the turn (the song's seat while it plays).
 */
export function gapFor( n, over = false ) {
	if ( n < 3 ) {
		return { turn: n === 2 ? 90 : 0, gap: -1 };
	}
	const step = 360 / n, base = -90 + step / 4;
	const j = Math.round( ( -45 - base ) / step );
	const gap = ( ( j % n ) + n ) % n;
	const turn = -45 - ( base + step * j );
	// over: the place straight over the middle may be taken (a song's, while it plays: its name is over it, and
	// no name of the middle's is there to run through); straight under never, where the middle's own name is.
	const upright = Array.from( { length: n }, ( _, i ) => base + step * i + turn )
		.some( ( d, i ) => i !== gap && Math.abs( ( ( d % 180 ) + 180 ) % 180 - 90 ) < 8 && !( over && Math.sin( d * Math.PI / 180 ) < 0 ) );
	return { turn: upright ? 0 : turn, gap };
}

/**
 * One picker and their company: the picker in the middle, the closest around them on an oval that starts a
 * quarter step past noon (nobody sits at twelve or at six, as on the cards), and the rest in two wider ovals.
 * Returns { C, rx, ry, web, far, named: [{x, y, below, angle, seat, of, lean}], dots: [{x, y}] }: seat, which
 * place round the oval; of, how many places there are.
 *
 * web: the oval is big enough for the lines among those on it to be in sight (see arc). Those lines leave a
 * picker along the oval and inward, so a name centred over or under a picker at the side would have them run
 * through it. With the web in sight a name leans outward instead: lean (-1 at the far left, 1 at the far
 * right, 0 at the top and the bottom) is how far, as a share of half the name's own width.
 *
 * far: asked for (far: true), and given when the frame has room for it, a second oval DEEP times the first,
 * for those a step further out: for each place round the first, { main, sides: [ before, after ] }. main is
 * straight on from the middle through that place, so the way out to it is one straight line; the sides are a
 * little nearer in and a few degrees round to either side, for a second. The first oval is smaller for it,
 * never too small for its web. Then nothing here says where a name goes (lean is 0): there are lines out as well
 * as in, and beside() finds each name its place; and dots are every place a bead might go, on one oval between
 * the two, for the caller to take those that are clear of the names and the lines once they are known.
 */
export function ego( { W, H, named, dots, far = false, turn = 0 } ) {
	const C = { x: Math.round( W / 2 ), y: Math.round( H / 2 ) };
	const n = Math.max( 0, named );
	// a step further shows in a frame a little smaller than it first did (Justin, #connectome, 15 Nov 2026):
	// from about 740 by 490, where it was 855 by 580; the web inside it with it
	const deep = !!far && n > 1 && ( W / 2 - 130 ) / DEEP >= 136 && ( H / 2 - 62 ) / DEEP >= 104;
	const ry = deep ? Math.min( ( H / 2 - 62 ) / DEEP, 230 ) : Math.max( 84, Math.min( H * 0.29, 230 ) );
	const rx = deep ? Math.min( ( W / 2 - 130 ) / DEEP, ry * 1.9 ) : Math.max( 110, Math.min( W * 0.3, ry * 1.9 ) );
	const out = { C, named: [], dots: [], rx, ry, web: n > 1 && ( deep || ( rx >= 170 && ry >= 130 ) ), far: deep ? [] : null };
	const on = ( deg, f ) => ( { x: Math.round( C.x + rx * f * Math.cos( deg * Math.PI / 180 ) ), y: Math.round( C.y + ry * f * Math.sin( deg * Math.PI / 180 ) ) } );
	for ( let i = 0; i < n; i++ ) {
		const deg = -90 + 360 / n / 4 + ( 360 / n ) * i + turn;         // turn: the whole ring round by so many degrees (gapFor)
		const rad = deg * Math.PI / 180;
		const y = C.y + ry * Math.sin( rad );
		out.named.push( { x: Math.round( C.x + rx * Math.cos( rad ) ), y: Math.round( y ), below: y > C.y + 1, angle: deg, seat: i, of: n,
			lean: out.web && !deep ? Math.cos( rad ) : 0 } );
		if ( deep ) {
			const fan = Math.min( 15, 360 / n / 3.2 );
			out.far.push( { main: on( deg, DEEP ), sides: [ on( deg - fan, DEEP * 0.9 ), on( deg + fan, DEEP * 0.9 ) ] } );
		}
	}
	// The rest sit on two wider ovals, clear of the names above and below each named picker, spread evenly
	// round the first before the second takes any.
	const per = deep ? n * 6 : ( n * 3 || 12 );
	let left = Math.max( 0, dots );
	( deep ? [ [ 1.36, 1.36 ] ] : [ [ 1.36, 1.42 ], [ 1.58, 1.68 ] ] ).filter( ( [ , fy ] ) => ry * fy < H / 2 - 10 ).forEach( ( [ fx, fy ], ring ) => {
		const free = [];
		for ( let i = 0; i < per; i++ ) {
			const rad = ( -90 + ( 360 / per ) * ( i + ( ring ? 1 : 0.5 ) ) ) * Math.PI / 180;
			const x = C.x + Math.min( rx * fx, W / 2 - 16 ) * Math.cos( rad ), y = C.y + ry * fy * Math.sin( rad );
			const crowded = !deep && out.named.some( ( p ) => Math.abs( x - p.x - p.lean * LEAN ) < 74 &&
				( p.below ? ( y > p.y && y < p.y + 64 ) : ( y < p.y && y > p.y - 64 ) ) );
			if ( !crowded ) {
				free.push( { x: Math.round( x ), y: Math.round( y ) } );
			}
		}
		const take = deep ? free.length : Math.min( left, free.length );
		for ( let i = 0; i < take; i++ ) {
			out.dots.push( free[ Math.floor( i * free.length / take ) ] );
		}
		left -= take;
	} );
	return out;
}

/**
 * How the line between two of those seated round the middle bows: the web among a picker's company, or among
 * the pieces round a piece. Every line bows away from the middle, as the ways round do between two pickers, so
 * none of them is taken for a line to the one in the middle and none runs through them:
 *
 *   between neighbours, it follows the oval they sit on: the rim;
 *   between two further apart, it is lifted part of the way from the straight line toward the rim, and never
 *   comes nearer the middle than `clear`;
 *   between two straight across from each other, it goes round the middle, by one side from one seat and by
 *   the other from the next, so they don't all crowd one half.
 *
 * lay is ego()'s; pa and pb two of its named places. Returns how far the curve's control point is from the
 * middle of the straight line between them, { x, y }; and apart, how many seats apart the two are, the short
 * way round (1 for neighbours). The curve never leaves the oval, so it keeps clear of the beads outside it,
 * and of the names, which lean outward (see ego).
 */
export function arc( lay, pa, pb, { clear = 46, lift = 0.38 } = {} ) {
	const TAU = 2 * Math.PI, rad = ( deg ) => deg * Math.PI / 180;
	const [ p, q ] = pa.seat <= pb.seat ? [ pa, pb ] : [ pb, pa ];
	let gap = ( ( rad( q.angle ) - rad( p.angle ) ) % TAU + TAU ) % TAU;     // from p on round to q
	let mid = rad( p.angle ) + gap / 2;
	const across = Math.abs( gap - Math.PI ) < 1e-6;
	if ( across ) {
		mid = rad( p.angle ) + ( p.seat % 2 ? -1 : 1 ) * Math.PI / 2;
	} else if ( gap > Math.PI ) {                                        // the shorter way round is the other way
		gap = TAU - gap;
		mid += Math.PI;
	}
	const ux = lay.rx * Math.cos( mid ), uy = lay.ry * Math.sin( mid );      // the rim, out along the middle of the gap
	const chord = across ? 0 : Math.cos( gap / 2 );                      // the straight line's middle, as a share of that
	const neighbours = gap <= TAU / Math.max( 4, p.of ) + 1e-6;
	const peak = neighbours ? 1 : Math.min( 1, Math.max( chord + lift * ( 1 - chord ), clear / Math.hypot( ux, uy ) ) );
	return { x: 2 * ( peak - chord ) * ux, y: 2 * ( peak - chord ) * uy, apart: Math.min( q.seat - p.seat, p.of - ( q.seat - p.seat ) ) };
}

/* ------------------------------------------------------------------------------------------------------------
 * A bacon graph kept as it was shared (Justin, #connectome, 16 Nov 2026: a permalink to "that exact bacon
 * graph", which a source growing or being corrected later doesn't change; an old one that's no longer so says
 * so). It is kept on the wiki as a page, Bacon:<id>, and opened at /bacon/<id>.
 * --------------------------------------------------------------------------------------------------------- */

/** The kinds, by the first letter of a kept graph's ID: a constellation, a relationship, a lineup, a flowchart. */
export const KINDS = { c: 'constellation', r: 'relationship', m: 'lineup', f: 'flowchart' };

/** A kept graph's ID: its kind's letter, then ten of Crockford's base-32 (no i, l, o or u: it reads aloud). */
export const KEPT_ID = /^[cfmr][0-9a-hjkmnp-tv-z]{10}$/;
const B32 = '0123456789abcdefghjkmnpqrstvwxyz';

/** The kind of view this is, as a kept graph's letter; null for a view that can't be kept yet (the walk). */
export function kindOf( v ) {
	if ( !v || v.walk ) {
		return null;
	}
	if ( v.m !== undefined || v.s !== undefined || v.cut !== undefined ) {
		return 'm';
	}
	if ( v.a === undefined ) {
		return null;
	}
	return v.b === undefined ? 'c' : 'r';
}

/**
 * The part of graph.json a view stands on, as a graph.json of its own: the pickers in sight and every tie among
 * them, with all each tie says; every tie of a hub (the one in a constellation's middle: who of their company is
 * drawn, and who is further out, is chosen from all of it); the music those ties name, and the music in sight;
 * and what that music says of its people where they're kept (its makers and its cuts' writers, by name). Numbered
 * afresh, in graph.json's own order, so the same view always comes out the same, and build() reads it as it
 * reads the whole: a view drawn from it is drawn by the same scenes, from what it stood on.
 *
 * @param {Object} g graph.json, as read.
 * @param {number[]} pickers Who's in sight, by their numbers in g.
 * @param {number[]} musics The music in sight (a lineup's record or show, a cut's record), by their numbers in g.
 * @param {number[]} hubs Those whose every tie is kept.
 * @return {Object} A graph.json.
 */
export function keep( g, pickers, musics = [], hubs = [] ) {
	const sight = new Set( pickers ), hub = new Set( hubs );
	const ties = g.ties.filter( ( [ a, b ] ) => ( sight.has( a ) && sight.has( b ) ) || hub.has( a ) || hub.has( b ) );
	const mus = new Set( musics.filter( ( m ) => g.music[ m ] ) );
	for ( const [ , , evs ] of ties ) {
		evs.forEach( ( e ) => mus.add( e[ 0 ] ) );
	}
	const cuts = Object.entries( g.songcast || {} ).filter( ( [ , c ] ) => ( c.on || [] ).some( ( m ) => mus.has( m ) ) );
	const who = new Set( sight );
	ties.forEach( ( [ a, b ] ) => who.add( a ).add( b ) );
	for ( const m of mus ) {
		( ( g.made && g.made[ m ] ) || [] ).forEach( ( p ) => who.add( p ) );
	}
	for ( const [ , c ] of cuts ) {
		[ c.artist, ...( c.writers || [] ) ].filter( ( p ) => typeof p === 'number' && p >= 0 ).forEach( ( p ) => who.add( p ) );
	}
	const pids = [ ...who ].filter( ( p ) => g.people[ p ] ).sort( ( x, y ) => x - y ), mids = [ ...mus ].sort( ( x, y ) => x - y );
	const pn = new Map( pids.map( ( p, i ) => [ p, i ] ) ), mn = new Map( mids.map( ( m, i ) => [ m, i ] ) );
	const P = ( p ) => ( typeof p === 'number' && pn.has( p ) ? pn.get( p ) : -1 );
	const songsIn = new Set( cuts.map( ( [ , c ] ) => c.song ) );
	ties.forEach( ( [ , , evs ] ) => evs.forEach( ( e ) => ( e[ 3 ] || [] ).forEach( ( s ) => songsIn.add( s ) ) ) );
	const cids = new Set( cuts.map( ( [ cid ] ) => cid ) );
	const pick = ( o, ok ) => Object.fromEntries( Object.entries( o || {} ).filter( ok ) );
	return {
		v: g.v, built: g.built || '', month: g.month || null, featured: [],
		people: pids.map( ( p ) => g.people[ p ] ),
		music: mids.map( ( m ) => g.music[ m ] ),
		made: mids.map( ( m ) => ( ( g.made && g.made[ m ] ) || [] ).map( P ).filter( ( p ) => p >= 0 ) ),
		cast: mids.map( ( m ) => ( ( g.cast && g.cast[ m ] ) || [] ).filter( ( c ) => pn.has( c[ 0 ] ) ).map( ( c ) => [ P( c[ 0 ] ), ...c.slice( 1 ) ] ) ),
		ties: ties.map( ( [ a, b, evs ] ) => [ P( a ), P( b ), evs.map( ( e ) => [ mn.get( e[ 0 ] ), ...e.slice( 1 ) ] ) ] ),
		songs: pick( g.songs, ( [ s ] ) => songsIn.has( s ) ),
		songcast: Object.fromEntries( cuts.map( ( [ cid, c ] ) => [ cid, Object.assign( {}, c, {
			on: ( c.on || [] ).filter( ( m ) => mn.has( m ) ).map( ( m ) => mn.get( m ) ),
			artist: P( c.artist ),
			writers: ( c.writers || [] ).map( P ),
			pickers: ( c.pickers || [] ).filter( ( p ) => pn.has( p[ 0 ] ) ).map( ( p ) => [ P( p[ 0 ] ), ...p.slice( 1 ) ] )
		} ) ] ) ),
		plays: pick( g.plays, ( [ , cid ] ) => cids.has( cid ) )
	};
}

/**
 * A kept graph as the text its ID is made from and its page holds: JSON in plain ASCII (the wiki would
 * otherwise normalize a name's accents, and the ID would no longer match), with no "<" to end its <pre>.
 */
export function keptText( doc ) {
	return JSON.stringify( doc ).replace( /[<\u007f-\uffff]/g, ( c ) => '\\u' + c.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' ) );
}

/** A kept graph's ID: its kind's letter and the first fifty bits of its text's SHA-256, so the same graph kept twice is one page. */
export async function keptId( kind, text ) {
	const d = new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( text ) ) );
	let id = kind, n = 0, bits = 0;
	for ( const byte of d ) {
		n = ( ( n << 8 ) | byte ) & 0xffff;
		bits += 8;
		while ( bits >= 5 && id.length < 11 ) {
			bits -= 5;
			id += B32[ ( n >> bits ) & 31 ];
		}
		if ( id.length === 11 ) {
			break;
		}
	}
	return id;
}

/** Two pickers' names, as one key: the same whichever is first. */
export function pairName( x, y ) {
	return x < y ? x + '\n' + y : y + '\n' + x;
}

/**
 * What has become of a kept graph's ties since (Justin, 16 Nov 2026: "if you pull up an old one that's no longer
 * valid, that needs to be indicated"). For each tie among those in sight, by the two pickers' names: 'same' while
 * every record and show it named (by its key) still ties those two today, more or not; 'changed' when some no
 * longer does; 'gone' when none does, or the two aren't tied at all now. And how many ties among them are new.
 *
 * @param {Object} kept The kept graph, built.
 * @param {Object} now Today's graph, built.
 * @param {string[]} sight The names that were in sight.
 * @return {{ state: Map<string, string>, changed: number, gone: number, grown: number }}
 */
export function since( kept, now, sight ) {
	const state = new Map();
	let changed = 0, gone = 0, grown = 0;
	const id = ( G, name ) => G.byName.get( String( name ).toLowerCase() );
	const names = [ ...new Set( sight ) ];
	for ( let i = 0; i < names.length; i++ ) {
		for ( let j = i + 1; j < names.length; j++ ) {
			const ka = id( kept, names[ i ] ), kb = id( kept, names[ j ] ), na = id( now, names[ i ] ), nb = id( now, names[ j ] );
			const was = ka !== undefined && kb !== undefined ? kept.adj[ ka ].get( kb ) : null;
			const is = na !== undefined && nb !== undefined ? now.adj[ na ].get( nb ) : null;
			if ( !was ) {
				grown += is ? 1 : 0;
				continue;
			}
			const have = new Set( is ? is.ev.map( ( e ) => now.music[ e.m ].key ) : [] );
			const keys = [ ...new Set( was.ev.map( ( e ) => kept.music[ e.m ].key ) ) ];
			const still = keys.filter( ( k ) => have.has( k ) ).length;
			const s = still === keys.length ? 'same' : ( still ? 'changed' : 'gone' );
			changed += s === 'changed' ? 1 : 0;
			gone += s === 'gone' ? 1 : 0;
			state.set( pairName( names[ i ], names[ j ] ), s );
		}
	}
	return { state, changed, gone, grown };
}

/* ------------------------------------------------------------------------------------------------------------
 * A QR code of where the reader is (Justin, #connectome, 16 Nov 2026: "always a QR code visible. So if I'm
 * showing someone one, they can take a QR code of it with their phone and pick up right where I left off").
 * The standard's byte mode, levels L and M, versions 1 to 40, written here as the rest of the graph is: no
 * library. After Project Nayuki's QR Code generator (MIT), which explains every step.
 * --------------------------------------------------------------------------------------------------------- */

const QR_ECC = { L: [ -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 ],
	M: [ -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28 ] };
const QR_BLOCKS = { L: [ -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25 ],
	M: [ -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49 ] };
const QR_FORMAT = { L: 1, M: 0 };

function qrRawModules( ver ) {
	let n = ( 16 * ver + 128 ) * ver + 64;
	if ( ver >= 2 ) {
		const align = Math.floor( ver / 7 ) + 2;
		n -= ( 25 * align - 10 ) * align - 55;
		if ( ver >= 7 ) {
			n -= 36;
		}
	}
	return n;
}

const qrDataBytes = ( ver, ecl ) => Math.floor( qrRawModules( ver ) / 8 ) - QR_ECC[ ecl ][ ver ] * QR_BLOCKS[ ecl ][ ver ];

function gfMul( x, y ) {                                 // in GF(2^8), modulo x^8 + x^4 + x^3 + x^2 + 1
	let z = 0;
	for ( let i = 7; i >= 0; i-- ) {
		z = ( z << 1 ) ^ ( ( z >>> 7 ) * 0x11d );
		z ^= ( ( y >>> i ) & 1 ) * x;
	}
	return z & 0xff;
}

function rsDivisor( degree ) {
	const out = new Array( degree ).fill( 0 );
	out[ degree - 1 ] = 1;
	let root = 1;
	for ( let i = 0; i < degree; i++ ) {
		for ( let j = 0; j < degree; j++ ) {
			out[ j ] = gfMul( out[ j ], root );
			if ( j + 1 < degree ) {
				out[ j ] ^= out[ j + 1 ];
			}
		}
		root = gfMul( root, 0x02 );
	}
	return out;
}

function rsRemainder( data, divisor ) {
	const out = new Array( divisor.length ).fill( 0 );
	for ( const b of data ) {
		const factor = b ^ out.shift();
		out.push( 0 );
		divisor.forEach( ( c, i ) => {
			out[ i ] ^= gfMul( c, factor );
		} );
	}
	return out;
}

/**
 * A QR code for some text, as rows of 1 (dark) and 0. The smallest version that holds it; the mask with the
 * lowest penalty unless one is asked for.
 *
 * @param {string} text
 * @param {string} ecl 'L' or 'M'.
 * @param {number} mask 0 to 7, or -1 to choose.
 * @return {{ version: number, mask: number, size: number, rows: number[][] }}
 */
export function qrCode( text, ecl = 'L', mask = -1 ) {
	const bytes = [ ...new TextEncoder().encode( text ) ];
	let ver = 1;
	for ( ; ver <= 40; ver++ ) {
		if ( 4 + ( ver <= 9 ? 8 : 16 ) + 8 * bytes.length <= qrDataBytes( ver, ecl ) * 8 ) {
			break;
		}
	}
	if ( ver > 40 ) {
		throw new RangeError( 'too long for a QR code' );
	}
	const cap = qrDataBytes( ver, ecl ) * 8, bits = [];
	const put = ( v, n ) => {
		for ( let i = n - 1; i >= 0; i-- ) {
			bits.push( ( v >>> i ) & 1 );
		}
	};
	put( 4, 4 );
	put( bytes.length, ver <= 9 ? 8 : 16 );
	bytes.forEach( ( b ) => put( b, 8 ) );
	put( 0, Math.min( 4, cap - bits.length ) );
	put( 0, ( 8 - bits.length % 8 ) % 8 );
	for ( let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11 ) {
		put( pad, 8 );
	}
	const data = [];
	for ( let i = 0; i < bits.length; i += 8 ) {
		data.push( bits.slice( i, i + 8 ).reduce( ( a, b ) => ( a << 1 ) | b, 0 ) );
	}
	// The error correction, block by block, then the blocks interleaved.
	const nb = QR_BLOCKS[ ecl ][ ver ], eccLen = QR_ECC[ ecl ][ ver ], raw = Math.floor( qrRawModules( ver ) / 8 );
	const shorts = nb - raw % nb, shortLen = Math.floor( raw / nb ), div = rsDivisor( eccLen ), blocks = [];
	for ( let i = 0, k = 0; i < nb; i++ ) {
		const dat = data.slice( k, k + shortLen - eccLen + ( i < shorts ? 0 : 1 ) );
		k += dat.length;
		const ecc = rsRemainder( dat, div );
		if ( i < shorts ) {
			dat.push( 0 );
		}
		blocks.push( dat.concat( ecc ) );
	}
	const words = [];
	for ( let i = 0; i < blocks[ 0 ].length; i++ ) {
		blocks.forEach( ( b, j ) => {
			if ( i !== shortLen - eccLen || j >= shorts ) {
				words.push( b[ i ] );
			}
		} );
	}
	// The patterns every code has, then the data, then the mask.
	const size = ver * 4 + 17;
	const dark = Array.from( { length: size }, () => new Array( size ).fill( 0 ) );
	const fixed = Array.from( { length: size }, () => new Array( size ).fill( false ) );
	const set = ( x, y, on ) => {
		dark[ y ][ x ] = on ? 1 : 0;
		fixed[ y ][ x ] = true;
	};
	for ( let i = 0; i < size; i++ ) {
		set( 6, i, i % 2 === 0 );
		set( i, 6, i % 2 === 0 );
	}
	for ( const [ cx, cy ] of [ [ 3, 3 ], [ size - 4, 3 ], [ 3, size - 4 ] ] ) {
		for ( let dy = -4; dy <= 4; dy++ ) {
			for ( let dx = -4; dx <= 4; dx++ ) {
				const d = Math.max( Math.abs( dx ), Math.abs( dy ) ), x = cx + dx, y = cy + dy;
				if ( x >= 0 && x < size && y >= 0 && y < size ) {
					set( x, y, d !== 2 && d !== 4 );
				}
			}
		}
	}
	const align = [];
	if ( ver > 1 ) {
		const n = Math.floor( ver / 7 ) + 2, step = ver === 32 ? 26 : Math.ceil( ( ver * 4 + 4 ) / ( n * 2 - 2 ) ) * 2;
		align.push( 6 );
		for ( let pos = size - 7; align.length < n; pos -= step ) {
			align.splice( 1, 0, pos );
		}
	}
	align.forEach( ( ay, i ) => align.forEach( ( ax, j ) => {
		if ( ( i === 0 && j === 0 ) || ( i === 0 && j === align.length - 1 ) || ( i === align.length - 1 && j === 0 ) ) {
			return;
		}
		for ( let dy = -2; dy <= 2; dy++ ) {
			for ( let dx = -2; dx <= 2; dx++ ) {
				set( ax + dx, ay + dy, Math.max( Math.abs( dx ), Math.abs( dy ) ) !== 1 );
			}
		}
	} ) );
	const format = ( m ) => {
		const d = ( QR_FORMAT[ ecl ] << 3 ) | m;
		let rem = d;
		for ( let i = 0; i < 10; i++ ) {
			rem = ( rem << 1 ) ^ ( ( rem >>> 9 ) * 0x537 );
		}
		const b = ( ( d << 10 ) | rem ) ^ 0x5412, bit = ( i ) => ( ( b >>> i ) & 1 ) === 1;
		for ( let i = 0; i <= 5; i++ ) {
			set( 8, i, bit( i ) );
		}
		set( 8, 7, bit( 6 ) );
		set( 8, 8, bit( 7 ) );
		set( 7, 8, bit( 8 ) );
		for ( let i = 9; i < 15; i++ ) {
			set( 14 - i, 8, bit( i ) );
		}
		for ( let i = 0; i < 8; i++ ) {
			set( size - 1 - i, 8, bit( i ) );
		}
		for ( let i = 8; i < 15; i++ ) {
			set( 8, size - 15 + i, bit( i ) );
		}
		set( 8, size - 8, true );
	};
	format( 0 );
	if ( ver >= 7 ) {
		let rem = ver;
		for ( let i = 0; i < 12; i++ ) {
			rem = ( rem << 1 ) ^ ( ( rem >>> 11 ) * 0x1f25 );
		}
		const b = ( ver << 12 ) | rem;
		for ( let i = 0; i < 18; i++ ) {
			const on = ( ( b >>> i ) & 1 ) === 1, a = size - 11 + i % 3, c = Math.floor( i / 3 );
			set( a, c, on );
			set( c, a, on );
		}
	}
	let i = 0;
	for ( let right = size - 1; right >= 1; right -= 2 ) {
		if ( right === 6 ) {
			right = 5;
		}
		for ( let v = 0; v < size; v++ ) {
			for ( let j = 0; j < 2; j++ ) {
				const x = right - j, up = ( ( right + 1 ) & 2 ) === 0, y = up ? size - 1 - v : v;
				if ( !fixed[ y ][ x ] && i < words.length * 8 ) {
					dark[ y ][ x ] = ( words[ i >>> 3 ] >>> ( 7 - ( i & 7 ) ) ) & 1;
					i++;
				}
			}
		}
	}
	const MASKS = [ ( x, y ) => ( x + y ) % 2 === 0, ( x, y ) => y % 2 === 0, ( x ) => x % 3 === 0, ( x, y ) => ( x + y ) % 3 === 0,
		( x, y ) => ( Math.floor( x / 3 ) + Math.floor( y / 2 ) ) % 2 === 0, ( x, y ) => x * y % 2 + x * y % 3 === 0,
		( x, y ) => ( x * y % 2 + x * y % 3 ) % 2 === 0, ( x, y ) => ( ( x + y ) % 2 + x * y % 3 ) % 2 === 0 ];
	const flip = ( m ) => {
		for ( let y = 0; y < size; y++ ) {
			for ( let x = 0; x < size; x++ ) {
				if ( !fixed[ y ][ x ] && MASKS[ m ]( x, y ) ) {
					dark[ y ][ x ] ^= 1;
				}
			}
		}
	};
	let best = mask;
	if ( best < 0 ) {
		let least = Infinity;
		for ( let m = 0; m < 8; m++ ) {
			flip( m );
			format( m );
			const p = qrPenalty( dark );
			if ( p < least ) {
				least = p;
				best = m;
			}
			flip( m );
		}
	}
	flip( best );
	format( best );
	return { version: ver, mask: best, size, rows: dark };
}

/** The standard's penalty for a masked code: runs of five or more, 2x2 blocks, finder-like patterns, and imbalance. */
function qrPenalty( rows ) {
	const size = rows.length;
	let p = 0, darkCount = 0;
	const lines = [];
	for ( let y = 0; y < size; y++ ) {
		lines.push( rows[ y ].join( '' ) );
		lines.push( rows.map( ( r ) => r[ y ] ).join( '' ) );
		darkCount += rows[ y ].reduce( ( a, b ) => a + b, 0 );
	}
	for ( const line of lines ) {
		for ( const run of line.match( /0{5,}|1{5,}/g ) || [] ) {
			p += run.length - 2;
		}
		const padded = '0000' + line + '0000';
		for ( let i = 0; ( i = padded.indexOf( '1011101', i ) ) !== -1; i++ ) {
			if ( padded.slice( i - 4, i ) === '0000' || padded.slice( i + 7, i + 11 ) === '0000' ) {
				p += 40;
			}
		}
	}
	for ( let y = 0; y + 1 < size; y++ ) {
		for ( let x = 0; x + 1 < size; x++ ) {
			const c = rows[ y ][ x ];
			if ( c === rows[ y ][ x + 1 ] && c === rows[ y + 1 ][ x ] && c === rows[ y + 1 ][ x + 1 ] ) {
				p += 3;
			}
		}
	}
	const total = size * size;
	p += Math.floor( Math.abs( darkCount * 20 - total * 10 ) / total ) * 10;
	return p;
}

/** A QR code as one SVG path, a module a unit, inside a quiet zone of four. */
export function qrPath( code ) {
	let d = '';
	code.rows.forEach( ( row, y ) => row.forEach( ( on, x ) => {
		if ( on ) {
			d += `M${ x + 4 } ${ y + 4 }h1v1h-1z`;
		}
	} ) );
	return { d, side: code.size + 8 };
}
