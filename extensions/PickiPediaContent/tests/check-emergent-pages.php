<?php
/**
 * Emergent: pages belong to one emergent each (src/EmergentPages.php).
 *
 * Run from the extension root:  php tests/check-emergent-pages.php
 */

require dirname( __DIR__ ) . '/src/EmergentPages.php';

use MediaWiki\Extension\PickiPediaContent\EmergentPages;

$failures = 0;
function check( string $name, bool $ok ): void {
	global $failures;
	if ( !$ok ) {
		$failures++;
	}
	echo ( $ok ? '  ok   ' : '  FAIL ' ) . $name . "\n";
}

check( 'the owner is the first part of the title', EmergentPages::owner( 'Magent/Notes/Deploys' ) === 'Magent'
	&& EmergentPages::owner( 'Magent' ) === 'Magent' && EmergentPages::owner( 'Re/Hunter' ) === 'Re' );
check( 'underscores read as spaces', EmergentPages::owner( 'Some_agent/x' ) === 'Some agent' );
check( 'an emergent changes its own page and those under it', EmergentPages::mayChange( 'Magent', 'Magent', false )
	&& EmergentPages::mayChange( 'Magent/Notes/Deploys', 'Magent', false ) );
check( "not another emergent's", !EmergentPages::mayChange( 'Magent/Notes', 'Re', false )
	&& !EmergentPages::mayChange( 'Re', 'Magent', false ) );
check( 'nor one whose name merely starts the same', !EmergentPages::mayChange( 'Magenta/x', 'Magent', false )
	&& !EmergentPages::mayChange( 'Magent/x', 'Magenta', false ) );
check( 'nor a page owned by nobody', !EmergentPages::mayChange( '/x', '', false ) && !EmergentPages::mayChange( '', '', false ) );
check( 'someone with emergent-edit-any changes any', EmergentPages::mayChange( 'Re/Hunter', 'JMyles', true ) );
check( 'names compare as MediaWiki writes them', EmergentPages::mayChange( 'Some agent/x', 'Some_agent', false ) );

echo $failures ? "\n$failures failed.\n" : "\nAll checks passed.\n";
exit( $failures ? 1 : 0 );
