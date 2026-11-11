#!/usr/bin/env python3
"""
Tests for the connectome store. Canned Discogs and MusicBrainz documents shaped
like the real ones (Julia Belle, discogs 34168519; Safe, Sensible And Sane,
discogs 35460307); nothing touches the network.
"""
import connectome_store as S

JULIA = {"id": 34168519, "title": "Julia Belle", "year": 2025, "master_id": 1,
         "artists": [{"name": "Various"}],
         "tracklist": [{"position": "A1", "title": "Irish Familiarity"}, {"position": "A5", "title": "Fiddle Tune"},
                       {"position": "C1", "title": "Another"}],
         "extraartists": [{"name": "Maddie Denton", "role": "Fiddle", "tracks": "A1"},
                          {"name": "Vickie Vaughn", "role": "Bass, Vocals", "tracks": "A5, C1"},
                          {"name": "Some Engineer", "role": "Mixed By", "tracks": ""},
                          {"name": "Whole Band (2)", "role": "Banjo", "tracks": ""}]}

SAFE = {"id": 35460307, "title": "Safe, Sensible And Sane", "year": 2025, "artists": [{"name": "Alison Brown"}],
        "tracklist": [{"position": "9", "title": "Girl, Have Money When You're Old", "extraartists": [
            {"name": "Molly Tuttle", "role": "Vocals"}, {"name": "Vickie Vaughn", "role": "Vocals"}]}],
        "extraartists": []}


def test_discogs_credit_keeps_the_tracks_it_covers():
    rows = {r["person"]: r for r in S.from_discogs(JULIA)}
    assert rows["Maddie Denton"]["scope"] == "track"
    assert rows["Maddie Denton"]["tracks"] == [{"position": "A1", "title": "Irish Familiarity"}]
    assert [t["position"] for t in rows["Vickie Vaughn"]["tracks"]] == ["A5", "C1"]
    assert rows["Vickie Vaughn"]["tracks_as_written"] == "A5, C1"
    assert rows["Whole Band"]["scope"] == "release" and rows["Whole Band"]["tracks"] == []
    assert "Some Engineer" not in rows  # not a performance
    assert rows["Maddie Denton"]["source"] == "https://www.discogs.com/release/34168519"


def test_same_record_different_tracks_is_not_together(tmp_path):
    db = S.to_sqlite(S.from_discogs(JULIA) + S.from_discogs(SAFE), str(tmp_path / "c.sqlite"))
    got = list(db.execute(S.SAME_TRACK, ("Vickie Vaughn",)))
    assert [g[0] for g in got] == ["Molly Tuttle"]  # Maddie is on A1, Vickie on A5 and C1
    assert got[0][2] == "9"


def test_mb_track_position_is_medium_and_number():
    rel = {"id": "x", "title": "R", "date": "2020", "artist-credit": [{"name": "A", "joinphrase": ""}],
           "relations": [{"type": "instrument", "attributes": ["guitar"], "artist": {"name": "G", "id": "g"}}],
           "media": [{"position": 2, "tracks": [{"number": "3", "title": "T", "recording": {"relations": [
               {"type": "vocal", "attributes": [], "artist": {"name": "V", "id": "v"}}]}}]}]}
    rows = {r["person"]: r for r in S.from_mb(rel)}
    assert rows["G"]["scope"] == "release" and rows["G"]["mbid"] == "g"
    assert rows["V"]["tracks"] == [{"position": "2-3", "title": "T"}]


def test_lma_song_credit_carries_the_songs_and_the_line():
    item = {"metadata": {"identifier": "SGP2025-07-05", "creator": "Sam Grisman Project", "date": "2025-07-05",
                         "description": "01. My Mountain so High $@\n$ with Kyle Tuttle\n@ With Molly Tuttle"}}
    rows = {r["person"]: r for r in S.from_lma(item, ["Kyle Tuttle", "Molly Tuttle"])}
    assert rows["Kyle Tuttle"]["scope"] == "song"
    assert rows["Kyle Tuttle"]["tracks"] == [{"position": "", "title": "01. My Mountain so High"}]
    assert rows["Kyle Tuttle"]["target"]["id"] == "lma:SGP2025-07-05"


def test_pairs_track_record_show_apart():
    rows = S.from_discogs(JULIA) + S.from_discogs(SAFE)
    item = {"metadata": {"identifier": "X", "creator": "Band", "date": "2025",
                         "description": "01. Song One $\n$ with Kyle Tuttle\nTaped by Jamie Burks\nLineup:\nMolly Tuttle"}}
    rows += S.from_lma(item, ["Kyle Tuttle", "Molly Tuttle", "Jamie Burks"])
    got = {(p["a"], p["b"], p["target"]): p for p in S.pairs(rows)}
    assert got[("Molly Tuttle", "Vickie Vaughn", "discogs:35460307")]["kind"] == "track"
    assert got[("Maddie Denton", "Vickie Vaughn", "discogs:34168519")]["kind"] == "record"
    assert got[("Kyle Tuttle", "Molly Tuttle", "lma:X")]["kind"] == "show"
    assert got[("Jamie Burks", "Kyle Tuttle", "lma:X")]["kind"] == "apart"
