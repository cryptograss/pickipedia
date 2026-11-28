/*
 * What a shared bacon link's card is called, for every piece of music the graph knows:
 *
 *     node tools/card_titles.mjs <graph.json> <card-titles.json>
 *
 * A link to one piece (/bacon?m=<its key>) is read by Telegram, Signal, Mastodon and the rest before any
 * script runs, so the web server writes that card's head (rabbithole: public/bacon.html, a Caddy template).
 * The server has only the address, and a key — wiki:Show:KyleTuttle-26482267 — is no title. This map is the
 * answer: every key, with what the graph's own page calls that piece once it runs
 * (assets/connectome/connectome.js, label()), so one piece of code decides what a show is called and the
 * card and the tab say the same words.
 *
 *     { "<music key>": [ "<show|record|track>", "<its name, as the page's tab says it>", "<its name alone>" ] }
 *
 * Built at deploy from graph.json, beside it (Jenkinsfile, the Connectome stage). The repo's own copy is
 * empty: a build that doesn't get this far leaves a map that parses and says nothing, and such a link gets
 * the Oracle's card, as it did before any of this.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as K from '../assets/connectome/connectome-core.js';

/**
 * @param {Object} g graph.json, as read.
 * @return {Object} Every music key the graph holds, in its order: [ kind, name, the name alone ].
 */
export function cardTitles( g ) {
	const G = K.build( g ), out = {};
	for ( const m of G.music ) {
		const id = K.findPiece( G, m.key, null );
		if ( id === null ) {
			continue;                                        // no piece of this key, which build() gives every one of them
		}
		const piece = G.pieces[ id ], c = K.called( G, piece );
		// As label() does for { m }: a show says whose it was and where, under its name, on one line. Its
		// own name comes too, for a line of words to be written round ("Who played at <name>").
		out[ m.key ] = [ piece.kind, c.name + ( c.glyph === 'show' && c.sub ? ' · ' + c.sub : '' ), c.name ];
	}
	return out;
}

if ( process.argv[ 1 ] && /(^|\/)card_titles\.mjs$/.test( process.argv[ 1 ] ) ) {
	const [ , , from, to ] = process.argv;
	if ( !from || !to ) {
		console.error( 'usage: node tools/card_titles.mjs <graph.json> <card-titles.json>' );
		process.exit( 2 );
	}
	const titles = cardTitles( JSON.parse( readFileSync( from, 'utf8' ) ) );
	writeFileSync( to, JSON.stringify( titles ) + '\n' );
	console.log( `Card titles: ${ Object.keys( titles ).length } pieces named, in ${ to }` );
}
