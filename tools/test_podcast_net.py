#!/usr/bin/env python3
"""
Tests for the feed-fetching guards.

Feed URLs come off wiki pages now, so a fetch is a request made from inside our
network to a destination somebody else chose — and the firehose republishes what
it fetches at a public address, which makes a successful one exfiltration rather
than a probe.

The size cap is a separate matter and predates any of that: xml.etree expands
internal entities, so a small document can become a large amount of memory, and
any upstream podcast host could serve one without the wiki being involved.
"""

import ipaddress
import pytest

import podcast_net as net


def resolving_to(monkeypatch, *addresses):
    """Pin name resolution, so these tests need no network and no DNS."""
    monkeypatch.setattr(
        net, "_addresses_for", lambda host: [ipaddress.ip_address(a) for a in addresses]
    )


# ---------------------------------------------------------------------------
# Destinations we decline
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("address,what", [
    ("127.0.0.1", "loopback"),
    ("::1", "loopback v6"),
    ("10.4.4.4", "RFC1918"),
    ("192.168.1.9", "RFC1918"),
    ("172.16.0.5", "RFC1918"),
    ("169.254.169.254", "link-local, where cloud metadata lives"),
    ("fd00::1", "unique local v6"),
])
def test_refuses_addresses_off_the_public_internet(monkeypatch, address, what):
    resolving_to(monkeypatch, address)
    with pytest.raises(net.UnsafeFeedURL):
        net.assert_safe_url("http://feed.example/rss")


def test_refuses_a_host_that_resolves_to_both_public_and_private(monkeypatch):
    # A name answering with one routable address and one internal one is the
    # shape of a deliberate bypass, so any bad answer is disqualifying.
    resolving_to(monkeypatch, "93.184.216.34", "127.0.0.1")
    with pytest.raises(net.UnsafeFeedURL):
        net.assert_safe_url("http://feed.example/rss")


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://example.com/feed.xml",
    "gopher://example.com/",
])
def test_refuses_schemes_that_are_not_http(monkeypatch, url):
    resolving_to(monkeypatch, "93.184.216.34")
    with pytest.raises(net.UnsafeFeedURL):
        net.assert_safe_url(url)


def test_a_url_with_no_host_is_refused():
    with pytest.raises(net.UnsafeFeedURL):
        net.assert_safe_url("http:///rss")


def test_an_unresolvable_host_says_so(monkeypatch):
    # A typo in a feed URL is a broken page, not an attack. The message should
    # let somebody fix it rather than implying they did something sinister.
    import socket

    def unresolvable(host):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(net, "_addresses_for", unresolvable)
    with pytest.raises(net.UnsafeFeedURL, match="cannot resolve"):
        net.assert_safe_url("http://nope.example/rss")


# ---------------------------------------------------------------------------
# Destinations we allow
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("address", ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])
def test_allows_ordinary_public_addresses(monkeypatch, address):
    resolving_to(monkeypatch, address)
    net.assert_safe_url("https://feeds.buzzsprout.com/1660894.rss")


def test_the_real_feeds_are_not_caught_by_this(monkeypatch):
    # The guard is worthless if it blocks the thirteen shows we actually carry.
    resolving_to(monkeypatch, "93.184.216.34")
    for url in [
        "https://feeds.buzzsprout.com/1660894.rss",
        "http://feeds.libsyn.com/116948/rss",
        "https://media.rss.com/whatsthereasonforthis/feed.xml",
    ]:
        net.assert_safe_url(url)


# ---------------------------------------------------------------------------
# Response size
# ---------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self, n=None):
        return self.body[:n] if n else self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def serving(monkeypatch, body):
    monkeypatch.setattr(net, "urlopen", lambda req, timeout=None: FakeResponse(body))
    monkeypatch.setattr(net, "assert_safe_url", lambda url: None)


def test_a_normal_feed_comes_back_whole(monkeypatch):
    serving(monkeypatch, b"<rss>fine</rss>")
    assert net.fetch_bytes("http://feed.example/rss", "UA") == b"<rss>fine</rss>"


def test_an_oversized_feed_is_refused_rather_than_truncated(monkeypatch):
    # Truncating would hand xml.etree a malformed document and surface later as
    # a parse error nobody can account for. Refuse it where the reason is known.
    serving(monkeypatch, b"x" * 200)
    with pytest.raises(net.UnsafeFeedURL, match="larger than"):
        net.fetch_bytes("http://feed.example/rss", "UA", max_bytes=100)


def test_a_feed_exactly_at_the_cap_is_allowed(monkeypatch):
    serving(monkeypatch, b"x" * 100)
    assert len(net.fetch_bytes("http://feed.example/rss", "UA", max_bytes=100)) == 100
