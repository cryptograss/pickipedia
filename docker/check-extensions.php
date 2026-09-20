<?php
/**
 * Every extension LocalSettings.php loads must be installed by both builds.
 *
 * There are two ways to build this wiki — the Jenkinsfile for production, the
 * Dockerfile for local previews — and they install extensions from separate,
 * hand-maintained lists. They drifted, and the way we found out was every
 * preview on hunter dying at startup with
 *
 *     MediaWiki is unable to load the extension MediaUploader
 *
 * after eight months in which nobody could rebuild the image to notice. The
 * Dockerfile's list was already commented "must match Jenkinsfile", which is
 * the kind of instruction that is true right up until it isn't.
 *
 * So this reads what LocalSettings.php actually asks for and checks that each
 * build knows how to provide it. It is a text comparison, not a build — it
 * runs in a second, before anything is downloaded.
 *
 *   php docker/check-extensions.php [repo root]
 */

$root = $argv[1] ?? dirname( __DIR__ );

function readOrDie( string $path ): string {
	$raw = @file_get_contents( $path );
	if ( $raw === false ) {
		fwrite( STDERR, "check-extensions: cannot read $path\n" );
		exit( 1 );
	}
	return $raw;
}

$settings = readOrDie( "$root/LocalSettings.php" );
$dockerfile = readOrDie( "$root/Dockerfile" );
$jenkinsfile = readOrDie( "$root/Jenkinsfile" );

// What the wiki asks for. Commented-out lines do not count: a line like
// "# wfLoadExtension( 'CodeMirror' );" is a decision not to load it.
$wanted = [];
foreach ( explode( "\n", $settings ) as $line ) {
	if ( preg_match( '/^\s*(#|\/\/)/', $line ) ) {
		continue;
	}
	if ( preg_match( "/wfLoadExtension\(\s*'([A-Za-z_]+)'/", $line, $m ) ) {
		$wanted[ $m[1] ] = true;
	}
}
$wanted = array_keys( $wanted );
sort( $wanted );

if ( !$wanted ) {
	fwrite( STDERR, "check-extensions: found no wfLoadExtension calls, which "
		. "cannot be right — has LocalSettings.php moved?\n" );
	exit( 1 );
}

// Extensions bundled with the MediaWiki tarball or pulled in by composer are
// not named in either build file, and do not need to be. Only the ones a
// build has to fetch or symlink itself are checked.
$custom = array_map( 'basename', glob( "$root/extensions/*", GLOB_ONLYDIR ) ?: [] );

$failures = [];
foreach ( $wanted as $name ) {
	// A custom extension in this repo is copied in by both builds wholesale.
	if ( in_array( $name, $custom, true ) ) {
		continue;
	}
	$inDocker = str_contains( $dockerfile, "extensions-$name.git" );
	$inJenkins = str_contains( $jenkinsfile, "extensions-$name.git" );

	// Named by one build but not the other is always a mistake: they install
	// the same wiki. Named by neither means it comes from the tarball or
	// composer, which is fine.
	if ( $inJenkins && !$inDocker ) {
		$failures[] = "  $name: cloned by the Jenkinsfile, missing from the Dockerfile";
	} elseif ( $inDocker && !$inJenkins ) {
		$failures[] = "  $name: cloned by the Dockerfile, missing from the Jenkinsfile";
	}
}

if ( $failures ) {
	echo "check-extensions.php FAILED\n";
	echo implode( "\n", $failures ) . "\n\n";
	echo "Both builds install the same wiki. An extension fetched by one and\n";
	echo "not the other gives you a preview that cannot start, or a deploy\n";
	echo "that cannot.\n";
	exit( 1 );
}

printf(
	"check-extensions.php: %d extensions loaded, both builds agree.\n",
	count( $wanted )
);
exit( 0 );
