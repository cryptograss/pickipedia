<?php
/**
 * {{#connectome:}} (src/Connectome.php): which file is a page's card, and what is never put into a page.
 *
 * Run from the extension root:  php tests/check-connectome.php
 */

require dirname( __DIR__ ) . '/src/Connectome.php';

use MediaWiki\Extension\PickiPediaContent\Connectome;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$dir = sys_get_temp_dir() . '/check-connectome-' . getmypid();
mkdir( $dir );
$card = '<div class="connectome-card" data-picker="Kyle Tuttle"><svg class="cc"></svg></div>';
file_put_contents( "$dir/" . md5( 'Kyle Tuttle' ) . '.html', $card );
file_put_contents( "$dir/" . md5( 'Not A Card' ) . '.html', '<script>alert(1)</script>' );
file_put_contents( "$dir/" . md5( 'Bronwyn Keith-Hynés' ) . '.html', $card );

// The builder (tools/connectome_card.py card_file) names a card by the md5 of the page title's UTF-8.
check( 'a card is named by the md5 of its title',
	Connectome::fileFor( $dir, 'Kyle Tuttle' ) === "$dir/" . md5( 'Kyle Tuttle' ) . '.html' );
check( 'the md5 matches Python\'s for the same title', md5( 'Kyle Tuttle' ) === '1797298007fc4b98a450736b550a2af4' );
check( 'a page with a card gets it', Connectome::cardFor( $dir, 'Kyle Tuttle' ) === $card );
check( 'a title beyond ASCII finds its card', Connectome::cardFor( $dir, 'Bronwyn Keith-Hynés' ) === $card );
check( 'a page with no card gets nothing, not an empty box', Connectome::cardFor( $dir, 'Billy Strings' ) === '' );
check( 'no title, nothing', Connectome::cardFor( $dir, '' ) === '' );
check( 'a file that is not a card is never put into a page', Connectome::cardFor( $dir, 'Not A Card' ) === '' );
check( 'a missing folder is nothing', Connectome::cardFor( "$dir/nowhere", 'Kyle Tuttle' ) === '' );

// A cut naming itself: {{#connectome:|record=…|number=…|cid=…}} finds the cut's own card, named as the
// builder names it — the page's title and the block's own params (Connectome::cutFileFor).
$cutcard = '<div class="connectome-card" data-cut="QmCutOne"><svg class="cc"></svg></div>';
file_put_contents( "$dir/" . md5( "Song:Barlow's Jig|4masks|6|QmCutOne" ) . '.html', $cutcard );
check( 'a cut card is named by the md5 of the title and the block\'s params',
	Connectome::cutFileFor( $dir, "Song:Barlow's Jig", '4masks', '6', 'QmCutOne' )
		=== "$dir/" . md5( "Song:Barlow's Jig|4masks|6|QmCutOne" ) . '.html' );
check( 'the cut md5 matches Python\'s for the same block',
	md5( "Song:Barlow's Jig|4masks|6|QmCutOne" ) === '7e4c313277091f2874160e2b518d987a' );
check( 'a block that names its cut gets that cut\'s card',
	Connectome::cardFor( $dir, "Song:Barlow's Jig", '4masks', '6', 'QmCutOne' ) === $cutcard );
check( 'a block naming nothing gets the page\'s stack, not a cut card',
	Connectome::cardFor( $dir, 'Kyle Tuttle', '', '', '' ) === $card );
check( 'a cut whose card was never built gets nothing, not an empty box',
	Connectome::cardFor( $dir, "Song:Barlow's Jig", 'Vowel Sounds', '', '' ) === '' );

array_map( 'unlink', glob( "$dir/*" ) );
rmdir( $dir );

echo $failures ? "\n$failures failed\n" : "\nall passed\n";
exit( $failures ? 1 : 0 );
