<?php
/**
 * A post's rules (src/Posts/Post.php), without a wiki: which titles are
 * posts, how a title reads as a headline, where a post stands in its series,
 * what the rail lists, what is lifted from its body, and what is kept of
 * what magenta says about its tiding.
 *
 *   php tests/check-posts.php
 */

require dirname( __DIR__ ) . '/src/Posts/Post.php';

use MediaWiki\Extension\PickiPediaContent\Posts\Post;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}
function same( string $name, $got, $want ): void {
	$say = static fn ( $v ) => json_encode( $v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	check( $name, $got === $want, 'got ' . $say( $got ) . "\n       not " . $say( $want ) );
}

echo "Which titles are posts\n";
same( "somebody's subpage is", Post::isPostTitle( 'JMyles/My Long Forgotten Dream' ), true );
same( 'and one of a series', Post::isPostTitle( 'JMyles/letters-to-emergents/13' ), true );
same( 'a user page is not', Post::isPostTitle( 'JMyles' ), false );
same( 'nor a title that only ends in a slash', Post::isPostTitle( 'JMyles/' ), false );
same( 'nor one that starts with one', Post::isPostTitle( '/My Long Forgotten Dream' ), false );
same( "an invitation's attestations are not", Post::isPostTitle( 'JMyles/Attestations/invite-record' ), false );
same( 'nor their index', Post::isPostTitle( 'JMyles/Attestations' ), false );
same( 'a post that only begins with the word is', Post::isPostTitle( 'JMyles/Attestations of a picker' ), true );
same( "a user's script is not", Post::isPostTitle( 'JMyles/common.js' ), false );
same( 'nor their stylesheet', Post::isPostTitle( 'JMyles/monobook.CSS' ), false );
same( 'nor their data', Post::isPostTitle( 'JMyles/things.json' ), false );

echo "\nA title, taken apart\n";
same( 'one of a series', Post::parts( 'JMyles/letters-to-emergents/13' ),
	[ 'user' => 'JMyles', 'path' => [ 'letters-to-emergents', '13' ], 'leaf' => '13', 'parent' => 'letters-to-emergents' ] );
same( 'a post on its own has nothing above it', Post::parts( 'JMyles/My Long Forgotten Dream' )['parent'], null );

echo "\nHow a title reads\n";
same( 'hyphens become words', Post::humanize( 'letters-to-emergents' ), 'Letters to emergents' );
same( 'so do underscores', Post::humanize( 'field_notes' ), 'Field notes' );
same( 'a title already in words is left alone', Post::humanize( "You can't spell 'copyright' without 'cop'" ),
	"You can't spell 'copyright' without 'cop'" );
same( 'so is a hyphen among words', Post::humanize( 'A well-kept secret' ), 'A well-kept secret' );
same( 'a numbered part takes its series for a headline',
	Post::headline( Post::parts( 'JMyles/letters-to-emergents/13' ), true ), 'Letters to emergents, № 13' );
same( 'a named part is its own headline',
	Post::headline( Post::parts( 'JMyles/letters-to-emergents/On memory' ), true ), 'On memory' );
same( 'a slash in a title that is no series stays in it', Post::headline( Post::parts( 'JMyles/AC/DC' ), false ), 'AC/DC' );
same( 'a post on its own is its own name', Post::headline( Post::parts( 'JMyles/My Long Forgotten Dream' ), true ),
	'My Long Forgotten Dream' );

echo "\nHow long it takes\n";
same( 'words are counted, styles and scripts are not',
	Post::wordCount( '<p>One two <b>three</b></p><style>.a { b: c }</style><script>var four = 5;</script><p>four</p>' ), 4 );
same( 'words either side of a tag are two', Post::wordCount( '<p>end</p><p>start</p>' ), 2 );
same( 'never less than a minute', Post::minutes( 0 ), 1 );
same( 'about 230 words a minute', [ Post::minutes( 230 ), Post::minutes( 460 ), Post::minutes( 1900 ) ], [ 1, 2, 8 ] );

echo "\nWhere it stands in its series\n";
$n = Post::neighbours( [ '10', '2', '1', '13', '2' ], '2' );
same( 'numbers in number order, each once', $n['order'], [ '1', '2', '10', '13' ] );
same( 'its place, and what is either side', [ $n['index'], $n['count'], $n['prev'], $n['next'] ], [ 2, 4, '1', '10' ] );
$n = Post::neighbours( [ '1', '2' ], '1' );
same( 'the first has nothing before it', [ $n['prev'], $n['next'] ], [ null, '2' ] );
same( 'one that is not among them has no place', Post::neighbours( [ '1', '2' ], '7' )['index'], 0 );

echo "\nWhat the rail lists\n";
$rows = [
	[ 'path' => 'My Long Forgotten Dream', 'created' => '20260129000000' ],
	[ 'path' => 'Through Russian Passport Control With A Song', 'created' => '20260401000000' ],
	[ 'path' => 'letters-to-emergents', 'created' => '20251001000000' ],
	[ 'path' => 'letters-to-emergents/1', 'created' => '20251002000000' ],
	[ 'path' => 'letters-to-emergents/2', 'created' => '20261025000000' ],
];
$shelf = Post::shelf( $rows, 'My Long Forgotten Dream', 20 );
same( 'the rest, newest first, a series as one line with its parts counted', $shelf['items'], [
	[ 'path' => 'letters-to-emergents', 'title' => 'Letters to emergents', 'created' => '20261025000000', 'count' => 2 ],
	[ 'path' => 'Through Russian Passport Control With A Song', 'title' => 'Through Russian Passport Control With A Song',
		'created' => '20260401000000', 'count' => 0 ],
] );
same( 'a part of a series is not shown its own series',
	array_column( Post::shelf( $rows, 'letters-to-emergents/1', 20 )['items'], 'path' ),
	[ 'Through Russian Passport Control With A Song', 'My Long Forgotten Dream' ] );
$orphans = [ [ 'path' => 'notes/b', 'created' => '2' ], [ 'path' => 'notes/a', 'created' => '1' ] ];
same( 'a series with no page of its own opens at its first part',
	Post::shelf( $orphans, 'Elsewhere', 20 )['items'][0]['path'], 'notes/a' );
$cut = Post::shelf( $rows, 'My Long Forgotten Dream', 1 );
same( 'cut to size, and says how many there are', [ count( $cut['items'] ), $cut['total'] ], [ 1, 2 ] );

echo "\nWhat a post hands its masthead\n";
same( 'the line under the headline, its markup kept',
	Post::sourced( '<p>Before.</p><p class="pp-dek-source">A <i>line</i> under it.</p>', 'pp-dek-source' ), 'A <i>line</i> under it.' );
same( 'the line over it, among other classes',
	Post::sourced( '<div class="note pp-kicker-source wide"> Field notes </div>', 'pp-kicker-source' ), 'Field notes' );
same( 'a longer class is another class', Post::sourced( '<p class="pp-dek-source-old">No.</p>', 'pp-dek-source' ), null );
same( 'an empty one is none', Post::sourced( '<p class="pp-dek-source"> </p>', 'pp-dek-source' ), null );
same( 'and most posts have none', Post::sourced( '<p>Just words.</p>', 'pp-dek-source' ), null );

echo "\nIts videos\n";
$wide = 'QmXet6QwZ7qdtDn89Kn4fzdm7LugpcmQoSzchdij4V3DLB';
$tall = 'QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a';
$unknown = 'QmT8uxcZVGNud3uiMz26h1EnxffhUJuNo8bRV6fgkSyTLP';
$player = static fn ( $cid ) => '<div class="hls-video-player" data-cid="' . $cid . '" data-start=""></div>';
$html = $player( $wide ) . '<p>Words.</p>' . $player( $tall ) . $player( $wide ) . $player( $unknown );
same( 'each once, in order', Post::videoCids( $html ), [ $wide, $tall, $unknown ] );
$shaped = Post::shapeVideos( $html, [ $wide => [ 1920, 1080 ], $tall => [ 720, 1280 ], 'QmNotHere' => [ 1, 1 ] ] );
check( 'a video whose release says its size keeps that shape before any script',
	substr_count( $shaped, '<div class="hls-video-player" style="--bs-ar:1920/1080" data-cid="' . $wide . '"' ) === 2, $shaped );
check( 'one taller than wide is marked upright',
	str_contains( $shaped, '<div class="hls-video-player is-upright" style="--bs-ar:720/1280" data-cid="' . $tall . '"' ), $shaped );
check( 'one nothing is known about is left alone', str_contains( $shaped, $player( $unknown ) ), $shaped );
same( 'nothing known, nothing changed', Post::shapeVideos( $html, [] ), $html );
same( 'a size of nothing is not a shape', Post::shapeVideos( $player( $wide ), [ $wide => [ 0, 1080 ] ] ), $player( $wide ) );
same( 'what the transcode made, before what was uploaded',
	Post::videoShape( [ 'transcode' => [ 'output_width' => 1280, 'output_height' => 720 ], 'width' => 3840, 'height' => 2160 ] ), [ 1280, 720 ] );
same( 'what was uploaded, where no transcode says', Post::videoShape( [ 'width' => '720', 'height' => '1280' ] ), [ 720, 1280 ] );
same( 'a release that says neither has no shape', [ Post::videoShape( [] ), Post::videoShape( [ 'width' => 0, 'height' => 9 ] ) ], [ null, null ] );

echo "\nWho wrote it\n";
same( "their page's first picture",
	Post::firstFile( "{{#set:\n|Display Name=justinholmes.eth\n}}\n[[File:Justin-in-berlin-with-overkilt.jpg|right|thumb|400px]]\n[[File:Other.png]]" ),
	'Justin-in-berlin-with-overkilt.jpg' );
same( 'not one commented out', Post::firstFile( '<!-- [[File:Old.jpg]] --> [[Image: New.png |thumb]]' ), 'New.png' );
same( 'a page with no picture', Post::firstFile( 'Hey. I am a picker.' ), '' );
same( 'their name on magenta', Post::magentaName( "{{Magenta person|justin|Justin}}\n\nHey." ), 'justin' );
same( 'however the template is written', Post::magentaName( '{{ Magenta_person | RJ }}' ), 'rj' );
same( 'or none', Post::magentaName( '{{Person|name=Justin}}' ), '' );

echo "\nThe track a song's page plays\n";
$songPage = '<p><a href="/rabbithole/?track=' . $tall . '">Silver 44</a></p>'
	. '<div class="pp-listen-stack"><span class="pp-listen pp-listen-rh"><a class="external" href="/rabbithole/?track=' . $wide . '&amp;from=song">Listen in Rabbithole</a></span></div>';
$links = Post::listenLinks( $songPage );
same( "its own listen button first, though the record's other tracks are linked above it", $links,
	[ '/rabbithole/?track=' . $wide . '&from=song', '/rabbithole/?track=' . $tall ] );
same( 'so the track is its own', Post::trackIn( $links ), $wide );
same( 'a track among other parameters', Post::trackIn( [ 'https://pickipedia.xyz/rabbithole/?record=' . $tall . '&track=' . $wide . '#t=10' ] ), $wide );
same( 'a name is not a track, nor is another page', Post::trackIn( [ '/rabbithole/?track=august', '/wiki/Song:August' ] ), '' );

echo "\nWhat is charted in Rabbithole\n";
$parts = [ '0' => [ 'part' => 'intro' ], '7.2' => [ 'part' => 'A' ] ];
same( 'a timeline of parts', Post::charted( [ 'timeline' => $parts, 'ensemble' => [] ] ), true );
same( 'the empty one a new metadata page has', Post::charted( [ 'timeline' => [], 'ensemble' => [] ] ), false );
same( 'one entry is no chart', Post::charted( [ 'timeline' => [ '0' => [ 'part' => 'intro' ] ] ] ), false );
same( "arthel's tree: the first version's first release",
	Post::charted( [ 'studio_versions' => [ 'v1' => [ 'a record' => [ 'rabbithole' => [ 'timeline' => $parts ] ] ] ] ] ), true );
same( 'the tree with nothing charted in it',
	Post::charted( [ 'studio_versions' => [ 'v1' => [ 'a record' => [ 'ensemble' => [ 'a picker' => 'guitar' ] ] ] ] ] ), false );
same( 'a page with an ensemble is read flat, as Rabbithole reads it, whatever tree it also has',
	Post::charted( [ 'ensemble' => [ 'a picker' => 'guitar' ],
		'studio_versions' => [ 'v1' => [ 'a record' => [ 'rabbithole' => [ 'timeline' => $parts ] ] ] ] ] ), false );
same( 'so is one whose timeline is there and empty',
	Post::charted( [ 'timeline' => [], 'studio_versions' => [ 'v1' => [ 'a record' => [ 'rabbithole' => [ 'timeline' => $parts ] ] ] ] ] ), false );
same( 'a timeline that is only a word is no chart', Post::charted( [ 'timeline' => 'soon' ] ), false );
same( 'nor is nothing, or what is no YAML map', [ Post::charted( null ), Post::charted( 'timeline' ), Post::charted( [] ) ], [ false, false, false ] );

echo "\nWhat magenta says of its tiding\n";
$magenta = 'https://magenta.cryptograss.live';
$tiding = $magenta . '/tidings/3f0c5a52-1111-4222-8333-444455556666/';
same( 'not a tiding', Post::tiding( [ 'tiding' => null ], $magenta ), null );
same( 'no answer at all', [ Post::tiding( null, $magenta ), Post::tiding( 'tiding', $magenta ) ], [ null, null ] );
same( "a tiding somewhere else is not magenta's", Post::tiding( [ 'tiding' => 'https://example.com/tidings/1/' ], $magenta . '/' ), null );
same( 'a tiding nothing more is said of (a magenta older than ?recent)', Post::tiding( [ 'tiding' => $tiding, 'id' => 'x', 'words' => 'w' ], $magenta ),
	[ 'url' => $tiding, 'title' => '', 'score' => 0, 'comments' => 0, 'said' => [] ] );
$found = Post::tiding( [
	'tiding' => $tiding, 'title' => 'My Long Forgotten Dream', 'score' => '7', 'comments' => 12,
	'recent' => [
		[ 'who' => ' an emergent ', 'text' => "Three shows.\n\nI can add the setlists.", 'href' => $tiding . '#c-1', 'at' => '2026-11-13T20:00:00Z',
			'block' => 26408100, 'kind' => 'emergent', 'colour' => '#1976d2' ],
		[ 'who' => 'a reader', 'text' => '<b>Yes</b> please.', 'href' => 'https://example.com/elsewhere', 'at' => 'yesterday',
			'block' => 'soon', 'kind' => 'person', 'colour' => 'red; background: url(x)' ],
		[ 'who' => 'nobody', 'text' => '   ' ],
		[ 'who' => 'no words' ],
		'not a row',
	],
], $magenta );
same( 'its address, title and counts', [ $found['url'], $found['title'], $found['score'], $found['comments'] ],
	[ $tiding, 'My Long Forgotten Dream', 7, 12 ] );
same( 'what was said, as paragraphs of words, by whom and when', $found['said'][0], [
	'who' => 'an emergent', 'paragraphs' => [ 'Three shows.', 'I can add the setlists.' ], 'href' => $tiding . '#c-1',
	'at' => '2026-11-13T20:00:00Z', 'block' => 26408100, 'emergent' => true, 'colour' => '#1976d2',
] );
same( 'an address elsewhere becomes the tiding, and what is not a time, a block or a colour is dropped', $found['said'][1], [
	'who' => 'a reader', 'paragraphs' => [ '<b>Yes</b> please.' ], 'href' => $tiding, 'at' => '', 'block' => 0, 'emergent' => false, 'colour' => '',
] );
same( 'rows with no words or no shape are left out', count( $found['said'] ), 2 );
$many = [];
for ( $i = 1; $i <= 11; $i++ ) {
	$many[] = [ 'who' => 'a reader', 'text' => "Said $i." ];
}
$found = Post::tiding( [ 'tiding' => $tiding, 'recent' => $many ], $magenta );
same( 'the last eight at most', [ count( $found['said'] ), $found['said'][7]['paragraphs'] ], [ 8, [ 'Said 11.' ] ] );

echo "\nWords as paragraphs\n";
same( 'a blank line parts them, a line break does not',
	Post::paragraphs( "One.\r\n\r\nTwo\nlines.\n\n\n\n  Three.  ", 420 ), [ 'One.', 'Two lines.', 'Three.' ] );
$long = Post::paragraphs( str_repeat( 'word ', 200 ), 50 );
check( 'cut at a word, with a mark that they were', count( $long ) === 1 && mb_strlen( $long[0] ) <= 51
	&& str_ends_with( $long[0], 'word…' ), json_encode( $long, JSON_UNESCAPED_UNICODE ) );
same( 'nothing said is no paragraphs', Post::paragraphs( " \n ", 420 ), [] );

echo "\nA link keeps its colour once visited\n";
/**
 * The rules in a stylesheet that colour a link by its class alone (".bs-author { color: … }").
 *
 * Core's "a:visited" (navy, meant for white paper) outranks a class alone, so such a link turns navy once the
 * reader has been where it leads: the wiki's name and the author's, near-black on the dark paper, at eaf8700.
 * No measurement in a browser shows it, since a script is never told a visited link's colour; so the rule
 * itself is looked for. Written "a.bs-author", it ties with core's, and the later of the two, ours, wins.
 *
 * @param string $css
 * @param string[] $classes the classes that are put on links
 * @return string[] the selectors at fault
 */
function bareLinkColours( string $css, array $classes ): array {
	$css = preg_replace( '#/\*.*?\*/#s', '', $css );
	preg_match_all( '/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER );
	$found = [];
	foreach ( $rules as [ , $selectors, $body ] ) {
		if ( !preg_match( '/(^|;)\s*color\s*:/', $body ) ) {
			continue;
		}
		// Each selector of the list: a comma inside :is( … ) is not between two of them.
		foreach ( preg_split( '/,(?![^()]*\))/', $selectors ) as $selector ) {
			$selector = trim( $selector );
			if ( preg_match( '/^\.([\w-]+)$/', $selector, $m ) && in_array( $m[1], $classes, true ) ) {
				$found[] = $selector;
			}
		}
	}
	return $found;
}
$skin = dirname( __DIR__ );
$onLinks = [];
preg_match_all( '/<a\b[^>]*?\bclass="([^"]+)"/', (string)file_get_contents( $skin . '/templates/broadside/skin.mustache' ), $inTemplate );
preg_match_all( "/\\bel\\( 'a', '([^']+)'/", (string)file_get_contents( $skin . '/resources/skins.broadside/broadside.js' ), $inScript );
foreach ( array_merge( $inTemplate[1], $inScript[1] ) as $list ) {
	foreach ( preg_split( '/\s+/', trim( $list ) ) as $class ) {
		if ( preg_match( '/^[\w-]+$/', $class ) ) {
			$onLinks[$class] = true;
		}
	}
}
$onLinks = array_keys( $onLinks );
check( 'the classes on links are found, in the template and in the script',
	!array_diff( [ 'bs-brand', 'bs-author', 'bs-tidingcard', 'bs-card-in' ], $onLinks ), json_encode( $onLinks ) );
same( 'a rule that colours a link by its class alone is seen',
	bareLinkColours( "/* x */ .bs-brand { font: 1rem serif; color: red }\n@media ( min-width: 1px ) { .bs-other, .bs-author { color: blue; } }",
		[ 'bs-brand', 'bs-author' ] ), [ '.bs-brand', '.bs-author' ] );
same( 'and one that names the element, or only sets something else, is not',
	bareLinkColours( "a.bs-brand { color: red } .bs-brand:hover { color: red } .bs-author { background-color: red; text-decoration-color: red }"
		. " .bs-top :is( .bs-brand, a ) { color: red }", [ 'bs-brand', 'bs-author' ] ), [] );
$atFault = [];
foreach ( glob( $skin . '/resources/skins.broadside/*.css' ) as $sheet ) {
	foreach ( bareLinkColours( (string)file_get_contents( $sheet ), $onLinks ) as $selector ) {
		$atFault[] = basename( $sheet ) . ': ' . $selector;
	}
}
same( "none of Broadside's stylesheets has one", $atFault, [] );

echo $failures ? "\ncheck-posts.php: $failures FAILED\n" : "\ncheck-posts.php: all ok\n";
exit( $failures ? 1 : 0 );
