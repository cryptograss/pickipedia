/*
 * Tests for assets/connectome/connectome-core.js: what the big graph decides, with no page under it.
 *
 *     node --test tools/test_connectome_core.mjs
 *
 * The graph here is shaped like graph.json (tools/connectome_graph.py): eight pickers, a handful of tapes and
 * records, and a choir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../assets/connectome/connectome-core.js';

const NAMES = [ 'Kyle', 'Justin', 'Molly', 'Vickie', 'Sam', 'Far', 'Lone', 'Choir' ];
const [ KYLE, JUSTIN, MOLLY, VICKIE, SAM, FAR, LONE, CHOIR ] = NAMES.map( ( _, i ) => i );
const MUSIC = [
	[ 'arthel:4masks', 'record', '', '', '4masks', 2, 'gh/silver-44.yaml', '/wiki/4masks' ],
	[ 'lma:sgp', 'show', 'Sam Grisman Project', '2025-07-05', 'SGP Live at Grassfire on 2025-07-05', 2, 'https://archive.org/details/sgp', '' ],
	[ 'discogs:7', 'record', 'Alison Brown', '2025', 'Safe, Sensible And Sane', 1, 'https://www.discogs.com/release/7', '' ],
	[ 'discogs:8', 'record', 'X', '2024', 'Streamed', 0, 'https://www.discogs.com/release/8', '' ],
	[ 'lma:old', 'show', 'Sam Bush Band', '2019-06-12', 'Sam Bush Band Live', 2, 'https://archive.org/details/old', '' ],
	[ 'arthel:show:0-1', 'show', '', 'block 11908068', 'Hello Decentralization', 2, 'gh/show.yaml', '' ]
];
const GRAPH = {
	v: 1, built: '2026-11-13', month: '2026-11', featured: [ JUSTIN ],
	people: NAMES.map( ( n, i ) => [ n, i < 3 ? 1 : 0, i === KYLE ? 'banjo' : '' ] ),
	music: MUSIC,
	cast: MUSIC.map( () => [] ),
	ties: [
		[ KYLE, JUSTIN, [ [ 0, 3, 0.5, [ 'Silver 44', 'Victory' ] ], [ 5, 2, 1, [] ] ] ],
		[ KYLE, MOLLY, [ [ 1, 2, 0.5, [] ], [ 4, 2, 0.25, [] ] ] ],
		[ JUSTIN, MOLLY, [ [ 2, 3, 1, [ 'A Duet' ] ] ] ],          // a Full Release
		[ KYLE, SAM, [ [ 4, 2, 0.25, [] ] ] ],
		[ JUSTIN, SAM, [ [ 3, 3, 1, [ 'Unknown' ] ] ] ],          // not known to be DRM-free
		[ KYLE, CHOIR, [ [ 2, 1, 0.01, [] ] ] ],                  // the same record, never the same track
		[ JUSTIN, CHOIR, [ [ 2, 1, 0.01, [] ] ] ],
		[ MOLLY, VICKIE, [ [ 2, 3, 1, [ 'Girl, Have Money When You\'re Old' ] ] ] ],
		[ VICKIE, FAR, [ [ 3, 1, 0.5, [] ] ] ]
	],
	songs: { 'Silver 44': '/wiki/Song:Silver_44' },
	plays: { 'Silver 44': 'QmSilver44/x y', 'A Duet': 'QmSomeoneElses' }
};
const G = K.build( GRAPH );
const tie = ( a, b ) => G.adj[ a ].get( b );

test( 'a tie adds up what two pickers share, shows and records apart', () => {
	const t = tie( KYLE, JUSTIN );
	assert.equal( t.played, true );
	assert.deepEqual( [ t.times, t.shows, t.records, t.tracks, t.tier ], [ 2, 1, 1, 2, K.PERMANENT ] );
	assert.equal( t.w, 1.5 );
	assert.equal( K.together( t ), '1 show and 2 tracks on 1 record together' );
	assert.equal( K.together( tie( JUSTIN, MOLLY ) ), '1 record together' );
	assert.equal( K.times( t ), '1 show, 1 record' );
} );

test( 'a challenge names its goal by the address, an underscore for a space', () => {
	assert.equal( K.challengeOf( '/bacon/challenge/Vickie_Vaughn', '' ), 'Vickie Vaughn' );
	assert.equal( K.challengeOf( '/bacon/challenge/Bronwyn%20Keith-Hynes/', '' ), 'Bronwyn Keith-Hynes' );
	assert.equal( K.challengeOf( '/bacon', '?challenge=Kyle+Tuttle' ), 'Kyle Tuttle' );
	assert.equal( K.challengeOf( '/bacon/challenge/100%_Bad', '' ), '100% Bad' );
	assert.equal( K.challengeOf( '/bacon', '?p=Kyle' ), null );
	assert.equal( K.challengeOf( '/bacon/challengers', '' ), null );
	assert.equal( K.challengeOf( '/bacon/challenge/a/b', '' ), null );
} );

test( 'a challenge that names no one asks for someone at random (Justin, 19 Nov 2026)', () => {
	assert.equal( K.challengeOf( '/bacon/challenge', '' ), '' );
	assert.equal( K.challengeOf( '/bacon/challenge/', '?p=Kyle' ), '' );
	assert.equal( K.challengeOf( '/bacon/challenge/_', '' ), '' );
	assert.equal( K.challengeOf( '/bacon', '?challenge' ), '' );
	assert.equal( K.challengeOf( '/bacon', '?challenge=' ), '' );
} );

test( 'someone at random to find: one a start three or four jumps out leads to, else one anything leads to', () => {
	// Nobody here is landable, and of the three with pages (Kyle, Justin, Molly) none has anyone three out: then
	// anyone, and only Vickie and Sam are three apart, by playing together.
	assert.equal( K.challengeGoal( G, () => 0 ), VICKIE );
	assert.equal( K.challengeGoal( G, () => 0.99 ), SAM );
	// No start that far out for anyone: then anyone a start leads to at all, a page first (Kyle, at 0).
	assert.equal( K.challengeGoal( G, () => 0, [ 5, 6 ] ), KYLE );
	// Whoever it picks, a challenge can start there.
	for ( const r of [ 0, 0.3, 0.6, 0.99 ] ) {
		assert.notEqual( K.challengeStart( G, K.challengeGoal( G, () => r ), () => r ), null );
	}
	// Nobody plays with anybody: nobody to find.
	assert.equal( K.challengeGoal( K.build( Object.assign( {}, GRAPH, { ties: [] } ) ), () => 0 ), null );
} );

test( 'the Oracle starts from a Permanent studio track, or a picker on one (Justin, 19 Nov 2026)', () => {
	const items = K.oracleItems( G );
	const tracks = items.filter( ( it ) => it.kind === 'track' ).map( ( it ) => G.pieces[ it.piece ] );
	// 4masks is Permanent: its two tracks, Silver 44 and Victory, both Kyle and Justin's. A Duet is on a Full Release.
	assert.deepEqual( tracks.map( ( t ) => t.song ).sort(), [ 'Silver 44', 'Victory' ] );
	assert.deepEqual( items.filter( ( it ) => it.kind === 'picker' ).map( ( it ) => it.id ), [ KYLE, JUSTIN ] );
	// No goal: all four, a track and a picker among them.
	const four = K.oraclePick( G, undefined, () => 0.5 );
	assert.equal( four.length, 4 );
	assert.ok( four.some( ( it ) => it.kind === 'track' ) && four.some( ( it ) => it.kind === 'picker' ) );
	// Finding Vickie: everyone here is two jumps from her, so all four.
	assert.equal( K.oraclePick( G, VICKIE, () => 0 ).length, 4 );
	// Finding Kyle: not Kyle, not a track with Kyle on it; Justin, one jump away, is all that's left.
	assert.deepEqual( K.oraclePick( G, KYLE, () => 0 ), [ { kind: 'picker', id: JUSTIN } ] );
	// Finding someone nobody here leads to: nowhere to start.
	assert.deepEqual( K.oraclePick( G, LONE, () => 0 ), [] );
} );

test( 'the Oracle sets someone to find four of its places are three to six jumps from; failing that, challengeGoal\'s', () => {
	// Here everyone is a jump or two from Kyle and Justin, so nobody is that far: challengeGoal's pick, Vickie.
	assert.equal( K.oracleGoal( G, () => 0 ), VICKIE );
} );

test( 'a track opens as its song\'s view where a page charts a cut of it, else as itself', () => {
	const silver = G.pieces.find( ( p ) => p.kind === 'track' && p.song === 'Silver 44' ).id;
	assert.deepEqual( K.trackView( G, silver ), { m: silver } );
	const G2 = K.build( Object.assign( {}, GRAPH, { songcast: { QmS44: { song: 'Silver 44', on: [ 0 ], pickers: [ [ KYLE, 'banjo', 'banjo' ] ] } } } ) );
	assert.deepEqual( K.trackView( G2, silver ), { s: 'Silver 44', cut: 'QmS44' } );
} );

test( 'a challenge starts three or four jumps out, at a picker with a page where there is one', () => {
	// Vickie, by playing together: Molly 1, Kyle and Justin 2 (pages), Sam 3 (no page); Far and Choir only share records
	assert.deepEqual( K.challengeStart( G, VICKIE, () => 0 ), { from: SAM, par: 3 } );
	// three with pages in reach (Molly, Kyle, Justin): one of them, never Sam
	assert.deepEqual( K.challengeStart( G, VICKIE, () => 0.99, [ 1, 3 ] ), { from: MOLLY, par: 1 } );
	// two with pages are too few to choose among: everyone in reach, Sam too
	assert.deepEqual( K.challengeStart( G, VICKIE, () => 0, [ 2, 3 ] ), { from: KYLE, par: 2 } );
	assert.deepEqual( K.challengeStart( G, VICKIE, () => 0.99, [ 2, 3 ] ), { from: SAM, par: 3 } );
	// Molly: nobody three out, so the farthest there is: Sam, at 2
	assert.deepEqual( K.challengeStart( G, MOLLY, () => 0 ), { from: SAM, par: 2 } );
	assert.equal( K.challengeStart( G, LONE, () => 0 ), null );     // nobody leads to someone alone
	assert.equal( K.challengeStart( G, FAR, () => 0 ), null );      // nor to one who only shares a record
	// Choir only shares a record with Kyle and Justin: the record is a hop, but no jump
	assert.equal( K.hops( G, KYLE, CHOIR ), 1 );
	assert.equal( K.playedDistances( G, KYLE )[ CHOIR ], -1 );
} );

test( 'the way taken loses its loops, and says its songs that play', () => {
	const { way, steps } = K.wayOf( G, [ SAM, KYLE, MOLLY, KYLE, JUSTIN, MOLLY, VICKIE ] );
	assert.deepEqual( way, [ SAM, KYLE, JUSTIN, MOLLY, VICKIE ] );
	assert.deepEqual( steps.map( ( st ) => [ st.u, st.v, !!st.tie ] ), [ [ SAM, KYLE, true ], [ KYLE, JUSTIN, true ], [ JUSTIN, MOLLY, true ], [ MOLLY, VICKIE, true ] ] );
	assert.equal( K.wayOf( G, [ KYLE, LONE ] ).steps[ 0 ].tie, null );      // a name typed in: no line to it
	// a step further out is two jumps, by way of someone who played with both
	assert.equal( K.bridgeOf( G, SAM, MOLLY ), KYLE );
	assert.equal( K.bridgeOf( G, SAM, MOLLY, [ JUSTIN ] ), JUSTIN );
	assert.equal( K.bridgeOf( G, SAM, VICKIE ), undefined );
	// Silver 44 plays (an arthel record); A Duet has a cid but sits on a Discogs record, so it doesn't
	assert.deepEqual( K.wayPlays( G, steps ).map( ( x ) => x.song ), [ 'Silver 44' ] );
	assert.equal( K.wayPlays( G, steps )[ 0 ].to, '/rabbithole/?track=' + encodeURIComponent( 'QmSilver44/x y' ) );
} );

test( 'the same record without the same track is a tie, but not playing together', () => {
	const t = tie( KYLE, CHOIR );
	assert.equal( t.played, false );
	assert.equal( t.times, 0 );
	assert.equal( K.times( t ), 'same record' );
	assert.match( K.together( t ), /no source puts them on the same track/ );
} );

test( 'a tie lists Permanent Releases first, then the newest', () => {
	assert.deepEqual( tie( KYLE, MOLLY ).ev.map( ( e ) => G.music[ e.m ].key ), [ 'lma:sgp', 'lma:old' ] );
	const mixed = K.summarize( 0, 1, [ { m: 2, how: 3, w: 1, songs: [] }, { m: 4, how: 2, w: 1, songs: [] }, { m: 3, how: 1, w: 1, songs: [] } ], G.music );
	assert.deepEqual( mixed.ev.map( ( e ) => G.music[ e.m ].tier ), [ 2, 1, 0 ] );
} );

test( 'the newest comes first, whichever way its source wrote the date', () => {
	const order = [ '2019-06-12', 'block 11908068', '3 April, 2024', '2025', 'block 23000000', '', 'sometime' ]
		.sort( ( x, y ) => K.roughly( y ) - K.roughly( x ) || 0 );
	assert.deepEqual( order.slice( 0, 5 ), [ 'block 23000000', '2025', '3 April, 2024', 'block 11908068', '2019-06-12' ] );
	assert.equal( K.roughly( '' ), -Infinity );
} );

test( 'every tier counts toward how close two are; a Permanent Release counts for more toward who is named', () => {
	const full = tie( JUSTIN, MOLLY ), unknown = tie( JUSTIN, SAM );
	assert.equal( full.w, unknown.w );                              // as close as each other
	assert.ok( full.eff > unknown.eff );                            // but the Full Release is named before the unknown
	assert.ok( tie( KYLE, JUSTIN ).eff > full.eff );
} );

test( "a picker's company is who they played with, the closest first", () => {
	assert.deepEqual( K.company( G, KYLE ).map( ( c ) => NAMES[ c.id ] ), [ 'Justin', 'Molly', 'Sam' ] );
	assert.deepEqual( K.company( G, KYLE, true ).map( ( c ) => NAMES[ c.id ] ), [ 'Justin', 'Molly', 'Sam', 'Choir' ] );
	assert.deepEqual( K.company( G, LONE ), [] );
} );

test( 'who both have played with: those who played with both first, a route as strong as its weaker leg', () => {
	const m = K.mutuals( G, KYLE, JUSTIN );
	assert.deepEqual( m.map( ( x ) => NAMES[ x.id ] ), [ 'Molly', 'Sam', 'Choir' ] );
	assert.deepEqual( m.map( ( x ) => x.played ), [ true, true, false ] );
	assert.equal( m[ 0 ].w, 0.75 );                                 // Kyle–Molly 0.75, Molly–Justin 1: the weaker
	assert.equal( m[ 0 ].tier, K.FULL );                            // a route is as free as its least free leg
	assert.equal( m[ 0 ].ta, tie( KYLE, MOLLY ) );
	assert.equal( m[ 0 ].tb, tie( JUSTIN, MOLLY ) );
	assert.deepEqual( K.mutuals( G, JUSTIN, KYLE ).map( ( x ) => NAMES[ x.id ] ), [ 'Molly', 'Sam', 'Choir' ] );
	assert.equal( K.mutuals( G, JUSTIN, KYLE )[ 0 ].ta, tie( JUSTIN, MOLLY ) );
} );

// Two ends, and between them: Abe, who sat in once with each, on tape; Zeke, on tape with both and close to one;
// Pressed, on tape with one and on four tracks of a CD with the other. Then two ways across three hops.
const FREE = K.build( {
	people: [ 'A', 'B', 'Abe', 'Zeke', 'Pressed', 'S', 'T', 'M1', 'N1', 'M2', 'N2' ].map( ( n ) => [ n, 0, '' ] ),
	music: [ [ 'lma:1', 'show', 'Band', '2025-01-01', 'A tape', 2, '', '' ], [ 'discogs:1', 'record', 'X', '2024', 'A CD', 1, '', '' ] ],
	ties: [
		[ 0, 2, [ [ 0, 2, 0.2, [] ] ] ], [ 1, 2, [ [ 0, 2, 0.2, [] ] ] ],
		[ 0, 3, [ [ 0, 2, 1, [] ] ] ], [ 1, 3, [ [ 0, 2, 0.2, [] ] ] ],
		[ 0, 4, [ [ 0, 2, 1, [] ] ] ], [ 1, 4, [ [ 1, 3, 4, [ 'a', 'b', 'c', 'd' ] ] ] ],
		[ 5, 7, [ [ 0, 2, 0.2, [] ] ] ], [ 7, 8, [ [ 0, 2, 0.2, [] ] ] ], [ 8, 6, [ [ 0, 2, 0.2, [] ] ] ],
		[ 5, 9, [ [ 0, 2, 1, [] ] ] ], [ 9, 10, [ [ 1, 3, 4, [ 'a', 'b', 'c', 'd' ] ] ] ], [ 10, 6, [ [ 0, 2, 1, [] ] ] ]
	]
} );
const free = ( list ) => list.map( ( x ) => FREE.people[ x.id === undefined ? x : x.id ].name );

test( 'a route Permanent on both legs is named before one with a less free leg, however much that one played', () => {
	const m = K.mutuals( FREE, 0, 1 );
	assert.ok( m[ 2 ].eff > m[ 0 ].eff, 'the CD route is the stronger, and still comes last' );
	assert.deepEqual( m.map( ( x ) => x.tier ), [ K.PERMANENT, K.PERMANENT, K.FULL ] );
	assert.deepEqual( free( m ), [ 'Zeke', 'Abe', 'Pressed' ] );    // and of two as strong, the one closer on its other leg
	assert.deepEqual( free( K.mutuals( FREE, 1, 0 ) ), [ 'Zeke', 'Abe', 'Pressed' ] );
} );

test( "in a picker's company, anyone on a Permanent Release with them comes before anyone who isn't", () => {
	assert.deepEqual( free( K.company( FREE, 1 ) ), [ 'Abe', 'Zeke', 'Pressed' ] );
	assert.ok( K.loudness( FREE.adj[ 1 ].get( 2 ) ) > K.loudness( FREE.adj[ 1 ].get( 4 ) ) );
	assert.ok( K.loudness( tie( KYLE, SAM ) ) > K.loudness( tie( KYLE, CHOIR ) ), 'playing together before sharing a record' );
} );

test( 'across three hops, a chain of Permanent Releases comes before a stronger one with a CD in it', () => {
	const r = K.routes( FREE, 5, 6 );
	assert.equal( r.hops, 3 );
	assert.deepEqual( r.chains.map( free ), [ [ 'S', 'M1', 'N1', 'T' ], [ 'S', 'M2', 'N2', 'T' ] ] );
} );

test( 'hops: a same-record tie is a hop; with no way, -1', () => {
	assert.equal( K.hops( G, KYLE, JUSTIN ), 1 );
	assert.equal( K.hops( G, KYLE, VICKIE ), 2 );
	assert.equal( K.hops( G, KYLE, FAR ), 3 );
	assert.equal( K.hops( G, KYLE, LONE ), -1 );
	assert.equal( K.routes( G, KYLE, LONE ), null );
} );

test( 'routes across three hops are chains from one end to the other, the strongest first', () => {
	const r = K.routes( G, KYLE, FAR );
	assert.equal( r.hops, 3 );
	assert.deepEqual( r.chains.map( ( c ) => c.map( ( id ) => NAMES[ id ] ) ), [ [ 'Kyle', 'Molly', 'Vickie', 'Far' ] ] );
	for ( const chain of r.chains ) {
		for ( let i = 0; i < chain.length - 1; i++ ) {
			assert.ok( tie( chain[ i ], chain[ i + 1 ] ), 'each hop is a tie' );
		}
	}
} );

test( 'names are found whatever their case, and not found when they are not there', () => {
	assert.equal( K.find( G, ' kyle ' ), KYLE );
	assert.equal( K.find( G, 'Nobody' ), null );
	assert.equal( K.find( G, null ), null );
} );

test( 'a date is read only where its shape is certain', () => {
	assert.equal( K.when( '2025-07-05' ), '5 Jul 2025' );
	assert.equal( K.when( 'block 11908068' ), 'block 11,908,068' );
	assert.equal( K.when( '3 April, 2024' ), '3 April, 2024' );
	assert.equal( K.when( '2025' ), '2025' );
	assert.equal( K.when( '2025-13-40' ), '2025-13-40' );
	assert.equal( K.when( '' ), '' );
} );

test( 'music is named by what a reader would call it', () => {
	const [ record, show ] = tie( KYLE, JUSTIN ).ev;               // a Permanent studio track comes before a Permanent show
	assert.deepEqual( K.naming( G, record ), { glyph: 'track', short: 'Silver 44 +1', brief: 'Silver 44', long: '4masks', songs: [ 'Silver 44', 'Victory' ] } );
	assert.equal( K.naming( G, show ).short, 'Hello Decentralization · block 11,908,068' );     // its title, and its night
	const tape = K.naming( G, tie( KYLE, MOLLY ).ev[ 0 ] );
	// a show says its night wherever it's named, so it is never taken for a band (Justin, #connectome, 15 Nov 2026)
	assert.deepEqual( [ tape.glyph, tape.short, tape.brief, tape.who, tape.day ],
		[ 'show', 'Sam Grisman Project · 5 Jul 2025', 'Sam Grisman Project · 5 Jul 2025', 'Sam Grisman Project', '5 Jul 2025' ] );
	assert.equal( K.naming( G, tie( KYLE, CHOIR ).ev[ 0 ] ).glyph, 'record' );
	assert.equal( K.naming( G, tie( KYLE, CHOIR ).ev[ 0 ] ).long, 'Alison Brown – Safe, Sensible And Sane (2025)' );
	assert.equal( K.clip( 'Leftover Salmon', 9 ), 'Leftover…' );
	assert.equal( K.clip( 'Short', 9 ), 'Short' );
} );

/* ---- where things go ---- */

const inside = ( p, W, H, pad = 8 ) => p.x >= pad && p.x <= W - pad && p.y >= pad && p.y <= H - pad;

test( "the ends move in to leave room for their names", () => {
	const plain = K.rainbow( { W: 1020, H: 660, strands: [] } );
	const roomy = K.rainbow( { W: 1020, H: 660, strands: [], la: 200, lb: 60 } );
	assert.ok( roomy.A.x > plain.A.x && roomy.A.x >= 200 );
	assert.equal( roomy.B.x, plain.B.x );
	assert.equal( plain.A.y, 330 );
	assert.equal( plain.B.y, 330 );
} );
test( 'one picker and their company: nobody at noon or at six, everyone in the frame', () => {
	for ( const [ W, H, n ] of [ [ 1020, 660, 8 ], [ 700, 520, 6 ], [ 390, 330, 4 ] ] ) {
		const lay = K.ego( { W, H, named: n, dots: 60 } );
		assert.equal( lay.named.length, n );
		assert.ok( lay.named.every( ( p ) => inside( p, W, H ) ), `${ W }x${ H }` );
		assert.ok( lay.named.every( ( p ) => Math.abs( p.x - lay.C.x ) > 8 ), 'nobody straight above or below' );
		assert.ok( lay.dots.every( ( p ) => inside( p, W, H ) ) );
		assert.ok( lay.dots.every( ( p ) => lay.named.every( ( q ) => Math.hypot( p.x - q.x, p.y - q.y ) > 24 ) ), 'no dot on a name\'s picker' );
	}
	const few = K.ego( { W: 1020, H: 660, named: 8, dots: 5 } );
	assert.equal( few.dots.length, 5 );
	const xs = few.dots.map( ( p ) => p.x );
	assert.ok( Math.max( ...xs ) - Math.min( ...xs ) > 300, 'a few dots are spread round, not bunched' );
} );

test( 'chains of three hops: each chain a row, the first along the middle', () => {
	const lay = K.ladder( { W: 1020, H: 660, hops: 3, chains: 3 } );
	assert.equal( lay.at( 0, 1 ).y, lay.A.y );
	assert.ok( lay.at( 1, 1 ).y < lay.A.y && lay.at( 2, 1 ).y > lay.A.y );
	assert.ok( lay.A.x < lay.at( 0, 1 ).x && lay.at( 0, 1 ).x < lay.at( 0, 2 ).x && lay.at( 0, 2 ).x < lay.B.x );
	assert.deepEqual( lay.at( 0, 3 ), lay.B );
} );

test( 'ways across by two pickers: every hop played, no picker on two ways, none of those asked to be left out', () => {
	const G = K.build( GRAPH );
	const got = K.ways( G, SAM, VICKIE );                         // Sam, Kyle or Justin, Molly, Vickie: Molly is on both, so one way
	assert.equal( got.length, 1 );
	assert.equal( got[ 0 ][ 0 ], SAM );
	assert.ok( [ KYLE, JUSTIN ].includes( got[ 0 ][ 1 ] ) );
	assert.deepEqual( got[ 0 ].slice( 2 ), [ MOLLY, VICKIE ] );
	assert.deepEqual( K.ways( G, SAM, VICKIE, 4, [ MOLLY ] ), [] );
	assert.deepEqual( K.ways( G, SAM, FAR ), [] );                // Vickie and Far only share a record: not a hop of a way
	assert.deepEqual( K.ways( G, SAM, VICKIE, 0 ), [] );
} );

test( 'an arc between two pickers: it starts at one, ends at the other, and stands as high as asked at its middle', () => {
	const A = { x: 100, y: 300 }, B = { x: 900, y: 300 };
	assert.deepEqual( K.onArc( A, B, 120, 0 ), A );
	assert.deepEqual( K.onArc( A, B, 120, 1 ), B );
	assert.deepEqual( K.onArc( A, B, 120, 0.5 ), { x: 500, y: 180 } );
	assert.deepEqual( K.onArc( A, B, -80, 0.5 ), { x: 500, y: 380 } );
	// A stretch of it, drawn as a line bowed from the middle of its ends, lies on the arc.
	for ( const [ t1, t2 ] of [ [ 0, 1 ], [ 0.2, 0.7 ], [ 0.5, 1 ] ] ) {
		const p = K.onArc( A, B, 120, t1 ), q = K.onArc( A, B, 120, t2 ), bow = K.arcBow( A, B, 120, t1, t2 );
		const c = { x: ( p.x + q.x ) / 2 + bow.x, y: ( p.y + q.y ) / 2 + bow.y }, on = K.onArc( A, B, 120, ( t1 + t2 ) / 2 );
		assert.ok( Math.abs( ( p.x + 2 * c.x + q.x ) / 4 - on.x ) < 1e-9 && Math.abs( ( p.y + 2 * c.y + q.y ) / 4 - on.y ) < 1e-9 );
	}
	// Standing up (a phone's ladder), it bows to the side.
	assert.deepEqual( K.onArc( { x: 200, y: 50 }, { x: 200, y: 450 }, 60, 0.5 ), { x: 260, y: 250 } );
} );

test( 'the rainbow between two pickers: the first strand straight, the rest over and under by turns, nothing on anything', () => {
	const name = { r: 14, w: 110 }, bead = { r: 5, w: 70, small: true };
	const strands = [ { half: 15, marks: [ { pill: true, w: 150 } ] }, { half: 3, marks: [] }, { half: 3, marks: [] } ]
		.concat( Array.from( { length: 10 }, () => ( { half: 15, marks: [ name ] } ) ), Array.from( { length: 8 }, () => ( { half: 6.5, marks: [ bead ] } ) ),
			[ { half: 15, marks: [ name, name ] } ] );
	const lay = K.rainbow( { W: 1100, H: 700, la: 80, lb: 80, strands, names: { a: { w: 120, side: 'left' }, b: { w: 120, side: 'right' } } } );
	assert.equal( lay.strands.length, strands.length );
	assert.ok( lay.strands.every( Boolean ) );
	assert.equal( lay.strands[ 0 ].h, 0 );
	assert.deepEqual( lay.strands[ 0 ].marks.map( ( m ) => m.t ), [ 0.5 ] );
	const hs = lay.strands.map( ( st ) => st.h );
	assert.equal( new Set( hs ).size, hs.length );                 // no two at one height: no two cross
	assert.ok( hs.some( ( h ) => h > 0 ) && hs.some( ( h ) => h < 0 ) );
	assert.ok( Math.abs( hs.filter( ( h ) => h > 0 ).length - hs.filter( ( h ) => h < 0 ).length ) <= 2 );
	assert.ok( hs.every( ( h ) => Math.abs( h ) <= 350 - 18 ) );
	for ( const st of lay.strands ) {
		for ( const m of st.marks ) {
			assert.ok( m.x > 0 && m.x < 1100 && m.y > 0 && m.y < 700 );
			assert.deepEqual( { x: m.x, y: m.y }, K.onArc( lay.A, lay.B, st.h, m.t ) );
		}
	}
	const named = lay.strands.flatMap( ( st ) => st.marks ).filter( ( m ) => m.named ).length;
	assert.ok( named >= 16, 'most have their names: ' + named );
	const two = lay.strands[ lay.strands.length - 1 ].marks;      // two on one strand: in order, each name on the side away from the other
	assert.ok( two[ 0 ].t < two[ 1 ].t );
	assert.deepEqual( two.map( ( m ) => m.at ), [ 'left', 'right' ] );
	for ( let i = 0; i < lay.taken.length; i++ ) {                // every box set down is clear of every other
		for ( let j = i + 1; j < lay.taken.length; j++ ) {
			const p = lay.taken[ i ], q = lay.taken[ j ];
			assert.ok( !( p.x1 < q.x2 && p.x2 > q.x1 && p.y1 < q.y2 && p.y2 > q.y1 ), `boxes ${ i } and ${ j }` );
		}
	}
} );

test( 'a rainbow with more strands than the frame holds leaves the outermost out; with few, they spread to fill it', () => {
	const many = Array.from( { length: 40 }, () => ( { half: 15, marks: [ { r: 9, w: 90 } ] } ) );
	const full = K.rainbow( { W: 900, H: 500, strands: many } );
	const drawn = full.strands.filter( Boolean );
	assert.ok( drawn.length < 40 && drawn.length >= 14 );
	assert.ok( full.strands.slice( drawn.length ).every( ( st ) => st === null ) );
	assert.ok( drawn.every( ( st ) => Math.abs( st.h ) + 15 <= 250 - 18 + 0.5 ) );
	const few = Array.from( { length: 5 }, () => ( { half: 15, marks: [ { r: 9, w: 90 } ] } ) );
	const tight = K.rainbow( { W: 900, H: 500, strands: few } ), spread = K.rainbow( { W: 900, H: 500, strands: few, fill: 3 } );
	assert.deepEqual( tight.strands.map( ( st ) => st.h ), [ 0, 30, -30, 60, -60 ] );
	assert.ok( spread.strands.every( Boolean ) );
	assert.equal( spread.strands[ 1 ].h, 90 );                    // three times as far apart, and no further
	assert.ok( Math.max( ...K.rainbow( { W: 900, H: 300, strands: few, fill: 3 } ).strands.map( ( st ) => Math.abs( st.h ) ) ) <= 150 - 18 );
	// A picker in a chain keeps to their own hop, where the frame says where that is.
	const at = K.rainbow( { W: 900, H: 500, strands: [ { half: 15, marks: [ { r: 9, w: 0 }, { r: 9, w: 0 } ], at: [ 1 / 3, 2 / 3 ] } ] } ).strands[ 0 ].marks;
	assert.deepEqual( at.map( ( m ) => m.t ), [ 1 / 3, 2 / 3 ] );
} );

test( "a track plays in Rabbithole only from a record cryptograss cut itself", () => {
	const G = K.build( GRAPH );
	assert.equal( K.playOf( G, G.music[ 0 ], 'Silver 44' ), '/rabbithole/?track=QmSilver44%2Fx%20y' );   // the CID, safe in an address
	assert.equal( K.playOf( G, G.music[ 0 ], 'Victory' ), '' );                // its song page names no track
	assert.equal( K.playOf( G, G.music[ 2 ], 'A Duet' ), '' );                 // another label's record: not the same recording
	assert.equal( K.playOf( G, G.music[ 5 ], 'Silver 44' ), '' );              // cryptograss's own show: a tape, not the cut
	assert.equal( K.playOf( G, G.music[ 1 ], 'Silver 44' ), '' );              // a taper's tape
	const bare = K.build( Object.assign( {}, GRAPH, { plays: undefined } ) );  // a graph.json from before there were any
	assert.equal( K.playOf( bare, bare.music[ 0 ], 'Silver 44' ), '' );
} );

test( 'a name is moved only as far as keeps it in its room', () => {
	assert.equal( K.nudge( 100, 40, 6, 384 ), 0 );                             // it fits where it is
	assert.equal( K.nudge( 30, 40, 6, 384 ), 16 );                             // off the left edge: in by what it lacks
	assert.equal( K.nudge( 370, 40, 6, 384 ), -26 );                           // off the right
	assert.equal( K.nudge( 76, 85, 6, 175 ), 14.5 );                           // an end's long name, kept to its own half
	assert.equal( K.nudge( 76, 120, 6, 175 ), 14.5 );                          // wider than its room: the middle of the room
} );

test( 'in a narrow upright frame the ladder stands up: a at the top, b at the bottom, the other chains beside', () => {
	const lay = K.ladder( { W: 390, H: 540, hops: 3, chains: 3, la: 40, lb: 40 } );
	assert.equal( lay.upright, true );
	assert.ok( lay.A.x === lay.B.x && lay.A.y < 80 && lay.B.y > 460 );
	const lit = [ 1, 2 ].map( ( level ) => lay.at( 0, level ) );
	assert.ok( lit.every( ( p ) => p.x === lay.A.x ) );                         // the first chain: straight down between them
	assert.ok( lay.A.y < lit[ 0 ].y && lit[ 0 ].y < lit[ 1 ].y && lit[ 1 ].y < lay.B.y );
	assert.ok( Math.abs( ( lit[ 1 ].y - lit[ 0 ].y ) - ( lit[ 0 ].y - lay.A.y ) ) <= 1 );   // a hop a rung, evenly (to the pixel)
	assert.ok( 390 - lay.A.x >= 190 );                                          // room beside it for a name
	for ( const c of [ 1, 2 ] ) {
		const p = lay.at( c, 1 );
		assert.ok( p.x < lay.at( c - 1, 1 ).x && p.x >= 22 && p.y === lit[ 0 ].y, `chain ${ c } at ${ p.x }` );
	}
	assert.equal( K.ladder( { W: 844, H: 390, hops: 3, chains: 2, la: 40, lb: 40 } ).upright, undefined );   // a phone on its side
	assert.equal( K.ladder( { W: 1100, H: 700, hops: 3, chains: 3, la: 40, lb: 40 } ).upright, undefined );
} );

/* ---- inside out: the music as the circles, the pickers as the lines ---- */

const SILVER = K.findPiece( G, 'arthel:4masks', 'Silver 44' ), VICTORY = K.findPiece( G, 'arthel:4masks', 'Victory' );
const called = ( id ) => K.called( G, G.pieces[ id ] ).name;

test( 'a piece is a show, a record, or a track where the sources say who is on it', () => {
	assert.equal( G.pieces.length, MUSIC.length + 5 );
	assert.deepEqual( G.pieces.slice( 0, MUSIC.length ).map( ( p ) => p.kind ), [ 'record', 'show', 'record', 'record', 'show', 'show' ] );
	assert.deepEqual( [ G.pieces[ SILVER ].kind, G.pieces[ SILVER ].song, G.pieces[ SILVER ].cast ], [ 'track', 'Silver 44', [ KYLE, JUSTIN ] ] );
	const [ record, show ] = tie( KYLE, JUSTIN ).ev;
	assert.equal( K.pieceFor( G, record ), SILVER );                 // the first track named, of the two they share
	assert.equal( K.pieceFor( G, show ), 5 );
	assert.equal( K.pieceFor( G, tie( KYLE, CHOIR ).ev[ 0 ] ), 2 );  // no source says which track: the record whole
} );

test( "a picker's pieces: the tracks they're on, and a record whole only where no source says which track", () => {
	assert.deepEqual( G.on[ KYLE ].slice().sort( ( x, y ) => x - y ), [ 1, 2, 4, 5, SILVER, VICTORY ] );   // 4masks by its tracks; Alison Brown's record whole
	assert.ok( !G.on[ JUSTIN ].includes( 0 ) && !G.on[ JUSTIN ].includes( 2 ) );
	assert.deepEqual( G.on[ LONE ], [] );
} );

test( 'a piece is found by its key, and a track by its song; a song nobody is named on finds the record', () => {
	assert.equal( K.findPiece( G, 'arthel:4masks' ), 0 );
	assert.equal( G.pieces[ K.findPiece( G, 'arthel:4masks', 'Victory' ) ].song, 'Victory' );
	assert.equal( K.findPiece( G, 'arthel:4masks', 'Not On It' ), 0 );
	assert.equal( K.findPiece( G, 'nope' ), null );
} );

test( 'a piece is called what a reader would call it', () => {
	// no artist said for the record: the record under the cut's name
	assert.deepEqual( K.called( G, G.pieces[ SILVER ] ), { glyph: 'track', name: 'Silver 44', sub: '4masks', on: '4masks', long: '4masks' } );
	assert.deepEqual( [ K.called( G, G.pieces[ 1 ] ).name, K.called( G, G.pieces[ 1 ] ).sub ], [ 'Sam Grisman Project', 'live · 5 Jul 2025' ] );    // a show always says it is one
	assert.deepEqual( [ K.called( G, G.pieces[ 5 ] ).name, K.called( G, G.pieces[ 5 ] ).sub ], [ 'Hello Decentralization', 'live · block 11,908,068' ] );
	assert.deepEqual( [ K.called( G, G.pieces[ 2 ] ).name, K.called( G, G.pieces[ 2 ] ).sub ], [ 'Safe, Sensible And Sane', 'Alison Brown · 2025' ] );
} );

test( 'where a piece leads: each named piece by a different set of its pickers, the freest first', () => {
	const L = K.leads( G, SILVER );
	assert.deepEqual( L.cast, [ KYLE, JUSTIN ] );                    // whoever is on the most comes first
	// A Permanent studio track first: the other one of the same record, which both are on. Then Kyle alone, to the
	// newest tape; then Justin alone, to a Full Release. Their show together says nothing the track hasn't.
	assert.deepEqual( L.named.map( ( n ) => [ called( n.id ), n.via ] ),
		[ [ 'Victory', [ KYLE, JUSTIN ] ], [ 'Sam Grisman Project', [ KYLE ] ], [ 'A Duet', [ JUSTIN ] ] ] );
	const sets = L.named.map( ( n ) => n.via.slice().sort().join() );
	assert.equal( new Set( sets ).size, sets.length );
	// The rest are counted behind them: their show together, an older tape, a stream's track, a record whole.
	assert.deepEqual( L.rest.map( ( r ) => called( r.id ) ), [ 'Hello Decentralization', 'Sam Bush Band', 'Unknown', 'Safe, Sensible And Sane' ] );
	assert.deepEqual( L.rest[ 0 ].via, [ KYLE, JUSTIN ] );
} );

test( 'the pickers the reader came by are asked first, and the piece they came from stays', () => {
	const L = K.leads( G, SILVER, 6, [ JUSTIN ] );
	assert.deepEqual( L.cast, [ JUSTIN, KYLE ] );
	assert.equal( L.named[ 0 ].via[ 0 ], JUSTIN );
	const kept = K.leads( G, SILVER, 6, [ JUSTIN ], [ VICTORY ] );
	assert.deepEqual( [ kept.named[ 0 ].id, kept.named[ 0 ].via ], [ VICTORY, [ JUSTIN, KYLE ] ] );
	assert.equal( K.leads( G, SILVER, 2 ).named.length, 2 );
} );

test( "a record's own tracks aren't somewhere it leads; another track of the same record is where a track leads", () => {
	const whole = K.leads( G, 0 );
	assert.ok( !whole.named.concat( whole.rest ).some( ( x ) => G.pieces[ x.id ].m === 0 ) );
	assert.ok( K.leads( G, SILVER ).named.concat( K.leads( G, SILVER ).rest ).some( ( x ) => x.id === VICTORY ) );
	assert.deepEqual( K.leads( G, K.findPiece( G, 'arthel:show:0-1' ) ).cast, [ KYLE, JUSTIN ] );
} );

test( 'one night is one piece, however many tapers taped it; a show with a name is called by it', () => {
	const g = K.build( { people: [ [ 'A', 1, '' ], [ 'B', 1, '' ], [ 'C', 0, '' ] ], music: [
		[ 'lma:band2025-06-14.akg', 'show', 'The Band', '2025-06-14', 'The Band Live at The Hall on 2025-06-14', 2, 'https://archive.org/details/akg', '' ],
		[ 'lma:band2025-06-14.mv88', 'show', 'The Band', '2025-06-14', 'The Band Live at The Hall on 2025-06-14', 2, 'https://archive.org/details/mv88', '' ],
		[ 'arthel:show:0-9', 'show', '', 'block 15735471', 'devcon VI night 1', 2, 'gh/show.yaml', '' ] ],
	cast: [ [ [ 0, 'guitar' ], [ 1, '' ] ], [ [ 1, 'banjo' ], [ 2, '' ] ], [ [ 0, '' ], [ 2, '' ] ] ],
	ties: [ [ 0, 1, [ [ 0, 2, 1, [] ] ] ], [ 1, 2, [ [ 1, 2, 1, [] ] ] ], [ 0, 2, [ [ 2, 2, 1, [] ] ] ] ] } );
	assert.deepEqual( g.whole, [ 0, 0, 2 ] );
	assert.deepEqual( [ g.pieces[ 0 ].cast, g.pieces[ 0 ].also, g.pieces[ 1 ].cast ], [ [ 0, 1, 2 ], [ 1 ], [] ] );
	assert.equal( K.pieceFor( g, g.adj[ 1 ].get( 2 ).ev[ 0 ] ), 0 );
	assert.equal( K.findPiece( g, 'lma:band2025-06-14.mv88' ), 0 );
	assert.deepEqual( K.leads( g, 0 ).named.map( ( n ) => n.id ), [ 2 ] );    // the other tape of the night isn't somewhere else
	const own = K.naming( g, g.adj[ 0 ].get( 2 ).ev[ 0 ] );
	assert.deepEqual( [ own.short, own.brief, own.long ], [ 'devcon VI night 1 · block 15,735,471', 'devcon VI night 1 · block 15,735,471', 'block 15,735,471' ] );   // no band said; its night
} );

test( 'a line says a song or a show no other line here has said; with none left, nothing', () => {
	// Justin, #connectome, 15 Nov 2026: not the same song on every line, and not the first by the alphabet
	const t = tie( KYLE, JUSTIN );                                    // Silver 44 and Victory on 4masks, and a show
	const first = K.unsaid( G, t, new Set() );
	assert.equal( first.e.songs[ 0 ], 'Silver 44' );
	const next = K.unsaid( G, t, new Set( [ first.piece ] ) );
	assert.equal( next.e.songs[ 0 ], 'Victory' );                     // the other song of the same record
	assert.deepEqual( next.e.songs, [ 'Victory', 'Silver 44' ] );
	const heard = new Set( [ first.piece, next.piece ] );
	assert.equal( G.music[ K.unsaid( G, t, heard ).e.m ].kind, 'show' );   // then the show they played
	heard.add( K.unsaid( G, t, heard ).piece );
	assert.equal( K.unsaid( G, t, heard ), undefined );                 // nothing left unsaid: no label
} );

/* ---- whose a song is: at the other end of its line, its recording artist, then its writer, then the rest ---- */

// Justin, #connectome, 15 Nov 2026, 07:29Z: "When examining who to show at the other end of a link, in the case of a
// Song, prioritize in this order: 1. the recording artist who made it, 2. the song writer if they're on the track,
// 3. another person from the ensemble if 1 and 2 already exist in the constellation in the current view." And 20:15Z:
// "someone has a permanent release on the periphery of their constellation, but the edge node is not the recording
// artist or author of that song, nor displayed elsewhere."
// M in the middle. Her record R is Artist's, and Artist wrote One on it; Harry and Gaven are on One too, and both have
// played with her more than Artist has. Writer wrote Two, cut on Band X's record Q (no picker is Band X). Cory is on
// a show with her. Far is on One with Harry only (no tie to M); Taper on the show with Harry.
const OWN = [ 'M', 'Harry', 'Gaven', 'Artist', 'Cory', 'Writer', 'Far', 'Taper' ];
const [ OM, OH, OG, OA, OC, OW, OF, OT ] = OWN.map( ( _, i ) => i );
const OWNED = {
	people: OWN.map( ( n ) => [ n, 1, '' ] ),
	music: [ [ 'arthel:r', 'record', 'Artist', '2024', 'R', 2, '', '' ], [ 'lma:s', 'show', 'Band', '2025-01-01', 'S', 2, '', '' ],
		[ 'discogs:q', 'record', 'Band X', '2023', 'Q', 1, '', '' ] ],
	cast: [ [], [], [] ],
	ties: [
		[ OM, OH, [ [ 0, 3, 3, [ 'One' ] ] ] ], [ OM, OG, [ [ 0, 3, 2, [ 'One' ] ] ] ], [ OM, OA, [ [ 0, 3, 1, [ 'One' ] ] ] ],
		[ OM, OC, [ [ 1, 2, 1, [] ] ] ], [ OH, OG, [ [ 0, 3, 1, [ 'One', 'Three' ] ] ] ], [ OH, OA, [ [ 0, 3, 1, [ 'One' ] ] ] ],
		[ OG, OA, [ [ 0, 3, 1, [ 'One' ] ] ] ], [ OH, OF, [ [ 0, 3, 5, [ 'One' ] ] ] ], [ OH, OT, [ [ 1, 2, 1, [] ] ] ],
		[ OM, OW, [ [ 2, 3, 0.2, [ 'Two' ] ] ] ]
	],
	songcast: { QmOne: { song: 'One', on: [ 0 ], artist: OA, writers: [ OA ], pickers: [ [ OM ], [ OH ], [ OG ], [ OA ], [ OF ] ] },
		QmTwo: { song: 'Two', on: [ 2 ], artist: null, writers: [ OW ], pickers: [ [ OM ], [ OW ] ] } }
};
const OG_ = K.build( OWNED );

test( 'whose a record is: the pickers its credit names, or graph.json\'s own list; and who the page says wrote each song', () => {
	assert.deepEqual( OG_.made, [ [ OA ], [], [] ] );                        // a show is nobody's; Band X is no picker here
	assert.deepEqual( OG_.wrote.get( '0\none' ), [ OA ] );
	assert.deepEqual( OG_.wrote.get( '2\ntwo' ), [ OW ] );                  // keyed by songKey
	// the build's own list, by the wiki's names, wins over the credit as written ("Bronwyn Keith-Hynes", page Bronwyn)
	assert.deepEqual( K.build( Object.assign( {}, OWNED, { made: [ [ OH ], [], [ OC ] ] } ) ).made, [ [ OH, OA ], [], [ OC ] ] );
	// a credit naming several names each; a "Jr." stays with its name
	const g = K.build( { people: [ [ 'Jerry Garcia', 1 ], [ 'David Grisman', 1 ], [ 'Emory Gordy, Jr.', 1 ], [ 'Johnny Campbell', 1 ] ],
		music: [ [ 'd:1', 'record', 'Jerry Garcia, David Grisman', '', '', 1 ], [ 'd:2', 'record', 'David Grisman, Emory Gordy, Jr.', '', '', 1 ],
			[ 'd:3', 'record', 'Johnny Campbell & The Bluegrass Drifters', '', '', 1 ], [ 'd:4', 'record', 'Old & In The Way', '', '', 1 ] ],
		cast: [], ties: [] } );
	assert.deepEqual( g.made, [ [ 0, 1 ], [ 1, 2 ], [ 3 ], [] ] );
} );

test( 'a song may end at its artist or its writer, and at another of its ensemble only with them in sight', () => {
	const one = K.trackOn( OG_, 0, 'One' ), two = K.trackOn( OG_, 2, 'Two' ), show = OG_.whole[ 1 ];
	assert.deepEqual( K.whose( OG_, one ), { artists: [ OA ], writers: [ OA ] } );
	assert.deepEqual( K.whose( OG_, two ), { artists: [], writers: [ OW ] } );
	assert.equal( K.whose( OG_, show ), null );
	assert.equal( K.mayEnd( OG_, one, OA, new Set( [ OM ] ) ), true );       // 1, the artist
	assert.equal( K.mayEnd( OG_, one, OH, new Set( [ OM, OG ] ) ), false );  // a sideman, the artist out of sight
	assert.equal( K.mayEnd( OG_, one, OH, new Set( [ OM, OA ] ) ), true );   // 3, the artist in sight
	assert.equal( K.mayEnd( OG_, two, OW, new Set() ), true );               // 2, the writer
	assert.equal( K.mayEnd( OG_, two, OM, new Set( [ OH ] ) ), false );
	assert.equal( K.mayEnd( OG_, show, OC, new Set() ), true );              // a show ends anywhere
	// Three, on Artist's record without Artist: whoever is on it may stand at its end
	assert.deepEqual( K.whose( OG_, K.trackOn( OG_, 0, 'Three' ) ), { artists: [], writers: [] } );
	assert.equal( K.mayEnd( OG_, K.trackOn( OG_, 0, 'Three' ), OG, new Set( [ OH ] ) ), true );
	assert.deepEqual( [ OA, OH ].map( ( x ) => K.claim( OG_, x, OG_.adj[ OM ].get( x ).ev[ 0 ] ) ), [ 0, 2 ] );
	assert.equal( K.claim( OG_, OW, OG_.adj[ OM ].get( OW ).ev[ 0 ] ), 1 );
	assert.equal( K.claim( OG_, OC, OG_.adj[ OM ].get( OC ).ev[ 0 ] ), 2 );
	// what a line says: the first thing it may, ending there
	assert.equal( K.lineSays( OG_, OG_.adj[ OM ].get( OH ), OH, new Set( [ OM ] ) ), undefined );
	assert.equal( K.lineSays( OG_, OG_.adj[ OM ].get( OH ), OH, new Set( [ OM, OA ] ) ).piece, one );
} );

test( 'of those who come in by one record, its artist first, then its writer: no sideman takes its first place while they wait', () => {
	const ring = ( g ) => K.fewPer( g, K.company( g, OM ) ).map( ( c ) => OWN[ c.id ] ).join( ' ' );
	assert.equal( K.company( OG_, OM ).map( ( c ) => OWN[ c.id ] ).join( ' ' ), 'Harry Gaven Artist Cory Writer' );   // the loudest first
	assert.equal( ring( OG_ ), 'Artist Harry Cory Writer Gaven' );
	// with nobody's record said to be theirs, the company's own order, as before
	assert.equal( ring( K.build( Object.assign( {}, OWNED, { made: [ [], [], [] ], songcast: {} } ) ) ), 'Harry Gaven Cory Writer Artist' );
	// the writer before a sideman, where no artist of it is on it
	const wrote = K.build( Object.assign( {}, OWNED, { ties: [ [ OM, OH, [ [ 2, 3, 3, [ 'Two' ] ] ] ], [ OM, OW, [ [ 2, 3, 0.2, [ 'Two' ] ] ] ],
		[ OM, OG, [ [ 2, 3, 2, [ 'Two' ] ] ] ] ] } ) );
	assert.equal( K.fewPer( wrote, K.company( wrote, OM ) ).map( ( c ) => OWN[ c.id ] ).join( ' ' ), 'Writer Harry Gaven' );
} );

test( 'a step further says a song only where it may end: with its artist out of sight, a sideman of it is not named', () => {
	// Harry in the ring alone: Far is on One with him, and One is Artist's, out of sight; Taper is on a show with him
	assert.deepEqual( ids( K.beyond( OG_, OM, [ OH ] ) ), [ [ OT ] ] );
	assert.equal( K.beyond( OG_, OM, [ OH ] )[ 0 ][ 0 ].say.piece, OG_.whole[ 1 ] );
	// Artist in the ring too: Far may stand at One's end, and is the louder
	const both = K.beyond( OG_, OM, [ OH, OA ] );
	assert.deepEqual( ids( both ), [ [ OF, OT ], [] ] );
	assert.equal( both[ 0 ][ 0 ].say.piece, K.trackOn( OG_, 0, 'One' ) );
	// the way the reader came stays, whatever it says
	assert.deepEqual( ids( K.beyond( OG_, OM, [ OH ], 2, [ OH, OF ] ) ), [ [ OF, OT ] ] );
} );

test( 'a show whose source names the band goes by the band; a cut says whose it is', () => {
	// Justin, #connectome, 15 Nov 2026: arthel's shows by the band, not the show's title; a cut's second line its artist
	const g = K.build( { people: [ [ 'A', 1, '' ], [ 'B', 1, '' ] ], music: [
		[ 'arthel:show:0-9', 'show', 'Justin Holmes and the Immutable String Band', 'block 15735471', 'devcon VI night 1', 2, 'gh/show.yaml', '' ],
		[ 'arthel:4masks', 'record', 'Justin Myles Holmes', '2025', '4masks', 2, 'gh/x.yaml', '/wiki/4masks', 'Four-masks.png' ] ],
	cast: [ [ [ 0, '' ], [ 1, '' ] ], [ [ 0, '' ], [ 1, '' ] ] ],
	ties: [ [ 0, 1, [ [ 0, 2, 1, [] ], [ 1, 3, 1, [ 'Victory' ] ] ] ] ] } );
	const show = K.naming( g, { m: 0, how: K.STAGE, songs: [] } );
	assert.deepEqual( [ show.short, show.brief, show.long ], [ 'Justin Holmes and the Immutable String Band · block 15,735,471',
		'Justin Holmes and the Immutable String Band · block 15,735,471', 'devcon VI night 1' ] );
	const cut = K.called( g, g.pieces[ K.trackOn( g, 1, 'Victory' ) ] );
	assert.deepEqual( [ cut.name, cut.sub, cut.on ], [ 'Victory', 'Justin Myles Holmes', '4masks by Justin Myles Holmes' ] );   // the record, and whose
	assert.equal( g.music[ 1 ].art, 'Four-masks.png' );
	assert.equal( g.music[ 0 ].art, '' );
	assert.ok( K.catalogue( g ).some( ( x ) => x.label === 'Victory · track on 4masks by Justin Myles Holmes' ) );
} );

test( 'a view\'s title says which game it is: the Oracle, the Six Degrees, or the bacon between two pickers', () => {
	// Justin, #connectome, 20 Nov 2026: "the title needs to reflect whether it's a challenge or not"
	assert.equal( K.pageTitle( { oracle: true } ), 'The Oracle of Bluegrass Bacon' );
	assert.equal( K.pageTitle( { oracle: true, challenge: true } ), 'The Six Degrees of Bluegrass Bacon' );
	assert.equal( K.pageTitle( { challenge: true, of: 'Cory Walker' } ), 'The Six Degrees of Bluegrass Bacon' );   // a game on: the game, wherever it has got to
	assert.equal( K.pageTitle( { a: 'Maddie Denton', b: 'Kyle Tuttle', of: 'Maddie Denton ⟷ Kyle Tuttle' } ), 'Bluegrass Bacon from Maddie Denton to Kyle Tuttle' );
	assert.equal( K.pageTitle( { a: 'Maddie Denton', of: 'Maddie Denton' } ), 'Bluegrass Bacon: Maddie Denton' );
	assert.equal( K.pageTitle( { of: 'August · 4masks' } ), 'Bluegrass Bacon: August · 4masks' );
	assert.equal( K.pageTitle( {} ), 'The Oracle of Bluegrass Bacon' );
} );

test( 'a record a line names says whose it is: not "Various", nor anyone where no artist is credited', () => {
	// Justin, #connectome, 19 Nov 2026: "it says 'a track on Vowel Sounds' - it needs to say the artist's name as well"
	assert.equal( K.recordBy( { key: 'arthel:vowel sounds', artist: 'Justin Myles Holmes', title: 'Vowel Sounds' } ), 'Vowel Sounds by Justin Myles Holmes' );
	assert.equal( K.recordBy( { key: 'discogs:1', artist: 'Various', title: 'Bluegrass Classics' } ), 'Bluegrass Classics' );
	assert.equal( K.recordBy( { key: 'discogs:2', artist: ' various artists ', title: 'Pickin\' Time' } ), 'Pickin\' Time' );
	assert.equal( K.recordBy( { key: 'discogs:3', artist: '', title: 'Untitled' } ), 'Untitled' );
	assert.equal( K.recordBy( { key: 'discogs:4', artist: 'Tony Rice', title: '' } ), 'discogs:4 by Tony Rice' );
	assert.equal( K.byArtist( { artist: 'Old & In The Way', title: 'Old & In The Way' } ), ' by Old & In The Way' );   // self-titled: still whose
} );

test( 'a tag on a line keeps off a name it is told of', () => {
	const a = { x: 400, y: 300 }, b = { x: 400, y: 440 };            // straight down, past the middle's own name
	const name = { x1: 330, y1: 326, x2: 470, y2: 360 };
	const free = K.tagAt( a, b, 24, 15, 150 );
	assert.equal( free.y, 370 );                                      // told of nothing: halfway, its top on the name
	const kept = K.tagAt( a, b, 24, 15, 150, 23, [ name ], 120 );
	assert.ok( kept.room > 0 && kept.y - 11.5 >= name.y2 );          // further out, clear of it
	assert.deepEqual( K.tagAt( a, b, 24, 15, 150, 23, [], 120 ), free );   // nothing to keep off: as before
	assert.equal( K.tagAt( a, { x: 400, y: 380 }, 24, 15, 150, 23, [ name ], 120 ).room, 0 );   // nowhere clear: no room
} );

test( 'a zoomed-in page is drawn as a page four tenths as zoomed in (Justin, 17 and 18 Nov 2026)', () => {
	// 150-160% drawn as 100-120%, 180% as 130-160%; and each step in still draws bigger and shows less
	assert.deepEqual( [ 1, 1.5, 1.6, 1.8, 2, 3 ].map( ( z ) => +K.drawnAs( z ).toFixed( 3 ) ), [ 1, 1.2, 1.24, 1.32, 1.4, 1.8 ] );
	assert.equal( K.drawnAs( 0.8 ), 1 );                                // zoomed out: as at 100%
	for ( let z = 1; z < 5; z += 0.01 ) {
		assert.ok( K.drawnAs( z + 0.01 ) > K.drawnAs( z ) );          // further in always draws bigger
		assert.ok( K.drawnAs( z ) >= 1 && K.drawnAs( z ) <= z );      // never smaller than 100%, never bigger than the zoom
	}
	assert.equal( K.shrink( 1160, 728, 1 ), 1 );                       // 100%: as it was
	assert.equal( K.shrink( 600, 400, 1 ), 1 );                        // a small window at 100%: nothing drawn smaller than at 100%
	assert.equal( K.shrink( 1023, 625, 1.1 ), 1 );                     // room enough already
	assert.equal( K.shrink( 656, 391, 1.5 ), 1.25 );                   // 150% on a laptop: drawn as 120%
	assert.equal( K.shrink( 1000, 700, 1.5 ), 1 );                     // a frame roomy already isn't drawn smaller for nothing
	assert.equal( K.shrink( 800, 500, 1.5 ), 1.13 );                   // nor smaller than lays it out roomy
	assert.equal( K.shrink( 488, 252, 1.8 ), 1.36 );                   // 180%: drawn as 132%
	assert.equal( K.shrink( 400, 250, 2 ), 1.42 );                     // 200%: as 140%
	assert.equal( K.shrink( 330, 200, 3 ), 1.66 );                     // 300%: as 180%
} );

test( 'the wheel draws the graph bigger a step at a time, on top of the page\'s zoom, and lays it out in less', () => {
	assert.equal( K.shrink( 1160, 728, 1, 1 ), K.shrink( 1160, 728, 1 ) );   // not closer: as the page's zoom has it
	assert.equal( K.shrink( 1160, 728, 1, 2 ), 0.71 );                 // twice as close: drawn 1.4 times bigger
	assert.equal( K.shrink( 656, 391, 1.5, 2 ), 0.83 );                // at 150%, twice as close: 1.25, times 1.2 (150%) over 1.8 (300%)
	let was = Infinity;
	for ( const c of [ 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3 ] ) {
		const s = K.shrink( 900, 520, 1.25, c );
		assert.ok( s < was );                                         // each step closer draws it bigger
		was = s;
	}
} );

test( "Firefox's zoom: its pixel ratio over the screen's, the screen's never more than the least ratio seen here", () => {
	assert.deepEqual( K.foxZoom( 1, 0 ), { zoom: 1, least: 1 } );                 // a plain screen at 100%, first visit
	assert.deepEqual( K.foxZoom( 1.5, 0 ), { zoom: 1.5, least: 1.5 } );           // a plain screen at 150%
	assert.deepEqual( K.foxZoom( 2, 0 ), { zoom: 1, least: 2 } );                 // first seen at 2: taken as a fine screen at 100%
	assert.deepEqual( K.foxZoom( 3, 2 ), { zoom: 1.5, least: 2 } );               // a fine screen at 150%
	assert.deepEqual( K.foxZoom( 2, 1 ), { zoom: 2, least: 1 } );                 // a plain screen at 200%, once seen at 100% (Justin, 18 Nov 2026)
	assert.deepEqual( K.foxZoom( 3, 1.5 ), { zoom: 2, least: 1.5 } );             // a screen at 1.5, at 200%
	assert.deepEqual( K.foxZoom( 2, 1.25 ), { zoom: 1.6, least: 1.25 } );         // a screen at 1.25, at 160%
	assert.deepEqual( K.foxZoom( 1, 0.8 ), { zoom: 1, least: 1 } );               // zoomed out once: never taken under 1
	assert.deepEqual( K.foxZoom( 1.2, 1 ), { zoom: 1.2, least: 1 } );
} );

test( "a page's own graph: the big graph knows its pickers, and no tie between them (Justin, 17 Nov 2026)", () => {
	const g = { people: [ [ 'A', 1 ], [ 'B', 1 ], [ 'C', 0 ] ], music: [ [ 'lma:x', 'show', '', '2026-01-01', 'X', 1, 'lma' ] ],
		ties: [ [ 0, 1, [ [ 0, 2, 1 ] ] ] ], pages: { 'Some Awards': [ 2, 0, 1 ] } };
	const G = K.build( g );
	assert.deepEqual( G.pages[ 'Some Awards' ], [ 2, 0, 1 ] );
	assert.equal( G.adj[ 2 ].size, 0 );                                // on the page with A and B, and tied to nobody
	assert.deepEqual( K.build( { people: [], music: [], ties: [] } ).pages, {} );
} );

test( 'another turn of the company: the next ones round, those the reader came by staying', () => {
	const ring = [ 'k', 'a', 'b', 'c', 'd', 'e' ].map( ( id ) => ( { id } ) );
	const ids = ( r ) => r.map( ( c ) => c.id ).join( '' );
	assert.equal( ids( K.turned( ring, 1, 2, 0 ) ), 'kabcde' );
	assert.equal( ids( K.turned( ring, 1, 2, 1 ) ), 'kcdeab' );         // the next two named; the first two after the rest
	assert.equal( ids( K.turned( ring, 1, 2, 2 ) ), 'keabcd' );
	assert.equal( ids( K.turned( ring, 1, 2, 5 ) ), 'kabcde' );         // round to the start
	assert.equal( ids( K.turned( ring, 0, 6, 1 ) ), 'kabcde' );         // all of them in sight already: no turn
} );

test( 'a rabbithole walk, as the graph knows it: each cut, who was followed to it, and what came round again', () => {
	// Justin, #connectome, 15 Nov 2026: Rabbithole's "Your rabbithole" drawn with the explorer's marks
	const g = K.build( { people: [ [ 'Justin Myles Holmes', 1, 'guitar' ], [ 'Kyle Tuttle', 1, 'banjo' ] ], music: [
		[ 'arthel:4masks', 'record', 'Justin Myles Holmes', '2025', '4masks', 2, 'gh/x.yaml', '/wiki/4masks', 'Four-masks.png' ] ],
	cast: [ [ [ 0, 'guitar' ], [ 1, 'banjo' ] ] ],
	ties: [ [ 0, 1, [ [ 0, 3, 1, [ 'August', 'Victory' ] ] ] ] ],
	songcast: { QmAug: { song: 'August', on: [ 0 ], artist: 0, pickers: [ [ 0, 'guitar', 'guitar' ], [ 1, 'banjo', 'banjo' ] ] },
		QmVic: { song: 'Victory', on: [ 0 ], artist: 0, pickers: [ [ 0, 'guitar', 'guitar' ], [ 1, 'banjo', 'banjo' ] ] } } } );
	const steps = K.walkSteps( g, [
		{ cid: 'QmAug', song: 'August', via: null, at: 1000 },
		{ cid: 'QmVic', song: 'Victory', via: { name: 'Justin Holmes', instrument: 'guitar' }, at: 2000 },   // the page's own spelling
		{ cid: 'QmNotKnown', song: 'Song:Cork Board', via: { name: 'Nobody Here' }, at: 3000 },
		{ cid: 'QmAug', song: 'August', via: { name: 'Kyle Tuttle' }, at: 4000 },
		{ song: 'no cid' } ] );
	assert.deepEqual( steps.map( ( s ) => [ s.song, s.via, s.again ] ),
		[ [ 'August', null, 0 ], [ 'Victory', 0, 0 ], [ 'Cork Board', null, 0 ], [ 'August', 1, 1 ] ] );
	assert.equal( steps[ 0 ].piece, K.trackOn( g, 0, 'August' ) );          // the track, where the record has one
	assert.equal( steps[ 2 ].piece, undefined );                              // a cut the graph doesn't know: its name, as the walk wrote it
	assert.equal( steps[ 2 ].viaName, 'Nobody Here' );
	assert.deepEqual( K.walkSum( steps ), { songs: 4, followed: 3, since: 1000 } );
	assert.deepEqual( K.walkSteps( g, null ), [] );
	// a Song page and a record's track list may spell a song two ways: the same track either way
	assert.deepEqual( [ 'Barlow\'s Jig', 'Barlows Jig', 'Gm☕', 'GM', 'Señor', 'Senor' ].map( K.songKey ), [ 'barlows jig', 'barlows jig', 'gm', 'gm', 'senor', 'senor' ] );
	const g2 = K.build( { people: [ [ 'Justin Myles Holmes', 1, 'guitar' ], [ 'Kyle Tuttle', 1, 'banjo' ] ], music: [
		[ 'arthel:vs', 'record', 'Justin Myles Holmes', '2025', 'Vowel Sounds', 2, 'gh/x.yaml', '' ] ], cast: [ [] ],
	ties: [ [ 0, 1, [ [ 0, 3, 1, [ 'Gm', 'Lost' ] ] ] ] ],
	songcast: { QmGm: { song: 'Gm☕', on: [ 0 ], artist: 0, pickers: [ [ 0, 'guitar', 'guitar' ] ] } } } );
	assert.equal( K.walkSteps( g2, [ { cid: 'QmGm' } ] )[ 0 ].piece, K.trackOn( g2, 0, 'Gm' ) );
} );

test( 'with no address, the graph opens at random on one who has played with six or more and is on a Permanent studio track', () => {
	// Justin, #connectome, 18 Nov 2026: "Six or more direct connections; At least one permanent release studio appearance"
	const people = [], ties = [];
	const add = ( name ) => people.push( [ name, 1, '' ] ) - 1;
	const subject = ( name, m, how, many ) => {
		const id = add( name );
		for ( let k = 0; k < many; k++ ) {
			ties.push( [ id, add( name + k ), [ [ m, how, 1, how === K.TRACK ? [ 'T' ] : [] ] ] ] );
		}
		return id;
	};
	const LEAD = subject( 'Lead', 0, K.TRACK, 6 );        // six, on a Permanent record's track
	const MORE = subject( 'More', 0, K.TRACK, 7 );
	subject( 'Stage', 1, K.STAGE, 9 );                     // a Permanent show only: no studio appearance
	subject( 'Fuller', 2, K.TRACK, 9 );                    // a studio track, but a Full Release
	subject( 'Five', 0, K.TRACK, 5 );                      // five aren't six
	const SLEEVE = subject( 'Sleeve', 1, K.STAGE, 6 );     // on the Permanent record, no source saying which track
	ties.push( [ SLEEVE, add( 'Credit' ), [ [ 0, K.RECORD, 0.01, [] ] ] ] );
	const g = K.build( { people, cast: [ [], [], [] ], ties,
		music: [ [ 'arthel:p', 'record', 'Lead', '2024', 'P', K.PERMANENT, '', '' ], [ 'lma:s', 'show', 'Band', '2025-01-01', 'S', K.PERMANENT, '', '' ],
			[ 'discogs:f', 'record', 'Band', '2023', 'F', K.FULL, '', '' ] ] } );
	assert.deepEqual( K.landable( g ), [ LEAD, MORE, SLEEVE ] );
	assert.equal( K.landing( g, () => 0 ), LEAD );
	assert.equal( K.landing( g, () => 0.5 ), MORE );
	assert.equal( K.landing( g, () => 0.999 ), SLEEVE );
	assert.equal( K.landing( g, () => 1 ), SLEEVE );       // never past the end
	const seen = new Set( Array.from( { length: 300 }, () => K.landing( g ) ) );
	assert.deepEqual( [ ...seen ].sort( ( x, y ) => x - y ), [ LEAD, MORE, SLEEVE ] );
} );

test( 'with nobody such, the graph opens on whoever with a page has played with the most, featured or not', () => {
	// the featured pickers are set aside (Justin, #connectome, 15 Nov 2026)
	assert.deepEqual( K.landable( G ), [] );
	const most = G.people.map( ( p, i ) => ( p.page ? K.company( G, i ).length : -1 ) );
	assert.equal( K.landing( G ), most.indexOf( Math.max( ...most ) ) );
	assert.equal( G.people[ K.landing( G ) ].page, true );
	assert.equal( K.landing( K.build( Object.assign( {}, GRAPH, { featured: [ VICKIE ] } ) ) ), K.landing( G ) );
	// the most played-with of all has no page: the graph opens on the most played-with of those who have one
	const hub = K.build( { people: [ [ 'Hub', 0, '' ], [ 'Paged', 1, '' ], [ 'X', 0, '' ], [ 'Y', 0, '' ] ],
		music: [ [ 'lma:t', 'show', 'Band', '2025-01-01', 'Live', 2, 'https://archive.org/details/t', '' ] ], cast: [ [] ],
		ties: [ [ 0, 1, [ [ 0, 2, 1, [] ] ] ], [ 0, 2, [ [ 0, 2, 1, [] ] ] ], [ 0, 3, [ [ 0, 2, 1, [] ] ] ] ] } );
	assert.equal( K.landing( hub ), 1 );
} );

test( 'a picker\'s company is named a few to a record or show, the rest waiting till nobody else is left', () => {
	// Justin, #connectome, 15 Nov 2026: "Priority list as described above, but only at most two 1-hop connections from
	// any given record or show, unless there are no other connecting objects available"
	const g = { music: [ { kind: 'record', tier: K.PERMANENT }, { kind: 'show', tier: K.PERMANENT }, { kind: 'show', tier: K.PERMANENT },
		{ kind: 'record', tier: K.FULL } ] };
	const REC = 0, S1 = 1, S2 = 2, FULLREC = 3;
	const c = ( id, ...ev ) => ( { id, tie: { ev: ev.map( ( [ m, how ] ) => ( { m, how } ) ) } } );
	// the company in priority order, as company() gives it: six from one Permanent record first, then shows
	const comp = [ c( 'a', [ REC, K.TRACK ] ), c( 'b', [ REC, K.TRACK ] ), c( 'c', [ REC, K.TRACK ] ),
		c( 'd', [ REC, K.TRACK ], [ FULLREC, K.TRACK ] ), c( 'e', [ REC, K.TRACK ], [ S2, K.STAGE ] ), c( 'f', [ REC, K.TRACK ] ),
		c( 'g', [ S1, K.STAGE ] ), c( 'h', [ S1, K.STAGE ] ), c( 'i', [ S1, K.STAGE ] ) ];
	const ids = ( r ) => r.map( ( x ) => x.id ).join( '' );
	const r = K.fewPer( g, comp );
	// two by the record; then by Justin's order: e by a Permanent show it shares too, g and h by theirs; d by a Full
	// record; and the waiting after them: c, f and i, whose every shared thing has two named by it already
	assert.equal( ids( r ), 'abeghdcfi' );
	assert.deepEqual( r.map( ( x ) => x.by ? x.by.m : null ), [ REC, REC, S2, S1, S1, FULLREC, null, null, null ] );
	assert.equal( ids( K.fewPer( g, comp, 3 ) ), 'abceghidf' );                 // three to a thing
	// one who shares a Full record and, listed after it, a Permanent show: named by the show, with the shows
	const j = K.fewPer( g, comp.concat( [ c( 'j', [ FULLREC, K.TRACK ], [ S2, K.STAGE ] ) ] ) );
	assert.equal( ids( j ), 'abeghjdcfi' );
	assert.equal( j[ 5 ].by.m, S2 );
	// those the reader came by stay first, and count: two who came by the record leave it no room
	assert.equal( ids( K.fewPer( g, [ comp[ 5 ], comp[ 2 ] ].concat( comp.filter( ( x ) => x.id !== 'f' && x.id !== 'c' ) ), 2, 2 ) ), 'fceghdabi' );
	// nobody else to name: the waiting are named after all
	assert.equal( ids( K.fewPer( g, comp.slice( 0, 4 ) ) ), 'abdc' );
	assert.deepEqual( K.fewPer( g, [] ), [] );
} );

test( 'a walk runs as a snake: left to right, down a row, right to left; the names hang inward at the ends', () => {
	// Justin, #connectome, 15 Nov 2026: "left to right, and then down a row and right-to-left, and keep going thusly"
	const lay = K.snake( { W: 900, n: 9, room: 200, side: 78, top: 92, pitch: 186 } );
	assert.equal( lay.cols, 4 );
	assert.equal( lay.rows, 3 );
	assert.equal( lay.S, 248 );
	assert.deepEqual( lay.at.map( ( p ) => [ p.x, p.y, p.dir ] ), [
		[ 78, 92, 1 ], [ 326, 92, 1 ], [ 574, 92, 1 ], [ 822, 92, 1 ],
		[ 822, 278, -1 ], [ 574, 278, -1 ], [ 326, 278, -1 ], [ 78, 278, -1 ],
		[ 78, 464, 1 ] ] );
	// a row ends where the next begins, one row down: the line between them turns at the frame's edge
	for ( let i = 1; i < lay.at.length; i++ ) {
		const a = lay.at[ i - 1 ], b = lay.at[ i ];
		assert.ok( a.row === b.row ? a.y === b.y && Math.abs( a.x - b.x ) === lay.S : a.x === b.x && b.row === a.row + 1 );
	}
	assert.deepEqual( lay.at.slice( 0, 4 ).map( ( p ) => p.anchor ), [ 'start', 'middle', 'middle', 'end' ] );
	assert.deepEqual( lay.at.slice( 4, 8 ).map( ( p ) => p.anchor ), [ 'end', 'middle', 'middle', 'start' ] );
	assert.equal( K.snake( { W: 300, n: 3, room: 70, side: 19, top: 50, pitch: 0, most: 3 } ).cols, 3 );   // the dock: three at most
	const one = K.snake( { W: 200, n: 2, room: 150, side: 78, top: 92, pitch: 186 } );   // no room for two: a column
	assert.deepEqual( [ one.cols, one.at[ 1 ].x, one.at[ 1 ].y, one.at[ 1 ].anchor ], [ 1, 78, 278, 'middle' ] );
	assert.deepEqual( K.snake( { W: 900, n: 0, room: 200, side: 78, top: 92, pitch: 186 } ).rows, 0 );
} );

test( 'the roads a walk did not take: where its songs\' pickers lead, a picker to each, each place once, nowhere it has been', () => {
	// Justin, #connectome, 15 Nov 2026: "showing other unused but potential connections and allowing the user to explore those"
	const g = K.build( { people: [ [ 'Justin', 1, 'guitar' ], [ 'Kyle', 1, 'banjo' ], [ 'Molly', 1, 'guitar' ], [ 'Sam', 0, 'mandolin' ] ], music: [
		[ 'arthel:4masks', 'record', 'Justin', '2025', '4masks', 2, 'gh/x.yaml', '/wiki/4masks' ],
		[ 'lma:kt', 'show', 'Kyle and Molly', '2024-05-01', 'Live', 2, 'https://archive.org/details/kt', '' ],
		[ 'discogs:9', 'record', 'Sam', '2020', 'Sam Plays', 1, 'https://www.discogs.com/release/9', '' ],
		[ 'arthel:single', 'record', 'Justin', '2026', 'Victory (single)', 2, 'gh/y.yaml', '' ] ],
	cast: [ [], [], [], [] ],
	ties: [ [ 0, 1, [ [ 0, 3, 1, [ 'August', 'Victory', 'Silver 44' ] ], [ 3, 3, 1, [ 'Victory' ] ] ] ], [ 1, 2, [ [ 1, 2, 1, [] ] ] ],
		[ 0, 3, [ [ 2, 3, 1, [] ] ] ], [ 0, 2, [ [ 0, 3, 1, [ 'A Duet' ] ] ] ] ],
	songcast: Object.assign( Object.fromEntries( [ 'August', 'Victory', 'Silver 44' ].map( ( s ) => [ 'Qm' + s, { song: s, on: [ 0 ], artist: 0,
		pickers: [ [ 0, 'guitar', 'guitar' ], [ 1, 'banjo', 'banjo' ] ] } ] ) ),
	{ QmLost: { song: 'Lost', on: [ 0 ], artist: 0, pickers: [ [ 0, 'guitar', 'guitar' ] ] } } ) } );
	const steps = K.walkSteps( g, [ { cid: 'QmAugust', via: null, at: 1 }, { cid: 'QmVictory', via: { name: 'Kyle' }, at: 2 } ] );
	const name = ( x ) => K.called( g, g.pieces[ x.id ] ).name;
	const all = K.walkRoads( g, steps, 3 );
	const said = all.flat().map( name );
	assert.equal( new Set( said ).size, said.length );                         // each place once in the whole walk
	assert.ok( !said.some( ( n ) => n === 'August' || n === 'Victory' ) );      // nowhere it has been: Victory on the single neither
	all.forEach( ( rs, i ) => {
		assert.equal( new Set( rs.map( ( r ) => r.by ) ).size, rs.length );     // a picker to each road
		assert.ok( rs.every( ( r ) => r.via[ 0 ] === r.by && g.pieces[ r.id ].cast.includes( r.by ) && castOf( steps[ i ] ).includes( r.by ) ) );
	} );
	function castOf( st ) {
		return st.cut.pickers.map( ( p ) => p[ 0 ] );
	}
	// The song on now chooses first, by Justin's order: for Justin, a Creative Commons studio track, and of those his
	// own (A Duet, with Molly) before one Kyle is on too; for Kyle, the studio track (Silver 44) before his show. From
	// August, Kyle was followed on to Victory: that road is the walk's own line; Silver 44 is said already, so
	// Justin's road from August is what's left of his.
	assert.deepEqual( all.map( ( rs ) => rs.map( ( r ) => [ name( r ), r.by ] ) ), [
		[ [ 'Sam Plays', 0 ] ],
		[ [ 'A Duet', 0 ], [ 'Silver 44', 1 ] ] ] );
	assert.deepEqual( K.walkRoads( g, steps, ( i ) => ( i ? 1 : 0 ) ).map( ( rs ) => rs.length ), [ 0, 1 ] );
	// Justin has carried this walk through every song, Kyle through two of three: Kyle's is the connection less used
	const three = K.walkSteps( g, [ { cid: 'QmAugust' }, { cid: 'QmVictory' }, { cid: 'QmLost' } ] );
	assert.deepEqual( K.walkRoads( g, three, ( i ) => ( i === 1 ? 1 : 0 ) )[ 1 ].map( ( r ) => r.by ), [ 1 ] );
	assert.deepEqual( K.walkRoads( g, K.walkSteps( g, [ { cid: 'QmNobody', song: 'Nobody' } ] ), 3 ), [ [] ] );   // a song the graph doesn't know leads nowhere here
	// A cut the graph knows only as its record: its own pickers, as its page names them, not everyone on the record
	const lost = K.walkSteps( g, [ { cid: 'QmLost', via: null, at: 1 } ] );
	assert.equal( lost[ 0 ].piece, g.whole[ 0 ] );
	assert.ok( g.pieces[ g.whole[ 0 ] ].cast.includes( 2 ) );                  // Molly is on the record
	assert.deepEqual( K.walkRoads( g, lost, 3 )[ 0 ].map( ( r ) => r.by ), [ 0 ] );   // and on no road from Lost, which is Justin's alone
} );

test( 'those the reader came by stay in the company, first, whatever their rank; a stranger does not join it', () => {
	const comp = K.company( G, KYLE );
	const ring = K.keeping( G, KYLE, comp, [ CHOIR, JUSTIN, LONE, KYLE ] );
	assert.deepEqual( ring.slice( 0, 2 ).map( ( c ) => c.id ), [ CHOIR, JUSTIN ] );   // Choir only shares a record with Kyle, and stays
	assert.equal( ring.length, comp.length + 1 );
	assert.equal( new Set( ring.map( ( c ) => c.id ) ).size, ring.length );
	assert.deepEqual( K.keeping( G, KYLE, comp ), comp );
} );

test( 'when the view changes, whoever was in sight takes the free place nearest where they would have slid to', () => {
	const places = [ { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 } ];
	assert.deepEqual( K.seat( places, [ null, { x: 19, y: 0 }, { x: 1, y: 1 } ] ), [ 1, 2, 0 ] );
	assert.deepEqual( K.seat( places, [ { x: 9, y: 0 }, { x: 9, y: 0 } ] ), [ 1, 0 ] );          // the first in line chooses first
	assert.deepEqual( K.seat( places.slice( 0, 1 ), [ null, { x: 0, y: 0 } ] ), [ -1, 0 ] );       // no place left: -1
	assert.deepEqual( K.seat( places, [ null, null, null ] ), [ 0, 1, 2 ] );
} );

test( 'a name tag sits on its line where there is room clear of both circles', () => {
	assert.deepEqual( K.tagAt( { x: 0, y: 0 }, { x: 300, y: 0 }, 24, 15 ), { x: 150, y: 0, room: 150 } );   // a long line: the middle, and all the room
	assert.deepEqual( K.tagAt( { x: 0, y: 0 }, { x: 0, y: 120 }, 24, 15 ), { x: 0, y: 60, room: 150 } );     // up and down: clear above and below
	const short = K.tagAt( { x: 0, y: 0 }, { x: 100, y: 0 }, 24, 15 );                                      // short, across: hardly any
	assert.ok( short.room < 60 && short.x > 50 );                                                           // and what there is, nearer the smaller circle
	assert.equal( K.tagAt( { x: 0, y: 0 }, { x: 30, y: 0 }, 24, 15 ).room, 0 );
} );

/* ---- the web: the lines among those round the middle ---- */

test( 'the web among some pickers is every tie between two of them who have played together, each once', () => {
	const web = K.among( G, [ JUSTIN, MOLLY, SAM, CHOIR, LONE ] );
	assert.deepEqual( web.map( ( t ) => [ t.u, t.v ] ), [ [ JUSTIN, MOLLY ], [ JUSTIN, SAM ] ] );
	assert.equal( web[ 0 ].tie, tie( JUSTIN, MOLLY ) );
	assert.deepEqual( K.among( G, [ MOLLY, SAM ] ), [] );                // both played with Kyle, never with each other
	assert.deepEqual( K.among( G, [ JUSTIN, JUSTIN ] ), [] );
	// A shared record without a shared track is no line, unless that's all there is to show.
	assert.deepEqual( K.among( G, [ JUSTIN, CHOIR, KYLE ] ).map( ( t ) => [ t.u, t.v ] ), [ [ JUSTIN, KYLE ] ] );
	assert.deepEqual( K.among( G, [ JUSTIN, CHOIR, KYLE ], true ).map( ( t ) => [ t.u, t.v ] ), [ [ JUSTIN, CHOIR ], [ JUSTIN, KYLE ], [ CHOIR, KYLE ] ] );
} );

test( 'between two pieces: the pickers on both, those on the most pieces first', () => {
	const sgp = K.findPiece( G, 'lma:sgp' ), old = K.findPiece( G, 'lma:old' ), duet = K.findPiece( G, 'discogs:7', 'A Duet' );
	assert.deepEqual( K.between( G, sgp, old ).map( ( p ) => NAMES[ p ] ), [ 'Kyle', 'Molly' ] );
	assert.deepEqual( K.between( G, old, sgp ).map( ( p ) => NAMES[ p ] ), [ 'Kyle', 'Molly' ] );
	assert.deepEqual( K.between( G, SILVER, VICTORY ).map( ( p ) => NAMES[ p ] ), [ 'Kyle', 'Justin' ] );
	assert.deepEqual( K.between( G, SILVER, duet ).map( ( p ) => NAMES[ p ] ), [ 'Justin' ] );
	assert.deepEqual( K.between( G, SILVER, old ).map( ( p ) => NAMES[ p ] ), [ 'Kyle' ] );
	assert.deepEqual( K.between( G, duet, old ).map( ( p ) => NAMES[ p ] ), [ 'Molly' ] );
} );

/** Points along the curve from pa to pb whose control point is `off` from the middle of the straight line. */
function along( pa, pb, off, steps = 48 ) {
	const qx = ( pa.x + pb.x ) / 2 + off.x, qy = ( pa.y + pb.y ) / 2 + off.y, out = [];
	for ( let i = 0; i <= steps; i++ ) {
		const t = i / steps;
		out.push( { t, x: ( 1 - t ) * ( 1 - t ) * pa.x + 2 * t * ( 1 - t ) * qx + t * t * pb.x, y: ( 1 - t ) * ( 1 - t ) * pa.y + 2 * t * ( 1 - t ) * qy + t * t * pb.y } );
	}
	return out;
}
const FRAMES = [ [ 945, 600 ], [ 1500, 900 ], [ 700, 480 ], [ 620, 760 ], [ 844, 520 ] ];

test( 'the web bows away from the middle: neighbours along the rim, nothing through the middle, nothing over a seat', () => {
	for ( const [ W, H ] of FRAMES ) {
		for ( let n = 2; n <= 8; n++ ) {
			const lay = K.ego( { W, H, named: n, dots: 0 } );
			const share = ( p ) => Math.hypot( ( p.x - lay.C.x ) / lay.rx, ( p.y - lay.C.y ) / lay.ry );   // 1 on the oval
			for ( let i = 0; i < n; i++ ) {
				for ( let j = i + 1; j < n; j++ ) {
					const pa = lay.named[ i ], pb = lay.named[ j ], off = K.arc( lay, pa, pb ), say = `${ W }x${ H }, ${ i } to ${ j } of ${ n }`;
					assert.deepEqual( K.arc( lay, pb, pa ), off, 'the same line either way: ' + say );
					const pts = along( pa, pb, off );
					const mid = pts[ ( pts.length - 1 ) / 2 ], step = Math.min( j - i, n - ( j - i ) );
					// a place is set down on a whole pixel, so the oval is known to within one
					assert.ok( pts.every( ( p ) => share( p ) <= 1 + 1.5 / lay.ry ), 'inside the oval: ' + say );
					assert.ok( pts.every( ( p ) => Math.hypot( p.x - lay.C.x, p.y - lay.C.y ) >= 45 ), 'clear of the middle: ' + say );
					if ( step === 1 && n >= 4 ) {
						assert.ok( Math.abs( share( mid ) - 1 ) < 1.5 / lay.ry, 'neighbours: along the rim: ' + say );
					} else {
						// further apart: lifted off the straight line, toward the rim but short of it
						const flat = Math.hypot( ( pa.x + pb.x ) / 2 - lay.C.x, ( pa.y + pb.y ) / 2 - lay.C.y );
						assert.ok( Math.hypot( mid.x - lay.C.x, mid.y - lay.C.y ) > flat + 8, 'lifted: ' + say );
						assert.ok( share( mid ) < 0.9, 'short of the rim: ' + say );
					}
					lay.named.forEach( ( seat, k ) => {
						if ( k !== i && k !== j ) {
							assert.ok( pts.every( ( p ) => Math.hypot( p.x - seat.x, p.y - seat.y ) >= 24 ), `clear of seat ${ k }: ` + say );
						}
					} );
				}
			}
		}
	}
} );

test( 'lines straight across go round the middle by either side in turn', () => {
	const lay = K.ego( { W: 945, H: 600, named: 8, dots: 0 } );
	const side = ( i ) => {
		const off = K.arc( lay, lay.named[ i ], lay.named[ i + 4 ] );
		const ax = lay.named[ i + 4 ].x - lay.named[ i ].x, ay = lay.named[ i + 4 ].y - lay.named[ i ].y;
		return Math.sign( ax * off.y - ay * off.x );                     // which side of the line the bow is on
	};
	assert.deepEqual( [ 0, 1, 2, 3 ].map( side ), [ side( 0 ), -side( 0 ), side( 0 ), -side( 0 ) ] );
	assert.notEqual( side( 0 ), 0 );
} );

test( 'with room for the web, a name leans outward from the oval; without, it stays centred and nothing changes', () => {
	const big = K.ego( { W: 945, H: 600, named: 8, dots: 30 } ), small = K.ego( { W: 390, H: 550, named: 6, dots: 12 } );
	assert.equal( big.web, true );
	assert.equal( small.web, false );
	assert.ok( small.named.every( ( p ) => p.lean === 0 ) );
	assert.equal( K.ego( { W: 945, H: 600, named: 1, dots: 0 } ).web, false );             // one picker round the middle: no web to draw
	for ( const p of big.named ) {
		assert.equal( Math.sign( Math.round( p.lean * 100 ) ), Math.sign( Math.round( ( p.x - big.C.x ) / 3 ) ), 'outward: ' + p.seat );
		assert.ok( Math.abs( p.lean ) <= 1 );
	}
	const side = big.named.reduce( ( a, b ) => ( Math.abs( b.lean ) > Math.abs( a.lean ) ? b : a ) );
	const top = big.named.reduce( ( a, b ) => ( Math.abs( b.lean ) < Math.abs( a.lean ) ? b : a ) );
	assert.ok( Math.abs( side.lean ) > 0.95 && Math.abs( side.y - big.C.y ) < big.ry * 0.25 );      // at the side: nearly its whole half-width
	assert.ok( Math.abs( top.lean ) < 0.25 && Math.abs( top.y - big.C.y ) > big.ry * 0.9 );           // at the top or the bottom: hardly at all
	// The beads keep clear of where a leaning name is: about 112 wide and 22 high, its middle 56 out from the picker,
	// over or under them. (Six round the middle at this size is where a bead sat under a name before they did.)
	for ( const lay of [ big, K.ego( { W: 945, H: 600, named: 6, dots: 30 } ), K.ego( { W: 1100, H: 560, named: 6, dots: 30 } ) ] ) {
		for ( const p of lay.named ) {
			for ( const d of lay.dots ) {
				assert.ok( !( Math.abs( d.x - ( p.x + p.lean * 56 ) ) < 62 && Math.abs( d.y - ( p.y + ( p.below ? 26 : -22 ) ) ) < 16 ),
					`a bead under the name at seat ${ p.seat } of ${ p.of }` );
			}
		}
		assert.ok( lay.dots.length >= 12, 'and there are still beads: ' + lay.dots.length );
	}
} );

test( 'a line of the web says how far apart round the oval its ends sit, the short way', () => {
	const lay = K.ego( { W: 945, H: 600, named: 8, dots: 0 } );
	assert.deepEqual( [ 1, 2, 3, 4, 5, 6, 7 ].map( ( j ) => K.arc( lay, lay.named[ 0 ], lay.named[ j ] ).apart ), [ 1, 2, 3, 4, 3, 2, 1 ] );
	assert.equal( K.arc( lay, lay.named[ 6 ], lay.named[ 1 ] ).apart, 3 );
} );

test( 'the places clear of some boxes: none inside one, nor within the pad of its edge', () => {
	const places = [ { x: 0, y: 0 }, { x: 50, y: 10 }, { x: 108, y: 10 }, { x: 112, y: 10 }, { x: 50, y: 31 }, { x: 50, y: 29 } ];
	const box = { x1: 10, y1: 0, x2: 100, y2: 20 };
	assert.deepEqual( K.clearOf( places, [ box ] ).map( ( p ) => p.x + ',' + p.y ), [ '0,0', '108,10', '112,10', '50,31', '50,29' ] );
	assert.deepEqual( K.clearOf( places, [ box ], 10 ).map( ( p ) => p.x + ',' + p.y ), [ '0,0', '112,10', '50,31' ] );
	assert.deepEqual( K.clearOf( places, [] ), places );
	assert.deepEqual( K.clearOf( places, [ box, { x1: -5, y1: -5, x2: 5, y2: 5 } ] ).length, 4 );
} );

/* ---- a step further: who the company leads on to, and where it all goes ---- */

// C in the middle; A and B are C's company; X, Y, Z are A's, each less loudly than the last; Z is B's too, less loudly still.
const STEP = K.build( { v: 1, people: [ 'C', 'A', 'B', 'X', 'Y', 'Z' ].map( ( n ) => [ n, 1, '' ] ),
	music: [ [ 'lma:one', 'show', 'Band', '2025-01-01', 'One', 2, '', '' ] ], cast: [ [] ],
	ties: [ [ 0, 1, [ [ 0, 2, 1, [] ] ] ], [ 0, 2, [ [ 0, 2, 1, [] ] ] ], [ 1, 3, [ [ 0, 2, 3, [] ] ] ], [ 1, 4, [ [ 0, 2, 2, [] ] ] ],
		[ 1, 5, [ [ 0, 2, 1, [] ] ] ], [ 2, 5, [ [ 0, 2, 0.5, [] ] ] ] ] } );
const ids = ( far ) => far.map( ( list ) => list.map( ( f ) => f.id ) );

test( 'a step further: who the company have played with that the one in the middle has no tie to at all', () => {
	// Kyle's company: Justin, Molly, Sam. Only Molly leads anywhere new: Vickie. Choir shares a record with Kyle, so is not new.
	const far = K.beyond( G, KYLE, [ JUSTIN, MOLLY, SAM ] );
	assert.deepEqual( ids( far ), [ [], [ VICKIE ], [] ] );
	assert.equal( far[ 1 ][ 0 ].by, MOLLY );
	assert.equal( far[ 1 ][ 0 ].tie, tie( MOLLY, VICKIE ) );
	// Vickie shares a record with Far, never a track: no way on by that, and Far is not new to her either.
	assert.deepEqual( ids( K.beyond( G, VICKIE, [ MOLLY ] ) ), [ [ KYLE, JUSTIN ] ] );      // the taped shows before the CD
	assert.deepEqual( ids( K.beyond( G, VICKIE, [ MOLLY ], 1 ) ), [ [ KYLE ] ] );
	assert.deepEqual( ids( K.beyond( G, MOLLY, [ VICKIE ] ) ), [ [] ] );
	assert.deepEqual( K.beyond( G, LONE, [] ), [] );
} );

test( 'each a step further is given once, under the one they have played with the most loudly; one left short takes who is left', () => {
	// Molly is new to Sam, and both Kyle and Justin have played with her: Kyle on tape, Justin on a CD.
	assert.deepEqual( ids( K.beyond( G, SAM, [ KYLE, JUSTIN ] ) ), [ [ MOLLY ], [] ] );
	assert.deepEqual( ids( K.beyond( G, SAM, [ JUSTIN, KYLE ] ) ), [ [], [ MOLLY ] ] );
	// A has three and room for two; Z, the least of them, is B's too, and B has room.
	assert.deepEqual( ids( K.beyond( STEP, 0, [ 1, 2 ] ) ), [ [ 3, 4 ], [ 5 ] ] );
	assert.equal( K.beyond( STEP, 0, [ 1, 2 ] )[ 1 ][ 0 ].by, 2 );
	assert.deepEqual( ids( K.beyond( STEP, 0, [ 1, 2 ], 3 ) ), [ [ 3, 4, 5 ], [] ] );          // with room, Z is under A: the louder way in
	assert.deepEqual( ids( K.beyond( STEP, 0, [ 1, 2 ], 1 ) ), [ [ 3 ], [ 5 ] ] );
	const all = K.beyond( STEP, 0, [ 1, 2 ] ).flat().map( ( f ) => f.id );
	assert.equal( new Set( all ).size, all.length );
} );

test( 'one the reader came by, a step further out now, comes first, and under the one they came by where those two have played', () => {
	assert.deepEqual( ids( K.beyond( G, VICKIE, [ MOLLY ], 2, [ JUSTIN ] ) ), [ [ JUSTIN, KYLE ] ] );
	assert.deepEqual( ids( K.beyond( G, VICKIE, [ MOLLY ], 1, [ MOLLY, JUSTIN ] ) ), [ [ JUSTIN ] ] );
	// Came to Sam from Molly by Justin: Molly hangs from Justin, though she has played more loudly with Kyle.
	assert.deepEqual( ids( K.beyond( G, SAM, [ KYLE, JUSTIN ], 2, [ JUSTIN, MOLLY ] ) ), [ [], [ MOLLY ] ] );
	assert.deepEqual( ids( K.beyond( G, SAM, [ KYLE, JUSTIN ], 2, [ MOLLY ] ) ), [ [ MOLLY ], [] ] );   // Justin wasn't on the way: the loudest, as ever
	assert.deepEqual( ids( K.beyond( STEP, 0, [ 1, 2 ], 2, [ 5 ] ) ), [ [ 5, 3 ], [] ] );
} );

test( 'with room for it, a second oval for those a step further: each straight on from the middle through one of the company', () => {
	const lay = K.ego( { W: 950, H: 648, named: 8, dots: 12, far: true } ), plain = K.ego( { W: 950, H: 648, named: 8, dots: 12 } );
	assert.equal( plain.far, null );
	assert.equal( lay.far.length, 8 );
	assert.equal( lay.web, true );
	assert.ok( lay.rx < plain.rx && lay.ry < plain.ry && lay.rx >= 170 && lay.ry >= 130 );      // the first oval gives way, but keeps room for its web
	// a little closer in than it first came (Justin, #connectome, 15 Nov 2026): at 750 by 500 too, web and all
	const near = K.ego( { W: 750, H: 500, named: 8, dots: 12, far: true } );
	assert.ok( near.far && near.far.length === 8 && near.web );
	const from = ( p ) => ( { x: p.x - lay.C.x, y: p.y - lay.C.y } ), cross = ( a, b ) => a.x * b.y - a.y * b.x, long = ( a ) => Math.hypot( a.x, a.y );
	lay.named.forEach( ( seat, i ) => {
		const s = from( seat ), m = from( lay.far[ i ].main ), [ before, after ] = lay.far[ i ].sides.map( from );
		assert.ok( Math.abs( cross( s, m ) ) / ( long( s ) * long( m ) ) < 0.012, 'one straight line, middle to seat to the one beyond: ' + i );
		assert.ok( Math.abs( long( m ) / long( s ) - 1.75 ) < 0.03, 'and that much further out: ' + i );
		assert.ok( cross( m, before ) < 0 && cross( m, after ) > 0, 'a second to either side: ' + i );
		assert.ok( long( before ) < long( m ) && long( after ) < long( m ) && long( before ) > long( s ) * 1.4, 'a little nearer in: ' + i );
		assert.equal( seat.lean, 0 );
		for ( const p of [ lay.far[ i ].main, ...lay.far[ i ].sides ] ) {
			assert.ok( p.x >= 120 && p.x <= 950 - 120 && p.y >= 50 && p.y <= 648 - 50, 'with room outside it for a name: ' + i );
		}
	} );
	// Every place a bead might go, on one oval between the two; the caller takes those clear of the names and the lines.
	assert.equal( lay.dots.length, 48 );
	assert.ok( lay.dots.every( ( p ) => Math.abs( Math.hypot( ( p.x - lay.C.x ) / lay.rx, ( p.y - lay.C.y ) / lay.ry ) - 1.36 ) < 0.02 ) );
	// Without the room, asking changes nothing.
	for ( const [ W, H, n ] of [ [ 694, 597, 6 ], [ 390, 550, 6 ], [ 950, 470, 6 ], [ 720, 648, 8 ] ] ) {
		assert.deepEqual( K.ego( { W, H, named: n, dots: 9, far: true } ), K.ego( { W, H, named: n, dots: 9 } ), `${ W }x${ H }` );
	}
	assert.equal( K.ego( { W: 950, H: 648, named: 1, dots: 0, far: true } ).far, null );          // one in the company: nothing to set out
	assert.equal( K.ego( { W: 1350, H: 898, named: 8, dots: 0, far: true } ).far.length, 8 );
} );

test( 'points along a line: both ends, no further apart than asked, and along the bow when it has one', () => {
	const p = { x: 10, y: 20 }, q = { x: 110, y: 20 }, far = ( a, b ) => Math.hypot( a.x - b.x, a.y - b.y );
	const flat = K.along( p, q );
	assert.deepEqual( [ flat[ 0 ], flat[ flat.length - 1 ] ], [ p, q ] );
	assert.ok( flat.every( ( a ) => Math.abs( a.y - 20 ) < 1e-9 && a.x >= 10 && a.x <= 110 ) );
	assert.ok( flat.slice( 1 ).every( ( a, i ) => far( a, flat[ i ] ) <= 5 + 1e-9 ) );
	assert.ok( K.along( p, q, null, 20 ).length < flat.length );
	const bowed = K.along( p, q, { x: 0, y: -60 } );
	assert.deepEqual( [ bowed[ 0 ], bowed[ bowed.length - 1 ] ], [ p, q ] );
	assert.ok( bowed.slice( 1 ).every( ( a, i ) => far( a, bowed[ i ] ) <= 5 + 1e-9 ) );
	assert.ok( bowed.some( ( a ) => far( a, { x: 60, y: -10 } ) < 2.6 ) );                         // the top of the bow: half as far as its control point
	assert.ok( bowed.every( ( a ) => a.y <= 20 + 1e-9 && a.y >= -10 - 1e-9 ) );
} );

test( 'places away from the lines, and a few taken evenly', () => {
	const pts = K.along( { x: 0, y: 0 }, { x: 100, y: 0 } );
	const places = [ { x: 50, y: 5 }, { x: 50, y: 11 }, { x: 50, y: 12 }, { x: 108, y: 0 }, { x: 113, y: 0 }, { x: 50, y: -30 } ];
	assert.deepEqual( K.away( places, pts, 12 ).map( ( p ) => p.x + ',' + p.y ), [ '50,12', '113,0', '50,-30' ] );
	assert.deepEqual( K.away( places, [], 12 ), places );
	const ten = [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ];
	assert.deepEqual( K.spread( ten, 5 ), [ 0, 2, 4, 6, 8 ] );
	assert.deepEqual( K.spread( ten, 3 ), [ 0, 3, 6 ] );
	assert.deepEqual( K.spread( ten, 20 ), ten );
	assert.deepEqual( K.spread( ten, 0 ), [] );
	assert.deepEqual( K.spread( [], 4 ), [] );
} );

const inBox = ( b, pts ) => pts.filter( ( q ) => q.x >= b.x1 && q.x <= b.x2 && q.y >= b.y1 && q.y <= b.y2 ).length;
const discBox = ( p, r ) => ( { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r } );

test( 'round a full ring, with the web and every way on drawn, each name finds a place no line runs through', () => {
	for ( const [ W, H ] of [ [ 950, 648 ], [ 1100, 700 ], [ 1350, 898 ], [ 1900, 1000 ] ] ) {
		for ( let n = 2; n <= 8; n++ ) {
			const lay = K.ego( { W, H, named: n, dots: 0, far: true } ), pts = [], boxes = [ discBox( lay.C, 26 ) ];
			lay.named.forEach( ( seat, i ) => {
				pts.push( ...K.along( lay.C, seat ), ...K.along( seat, lay.far[ i ].main ) );
				boxes.push( discBox( seat, 15 ), discBox( lay.far[ i ].main, 8 ) );
				lay.named.slice( i + 1 ).forEach( ( other ) => pts.push( ...K.along( seat, other, K.arc( lay, seat, other ) ) ) );
			} );
			lay.named.forEach( ( seat, i ) => {                       // the company's names, then those of the ones beyond
				const b = K.beside( seat, 14, 118, 16, pts, boxes, { W, H }, { x: seat.x - lay.C.x, y: seat.y - lay.C.y } );
				assert.ok( b && b.room >= 4, `${ W }x${ H }, seat ${ i } of ${ n }: room ${ b && b.room }` );
				assert.equal( inBox( b.box, pts ), 0 );
				boxes.push( b.box );
			} );
			lay.far.forEach( ( f, i ) => {
				const b = K.beside( f.main, 6, 118, 15, pts, boxes, { W, H }, { x: f.main.x - lay.C.x, y: f.main.y - lay.C.y } );
				assert.ok( b && b.room >= 4, `${ W }x${ H }, beyond seat ${ i } of ${ n }: room ${ b && b.room }` );
				boxes.push( b.box );
			} );
			const names = boxes.slice( 1 + 2 * n );
			names.forEach( ( x, i ) => names.slice( i + 1 ).forEach( ( y ) =>
				assert.ok( x.x2 < y.x1 || y.x2 < x.x1 || x.y2 < y.y1 || y.y2 < x.y1, `${ W }x${ H }, ${ n }: two names on each other` ) ) );
		}
	}
} );
const FRAME = { W: 950, H: 648 }, AT = { x: 400, y: 300 };

test( 'a name goes beside its circle where no line runs through it', () => {
	const up = K.along( AT, { x: 410, y: 150 } ), down = K.along( AT, { x: 390, y: 450 } ), across = K.along( AT, { x: 560, y: 300 } );
	// A line straight on up and one back down: over and under are out, and so is leaning over them.
	const a = K.beside( AT, 14, 100, 16, up.concat( down ), [], FRAME, { x: 0, y: -1 } );
	assert.equal( inBox( a.box, up.concat( down ) ), 0 );
	assert.ok( a.room >= 8, 'room: ' + a.room );
	assert.ok( a.box.y2 < AT.y, 'outward of the two sides that are clear: ' + JSON.stringify( a.box ) );
	// (A box round the circle itself, as the caller keeps for every circle, is no bar to a place beside it.)
	const own = { x1: AT.x - 22, y1: AT.y - 22, x2: AT.x + 22, y2: AT.y + 22 };
	assert.deepEqual( K.beside( AT, 14, 100, 16, up.concat( down ), [ own ], FRAME, { x: 0, y: -1 } ), a );
	// A line straight out to the right: not beside it on the right, however far out that is.
	const b = K.beside( AT, 14, 100, 16, across, [], FRAME, { x: 1, y: 0 } );
	assert.equal( inBox( b.box, across ), 0 );
	assert.ok( b.room >= 8 && b.box.x2 > AT.x, JSON.stringify( b ) );
	// Even when the only other place left is the way back in, with a line hard by it: near a line is better than on one.
	const above = { x1: 200, y1: 200, x2: 700, y2: 284 }, below = { x1: 200, y1: 316, x2: 700, y2: 400 };
	const near = K.along( { x: 279, y: 288 }, { x: 379, y: 288 } );
	const c = K.beside( AT, 14, 100, 16, across.concat( near ), [ above, below ], FRAME, { x: 1, y: 0 } );
	assert.equal( c.anchor, 'end' );
	assert.equal( inBox( c.box, across.concat( near ) ), 0 );
	assert.ok( Math.abs( c.room - 4 ) < 0.01 );
	// The text starts where its anchor says, beside the circle and not on it.
	for ( const r of [ a, b ] ) {
		const start = r.anchor === 'start' ? r.box.x1 : ( r.anchor === 'end' ? r.box.x2 : ( r.box.x1 + r.box.x2 ) / 2 );
		assert.ok( Math.abs( AT.x + r.x - start ) <= 0.5 && AT.y + r.y > r.box.y1 && AT.y + r.y < r.box.y2 );
		assert.ok( Math.hypot( Math.max( r.box.x1 - AT.x, 0, AT.x - r.box.x2 ), Math.max( r.box.y1 - AT.y, 0, AT.y - r.box.y2 ) ) >= 14 );
	}
} );

test( 'with nothing in the way a name sits straight out from the middle; a name or a circle already there, or the frame, moves it', () => {
	const none = [];
	const right = K.beside( AT, 14, 100, 16, none, [], FRAME, { x: 1, y: 0 } );
	assert.equal( right.anchor, 'start' );
	assert.deepEqual( [ right.box.x1, right.box.y1, right.box.y2 ], [ AT.x + 21, AT.y - 8, AT.y + 8 ] );   // hard by the circle: no further off than it must be
	// A box round the circle itself, as the caller keeps for every circle, is no bar to the place beside it.
	assert.deepEqual( K.beside( AT, 14, 100, 16, none, [ { x1: AT.x - 19, y1: AT.y - 19, x2: AT.x + 19, y2: AT.y + 19 } ], FRAME, { x: 1, y: 0 } ), right );
	assert.equal( K.beside( AT, 14, 100, 16, none, [], FRAME, { x: -1, y: 0 } ).anchor, 'end' );
	const over = K.beside( AT, 14, 100, 16, none, [], FRAME, { x: 0, y: -1 } ), under = K.beside( AT, 14, 100, 16, none, [], FRAME, { x: 0, y: 1 } );
	assert.ok( over.anchor === 'middle' && over.box.y2 < AT.y - 14 && under.anchor === 'middle' && under.box.y1 > AT.y + 14 );
	// Something already where it would go: somewhere else, and not touching it.
	const taken = { x1: 410, y1: 285, x2: 600, y2: 315 };
	const moved = K.beside( AT, 14, 100, 16, none, [ taken ], FRAME, { x: 1, y: 0 } );
	assert.ok( moved.box.x1 > taken.x2 + 3 || moved.box.x2 < taken.x1 - 3 || moved.box.y1 > taken.y2 + 3 || moved.box.y2 < taken.y1 - 3 );
	// At the frame's edge the name stays inside it.
	const edge = K.beside( { x: 930, y: 300 }, 6, 100, 15, none, [], FRAME, { x: 1, y: 0 } );
	assert.ok( edge.box.x2 <= 946 && edge.box.x1 >= 4 );
	assert.equal( K.beside( { x: 10, y: 10 }, 6, 100, 15, none, [], { W: 60, H: 40 }, { x: 1, y: 0 } ), null );     // nowhere at all
} );

/* ---- what comes first (Justin, #connectome, 15 Nov 2026) ---- */

test( 'what comes first: a Permanent studio track, a Permanent show, a Full studio track, another show; then the rest', () => {
	const rec = ( tier ) => ( { kind: 'record', tier } ), show = ( tier ) => ( { kind: 'show', tier } );
	const order = [ [ rec( 2 ), K.TRACK ], [ show( 2 ), K.STAGE ], [ rec( 1 ), K.TRACK ], [ show( 1 ), K.STAGE ], [ rec( 0 ), K.TRACK ], [ rec( 2 ), K.RECORD ] ];
	const ranks = order.map( ( [ m, how ] ) => K.standing( m, how ) );
	assert.deepEqual( ranks.slice().sort( ( x, y ) => y - x ), ranks );
	assert.equal( new Set( ranks ).size, ranks.length );
	assert.equal( K.standing( show( 0 ), K.STAGE ), K.standing( show( 1 ), K.STAGE ) );         // "other shows": one kind
	assert.equal( K.standing( show( 2 ), K.TRACK ), K.standing( show( 2 ), K.STAGE ) );         // a show is a show, whoever sat in on which song
	// A tie stands as high as the best thing in it, and that comes before how much there is of anything lesser.
	const music = [ rec( 2 ), show( 2 ), rec( 1 ), show( 0 ) ].map( ( m, id ) => Object.assign( m, { id, date: '', key: 'k' + id } ) );
	const tieOf = ( ...ev ) => K.summarize( 0, 1, ev.map( ( [ m, how, w ] ) => ( { m, how, w, songs: how === K.TRACK ? [ 'A Song' ] : [] } ) ), music );
	const oneTrack = tieOf( [ 0, K.TRACK, 0.5 ] ), manyShows = tieOf( [ 1, K.STAGE, 40 ] ), fullTrack = tieOf( [ 2, K.TRACK, 30 ] ), otherShow = tieOf( [ 3, K.STAGE, 90 ] );
	assert.deepEqual( [ oneTrack.rank, manyShows.rank, fullTrack.rank, otherShow.rank ], [ 5, 4, 3, 2 ] );
	assert.equal( tieOf( [ 3, K.STAGE, 1 ], [ 0, K.TRACK, 1 ], [ 2, K.TRACK, 1 ] ).rank, 5 );        // the best of what's in it, wherever it comes
	assert.ok( K.loudness( oneTrack ) > K.loudness( manyShows ) && K.loudness( manyShows ) > K.loudness( fullTrack ) && K.loudness( fullTrack ) > K.loudness( otherShow ) );
	assert.ok( K.loudness( otherShow ) > K.loudness( tieOf( [ 0, K.RECORD, 99 ] ) ) );             // only a record shared: after all who played together
	assert.ok( K.loudness( tieOf( [ 1, K.STAGE, 3 ] ) ) > K.loudness( tieOf( [ 1, K.STAGE, 2 ] ) ) );   // alike in standing: the more, the louder
	assert.ok( K.loudness( tieOf( [ 0, K.RECORD, 1 ] ) ) > K.loudness( tieOf( [ 2, K.RECORD, 50 ] ) ) );  // only sharing a record: the freest record first
	// And within a tie, its music is listed in that order.
	assert.deepEqual( tieOf( [ 3, K.STAGE, 1 ], [ 2, K.TRACK, 1 ], [ 1, K.STAGE, 1 ], [ 0, K.TRACK, 1 ] ).ev.map( ( e ) => e.m ), [ 0, 1, 2, 3 ] );
} );

test( 'a piece stands as its kind does; a record whole, where no source says who is on which track, after them', () => {
	assert.equal( K.pieceStanding( G, G.pieces[ SILVER ] ), 5 );
	assert.equal( K.pieceStanding( G, G.pieces[ 1 ] ), 4 );                                       // a taper's tape
	assert.equal( K.pieceStanding( G, G.pieces[ K.findPiece( G, 'discogs:7', 'A Duet' ) ] ), 3 ); // a track on a Full Release
	assert.ok( K.pieceStanding( G, G.pieces[ 0 ] ) < 1 && K.pieceStanding( G, G.pieces[ 0 ] ) > K.pieceStanding( G, G.pieces[ 3 ] ) );
} );

test( 'the boxes find anything: a picker by name; a cut, a show, a record or a track by a name that says which it is', () => {
	const all = K.catalogue( G ), by = new Map( all.map( ( x ) => [ x.label, x.view ] ) );
	assert.equal( new Set( all.map( ( x ) => x.label.toLowerCase() ) ).size, all.length );
	NAMES.forEach( ( n, id ) => assert.deepEqual( by.get( n ), { a: id } ) );
	assert.deepEqual( by.get( 'Sam Grisman Project · live · 5 Jul 2025' ), { m: 1 } );             // never taken for the band of that name
	assert.deepEqual( by.get( 'Hello Decentralization · live · block 11,908,068' ), { m: 5 } );
	assert.deepEqual( by.get( 'Safe, Sensible And Sane · record, Alison Brown · 2025' ), { m: 2 } );
	assert.deepEqual( by.get( 'Silver 44 · track on 4masks' ), { m: SILVER } );
	assert.ok( all.every( ( x ) => x.view.a !== undefined || / · (song|live|record|track)/.test( x.label ) ) );
	// A song the pages state a cut of is found as that cut, and not again as a track.
	const cuts = K.catalogue( K.build( Object.assign( {}, GRAPH, { songcast: { QmCut: { song: 'Silver 44', on: [ 0 ] } } } ) ) );
	assert.deepEqual( cuts.find( ( x ) => x.label === 'Silver 44 · song on 4masks' ).view, { s: 'Silver 44', cut: 'QmCut' } );
	assert.ok( !cuts.some( ( x ) => x.label === 'Silver 44 · track on 4masks' ) && cuts.some( ( x ) => x.label === 'Victory · track on 4masks' ) );
	// Two tapes of one night are one piece, found once.
	const NIGHT = K.build( { v: 1, people: [ [ 'A', 1, '' ], [ 'B', 1, '' ] ], cast: [ [], [] ], ties: [ [ 0, 1, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ] ],
		music: [ [ 'lma:t1', 'show', 'Band', '2025-06-14', 'Band Live', 2, '', '' ], [ 'lma:t2', 'show', 'Band', '2025-06-14', 'Band Live (another taper)', 2, '', '' ] ] } );
	assert.deepEqual( K.catalogue( NIGHT ).map( ( x ) => x.label ), [ 'A', 'B', 'Band · live · 14 Jun 2025' ] );
	// A record nobody here is on has nothing to show, and isn't offered; two pressings of one record are offered once.
	const SHELF = K.build( { v: 1, people: [ [ 'A', 1, '' ], [ 'B', 1, '' ] ], cast: [ [], [], [] ],
		ties: [ [ 0, 1, [ [ 0, 1, 1, [] ], [ 1, 1, 1, [] ] ] ] ],
		music: [ [ 'discogs:1', 'record', 'Someone', '2026', 'A Single', 1, '', '' ], [ 'discogs:2', 'record', 'Someone', '2026', 'A Single', 1, '', '' ],
			[ 'arthel:empty', 'record', '', '', 'Nobody On It', 2, '', '' ] ] } );
	assert.deepEqual( K.catalogue( SHELF ).map( ( x ) => [ x.label, x.view ] ), [ [ 'A', { a: 0 } ], [ 'B', { a: 1 } ], [ 'A Single · record, Someone · 2026', { m: 0 } ] ] );
} );

test( 'between two pickers, a way round by studio tracks comes before one by shows as free, however many the shows', () => {
	const WAYS = K.build( { v: 1, people: [ 'A', 'B', 'X', 'Y' ].map( ( n ) => [ n, 1, '' ] ), cast: [ [], [] ],
		music: [ [ 'arthel:rec', 'record', '', '', 'A Record', 2, '', '' ], [ 'lma:show', 'show', 'Band', '2025-01-01', 'A Show', 2, '', '' ] ],
		ties: [ [ 0, 2, [ [ 1, 2, 9, [] ] ] ], [ 1, 2, [ [ 1, 2, 9, [] ] ] ], [ 0, 3, [ [ 0, 3, 1, [ 'A Song' ] ] ] ], [ 1, 3, [ [ 0, 3, 1, [ 'A Song' ] ] ] ] ] } );
	const ways = K.mutuals( WAYS, 0, 1 );
	assert.deepEqual( ways.map( ( m ) => [ WAYS.people[ m.id ].name, m.rank, m.tier ] ), [ [ 'Y', 5, 2 ], [ 'X', 4, 2 ] ] );
} );

test( 'the way home from a cut ends at its artist, then its writer on the track, then the ensemble', () => {
	// Justin, #connectome, 15 Nov 2026, 07:29Z
	const cut = { artist: JUSTIN, writers: [ MOLLY ], pickers: [ [ KYLE, 'banjo' ], [ MOLLY, 'guitar' ], [ JUSTIN, 'guitar' ], [ -1, 'x' ] ] };
	assert.deepEqual( K.homeward( cut, KYLE ), [ JUSTIN, MOLLY ] );          // from anyone else's view: the artist
	assert.deepEqual( K.homeward( cut, JUSTIN ), [ MOLLY, KYLE ] );          // from the artist's own: the writer
	assert.deepEqual( K.homeward( { ...cut, writers: [ JUSTIN ] }, JUSTIN ), [ KYLE, MOLLY ] );   // both are the middle: the ensemble
	assert.deepEqual( K.homeward( { artist: null, writers: [], pickers: [ [ SAM, 'bass' ] ] }, KYLE ), [ SAM ] );
	assert.deepEqual( K.homeward( { artist: VICKIE, pickers: [] }, KYLE ), [ VICKIE ] );         // an older graph.json: no writers
} );

/* A bacon graph kept as shared (Justin, #connectome, 16 Nov 2026). */

const SHARED = Object.assign( {}, GRAPH, {
	made: MUSIC.map( ( _, i ) => ( i === 0 ? [ JUSTIN ] : [] ) ),
	cast: MUSIC.map( ( _, i ) => ( i === 0 ? [ [ KYLE, 'banjo' ], [ JUSTIN, 'guitar' ], [ LONE, 'bass' ] ] : [] ) ),
	songcast: { QmSilver44: { song: 'Silver 44', on: [ 0 ], artist: JUSTIN, writers: [ VICKIE ], pickers: [ [ KYLE, 'banjo' ], [ LONE, 'bass' ] ] } },
	songs: { 'Silver 44': '/wiki/Song:Silver_44', 'Elsewhere': '/wiki/Song:Elsewhere' },
	plays: { 'Silver 44': 'QmSilver44', 'A Duet': 'QmSomeoneElses' }
} );
const nameOf = ( g, i ) => g.people[ i ][ 0 ];

test( 'a view is kept by its kind: a constellation, a relationship, a lineup; not the walk, yet', () => {
	assert.equal( K.kindOf( { a: KYLE } ), 'c' );
	assert.equal( K.kindOf( { a: KYLE, keep: [ JUSTIN ], by: 2 } ), 'c' );
	assert.equal( K.kindOf( { a: KYLE, b: JUSTIN } ), 'r' );
	assert.equal( K.kindOf( { m: 3 } ), 'm' );
	assert.equal( K.kindOf( { s: 'Silver 44', cut: 'QmSilver44' } ), 'm' );
	assert.equal( K.kindOf( { walk: true } ), null );
	assert.equal( K.kindOf( null ), null );
} );

test( 'a kept graph holds the ties among those in sight, all they say, and no tie to anyone else', () => {
	const k = K.keep( SHARED, [ MOLLY, KYLE, JUSTIN ] );
	const names = k.people.map( ( p ) => p[ 0 ] );
	// In sight, and named for the record they share: its maker and its cut's writer. Not its bassist, out of sight.
	assert.deepEqual( names, [ 'Kyle', 'Justin', 'Molly', 'Vickie' ] );
	assert.deepEqual( k.ties.map( ( [ a, b, evs ] ) => [ names[ a ], names[ b ], evs.map( ( e ) => k.music[ e[ 0 ] ][ 0 ] ) ] ), [
		[ 'Kyle', 'Justin', [ 'arthel:4masks', 'arthel:show:0-1' ] ],
		[ 'Kyle', 'Molly', [ 'lma:sgp', 'lma:old' ] ],
		[ 'Justin', 'Molly', [ 'discogs:7' ] ]
	] );
	assert.ok( !k.music.some( ( m ) => m[ 0 ] === 'discogs:8' ) );                // only Justin and Sam's: Sam is out of sight
	assert.deepEqual( k.made[ 0 ].map( ( p ) => names[ p ] ), [ 'Justin' ] );
	assert.deepEqual( k.cast[ 0 ].map( ( c ) => [ names[ c[ 0 ] ], c[ 1 ] ] ), [ [ 'Kyle', 'banjo' ], [ 'Justin', 'guitar' ] ] );
	assert.deepEqual( k.songcast.QmSilver44.pickers.map( ( p ) => names[ p[ 0 ] ] ), [ 'Kyle' ] );
	assert.deepEqual( Object.keys( k.songcast ), [ 'QmSilver44' ] );
	const cut = k.songcast.QmSilver44;
	assert.deepEqual( [ names[ cut.artist ], cut.writers.map( ( w ) => names[ w ] ), cut.on ], [ 'Justin', [ 'Vickie' ], [ 0 ] ] );
	assert.deepEqual( k.songs, { 'Silver 44': '/wiki/Song:Silver_44' } );
	assert.deepEqual( k.plays, { 'Silver 44': 'QmSilver44' } );
	assert.equal( k.built, GRAPH.built );
} );

test( 'a hub keeps every tie it has: who of a middle\'s company is drawn is chosen from all of it', () => {
	const k = K.keep( SHARED, [ KYLE, JUSTIN ], [], [ KYLE ] );
	const names = k.people.map( ( p ) => p[ 0 ] );
	const pairs = k.ties.map( ( [ a, b ] ) => names[ a ] + '-' + names[ b ] );
	assert.deepEqual( pairs, [ 'Kyle-Justin', 'Kyle-Molly', 'Kyle-Sam', 'Kyle-Choir' ] );   // not Justin-Sam: Sam came by Kyle
	const kept = K.build( k ), kyle = kept.byName.get( 'kyle' );
	assert.deepEqual( K.company( kept, kyle ).map( ( c ) => c.id ).sort(), K.company( G, KYLE ).map( ( c ) => kept.byName.get( NAMES[ c.id ].toLowerCase() ) ).sort() );
} );

test( 'a kept graph draws as the whole does, from only what was in sight', () => {
	const kept = K.build( K.keep( SHARED, [ KYLE, JUSTIN, MOLLY ] ) );
	const kyle = kept.byName.get( 'kyle' ), justin = kept.byName.get( 'justin' );
	assert.deepEqual( K.company( kept, kyle ).map( ( c ) => kept.people[ c.id ].name ).sort(), [ 'Justin', 'Molly' ] );
	const was = tie( KYLE, JUSTIN ), is = kept.adj[ kyle ].get( justin );
	assert.deepEqual( [ is.times, is.shows, is.records, is.tracks, is.tier, is.w ], [ was.times, was.shows, was.records, was.tracks, was.tier, was.w ] );
	assert.equal( kept.people[ kept.byName.get( 'vickie' ) ].name, 'Vickie' );
	assert.equal( kept.adj[ kept.byName.get( 'vickie' ) ].size, 0 );           // a writer by name, with none of her ties
} );

test( 'the same view kept twice is the same graph, whatever order its pickers came in', () => {
	const one = K.keptText( K.keep( SHARED, [ KYLE, JUSTIN, MOLLY ] ) ), two = K.keptText( K.keep( SHARED, [ MOLLY, JUSTIN, KYLE, KYLE ] ) );
	assert.equal( one, two );
	assert.notEqual( one, K.keptText( K.keep( SHARED, [ KYLE, JUSTIN ] ) ) );
} );

test( 'a kept graph\'s text is plain ASCII with no "<", and reads back as it was', () => {
	const doc = { on: [ 'Béla Fleck', 'Ólafur', '<b>Bold</b>', 'Emoji 🎻' ] };
	const text = K.keptText( doc );
	assert.match( text, /^[\x20-\x7e]*$/ );
	assert.ok( !text.includes( '<' ) );
	assert.deepEqual( JSON.parse( text ), doc );
} );

test( 'a kept graph\'s ID is its kind and fifty bits of its SHA-256, in letters that read aloud', async () => {
	assert.equal( await K.keptId( 'c', 'abc' ), 'cq9w1dfwf07' );               // worked out in Python, apart from this code
	assert.equal( await K.keptId( 'c', '{"bacon":1}' ), 'cdwv0g0t5w5' );
	const id = await K.keptId( 'r', K.keptText( K.keep( SHARED, [ KYLE, JUSTIN ] ) ) );
	assert.match( id, K.KEPT_ID );
	assert.equal( id[ 0 ], 'r' );
	assert.ok( !K.KEPT_ID.test( 'cq9w1dfwf0i' ) && !K.KEPT_ID.test( 'xq9w1dfwf07' ) && !K.KEPT_ID.test( 'cq9w1dfwf0' ) );
} );

test( 'opened later, a kept graph says which of its ties have lost a source, lost them all, or are new', () => {
	const sight = [ KYLE, JUSTIN, MOLLY, VICKIE ];
	const kept = K.build( K.keep( SHARED, sight ) );
	// Since then: Kyle and Molly's 2019 tape was found to be someone else; Justin and Molly's record too;
	// and Justin and Vickie turned up together on a record.
	const later = Object.assign( {}, SHARED, { ties: SHARED.ties
		.map( ( [ a, b, evs ] ) => [ a, b, a === KYLE && b === MOLLY ? evs.filter( ( e ) => e[ 0 ] !== 4 ) : evs ] )
		.filter( ( [ a, b ] ) => !( a === JUSTIN && b === MOLLY ) )
		.concat( [ [ JUSTIN, VICKIE, [ [ 3, 3, 1, [ 'New' ] ] ] ] ] ) } );
	const s = K.since( kept, K.build( later ), sight.map( ( i ) => nameOf( SHARED, i ) ) );
	assert.equal( s.state.get( K.pairName( 'Kyle', 'Justin' ) ), 'same' );
	assert.equal( s.state.get( K.pairName( 'Molly', 'Kyle' ) ), 'changed' );
	assert.equal( s.state.get( K.pairName( 'Justin', 'Molly' ) ), 'gone' );
	assert.equal( s.state.get( K.pairName( 'Molly', 'Vickie' ) ), 'same' );
	assert.deepEqual( [ s.changed, s.gone, s.grown ], [ 1, 1, 1 ] );
	assert.equal( K.since( kept, K.build( SHARED ), sight.map( ( i ) => nameOf( SHARED, i ) ) ).gone, 0 );
} );

/* A QR code of where the reader is (Justin, #connectome, 16 Nov 2026). */

import { createHash } from 'node:crypto';
const qrPrint = ( q ) => createHash( 'sha256' ).update( q.rows.map( ( r ) => r.join( '' ) ).join( '\n' ) ).digest( 'hex' ).slice( 0, 16 );

test( 'a QR code is the smallest version that holds the text', () => {
	assert.equal( K.qrCode( 'x'.repeat( 17 ), 'L' ).version, 1 );           // version 1 at L holds 17 bytes
	assert.equal( K.qrCode( 'x'.repeat( 18 ), 'L' ).version, 2 );
	assert.equal( K.qrCode( 'x'.repeat( 14 ), 'M' ).version, 1 );
	assert.equal( K.qrCode( 'x'.repeat( 15 ), 'M' ).version, 2 );
	const q = K.qrCode( 'https://pickipedia.xyz' );
	assert.deepEqual( [ q.version, q.size, q.rows.length, q.rows[ 0 ].length ], [ 2, 25, 25, 25 ] );
	assert.throws( () => K.qrCode( 'x'.repeat( 3000 ) ), RangeError );
} );

test( 'a QR code says its level and mask where a reader looks for them', () => {
	for ( const ecl of [ 'L', 'M' ] ) {
		for ( let mask = 0; mask < 8; mask++ ) {
			const { rows } = K.qrCode( 'https://pickipedia.xyz/bacon/cepkp1cxqmc', ecl, mask );
			const at = [ [ 8, 0 ], [ 8, 1 ], [ 8, 2 ], [ 8, 3 ], [ 8, 4 ], [ 8, 5 ], [ 8, 7 ], [ 8, 8 ], [ 7, 8 ], [ 5, 8 ], [ 4, 8 ], [ 3, 8 ], [ 2, 8 ], [ 1, 8 ], [ 0, 8 ] ];
			const bits = at.reduce( ( b, [ x, y ], i ) => b | ( rows[ y ][ x ] << i ), 0 ) ^ 0x5412;
			let rem = bits;
			for ( let i = 14; i >= 10; i-- ) {
				if ( ( rem >>> i ) & 1 ) {
					rem ^= 0x537 << ( i - 10 );
				}
			}
			assert.equal( rem, 0, 'the format bits are a BCH code word' );
			assert.deepEqual( [ bits >>> 13, ( bits >>> 10 ) & 7 ], [ ecl === 'L' ? 1 : 0, mask ] );
		}
	}
} );

test( 'QR codes a reader read back whole stay as they were', () => {
	// Each was drawn, then read by zxing-cpp to the same text (16 Nov 2026): versions 2, 3, 6 and 18.
	assert.equal( qrPrint( K.qrCode( 'https://pickipedia.xyz', 'L' ) ), '459755bfb71f347f' );
	assert.equal( qrPrint( K.qrCode( 'https://pickipedia.xyz/bacon/cepkp1cxqmc', 'L' ) ), 'd5c686acf8af945b' );
	assert.equal( qrPrint( K.qrCode( 'https://pickipedia.xyz/bacon?p=Justin+Myles+Holmes&keep=Kyle+Tuttle%2CBronwyn&by=lma%3AEastNashGrass2024-06-30&on=Big+Sandy', 'L' ) ), '8db2a4bc92538d11' );
	assert.equal( qrPrint( K.qrCode( 'https://pickipedia.xyz/bacon?' + 'p=Vickie+Vaughn&'.repeat( 30 ), 'M' ) ), '2c1cfb3f5af21c41' );
} );

test( 'a QR code is drawn as one path, a unit a module, inside a quiet zone of four', () => {
	const q = K.qrCode( 'https://pickipedia.xyz' ), p = K.qrPath( q );
	assert.equal( p.side, 33 );
	assert.equal( ( p.d.match( /M/g ) || [] ).length, q.rows.flat().filter( Boolean ).length );
	assert.ok( p.d.startsWith( 'M4 4h1v1h-1z' ) );                         // the finder's corner
} );

test( 'a ring with its card out leaves the upper right place empty, and stands nobody straight over or under the middle (Justin, 20 Nov 2026)', () => {
	for ( let n = 3; n <= 12; n++ ) {
		const { turn, gap } = K.gapFor( n );
		const lay = K.ego( { W: 900, H: 700, named: n, dots: 0, turn } );
		assert.equal( lay.named.length, n );
		const left = lay.named[ gap ];
		// the place left out is the one nearest 45 degrees up and to the right, and is in that quarter
		const off = ( p ) => Math.abs( ( ( p.angle + 45 ) % 360 + 540 ) % 360 - 180 );
		assert.ok( lay.named.every( ( p ) => off( left ) <= off( p ) + 1e-9 ), `n=${ n }: nearest the corner` );
		assert.ok( left.x > lay.C.x && left.y < lay.C.y, `n=${ n }: up and to the right` );
		assert.ok( Math.abs( turn ) <= 180 / n + 1e-9, `n=${ n }: at most half a step round` );
		for ( const [ i, p ] of lay.named.entries() ) {
			if ( i !== gap ) {
				assert.ok( Math.abs( ( ( p.angle % 180 ) + 180 ) % 180 - 90 ) >= 8 - 1e-9 || turn === 0, `n=${ n }: place ${ i } stands clear of twelve and six` );
			}
		}
	}
	assert.equal( Math.abs( K.gapFor( 6 ).turn ), 30 );                  // six: turned half a step so one is at the corner, and five stay
	assert.equal( K.gapFor( 8 ).turn, 0 );                               // eight: a turn would stand two upright
	assert.deepEqual( K.gapFor( 2 ), { turn: 90, gap: -1 } );            // two: turned clear of the corner, both stay
	assert.deepEqual( K.gapFor( 1 ), { turn: 0, gap: -1 } );
	assert.deepEqual( K.ego( { W: 900, H: 700, named: 6, dots: 0 } ).named.map( ( p ) => p.angle ), [ -75, -15, 45, 105, 165, 225 ] );   // not asked to turn: as it was
} );

test( 'while a song plays: the rest of the band, the ring that seats them, and a place over the middle', () => {
	const G = { people: [ {}, {}, {}, {} ] };
	const cut = { pickers: [ [ 2, 'banjo' ], [ 0, 'guitar' ], [ -1, 'fiddle' ], [ 3, 'bass' ], [ 0, 'vocals' ], [ 9, 'drums' ] ] };
	assert.deepEqual( K.bandOf( G, cut, 0 ), [ 2, 3 ] );               // the soloist left out; one the graph doesn't know, and one past its end, too
	assert.deepEqual( K.bandOf( G, cut, 2 ), [ 0, 3 ] );               // each once, in the page's order
	assert.deepEqual( K.bandOf( G, null, 0 ), [] );
	// five others, the song and the card's corner: seven places in the pane at 1366x768 (557x734), whoever takes the solo
	assert.equal( K.bandSeats( 5, 6, true, 557, 734 ), 7 );
	assert.equal( K.bandSeats( 5, 6, false, 557, 734 ), 6 );
	assert.equal( K.bandSeats( 7, 6, true, 557, 734 ), 9 );            // a band of eight
	assert.equal( K.bandSeats( 7, 6, true, 567, 573 ), 8 );            // a shorter frame holds eight places: one of the seven is a bead
	assert.equal( K.bandSeats( 5, 4, true, 390, 460 ), 6 );            // a phone: six places, four of the five named
	assert.equal( K.bandSeats( 1, 8, true, 1111, 1046 ), 8 );          // a duo: never fewer than the frame names anyway
	// seven places: turned so one is at the corner, though that stands one nearly straight over the middle; never under it
	assert.equal( K.gapFor( 7 ).turn, 0 );
	assert.ok( Math.abs( K.gapFor( 7, true ).turn + 19.29 ) < 0.01 );
	assert.equal( K.gapFor( 8, true ).turn, 0 );                        // eight: the turn would stand one straight under
} );

/* A trunk (Justin, #connectome, 21 Nov 2026, 01:56Z): those between two pickers who share one show with an end are one line from that end. */
const TRUNKS = K.build( {
	v: 1, built: '2026-11-21', month: '2026-11', featured: [],
	people: [ 'Honza', 'Jakub', 'Jirka', 'Petr', 'Jarda', 'Sky', 'Solo' ].map( ( n ) => [ n, 0, '' ] ),
	music: [
		[ 'show:one', 'show', '', 'block 17350845', 'The First Night', 2, 'gh/1.yaml', '' ],
		[ 'show:two', 'show', '', 'block 17451407', 'The Second Night', 2, 'gh/2.yaml', '' ],
		[ 'show:three', 'show', '', 'block 22504683', 'A Later Night', 2, 'gh/3.yaml', '' ],
		[ 'discogs:9', 'record', 'Some Band', '2020', 'A Record', 1, 'https://www.discogs.com/release/9', '' ]
	],
	cast: [ [], [], [], [] ],
	ties: [
		[ 0, 1, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ], [ 2, 2, 1, [] ] ] ],
		[ 0, 2, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ], [ 1, 2, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ],
		[ 0, 3, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ], [ 1, 3, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ],
		[ 0, 4, [ [ 0, 2, 1, [] ] ] ], [ 1, 4, [ [ 0, 2, 1, [] ], [ 1, 2, 1, [] ] ] ],
		[ 0, 5, [ [ 2, 2, 1, [] ] ] ], [ 1, 5, [ [ 2, 2, 1, [] ], [ 3, 3, 1, [ 'A Song' ] ] ] ],
		[ 0, 6, [ [ 3, 3, 1, [ 'A Song' ] ] ] ], [ 1, 6, [ [ 3, 3, 1, [ 'Another' ] ] ] ]
	],
	songs: {}, plays: {}
} );

test( 'those who share one show with an end are one group: the most first, each piece said once, the far end saying another they all share', () => {
	const who = ( g ) => g.members.map( ( x ) => TRUNKS.people[ x.id ].name ).sort();
	const { groups, left } = K.trunks( TRUNKS, K.mutuals( TRUNKS, 0, 1 ) );
	assert.equal( groups.length, 2 );
	assert.deepEqual( who( groups[ 0 ] ), [ 'Jarda', 'Jirka', 'Petr' ] );
	assert.equal( groups[ 0 ].side, 'a' );
	assert.equal( groups[ 0 ].m, 0 );                               // the first night: all three were on it with Honza
	assert.deepEqual( groups[ 0 ].say, { m: 0, how: K.STAGE, songs: [] } );
	assert.equal( groups[ 0 ].far.m, 1 );                           // and with Jakub the second night as well: another piece, not the same one twice
	assert.equal( groups[ 0 ].same, true );
	// the other two are on one record with Jakub, on different songs of it: a group from his end, which says the record
	assert.deepEqual( who( groups[ 1 ] ), [ 'Sky', 'Solo' ] );
	assert.equal( groups[ 1 ].side, 'b' );
	assert.deepEqual( groups[ 1 ].say, { m: 3, how: K.STAGE, songs: [] } );
	assert.equal( groups[ 1 ].far, null );                          // with Honza they share nothing in common: a later night one, the record the other
	assert.equal( groups[ 1 ].same, false );
	assert.equal( left.length, 0 );
	// a group is no bigger than asked, its loudest; the ones cut are not gathered again under the same piece
	const two = K.trunks( TRUNKS, K.mutuals( TRUNKS, 0, 1 ), { most: 2 } );
	assert.equal( two.groups[ 0 ].members.length, 2 );
	assert.ok( two.groups.every( ( g, i ) => two.groups.every( ( o, j ) => i === j || ( g.m !== o.m && ( !o.far || g.m !== o.far.m ) ) ) ) );
	// a piece already said elsewhere is no trunk's
	assert.ok( K.trunks( TRUNKS, K.mutuals( TRUNKS, 0, 1 ), { not: [ 0 ] } ).groups.every( ( g ) => g.m !== 0 && ( !g.far || g.far.m !== 0 ) ) );
	// with nobody sharing a piece, no groups, and everyone left
	assert.equal( K.trunks( TRUNKS, K.mutuals( TRUNKS, 0, 1 ), { min: 9 } ).groups.length, 0 );
	assert.equal( K.trunks( TRUNKS, K.mutuals( TRUNKS, 0, 1 ), { min: 9 } ).left.length, 5 );
} );

test( 'a trunk says the one song all of its pickers share with the end, else the record', () => {
	const m = ( id, a, b ) => ( { id, ta: { ev: a }, tb: { ev: b } } );
	const one = K.trunks( TRUNKS, [ m( 2, [ { m: 3, how: 3, songs: [ 'A Song', 'B' ] } ], [ { m: 0, how: 2, songs: [] } ] ), m( 3, [ { m: 3, how: 3, songs: [ 'A Song' ] } ], [ { m: 1, how: 2, songs: [] } ] ) ] );
	assert.deepEqual( one.groups[ 0 ].say, { m: 3, how: K.TRACK, songs: [ 'A Song' ] } );
	assert.equal( one.groups[ 0 ].far, null );                      // nothing all of them share with the other end
	assert.equal( one.groups[ 0 ].same, false );
	const none = K.trunks( TRUNKS, [ m( 2, [ { m: 3, how: 3, songs: [ 'A Song' ] } ], [] ), m( 3, [ { m: 3, how: 1, songs: [] } ], [] ) ] );
	assert.deepEqual( none.groups[ 0 ].say, { m: 3, how: K.RECORD, songs: [] } );   // one of them only on the record: the record, and not as played
} );

test( 'a trunk in the rainbow: its pickers one over another, clear of each other; a branch keeps between the trunk and its picker', () => {
	const marks = [ { r: 16, w: 120 }, { r: 9, w: 90 }, { r: 9, w: 100 }, { r: 14, w: 110 } ];
	const lay = K.rainbow( { W: 1014, H: 668, la: 110, lb: 110, fill: 3, names: { a: { w: 110, side: 'left', r: 22 }, b: { w: 110, side: 'right', r: 22 } },
		strands: [ { half: 15, marks: [ { pill: true, w: 220 } ] }, { half: 15, marks: [ { pill: true, w: 220 } ] }, { half: 0, marks: [], group: { marks, wa: 157, wb: 157 } },
			{ half: 15, marks: [ { r: 9, w: 100 } ] }, { half: 15, marks: [ { r: 9, w: 100 } ] } ] } );
	const st = lay.strands[ 2 ], g = st.group;
	assert.equal( g.rows.length, 4 );
	assert.ok( g.rows.every( ( r ) => r.named && r.at === 'under' && Math.abs( r.x - g.rows[ 0 ].x ) < 0.01 ) );      // one column, each named under their circle
	g.rows.slice( 1 ).forEach( ( r, k ) => assert.ok( r.y - g.rows[ k ].y >= marks[ k ].r + 22 + marks[ k + 1 ].r, 'a name is clear of the circle under it' ) );
	assert.ok( g.tF < g.tM && g.tM < g.tJ && g.pa.t < g.tF && g.pb.t > g.tJ );
	// every picker of the trunk is within the room the trunk was given: no other strand's arc passes through them
	const others = lay.strands.filter( ( s, i ) => i !== 2 && s ).map( ( s ) => s.h );
	const lo = Math.min( ...g.rows.map( ( r ) => r.h ) ), hi = Math.max( ...g.rows.map( ( r ) => r.h ) );
	assert.ok( others.every( ( h ) => h < lo - 5 || h > hi + 5 ), 'no strand between the trunk\'s own arcs' );
	// a branch: from the trunk's arc at the fork to its picker, never outside the two arcs
	const leg = K.run( lay.A, lay.B, st.h, g.rows[ 0 ].h, g.tF, g.tM, 0, 0.4, 30 );
	assert.ok( Math.hypot( leg[ 30 ].x - g.rows[ 0 ].x, leg[ 30 ].y - g.rows[ 0 ].y ) < 0.01 );
	const fork = K.onArc( lay.A, lay.B, st.h, g.tF );
	assert.ok( Math.hypot( leg[ 0 ].x - fork.x, leg[ 0 ].y - fork.y ) < 0.01 );
	leg.forEach( ( p, i ) => {
		const t = g.tF + ( g.tM - g.tF ) * i / 30, y1 = K.onArc( lay.A, lay.B, st.h, t ).y, y2 = K.onArc( lay.A, lay.B, g.rows[ 0 ].h, t ).y;
		assert.ok( p.y >= Math.min( y1, y2 ) - 0.01 && p.y <= Math.max( y1, y2 ) + 0.01 );
	} );
	assert.ok( leg.slice( 13 ).every( ( p, i ) => Math.abs( p.y - K.onArc( lay.A, lay.B, g.rows[ 0 ].h, g.tF + ( g.tM - g.tF ) * ( i + 13 ) / 30 ).y ) < 0.01 ), 'level with its picker for the rest' );
	// too narrow a frame for a branch each way: no fork, and the strand is left out
	assert.equal( K.fork( 400, 600, 0, 0, 157, 157 ), null );
	assert.equal( K.rainbow( { W: 400, H: 600, strands: [ { half: 15, marks: [] }, { half: 0, marks: [], group: { marks, wa: 157, wb: 157 } } ] } ).strands[ 1 ], null );
	// nothing said at one end: a stub, and the pickers stand nearer that end
	const stub = K.fork( 1014, 668, 110, 110, 157, 0 );
	assert.equal( stub.pb, null );
	assert.ok( stub.tM > K.fork( 1014, 668, 110, 110, 157, 157 ).tM );
} );
