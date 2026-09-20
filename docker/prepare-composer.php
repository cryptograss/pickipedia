<?php
/**
 * Make MediaWiki's root composer.json resolvable, before `composer update`.
 *
 * Two edits, both to the build tree only — the repository's own composer.json
 * is never touched:
 *
 *  - Copy our audit config onto the root. Composer's audit gate refuses to
 *    load packages with known advisories, and it reads that setting *only*
 *    from the root composer.json. Ours lives in composer.local.json, which is
 *    where the project's dependencies are declared and therefore the honest
 *    place to record which advisories we have accepted. So it is copied up,
 *    rather than maintained in two places.
 *
 *  - Drop MediaWiki core's require-dev. The build runs with --no-dev, but
 *    composer still *resolves* dev packages, and core pins
 *    mediawiki-codesniffer to an exact version whose own floating dependency
 *    has since moved past it. That is an unsolvable conflict among tools we
 *    never install.
 *
 * The result is written beside the target and renamed over it. Writing in
 * place fails under BuildKit, which does not give the build's root the
 * capability to ignore file modes the way an ordinary root has — the
 * MediaWiki tarball ships composer.json read-only, and `file_put_contents`
 * comes back "Permission denied". A rename only needs the directory.
 *
 * This mirrors the Jenkinsfile's "Install Composer Dependencies" stage. Keep
 * the two in step: when they drifted, Jenkins kept building and the Docker
 * image did not, and nobody noticed for eight months because the image that
 * already existed went on working.
 *
 * The second argument is optional. Bundled extensions that ship their own
 * composer.json and no lockfile — MediaUploader is one — need only the
 * require-dev half: their dev tooling pulls mediawiki-codesniffer, which pulls
 * a php_codesniffer under advisory, and `composer install` becomes an
 * unsolvable `composer update` over tools that are never installed.
 *
 *   php prepare-composer.php [composer.json] [composer.local.json]
 */

$rootPath = $argv[1] ?? 'composer.json';
$localPath = $argv[2] ?? null;

function readJson( string $path ): array {
	$raw = @file_get_contents( $path );
	if ( $raw === false ) {
		fwrite( STDERR, "prepare-composer: cannot read $path\n" );
		exit( 1 );
	}
	$decoded = json_decode( $raw, true );
	if ( !is_array( $decoded ) ) {
		fwrite( STDERR, "prepare-composer: $path is not valid JSON: "
			. json_last_error_msg() . "\n" );
		exit( 1 );
	}
	return $decoded;
}

$root = readJson( $rootPath );
$local = $localPath !== null ? readJson( $localPath ) : [];

$audit = $local['config']['audit'] ?? [ 'abandoned' => 'ignore', 'ignore' => [] ];
$root['config']['audit'] = $audit;

$hadDev = isset( $root['require-dev'] );
unset( $root['require-dev'] );

$encoded = json_encode( $root, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
if ( $encoded === false ) {
	fwrite( STDERR, "prepare-composer: could not encode the result\n" );
	exit( 1 );
}

$temporary = $rootPath . '.prepared';
if ( file_put_contents( $temporary, $encoded . "\n" ) === false
	|| !rename( $temporary, $rootPath )
) {
	fwrite( STDERR, "prepare-composer: cannot write $rootPath\n" );
	exit( 1 );
}

printf(
	"prepare-composer: %d advisories ignored%s\n",
	count( $audit['ignore'] ?? [] ),
	$hadDev ? ", require-dev dropped" : ""
);
