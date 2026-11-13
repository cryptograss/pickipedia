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


def test_a_record_keeps_the_formats_its_source_lists(tmp_path):
    julia = dict(JULIA, formats=[{"name": "Vinyl", "qty": "2", "descriptions": ["LP", "Album"]},
                                 {"name": "CD", "qty": "1", "descriptions": ["Album", "Copy Protected"]}])
    target = S.from_discogs(julia)[0]["target"]
    assert target["formats"] == ["Vinyl (LP, Album)", "CD (Album, Copy Protected)"]
    assert S.from_discogs(JULIA)[0]["target"]["formats"] == []          # the source lists none: none is kept
    rel = {"id": "x", "title": "R", "date": "2020", "artist-credit": [{"name": "A", "joinphrase": ""}],
           "relations": [{"type": "instrument", "attributes": ["guitar"], "artist": {"name": "G", "id": "g"}}],
           "media": [{"position": 1, "format": "CD", "tracks": []}, {"position": 2, "format": "CD", "tracks": []},
                     {"position": 3, "tracks": []}]}
    assert S.from_mb(rel)[0]["target"]["formats"] == ["CD"]
    db = S.to_sqlite(S.from_discogs(julia), str(tmp_path / "c.sqlite"))
    assert db.execute("SELECT formats FROM targets").fetchall() == [("Vinyl (LP, Album); CD (Album, Copy Protected)",)]


# ---------------------------------------------------------------------------
# fetch, and its budget
# ---------------------------------------------------------------------------

class Clock:
    """Time that moves only when a fetch is made: each one takes a second."""
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def a_net(monkeypatch, clock, down=()):
    """The three services, answered from here; returns the list of what was asked for, in order."""
    asked = []

    def answer(kind, ident):
        asked.append(f"{kind} {ident}")
        clock.t += 1.0
        if ident in down:
            raise OSError("no answer")
        return {"metadata": {"identifier": ident}} if kind == "lma" else {"id": ident}

    monkeypatch.setattr(S.lma_lineup, "fetch", lambda ident: answer("lma", ident))
    monkeypatch.setattr(S.sideman, "discogs_get", lambda path: answer("discogs", path.rsplit("/", 1)[-1]))
    monkeypatch.setattr(S.sideman, "mb_get", lambda path, **params: answer("mb", path.rsplit("/", 1)[-1]))
    return asked


def cached(raw):
    return sorted(str(p.relative_to(raw)) for p in raw.rglob("*.json"))


TAPES = [f"tape{n}" for n in range(8)]


def test_fetch_with_no_budget_takes_all_the_cache_lacks(tmp_path, monkeypatch):
    clock = Clock()
    asked = a_net(monkeypatch, clock)
    assert S.fetch(str(tmp_path), ["34168519"], ["an-mbid"], TAPES, clock=clock) == (10, [], 0)
    assert asked == ["discogs 34168519", "mb an-mbid"] + [f"lma {t}" for t in TAPES]
    assert S.fetch(str(tmp_path), ["34168519"], ["an-mbid"], TAPES, clock=clock) == (0, [], 0)
    assert len(asked) == 10                                 # the second run asks for nothing: it's all cached


def test_a_budget_stops_the_run_and_the_next_one_goes_on(tmp_path, monkeypatch):
    whole = tmp_path / "whole"
    clock = Clock()
    a_net(monkeypatch, clock)
    S.fetch(str(whole), ["34168519"], ["an-mbid"], TAPES, clock=clock)     # what an unbudgeted fetch leaves
    clock = Clock()
    asked = a_net(monkeypatch, clock)
    raw = tmp_path / "raw"
    runs = []
    for _ in range(5):                                      # a second a fetch, 2.5 seconds a run: three start
        runs.append(S.fetch(str(raw), ["34168519"], ["an-mbid"], TAPES, budget=2.5, clock=clock))
    assert runs == [(3, [], 7), (3, [], 4), (3, [], 1), (1, [], 0), (0, [], 0)]
    assert asked == ["discogs 34168519", "mb an-mbid"] + [f"lma {t}" for t in TAPES]     # each once, in order
    assert cached(raw) == cached(whole) and len(cached(raw)) == 10
    for name in cached(raw):
        assert (raw / name).read_bytes() == (whole / name).read_bytes()


def test_what_the_cache_holds_is_never_counted_as_waiting(tmp_path, monkeypatch):
    clock = Clock()
    asked = a_net(monkeypatch, clock)
    S.fetch(str(tmp_path), [], ["an-mbid"], ["tape7"], clock=clock)         # a release and the last tape: here already
    del asked[:]
    # Three records use the budget up. The release and tape 7 come after that, and are not waiting for anything.
    assert S.fetch(str(tmp_path), ["1", "2", "3"], ["an-mbid"], TAPES, budget=2.5, clock=clock) == (3, [], 7)
    assert asked == ["discogs 1", "discogs 2", "discogs 3"]


def test_a_budget_of_no_seconds_fetches_nothing(tmp_path, monkeypatch):
    clock = Clock()
    asked = a_net(monkeypatch, clock)
    assert S.fetch(str(tmp_path), ["34168519"], [], TAPES, budget=0, clock=clock) == (0, [], 9)
    assert asked == [] and cached(tmp_path) == []


def test_a_source_that_fails_is_failed_not_waiting_and_is_asked_for_again(tmp_path, monkeypatch):
    clock = Clock()
    asked = a_net(monkeypatch, clock, down={"tape1"})
    got, failed, waiting = S.fetch(str(tmp_path), [], [], TAPES[:4], budget=3.5, clock=clock)
    assert (got, waiting) == (3, 0) and len(failed) == 1 and "tape1" in failed[0]
    assert S.fetch(str(tmp_path), [], [], TAPES[:4], budget=3.5, clock=clock)[0] == 0
    assert asked == ["lma tape0", "lma tape1", "lma tape2", "lma tape3", "lma tape1"]
    assert not list(tmp_path.rglob("*.part"))


def test_fetch_says_how_many_wait(tmp_path, monkeypatch, capsys):
    a_net(monkeypatch, Clock())
    sources = tmp_path / "sources.txt"
    sources.write_text("# three\ndiscogs 34168519\nlma tape0\nlma tape1\n")
    raw = str(tmp_path / "raw")
    assert S.main(["x", "fetch", "--raw", raw, "--sources", str(sources), "--budget", "0"]) == 0
    assert capsys.readouterr().out == "fetched 0; 0 failed; 3 waiting for the next run\n"
    assert S.main(["x", "fetch", "--raw", raw, "--sources", str(sources)]) == 0
    assert capsys.readouterr().out == "fetched 3; 0 failed\n"                # no budget: the line it always printed
