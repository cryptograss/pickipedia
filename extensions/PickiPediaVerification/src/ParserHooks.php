<?php

namespace MediaWiki\Extension\PickiPediaVerification;

use MediaWiki\Hook\ParserFirstCallInitHook;
use Parser;
use PPFrame;

/**
 * The <proposed> tag.
 *
 * Marks a single bot-proposed claim, whatever shape that claim takes.
 *
 *     <proposed by="Magent" source="stationinn.com">
 *     {{Show|artists=Billy Strings|venue=The Station Inn|blockheight=24140272}}
 *     </proposed>
 *
 * Why a tag rather than a template. {{Bot_proposes}} is a template call, so a
 * pipe anywhere in the content splits the parameter and has to be escaped to
 * {{!}} going in and unescaped coming out. Missing that unescape is what left
 * [[File:Ahbck4.jpg{{!}}right{{!}}thumb{{!}}...]] on ~25 pages, and escaping
 * into the middle of a template call is what produced
 * [[File:Instrument-icon-banjo[unverified].png]] in cryptograss/pickipedia#43.
 *
 * The preprocessor pulls extension-tag content out before it parses templates
 * and parameters — the same reason <nowiki> and <pre> can hold braces and
 * pipes freely — so none of that applies here. There is nothing to escape,
 * which means there is nothing to forget to unescape.
 *
 * It also means a claim can be marked without the template it lives in knowing
 * anything about verification. {{Show}} implements |status=proposed and renders
 * it better than a generic wrapper can, so prefer that where it exists; this is
 * for everything else, including markup that cannot carry a parameter at all.
 */
class ParserHooks implements ParserFirstCallInitHook {

	/** Review queue that {{Bot_proposes}} also feeds. */
	private const TRACKING_CATEGORY = 'Pages with unverified bot claims';

	/**
	 * Elements that must not be wrapped in a <span>.
	 *
	 * A proposed claim is usually a template that renders a block — an
	 * infobox, a list — but it can equally be a clause inside a sentence.
	 * Wrapping a <div> in a <span> produces invalid nesting that browsers
	 * silently restructure, which moves the marker off the thing it marks.
	 */
	private const BLOCK_ELEMENTS = 'div|table|ul|ol|dl|h[1-6]|blockquote|p|figure|section|hr|pre';

	/**
	 * @param Parser $parser
	 * @return void
	 */
	public function onParserFirstCallInit( $parser ) {
		$parser->setHook( 'proposed', [ self::class, 'render' ] );
	}

	/**
	 * Render a <proposed> block.
	 *
	 * @param string|null $input Wikitext between the tags.
	 * @param array $args Tag attributes.
	 * @param Parser $parser
	 * @param PPFrame $frame
	 * @return string HTML.
	 */
	public static function render( ?string $input, array $args, Parser $parser, PPFrame $frame ): string {
		if ( $input === null || trim( $input ) === '' ) {
			// An empty marker would claim nothing while still counting as a
			// marker, which is worse than no tag at all.
			return '';
		}

		// Register the category by parsing it along with the content rather
		// than calling ParserOutput::addCategory(), whose signature has moved
		// around between releases. Categories are extracted during parsing, so
		// this adds nothing to the rendered output.
		$wikitext = $input . "\n[[Category:" . self::TRACKING_CATEGORY . "]]";
		$html = $parser->recursiveTagParse( $wikitext, $frame );

		$parser->getOutput()->addModuleStyles( [ 'ext.pickipediaVerification.styles' ] );

		$by = isset( $args['by'] ) ? trim( $args['by'] ) : '';
		$source = isset( $args['source'] ) ? trim( $args['source'] ) : '';

		$element = preg_match( '/^\s*<(?:' . self::BLOCK_ELEMENTS . ')\b/i', $html ) ? 'div' : 'span';
		$classes = 'pv-proposed pv-proposed--' . ( $element === 'div' ? 'block' : 'inline' );

		$attributes = [
			'class' => $classes,
			'title' => self::hoverText( $by ),
		];
		if ( $by !== '' ) {
			$attributes['data-proposed-by'] = $by;
		}
		if ( $source !== '' ) {
			$attributes['data-source'] = $source;
		}

		$open = '<' . $element;
		foreach ( $attributes as $name => $value ) {
			$open .= ' ' . $name . '="' . htmlspecialchars( $value, ENT_QUOTES ) . '"';
		}
		$open .= '>';

		return $open . $html . self::badge( $by, $source ) . '</' . $element . '>';
	}

	/**
	 * Hover text naming who proposed the claim.
	 *
	 * @param string $by Proposer, possibly empty.
	 * @return string
	 */
	private static function hoverText( string $by ): string {
		return $by === ''
			? wfMessage( 'pickipediaverification-proposed-hover-anon' )->text()
			: wfMessage( 'pickipediaverification-proposed-hover' )->params( $by )->text();
	}

	/**
	 * The visible "unverified" marker.
	 *
	 * @param string $by Proposer, possibly empty.
	 * @param string $source Source hint, possibly empty.
	 * @return string HTML.
	 */
	private static function badge( string $by, string $source ): string {
		$label = wfMessage( 'pickipediaverification-proposed-badge' )->text();
		$badge = '<sup class="pv-proposed__badge">[' . htmlspecialchars( $label ) . ']</sup>';

		if ( $by === '' && $source === '' ) {
			return $badge;
		}

		$byline = $source === ''
			? wfMessage( 'pickipediaverification-proposed-byline' )->params( $by )->text()
			: wfMessage( 'pickipediaverification-proposed-byline-source' )
				->params( $by, $source )->text();

		return $badge . '<span class="pv-proposed__byline">'
			. htmlspecialchars( $byline ) . '</span>';
	}
}
