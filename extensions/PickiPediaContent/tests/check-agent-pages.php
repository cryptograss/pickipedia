<?php
/**
 * Agent: pages belong to one agent each (src/AgentPages.php).
 *
 * Run from the extension root:  php tests/check-agent-pages.php
 */

require dirname( __DIR__ ) . '/src/AgentPages.php';

use MediaWiki\Extension\PickiPediaContent\AgentPages;

$failures = 0;
function check( string $name, bool $ok ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . "\n";
}

check( 'the owner is the first part of the title', AgentPages::owner( 'Magent/Notes/Deploys' ) === 'Magent'
	&& AgentPages::owner( 'Magent' ) === 'Magent' && AgentPages::owner( 'Re/Hunter' ) === 'Re' );
check( 'underscores read as spaces', AgentPages::owner( 'Some_agent/x' ) === 'Some agent' );
check( 'an agent changes its own page and those under it', AgentPages::mayChange( 'Magent', 'Magent', false )
	&& AgentPages::mayChange( 'Magent/Notes/Deploys', 'Magent', false ) );
check( "not another agent's", !AgentPages::mayChange( 'Magent/Notes', 'Re', false )
	&& !AgentPages::mayChange( 'Re', 'Magent', false ) );
check( 'nor one whose name merely starts the same', !AgentPages::mayChange( 'Magenta/x', 'Magent', false )
	&& !AgentPages::mayChange( 'Magent/x', 'Magenta', false ) );
check( 'nor a page owned by nobody', !AgentPages::mayChange( '/x', '', false ) && !AgentPages::mayChange( '', '', false ) );
check( 'someone with agent-edit-any changes any', AgentPages::mayChange( 'Re/Hunter', 'JMyles', true ) );
check( 'names compare as MediaWiki writes them', AgentPages::mayChange( 'Some agent/x', 'Some_agent', false ) );

echo $failures ? "\n$failures failed.\n" : "\nAll checks passed.\n";
exit( $failures ? 1 : 0 );
