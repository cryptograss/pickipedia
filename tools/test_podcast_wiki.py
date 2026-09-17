#!/usr/bin/env python3
"""
Tests for the import bot's wiki client.

The one that matters is the identity guard. Everything else here is plumbing;
that check is the thing standing between a title parser and several hundred
pages signed with an editorial name and filed for human review.
"""

import pytest

from podcast_wiki import LoginRequired, Wiki, WikiError, WrongIdentity


class FakeWiki(Wiki):
    """A Wiki that answers whoami() from a fixture instead of the network."""

    def __init__(self, name, groups):
        super().__init__(user="fake", password="fake")
        self._identity = (name, groups)

    def whoami(self):
        return self._identity


class TestIdentityGuard:
    """require_group — refuse to import under a reviewing identity."""

    def test_allows_an_exempt_bot(self):
        wiki = FakeWiki("Podcast Imports",
                        ["*", "user", "bot", "exempt-from-verification"])
        assert wiki.require_group("exempt-from-verification") == "Podcast Imports"

    def test_refuses_a_reviewing_identity(self):
        # Magent's actual groups. An edit under this account is a claim an AI
        # made that somebody is meant to check.
        wiki = FakeWiki("Magent", ["*", "user", "autoconfirmed", "bot"])
        with pytest.raises(WrongIdentity) as caught:
            wiki.require_group("exempt-from-verification")
        assert "Magent" in str(caught.value)
        assert "exempt-from-verification" in str(caught.value)

    def test_refuses_an_anonymous_session(self):
        wiki = FakeWiki("127.0.0.1", [])
        with pytest.raises(WrongIdentity):
            wiki.require_group("exempt-from-verification")

    def test_says_why_when_given_a_reason(self):
        wiki = FakeWiki("Magent", ["bot"])
        with pytest.raises(WrongIdentity) as caught:
            wiki.require_group("exempt-from-verification",
                               because="Use the import account.")
        assert "Use the import account." in str(caught.value)


class TestCredentials:
    """Nothing is attempted without credentials, and none come from argv."""

    def test_login_without_credentials_is_refused(self, monkeypatch):
        monkeypatch.delenv("PICKIPEDIA_BOT_USER", raising=False)
        monkeypatch.delenv("PICKIPEDIA_BOT_PASSWORD", raising=False)
        with pytest.raises(LoginRequired):
            Wiki().login()

    def test_saving_before_login_is_refused(self):
        # Without this, a missed login would surface as a confusing API error
        # part way through a run rather than on the first page.
        with pytest.raises(LoginRequired):
            Wiki(user="x", password="y").save("Some page", "text", "summary")

    def test_credentials_are_read_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("PICKIPEDIA_BOT_USER", "Podcast Imports@episodes")
        monkeypatch.setenv("PICKIPEDIA_BOT_PASSWORD", "secret")
        assert Wiki().user == "Podcast Imports@episodes"


class TestStaleToken:
    """
    A CSRF token is tied to its session and does not last forever.

    The survey pass reads several hundred pages before the first write, so the
    token taken at login is minutes old by the time it is used. The first run
    at scale failed all seven hundred and three edits with badtoken and wrote
    nothing, which is the good version of that failure — but it should not
    happen at all.
    """

    def test_a_stale_token_is_refreshed_and_the_edit_retried(self):
        wiki = Wiki(user="x", password="y")
        wiki._csrf = "stale"
        calls = []

        def fake_call_with_backoff(params, post=None):
            calls.append(post["token"])
            if post["token"] == "stale":
                return {"error": {"code": "badtoken", "info": "Invalid CSRF token."}}
            return {"edit": {"result": "Success"}}

        wiki._call_with_backoff = fake_call_with_backoff
        wiki.get_text = lambda title: "old text"
        wiki._refresh_csrf = lambda: setattr(wiki, "_csrf", "fresh") or "fresh"

        assert wiki.save("Some page", "new text", "summary") == "updated"
        assert calls == ["stale", "fresh"], "should retry once with a new token"

    def test_a_second_badtoken_is_reported_rather_than_looping(self):
        wiki = Wiki(user="x", password="y")
        wiki._csrf = "stale"
        wiki._call_with_backoff = lambda params, post=None: {
            "error": {"code": "badtoken", "info": "Invalid CSRF token."}}
        wiki.get_text = lambda title: "old text"
        wiki._refresh_csrf = lambda: None

        with pytest.raises(WikiError) as caught:
            wiki.save("Some page", "new text", "summary")
        assert "badtoken" in str(caught.value)


class TestBatchedSurvey:
    """survey — many pages per request, hashes instead of text."""

    def fake(self, responses):
        wiki = Wiki(user="x", password="y")
        requests = []

        def fake_call_with_backoff(params, post=None):
            requests.append(params["titles"].split("|"))
            return responses.pop(0)

        wiki._call_with_backoff = fake_call_with_backoff
        return wiki, requests

    def test_batches_fifty_at_a_time(self):
        titles = [f"Show/Ep {n}" for n in range(120)]
        wiki, requests = self.fake([{"query": {"pages": []}} for _ in range(3)])
        wiki.survey(titles)
        assert [len(r) for r in requests] == [50, 50, 20]

    def test_hash_user_and_missing(self):
        wiki, _ = self.fake([{"query": {"pages": [
            {"title": "Show/Ep 1",
             "revisions": [{"sha1": "abc", "user": "HearThatWhistleBlow"}]},
            {"title": "Show/Ep 2", "missing": True},
        ]}}])
        found = wiki.survey(["Show/Ep 1", "Show/Ep 2"])
        assert found["Show/Ep 1"] == {
            "sha1": "abc", "user": "HearThatWhistleBlow", "missing": False}
        assert found["Show/Ep 2"]["missing"] is True

    def test_answers_under_our_spelling_of_the_title(self):
        # The wiki replies to "Show/Ep  1" as "Show/Ep 1". Keyed by its
        # spelling, our lookup would miss and the page would quietly go back
        # to being read one request at a time.
        wiki, _ = self.fake([{"query": {
            "normalized": [{"from": "Show/Ep  1", "to": "Show/Ep 1"}],
            "pages": [{"title": "Show/Ep 1",
                       "revisions": [{"sha1": "abc", "user": "X"}]}],
        }}])
        assert "Show/Ep  1" in wiki.survey(["Show/Ep  1"])

    def test_a_title_the_wiki_ignored_is_left_out(self):
        # Absent is not the same as missing: "missing" would recreate the page.
        wiki, _ = self.fake([{"query": {"pages": []}}])
        assert wiki.survey(["Show/Ep 1"]) == {}
