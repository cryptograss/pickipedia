"""Tests for connectome_walk.py: who is due, what a page says, the lookups, the caps, the budget, the cache's files.

No network: every lookup is handed in. python3 -m pytest -q test_connectome_walk.py
"""
import json
import os

import connectome_store as store
import connectome_walk as walk


def test_a_page_is_due_when_put_in_the_category_after_its_last_walk_oldest_first():
    walked = {"A B": {"requested": "2026-11-18T06:00:00Z"}, "C D": {"requested": "2026-11-18T06:00:00Z"}}
    asked = [("A B", "2026-11-18T06:00:00Z"),              # walked for this very request: not again
             ("C D", "2026-11-18T07:00:00Z"),              # taken off and put back since: again
             ("E F", "2026-11-18T05:00:00Z")]              # never walked
    assert walk.due(asked, walked) == [("E F", "2026-11-18T05:00:00Z"), ("C D", "2026-11-18T07:00:00Z")]


def test_requests_read_every_page_of_the_category_in_the_main_namespace():
    calls = []

    def wiki_get(params):
        calls.append(params)
        if "cmcontinue" not in params:
            return {"query": {"categorymembers": [{"title": "A B", "timestamp": "t1"}]}, "continue": {"cmcontinue": "x"}}
        return {"query": {"categorymembers": [{"title": "C D", "timestamp": "t2"}]}}
    assert walk.requests(wiki_get) == [("A B", "t1"), ("C D", "t2")]
    assert calls[0]["cmtitle"] == "Category:Walk_Requested" and calls[0]["cmnamespace"] == "0"


def test_a_page_says_its_names_and_what_it_and_its_talk_page_link():
    def wiki_get(params):
        assert params["titles"] == "Bronwyn|Talk:Bronwyn"
        return {"query": {"pages": [
            {"title": "Bronwyn", "redirects": [{"title": "Bronwyn Keith-Hynes"}, {"title": "BKH"}],
             "extlinks": [{"url": "https://www.discogs.com/artist/123-Bronwyn-Keith-Hynes"}],
             "revisions": [{"slots": {"main": {"content": "{{MusicianInfo\n|name = Bronwyn Keith Hynes\n|image=x.jpg}}"}}}]},
            {"title": "Talk:Bronwyn", "extlinks": [
                {"url": "https://www.discogs.com/release/38267088-Rattlin-Bones"},
                {"url": "https://musicbrainz.org/release/0b4f1d3e-1111-2222-3333-444455556666"},
                {"url": "https://archive.org/details/bkh2026-03-01.sbd"},
                {"url": "https://www.discogs.com/release/38267088"}]}]}}
    names, links = walk.page_facts(wiki_get, "Bronwyn")
    # one word is too loose to look anybody up by; the redirect and MusicianInfo's name are full names
    assert names == ["Bronwyn Keith-Hynes", "Bronwyn Keith Hynes"]
    assert links == {"discogs-artist": ["123"], "discogs": ["38267088"], "mb": ["0b4f1d3e-1111-2222-3333-444455556666"],
                     "lma": ["bkh2026-03-01.sbd"]}


def test_discogs_releases_are_main_or_appearances_a_master_as_its_main_release_one_per_title_newest_first():
    def get(path):
        assert path.startswith("artists/7/releases")
        return {"releases": [
            {"type": "release", "role": "Main", "id": 1, "title": "Old One", "year": 2001},
            {"type": "master", "role": "Appearance", "id": 900, "main_release": 2, "title": "Mastered", "year": 2010},
            {"type": "release", "role": "Producer", "id": 3, "title": "Produced", "year": 2020},
            {"type": "release", "role": "TrackAppearance", "id": 4, "title": "Newest", "year": 2024},
            {"type": "release", "role": "Appearance", "id": 5, "title": "Newest", "year": 2024},
            {"type": "release", "role": "UnofficialRelease", "id": 6, "title": "Bootleg", "year": 2022}]}
    assert walk.discogs_releases("7", get) == ["discogs 4", "discogs 2", "discogs 1"]


def test_musicbrainz_releases_newest_first_the_undated_last():
    found = {"a": ("2001-01-01", "aaa", "A"), "b": ("9999", "bbb", "B"), "c": ("2019", "ccc", "C")}
    assert walk.mb_releases("m", lambda mbid: found) == ["mb ccc", "mb aaa", "mb bbb"]


def test_one_artist_of_a_name_is_walked_two_are_not_and_a_link_settles_it():
    notes = []
    named = {"Frank Evans": [("1", "Frank Evans"), ("2", "Frank Evans")], "Luke Munday": [("9", "Luke Munday")],
             "No Body": []}
    pick = lambda names, linked=(): walk.lookup_artists("Discogs", names, list(linked), lambda n: named[n], notes)
    assert pick(["Luke Munday"]) == ["9"]
    assert pick(["Frank Evans"]) == []
    assert notes[-1] == "Discogs: 2 artists named Frank Evans; a link to one on the page or its talk page says which"
    assert pick(["Frank Evans"], ["2"]) == ["2"]
    assert pick(["No Body"]) == [] and notes[-1] == "Discogs: no artist named No Body"

    def down(name):
        raise OSError("timed out")
    assert walk.lookup_artists("MusicBrainz", ["Luke Munday"], [], down, notes) == []
    assert notes[-1] == "MusicBrainz: Luke Munday: timed out"


def fake_look(n_discogs=30, n_mb=15, n_lma=25, queries=None):
    def ia(query, rows):
        if queries is not None:
            queries.append(query)
        return [f"tape{i}" for i in range(n_lma)]
    return {"discogs_named": lambda name: [("7", name)],
            "discogs_releases": lambda a: [f"discogs {i}" for i in range(n_discogs)],
            "mb_named": lambda name: [("m1", name)],
            "mb_releases": lambda a: [f"mb {i:08x}-0000-0000-0000-000000000000" for i in range(n_mb)],
            "ia_search": ia}


def test_a_walk_adds_at_most_cap_of_each_kind_past_what_the_store_has_links_first():
    queries = []
    known = {"discogs 0", "discogs 1", "lma tape0"}
    links = {"discogs": ["555"], "lma": ["linked-tape"]}
    sources, notes = walk.walk_one("Kyle Tuttle", ["Kyle Tuttle"], links, known, fake_look(queries=queries))
    assert sources[:2] == ["discogs 555", "lma linked-tape"]
    assert sum(s.startswith("discogs ") for s in sources) == 1 + walk.CAP["discogs"]
    assert sum(s.startswith("mb ") for s in sources) == walk.CAP["mb"]
    assert sum(s.startswith("lma ") for s in sources) == 1 + walk.CAP["lma"]
    assert not set(sources) & known                                  # what the store has is never added, nor counted
    assert "discogs 2" in sources and "lma tape1" in sources
    assert queries == ['"Kyle Tuttle" AND (mediatype:etree OR (mediatype:audio AND collection:taperssection))']
    assert "Discogs: 20 added of 30 found" in notes and "archive.org: 20 added of 25 found" in notes


def test_links_on_a_page_are_capped_too():
    links = {"lma": [f"t{i}" for i in range(80)]}
    sources, _ = walk.walk_one("A B", [], links, set(), fake_look(0, 0, 0))
    assert len(sources) == walk.LINKS_CAP


def test_a_run_walks_the_due_oldest_first_and_starts_none_past_its_budget(tmp_path):
    cache = str(tmp_path)
    sources_file = tmp_path / "connectome_sources.txt"
    sources_file.write_text("# the repo's\ndiscogs 0\n")
    ticks = iter([0, 0, 5, 40, 41])                                  # start; before each walk
    asked = [("C D", "2026-11-18T07:00:00Z"), ("A B", "2026-11-18T06:00:00Z"), ("E F", "2026-11-18T08:00:00Z")]
    facts = lambda t: ([t], {})
    done, waiting, report = walk.run(cache, asked, facts, [str(sources_file)], budget=30, look=fake_look(2, 0, 1),
                                     clock=lambda: next(ticks), stamp=lambda: "2026-11-18T09:00:00Z")
    assert (done, waiting) == (2, 1)
    walked = json.load(open(os.path.join(cache, "walked.json")))
    assert sorted(walked) == ["A B", "C D"]                          # the two oldest; E F waits
    assert walked["A B"]["sources"] == ["discogs 1", "lma tape0"]   # discogs 0 is the repo's
    assert walked["C D"]["sources"] == []                            # A B's finds aren't added twice
    text = open(os.path.join(cache, "walked_sources.txt")).read().splitlines()
    assert "# A B: put in the category 2026-11-18T06:00:00Z, walked 2026-11-18T09:00:00Z" in text
    assert text.index("discogs 1") > text.index("# A B: put in the category 2026-11-18T06:00:00Z, walked 2026-11-18T09:00:00Z")
    assert open(os.path.join(cache, "walked_names.txt")).read() == "A B\nC D\n"
    # the store reads what the walker writes
    assert store.read_sources(os.path.join(cache, "walked_sources.txt")) == {"discogs": ["1"], "mb": [], "lma": ["tape0"]}
    # the next run: only E F is due
    done, waiting, _ = walk.run(cache, asked, facts, [str(sources_file)], look=fake_look(0, 0, 0),
                                stamp=lambda: "2026-11-18T10:00:00Z")
    assert (done, waiting) == (1, 0)


def test_a_page_the_wiki_does_not_answer_for_waits_and_a_walk_by_hand_says_so(tmp_path):
    cache = str(tmp_path)

    def facts(title):
        raise OSError("502")
    done, waiting, report = walk.run(cache, [("A B", "t")], facts, [], look=fake_look(0, 0, 0))
    assert done == 0 and "not walked" in report[0] and not json.load(open(os.path.join(cache, "walked.json")))
    walk.run(cache, [("A B", "2026-11-18T09:00:00Z")], lambda t: ([t], {}), [], look=fake_look(0, 0, 0), by="hand")
    assert "# A B: asked for by hand, walked" in open(os.path.join(cache, "walked_sources.txt")).read()
    # a request put in the category later than the walk by hand walks again; an older one doesn't
    walked = json.load(open(os.path.join(cache, "walked.json")))
    assert walk.due([("A B", "2026-11-18T08:00:00Z")], walked) == []
    assert walk.due([("A B", "2026-11-18T10:00:00Z")], walked) == [("A B", "2026-11-18T10:00:00Z")]


def test_the_store_fetches_from_both_sources_files_and_reads_both_names_files(tmp_path, capsys):
    raw = tmp_path / "raw"
    (raw / "lma" / "items").mkdir(parents=True)
    item = {"metadata": {"identifier": "x2025", "creator": "Band", "date": "2025-01-01", "title": "Band Live",
                         "description": "Lineup: Kyle Tuttle - banjo, Maddie Dalton - bass",
                         "collection": ["taperssection"]}, "files": []}
    (raw / "lma" / "items" / "x2025.json").write_text(json.dumps(item))
    one, two = tmp_path / "names.txt", tmp_path / "walked_names.txt"
    one.write_text("Kyle Tuttle\n")
    two.write_text("Maddie Dalton\nKyle Tuttle\n")
    out = tmp_path / "credits.jsonl"
    store.main(["x", "build", "--raw", str(raw), "--lma-names", str(one), str(two), "--out", str(out)])
    people = sorted({json.loads(l)["person"] for l in open(out)})
    assert people == ["Kyle Tuttle", "Maddie Dalton"]
    a, b = tmp_path / "a.txt", tmp_path / "b.txt"
    a.write_text("discogs 1\nlma x2025\n")
    b.write_text("# walked\ndiscogs 1\ndiscogs 2\n")
    seen = {}
    orig = store.fetch
    store.fetch = lambda raw, discogs=(), mb=(), lma=(), budget=None: (seen.update(d=list(discogs), l=list(lma)), (0, [], 0))[1]
    try:
        store.main(["x", "fetch", "--raw", str(raw), "--sources", str(a), str(b)])
    finally:
        store.fetch = orig
    assert seen == {"d": ["1", "2"], "l": ["x2025"]}
