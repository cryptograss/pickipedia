<?php
/**
 * Each person's time zone, as their own MediaWiki preference says (Special:Preferences, Appearance, Time offset),
 * for anyone who needs to know what time it is where they are. Justin, #interfaces, 5 Nov 2026: "you're always
 * confused about what time it is for me. Can I like... set my location somehow and y'all will just know?"
 *
 * MediaWiki keeps the preference as "ZoneInfo|-360|America/Chicago" (a zone), "Offset|-360" (a fixed offset)
 * or "System|0" (the wiki's own, which says nothing of where they are). {{#timezone:Name}} gives the zone's
 * name, or the offset as +HH:MM, or nothing; a page using it is parsed again within the hour, as with
 * {{#pronouns:}}. Like pronouns, it's public: it's there so others get it right.
 */

namespace MediaWiki\Extension\PickiPediaContent;

class TimeZone {

	public const OPTION = 'timecorrection';

	/**
	 * The zone a stored preference names: an IANA name ("America/Chicago"), a fixed offset ("+05:30"), or ''
	 * for the wiki's own time, nothing set, or anything that isn't a zone.
	 */
	public static function zoneOf( $stored ): string {
		$parts = explode( '|', trim( (string)$stored ) );
		$kind = $parts[0] ?? '';
		if ( $kind === 'ZoneInfo' && isset( $parts[2] ) ) {
			return self::isZoneName( $parts[2] ) ? $parts[2] : '';
		}
		if ( $kind === 'Offset' && isset( $parts[1] ) && preg_match( '/^-?\d{1,4}$/', $parts[1] ) ) {
			return self::formatOffset( (int)$parts[1] );
		}
		return '';
	}

	/** An IANA zone name: letters, digits, "_", "-", "+", with "/" between its parts; never markup. */
	public static function isZoneName( $name ): bool {
		return (bool)preg_match( '/^[A-Za-z][A-Za-z0-9_+-]{0,31}(\/[A-Za-z0-9_+-]{1,32}){0,3}$/', (string)$name )
			&& mb_strlen( $name ) <= 64;
	}

	/** Minutes east of UTC as "+HH:MM". */
	public static function formatOffset( int $minutes ): string {
		if ( abs( $minutes ) > 14 * 60 ) {
			return '';
		}
		return sprintf( '%s%02d:%02d', $minutes < 0 ? '-' : '+', intdiv( abs( $minutes ), 60 ), abs( $minutes ) % 60 );
	}
}
