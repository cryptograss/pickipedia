#!/usr/bin/env python3
"""
Fetching podcast feeds, with the guards that being wiki-configurable requires.

Feed URLs used to be thirteen entries curated through a pull request. They are
now whatever anybody with a wiki account put in a {{Podcast}} infobox, which
changes what a fetch means: an unvalidated urlopen() of an attacker-chosen URL
is a request made from inside our own network, and the firehose republishes
what it fetches at a public address — so a successful one is exfiltration
rather than merely a probe.

Two guards live here, and they cover different threats:

  assert_safe_url  keeps us from fetching things on our own network. That risk
                   arrived with wiki-editable config.

  fetch_bytes      caps how much a feed may return. That risk arrived with
                   nothing: xml.etree expands internal entities, so sixty bytes
                   can become gigabytes of RAM, and any of the thirteen
                   upstream hosts could serve such a document tomorrow without
                   the wiki being involved at all.
"""

import ipaddress
import socket
from urllib.parse import urlparse
from urllib.request import urlopen, Request

# Comfortably above the largest real feed — the combined output of all thirteen
# is under a megabyte — and far below what it takes to trouble a box that is
# also running the wiki's database.
MAX_FEED_BYTES = 8 * 1024 * 1024

FETCH_TIMEOUT = 30
ALLOWED_SCHEMES = ("http", "https")


class UnsafeFeedURL(Exception):
    """A feed URL points somewhere we decline to fetch from."""


def _addresses_for(host):
    """Every address a hostname resolves to, v4 and v6 alike."""
    return [ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(host, None)]


def assert_safe_url(url):
    """
    Refuse URLs that point inside our own network.

    Podcast feeds live on the public internet. Nothing legitimate here resolves
    to loopback, a private range, or link-local — and link-local is exactly
    where cloud metadata services sit.

    Deliberately not airtight. The name is resolved here and resolved again by
    urlopen, so a host whose DNS answer changes between the two could still slip
    through. Closing that means connecting to the checked address ourselves and
    carrying the Host header, which is a larger piece of work. Against the
    threat this actually faces — somebody with a wiki account, not somebody
    running a rebinding server — resolve-and-check is proportionate, and saying
    so plainly beats implying more than it delivers.

    @param url: The feed URL from a {{Podcast}} infobox.
    @raises UnsafeFeedURL: If the scheme or the destination is refused.
    """
    parsed = urlparse(url)

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeFeedURL(f"scheme {parsed.scheme!r} is not allowed; use http or https")

    host = parsed.hostname
    if not host:
        raise UnsafeFeedURL("no host in URL")

    try:
        addresses = _addresses_for(host)
    except socket.gaierror as e:
        # An unresolvable host is a broken feed rather than a dangerous one,
        # and the message should say which so somebody can fix the page.
        raise UnsafeFeedURL(f"cannot resolve {host}: {e}") from e

    for address in addresses:
        if (address.is_private or address.is_loopback or address.is_link_local
                or address.is_reserved or address.is_multicast):
            raise UnsafeFeedURL(
                f"{host} resolves to {address}, which is not on the public internet"
            )


def fetch_bytes(url, user_agent, max_bytes=MAX_FEED_BYTES, timeout=FETCH_TIMEOUT):
    """
    Fetch a feed, refusing unsafe destinations and oversized responses.

    Reads one byte past the cap so an over-long body is caught rather than
    silently truncated into malformed XML. A feed that is too big should say so,
    not resurface later as a parse error nobody can account for.

    @param url: Feed URL.
    @param user_agent: Sent as User-Agent.
    @param max_bytes: Refuse bodies larger than this.
    @param timeout: Socket timeout in seconds.
    @return: The response body, as bytes.
    @raises UnsafeFeedURL: If the URL is refused or the body is too large.
    """
    assert_safe_url(url)

    req = Request(url, headers={"User-Agent": user_agent})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read(max_bytes + 1)

    if len(raw) > max_bytes:
        raise UnsafeFeedURL(f"feed is larger than {max_bytes} bytes; refusing to parse it")

    return raw
