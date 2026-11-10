<?php
/**
 * Checks for how Special:VerifyBotEdits groups the queue: which group a page
 * goes in, and what a page's claims and their sources are.
 *
 * One list of three hundred pages mixed every kind of claim (Justin, 10 Nov).
 * The cases below are real pages from that queue.
 *
 * Usage:
 *   docker run --rm -v "$PWD:/w" -w /w php:8.2-cli \
 *     php extensions/PickiPediaVerification/tests/check-verify-groups.php
 */

namespace MediaWiki\SpecialPage {
	class SpecialPage {
		public function __construct( ...$args ) {
		}
	}
}

namespace {
	require_once __DIR__ . '/../src/SpecialVerifyBotEdits.php';

	use MediaWiki\Extension\PickiPediaVerification\SpecialVerifyBotEdits as V;

	$failures = 0;

	function check( string $name, bool $condition, string $detail = '' ): void {
		global $failures;
		if ( $condition ) {
			echo "  ok   $name\n";
		} else {
			$failures++;
			echo "  FAIL $name" . ( $detail !== '' ? "\n       $detail" : '' ) . "\n";
		}
	}

	function kind( string $ns, string $text, array $cats = [] ): string {
		return V::kindOf( $ns, $text, $cats );
	}

	echo "\nWhich group a page goes in:\n";

	check( 'a record', kind( '', '4masks', [ 'Records' ] ) === 'lineups' );
	check( 'a recording, by its title', kind( '', "Recording:Barlow's Jig (Justin Holmes and David Grier)" ) === 'lineups' );
	check( 'a musician', kind( '', 'Christina Docenko', [ 'Musicians' ] ) === 'people' );
	check( 'categories as the database keeps them, underscores and all',
		kind( '', 'Bluegrass Jam Along', [ 'Podcast_episodes' ] ) === 'podcasts' );
	check( 'a show, by its title', kind( '', 'Show:JustinHolmes-25254342' ) === 'shows' );
	check( 'a scene', kind( '', 'St. Pete', [ 'Florida', 'Scenes' ] ) === 'shows' );
	check( 'a song page', kind( 'Song', 'August' ) === 'songs' );
	check( 'a release', kind( 'Release', 'QmUWtV7fG1K9pM5TQSf5c38vmh9MtU6p3VNQuzaxvYr6ep' ) === 'releases' );
	check( 'a property is data model', kind( 'Property', 'Has release' ) === 'model' );
	check( 'so is a category page, whatever it is in', kind( 'Category', 'Records', [ 'Records' ] ) === 'model' );
	check( 'a Cryptograss page is project', kind( 'Cryptograss', 'Connectome/Verifying ensembles/Mockup' ) === 'project' );
	check( 'so is a Cryptograss/ note in main', kind( '', 'Cryptograss/Jellyfish' ) === 'project' );
	check( 'and a note named for its block', kind( '', '26329427 maybelle disk full incident' ) === 'project' );
	check( 'a namespace beats a category', kind( 'Song', 'Lost', [ 'Records' ] ) === 'songs' );
	check( 'a record beats a person (an album page in both)', kind( '', 'Fair Weather', [ 'Records', 'Musicians' ] ) === 'lineups' );
	check( 'and the rest is everything else', kind( '', 'Moon Factory' ) === 'other' );
	check( 'every group has a label', count( array_diff( [ 'lineups', 'people', 'shows', 'songs',
		'releases', 'podcasts', 'project', 'model', 'other' ], array_keys( V::KINDS ) ) ) === 0 );

	echo "\nWhat a page's claims are:\n";

	$page = implode( "\n", [
		'{{Record|artist=Milkweed}}',
		'<proposed by="Blu" source="https://milkweed.bandcamp.com/album/milkweed-ep">',
		'{{Record personnel|Joseph Alston|instrument=vocals}}',
		'</proposed>',
		"<proposed by='Blu' source='https://milkweed.bandcamp.com/album/milkweed-ep'>{{Record personnel|Pete Lister}}</proposed>",
		'<proposed by="Magent" note="supporting text">Milkweed is from Binghamton.</proposed>',
		'{{Bot_proposes|An older claim.|by=Magent|source=unspecified}}',
		'{{Bot proposes|Another.|by=Magent}}',
	] );
	$scan = V::claimsIn( $page );
	check( 'counts both markers, old and new', $scan['claims'] === 5, var_export( $scan, true ) );
	check( 'one source named, once', $scan['sources'] === [ 'https://milkweed.bandcamp.com/album/milkweed-ep' ],
		var_export( $scan['sources'], true ) );
	check( 'a note is not a source', !in_array( 'supporting text', $scan['sources'], true ) );
	check( '"unspecified" is not a source', V::claimsIn( '<proposed source="unspecified">x</proposed>' )['sources'] === [] );
	check( 'a page with nothing proposed', V::claimsIn( 'Plain.' ) === [ 'claims' => 0, 'sources' => [] ] );

	echo $failures === 0 ? "\nAll checks passed.\n\n" : "\n$failures FAILED\n\n";
	exit( $failures === 0 ? 0 : 1 );
}
