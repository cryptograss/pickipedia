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
            raise LoginRequired(
                "set PICKIPEDIA_BOT_USER and PICKIPEDIA_BOT_PASSWORD")

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

        csrf = self._call({"action": "query", "meta": "tokens", "type": "csrf"})
        self._csrf = csrf["query"]["tokens"]["csrftoken"]
        return self

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
        result = self._call({
            "action": "query", "prop": "revisions", "titles": title,
            "rvprop": "content", "rvslots": "main",
        })
        pages = result.get("query", {}).get("pages", [])
        if not pages or pages[0].get("missing"):
            return None
        return pages[0]["revisions"][0]["slots"]["main"]["content"]

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

        result = self._call_with_backoff({"action": "edit"}, post={
            "title": title,
            "text": text,
            "summary": summary,
            "token": self._csrf,
            "bot": "1",
        })
        if "error" in result:
            raise WikiError(f"{title}: {result['error'].get('code')} "
                            f"{result['error'].get('info', '')[:160]}")
        outcome = result.get("edit", {}).get("result")
        if outcome != "Success":
            raise WikiError(f"{title}: edit returned {outcome!r}")
        return "created" if current is None else "updated"
