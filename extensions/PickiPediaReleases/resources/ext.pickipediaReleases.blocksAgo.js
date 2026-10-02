/**
 * Moved out of MediaWiki:Common.js, unchanged except where noted below.
 *
 * That page is edited by pasting into a text box: no review, no syntax
 * check, no deploy, and no history beyond wiki revisions. On 15 September
 * 2026 a bad paste there took the whole wiki's JavaScript down for 23
 * minutes. Code that ships with the extension is reviewed, checked by CI
 * (pickipedia#126) and deployed by Jenkins instead.
 *
 * Each of these scripts loads on every page, as it did from Common.js, and
 * returns immediately unless the page it cares about is the one being
 * shown.
 *
 * See cryptograss/pickipedia#124 for the video player, which went first.
 */

/**
 * "X blocks ago" for transcluded templates.
 *
 *   <span class="timeago" data-lastmod-page="Template:NewsShorts"></span>
 *
 * Does nothing unless such a span is on the page.
 */
(function() {
    'use strict';

    // Post-merge average block time is ~12.12 seconds
    var AVG_BLOCK_TIME = 12.12;

    var spans = document.querySelectorAll('.timeago[data-lastmod-page]');
    if (!spans.length) return;

    // Format number with commas (e.g., 1234567 -> "1,234,567")
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Collect unique page titles
    var titles = [];
    spans.forEach(function(span) {
        var t = span.getAttribute('data-lastmod-page');
        if (t && titles.indexOf(t) === -1) titles.push(t);
    });

    // Batch query the API (up to 50 titles per request)
    var api = mw.config.get('wgScriptPath') + '/api.php';
    var url = api + '?action=query&prop=revisions&rvprop=timestamp&format=json&titles=' +
        encodeURIComponent(titles.join('|'));

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
        var pages = data.query && data.query.pages || {};
        var timestamps = {};

        Object.keys(pages).forEach(function(id) {
            var page = pages[id];
            if (page.revisions && page.revisions[0]) {
                timestamps[page.title] = new Date(page.revisions[0].timestamp);
            }
        });

        spans.forEach(function(span) {
            var title = span.getAttribute('data-lastmod-page');
            var ts = timestamps[title];
            if (!ts) {
                span.textContent = '';
                return;
            }
            span.textContent = formatBlocksAgo(ts);
            span.title = ts.toLocaleString();
        });
    });

    function formatBlocksAgo(date) {
        var secondsAgo = Math.floor((Date.now() - date.getTime()) / 1000);
        var blocksAgo = Math.round(secondsAgo / AVG_BLOCK_TIME);

        if (blocksAgo < 1) {
            return 'this block';
        } else if (blocksAgo === 1) {
            return '1 block ago';
        } else {
            return formatNumber(blocksAgo) + ' blocks ago';
        }
    }
})();
