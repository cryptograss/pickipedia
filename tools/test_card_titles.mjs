/*
 * Tests for tools/card_titles.mjs: the names a shared bacon link's card says.
 *
 *     node --test tools/test_card_titles.mjs
 *
 * The graph here is shaped like graph.json (tools/connectome_graph.py): three pickers, a record, a show and
 * a night with two tapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitles } from './card_titles.mjs';

const NAMES = [ 'Kyle', 'Justin', 'Molly' ];
const [ KYLE, JUSTIN, MOLLY ] = NAMES.map( ( _, i ) => i );
const MUSIC = [
	[ 'arthel:4masks', 'record', 'Justin Myles Holmes', '3 April, 2024', '4masks', 2, 'gh/silver-44.yaml', '/wiki/4masks' ],
	[ 'wiki:Show:KyleTuttle-26482267', 'show', 'Kyle Tuttle', '2026-07-04', 'Kyle Tuttle at Dee\'s', 2, 'https://pickipedia.xyz/', '', '', [ 'Dee\'s Country Cocktail Lounge', '', 'Nashville, Tennessee' ] ],
	[ 'lma:sgp', 'show', 'Sam Grisman Project', '2025-07-05', 'SGP Live at Grassfire on 2025-07-05', 2, 'https://archive.org/details/sgp', '' ],
	[ 'discogs:9', 'record', 'Nobody', '2025', 'Nobody Plays On This', 1, 'https://www.discogs.com/release/9', '' ]
];
const GRAPH = {
	v: 1, built: '2026-11-27', month: '2026-11', featured: [ JUSTIN ],
	people: NAMES.map( ( n, i ) => [ n, i < 2 ? 1 : 0, '' ] ),
	music: MUSIC,
	cast: MUSIC.map( () => [] ),
	ties: [
		[ KYLE, JUSTIN, [ [ 0, 3, 0.5, [ 'Silver 44' ] ], [ 1, 2, 1, [] ] ] ],
		[ KYLE, MOLLY, [ [ 2, 2, 0.5, [] ] ] ]
	],
	songs: {}, plays: {}
};

const TITLES = cardTitles( GRAPH );

test( 'a show is named as the graph\'s own page names it: whose it was and where, under its name', () => {
	assert.deepEqual( TITLES[ 'wiki:Show:KyleTuttle-26482267' ],
		[ 'show', 'Dee\'s Country Cocktail Lounge · live · Kyle Tuttle · Nashville, Tennessee · 4 Jul 2026',
			'Dee\'s Country Cocktail Lounge' ] );
	assert.deepEqual( TITLES[ 'lma:sgp' ], [ 'show', 'Sam Grisman Project · live · 5 Jul 2025', 'Sam Grisman Project' ] );
} );

test( 'a record is its own name, with no line under it', () => {
	assert.deepEqual( TITLES[ 'arthel:4masks' ], [ 'record', '4masks', '4masks' ] );
} );

test( 'every key graph.json holds is named, whoever is on it', () => {
	assert.deepEqual( Object.keys( TITLES ).sort(), [ 'arthel:4masks', 'discogs:9', 'lma:sgp', 'wiki:Show:KyleTuttle-26482267' ] );
	for ( const [ kind, name, alone ] of Object.values( TITLES ) ) {
		assert.ok( [ 'show', 'record', 'track' ].includes( kind ), kind );
		assert.ok( name && name === name.trim(), name );
		assert.ok( alone && name.startsWith( alone ), alone );
	}
} );

test( 'what it writes is a map a web server can read: one JSON object, keys as graph.json has them', () => {
	const back = JSON.parse( JSON.stringify( TITLES ) );
	assert.deepEqual( back, TITLES );
	assert.equal( back[ 'arthel:4masks' ][ 1 ], '4masks' );
} );
