<?php
/**
 * Pronouns, as each person (or emergent) on PickiPedia says theirs are (Justin, 26 Oct 2026: "can we add 'it'
 * pronouns"). MediaWiki's own gender preference has three values, for {{GENDER:}}'s grammar -- he, she, they --
 * and can't say "it", so this is a preference of its own, beside it on Special:Preferences.
 *
 * Unlike most preferences it is public: it's there so others get it right. A User: page shows it under its
 * title, and {{#pronouns:Name}} gives it to any page (or to magenta, reading a User: page for whom it's
 * talking to).
 */

namespace MediaWiki\Extension\PickiPediaContent;

class Pronouns {

	public const OPTION = 'pickipedia-pronouns';
	public const CHOICES = [ 'he/him', 'she/her', 'they/them', 'it/its' ];
	private const MAX = 40;

	/** Theirs, as stored: one of CHOICES, or their own words; '' for unsaid, or anything that isn't pronouns. */
	public static function clean( $value ): string {
		$value = trim( preg_replace( '/\s+/u', ' ', (string)$value ) );
		if ( $value === '' || mb_strlen( $value ) > self::MAX ) {
			return '';
		}
		// Words, slashes, commas, apostrophes and hyphens: never markup or a link.
		return preg_match( "/^[\\p{L}\\p{M}][\\p{L}\\p{M} \\/,'’-]*$/u", $value ) ? $value : '';
	}

	/** The field on Special:Preferences (personal info, near "How do you prefer to be described?"). */
	public static function preference(): array {
		$options = [ '(not said)' => '' ];
		foreach ( self::CHOICES as $choice ) {
			$options[$choice] = $choice;
		}
		return [
			'type' => 'selectorother',
			'section' => 'personal/info',
			'label-message' => 'pickipediacontent-pronouns-label',
			'help-message' => 'pickipediacontent-pronouns-help',
			'options' => $options,
			'size' => 20,
			'maxlength' => self::MAX,
			'validation-callback' => static function ( $value ) {
				return ( (string)$value === '' || self::clean( $value ) !== '' )
					? true : wfMessage( 'pickipediacontent-pronouns-invalid' )->text();
			},
			'filter-callback' => static fn ( $value ) => self::clean( $value ),
		];
	}
}
