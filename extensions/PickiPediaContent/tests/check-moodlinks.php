<?php
/**
 * <moodlinks> and "Linked from magenta" (src/MoodLinks.php), without a wiki.
 *
 * Needs symfony/yaml, as the wiki has it. Run with its autoloader:
 *   php tests/check-moodlinks.php path/to/vendor/autoload.php
 */

require $argv[1] ?? dirname( __DIR__, 3 ) . '/vendor/autoload.php';
require dirname( __DIR__ ) . '/src/Todo.php';
require dirname( __DIR__ ) . '/src/MoodLinks.php';

use MediaWiki\Extension\PickiPediaContent\MoodLinks;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$ledger = <<<'YAML'
- page: Bill Monroe
  message: 0f132ada-1111-4222-8333-444455556666
  who: justin
  when: '2026-10-19T15:44:12Z'
  block: 23612345
  words: Is Bill Monroe on the page yet?
- page: Tony Rice
  message: 0f132ada-1111-4222-8333-444455556666
  who: justin
  when: '2026-10-19T15:44:12Z'
  words: Is Bill Monroe on the page yet?
- page: No message
  who: justin
- page: Bad id
  message: "<script>"
  who: justin
- page: "Words <b>bold</b>"
  message: 9a9a9a9a
  who: magent
  words: "<script>alert(1)</script>"
YAML;

echo "Which pages are ledgers:\n";
check( 'a Mood\'s month', MoodLinks::moodOf( 3000, 'Moods/magenta-interface/links/2026-10' ) === 'magenta-interface' );
check( 'spaces or underscores', MoodLinks::moodOf( 3000, 'Moods/magenta interface/links/2026-10' ) === 'magenta_interface' );
check( 'not its to-do list', MoodLinks::moodOf( 3000, 'Moods/magenta-interface/todo' ) === null );
check( 'not another namespace', MoodLinks::moodOf( 0, 'Moods/magenta-interface/links/2026-10' ) === null );
check( 'not a page under a month', MoodLinks::moodOf( 3000, 'Moods/x/links/2026-10/more' ) === null );

echo "\nRows:\n";
$rows = MoodLinks::rows( $ledger );
check( 'each with page, message and who; the rest left out', array_column( $rows, 'page' ) === [ 'Bill Monroe', 'Tony Rice', 'Words <b>bold</b>' ],
	json_encode( array_column( $rows, 'page' ) ) );
check( 'the block kept as given', $rows[0]['block'] === '23612345' );
check( 'unreadable YAML is null, not nothing', MoodLinks::rows( "- page: [unclosed" ) === null );
check( 'an empty ledger is no rows', MoodLinks::rows( "\n" ) === [] );
check( 'the body is what\'s in the tag', trim( MoodLinks::body( "Intro.\n\n<moodlinks>\n- page: A\n</moodlinks>\n" ) ) === '- page: A' );

echo "\nThe ledger page:\n";
$html = MoodLinks::render( $ledger, 'magenta-interface', static fn ( string $t ) => '/wiki/' . str_replace( ' ', '_', $t ) );
check( 'each page linked here', str_contains( $html, '<a href="/wiki/Bill_Monroe">Bill Monroe</a>' ) );
check( 'each message linked in magenta',
	str_contains( $html, 'href="https://magenta.cryptograss.live/moods/magenta-interface/#m-0f132ada-1111-4222-8333-444455556666"' ) );
check( 'who and when', str_contains( $html, '>justin, 19 Oct 2026, 15:44 UTC</a>' ) );
check( 'nothing in it becomes markup', !str_contains( $html, '<script>' ) && !str_contains( $html, '<b>' )
	&& str_contains( $html, '&lt;script&gt;' ) );
check( 'a month with none says so', str_contains( MoodLinks::render( '', 'x', static fn ( $t ) => null ), 'No links this month' ) );
check( 'unreadable YAML says so, over the text',
	str_contains( MoodLinks::render( '- page: [x', 'x', static fn ( $t ) => null ), 'can\'t be read' ) );

echo "\nA page's foot:\n";
$found = [
	[ 'mood' => 'general', 'page' => 'Bill Monroe', 'message' => 'aaaaaaaa', 'who' => 'skyler', 'when' => '2026-09-02T10:00:00Z', 'block' => '', 'words' => 'Older' ],
	[ 'mood' => 'magenta-interface', 'page' => 'Bill Monroe', 'message' => 'bbbbbbbb', 'who' => 'justin', 'when' => '2026-10-19T15:44:12Z', 'block' => '', 'words' => 'Newer' ],
];
$foot = MoodLinks::footer( $found, 'Linked from magenta' );
check( 'headed', str_contains( $foot, '<h2>Linked from magenta</h2>' ) );
check( 'newest first', strpos( $foot, 'Newer' ) < strpos( $foot, 'Older' ) );
check( 'naming each one\'s Mood', str_contains( $foot, '>justin in #magenta-interface, 19 Oct 2026, 15:44 UTC</a>' )
	&& str_contains( $foot, 'href="https://magenta.cryptograss.live/moods/general/#m-aaaaaaaa"' ) );
check( 'nothing at all with none', MoodLinks::footer( [], 'Linked from magenta' ) === '' );
$many = array_fill( 0, MoodLinks::SHOWN + 3, $found[0] );
$foot = MoodLinks::footer( $many, 'Linked from magenta' );
check( 'at most ' . MoodLinks::SHOWN . ', the rest counted', substr_count( $foot, '<li>' ) === MoodLinks::SHOWN
	&& str_contains( $foot, 'and 3 more' ) );

echo $failures ? "\n$failures FAILED\n" : "\nAll checks passed.\n";
exit( $failures ? 1 : 0 );
