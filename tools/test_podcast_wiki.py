#!/usr/bin/env python3
"""
Tests for the import bot's wiki client.

The one that matters is the identity guard. Everything else here is plumbing;
that check is the thing standing between a title parser and several hundred
pages signed with an editorial name and filed for human review.
"""

import pytest

from podcast_wiki import LoginRequired, Wiki, WrongIdentity


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
