<?php
/**
 * Checks for the server-rendered zine (src/Zine.php), runnable without a
 * wiki: php extensions/PickiPediaReleases/tests/check-zine.php
 */

require __DIR__ . '/../src/Zine.php';

use MediaWiki\Extension\PickiPediaReleases\Zine;

$failures = 0;
function check( bool $ok, string $what ): void {
	global $failures;
	echo ( $ok ? 'ok   ' : 'FAIL ' ) . $what . "\n";
	if ( !$ok ) {
		$failures++;
	}
}

$base = [
	'username' => 'JMyles',
	'subpage' => 'Why Car Lanes Divide Us',
	'variant' => 'letter',
	'dark' => false,
	'homeUrl' => '/wiki/Main_Page',
	'editUrl' => '/index.php?title=User:JMyles/Why_Car_Lanes_Divide_Us&action=edit',
	'historyUrl' => '/index.php?title=User:JMyles/Why_Car_Lanes_Divide_Us&action=history',
	'talkUrl' => '/wiki/User_talk:JMyles/Why_Car_Lanes_Divide_Us',
	'userUrl' => '/wiki/User:JMyles',
];

// Variant
check( Zine::variant( '', [] ) === 'letter', 'letter by default' );
check( Zine::variant( '<!-- pickipedia:variant=masthead -->', [] ) === 'masthead', 'marker picks masthead' );
check( Zine::variant( '', [ 'Masthead_style' ] ) === 'masthead', 'category picks masthead, underscores or not' );
check( Zine::variant( 'pickipedia:variant=masthead', [ 'Letter style' ] ) === 'letter', 'category beats marker' );

// Body classes
check( Zine::bodyClasses( 'letter', false ) === [ 'pickipedia-userpost', 'pickipedia-variant-letter' ], 'light body classes' );
check( in_array( 'pickipedia-dark', Zine::bodyClasses( 'letter', true ), true ), 'dark from the cookie' );

// Rendered elements
$html = Zine::render( $base );
foreach ( [ 'pp-corner-logo', 'pickipedia-topbar', 'pickipedia-hero', 'pickipedia-mode' ] as $class ) {
	check( (bool)preg_match( '/class="' . $class . ' pp-server"/', $html ), "$class is sent, marked pp-server" );
}
check( str_contains( $html, '<h1 class="pp-title">Why Car Lanes Divide Us</h1>' ), 'title is the subpage name' );
check( str_contains( $html, '>User:JMyles</a>' ), 'kicker names the user' );
check( str_contains( $html, 'User_talk:JMyles' ), 'talk goes to the user talk page' );
check( str_contains( $html, '☾ Dark' ), 'toggle offers dark when light' );
check( str_contains( Zine::render( [ 'dark' => true ] + $base ), '☼ Light' ), 'toggle offers light when dark' );
check( str_contains( Zine::render( [ 'variant' => 'masthead' ] + $base ), 'pp-titlewrap' ), 'masthead layout' );

// Escaping: titles can hold quotes and ampersands, usernames can hold anything
$evil = Zine::render( [ 'subpage' => 'Fruits & <Vegetables> "edition"', 'username' => 'A"B' ] + $base );
check( str_contains( $evil, 'Fruits &amp; &lt;Vegetables&gt; &quot;edition&quot;' ), 'title escaped' );
check( !str_contains( $evil, '<Vegetables>' ), 'no raw markup from the title' );
check( str_contains( $evil, 'User:A&quot;B' ), 'username escaped' );

echo $failures ? "$failures failed\n" : "all passed\n";
exit( $failures ? 1 : 0 );
