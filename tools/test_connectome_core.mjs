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
	for ( const [ W, H, n ] of [ [ 694, 597, 6 ], [ 390, 550, 6 ], [ 950, 500, 6 ], [ 840, 648, 8 ] ] ) {
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
