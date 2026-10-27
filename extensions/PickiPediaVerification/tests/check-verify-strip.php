<?php
/**
 * Checks for what verifying does to the markers: a <proposed> tag is unwrapped
 * and its claim stays; a <proposed action="remove"> goes, text and all, the
 * line it stood on included.
 *
 * Runs the real SpecialVerifyBotEdits.php against stubbed MediaWiki symbols,
 * the same way check-gate.php runs the real gate.
 *
 * Usage:
 *   docker run --rm -v "$PWD:/w" -w /w php:8.2-cli \
 *     php extensions/PickiPediaVerification/tests/check-verify-strip.php
 */

namespace MediaWiki\SpecialPage {
	class SpecialPage {
		public function __construct( ...$args ) {
		}
	}
}

namespace {
	require_once __DIR__ . '/../src/SpecialVerifyBotEdits.php';

	$special = ( new ReflectionClass( \MediaWiki\Extension\PickiPediaVerification\SpecialVerifyBotEdits::class ) )
		->newInstanceWithoutConstructor();
	$stripTags = new ReflectionMethod( $special, 'stripProposedTags' );
	$stripTags->setAccessible( true );

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

	function strip( string $text ): string {
		global $special, $stripTags;
		return $stripTags->invoke( $special, $text );
	}

	echo "\nA claim, verified, stays:\n";

	check( 'a block-form proposal is unwrapped without leaving a blank line',
		strip( "One.\n<proposed by=\"Re\">\nTwo.\n</proposed>\nThree." ) === "One.\nTwo.\nThree.",
		var_export( strip( "One.\n<proposed by=\"Re\">\nTwo.\n</proposed>\nThree." ), true ) );
	check( 'an inline proposal is unwrapped in place',
		strip( '* <proposed by="Re">Two.</proposed> and on.' ) === '* Two. and on.' );

	echo "\nA removal, verified, goes:\n";

	check( 'a block-form removal goes with its line',
		strip( "One.\n<proposed by=\"Re\" action=\"remove\">\nTwo.\n</proposed>\nThree." ) === "One.\nThree.",
		var_export( strip( "One.\n<proposed by=\"Re\" action=\"remove\">\nTwo.\n</proposed>\nThree." ), true ) );
	check( 'an inline removal takes its text and nothing around it',
		strip( "* <proposed by=\"Re\" action='remove'>Two.</proposed>\n* Three." ) === "* \n* Three.",
		var_export( strip( "* <proposed by=\"Re\" action='remove'>Two.</proposed>\n* Three." ), true ) );
	check( 'a claim and a removal on one page are each dealt with',
		strip( "<proposed by=\"Re\">\nNew.\n</proposed>\n<proposed by=\"Re\" action=\"remove\">\nOld.\n</proposed>\nKept." ) === "New.\nKept.",
		var_export( strip( "<proposed by=\"Re\">\nNew.\n</proposed>\n<proposed by=\"Re\" action=\"remove\">\nOld.\n</proposed>\nKept." ), true ) );
	check( 'an attribute merely containing the word is not a removal',
		strip( '<proposed by="Re" source="removed-from-setlist.com">Two.</proposed>' ) === 'Two.' );

	echo $failures === 0 ? "\nAll checks passed.\n\n" : "\n$failures FAILED\n\n";
	exit( $failures === 0 ? 0 : 1 );
}
