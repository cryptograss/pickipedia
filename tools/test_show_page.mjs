/*
 * Tests for the Show: page poster, with no browser under it:
 * extensions/PickiPediaContent/resources/ext.pickipediaContent.showPage.js.
 *
 *     node --test tools/test_show_page.mjs
 *
 * That file is a plain script, as ResourceLoader wants; everything in it that
 * decides what the hero says takes values and returns a string, and those are
 * handed out through module.exports when there is no browser. So the file the
 * wiki serves is the file tested here -- not a copy of it.
 *
 * Until this existed the same code sat on MediaWiki:Gadget-pickipedia-show.js,
 * where nothing could run it (Justin, #connectome, 26 Nov 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire( import.meta.url );
const S = require( '../extensions/PickiPediaContent/resources/ext.pickipediaContent.showPage.js' );

test( 'a show links to its own bacon graph, by its own title', () => {
	assert.equal(
		S.baconHref( 'Show:KyleTuttle-26482267' ),
		'/bacon?m=wiki%3AShow%3AKyleTuttle-26482267'
	);
} );

test( 'wgPageName underscores are spaces again in the address', () => {
	// Show:_BronwynAndJason-24401908 is really titled "Show: BronwynAndJason-…".
	assert.equal(
		S.baconHref( 'Show:_BronwynAndJason-24401908' ),
		'/bacon?m=wiki%3AShow%3A%20BronwynAndJason-24401908'
	);
} );

test( 'a block height is grouped for reading', () => {
	assert.equal( S.formatBlock( '26482267' ), '26,482,267' );
	assert.equal( S.formatBlock( 24140272 ), '24,140,272' );
	assert.equal( S.formatBlock( '26,453,563' ), '26,453,563' );
	assert.equal( S.formatBlock( '' ), '' );
	assert.equal( S.formatBlock( 'soon' ), 'soon' );
} );

test( 'the block kicker keeps the link out to etherscan', () => {
	const html = S.blockKicker( '26482267', 'https://etherscan.io/block/26482267' );
	assert.match( html, /^<a href="https:\/\/etherscan\.io\/block\/26482267"/ );
	assert.match( html, /Block 26,482,267<\/a>$/ );
	assert.equal( S.blockKicker( '26482267', '' ), 'Block 26,482,267' );
	assert.equal( S.blockKicker( '', '' ), '' );
} );

test( 'the poster is asked for at poster size', () => {
	assert.equal(
		S.bigPosterSrc( '/images/thumb/a/ab/Show_poster.png/220px-Show_poster.png' ),
		'/images/thumb/a/ab/Show_poster.png/800px-Show_poster.png'
	);
	// Nothing the wiki thumbnailed: left alone.
	assert.equal( S.bigPosterSrc( '/images/a/ab/Poster.svg' ), '/images/a/ab/Poster.svg' );
} );

test( 'the infobox says whether a person has checked the show', () => {
	assert.equal( S.statusOf( [ 'show-infobox', 'show-verified' ] ), 'verified' );
	assert.equal( S.statusOf( [ 'show-infobox', 'bot-proposal' ] ), 'proposed' );
	assert.equal( S.statusOf( [ 'show-infobox', 'show-unverified' ] ), 'unverified' );
	assert.equal( S.statusOf( [ 'show-infobox' ] ), '' );
	assert.equal( S.statusOf( null ), '' );
} );

const DEES = {
	title: '<a href="/wiki/Kyle_Tuttle">Kyle Tuttle</a>',
	fallbackTitle: 'KyleTuttle-26482267',
	venue: '<a href="/wiki/Dee\'s_Country_Cocktail_Lounge">Dee\'s Country Cocktail Lounge</a>',
	date: 'Monday, November 23, 2026',
	blockText: '26482267',
	blockHref: 'https://etherscan.io/block/26482267',
	doors: '',
	show: '',
	price: '',
	ages: '',
	status: 'unverified',
	ticketsHref: '',
	baconHref: '/bacon?m=wiki%3AShow%3AKyleTuttle-26482267',
	image: null
};

test( 'the hero carries the bacon pill, whatever else the show has', () => {
	const html = S.heroHtml( DEES );
	assert.match( html, /<div class="pp-actions">/ );
	assert.match( html, /href="\/bacon\?m=wiki%3AShow%3AKyleTuttle-26482267"/ );
	assert.match( html, /🥓 Bacon graph/ );
} );

test( 'tickets come before the bacon graph when a show has them', () => {
	const html = S.heroHtml( Object.assign( {}, DEES, {
		ticketsHref: 'https://example.org/tickets'
	} ) );
	assert.ok( html.indexOf( 'Tickets</a>' ) < html.indexOf( 'Bacon graph' ) );
} );

test( 'the hero says the show, the venue, the date and the block', () => {
	const html = S.heroHtml( DEES );
	assert.match( html, /<h1 class="pp-title"><a href="\/wiki\/Kyle_Tuttle">Kyle Tuttle<\/a><\/h1>/ );
	assert.match( html, /<p class="pp-venue">at <a href="[^"]*Dee/ );
	assert.match( html, /<div class="pp-date-kicker">Monday, November 23, 2026<\/div>/ );
	assert.match( html, /Block 26,482,267/ );
	assert.match( html, /<div class="pp-status is-unverified">unverified<\/div>/ );
} );

test( 'a show with no artists is titled by its own page name', () => {
	const html = S.heroHtml( Object.assign( {}, DEES, { title: '' } ) );
	assert.match( html, /<h1 class="pp-title">KyleTuttle-26482267<\/h1>/ );
} );

test( 'a poster is shown big, linked to its file page, credited where credited', () => {
	const html = S.heroHtml( Object.assign( {}, DEES, {
		image: {
			src: '/images/thumb/a/ab/Show_poster_0-20277935.jpeg/220px-Show_poster_0-20277935.jpeg',
			href: '/wiki/File:Show_poster_0-20277935.jpeg',
			alt: 'Show poster',
			artist: 'Sky'
		}
	} ) );
	assert.match( html, /800px-Show_poster_0-20277935\.jpeg/ );
	assert.match( html, /<a class="pp-image-link" href="\/wiki\/File:Show_poster_0-20277935\.jpeg"/ );
	assert.match( html, /Poster art by<\/span> Sky/ );
} );

test( 'text out of the page is escaped, markup out of the page is not', () => {
	const html = S.heroHtml( Object.assign( {}, DEES, {
		date: 'Monday & "the night" <b>after</b>',
		title: '<a href="/wiki/X">X</a>'
	} ) );
	assert.match( html, /Monday &amp; &quot;the night&quot; &lt;b&gt;after&lt;\/b&gt;/ );
	assert.match( html, /<h1 class="pp-title"><a href="\/wiki\/X">X<\/a><\/h1>/ );
} );

test( 'a show with nothing but a name still gives a hero', () => {
	const html = S.heroHtml( {
		title: '', fallbackTitle: 'Nameless-1', venue: '', date: '',
		blockText: '', blockHref: '', doors: '', show: '', price: '', ages: '',
		status: '', ticketsHref: '', baconHref: '/bacon?m=wiki%3AShow%3ANameless-1', image: null
	} );
	assert.match( html, /<h1 class="pp-title">Nameless-1<\/h1>/ );
	assert.match( html, /Bacon graph/ );
	assert.doesNotMatch( html, /pp-kicker|pp-meta|pp-image|pp-status/ );
} );
