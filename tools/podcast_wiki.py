#!/usr/bin/env python3
"""
A small authenticated MediaWiki write client, for the import bot.

Standard library only, like everything else in this directory. The tools here
are copied to the wiki VPS by the Jenkinsfile's Copy Tools stage and run there
by cron against the system python, so a third-party dependency is a deployment
problem rather than a convenience. blue-railroad-import can use mwclient
because it is a packaged project with its own environment; this is not.

Credentials come from the environment, never from arguments:

    PICKIPEDIA_BOT_USER      e.g. "Podcast Imports@episodes"
    PICKIPEDIA_BOT_PASSWORD

Arguments are visible to every other process on the box through ps, which is
a poor place for a bot password. Use a MediaWiki BotPassword rather than the
account's own login, so the grant can be narrowed to editing and revoked on
its own.
"""

import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_API = "https://pickipedia.xyz/api.php"
USER_AGENT = "PickiPedia Podcast Import Bot/1.0 (+https://pickipedia.xyz)"
TIMEOUT = 45

# The wiki answers a burst of edits with HTTP 429 apierror-ratelimited. It is
# not a failure, it is a request to slow down, so wait and mean it.
RETRY_BACKOFF = (3, 10, 30, 60)


class WikiError(RuntimeError):
    pass


class LoginRequired(WikiError):
    pass


class WrongIdentity(WikiError):
    """The logged-in account is not the one this job should run as."""
    pass


class Wiki:
    """
    Enough of the MediaWiki API to read a page and save one.

    Deliberately small. This bot creates and updates episode pages and does
    nothing else; anything more belongs in a real client library.
    """

    def __init__(self, api_url=DEFAULT_API, user=None, password=None):
        self.api_url = api_url
        self.user = user or os.environ.get("PICKIPEDIA_BOT_USER")
        self._password = password or os.environ.get("PICKIPEDIA_BOT_PASSWORD")
        self._csrf = None
        jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar))

    # -- transport ---------------------------------------------------------

    def _call(self, params, post=None):
        params = {**params, "format": "json", "formatversion": "2"}
        url = f"{self.api_url}?{urllib.parse.urlencode(params)}"
        data = urllib.parse.urlencode(post).encode() if post is not None else None
        request = urllib.request.Request(url, data=data,
                                         headers={"User-Agent": USER_AGENT})
        with self._opener.open(request, timeout=TIMEOUT) as response:
            return json.load(response)

    def _call_with_backoff(self, params, post=None):
        """Retry the throttle, surface everything else immediately."""
        for pause in (0,) + RETRY_BACKOFF:
            if pause:
                time.sleep(pause)
            try:
                result = self._call(params, post)
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                continue
            error = result.get("error", {})
            if error.get("code") in ("ratelimited", "maxlag", "readonly"):
                continue
            return result
        raise WikiError("still throttled after backing off")

    # -- session -----------------------------------------------------------

    def login(self):
        """
        Log in with a BotPassword and take a csrf token.

        @raise LoginRequired: if credentials are absent or rejected.
        """
        if not self.user or not self._password:
            # Say which one is missing. "Set both of these" is unhelpful when
            # you have just set both of them and one is empty, or spelled
            # slightly differently, or lost to a subshell.
            missing = [name for name, value in (
                ("PICKIPEDIA_BOT_USER", self.user),
                ("PICKIPEDIA_BOT_PASSWORD", self._password),
            ) if not value]
            raise LoginRequired(
                f"no credentials: {' and '.join(missing)} "
                f"{'is' if len(missing) == 1 else 'are'} unset or empty. "
                f"Set them, or read them from the vault with: "
                f'eval "$(maybelle-config/maybelle/scripts/podcast-bot-env.sh)"')

        tokens = self._call({"action": "query", "meta": "tokens",
                             "type": "login"})
        login_token = tokens["query"]["tokens"]["logintoken"]

        result = self._call({"action": "login"}, post={
            "lgname": self.user,
            "lgpassword": self._password,
            "lgtoken": login_token,
        })
        status = result.get("login", {})
        if status.get("result") != "Success":
            # Never echo the reason verbatim; MediaWiki sometimes includes the
            # submitted name, and this ends up in logs.
            raise LoginRequired(
                f"login rejected for {self.user!r}: {status.get('result')}")

        self._refresh_csrf()
        return self

    def _refresh_csrf(self):
        """
        Take a fresh edit token.

        A CSRF token is tied to the session that issued it, and does not stay
        valid indefinitely. Fetching one at login and using it an hour later —
        which is what a long survey pass before the first write amounts to —
        earns a badtoken on every edit. So this is called again whenever the
        wiki says the token is stale.
        """
        result = self._call({"action": "query", "meta": "tokens",
                             "type": "csrf"})
        self._csrf = result["query"]["tokens"]["csrftoken"]
        return self._csrf

    def whoami(self):
        """@return: (username, groups) as the wiki sees this session."""
        result = self._call({"action": "query", "meta": "userinfo",
                             "uiprop": "groups"})
        info = result.get("query", {}).get("userinfo", {})
        return info.get("name"), info.get("groups", [])

    def require_group(self, group, because=""):
        """
        Refuse to continue unless the session belongs to a given group.

        Written for import bots. An account outside exempt-from-verification is
        a reviewing identity: its edits are wrapped as proposals and filed for
        somebody to read. Bulk machine output under such an account floods that
        queue and signs transcription with a name that implies judgement — so
        stop at the first request rather than several hundred pages later.

        @return: the account name, when it qualifies.
        @raise WrongIdentity: when it does not.
        """
        name, groups = self.whoami()
        if group not in groups:
            raise WrongIdentity(
                f"refusing to run as {name!r}: not in {group}. "
                f"groups: {', '.join(groups) or 'none'}."
                + (f" {because}" if because else "")
            )
        return name

    # -- pages -------------------------------------------------------------

    def get_text(self, title):
        """@return: page wikitext, or None if the page does not exist."""
        text, _ = self.get_text_and_last_editor(title)
        return text

    def resolve(self, title):
        """
        Follow a redirect to the page it points at.

        Identity on this wiki is the page, and a page can be renamed: a
        composition first written as "Song:Barlows Jig" becomes "Song:Barlows"
        when somebody checks the record sleeve, leaving a redirect behind.
        An importer that ignores redirects would then write its data to the
        redirect, blanking it, and the two copies would drift apart.

        Following one is how the wiki gets to own its own names — which is the
        point of not keeping a foreign key from wherever the data came from.

        @param title: the page asked for.
        @return: the title it resolves to, or the original when nothing
            redirects and when the wiki cannot say.
        """
        result = self._call({
            "action": "query", "titles": title, "redirects": "1",
        })
        query = result.get("query", {})
        for hop in query.get("redirects", []):
            if hop.get("from") == title and hop.get("to"):
                return hop["to"]
        return title

    def get_text_and_last_editor(self, title):
        """
        The page, and who wrote the revision now on it.

        Both in one request: an importer that reads several hundred pages a
        night and then asks separately who touched them doubles its traffic to
        learn something the same revision already knows.

        @return: (wikitext, username), or (None, None) if the page is missing.
            The username is None when the wiki withholds it, which it does for
            a revision whose author has been suppressed.
        """
        result = self._call({
            "action": "query", "prop": "revisions", "titles": title,
            "rvprop": "content|user", "rvslots": "main",
        })
        pages = result.get("query", {}).get("pages", [])
        if not pages or pages[0].get("missing"):
            return None, None
        revision = pages[0]["revisions"][0]
        return revision["slots"]["main"]["content"], revision.get("user")

    def survey(self, titles, batch=50):
        """
        Ask, for many pages at once, what is on them and who put it there.

        The answer is a content hash rather than the content: MediaWiki stores
        a sha1 of each revision's text, so a page can be compared against text
        we already hold without anybody sending the page. Several hundred
        pages become a handful of small requests, which is what lets a nightly
        run stay quick over an ordinary internet connection — the old
        page-at-a-time survey spent its whole life waiting for round trips.

        Fetch the text only for pages this says have changed.

        @param titles: page titles.
        @param batch: titles per request. 50 is the API's limit for an
            ordinary account; a bot may use 500, but the saving from here on
            is small and the smaller request is kinder to a shared wiki.
        @return: {title: {"sha1": str|None, "user": str|None, "missing": bool}},
            keyed by the titles as given. A title the wiki said nothing about
            is left out, and should be read the slow way.
        """
        found = {}
        titles = list(titles)
        for start in range(0, len(titles), batch):
            chunk = titles[start:start + batch]
            result = self._call_with_backoff({
                "action": "query", "prop": "revisions",
                "titles": "|".join(chunk), "rvprop": "sha1|user",
            })
            query = result.get("query", {})

            # MediaWiki answers under its own spelling of a title — underscores
            # become spaces, the first letter is capitalised, runs of spaces
            # collapse. Map its spelling back to ours, or every page looks
            # missing and the run recreates the whole wiki.
            ours = {item["to"]: item["from"] for item in query.get("normalized", [])}

            for page in query.get("pages", []):
                title = ours.get(page["title"], page["title"])
                if page.get("missing"):
                    found[title] = {"sha1": None, "user": None, "missing": True}
                    continue
                revision = (page.get("revisions") or [{}])[0]
                found[title] = {
                    "sha1": revision.get("sha1"),
                    "user": revision.get("user"),
                    "missing": False,
                }
        return found

    def history(self, title, limit=50):
        """
        A page's recent revisions, newest first.

        @param limit: how far back to read. The importer only walks back until
            the topics change, which for a real page is a revision or two.
        @return: list of {"user": str|None, "text": str}; empty if missing.
        """
        result = self._call({
            "action": "query", "prop": "revisions", "titles": title,
            "rvprop": "content|user", "rvslots": "main", "rvlimit": limit,
        })
        pages = result.get("query", {}).get("pages", [])
        if not pages or pages[0].get("missing"):
            return []
        return [{"user": rev.get("user"),
                 "text": rev.get("slots", {}).get("main", {}).get("content", "")}
                for rev in pages[0].get("revisions", [])]

    def save(self, title, text, summary):
        """
        Create or overwrite a page.

        @return: "created", "updated", or "unchanged".
        """
        if not self._csrf:
            raise LoginRequired("call login() first")

        current = self.get_text(title)
        if current is not None and current.strip() == text.strip():
            return "unchanged"

        def edit():
            return self._call_with_backoff({"action": "edit"}, post={
                "title": title,
                "text": text,
                "summary": summary,
                "token": self._csrf,
                "bot": "1",
            })

        result = edit()

        # A stale token is not a failure of this edit, it is a fact about the
        # session, and every edit after it would fail the same way. Take a new
        # one and try again rather than reporting several hundred identical
        # errors — which is exactly what happened the first time this ran at
        # scale, because the token was fetched at login and first used several
        # minutes later, after surveying seven hundred pages.
        if result.get("error", {}).get("code") == "badtoken":
            self._refresh_csrf()
            result = edit()

        if "error" in result:
            raise WikiError(f"{title}: {result['error'].get('code')} "
                            f"{result['error'].get('info', '')[:160]}")
        outcome = result.get("edit", {}).get("result")
        if outcome != "Success":
            raise WikiError(f"{title}: edit returned {outcome!r}")
        return "created" if current is None else "updated"
