/**
 * HLS video player for IPFS-hosted releases.
 *
 * Moved here from MediaWiki:Common.js in September 2026. It lived on a wiki
 * page for its whole life, which meant every change was a person pasting
 * several hundred lines into a text box: no review, no tests, live for every
 * visitor the moment it was saved. A bad paste took the whole site's
 * JavaScript down for 23 minutes on 15 September — including four unrelated
 * features sharing that page. Here it ships like everything else.
 *
 * Usage in wikitext (via Template:HLSVideo):
 *   <div class="hls-video-player" data-cid="QmXet6..."></div>
 */

/**
 * HLS Video Player - Initializes HLS.js for IPFS-hosted videos
 *
 * Usage in wikitext (via Template:HLSVideo):
 *   <div class="hls-video-player" data-cid="QmXet6..."></div>
 *
 * The gadget loads hls.js and initializes players for any element
 * with the hls-video-player class and a data-cid attribute.
 *
 * Supports both HLS streams (CID/master.m3u8) and raw video files.
 * Tries HLS first; if the manifest 404s, falls back to direct playback.
 */
(function() {
    'use strict';

    var IPFS_GATEWAY = 'https://ipfs.delivery-kid.cryptograss.live/ipfs';
    // Pinned, and checked by its hash: '@latest' ran whatever the CDN served
    // that day on every page with a video, signed-in editors' included.
    // Moving it is a deliberate edit: the new version, and its sha384.
    var HLS_JS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
    var HLS_JS_INTEGRITY = 'sha384-cciJ0zi8d1uMKC2zJd7jvPY4HQt7W4ByUI/FlMkltvBi31aW61rcpVBhpmW8/NwX';
    var hlsLoadPromise = null;

    // CIDv1 (bafy...) is Base32 lowercase, but MediaWiki capitalizes page titles.
    // CIDv0 (Qm...) is Base58 case-sensitive — must not be lowercased.
    function normalizeCid(cid) {
        if (cid && cid.substring(0, 4) === 'Bafy') {
            return cid.toLowerCase();
        }
        return cid;
    }

    function loadHls() {
        if (typeof Hls !== 'undefined') {
            return Promise.resolve();
        }
        if (hlsLoadPromise) {
            return hlsLoadPromise;
        }
        hlsLoadPromise = new Promise(function(resolve) {
            var script = document.createElement('script');
            script.src = HLS_JS_URL;
            script.integrity = HLS_JS_INTEGRITY;
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            // Not loaded (blocked, or the hash didn't match): initPlayer finds
            // no Hls and takes the native or direct path, as before.
            script.onerror = resolve;
            document.head.appendChild(script);
        });
        return hlsLoadPromise;
    }



// Accepts raw seconds (872), "14:32", or "1:02:03". Anything unparseable
    // means "start at the beginning" rather than throwing — a typo in a
    // citation should still play the video.
    function parseTimecode(raw) {
        if (!raw) { return 0; }
        var parts = String(raw).trim().split(':');
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === '' || isNaN(Number(parts[i]))) { return 0; }
        }
        return parts.reduce(function (acc, p) { return acc * 60 + Number(p); }, 0);
    }

    // Seek once the browser knows how long the video is.
    //
    // All three playback paths below — Safari's native HLS, hls.js, and the
    // direct-file fallback — end up attached to a real <video>, so hanging one
    // listener on the element covers every case. Seeking earlier than
    // loadedmetadata is unreliable: with hls.js the manifest may not be parsed
    // yet and the seek is silently dropped.
    function seekWhenReady(video, seconds) {
        if (!seconds) { return; }
        video.addEventListener('loadedmetadata', function onMeta() {
            video.removeEventListener('loadedmetadata', onMeta);
            // A citation pointing past the end should land on the last frame
            // rather than being ignored outright.
            video.currentTime = isFinite(video.duration)
                ? Math.min(seconds, video.duration)
                : seconds;
        });
    }

    // A #t= fragment in the URL seeks the player too, which is what makes a
    // {{Src|video|...|t=14:32}} citation land the reader on the assertion
    // rather than at 0:00 of a forty-minute set.
    function timecodeFromHash() {
        var m = /[#&]t=([0-9:]+)/.exec(window.location.hash || '');
        return m ? parseTimecode(m[1]) : 0;
    }

    function initPlayers() {
        var containers = document.querySelectorAll('.hls-video-player[data-cid]:not([data-initialized])');
        if (!containers.length) return;

        // Mark ALL containers immediately to prevent race conditions
        containers.forEach(function(c) {
            c.setAttribute('data-initialized', 'true');
        });

        // Then load hls.js and initialize
        loadHls().then(function() {
            containers.forEach(initPlayer);
        });
    }

    function createVideoElement(width, maxWidth) {
        var video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.style.width = width;
        video.style.maxWidth = maxWidth;
        video.style.backgroundColor = '#000';
        video.style.display = 'block';
        return video;
    }

    // Can this browser actually decode AV1? Apple ships no software AV1
    // decoder, so Safari plays it only on M3/A17-and-later hardware; Chrome
    // and Firefox bundle dav1d and manage it anywhere. Everything published
    // through delivery-kid since Sept 2026 is AV1, so "can't play" is far
    // more often a decoder gap than a missing file.
    function canDecodeAV1() {
        var type = 'video/mp4; codecs="av01.0.05M.08"';
        try {
            if (window.MediaSource && window.MediaSource.isTypeSupported) {
                return window.MediaSource.isTypeSupported(type);
            }
            return document.createElement('video').canPlayType(type) !== '';
        } catch (e) {
            return false;
        }
    }

    // Name a rendition by the short side of its picture: an upright phone
    // video published at 1080x1920 is "1080p" exactly as a landscape one is at
    // 1920x1080. Levels carrying no picture at all are the audio-only stream.
    function levelLabel(level) {
        var w = level && level.width, h = level && level.height;
        if (!w || !h) {
            return 'Audio only';
        }
        return Math.min(w, h) + 'p';
    }

    // Remember the viewer's choice across videos and visits. Someone on a
    // phone tether picks "Audio only" once and means it for the evening, not
    // for one embed. Storage can throw (private windows), and a remembered
    // rendition may not exist on the next video, so every read is guarded.
    var QUALITY_KEY = 'pickipedia-video-quality';

    function rememberedQuality() {
        try {
            return window.localStorage.getItem(QUALITY_KEY) || 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function rememberQuality(value) {
        try {
            window.localStorage.setItem(QUALITY_KEY, value);
        } catch (e) {
            // Nothing to do — the selector still works for this page view.
        }
    }

    // A row of buttons under the video: Auto, then each rendition largest
    // first, then Audio only. hls.js chooses by bandwidth on its own; this is
    // for the times a person wants to overrule it — to save data deliberately,
    // or to stop it switching around mid-tune.
    //
    // "Audio only" can't be a level switch: hls.js cannot take the picture out
    // of a stream that is already playing, so it fetched one audio segment and
    // quietly went back to 1080p. It loads the audio stream's own playlist
    // instead, and choosing a picture again reloads the master playlist at
    // that level -- both from the same moment, still playing if it was.
    function addQualitySelector(container, video, player) {
        var hls = player.hls;
        var levels = hls.levels || [];
        if (levels.length < 2) {
            return;   // nothing to choose between
        }

        var bar = document.createElement('div');
        bar.className = 'hls-quality-bar';
        bar.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;'
                          + 'margin-top:6px; font-size:0.85em;';

        var label = document.createElement('span');
        label.textContent = 'Quality:';
        label.style.cssText = 'opacity:0.7; margin-right:2px;';
        bar.appendChild(label);

        // Largest first, so the order reads the way people expect.
        var order = levels.map(function(level, index) {
            return { index: index, level: level };
        }).sort(function(a, b) {
            return ((b.level.height || 0) * (b.level.width || 0))
                 - ((a.level.height || 0) * (a.level.width || 0));
        });

        var choices = [{ value: 'auto', text: 'Auto', index: -1 }];
        order.forEach(function(entry) {
            choices.push({
                value: levelLabel(entry.level),
                text: levelLabel(entry.level),
                index: entry.index,
                level: entry.level
            });
        });

        var buttons = [];

        function paint(activeValue) {
            buttons.forEach(function(button) {
                var on = button.getAttribute('data-value') === activeValue;
                button.style.fontWeight = on ? '700' : '400';
                button.style.background = on ? '#eaf3ff' : '#fff';
                button.style.borderColor = on ? '#36c' : '#a2a9b1';
                button.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }

        choices.forEach(function(choice) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = choice.text;
            button.setAttribute('data-value', choice.value);
            button.style.cssText = 'padding:2px 8px; cursor:pointer; border:1px solid #a2a9b1;'
                                + 'border-radius:2px; background:#fff; font-size:inherit;';
            button.addEventListener('click', function() {
                choose(choice);
                rememberQuality(choice.value);
                paint(choice.value);
            });
            buttons.push(button);
            bar.appendChild(button);
        });

        function choose(choice) {
            if (choice.value === 'Audio only') {
                if (!player.audioOnly) {
                    player.audioOnly = true;
                    var url = choice.level.uri || [].concat(choice.level.url)[0];
                    player.reload(url, -1);
                }
                return;
            }
            if (player.audioOnly) {
                player.audioOnly = false;
                player.reload(player.src, choice.index);
                return;
            }
            // -1 is hls.js's "pick for me"; a level is switched to at once.
            player.hls.currentLevel = choice.index;
        }

        container.appendChild(bar);

        // Apply what this viewer chose last time, if this video has it.
        var wanted = rememberedQuality();
        var match = choices.filter(function(choice) {
            return choice.value === wanted;
        })[0];
        if (match && match.index !== -1) {
            choose(match);
        }
        paint(match ? match.value : 'auto');
    }

    // delivery-kid's ASCII portrait, from its page's infobox: asked for once
    // per page view, the first time someone hovers over a video.
    var dkArtPromise = null;

    function deliveryKidArt() {
        if (dkArtPromise) {
            return dkArtPromise;
        }
        var script = (typeof mw !== 'undefined' && mw.config.get('wgScript')) || '/index.php';
        dkArtPromise = fetch(script + '?title=Cryptograss:Delivery-kid&action=raw')
            .then(function(resp) { return resp.ok ? resp.text() : ''; })
            .then(function(text) {
                var m = /\|\s*image\s*=\s*<pre[^>]*>\n?([\s\S]*?)<\/pre>/.exec(text);
                return m ? m[1].replace(/^\n+/, '').replace(/\s+$/, '') : '';
            })
            .catch(function() { return ''; });
        return dkArtPromise;
    }

    // Shown over the video on hover (the stylesheet does the showing); it
    // never takes a click.
    function addDeliveryKidMark(container) {
        var mask = document.createElement('div');
        mask.className = 'hls-dk-mask';
        mask.setAttribute('aria-hidden', 'true');
        var words = document.createElement('span');
        var name = document.createElement('b');
        name.textContent = 'delivery-kid';
        var where = document.createElement('small');
        where.textContent = 'pinned on IPFS';
        words.appendChild(name);
        words.appendChild(where);
        mask.appendChild(words);
        container.appendChild(mask);
        container.addEventListener('mouseenter', function() {
            deliveryKidArt().then(function(art) {
                if (!art || mask.querySelector('pre')) {
                    return;
                }
                var pre = document.createElement('pre');
                pre.textContent = art;
                mask.insertBefore(pre, words);
            });
        }, { once: true });
    }

    // One honest failure message. The old text blamed IPFS unconditionally,
    // which sent people debugging storage for what was usually a codec
    // problem — and said "may not be available" about content that was
    // demonstrably being served.
    function showPlaybackError(container, cid) {
        var url = IPFS_GATEWAY + '/' + normalizeCid(cid) + '/master.m3u8';
        var html;
        if (!canDecodeAV1()) {
            html = '<p style="padding:1em; border:1px solid #ac6600; background:#fef6e7;">'
                 + '<strong>This browser cannot play this video.</strong><br>'
                 + 'It is encoded in AV1 — a royalty-free format, which is why we use it. '
                 + 'Apple ships no software AV1 decoder, so Safari plays it only on M3 or newer Macs '
                 + 'and iPhone 15 Pro or newer.<br><br>'
                 + '<strong>Firefox and Chrome play it on any desktop</strong>, including older Intel Macs. '
                 + 'Or download it and play it in VLC.<br>'
                 + '<a href="' + url + '" rel="nofollow">' + url + '</a>'
                 + '</p>';
        } else {
            html = '<p style="padding:1em; border:1px solid #b32424; background:#fee;">'
                 + '<strong>Could not load this video.</strong><br>'
                 + 'Your browser can decode AV1, so this is more likely a fetch or gateway problem '
                 + 'than a codec one. Try the stream directly — if this link works, the content is '
                 + 'present and the fault is in playback rather than availability:<br>'
                 + '<a href="' + url + '" rel="nofollow">' + url + '</a>'
                 + '</p>';
        }
        container.innerHTML = html;
    }

function fallbackToDirectVideo(container, cid, width, maxWidth, startSeconds) {
        // CID is a raw video file, not an HLS stream — play directly
        var directUrl = IPFS_GATEWAY + '/' + normalizeCid(cid);
        container.innerHTML = '';
        var video = createVideoElement(width, maxWidth);
        video.src = directUrl;
        video.addEventListener('error', function() {
            showPlaybackError(container, cid);
        });
        seekWhenReady(video, startSeconds);
        container.appendChild(video);
        addDeliveryKidMark(container);
    }

function initPlayer(container) {
        var cid = container.getAttribute('data-cid');
        var normalCid = normalizeCid(cid);
        var width = container.getAttribute('data-width') || '100%';
        var maxWidth = container.getAttribute('data-max-width') || '800px';

        // data-start wins over the URL fragment: an embed that explicitly asks
        // for a moment means it, whereas the fragment is a property of how the
        // reader arrived and should not override the page's own intent.
        var startSeconds = parseTimecode(container.getAttribute('data-start'))
            || timecodeFromHash();

        var hlsSrc = IPFS_GATEWAY + '/' + normalCid + '/master.m3u8';

        var video = createVideoElement(width, maxWidth);

        // A still from the video, pinned alongside it under the same CID, so
        // the player shows the thing rather than a black rectangle before
        // anyone presses play. It is a JPEG, which means it also renders on
        // browsers that cannot decode the AV1 behind it — a Safari user
        // without hardware AV1 at least sees what they are being offered.
        //
        // Releases pinned before posters existed simply have no poster.jpg.
        // A video element whose poster 404s falls back to its normal empty
        // state rather than showing a broken image, so this is safe to set
        // unconditionally.
        video.poster = IPFS_GATEWAY + '/' + normalCid + '/poster.jpg';
        seekWhenReady(video, startSeconds);
        container.appendChild(video);

        // hls.js first, native HLS second.
        //
        // The order used to be the other way round, on the assumption that
        // only Safari claims to play HLS natively. Chrome answers "maybe" to
        // that question too and does play these streams — so Chrome took the
        // native path, where the renditions are invisible to us: no quality
        // selector, and an error we can only guess at. Through hls.js we can
        // see the ladder, offer a choice, and tell a decoder failure apart
        // from a missing playlist.
        //
        // Native remains the fallback for anything hls.js cannot drive
        // (no Media Source Extensions), which includes iOS Safari.
        addDeliveryKidMark(container);

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            // The stream playing now: replaced when someone picks Audio only
            // or comes back from it (see addQualitySelector).
            var player = { hls: null, src: hlsSrc, audioOnly: false };
            player.attach = function(url, options) {
                var instance = new Hls(options || {});
                player.hls = instance;
                instance.on(Hls.Events.ERROR, function(event, data) {
                    if (data.fatal && instance === player.hls) {
                        onFatal(instance, data);
                    }
                });
                instance.loadSource(url);
                instance.attachMedia(video);
                return instance;
            };
            player.reload = function(url, level) {
                var at = video.currentTime;
                var playing = !video.paused;
                player.hls.destroy();
                var instance = player.attach(url, { startPosition: at, startLevel: level });
                instance.on(Hls.Events.MANIFEST_PARSED, function() {
                    if (level >= 0) {
                        instance.currentLevel = level;   // chosen, not just started at
                    }
                    if (playing) {
                        video.play().catch(function() {});
                    }
                });
            };
            var hls = player.attach(hlsSrc);
            // The renditions are only known once the master playlist is
            // parsed, so the selector is built then rather than up front.
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                try {
                    addQualitySelector(container, video, player);
                } catch (e) {
                    // A broken selector must never cost anyone the video.
                }
            });
            var onFatal = function(hls, data) {
                if (data.fatal) {
                    hls.destroy();
                    // A media-type fatal on a browser without AV1 is a decoder
                    // gap, not a missing playlist. Say so rather than falling
                    // through to a direct-video attempt that cannot succeed.
                    var mediaFatal = data.type === Hls.ErrorTypes.MEDIA_ERROR;
                    if (mediaFatal && !canDecodeAV1()) {
                        showPlaybackError(container, cid);
                        return;
                    }
                    // Otherwise the usual cause is that this CID is a plain
                    // video file rather than an HLS directory.
                    fallbackToDirectVideo(container, cid, width, maxWidth, startSeconds);
                }
            };
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS. The browser picks the rendition itself, so there is
            // nothing to offer a selector over.
            //
            // If the browser has no AV1 decoder there is no point chasing the
            // CID as a raw file: it is an HLS directory, that request fails
            // too, and the reader is told the content is missing when the
            // real answer is "this browser cannot decode it".
            video.src = hlsSrc;
            video.addEventListener('error', function() {
                if (!canDecodeAV1()) {
                    showPlaybackError(container, cid);
                    return;
                }
                fallbackToDirectVideo(container, cid, width, maxWidth, startSeconds);
            });
        } else {
            // No HLS support — try direct video
            fallbackToDirectVideo(container, cid, width, maxWidth, startSeconds);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPlayers);
    } else {
        initPlayers();
    }

    if (typeof mw !== 'undefined' && mw.hook) {
        mw.hook('wikipage.content').add(function($content) {
            initPlayers();
        });
    }
})();
