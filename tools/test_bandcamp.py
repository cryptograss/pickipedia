#!/usr/bin/env python3
"""
Tests for the Bandcamp reader. What these guard: credits come out exactly
as written, never split into people; a challenge page is an error, not an
empty album; an artist's URL lists their releases. Pages are canned; no
test touches the network.
"""

import json

import pytest

import bandcamp as bc


def page(obj):
    return ('<html><head><script type="application/ld+json">\n'
            + json.dumps(obj) + "\n</script></head><body></body></html>")


ALBUM = {
    "@type": "MusicAlbum",
    "name": "Workin&#39;s Too Hard",
    "byArtist": {"name": "Rayna Gellert"},
    "publisher": {"name": "Rayna Gellert"},
    "datePublished": "20 Jan 2017 00:00:00 GMT",
    "creditText": "Musicians: Rayna Gellert, Kieran Kane, Kai Welch, Jamie Dick\r\nJoe - keys &amp; vocals",
    "description": "Cut live in a room.",
    "track": {"itemListElement": [
        {"position": 1, "item": {"name": "Starch", "@id": "https://x.bandcamp.com/track/starch"}},
        {"position": 2, "item": {"name": "Iron", "@id": "https://x.bandcamp.com/track/iron"}},
    ]},
}
TRACK = {"@type": "MusicRecording", "name": "Starch", "byArtist": {"name": "Rayna Gellert"},
         "inAlbum": {"name": "Workin's Too Hard"}, "creditText": "Fiddle: Rayna Gellert"}
CHALLENGE = "<html><head><title>Client Challenge</title></head><body>enable JavaScript</body></html>"


def fake_get(pages):
    calls = []

    def get(url):
        calls.append(url)
        final, body = pages[url]
        return final, body
    get.calls = calls
    return get


def test_credits_are_copied_not_parsed():
    rec = bc.read_page("https://x.bandcamp.com/album/w", page(ALBUM))
    assert rec["credits"] == "Musicians: Rayna Gellert, Kieran Kane, Kai Welch, Jamie Dick\nJoe - keys & vocals"
    assert rec["title"] == "Workin's Too Hard"
    assert rec["released"] == "20 Jan 2017"
    assert rec["kind"] == "album"
    assert [t["name"] for t in rec["tracks"]] == ["Starch", "Iron"]
    # No field anywhere claims a person or an instrument.
    assert not {"people", "personnel", "instruments"} & set(rec)


def test_challenge_page_is_an_error_not_an_empty_album():
    with pytest.raises(bc.NotAnAlbum):
        bc.read_page("https://x.bandcamp.com/album/w", CHALLENGE)


def test_tracks_flag_reads_each_track_page():
    get = fake_get({
        "https://x.bandcamp.com/album/w": ("https://x.bandcamp.com/album/w", page(ALBUM)),
        "https://x.bandcamp.com/track/starch": ("https://x.bandcamp.com/track/starch", page(TRACK)),
        "https://x.bandcamp.com/track/iron": ("https://x.bandcamp.com/track/iron",
                                               page({**TRACK, "name": "Iron", "creditText": None})),
    })
    kind, rec = bc.read("https://x.bandcamp.com/album/w", tracks=True, get=get)
    assert kind == "album"
    assert rec["tracks"][0]["credits"] == "Fiddle: Rayna Gellert"
    assert rec["tracks"][1]["credits"] == ""
    text = bc.render(rec)
    assert "    1. Starch  https://x.bandcamp.com/track/starch\n      Fiddle: Rayna Gellert" in text
    assert "2. Iron" not in text


def test_without_tracks_flag_only_the_album_is_fetched():
    get = fake_get({"https://x.bandcamp.com/album/w": ("https://x.bandcamp.com/album/w", page(ALBUM))})
    bc.read("https://x.bandcamp.com/album/w", get=get)
    assert get.calls == ["https://x.bandcamp.com/album/w"]


def test_artist_url_lists_the_discography_from_music():
    music = '<a href="/album/one">1</a><a href="/track/single">s</a><a href="/album/one">again</a>'
    get = fake_get({"https://x.bandcamp.com/music": ("https://x.bandcamp.com/music", music)})
    kind, found = bc.read("https://x.bandcamp.com", get=get)
    assert kind == "artist"
    assert found == ["https://x.bandcamp.com/album/one", "https://x.bandcamp.com/track/single"]


def test_artist_with_one_release_redirects_to_it():
    get = fake_get({"https://x.bandcamp.com/music": ("https://x.bandcamp.com/album/only", page(ALBUM))})
    assert bc.read("https://x.bandcamp.com/", get=get) == ("artist", ["https://x.bandcamp.com/album/only"])


def test_render_names_the_source_and_says_nothing_is_parsed():
    rec = bc.read_page("https://x.bandcamp.com/album/w", page({**ALBUM, "creditText": None}))
    text = bc.render(rec)
    assert "  Source: https://x.bandcamp.com/album/w" in text
    assert "  Credits, as Bandcamp has them:\n    (none)" in text
    assert "Nothing here is parsed" in text
    assert "Label:" not in text  # self-released: label is the artist


@pytest.mark.parametrize("url,ok", [
    ("https://milkweed.bandcamp.com/album/milkweed-ep", True),
    ("https://bandcamp.com/search?q=x", True),
    ("https://evilbandcamp.com/album/x", False),
    ("https://bandcamp.com.example.org/album/x", False),
])
def test_is_bandcamp(url, ok):
    assert bc.is_bandcamp(url) is ok


def test_fetch_uses_curl_with_an_argument_list(monkeypatch):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return bc.subprocess.CompletedProcess(cmd, 0, stdout="<html>ok</html>\nhttps://x.bandcamp.com/album/w")
    monkeypatch.setattr(bc.subprocess, "run", run)
    monkeypatch.setattr(bc, "INTERVAL", 0)
    final, body = bc.fetch("https://x.bandcamp.com/album/w")
    assert final == "https://x.bandcamp.com/album/w" and body == "<html>ok</html>"
    assert seen["cmd"][0] == "curl" and seen["cmd"][-2:] == ["--", "https://x.bandcamp.com/album/w"]
    assert bc.USER_AGENT in seen["cmd"]
