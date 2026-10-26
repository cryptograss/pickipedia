#!/usr/bin/env bash
#
# Does a Module: page actually reach the Lua in this repository?
#
# The other tests run the Lua directly, which proves the logic and nothing
# about the wiring. The wiring is the part that was taken on faith: a hook
# defined by Scribunto rather than by core, registered as a HookHandler
# without implementing any interface, adding a path that Scribunto searches
# before it looks for wiki pages. Every step of that is documented, and
# documented is not the same as true.
#
# So this stands up a throwaway MediaWiki on SQLite, points a Module: page at
# the repository through require(), and parses it. It touches nothing that
# already exists: its own container, its own database, deleted on exit.
#
# Needs docker and the pickipedia-wiki image (docker build -t pickipedia-wiki:latest .)
#
#   tests/check-in-wiki.sh [host-path-to-extensions]
#
# The argument is for running from inside a container, where the extensions
# directory has a different path on the docker host than it does here. Without
# it, this directory's parent is used.

set -euo pipefail

IMAGE="${PICKIPEDIA_WIKI_IMAGE:-pickipedia-wiki:latest}"
EXTENSIONS="${1:-$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )}"

if ! command -v docker >/dev/null 2>&1; then
    echo "check-in-wiki.sh: no docker; skipping."
    exit 0
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "check-in-wiki.sh: no $IMAGE image; skipping."
    echo "  build it with: docker build -t $IMAGE ."
    exit 0
fi

echo "check-in-wiki.sh: extensions from $EXTENSIONS"

output=$( docker run --rm -i \
    -v "$EXTENSIONS":/var/www/html/custom-extensions:ro \
    "$IMAGE" bash -s <<'INSIDE' 2>&1
set -e
cd /var/www/html

# The dev image symlinks custom-extensions/* into extensions/ when it is
# built, so an extension added since then has no link. The real deploy has no
# such step — the Jenkinsfile rsyncs straight into extensions/ — so this is
# make-up for the test environment, not something production needs.
ln -sfn /var/www/html/custom-extensions/PickiPediaContent extensions/PickiPediaContent

mkdir -p /tmp/wikidb && chmod 777 /tmp/wikidb
php maintenance/install.php --dbtype=sqlite --dbpath=/tmp/wikidb \
    --scriptpath="" --lang=en --pass=testtesttest TestWiki Admin >/tmp/install.log 2>&1 \
    || { echo "INSTALL FAILED"; tail -25 /tmp/install.log; exit 1; }

# Deliberately not the repository's LocalSettings.php: this is testing one
# hook, and dragging in Semantic MediaWiki and the rest of the configuration
# would mean a failure here could be any of a hundred things.
cat >> LocalSettings.php <<'EOF'
wfLoadExtension( 'Scribunto' );
$wgScribuntoDefaultEngine = 'luastandalone';
wfLoadExtension( 'PickiPediaContent' );
# The Emergent namespace, as the repository's LocalSettings.php sets it up
# (Agent: until 25 Oct 2026, still an alias).
define( "NS_EMERGENT", 3010 );
define( "NS_EMERGENT_TALK", 3011 );
$wgExtraNamespaces[NS_EMERGENT] = "Emergent";
$wgExtraNamespaces[NS_EMERGENT_TALK] = "Emergent_talk";
$wgNamespaceAliases['Agent'] = NS_EMERGENT;
$wgNamespaceAliases['Agent_talk'] = NS_EMERGENT_TALK;
$wgNamespaceProtection[NS_EMERGENT] = ['emergent-edit'];
$wgGroupPermissions['emergent']['emergent-edit'] = true;
$wgGroupPermissions['sysop']['emergent-edit'] = true;
$wgGroupPermissions['sysop']['emergent-edit-any'] = true;
# The Cryptograss namespace, where the Moods' to-do lists live.
define( "NS_CRYPTOGRASS", 3000 );
define( "NS_CRYPTOGRASS_TALK", 3001 );
$wgExtraNamespaces[NS_CRYPTOGRASS] = "Cryptograss";
$wgExtraNamespaces[NS_CRYPTOGRASS_TALK] = "Cryptograss_talk";
EOF

printf "%s\n" "return require( 'pickipedia.instruments' )" > /tmp/shim.lua
php maintenance/edit.php -u Admin -s "shim" "Module:Instruments" < /tmp/shim.lua >/dev/null

# Who may change which Emergent: page, asked of MediaWiki's own permission manager.
cat > maintenance/checkEmergentPages.php <<'EOF'
<?php
require_once __DIR__ . '/Maintenance.php';
use MediaWiki\MediaWikiServices;
use MediaWiki\Permissions\PermissionManager;
use MediaWiki\Title\Title;
class CheckEmergentPages extends Maintenance {
	public function execute() {
		$services = MediaWikiServices::getInstance();
		$users = $services->getUserFactory();
		$groups = $services->getUserGroupManager();
		$permissions = $services->getPermissionManager();
		foreach ( [ 'Magent', 'Re', 'Someone' ] as $name ) {
			\User::createNew( $name );
		}
		$groups->addUserToGroup( $users->newFromName( 'Magent' ), 'emergent' );
		$groups->addUserToGroup( $users->newFromName( 'Re' ), 'emergent' );
		// An old Agent: link lands in the Emergent namespace.
		echo 'ALIAS ' . Title::newFromText( 'Agent:Magent/Notes' )->getPrefixedText() . "\n";
		foreach ( [
			[ 'Magent', 'edit', NS_EMERGENT, 'Magent/Notes' ], [ 'Magent', 'create', NS_EMERGENT, 'Magent' ],
			[ 'Re', 'edit', NS_EMERGENT, 'Magent/Notes' ], [ 'Re', 'edit', NS_EMERGENT, 'Re/Hunter' ],
			[ 'Magent', 'move-target', NS_EMERGENT, 'Re/Taken' ], [ 'Someone', 'edit', NS_EMERGENT, 'Someone/x' ],
			[ 'Admin', 'edit', NS_EMERGENT, 'Re/Hunter' ], [ 'Someone', 'read', NS_EMERGENT, 'Magent/Notes' ],
			[ 'Re', 'edit', NS_EMERGENT_TALK, 'Magent/Notes' ], [ 'Someone', 'edit', NS_EMERGENT_TALK, 'Magent' ],
		] as [ $who, $action, $ns, $page ] ) {
			$user = $users->newFromName( $who );
			$can = $permissions->userCan( $action, $user, Title::makeTitle( $ns, $page ), PermissionManager::RIGOR_SECURE );
			echo "EMERGENT $who $action " . ( $ns === NS_EMERGENT ? 'Emergent' : 'Emergent_talk' ) . ":$page=" . ( $can ? 'yes' : 'no' ) . "\n";
		}
	}
}
$maintClass = CheckEmergentPages::class;
require_once RUN_MAINTENANCE_IF_MAIN;
EOF
php maintenance/checkEmergentPages.php 2>&1 | grep '^EMERGENT\|^ALIAS\|rror' || true

# Recent Changes with a Mood's to-do list and an ordinary page edited: what each view shows.
echo 'a to-do list' | php maintenance/edit.php -u Admin -s "tick" "Cryptograss:Moods/magenta-interface/todo" >/dev/null
echo 'a page' | php maintenance/edit.php -u Admin -s "words" "Cryptograss:Banjo setups" >/dev/null
cat > maintenance/checkRcTodos.php <<'EOF'
<?php
require_once __DIR__ . '/Maintenance.php';
use MediaWiki\Context\DerivativeContext;
use MediaWiki\Context\RequestContext;
use MediaWiki\MediaWikiServices;
use MediaWiki\Output\OutputPage;
use MediaWiki\Request\FauxRequest;
use MediaWiki\SpecialPage\SpecialPage;
class CheckRcTodos extends Maintenance {
	public function execute() {
		foreach ( [ 'default' => [], 'asked' => [ 'hidemoodtodos' => 0 ],
			'only' => [ 'hidemoodtodos' => 0, 'hidenotmoodtodos' => 1 ] ] as $label => $params ) {
			$ctx = new DerivativeContext( RequestContext::getMain() );
			$ctx->setRequest( new FauxRequest( $params + [ 'days' => 30, 'limit' => 50 ] ) );
			$ctx->setTitle( SpecialPage::getTitleFor( 'Recentchanges' ) );
			$out = new OutputPage( $ctx );
			$ctx->setOutput( $out );
			$page = MediaWikiServices::getInstance()->getSpecialPageFactory()->getPage( 'Recentchanges' );
			$page->setContext( $ctx );
			$page->execute( null );
			$html = $out->getHTML();
			echo "RC $label todo=" . ( str_contains( $html, 'Moods/magenta-interface/todo' ) ? 'shown' : 'hidden' )
				. " other=" . ( str_contains( $html, 'Banjo setups' ) ? 'shown' : 'hidden' ) . "\n";
		}
	}
}
$maintClass = CheckRcTodos::class;
require_once RUN_MAINTENANCE_IF_MAIN;
EOF
php maintenance/checkRcTodos.php 2>&1 | grep '^RC \|rror' || true

# magenta's ledgers of the Moods' links, the pages they name, and each page as a reader gets it.
cat > /tmp/ledger-october.txt <<'EOF'
Messages in #magenta-interface that link pages here, October 2026.

<moodlinks>
- page: Bill Monroe
  message: 0f132ada-1111-4222-8333-444455556666
  who: justin
  when: '2026-10-19T15:44:12Z'
  words: Is Bill Monroe on the page yet?
- page: Tony Rice
  message: 0f132ada-1111-4222-8333-444455556666
  who: justin
  when: '2026-10-19T15:44:12Z'
  words: Is Bill Monroe on the page yet?
- page: Peter Rowan
  message: 5c5c5c5c-1111-4222-8333-444455556666
  who: magent
  when: '2026-10-19T16:30:00Z'
  words: Peter Rowan has no page yet.
</moodlinks>
EOF
cat > /tmp/ledger-september.txt <<'EOF'
<moodlinks>
- page: bill_Monroe
  message: 7a7a7a7a-1111-4222-8333-444455556666
  who: skyler
  when: '2026-09-02T10:00:00Z'
  words: "Monroe <script>alert(1)</script>"
</moodlinks>
EOF
php maintenance/edit.php -u Admin -s "links" "Cryptograss:Moods/magenta-interface/links/2026-10" < /tmp/ledger-october.txt >/dev/null
php maintenance/edit.php -u Admin -s "links" "Cryptograss:Moods/general/links/2026-09" < /tmp/ledger-september.txt >/dev/null
echo 'The father of bluegrass.' | php maintenance/edit.php -u Admin -s "words" "Bill Monroe" >/dev/null
echo 'A guitarist.' | php maintenance/edit.php -u Admin -s "words" "Tony Rice" >/dev/null
php maintenance/runJobs.php >/dev/null 2>&1 || true
php -S 127.0.0.1:8080 -t /var/www/html >/tmp/php-server.log 2>&1 &
sleep 2
cat > /tmp/foot.php <<'EOF'
<?php
$html = (string)@file_get_contents( 'http://127.0.0.1:8080/index.php?title=' . rawurlencode( $argv[1] )
	. ( isset( $argv[2] ) ? '&action=' . $argv[2] : '' ), false,
	stream_context_create( [ 'http' => [ 'ignore_errors' => true ] ] ) );  // a page not yet written answers 404
$foot = preg_match( '#<div class="pp-moodlinks pp-moodlinks-foot">(.*?)</div>#s', $html, $m ) ? $m[1] : '';
preg_match_all( '#<li><a [^>]*href="([^"]+)"[^>]*>([^<]*)</a>#', $foot, $rows, PREG_SET_ORDER );
echo 'FOOT ' . $argv[1] . ( isset( $argv[2] ) ? " ($argv[2])" : '' ) . ' rows=' . count( $rows ) . ' '
	. implode( ' | ', array_map( static fn ( $r ) => html_entity_decode( $r[2] ) . ' -> ' . $r[1], $rows ) )
	. ( str_contains( $foot, '<script>' ) ? ' MARKUP' : '' ) . ( $html === '' ? ' NOPAGE' : '' ) . "\n";
EOF
for page in 'Bill_Monroe' 'Tony_Rice' 'Cryptograss:Banjo_setups' 'Cryptograss:Moods/magenta-interface/links/2026-10'; do
    php /tmp/foot.php "$page"
done
php /tmp/foot.php 'Bill_Monroe' history
php /tmp/foot.php 'Bill_Monroe' edit
php /tmp/foot.php 'Peter_Rowan'
php /tmp/foot.php 'Peter_Rowan' edit
php -r '$h = file_get_contents("http://127.0.0.1:8080/index.php?title=Cryptograss:Moods/magenta-interface/links/2026-10");
    echo "LEDGER " . ( str_contains( $h, "href=\"/index.php/Bill_Monroe\"" ) || str_contains( $h, "title=Bill_Monroe" ) ? "links-pages" : "no-page-links" ) . "\n";'

printf '%s' 'FAMILY:{{#invoke:Instruments|family|5-string banjo}} EMPTY:[{{#invoke:Instruments|family|cello}}] BADGE:{{#invoke:Instruments|badge|1=5-string banjo|size=18|tuck=1}}' \
    | php maintenance/parse.php --title "Test" 2>/dev/null
INSIDE
)

failures=0
expect() {
    if printf '%s' "$output" | grep -qF -- "$2"; then
        echo "  ok   $1"
    else
        failures=$(( failures + 1 ))
        echo "  FAIL $1"
        echo "       wanted: $2"
    fi
}
refute() {
    if printf '%s' "$output" | grep -qF -- "$2"; then
        failures=$(( failures + 1 ))
        echo "  FAIL $1"
        echo "       found: $2"
    else
        echo "  ok   $1"
    fi
}

echo
echo "A Module: page reaching the repository:"
expect "the shim resolves and the module answers" "FAMILY:banjo"
expect "an instrument with no icon answers with nothing" "EMPTY:[]"
expect "styling comes through as classes" 'class="pp-instrument pp-instrument--tuck'

echo
echo "Class names survive the parser:"
# MediaWiki breaks "__" up so it cannot be read as a behaviour switch, turning
# pp-instrument__box into pp-instrument&#95;_box. Browsers decode it back, so
# the rule still matches and nothing looks wrong — which is why it needs a
# test rather than an eye.
expect "the box class arrives intact" 'class="pp-instrument-box"'
refute "nothing is mangled into an entity" '&#95;'

echo
echo "Emergent: pages, each its own emergent's (EmergentPages.php):"
expect "an old Agent: link lands in the Emergent namespace" "ALIAS Emergent:Magent/Notes"
expect "an emergent edits its own notes" "EMERGENT Magent edit Emergent:Magent/Notes=yes"
expect "and creates its root page" "EMERGENT Magent create Emergent:Magent=yes"
expect "another emergent can't edit them" "EMERGENT Re edit Emergent:Magent/Notes=no"
expect "but edits its own" "EMERGENT Re edit Emergent:Re/Hunter=yes"
expect "nor move a page into another's" "EMERGENT Magent move-target Emergent:Re/Taken=no"
expect "someone not an emergent can't, even under their own name" "EMERGENT Someone edit Emergent:Someone/x=no"
expect "a sysop can change any" "EMERGENT Admin edit Emergent:Re/Hunter=yes"
expect "anyone reads them" "EMERGENT Someone read Emergent:Magent/Notes=yes"
expect "another emergent leaves a note on the talk page" "EMERGENT Re edit Emergent_talk:Magent/Notes=yes"
expect "and so can anyone" "EMERGENT Someone edit Emergent_talk:Magent=yes"

echo
echo "Recent Changes leaves out the Moods' to-do lists unless asked:"
expect "by default, an ordinary page's edit shows and a to-do list's doesn't" "RC default todo=hidden other=shown"
expect "asked for, both show" "RC asked todo=shown other=shown"
expect "and they can be shown alone" "RC only todo=shown other=hidden"

echo
echo "Pages list the magenta messages that link them (MoodLinks.php):"
expect "a page shows its links from every Mood's ledger, newest first" \
    "FOOT Bill_Monroe rows=2 justin in #magenta-interface, 19 Oct 2026, 15:44 UTC -> https://magenta.cryptograss.live/moods/magenta-interface/#m-0f132ada-1111-4222-8333-444455556666 | skyler in #general, 2 Sep 2026, 10:00 UTC -> https://magenta.cryptograss.live/moods/general/#m-7a7a7a7a-1111-4222-8333-444455556666"
expect "another page only its own" "FOOT Tony_Rice rows=1 justin in #magenta-interface"
expect "a page no message links shows nothing" "FOOT Cryptograss:Banjo_setups rows=0"
expect "nor does the ledger itself" "FOOT Cryptograss:Moods/magenta-interface/links/2026-10 rows=0"
expect "and on its history" "FOOT Bill_Monroe (history) rows=2"
expect "and its edit form" "FOOT Bill_Monroe (edit) rows=2"
expect "a page with none yet shows what was said of it" "FOOT Peter_Rowan rows=1 magent in #magenta-interface"
expect "and so does the form that starts it" "FOOT Peter_Rowan (edit) rows=1 magent in #magenta-interface"
refute "a message's words never become markup" " MARKUP"
refute "every page answered" " NOPAGE"
expect "the ledger links the pages it names" "LEDGER links-pages"

echo
if [ "$failures" -ne 0 ]; then
    echo "$failures FAILED"
    echo "--- parser output ---"
    printf '%s\n' "$output"
    exit 1
fi
echo "All checks passed."
