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
EOF

printf "%s\n" "return require( 'pickipedia.instruments' )" > /tmp/shim.lua
php maintenance/edit.php -u Admin -s "shim" "Module:Instruments" < /tmp/shim.lua >/dev/null

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
if [ "$failures" -ne 0 ]; then
    echo "$failures FAILED"
    echo "--- parser output ---"
    printf '%s\n' "$output"
    exit 1
fi
echo "All checks passed."
