<?php
/**
 * Checks for the bot-edit verification gate.
 *
 * Runs the real Hooks.php against stubbed MediaWiki symbols, so the logic under
 * test is the shipped code rather than a copy of it. Private methods are
 * reached by reflection — they are private because nothing else should call
 * them, not because they should go unchecked.
 *
 * Usage:
 *   docker run --rm -v "$PWD:/w" -w /w php:8.2-cli \
 *     php extensions/PickiPediaVerification/tests/check-gate.php
 */

namespace MediaWiki\Hook {
	interface EditFilterMergedContentHook {
	}
}

namespace MediaWiki\Revision {
	class SlotRecord {
		public const MAIN = 'main';
	}
}

namespace MediaWiki\User {
	interface UserGroupManager {
	}
}

namespace MediaWiki {
	class MediaWikiServices {
	}
}

namespace {
	interface IContextSource {
	}
	interface Content {
	}
	class TextContent {
	}
	class Status {
	}

	require_once __DIR__ . '/../src/Hooks.php';

	$hooks = ( new ReflectionClass( \MediaWiki\Extension\PickiPediaVerification\Hooks::class ) )
		->newInstanceWithoutConstructor();

	$firstUnmarked = new ReflectionMethod( $hooks, 'firstUnmarkedNewLine' );
	$firstUnmarked->setAccessible( true );
	$firstUnkept = new ReflectionMethod( $hooks, 'firstUnkeptOldLine' );
	$firstUnkept->setAccessible( true );

	$failures = 0;

	/**
	 * @param string $name What is being asserted.
	 * @param bool $condition Whether it held.
	 * @param string $detail Shown on failure.
	 */
	function check( string $name, bool $condition, string $detail = '' ): void {
		global $failures;
		if ( $condition ) {
			echo "  ok   $name\n";
		} else {
			$failures++;
			echo "  FAIL $name" . ( $detail !== '' ? "\n       $detail" : '' ) . "\n";
		}
	}

	/**
	 * @param string|null $old Previous wikitext.
	 * @param string $new Wikitext being saved.
	 * @return string|null First unmarked new line.
	 */
	function gate( ?string $old, string $new ): ?string {
		global $hooks, $firstUnmarked;
		return $firstUnmarked->invoke( $hooks, $old, $new );
	}

	/**
	 * The strict rule, for namespaces where a removal is a proposal too.
	 *
	 * @param string|null $old Previous wikitext.
	 * @param string $new Wikitext being saved.
	 * @return string|null First old line taken away or moved without a marker.
	 */
	function strict( ?string $old, string $new ): ?string {
		global $hooks, $firstUnkept;
		return $firstUnkept->invoke( $hooks, $old, $new );
	}

	echo "\nThe hole in pickipedia#91:\n";

	// The bug, exactly: a page carrying one pending proposal used to accept
	// anything appended beside it.
	$pending = "* {{Bot_proposes|done1|by=Magent}}";
	check( 'unmarked prose beside a pending proposal is REJECTED',
		gate( $pending, $pending . "\nHe was convicted of grand larceny in 1998." ) !== null );
	check( 'unmarked prose on a page with no markers is still rejected',
		gate( "Existing sentence.", "Existing sentence.\nA brand new claim." ) !== null );
	check( 'marked prose beside a pending proposal is accepted',
		gate( $pending, $pending . "\n{{Bot_proposes|a new claim|by=Magent}}" ) === null );

	echo "\nEdits that assert nothing new:\n";

	check( 'removing a line needs no marker',
		gate( "One.\nTwo.\nThree.", "One.\nThree." ) === null );
	check( 'reordering needs no marker',
		gate( "One.\nTwo.", "Two.\nOne." ) === null );
	check( 'reindenting needs no marker',
		gate( "One.", "   One.   " ) === null );
	check( 'an unchanged page is accepted',
		gate( "One.\nTwo.", "One.\nTwo." ) === null );

	echo "\nMarkers that span more than one line:\n";

	$block = "<proposed by=\"Magent\">\n{{Ensemble|Del McCoury Band}}\n</proposed>";
	check( 'a <proposed> block covers its body, not just its opening',
		gate( '', $block ) === null, var_export( gate( '', $block ), true ) );
	check( 'a template with status=proposed covers its whole call',
		gate( '', "{{Show\n|artists=Billy Strings\n|status=proposed\n}}" ) === null,
		var_export( gate( '', "{{Show\n|artists=Billy Strings\n|status=proposed\n}}" ), true ) );
	check( 'the same template WITHOUT status is rejected',
		gate( '', "{{Show\n|artists=Billy Strings\n}}" ) !== null );
	check( 'an inline <proposed> on one line covers that line',
		gate( '', '* <proposed by="Magent">Tunes down.{{Src|video|cid=X|t=14:32}}</proposed>' ) === null );

	echo "\nLines with nowhere to put a marker:\n";

	check( 'a heading is allowed through',
		gate( '', "== Appearances ==" ) === null );
	check( 'a category is allowed through',
		gate( '', "[[Category:Musicians]]" ) === null );
	check( 'a table row is allowed through',
		gate( '', "{|\n| a || b\n|}" ) === null );
	check( 'but prose under a new heading is NOT',
		gate( '', "== Appearances ==\nHe played the Ryman in 1998." ) !== null );

	echo "\nNavigation links the middleware leaves bare:\n";

	// The bot middleware does not mark a list item that is only a link, on the
	// grounds that it asserts nothing. This gate has to agree, or a bot cannot
	// write a See also section: the middleware declines to mark it and the gate
	// then refuses the edit, naming a line nobody can fix. Found the hard way
	// trying to create Bluegrass Podcast Firehose.
	check( 'a bare See also link is allowed through',
		gate( '', "== See also ==\n* [[PickiPedia:About]]" ) === null,
		var_export( gate( '', "== See also ==\n* [[PickiPedia:About]]" ), true ) );
	check( 'so is one in a numbered or indented list',
		gate( '', "# [[Special:Releases]]\n: [[Main Page]]" ) === null );

	// But the moment it says something about the link, it is a claim again.
	check( 'a link WITH descriptive text still needs a marker',
		gate( '', "* [[Special:Releases]] — recordings hosted by cryptograss" ) !== null );
	check( 'and prose that merely contains a link does too',
		gate( '', "He recorded it with [[Del McCoury]] in 1998." ) !== null );

	echo "\nStrict namespaces: what the page says stays, or its going is proposed:\n";

	$orders = "== Practices ==\n* Never merge a pull request.\n* Never push to main.\n* Keep time in block heights.";
	check( 'removing a line unmarked is REJECTED, naming the line',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n* Keep time in block heights." )
			=== '* Never push to main.',
		var_export( strict( $orders, "== Practices ==\n* Never merge a pull request.\n* Keep time in block heights." ), true ) );
	check( 'moving a line is rejected too',
		strict( $orders, "== Practices ==\n* Never push to main.\n* Never merge a pull request.\n* Keep time in block heights." ) !== null );
	check( 'a removal proposed in block form is accepted',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\" action=\"remove\">\n* Never push to main.\n</proposed>\n* Keep time in block heights." ) === null,
		var_export( strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\" action=\"remove\">\n* Never push to main.\n</proposed>\n* Keep time in block heights." ), true ) );
	check( 'and in inline form, the tags off, the line is what goes',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n* <proposed by=\"Re\" action=\"remove\">Never push to main.</proposed>\n* Keep time in block heights." ) === null,
		var_export( strict( $orders, "== Practices ==\n* Never merge a pull request.\n* <proposed by=\"Re\" action=\"remove\">Never push to main.</proposed>\n* Keep time in block heights." ), true ) );
	check( 'a plain <proposed> around an old line does not propose its removal',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\">\n* Never push to main.\n</proposed>\n* Keep time in block heights." ) === null
			&& strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\">\n* Never push to anything.\n</proposed>\n* Keep time in block heights." ) === '* Never push to main.' );
	check( 'a changed line is a removal and an addition: the old one must be proposed away',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n* Never push to main.\n* {{Bot_proposes|Keep time in block heights, fetched.|by=Re}}" ) === '* Keep time in block heights.' );
	check( 'rewording properly: strike the old, add the new, marked',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n* Never push to main.\n<proposed by=\"Re\" action=\"remove\">\n* Keep time in block heights.\n</proposed>\n* {{Bot_proposes|Keep time in block heights, fetched.|by=Re}}" ) === null );
	check( 'adding a marked line between old ones is fine',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n* {{Bot_proposes|Never force-push.|by=Re}}\n* Never push to main.\n* Keep time in block heights." ) === null );
	check( 'reindenting and blank lines are not changes',
		strict( $orders, "== Practices ==\n\n*  Never merge a pull request.\n* Never push to main.\n\n* Keep time in block heights.\n" ) === null );
	check( 'a pending removal stays put as the page is edited again',
		strict( "One.\n<proposed by=\"Re\" action=\"remove\">\nTwo.\n</proposed>\nThree.",
			"One.\n<proposed by=\"Re\" action=\"remove\">\nTwo.\n</proposed>\nThree.\n{{Bot_proposes|Four.|by=Re}}" ) === null );
	check( 'but un-proposing it by deleting the struck line is a removal',
		strict( "One.\n<proposed by=\"Re\" action=\"remove\">\nTwo.\n</proposed>\nThree.", "One.\nThree." ) !== null );
	check( 'the strict rule says nothing about additions (the gate does)',
		strict( $orders, $orders . "\nAn unmarked new claim." ) === null );
	check( 'page creation takes nothing away',
		strict( null, "Anything." ) === null );
	check( 'a removal that never closes is refused, naming its opening tag',
		strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\" action=\"remove\">\n* Never push to main.\n* Keep time in block heights." )
			=== '<proposed by="Re" action="remove">',
		var_export( strict( $orders, "== Practices ==\n* Never merge a pull request.\n<proposed by=\"Re\" action=\"remove\">\n* Never push to main.\n* Keep time in block heights." ), true ) );
	$twice = "* Say where it is.\n* Read the record.\n* Say where it is.";
	check( 'of two identical lines, dropping one is still a removal',
		strict( $twice, "* Say where it is.\n* Read the record." ) === '* Say where it is.' );
	check( 'and proposing one of them away is accepted',
		strict( $twice, "* Say where it is.\n* Read the record.\n<proposed by=\"Blu\" action=\"remove\">\n* Say where it is.\n</proposed>" ) === null );
	$task = "{{Agent task|mood=connectome|schedule=every 3600 blocks|cap=1|tools=full}}\nWrite the next entry.";
	check( 'a changed number is not the same line: cap=1 to cap=50 is a removal of the old line',
		strict( $task, "{{Agent task|mood=connectome|schedule=every 3600 blocks|cap=50|tools=full}}\nWrite the next entry." )
			=== '{{Agent task|mood=connectome|schedule=every 3600 blocks|cap=1|tools=full}}' );
	check( 'nor is a change of case',
		strict( "Never push to main.", "never push to main." ) === 'Never push to main.' );
	check( 'the heading counts as a line too',
		strict( $orders, "* Never merge a pull request.\n* Never push to main.\n* Keep time in block heights." ) === '== Practices ==' );

	echo "\nPage creation:\n";

	check( 'creating a page of unmarked prose is rejected',
		gate( null, "He plays a 1923 Loar." ) !== null );
	check( 'creating a page of marked prose is accepted',
		gate( null, "{{Bot_proposes|He plays a 1923 Loar.|by=Magent}}" ) === null );

	echo "\nThe rejection says which line:\n";

	$offender = gate( $pending, $pending . "\nHe was convicted of grand larceny in 1998." );
	check( 'the offending line is reported back',
		$offender === 'He was convicted of grand larceny in 1998.',
		var_export( $offender, true ) );

	echo $failures === 0 ? "\nAll checks passed.\n\n" : "\n$failures FAILED\n\n";
	exit( $failures === 0 ? 0 : 1 );
}
