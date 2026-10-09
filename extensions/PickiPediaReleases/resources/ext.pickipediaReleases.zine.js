/**
 * User-subpage zine styling: corner logo, topbar, hero, light/dark toggle.
 *
 * Moved from MediaWiki:Common.js, with its stylesheet from
 * MediaWiki:Common.css (ext.pickipediaReleases.zine.css), so the feature has
 * one home and changes to it are reviewed. Loaded only on User: subpages,
 * by Hooks::onBeforePageDisplay.
 */
/* ============================================================
 * Pickipedia — User-subpage zine/Substack styling
 *
 * Layout:
 *   - corner logo (absolute-positioned upper-left of viewport,
 *     OUTSIDE all wiki wrappers — does not push content down)
 *   - non-sticky topbar (just nav) at top of body
 *   - hero block with title (top), then USER:Username kicker below,
 *     optional dek + meta
 *   - light/dark mode toggle (persisted in localStorage)
 *
 * Variant from HTML comment marker `pickipedia:variant=letter|masthead`
 * or category membership; default letter.
 * ============================================================ */

(function () {
  'use strict';

  if (typeof mw === 'undefined' || !mw.config) return;

  // Until MediaWiki:Common.js loses its copy of this code, both would run and
  // every user subpage would get two logos, two heroes and two toggles. So
  // wait for the site script, and stand down if it has already done the job.
  // Once Common.js is empty this costs nothing and can be removed.
  mw.loader.using('site').always(function () {
    if (document.querySelector('.pp-corner-logo')) return;
    run();
  });

  function run() {
    var nsNumber = mw.config.get('wgNamespaceNumber');
    var pageName = mw.config.get('wgPageName') || '';
    var title    = mw.config.get('wgTitle') || '';
    var action   = mw.config.get('wgAction') || 'view';

    if (nsNumber !== 2) return;
    if (action !== 'view') return;
    if (title.indexOf('/') === -1) return;

    var slash    = title.indexOf('/');
    var username = title.slice(0, slash).replace(/_/g, ' ');
    var subpage  = title.slice(slash + 1).replace(/_/g, ' ');

    var body = document.body;
    body.classList.add('pickipedia-userpost');

    var variant = 'letter';
    var content = document.querySelector('.mw-parser-output');
    if (content) {
      var html = content.innerHTML || '';
      var m = html.match(/pickipedia:variant\s*=\s*(letter|masthead)/i);
      if (m) variant = m[1].toLowerCase();
    }
    var cats = mw.config.get('wgCategories') || [];
    if (cats.indexOf('Masthead style') !== -1) variant = 'masthead';
    if (cats.indexOf('Letter style') !== -1) variant = 'letter';
    body.classList.add('pickipedia-variant-' + variant);

    var STORAGE_KEY = 'pickipedia-mode';
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved === 'dark') body.classList.add('pickipedia-dark');

    var LOGO_URL = '/images/thumb/8/80/Pickipedia-quarter-transparent.png/400px-Pickipedia-quarter-transparent.png';

    // ---------- Corner logo: stand-alone body child, absolute-positioned. ----------
    var cornerLogo = document.createElement('a');
    cornerLogo.className = 'pp-corner-logo';
    cornerLogo.href = '/wiki/Main_Page';
    cornerLogo.title = 'PickiPedia home';
    cornerLogo.innerHTML = '<img src="' + LOGO_URL + '" alt="PickiPedia">';
    document.body.insertBefore(cornerLogo, document.body.firstChild);

    // ---------- Topbar (nav only) ----------
    var topbar = document.createElement('header');
    topbar.className = 'pickipedia-topbar';
    topbar.innerHTML =
      '<nav class="pickipedia-topbar-nav">' +
        '<a href="' + mw.util.getUrl(pageName, { action: 'edit' }) + '">edit</a>' +
        '<a href="' + mw.util.getUrl(pageName, { action: 'history' }) + '">history</a>' +
        '<a href="' + mw.util.getUrl('Talk:' + pageName) + '">talk</a>' +
      '</nav>';
    document.body.insertBefore(topbar, cornerLogo.nextSibling);

    // ---------- Hero ----------
    if (content) {
      var dek = '';
      var dekEl = content.querySelector('.pp-dek-source');
      if (dekEl) {
        dek = dekEl.innerHTML;
        dekEl.remove();
      }

      var kickerHtml = '<a href="' + mw.util.getUrl('User:' + username.replace(/ /g, '_')) +
                       '">User:' + escapeHtml(username) + '</a>';
      var kickerEl = content.querySelector('.pp-kicker-source');
      if (kickerEl) {
        kickerHtml = escapeHtml(kickerEl.textContent.trim());
        kickerEl.remove();
      }

      var lastMod = '';
      var lastModEl = document.getElementById('footer-info-lastmod');
      if (lastModEl) lastMod = lastModEl.textContent.replace(/^\s*This page was last (edited|modified) on\s*/i, '').trim();

      var hero = document.createElement('header');
      hero.className = 'pickipedia-hero';

      if (variant === 'masthead') {
        hero.innerHTML =
          '<div class="pp-topbar">' +
            '<div class="pp-kicker">' + kickerHtml + '</div>' +
            '<div class="pp-topbar-rule"></div>' +
            (lastMod ? '<div class="pp-topbar-vol">' + escapeHtml(lastMod) + '</div>' : '') +
          '</div>' +
          '<div class="pp-titlewrap">' +
            '<h1 class="pp-title">' + escapeHtml(subpage) + '</h1>' +
            (dek ? '<p class="pp-dek">' + dek + '</p>' : '') +
          '</div>';
      } else {
        // Letter variant: title first, then kicker, then optional dek/meta.
        hero.innerHTML =
          '<h1 class="pp-title">' + escapeHtml(subpage) + '</h1>' +
          '<div class="pp-kicker">' + kickerHtml + '</div>' +
          (dek ? '<p class="pp-dek">' + dek + '</p>' : '') +
          (lastMod ? '<div class="pp-meta">Last edited ' + escapeHtml(lastMod) + '</div>' : '');
      }
      content.parentNode.insertBefore(hero, content);
    }

    // ---------- Light/dark toggle ----------
    var toggle = document.createElement('button');
    toggle.className = 'pickipedia-mode';
    toggle.type = 'button';
    toggle.textContent = body.classList.contains('pickipedia-dark') ? '☼ Light' : '☾ Dark';
    toggle.addEventListener('click', function () {
      var dark = body.classList.toggle('pickipedia-dark');
      toggle.textContent = dark ? '☼ Light' : '☾ Dark';
      try { localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light'); } catch (e) {}
    });
    document.body.appendChild(toggle);

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      }
  }
}());
