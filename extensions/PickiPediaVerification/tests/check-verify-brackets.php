<?php
/**
 * Checks for SpecialVerifyBotEdits::bracketProblems() and stripMarkers().
 *
 * Usage:
 *   php extensions/PickiPediaVerification/tests/check-verify-brackets.php
 */

namespace MediaWiki\SpecialPage {
	class SpecialPage {
		public function __construct( string $name = '', string $restriction = '' ) {}
	}
}

namespace MediaWiki\Html {
	class Html {}
}

namespace MediaWiki {
	class MediaWikiServices {}
}

namespace {
	class WikiPage {}
	class Title {}
	class ContentHandler {}
}

namespace MediaWiki\Extension\PickiPediaVerification {

	require_once __DIR__ . '/../src/SpecialVerifyBotEdits.php';

	$failures = 0;

	function check( string $name, bool $ok, string $detail = '' ): void {
		global $failures;
		if ( $ok ) {
			echo "  ok   $name\n";
		} else {
			$failures++;
			echo "  FAIL $name" . ( $detail === '' ? '' : "\n       $detail" ) . "\n";
		}
	}

	function problemsAfterVerify( string $wikitext ): array {
		return SpecialVerifyBotEdits::bracketProblems( SpecialVerifyBotEdits::stripMarkers( $wikitext ) );
	}

	echo "\nBracket balance checks on Special:VerifyBotEdits:\n";

	$balanced = "<proposed by=\"Magent\">\n{{Sent to agents|dial=verbosity|value=brief|text=Keep it short.}}\n</proposed>";
	check( 'a balanced template inside <proposed> passes',
		problemsAfterVerify( $balanced ) === [],
		var_export( problemsAfterVerify( $balanced ), true ) );

	$dialsMissingClose = "<proposed by=\"Magent\">\n{{Sent to agents|dial=verbosity|value=brief|text=Keep it short.\n</proposed>\n{{Sent to agents|dial=verbosity|value=thorough|text=Longer.}}";
	$p1 = problemsAfterVerify( $dialsMissingClose );
	check( 'missing closing }} on a template (Dials rev 10676) is caught with its line',
		count( $p1 ) === 1 && str_contains( $p1[0], "unclosed '{{'" ),
		var_export( $p1, true ) );

	$endingBlankOk = "<proposed by=\"Magent\">\n{{Sent to agents|dial=line|value=others-asked|text=Others: {said}.{wait}}}\n</proposed>";
	check( 'a {blank} right before the closing }} ({wait}}}) passes',
		problemsAfterVerify( $endingBlankOk ) === [],
		var_export( problemsAfterVerify( $endingBlankOk ), true ) );

	$endingBlankShort = "<proposed by=\"Magent\">\n{{Sent to agents|dial=line|value=others-asked|text=Others: {said}.{wait}}\n</proposed>";
	$p2 = problemsAfterVerify( $endingBlankShort );
	check( 'a {blank} missing its closing } before }} ({wait}}, Dials rev 10779) is caught',
		count( $p2 ) === 1 && str_contains( $p2[0], "unclosed '{'" ),
		var_export( $p2, true ) );

	$unclosedLink = "{{Bot_proposes|See [[Cryptograss:Moods/Dials|the dials and [[another|by=Magent}}";
	$p3 = problemsAfterVerify( $unclosedLink );
	check( 'an unclosed [[ link is caught',
		count( $p3 ) === 1 && str_contains( $p3[0], "unclosed '[['" ),
		var_export( $p3, true ) );

	$nowikiIgnored = "<proposed by=\"Magent\">\nExample: <nowiki>{{unclosed</nowiki> and <!-- {{comment --> {{Show|venue=Station Inn}}\n</proposed>";
	check( 'braces inside <nowiki> and <!-- comments --> are ignored',
		problemsAfterVerify( $nowikiIgnored ) === [],
		var_export( problemsAfterVerify( $nowikiIgnored ), true ) );

	echo $failures === 0 ? "\nAll checks passed.\n\n" : "\n$failures FAILED\n\n";
	exit( $failures === 0 ? 0 : 1 );
}
