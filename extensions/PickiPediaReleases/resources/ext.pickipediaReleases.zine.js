/**
 * User-subpage zine: the parts that need a browser.
 *
 * The server (src/Zine.php) sends the page already styled, with the logo,
 * topbar, hero and toggle in place. What's left here:
 *
 *   - the light/dark toggle, remembered in a cookie so the server can send
 *     the next page dark from the start, and in localStorage as before;
 *   - a reader who chose dark under the old Common.js has it only in
 *     localStorage, so carry that over once;
 *   - optional .pp-dek-source / .pp-kicker-source elements in a post, moved
 *     into the hero as the old script did.
 */
(function () {
  'use strict';

  var body = document.body;
  if (!body.classList.contains('pickipedia-userpost')) return;

  var STORAGE_KEY = 'pickipedia-mode';
  var COOKIE = 'pickipedia-mode';
  var ONE_YEAR = 365 * 24 * 60 * 60;

  function remember(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
    document.cookie = COOKIE + '=' + mode + '; path=/; max-age=' + ONE_YEAR + '; samesite=lax';
  }

  var toggle = document.querySelector('.pickipedia-mode.pp-server');

  function show(dark) {
    body.classList.toggle('pickipedia-dark', dark);
    if (toggle) toggle.textContent = dark ? '☼ Light' : '☾ Dark';
  }

  // Carried over from localStorage, for readers who chose before the cookie.
  if (document.cookie.indexOf(COOKIE + '=') === -1) {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved === 'dark' || saved === 'light') {
      remember(saved);
      show(saved === 'dark');
    }
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var dark = !body.classList.contains('pickipedia-dark');
      show(dark);
      remember(dark ? 'dark' : 'light');
    });
  }

  var hero = document.querySelector('.pickipedia-hero.pp-server');
  if (!hero) return;

  var kickerEl = document.querySelector('.mw-parser-output .pp-kicker-source');
  var kicker = hero.querySelector('.pp-kicker');
  if (kickerEl && kicker) {
    kicker.textContent = kickerEl.textContent.trim();
    kickerEl.remove();
  }

  var dekEl = document.querySelector('.mw-parser-output .pp-dek-source');
  if (dekEl) {
    var dek = document.createElement('p');
    dek.className = 'pp-dek';
    dek.innerHTML = dekEl.innerHTML;
    // Masthead: under the title, inside its wrapper. Letter: after the kicker.
    var titlewrap = hero.querySelector('.pp-titlewrap');
    if (titlewrap) titlewrap.appendChild(dek);
    else hero.appendChild(dek);
    dekEl.remove();
  }
}());
