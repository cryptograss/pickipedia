/*
 * The big graph's layers: what comes out over what (assets/connectome/connectome.css).
 *
 *     node --test tools/test_connectome_layers.mjs
 *
 * Justin, #interfaces, 28 Nov 2026: "getting a thud trying to click the faq on /bacon/". The FAQ did open --
 * #faq went visible and fetched its answers -- underneath the Oracle's front page, which covers the same
 * ground from a higher layer, so the reader saw nothing happen. The layers are a handful of numbers in one
 * stylesheet, and nothing was watching the order between them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Without its comments: a comment sits in front of a rule, and would be read as part of its selector.
const CSS = readFileSync( new URL( '../assets/connectome/connectome.css', import.meta.url ), 'utf8' )
	.replace( /\/\*[\s\S]*?\*\//g, '' );

/**
 * The z-index a stylesheet gives one selector, as it last sets it (a rule inside @media counts, which is
 * what a reader on a phone gets). Null when that selector sets none.
 */
function layer( sel ) {
	let found = null;
	for ( const [ , selector, body ] of CSS.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ) {
		if ( ! selector.split( ',' ).map( ( s ) => s.trim() ).includes( sel ) ) {
			continue;
		}
		const z = /(?:^|;)\s*z-index:\s*(-?\d+)/.exec( body );
		if ( z ) {
			found = Number( z[ 1 ] );
		}
	}
	return found;
}

test( 'the FAQ comes out over the Oracle\'s front page, not under it', () => {
	const faq = layer( '#faq' ), oracle = layer( '#oracle' );
	assert.notEqual( faq, null, '#faq sets a layer' );
	assert.notEqual( oracle, null, '#oracle sets a layer' );
	assert.ok( faq > oracle, `#faq (${ faq }) must sit over #oracle (${ oracle })` );
} );

test( 'the copied-link note stays over the FAQ', () => {
	assert.ok( layer( '#shared' ) > layer( '#faq' ), 'the link just copied is readable over anything' );
} );

test( 'the layers it reads are the ones the page sets', () => {
	assert.equal( layer( '#oracle' ), 12 );
	assert.equal( layer( '#shared' ), 30 );
	assert.equal( layer( '#nothing-of-the-sort' ), null );
} );
