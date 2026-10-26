#!/usr/bin/env python3
"""
Tests for the recording-credits lookup.

The thing these guard is scope: a credit the source attaches to the whole
release must never be reported as a credit on the track. Everything here runs
on canned documents shaped like the real MusicBrainz and Discogs responses,
so no test touches the network.
"""

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
