<?php
/**
 * <todo> renders a to-do list's YAML as a checklist (src/Todo.php).
 *
 * Needs symfony/yaml, as the wiki has it. Run with its autoloader:
 *   php tests/check-todo.php path/to/vendor/autoload.php
 */

require $argv[1] ?? dirname( __DIR__, 3 ) . '/vendor/autoload.php';
require dirname( __DIR__ ) . '/src/Todo.php';

use MediaWiki\Extension\PickiPediaContent\Todo;

$failures = 0;
function check( string $name, bool $ok, string $detail = '' ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . ( !$ok && $detail ? "\n       $detail" : '' ) . "\n";
}

$page = 'Cryptograss:Moods/magenta-interface/todo';
$hrefFor = static fn ( string $link ) => Todo::hrefFrom( $link, $page,
	static fn ( string $title ) => '/wiki/' . str_replace( ' ', '_', $title ) );

$list = <<<'YAML'
- task: Merge memory-lane#117 (this list, beside the Mood)
  who: justin
  kind: merge
  link: https://github.com/jMyles/memory-lane/pull/117
- task: Tick High-volume (bot) access
  who: [justin, skyler]
  kind: edit
  link: Special:BotPasswords
  note: So deploy-log edits are marked as a bot's.
- task: Answer Skyler <script>alert(1)</script>
  link: "#m-0f132ada"
- task: Look in on the jam
  link: "#jams-and-events"
- Bare task
- task: Redeploy maybelle
  kind: deploy
  done: true
- note: no task, so not an item
YAML;
$out = Todo::render( $list, $hrefFor );

check( 'a PR link is the task, linked', str_contains( $out,
	'<a href="https://github.com/jMyles/memory-lane/pull/117" class="external" rel="nofollow">Merge memory-lane#117' ), $out );
check( 'a page here is linked as one', str_contains( $out, '<a href="/wiki/Special:BotPasswords">Tick High-volume' ) );
check( "a message is linked in its Mood", str_contains( $out,
	'href="https://magenta.cryptograss.live/moods/magenta-interface/#m-0f132ada"' ) );
check( 'a Mood is linked in magenta', str_contains( $out, 'href="https://magenta.cryptograss.live/moods/jams-and-events/"' ) );
check( 'who and kind beneath', str_contains( $out, '<div class="pp-todo-meta">edit · justin, skyler</div>' ) );
check( 'a note beneath, escaped', str_contains( $out, "deploy-log edits are marked as a bot&#039;s." ) );
check( 'nothing written runs', !str_contains( $out, '<script>' ) && str_contains( $out, '&lt;script&gt;' ) );
check( 'a bare task is an item', str_contains( $out, 'Bare task' ) );
check( 'done ones folded away', preg_match( '#<details class="pp-todo-done"><summary>Done \(1\)</summary>.*Redeploy maybelle#s', $out ) === 1 );
check( 'five open, the one without a task left out', substr_count( $out, '☐' ) === 5 && !str_contains( $out, 'no task' ) );

$bad = Todo::render( "- task: one\n  who: [unclosed\n", $hrefFor );
check( 'unreadable YAML says so, and where', str_contains( $bad, 'class="error"' ) && str_contains( $bad, 'line' ), $bad );
check( 'not a list says so', str_contains( Todo::render( "task: one\n", $hrefFor ), 'should be a list' ) );
check( 'an empty list is nothing to do', str_contains( Todo::render( '', $hrefFor ), 'Nothing to do.' ) );
check( 'a message link elsewhere has no Mood to go to',
	Todo::hrefFrom( '#m-0f132ada', 'Cryptograss:Elsewhere', static fn ( $t ) => null ) === null );

// The live page's list, as it was written (fixture beside this test, when present).
$live = __DIR__ . '/todo-fixture.yaml';
if ( is_file( $live ) ) {
	$rendered = Todo::render( file_get_contents( $live ), $hrefFor );
	check( 'the live list renders, every PR a link', !str_contains( $rendered, 'pp-todo-problem' )
		&& substr_count( $rendered, 'class="external"' ) >= 13, substr( $rendered, 0, 400 ) );
}

// `code` renders as code, escaped; each item carries the name magenta links it by.
$coded = Todo::render( "- task: \"Make a secret (`openssl rand -hex 32`)\"\n  note: \"Then `<b>` stays text\"\n", $hrefFor );
check( 'backticks become code', str_contains( $coded, '<code>openssl rand -hex 32</code>' ), $coded );
check( 'code is still escaped', str_contains( $coded, '<code>&lt;b&gt;</code>' ), $coded );
check( 'each item has its anchor', str_contains( $coded, 'id="todo-make-a-secret-openssl-rand-hex-32"' ), $coded );

echo $failures === 0 ? "\nAll checks passed.\n" : "\n$failures FAILED\n";
exit( $failures === 0 ? 0 : 1 );
