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

test( 'beads sit further apart, and fewer to a row, where a finger has to tell them apart', () => {
	const rows = ( lay ) => {
		const by = new Map();
		lay.dots.forEach( ( d ) => by.set( d.y, ( by.get( d.y ) || [] ).concat( d.x ).sort( ( a, b ) => a - b ) ) );
		return [ ...by.values() ];
	};
	const gaps = ( xs ) => xs.slice( 1 ).map( ( x, i ) => x - xs[ i ] );
	const mouse = K.bridge( { W: 390, H: 540, direct: true, named: 6, dots: 30, la: 40, lb: 40 } );
	const finger = K.bridge( { W: 390, H: 540, direct: true, named: 6, dots: 30, la: 40, lb: 40, gap: 27, perRow: 5 } );
	assert.ok( rows( mouse ).some( ( r ) => r.length === 7 ) && rows( mouse ).every( ( r ) => gaps( r ).every( ( g ) => g === 18 ) ) );
	assert.ok( rows( finger ).every( ( r ) => r.length <= 5 && gaps( r ).every( ( g ) => g === 27 ) ) );
	assert.ok( finger.dots.length < mouse.dots.length );                        // fewer fit: the rest are in the list
	assert.deepEqual( finger.named, mouse.named );                              // the names don't move
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
	const [ show, record ] = tie( KYLE, JUSTIN ).ev;
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
	assert.deepEqual( K.called( G, G.pieces[ SILVER ] ), { glyph: 'track', name: 'Silver 44', sub: '4masks', long: '4masks' } );
	assert.deepEqual( [ K.called( G, G.pieces[ 1 ] ).name, K.called( G, G.pieces[ 1 ] ).sub ], [ 'Sam Grisman Project', '5 Jul 2025' ] );
	assert.deepEqual( [ K.called( G, G.pieces[ 5 ] ).name, K.called( G, G.pieces[ 5 ] ).sub ], [ 'Hello Decentralization', 'block 11,908,068' ] );
	assert.deepEqual( [ K.called( G, G.pieces[ 2 ] ).name, K.called( G, G.pieces[ 2 ] ).sub ], [ 'Safe, Sensible And Sane', 'Alison Brown · 2025' ] );
} );

test( 'where a piece leads: each named piece by a different set of its pickers, the freest first', () => {
	const L = K.leads( G, SILVER );
	assert.deepEqual( L.cast, [ KYLE, JUSTIN ] );                    // whoever is on the most comes first
	// Kyle alone leads to the newest tape; Justin's freest way on has Kyle on it too; then Justin alone, to a Full Release.
	assert.deepEqual( L.named.map( ( n ) => [ called( n.id ), n.via ] ),
		[ [ 'Sam Grisman Project', [ KYLE ] ], [ 'Hello Decentralization', [ JUSTIN, KYLE ] ], [ 'A Duet', [ JUSTIN ] ] ] );
	const sets = L.named.map( ( n ) => n.via.slice().sort().join() );
	assert.equal( new Set( sets ).size, sets.length );
	// The rest are counted behind them: the other track of the same record, an older tape, a record, a stream.
	assert.deepEqual( L.rest.map( ( r ) => called( r.id ) ), [ 'Victory', 'Sam Bush Band', 'Safe, Sensible And Sane', 'Unknown' ] );
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
	assert.ok( K.leads( G, SILVER ).rest.some( ( x ) => x.id === VICTORY ) );
	assert.deepEqual( K.leads( G, K.findPiece( G, 'arthel:show:0-1' ) ).cast, [ KYLE, JUSTIN ] );
} );

test( 'one night is one piece, however many tapers taped it; a show with a name is called by it', () => {
	const g = K.build( { people: [ [ 'A', 1, '' ], [ 'B', 1, '' ], [ 'C', 0, '' ] ], music: [
		[ 'lma:band2025-06-14.akg', 'show', 'The Band', '2025-06-14', 'The Band Live at The Hall on 2025-06-14', 2, 'https://archive.org/details/akg', '' ],
		[ 'lma:band2025-06-14.mv88', 'show', 'The Band', '2025-06-14', 'The Band Live at The Hall on 2025-06-14', 2, 'https://archive.org/details/mv88', '' ],
		[ 'arthel:show:0-9', 'show', 'chiva lounge', 'block 15735471', 'devcon VI night 1', 2, 'gh/show.yaml', '' ] ],
	cast: [ [ [ 0, 'guitar' ], [ 1, '' ] ], [ [ 1, 'banjo' ], [ 2, '' ] ], [ [ 0, '' ], [ 2, '' ] ] ],
	ties: [ [ 0, 1, [ [ 0, 2, 1, [] ] ] ], [ 1, 2, [ [ 1, 2, 1, [] ] ] ], [ 0, 2, [ [ 2, 2, 1, [] ] ] ] ] } );
	assert.deepEqual( g.whole, [ 0, 0, 2 ] );
	assert.deepEqual( [ g.pieces[ 0 ].cast, g.pieces[ 0 ].also, g.pieces[ 1 ].cast ], [ [ 0, 1, 2 ], [ 1 ], [] ] );
	assert.equal( K.pieceFor( g, g.adj[ 1 ].get( 2 ).ev[ 0 ] ), 0 );
	assert.equal( K.findPiece( g, 'lma:band2025-06-14.mv88' ), 0 );
	assert.deepEqual( K.leads( g, 0 ).named.map( ( n ) => n.id ), [ 2 ] );    // the other tape of the night isn't somewhere else
	const own = K.naming( g, g.adj[ 0 ].get( 2 ).ev[ 0 ] );
	assert.deepEqual( [ own.short, own.brief, own.long ], [ 'devcon VI night 1', 'devcon VI night 1', 'chiva lounge, block 15,735,471' ] );
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
