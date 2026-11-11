#!/usr/bin/env python3
"""
Tests for the recording-credits lookup.

The thing these guard is scope: a credit the source attaches to the whole
release must never be reported as a credit on the track. Everything here runs
on canned documents shaped like the real MusicBrainz and Discogs responses,
so no test touches the network.
"""

import json

import pytest

import recording_credits as rc

RECORDING = "rec-1"


def mb_release(release_relations=(), track_relations=(), url=None):
    rels = [{"type": t, "attributes": attrs, "artist": {"name": n}} for t, attrs, n in release_relations]
    if url:
        rels.append({"type": "discogs", "url": {"resource": url}})
    return {
        "title": "Unit of Measure", "date": "2000", "relations": rels,
        "artist-credit": [{"name": "The Tony Rice Unit", "joinphrase": ""}],
        "label-info": [{"label": {"name": "Rounder"}, "catalog-number": "11661-0405-2"}],
        "media": [{"tracks": [
            {"position": 1, "recording": {"id": "other", "relations": [
                {"type": "instrument", "attributes": ["banjo"], "artist": {"name": "Someone Else"}}]}},
            {"position": 2, "recording": {"id": RECORDING, "relations": [
                {"type": t, "attributes": attrs, "artist": {"name": n}} for t, attrs, n in track_relations]}},
        ]}],
    }


# ---------------------------------------------------------------------------
# MusicBrainz scope
# ---------------------------------------------------------------------------

def test_release_relations_are_release_scope():
    track, credits = rc.mb_credits(mb_release([("instrument", ["mandolin"], "Jimmy Gaudreau")]), RECORDING)
    assert track["position"] == 2
    assert credits == [{"name": "Jimmy Gaudreau", "role": "mandolin", "scope": "release", "source": "MusicBrainz"}]


def test_track_relations_are_track_scope_and_other_tracks_ignored():
    _, credits = rc.mb_credits(mb_release(track_relations=[("vocal", ["lead vocals"], "Jerry Garcia")]), RECORDING)
    assert credits == [{"name": "Jerry Garcia", "role": "lead vocals", "scope": "track", "source": "MusicBrainz"}]


def test_non_performance_relations_are_dropped():
    _, credits = rc.mb_credits(mb_release([("producer", [], "Bill Wolf"), ("mix", [], "Bill Wolf")]), RECORDING)
    assert credits == []


def test_discogs_id_from_url_relation():
    assert rc.discogs_id(mb_release(url="https://www.discogs.com/release/4090806")) == "4090806"
    assert rc.discogs_id(mb_release()) is None


# ---------------------------------------------------------------------------
# Discogs scope
# ---------------------------------------------------------------------------

def discogs_release(extraartists, track_extras=()):
    return {
        "extraartists": extraartists,
        "tracklist": [
            {"position": "1", "title": "Old Train", "extraartists": []},
            {"position": "2", "title": "House Of The Rising Sun", "extraartists": list(track_extras)},
            {"position": "3", "title": "Something Else", "extraartists": []},
        ],
    }


def test_discogs_empty_tracks_is_release_scope():
    _, credits = rc.discogs_credits(discogs_release([{"name": "Tony Rice", "role": "Guitar", "tracks": ""}]),
                                    "House of the Rising Sun")
    assert [(c["name"], c["scope"]) for c in credits] == [("Tony Rice", "release")]


@pytest.mark.parametrize("spec,included", [
    ("2", True), ("1, 2", True), ("1 to 3", True), ("3", False), ("1, 3", False), ("3 to 9", False),
])
def test_discogs_tracks_spec(spec, included):
    _, credits = rc.discogs_credits(
        discogs_release([{"name": "Guest Player", "role": "Dobro", "tracks": spec}]), "House of the Rising Sun")
    assert [c["scope"] for c in credits] == (["track"] if included else [])


def test_discogs_track_level_credits_and_suffix_stripped():
    _, credits = rc.discogs_credits(
        discogs_release([], [{"name": "Craig Miller (3)", "role": "Harmonica"},
                             {"name": "Jerry Garcia", "role": "Arranged By"}]),
        "House of the Rising Sun")
    assert credits == [{"name": "Craig Miller", "role": "Harmonica", "scope": "track", "source": "Discogs"}]


def test_discogs_production_roles_are_not_performances():
    for role in ("Producer", "Mixed By, Mastered By", "Liner Notes [Song Notes]", "Recorded By", "Photography By"):
        assert not rc.is_performance(role), role
    for role in ("Guitar", "Acoustic Bass", "Guitar, Vocals", "Fiddle"):
        assert rc.is_performance(role), role


def test_discogs_missing_track_keeps_release_credits_only():
    track, credits = rc.discogs_credits(
        discogs_release([{"name": "Tony Rice", "role": "Guitar", "tracks": ""},
                         {"name": "Guest Player", "role": "Dobro", "tracks": "2"}]),
        "A Song Not On It")
    assert track is None
    assert [(c["name"], c["scope"]) for c in credits] == [("Tony Rice", "release")]


# ---------------------------------------------------------------------------
# Finding versions
# ---------------------------------------------------------------------------

def test_normalize_title():
    assert rc.normalize_title("The House Of The Rising Sun") == rc.normalize_title("House of the Rising Sun")
    assert rc.normalize_title("Can’t Outrun the Blues") == "can't outrun the blues"


def test_find_recordings_filters_title_and_artist(monkeypatch):
    monkeypatch.setattr(rc, "mb_get", lambda path, **params: {"recordings": [
        {"id": "a", "title": "House of the Rising Sun", "artist-credit": [{"name": "The Tony Rice Unit"}]},
        {"id": "b", "title": "House of the Rising Sun Blues", "artist-credit": [{"name": "Tony Rice"}]},
        {"id": "c", "title": "House of the Rising Sun", "artist-credit": [{"name": "Larry Rice"}]},
    ]})
    assert [r["id"] for r in rc.find_recordings("Tony Rice", "House of the Rising Sun")] == ["a"]


def test_pick_releases_one_per_group_earliest_first():
    recordings = [
        {"id": "r1", "releases": [
            {"id": "reissue", "date": "2011-10-18", "release-group": {"id": "g1"}},
            {"id": "original", "date": "2000", "release-group": {"id": "g1"}}]},
        {"id": "r2", "releases": [
            {"id": "undated", "release-group": {"id": "g2"}},
            {"id": "pizza", "date": "2000-04-25", "release-group": {"id": "g2"}}]},
    ]
    assert rc.pick_releases(recordings) == [("r1", "original"), ("r2", "pizza")]


def test_render_separates_track_from_release():
    out = rc.render("Tony Rice", "House of the Rising Sun", [{
        "artist": "The Tony Rice Unit", "release": "Unit of Measure", "date": "2000",
        "labels": ["Rounder 11661-0405-2"], "track": 2, "sources": ["https://musicbrainz.org/release/x"],
        "credits": [{"name": "Tony Rice", "role": "guitar", "scope": "release", "source": "MusicBrainz"}],
    }])
    track_part, release_part = out.split("Credited on the whole release")
    assert "(none)" in track_part and "Tony Rice" not in track_part.split("track 2", 1)[1]
    assert "Tony Rice: guitar [MusicBrainz]" in release_part


# ---------------------------------------------------------------------------
# Composite roles
#
# A Discogs role can name several jobs at once. The first version of the
# filter judged the whole string, so 'Guitar, Producer' counted as a
# performance and put a producer in the player list.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("role,performing", [
    ("Guitar, Producer", ["Guitar"]),
    ("Banjo, Producer, Mixed By", ["Banjo"]),
    ("Vocals, Guitar", ["Vocals", "Guitar"]),
    ("Producer, Guitar", ["Guitar"]),
    ("Executive Producer", []),
    ("Executive-Producer", []),
    ("Songwriter", []),
    ("Sleeve Notes", []),
    ("Created By, Executive-Producer", []),
    ("Film Director [Directed By]", []),
    ("Project Manager [Project Coordination]", []),
    ("Liner Notes [Song Notes]", []),
    ("Written-By", []),
    # A job title ends with the job and starts with a qualifier. Matching only
    # the start of the role let 'Assistant Engineer' through (it doesn't start
    # with 'engineer') and 'Guitar Technician' (it starts with an instrument).
    ("Assistant Engineer", []),
    ("Production Assistant", []),
    ("Guitar Technician", []),
    ("Banjo Tech", []),
    ("Guitar, Guitar Technician", ["Guitar"]),
    ("Engineer [Assistant]", []),
])
def test_composite_roles(role, performing):
    assert rc.performance_roles(role) == performing


# ---------------------------------------------------------------------------
# Sub-tracks and paging
# ---------------------------------------------------------------------------

def test_discogs_subtrack_is_covered_by_its_parent_track():
    """A medley's parts are positioned '2.1', '2.2'; a credit on '2' covers them."""
    release = {
        "extraartists": [{"name": "Guest Player", "role": "Dobro", "tracks": "2"},
                         {"name": "Other Guest", "role": "Fiddle", "tracks": "3"}],
        "tracklist": [
            {"position": "1", "title": "Old Train", "extraartists": []},
            {"position": "2", "title": "Medley", "type_": "index", "extraartists": [],
             "sub_tracks": [{"position": "2.1", "title": "House Of The Rising Sun", "extraartists": []},
                            {"position": "2.2", "title": "Shady Grove", "extraartists": []}]},
        ],
    }
    track, credits = rc.discogs_credits(release, "House of the Rising Sun")
    assert track["position"] == "2.1"
    assert [(c["name"], c["scope"]) for c in credits] == [("Guest Player", "track")]


@pytest.mark.parametrize("position,spec,covered", [
    ("2.1", "2", True), ("2.1", "1 to 2", True), ("2.1", "2.1", True), ("2.1", "3", False), ("2", "2.1", False),
])
def test_track_in_spec_subtracks(position, spec, covered):
    assert rc.track_in_spec(position, spec) is covered


def test_find_recordings_pages_past_100(monkeypatch):
    calls = []

    def fake_mb_get(path, **params):
        calls.append(params["offset"])
        start = params["offset"]
        page = [{"id": f"r{i}", "title": "Shady Grove", "artist-credit": [{"name": "Jerry Garcia"}]}
                for i in range(start, min(start + 100, 150))]
        return {"count": 150, "offset": start, "recordings": page}

    monkeypatch.setattr(rc, "mb_get", fake_mb_get)
    found = rc.find_recordings("Jerry Garcia", "Shady Grove")
    assert calls == [0, 100]
    assert len(found) == 150 and found[-1]["id"] == "r149"


def test_render_says_when_track_not_found():
    out = rc.render("Tony Rice", "Nowhere", [{
        "artist": "Tony Rice", "release": "A Compilation", "date": "", "labels": [], "track": None,
        "sources": [], "credits": []}])
    assert "track not found" in out and "None" not in out


def test_producer_hidden_behind_a_performance_is_not_reported():
    _, credits = rc.discogs_credits(
        discogs_release([{"name": "Tony Rice", "role": "Guitar, Producer", "tracks": ""}],
                        [{"name": "Scott Vestal", "role": "Banjo, Producer, Mixed By"}]),
        "House of the Rising Sun")
    assert [(c["name"], c["role"], c["scope"]) for c in credits] == [
        ("Tony Rice", "Guitar", "release"), ("Scott Vestal", "Banjo", "track")]


def test_literal_duplicates_across_groups_are_folded():
    """Same title and date in two groups: one entry.

    Differently-titled releases of one show are NOT folded: 'Warfield
    Theater, 12-08-91 (disc 1)' and '1991-12-08 Warfield Theater, SF, CA'
    stay two versions, because nothing in the data says they are one tape.
    """
    recordings = [{"id": "r1", "releases": [
        {"id": "a", "title": "Shady Grove", "date": "1996-10-29", "release-group": {"id": "g1"}},
        {"id": "b", "title": "Shady Grove", "date": "1996-10-29", "release-group": {"id": "g2"}},
        {"id": "c", "title": "Warfield Theater, 12-08-91 (disc 1)", "date": "1991-12-08",
         "release-group": {"id": "g3"}},
        {"id": "d", "title": "1991-12-08 Warfield Theater, SF, CA, USA", "date": "1991-12-08",
         "release-group": {"id": "g4"}}]}]
    assert rc.pick_releases(recordings) == [("r1", "c"), ("r1", "d"), ("r1", "a")]


# ---------------------------------------------------------------------------
# --album: a whole record, source by source
# ---------------------------------------------------------------------------

def test_find_releases_filters_title_and_artist_and_folds_groups(monkeypatch):
    monkeypatch.setattr(rc, "mb_get", lambda path, **params: {"releases": [
        {"id": "a", "title": "Manzanita", "date": "1979", "release-group": {"id": "g1"},
         "artist-credit": [{"name": "Tony Rice"}]},
        {"id": "b", "title": "Manzanita", "date": "1998", "release-group": {"id": "g1"},
         "artist-credit": [{"name": "Tony Rice"}]},
        {"id": "c", "title": "Manzanita Blues", "date": "1979", "release-group": {"id": "g2"},
         "artist-credit": [{"name": "Tony Rice"}]},
        {"id": "d", "title": "Manzanita", "date": "1979", "release-group": {"id": "g3"},
         "artist-credit": [{"name": "Larry Rice"}]},
    ]})
    assert [r["id"] for r in rc.find_releases("Tony Rice", "Manzanita")] == ["a"]


def test_discogs_find_releases_reads_artist_dash_title(monkeypatch):
    monkeypatch.setattr(rc, "discogs_get", lambda path: {"results": [
        {"id": 1, "title": "The Turpentine Ray - The First TV Dinner", "year": "2012", "master_id": 0},
        {"id": 2, "title": "The Turpentine Ray - The First TV Dinner", "year": "2020", "master_id": 0},
        {"id": 3, "title": "Kevin Coyne - Matching Head And Feet", "year": "1975", "master_id": 9},
    ]})
    hits = rc.discogs_find_releases("Turpentine Ray", "The First TV Dinner")
    assert [h["id"] for h in hits] == ["1", "2"]  # no master: each release stands alone, earliest first


def test_album_reads_a_linked_discogs_release_once(monkeypatch):
    mb = mb_release(release_relations=[("instrument", ["guitar"], "Tony Rice")],
                    url="https://www.discogs.com/release/77")
    mb["release-group"] = {"id": "g1"}
    calls = []
    monkeypatch.setattr(rc, "find_releases", lambda a, t: [{"id": "mb-1"}])
    monkeypatch.setattr(rc, "mb_get", lambda path, **params: mb)
    monkeypatch.setattr(rc, "discogs_find_releases", lambda a, t: [{"id": "77"}, {"id": "78"}])

    def discogs_get(path):
        calls.append(path)
        return {"title": "Unit of Measure", "year": 2000, "artists": [{"name": "Tony Rice Unit (2)"}],
                "extraartists": [{"name": "Tony Rice", "role": "Guitar", "tracks": ""}], "tracklist": []}
    monkeypatch.setattr(rc, "discogs_get", discogs_get)

    readings = rc.album("Tony Rice", "Unit of Measure")
    assert [(r["source"], r["id"]) for r in readings] == [("MusicBrainz", "mb-1"), ("Discogs", "77"), ("Discogs", "78")]
    assert calls == ["releases/77", "releases/78"]
    assert readings[1]["linked_to"] == "mb-1" and readings[2]["linked_to"] is None
    assert readings[2]["artist"] == "Tony Rice Unit"
    # Nothing merged: each reading carries its own people.
    assert readings[0]["people"]["Tony Rice"]["scopes"] == {"release"}


def test_render_album_keeps_sources_apart_and_marks_scope():
    readings = [
        {"source": "MusicBrainz", "url": "https://musicbrainz.org/release/x", "artist": "A", "title": "T",
         "date": "2000", "tracks": 2, "people": {"Tony Rice": {"roles": {"guitar"}, "scopes": {"track"}}}},
        {"source": "Discogs", "url": "https://www.discogs.com/release/1", "artist": "A", "title": "T",
         "date": "", "tracks": 2, "linked_to": "x", "people": {}},
    ]
    text = rc.render_album("A", "T", readings)
    assert "MusicBrainz: A: T (2000), 2 tracks\n" in text
    assert "  Tony Rice: guitar [track]" in text
    assert "Discogs: A: T (undated), 2 tracks, linked from MusicBrainz release x" in text
    assert "Nobody credited as performing" in text


def test_render_album_says_when_nobody_has_it():
    assert "Neither MusicBrainz nor Discogs" in rc.render_album("A", "T", [])


def test_main_album_flag(monkeypatch, capsys):
    monkeypatch.setattr(rc, "album", lambda a, t, bandcamp=None: [])
    assert rc.main(["x", "--album", "A", "T"]) == 0
    assert "Neither MusicBrainz nor Discogs" in capsys.readouterr().out
    assert rc.main(["x", "--bogus", "A", "T"]) == 2


# ---------------------------------------------------------------------------
# --album --bandcamp: credits copied, never parsed
# ---------------------------------------------------------------------------

def bc_page(obj):
    return '<html><script type="application/ld+json">\n' + json.dumps(obj) + "\n</script></html>"


BC_ALBUM = {
    "@type": "MusicAlbum", "name": "Workin&#39;s Too Hard", "byArtist": {"name": "Rayna Gellert"},
    "datePublished": "20 Jan 2017 00:00:00 GMT",
    "creditText": "Musicians: Rayna Gellert, Kieran Kane\r\nJoe - keys &amp; vocals",
    "description": "Cut live in a room.",
    "track": {"itemListElement": [{"position": 1, "item": {"name": "Starch"}}]},
}


def test_bandcamp_credits_are_copied_not_parsed():
    r = rc.bandcamp_reading("https://x.bandcamp.com/album/w",
                            get=lambda url: (url, bc_page(BC_ALBUM)))
    assert r["source"] == "Bandcamp" and r["url"] == "https://x.bandcamp.com/album/w"
    assert r["credits_text"] == "Musicians: Rayna Gellert, Kieran Kane\nJoe - keys & vocals"
    assert r["title"] == "Workin's Too Hard" and r["date"] == "20 Jan 2017" and r["tracks"] == 1
    assert r["people"] == {}  # nobody is extracted from prose


def test_bandcamp_challenge_page_is_an_error():
    with pytest.raises(rc.NotABandcampRecord):
        rc.bandcamp_reading("https://x.bandcamp.com/album/w",
                            get=lambda url: (url, "<title>Client Challenge</title>"))


def test_album_reads_bandcamp_last_and_render_says_not_parsed(monkeypatch):
    monkeypatch.setattr(rc, "find_releases", lambda a, t: [])
    monkeypatch.setattr(rc, "discogs_find_releases", lambda a, t: [])
    readings = rc.album("Rayna Gellert", "Workin's Too Hard", bandcamp="https://x.bandcamp.com/album/w",
                        bandcamp_get=lambda url: (url, bc_page(BC_ALBUM)))
    assert [r["source"] for r in readings] == ["Bandcamp"]
    text = rc.render_album("Rayna Gellert", "Workin's Too Hard", readings)
    assert "Credits, word for word (not parsed" in text
    assert "    Joe - keys & vocals" in text
    assert "  About, word for word:\n    Cut live in a room." in text


def test_bandcamp_fetch_is_curl_with_an_argument_list(monkeypatch):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return rc.subprocess.CompletedProcess(cmd, 0, stdout="<html/>\nhttps://x.bandcamp.com/album/w")
    monkeypatch.setattr(rc.subprocess, "run", run)
    monkeypatch.setattr(rc, "BANDCAMP_INTERVAL", 0)
    assert rc.bandcamp_get("https://x.bandcamp.com/album/w") == ("https://x.bandcamp.com/album/w", "<html/>")
    assert seen["cmd"][0] == "curl" and seen["cmd"][-2:] == ["--", "https://x.bandcamp.com/album/w"]


@pytest.mark.parametrize("url,ok", [
    ("https://milkweed.bandcamp.com/album/milkweed-ep", True),
    ("https://evilbandcamp.com/album/x", False),
    ("https://bandcamp.com.example.org/album/x", False),
])
def test_is_bandcamp(url, ok):
    assert rc.is_bandcamp(url) is ok


def test_main_bandcamp_needs_album_and_a_bandcamp_url():
    assert rc.main(["x", "A", "T", "--bandcamp", "https://x.bandcamp.com/album/w"]) == 2
    assert rc.main(["x", "--album", "A", "T", "--bandcamp", "https://example.org/album/w"]) == 2
