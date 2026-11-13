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
	songs: { 'Silver 44': '/wiki/Song:Silver_44' }
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
	const [ show, record ] = tie( KYLE, JUSTIN ).ev;               // the record gives no date, so it comes after
	assert.deepEqual( K.naming( G, record ), { glyph: 'track', short: 'Silver 44 +1', brief: 'Silver 44', long: '4masks', songs: [ 'Silver 44', 'Victory' ] } );
	assert.equal( K.naming( G, show ).short, 'Hello Decentralization' );     // cryptograss's own show: its title
	const tape = K.naming( G, tie( KYLE, MOLLY ).ev[ 0 ] );
	assert.deepEqual( [ tape.glyph, tape.short, tape.brief ], [ 'show', 'Sam Grisman Project · 5 Jul 2025', 'Sam Grisman Project' ] );
	assert.equal( K.naming( G, tie( KYLE, CHOIR ).ev[ 0 ] ).glyph, 'record' );
	assert.equal( K.naming( G, tie( KYLE, CHOIR ).ev[ 0 ] ).long, 'Alison Brown – Safe, Sensible And Sane (2025)' );
	assert.equal( K.clip( 'Leftover Salmon', 9 ), 'Leftover…' );
	assert.equal( K.clip( 'Short', 9 ), 'Short' );
} );

/* ---- where things go ---- */

const inside = ( p, W, H, pad = 8 ) => p.x >= pad && p.x <= W - pad && p.y >= pad && p.y <= H - pad;

test( 'between two pickers: the ends at the sides, the names in the middle column, nearest the middle first', () => {
	for ( const [ W, H ] of [ [ 1020, 660 ], [ 760, 520 ], [ 390, 330 ] ] ) {
		const lay = K.bridge( { W, H, direct: true, named: 6, dots: 40 } );
		assert.ok( lay.A.x < lay.B.x && lay.A.y === lay.B.y );
		assert.ok( lay.named.length >= 2 && lay.named.length <= 6 );
		assert.ok( lay.named.every( ( p ) => p.x === Math.round( W / 2 ) && inside( p, W, H, 30 ) ), `${ W }x${ H }` );
		assert.ok( lay.named.every( ( p ) => p.y !== lay.A.y ), 'the middle line is the direct tie\'s' );
		const off = lay.named.map( ( p ) => Math.abs( p.y - lay.A.y ) );
		assert.deepEqual( off, off.slice().sort( ( x, y ) => x - y ) );
		assert.ok( lay.named.every( ( p ) => p.below === ( p.y > lay.A.y ) ) );
		assert.ok( lay.dots.every( ( p ) => inside( p, W, H ) ) );
		const up = lay.dots.filter( ( p ) => p.y < lay.A.y ).length;
		assert.ok( Math.abs( up - ( lay.dots.length - up ) ) <= 1, 'as many above the line as below' );
		const taken = new Set( lay.dots.map( ( p ) => p.x + ',' + p.y ) );
		assert.equal( taken.size, lay.dots.length, 'no two beads in one place' );
	}
} );

test( 'between two pickers with no tie of their own, the closest route takes the middle line', () => {
	const lay = K.bridge( { W: 1020, H: 660, direct: false, named: 5, dots: 3 } );
	assert.equal( lay.named[ 0 ].y, lay.A.y );
	assert.equal( lay.named.length, 5 );
	assert.equal( lay.dots.length, 3 );
	assert.equal( K.bridge( { W: 1020, H: 660, direct: true, named: 0, dots: 0 } ).named.length, 0 );
} );

test( "the ends move in to leave room for their names", () => {
	const plain = K.bridge( { W: 1020, H: 660, direct: true, named: 2, dots: 0 } );
	const roomy = K.bridge( { W: 1020, H: 660, direct: true, named: 2, dots: 0, la: 200, lb: 60 } );
	assert.ok( roomy.A.x >= 212 && roomy.A.x > plain.A.x );
	assert.equal( roomy.B.x, plain.B.x );
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
