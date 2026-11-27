<?php
/**
 * A page's card where its address is shared (src/SocialCard.php), without a wiki.
 *
 *   php tests/check-socialcard.php
 *
 * The fixture is "Kuba's Last Merged Commits: the story of arthel159" as the
 * wiki parsed it on 11 Nov 2026 (action=parse), the page Justin shared.
 */

require dirname( __DIR__ ) . '/src/SocialCard.php';

use MediaWiki\Extension\PickiPediaContent\SocialCard;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$server = 'https://pickipedia.xyz';
$kuba = SocialCard::fromHtml( file_get_contents( __DIR__ . '/fixtures/kuba-last-merged-commits.html' ), $server );

echo "The page Justin shared\n";
check( 'its opening, from the dateline on',
	str_starts_with( $kuba['description'], '11 Nov 2026 Today, we merge the last open commits of Kuba Hejhal, the finest hacker-fiddler' ),
	$kuba['description'] );
check( 'no more than 300 characters, cut at a word', mb_strlen( $kuba['description'] ) <= 300
	&& str_ends_with( $kuba['description'], '…' ) && !str_contains( $kuba['description'], '  ' ),
	mb_strlen( $kuba['description'] ) . ': ' . $kuba['description'] );
check( 'Kuba with his fiddle, not the merge graph (1376x212)',
	$kuba['image'] === 'https://pickipedia.xyz/images/thumb/b/b5/Kuba_Hejhal_with_his_fiddle_on_a_boat.jpeg/400px-Kuba_Hejhal_with_his_fiddle_on_a_boat.jpeg',
	(string)$kuba['image'] );

echo "What a page is made of\n";
$page = '<div class="mw-parser-output">'
	. '<p><a class="external text" href="https://pickipedia.xyz/index.php?title=Template:Latest_News&amp;action=edit">edit</a></p>'
	. '<table class="infobox"><tr><td><p>In a box, not the opening.</p></td></tr></table>'
	. '<p>A <b>legendary</b> fiddler,<sup class="reference"><a href="#cite_note-1">[1]</a></sup> from <a href="/wiki/Roudnice">Roudnice</a>. &lt;script&gt;</p>'
	. '<ul><li>a list, not a paragraph</li></ul>'
	. '<div class="mw-heading mw-heading2"><h2>Music</h2></div>'
	. '<p>The next section.</p>'
	. '<figure><a href="/wiki/File:Wide.png" class="mw-file-description"><img src="/images/Wide.png" class="mw-file-element" data-file-width="1400" data-file-height="200"></a></figure>'
	. '<img src="/images/thumb/a/ab/Small.png/100px-Small.png" class="mw-file-element" data-file-width="100" data-file-height="100">'
	. '<img src="//upload.wikimedia.org/x/Commons.jpg" class="mw-file-element" data-file-width="800" data-file-height="600">'
	. '</div>';
$card = SocialCard::fromHtml( $page, $server );
check( 'its paragraphs only, up to its first heading; no edit link, footnote mark or box',
	$card['description'] === 'A legendary fiddler, from Roudnice. <script>', $card['description'] );
check( 'a banner, and a picture too small, passed over; a Commons picture made https',
	$card['image'] === 'https://upload.wikimedia.org/x/Commons.jpg', (string)$card['image'] );

$none = SocialCard::fromHtml( '<div class="mw-parser-output"><h2>Only a heading</h2><ul><li>and a list</li></ul></div>', $server );
check( 'nothing to say: no description, no picture', $none === [ 'description' => '', 'image' => null ], json_encode( $none ) );
check( 'an empty page', SocialCard::fromHtml( '', $server ) === [ 'description' => '', 'image' => null ] );
$long = SocialCard::fromHtml( '<div class="mw-parser-output"><p>' . str_repeat( 'bluegrass ', 60 ) . '</p></div>', $server );
check( 'one long paragraph, cut at a word', mb_strlen( $long['description'] ) <= 300
	&& str_ends_with( $long['description'], 'bluegrass…' ), $long['description'] );
$accented = SocialCard::fromHtml( '<div class="mw-parser-output"><p>Kuba Hejhal, Roudnice nad Labem, Česko — housle.</p></div>', $server );
check( 'its letters as written', $accented['description'] === 'Kuba Hejhal, Roudnice nad Labem, Česko — housle.', $accented['description'] );

echo "Nothing unverified, and a listen button isn't words (Justin, 12 Nov 2026)\n";
$listen = '<span class="pp-listen-stack plainlinks"><span class="pp-listen-rh"><a class="external text" href="https://pickipedia.xyz/rabbithole/?track=Qm">'
	. '<span>▶&#160;Hear Kuba on Reuben\'s Train</span></a><span class="pp-listen-chase"><span class="pp-rabbit">🐰</span><span class="pp-carrot">🥕</span></span></span>'
	. '<span class="pp-trail-rh"><a class="external text" href="https://pickipedia.xyz/rabbithole/?track=Qm&amp;action=trail"><span>🐇&#160;find a trail here</span></a></span></span>';
$checked = SocialCard::fromHtml( '<div class="mw-parser-output"><p>' . $listen . '<i>11 Nov 2026</i></p>'
	. '<p>Kuba played with <span class="pv-proposed pv-proposed--inline">Billy Strings <sup class="pv-proposed__badge">[bot]</sup></span>everyone.</p>'
	. '<div class="pv-proposed pv-proposed--block"><p>A whole proposed paragraph.</p>'
	. '<img src="/images/Proposed.jpg" class="mw-file-element" data-file-width="800" data-file-height="600"></div>'
	. '<p class="bot-proposal">A claim nobody checked.</p>'
	. '<p>He toured <span class="pv-proposed pv-proposed--inline pv-proposed--removal">with the band<sup class="pv-proposed__badge">[remove?]</sup></span> in 2024.</p>'
	. '<img src="/images/Real.jpg" class="mw-file-element" data-file-width="800" data-file-height="600"></div>', $server );
check( 'the words as verified, the button left out',
	$checked['description'] === '11 Nov 2026 Kuba played with everyone. He toured with the band in 2024.', $checked['description'] );
check( 'a picture in unverified words passed over', $checked['image'] === 'https://pickipedia.xyz/images/Real.jpg', (string)$checked['image'] );

$marked = SocialCard::fromHtml( '<div class="mw-parser-output"><p>Customer of the Year at Tacos y Mariscos.'
	. '<sup class="verified-marker" title="Verified: by JMyles">[✓]</sup> </p>'
	. '<p><span class="bot-proposal">A claim nobody checked.</span><sup style="font-size: 75%;">&#91;unverified&#93;</sup> </p>'
	. '<p>E = mc<sup>2</sup>, as ever.</p></div>', $server );
check( "a verification's own mark isn't one of the words",
	$marked['description'] === 'Customer of the Year at Tacos y Mariscos. E = mc2, as ever.', $marked['description'] );

echo $failures ? "\ncheck-socialcard.php: $failures FAILED\n" : "\ncheck-socialcard.php: all ok\n";
exit( $failures ? 1 : 0 );
