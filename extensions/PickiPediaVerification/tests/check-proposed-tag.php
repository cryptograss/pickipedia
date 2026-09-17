<?php
/**
 * Checks for the <proposed> tag renderer.
 *
 * Runs the real ParserHooks.php against stubbed MediaWiki symbols, the same
 * way check-gate.php runs the real gate.
 *
 * The check that matters is data-pv-claim. The verify gadget rewrites a
 * marker by finding it in the page source, and the only thing that reliably
 * identifies which marker was clicked is the wikitext it wrapped. Inferring it
 * from the rendered text works for a sentence and cannot work for a template
 * call, whose output appears nowhere in the source — which is why every
 * template claim answered "could not find the claim in page source"
 * (pickipedia#122).
 *
 * Usage:
 *   docker run --rm -v "$PWD:/w" -w /w php:8.2-cli \
 *     php extensions/PickiPediaVerification/tests/check-proposed-tag.php
 */

namespace MediaWiki\Hook {
	interface ParserFirstCallInitHook {
	}
}

namespace {

	class FakeMessage {
		private string $key;

		public function __construct( string $key ) {
			$this->key = $key;
		}

		public function params( ...$args ): self {
			return $this;
		}

		public function text(): string {
			return $this->key;
		}
	}

	function wfMessage( string $key ): FakeMessage {
		return new FakeMessage( $key );
	}

	class FakeParserOutput {
		public array $modules = [];

		public function addModuleStyles( array $modules ): void {
			$this->modules = array_merge( $this->modules, $modules );
		}
	}

	class Parser {
		private FakeParserOutput $output;

		public function __construct() {
			$this->output = new FakeParserOutput();
		}

		/**
		 * Stands in for the real parser: enough to tell block from inline,
		 * without pulling MediaWiki in.
		 */
		public function recursiveTagParse( string $text, $frame ): string {
			$text = preg_replace( '/\n?\[\[Category:[^\]]+\]\]/', '', $text );
			if ( str_starts_with( trim( $text ), '{{' ) ) {
				// A template call renders as whatever it renders as. The point
				// of these checks is that this bears no resemblance to the
				// wikitext above it.
				return "<div class=\"infobox\">Rendered output nobody can find in the source</div>";
			}
			return trim( $text );
		}

		public function getOutput(): FakeParserOutput {
			return $this->output;
		}
	}

	class PPFrame {
	}
}

namespace MediaWiki\Extension\PickiPediaVerification {

	require_once __DIR__ . '/../src/ParserHooks.php';

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

	function render( string $input, array $args = [] ): string {
		return ParserHooks::render( $input, $args, new \Parser(), new \PPFrame() );
	}

	/** The value of one attribute of the outermost element. */
	function attribute( string $html, string $name ): ?string {
		if ( !preg_match( '/^<(?:div|span)\b[^>]*>/', $html, $open ) ) {
			return null;
		}
		if ( !preg_match( '/\b' . preg_quote( $name, '/' ) . '="([^"]*)"/', $open[0], $found ) ) {
			return null;
		}
		return html_entity_decode( $found[1], ENT_QUOTES );
	}

	echo "\nThe claim's own wikitext travels with it:\n";

	$call = '{{On the podcasts}}';
	check( 'a template call is carried verbatim',
		attribute( render( "\n$call\n", [ 'by' => 'Magent' ] ), 'data-pv-claim' ) === $call,
		var_export( attribute( render( "\n$call\n" ), 'data-pv-claim' ), true ) );

	$piped = '{{Firehose|show=Grass Talk Radio|limit=10}}';
	check( 'pipes and equals signs survive',
		attribute( render( $piped ), 'data-pv-claim' ) === $piped );

	$prose = "He plays a 1923 Loar.";
	check( 'prose is carried too',
		attribute( render( $prose ), 'data-pv-claim' ) === $prose );

	$multi = "{{Podcast\n|name=Grass Talk Radio\n|host=Bradley Laird\n}}";
	check( 'a multi-line call keeps its line breaks',
		attribute( render( $multi ), 'data-pv-claim' ) === $multi,
		var_export( attribute( render( $multi ), 'data-pv-claim' ), true ) );

	$quoted = '{{Podcast|description=The show they call "the picky one"}}';
	check( 'double quotes do not break out of the attribute',
		attribute( render( $quoted ), 'data-pv-claim' ) === $quoted );
	check( 'and are escaped in the markup',
		str_contains( render( $quoted ), '&quot;the picky one&quot;' ) );

	$xss = '<script>alert(1)</script>';
	check( 'a script tag in the claim is escaped in the attribute',
		!str_contains( attributeRegion( render( $xss ) ), '<script' ),
		attributeRegion( render( $xss ) ) );

	echo "\nRegressions in what the tag already did:\n";

	check( 'an empty tag renders nothing', render( "\n \n" ) === '' );
	check( 'a template call is wrapped in a div, not a span',
		str_starts_with( render( $call ), '<div' ) );
	check( 'prose is wrapped in a span',
		str_starts_with( render( $prose ), '<span' ) );
	check( 'the proposer is still recorded',
		attribute( render( $prose, [ 'by' => 'Magent' ] ), 'data-proposed-by' ) === 'Magent' );
	check( 'the tracking category is still added',
		str_contains( render( $prose ), 'pv-proposed' ) );
	check( 'the badge is still appended',
		str_contains( render( $prose ), 'pv-proposed__badge' ) );

	echo $failures === 0 ? "\nAll checks passed.\n\n" : "\n$failures FAILED\n\n";
	exit( $failures === 0 ? 0 : 1 );

	/** Just the opening tag, where an escaping mistake would show. */
	function attributeRegion( string $html ): string {
		preg_match( '/^<(?:div|span)\b[^>]*>/', $html, $open );
		return $open[0] ?? '';
	}
}
