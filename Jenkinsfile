pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        // 1.43 is the current LTS, supported to Dec 2027. The next move is a
        // deliberate one: skip 1.45 (EOL Dec 2026) and 1.46, and go LTS-to-LTS
        // to 1.47 when it lands (~Nov 2026). Before bumping this, read
        // "Upgrading" in README.md — the categorylinks incident (issue #105)
        // is what happens when an upgrade is attempted casually.
        MEDIAWIKI_VERSION = '1.43.6'
        // Bump this to force rebuild of cached MediaWiki + extensions
        BUILD_CACHE_VERSION = '5'  // 5: SMW 6 -> 7.2, force clean vendor
        SECRETS_DIR = '/var/jenkins_home/secrets'
        BUILD_DIR = "${WORKSPACE}/build"
        MW_DIR = "${BUILD_DIR}/mediawiki"
    }

    stages {
        stage('Setup Secrets') {
            steps {
                sh '''#!/bin/bash
                    # Copy LocalSettings.local.php from secrets
                    if [ -f "${SECRETS_DIR}/pickipedia/LocalSettings.local.php" ]; then
                        cp "${SECRETS_DIR}/pickipedia/LocalSettings.local.php" LocalSettings.local.php
                        chmod 644 LocalSettings.local.php
                    else
                        echo "ERROR: LocalSettings.local.php not found in secrets"
                        exit 1
                    fi
                '''
            }
        }

        stage('Check Verification Gate') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    # The gate decides what a bot is allowed to write to the
                    # wiki. It is cheap to check and expensive to get wrong —
                    # pickipedia#91 sat open long enough for the firehose to be
                    # planned on top of it — so it runs before anything is
                    # built, and a failure here stops the deploy.
                    php extensions/PickiPediaVerification/tests/check-gate.php

                    # The other half of the same workflow: the <proposed> tag
                    # has to hand the verify gadget the wikitext it wrapped, or
                    # no claim written as a template can be verified at all
                    # (pickipedia#122).
                    php extensions/PickiPediaVerification/tests/check-proposed-tag.php

                    # And what verifying does to them: a claim unwrapped, a
                    # proposed removal taken away.
                    php extensions/PickiPediaVerification/tests/check-verify-strip.php

                    # And the button that reads them. Skipped rather than
                    # failed where the agent has no node: a missing runtime is
                    # not a broken build, and saying so beats a green tick that
                    # means nothing.
                    if command -v node >/dev/null 2>&1; then
                        node extensions/PickiPediaVerification/tests/check-verify-js.mjs
                    else
                        echo "node not installed; skipping check-verify-js.mjs"
                    fi

                    # Both builds install the same wiki from separate,
                    # hand-kept lists. When they drifted, the deploy went on
                    # working and every local preview died at startup on a
                    # missing MediaUploader -- for eight months, because the
                    # image could not be rebuilt to find out.
                    php docker/check-extensions.php "${WORKSPACE}"

                    # The article modules. These used to live only on the wiki,
                    # where nothing reviewed them and nothing could revert
                    # them; they are here now so that this can run. The class
                    # check is the seam between the Lua and the stylesheet —
                    # rename one and the page still renders, just unstyled,
                    # which no wiki would ever tell us about.
                    cd extensions/PickiPediaContent
                    php tests/check-classes.php
                    # Emergent: pages, each its own emergent's. The hook itself is
                    # checked in a real wiki by tests/check-in-wiki.sh.
                    php tests/check-emergent-pages.php
                    # Emergents' instructions bundles, rebuilt from revisions byte for
                    # byte as memory-lane's bundler made them (Special:EmergentBundles).
                    php tests/check-bundles.php
                    # Pronouns on Special:Preferences: what's kept, what's refused.
                    php tests/check-pronouns.php
                    # The push to magenta: its body, signature and URL.
                    php tests/check-magenta-push.php
                    # Time zones: MediaWiki's time offset preference, read as a zone for {{#timezone:}}.
                    php tests/check-timezone.php
                    # A page's card where its address is shared: its opening and its picture.
                    php tests/check-socialcard.php

                    # Lua, if the agent has one. Scribunto ships an interpreter
                    # but MediaWiki is not downloaded yet at this stage, so a
                    # system lua is the only one on offer. Skipped rather than
                    # failed, like the node check above.
                    LUA=""
                    for candidate in lua5.1 lua51 lua; do
                        if command -v "$candidate" >/dev/null 2>&1; then
                            LUA="$candidate"
                            break
                        fi
                    done
                    if [ -n "$LUA" ]; then
                        for check in tests/check-*.lua; do
                            echo "--- $check"
                            "$LUA" "$check"
                        done
                    else
                        echo "no lua interpreter; skipping the module checks"
                    fi
                    cd "${WORKSPACE}"
                '''
            }
        }

        stage('Download MediaWiki') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    mkdir -p "${BUILD_DIR}"

                    MW_TARBALL="mediawiki-${MEDIAWIKI_VERSION}.tar.gz"
                    MW_URL="https://releases.wikimedia.org/mediawiki/${MEDIAWIKI_VERSION%.*}/mediawiki-${MEDIAWIKI_VERSION}.tar.gz"

                    # Check if we have cached version (includes BUILD_CACHE_VERSION to force rebuilds)
                    CACHE_KEY="${MEDIAWIKI_VERSION}-${BUILD_CACHE_VERSION}"
                    if [ -f "${BUILD_DIR}/.mw-version" ] && [ "$(cat "${BUILD_DIR}/.mw-version")" = "${CACHE_KEY}" ]; then
                        echo "Using cached MediaWiki ${MEDIAWIKI_VERSION} (cache v${BUILD_CACHE_VERSION})"
                    else
                        echo "Downloading MediaWiki ${MEDIAWIKI_VERSION}..."
                        curl -fSL "${MW_URL}" -o "${BUILD_DIR}/${MW_TARBALL}"

                        echo "Extracting..."
                        rm -rf "${MW_DIR}"
                        mkdir -p "${MW_DIR}"
                        tar -xzf "${BUILD_DIR}/${MW_TARBALL}" -C "${MW_DIR}" --strip-components=1

                        echo "${CACHE_KEY}" > "${BUILD_DIR}/.mw-version"
                        rm "${BUILD_DIR}/${MW_TARBALL}"
                    fi
                '''
            }
        }

        stage('Install Extensions') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    # Copy our configuration into MediaWiki
                    cp LocalSettings.php "${MW_DIR}/"
                    cp LocalSettings.local.php "${MW_DIR}/"
                    cp .htaccess "${MW_DIR}/"
                    cp robots.txt "${MW_DIR}/"

                    # Copy composer.json as composer.local.json for MediaWiki
                    cp composer.json "${MW_DIR}/composer.local.json"

                    # Install composer dependencies - only if composer.json changed
                    cd "${MW_DIR}"
                    COMPOSER_HASH=$(md5sum composer.local.json | cut -d' ' -f1)
                    CACHED_HASH=""
                    if [ -f ".composer-hash" ]; then
                        CACHED_HASH=$(cat .composer-hash)
                    fi

                    if [ "$COMPOSER_HASH" != "$CACHED_HASH" ] || [ ! -d "vendor" ]; then
                        echo "composer.json changed or vendor missing - running composer update..."
                        rm -f composer.lock
                        rm -rf vendor
                        # Same preparation the Dockerfile does, from the
                        # same script. These two build paths drifted once
                        # already: the fix lived here, the Dockerfile kept a
                        # bare "composer update", and so the local preview
                        # image could not be rebuilt for eight months while
                        # Jenkins went on working. One script, called twice.
                        php "${WORKSPACE}/docker/prepare-composer.php" composer.json composer.local.json
                        composer update --no-dev --optimize-autoloader --ignore-platform-reqs
                        echo "$COMPOSER_HASH" > .composer-hash
                    else
                        echo "composer.json unchanged - using cached vendor/"
                    fi
                '''
            }
        }

        stage('Install Non-Composer Extensions') {
            steps {
                sh '''#!/bin/bash
                    set -e
                    cd "${MW_DIR}/extensions"

                    # YouTube extension (not on Packagist)
                    if [ ! -d "YouTube" ]; then
                        git clone --depth 1 https://github.com/wikimedia/mediawiki-extensions-YouTube.git YouTube
                    fi

                    # MsUpload - drag-and-drop multiple file upload
                    if [ ! -d "MsUpload" ]; then
                        git clone --depth 1 https://github.com/wikimedia/mediawiki-extensions-MsUpload.git MsUpload
                    fi

                    # TimedMediaHandler - video/audio playback with FFmpeg transcoding
                    if [ ! -d "TimedMediaHandler" ]; then
                        git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-TimedMediaHandler.git TimedMediaHandler
                        php "${WORKSPACE}/docker/prepare-composer.php" TimedMediaHandler/composer.json
                        cd TimedMediaHandler && composer install --no-dev && cd ..
                    fi

                    # RSS - embed RSS feeds in wiki pages
                    if [ ! -d "RSS" ]; then
                        git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-RSS.git RSS
                    fi

                    # CodeMirror - syntax highlighting in the editor
                    if [ ! -d "CodeMirror" ]; then
                        git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-CodeMirror.git CodeMirror
                    fi

                    # Echo - notifications for talk page messages, mentions, watchlist changes
                    if [ ! -d "Echo" ]; then
                        git clone --depth 1 --branch REL1_43 https://gerrit.wikimedia.org/r/mediawiki/extensions/Echo.git Echo
                    fi

                    # Thanks - thank editors for contributions (requires Echo)
                    if [ ! -d "Thanks" ]; then
                        git clone --depth 1 --branch REL1_43 https://gerrit.wikimedia.org/r/mediawiki/extensions/Thanks.git Thanks
                    fi

                    # OAuth - "Sign in with PickiPedia" for other cryptograss sites
                    # (magenta first). Its own dependencies (league/oauth2-server,
                    # the JWT libraries) come through its own composer install.
                    if [ ! -d "OAuth" ]; then
                        git clone --depth 1 --branch REL1_43 https://gerrit.wikimedia.org/r/mediawiki/extensions/OAuth.git OAuth
                        php "${WORKSPACE}/docker/prepare-composer.php" OAuth/composer.json
                        cd OAuth && composer install --no-dev --no-interaction && cd ..
                    fi

                    # UserMerge - merge and delete user accounts (for bot cleanup)
                    if [ ! -d "UserMerge" ]; then
                        git clone --depth 1 --branch REL1_43 https://gerrit.wikimedia.org/r/mediawiki/extensions/UserMerge.git UserMerge
                    fi

                    # LinkSuggest - autocomplete when typing [[ or {{ in editor
                    if [ ! -d "LinkSuggest" ]; then
                        git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-LinkSuggest.git LinkSuggest
                    fi

                    # MediaUploader - step-by-step multi-file upload wizard
                    if [ ! -d "MediaUploader" ]; then
                        git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-MediaUploader.git MediaUploader
                        php "${WORKSPACE}/docker/prepare-composer.php" MediaUploader/composer.json
                        cd MediaUploader && composer install --no-dev --no-interaction && cd ..
                    fi
                '''
            }
        }

        stage('Initialize Submodules') {
            steps {
                sh '''#!/bin/bash
                    set -e
                    # Initialize and update git submodules (e.g., RambutanMode extension)
                    if [ -f "${WORKSPACE}/.gitmodules" ]; then
                        echo "Initializing git submodules..."
                        cd "${WORKSPACE}"
                        git submodule update --init --recursive
                    else
                        echo "No submodules to initialize"
                    fi
                '''
            }
        }

        stage('Copy Custom Extensions') {
            steps {
                sh '''#!/bin/bash
                    # Copy any custom extensions we've developed
                    # Use rsync with --checksum to only transfer changed files
                    if [ -d "${WORKSPACE}/extensions" ]; then
                        echo "Copying custom extensions..."
                        rsync -a --checksum "${WORKSPACE}/extensions/" "${MW_DIR}/extensions/"
                    else
                        echo "No custom extensions directory"
                    fi
                '''
            }
        }

        stage('Copy Assets') {
            steps {
                sh '''#!/bin/bash
                    set -e
                    # Copy logo and other assets
                    if [ -d "${WORKSPACE}/assets" ]; then
                        mkdir -p "${MW_DIR}/assets"
                        cp -r "${WORKSPACE}/assets/"* "${MW_DIR}/assets/"
                    fi

                    # Copy diagnostic script if present (for debugging)
                    if [ -f "${WORKSPACE}/diag.php" ]; then
                        cp "${WORKSPACE}/diag.php" "${MW_DIR}/"
                    fi
                '''
            }
        }

        stage('Connectome') {
            // The connectome store and the musician pages' cards (Justin, #connectome, 13 Nov 2026).
            // tools/connectome_sources.txt says what the store reads, and the responses are kept on maybelle,
            // so a build fetches only what's new (the first build, all ~1,450 of them). The store is built again
            // only when its sources, names, readers or arthel's data change; the cards every build, because the
            // featured pickers and the wiki's pages change without a commit here. A failure marks the build
            // unstable and leaves the last cards in place: the wiki still deploys.
            steps {
                catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
                    sh '''#!/bin/bash
                        set -e
                        CACHE="/var/jenkins_home/shared/connectome"
                        OUT="${MW_DIR}/assets/connectome"
                        mkdir -p "${CACHE}/raw" "${CACHE}/lib" "${OUT}"

                        # The big graph's libraries, pinned by hash (checked against npm's packages, 13 Nov 2026),
                        # fetched once: no reader's browser asks another site for them.
                        while read -r name sha url; do
                            f="${CACHE}/lib/${name}"
                            if [ ! -f "${f}" ] || ! echo "${sha}  ${f}" | sha256sum -c --status; then
                                curl -fsSL --retry 3 -o "${f}.part" "${url}"
                                if ! echo "${sha}  ${f}.part" | sha256sum -c --status; then
                                    echo "ERROR: ${name} from ${url} does not match its pinned hash"
                                    rm -f "${f}.part"
                                    exit 1
                                fi
                                mv "${f}.part" "${f}"
                            fi
                            cp "${f}" "${OUT}/${name}"
                        done <<'LIBS'
d3.min.js f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539 https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
sql-wasm.js 558a72c3ab3415d0e6d243cfd23f9d61543600d59054b4b7b8da3cd65f6b9fd4 https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js
sql-wasm.wasm d7e61b828523001f26ce0b3f88dabcf6c12e5e6edf80eb4f08b26ac7b946ff88 https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm
LIBS

                        # PyYAML, for arthel's YAML: the Jenkins image has none. A venv in the cache, pinned by
                        # hash (PyPI's, 6.0.3, 13 Nov 2026), made once per Python version.
                        VENV="${CACHE}/venv-$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
                        if ! "${VENV}/bin/python" -c 'import yaml' 2>/dev/null; then
                            rm -rf "${VENV}"
                            python3 -m venv "${VENV}"
                            cat > "${CACHE}/requirements.txt" <<'REQS'
pyyaml==6.0.3 \
    --hash=sha256:b8bb0864c5a28024fac8a632c443c87c5aa6f215c0b126c449ae1a150412f31d \
    --hash=sha256:10892704fc220243f5305762e276552a0395f7beb4dbf9b14ec8fd43b57f126c \
    --hash=sha256:ba1cc08a7ccde2d2ec775841541641e4548226580ab850948cbfda66a1befcdc \
    --hash=sha256:9149cad251584d5fb4981be1ecde53a1ca46c891a79788c0df828d2f166bda28 \
    --hash=sha256:0f29edc409a6392443abf94b9cf89ce99889a1dd5376d94316ae5145dfedd5d6 \
    --hash=sha256:ee2922902c45ae8ccada2c5b501ab86c36525b883eff4255313a253a3160861c \
    --hash=sha256:d76623373421df22fb4cf8817020cbb7ef15c725b9d5e45f17e189bfc384190f
REQS
                            "${VENV}/bin/pip" install -q --require-hashes -r "${CACHE}/requirements.txt"
                        fi
                        PY="${VENV}/bin/python"

                        # arthel's records and shows, as githouse has its production branch.
                        rm -rf "${CACHE}/arthel"
                        git clone -q --depth 1 --branch production file:///srv/git/arthel.git "${CACHE}/arthel"

                        # The sources: only what the cache lacks. One that fails is fetched next time.
                        cd "${WORKSPACE}/tools"
                        "${PY}" connectome_store.py fetch --raw "${CACHE}/raw" --sources connectome_sources.txt

                        # The store, built again only when something it's built from has changed.
                        KEY=$( { cat connectome_store.py recording_credits.py homeplace.py rambler.py lma_lineup.py connectome_sources.txt connectome_names.txt
                                 git -C "${CACHE}/arthel" rev-parse HEAD
                                 find "${CACHE}/raw" -name '*.json' | sort; } | sha256sum | cut -c1-16 )
                        STORE="${CACHE}/store-${KEY}"
                        if [ ! -f "${STORE}/pairs.json" ]; then
                            rm -rf "${STORE}.part"
                            mkdir -p "${STORE}.part"
                            "${PY}" connectome_store.py build --raw "${CACHE}/raw" --arthel "${CACHE}/arthel/src/data" --lma-names connectome_names.txt --out "${STORE}.part/credits.jsonl" --db "${STORE}.part/connectome.sqlite"
                            "${PY}" connectome_store.py pairs --credits "${STORE}.part/credits.jsonl" --out "${STORE}.part/pairs.json"
                            mv "${STORE}.part" "${STORE}"
                            ls -dt "${CACHE}"/store-* | tail -n +4 | xargs -r rm -rf
                        fi

                        # The cards, from the store and the wiki as it is now; swapped in whole.
                        rm -rf "${CACHE}/cards.part"
                        "${PY}" connectome_card.py --db "${STORE}/connectome.sqlite" --pairs "${STORE}/pairs.json" --wiki https://pickipedia.xyz/ --out "${CACHE}/cards.part"
                        cp "${STORE}/connectome.sqlite" "${OUT}/connectome.sqlite"
                        cp "${CACHE}/cards.part/pairs.json" "${CACHE}/cards.part/names.json" "${CACHE}/cards.part/cards.json" "${OUT}/"
                        rm -rf "${OUT}/cards"
                        mv "${CACHE}/cards.part/cards" "${OUT}/cards"
                        rm -rf "${CACHE}/cards.part"
                        echo "Connectome: $(ls "${OUT}/cards" | wc -l) cards, store ${KEY}"
                    '''
                }
            }
        }

        stage('Copy Chain Data') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    CHAIN_DATA_SOURCE="/var/jenkins_home/shared/chain_data"
                    CHAIN_DATA_DEST="${MW_DIR}/chain-data"

                    if [ -d "${CHAIN_DATA_SOURCE}" ] && [ -f "${CHAIN_DATA_SOURCE}/chainData.json" ]; then
                        echo "Copying chain data from ${CHAIN_DATA_SOURCE}..."
                        mkdir -p "${CHAIN_DATA_DEST}"
                        cp "${CHAIN_DATA_SOURCE}/chainData.json" "${CHAIN_DATA_DEST}/"
                        echo "Chain data copied successfully"
                    else
                        echo "Warning: Chain data not found at ${CHAIN_DATA_SOURCE}"
                        echo "Blue Railroad token data will not be available"
                    fi
                '''
            }
        }

        stage('Copy Tools') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    # The podcast firehose regenerates on a timer on the VPS, so
                    # the script has to live there — Jenkins builds are irregular
                    # and a feed that only refreshes on deploy would go stale for
                    # weeks at a time.
                    #
                    # These land inside the web root because that is what gets
                    # rsynced to the VPS, so .htaccess denies /tools/ to the web.
                    # Nothing here is secret (it is all public on GitHub), but a
                    # wiki should not serve its own build scripts as plain text.
                    mkdir -p "${MW_DIR}/tools"

                    # Both spellings. The scripts are hyphenated because they
                    # are run as commands; the modules they import are
                    # underscored because Python cannot import a hyphen. An
                    # earlier 'podcast-*' matched only the first kind, so
                    # podcast-firehose.py arrived on the VPS without
                    # podcast_config.py or podcast_net.py and died on
                    # ImportError every six hours, into a log nobody was
                    # reading. Tests stay behind; they are not run here.
                    rsync -a --checksum \
                        --include='podcast-*' \
                        --include='podcast_*' \
                        --exclude='*' \
                        "${WORKSPACE}/tools/" "${MW_DIR}/tools/"

                    echo "Tools copied:"
                    ls -1 "${MW_DIR}/tools/"

                    # The firehose imports its own modules, so a missing one is
                    # a broken feed rather than a broken build — which is
                    # exactly how the last gap went unnoticed. Fail here
                    # instead, where somebody is watching.
                    for required in podcast-firehose.py podcast_config.py podcast_net.py; do
                        if [ ! -f "${MW_DIR}/tools/${required}" ]; then
                            echo "ERROR: ${required} did not reach the deploy tree"
                            exit 1
                        fi
                    done

                    # Everything the deployed scripts import must be present, or
                    # they will only say so at 4am on the VPS. Read the imports
                    # rather than keeping a list here: a list is what drifted in
                    # the first place.
                    missing=0
                    for script in "${MW_DIR}"/tools/podcast-*.py; do
                        # No backslash escapes in here. This is a Groovy string
                        # before it is ever a shell script, and Groovy rejects
                        # any escape it does not recognise: a PCRE lookbehind
                        # reset or a shorthand character class is enough to stop
                        # the whole Jenkinsfile parsing, which fails the build
                        # before a line of it runs. Matching the literal prefix
                        # and taking the second field with awk says the same
                        # thing and survives the trip.
                        for module in $(grep '^import podcast_' "$script" | awk '{print $2}'); do
                            if [ ! -f "${MW_DIR}/tools/${module}.py" ]; then
                                echo "ERROR: $(basename "$script") imports ${module}, which was not copied"
                                missing=1
                            fi
                        done
                    done
                    [ "$missing" -eq 0 ] || exit 1
                '''
            }
        }

        stage('Generate Build Info') {
            steps {
                sh '''#!/bin/bash
                    set -e

                    # Fetch current Ethereum mainnet block height from Blockscout
                    echo "Fetching current Ethereum block height..."
                    BLOCK_HEIGHT=$(curl -s "https://eth.blockscout.com/api/v2/blocks?type=block" | grep -o '"height":[0-9]*' | head -1 | cut -d: -f2)

                    if [ -n "$BLOCK_HEIGHT" ] && [ "$BLOCK_HEIGHT" -gt 0 ] 2>/dev/null; then
                        echo "Current block height: ${BLOCK_HEIGHT}"
                    else
                        echo "Warning: Could not fetch block height, using 0"
                        BLOCK_HEIGHT=0
                    fi

                    # Generate build-info.php
                    cat > "${MW_DIR}/build-info.php" << 'PHPEOF'
<?php
// Auto-generated at build time - do not edit
$wgPickipediaBuildInfo = [
    'blockheight' => BLOCK_HEIGHT_PLACEHOLDER,
    'build_number' => 'BUILD_NUMBER_PLACEHOLDER',
    'commit' => 'COMMIT_PLACEHOLDER',
    'build_time' => 'BUILD_TIME_PLACEHOLDER',
];
PHPEOF
                    # Replace placeholders with actual values
                    sed -i "s/BLOCK_HEIGHT_PLACEHOLDER/${BLOCK_HEIGHT}/" "${MW_DIR}/build-info.php"
                    sed -i "s/BUILD_NUMBER_PLACEHOLDER/${BUILD_NUMBER}/" "${MW_DIR}/build-info.php"
                    sed -i "s/COMMIT_PLACEHOLDER/$(git rev-parse --short HEAD)/" "${MW_DIR}/build-info.php"
                    sed -i "s/BUILD_TIME_PLACEHOLDER/$(date -Iseconds)/" "${MW_DIR}/build-info.php"
                    echo "Generated build-info.php with block ${BLOCK_HEIGHT}"
                '''
            }
        }

        stage('Stage for Deploy') {
            // Note: This job only builds production branch (configured in job definition)
            // so no branch conditional needed
            steps {
                sh '''#!/bin/bash
                    set -e

                    STAGE_DIR="/var/jenkins_home/pickipedia_stage"
                    MARKER_FILE="${STAGE_DIR}/.deploy-ready"

                    echo "Staging build to ${STAGE_DIR}..."
                    mkdir -p "${STAGE_DIR}"

                    # Rsync the built MediaWiki to staging
                    rsync -av --delete "${MW_DIR}/" "${STAGE_DIR}/"

                    # Create deploy marker
                    COMMIT_SHA=$(git rev-parse HEAD)
                    echo "commit=${COMMIT_SHA} build=${BUILD_NUMBER} time=$(date -Iseconds)" > "${MARKER_FILE}"

                    echo "Build staged - deploy marker created"
                '''
            }
        }
    }

    post {
        success {
            echo "Build ${BUILD_NUMBER} succeeded"
            echo "MediaWiki ${MEDIAWIKI_VERSION} built at ${MW_DIR}"
        }
        failure {
            echo "Build ${BUILD_NUMBER} failed"
        }
    }
}
