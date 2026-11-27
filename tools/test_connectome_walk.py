"""Tests for connectome_walk.py: who is due, what a page says, the lookups, the caps, the budget, the cache's files,
and the question a walk asks when a site has several artists of one name (the Which picker box).

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
    names, links, boxed, cats = walk.page_facts(wiki_get, "Bronwyn")
    assert boxed is False and cats == set()
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


# ---------------------------------------------------------------------------
# Which picker: several artists of one name on a site
# ---------------------------------------------------------------------------

SIX = [(str(n), "Jack Schneider") for n in (3847115, 3926070, 5499013, 7190407, 14173018, 17542158)]
ABOUT = {"3847115": {"releases": 24, "years": [1975, 2025], "titles": ["Streets Of September", "Something Crossed My Mind"]},
         "3926070": {"releases": 3, "years": [2014, 2016], "titles": ["Plaza"]}}
MB_TWO = [("7b031960-b66f-4af0-b3f8-d9d957105631", "Jack Schneider"), ("8b031960-b66f-4af0-b3f8-d9d957105631", "Jack Schneider")]


def ask_look(discogs=SIX, mb=(), about=ABOUT):
    def discogs_about(artist_id):
        if artist_id not in about:
            raise RuntimeError("HTTP Error 404")
        return dict(about[artist_id])
    return {"discogs_named": lambda name: list(discogs), "discogs_releases": lambda a: [f"discogs {a}00"],
            "mb_named": lambda name: list(mb), "mb_releases": lambda a: ["mb " + a],
            "ia_search": lambda q, rows: [], "discogs_about": discogs_about, "mb_about": lambda a: {"releases": 1, "says": "fiddler, US"}}


def test_several_artists_of_one_name_are_asked_about_each_with_what_the_site_says():
    asks = []
    sources, notes = walk.walk_one("Jack Schneider", ["Jack Schneider"], {}, set(), ask_look(), asks)
    assert sources == [] and "Discogs: 6 artists named Jack Schneider" in notes[0]
    assert [(a["site"], a["name"], a["found"], len(a["candidates"])) for a in asks] == [("Discogs", "Jack Schneider", 6, 6)]
    first, third = asks[0]["candidates"][0], asks[0]["candidates"][2]
    assert first == {"url": "https://www.discogs.com/artist/3847115", "name": "Jack Schneider", "releases": 24,
                     "years": [1975, 2025], "titles": ["Streets Of September", "Something Crossed My Mind"]}
    assert third["url"].endswith("/5499013") and "releases" not in third and "404" in third["note"]   # the site said nothing of this one: still asked


def test_a_linked_artist_or_a_single_one_asks_nothing():
    asks = []
    walk.walk_one("Jack Schneider", ["Jack Schneider"], {"discogs-artist": ["3847115"]}, set(), ask_look(), asks)
    assert asks == []
    walk.walk_one("Jack Schneider", ["Jack Schneider"], {}, set(), ask_look(discogs=SIX[:1]), asks)
    assert asks == []


def test_no_more_than_the_cap_are_looked_at_and_the_box_says_how_many_were_left():
    many = [(str(n), "Sam Jones") for n in range(100, 100 + walk.CANDIDATES_CAP + 3)]
    looked = []

    def about(artist_id):
        looked.append(artist_id)
        return {"releases": 1}
    ask = walk.candidates("Discogs", "Sam Jones", many, about)
    assert len(looked) == walk.CANDIDATES_CAP == len(ask["candidates"]) and ask["found"] == walk.CANDIDATES_CAP + 3
    assert "* and 3 more named Sam Jones that this walk did not look at" in walk.which_boxes([ask])


def test_an_id_that_is_not_one_makes_no_link():
    ask = walk.candidates("Discogs", "Sam Jones", [("12", "Sam Jones"), ("12]] [[evil", "Sam Jones"), ("../x", "Sam Jones")], None)
    assert [c["url"] for c in ask["candidates"]] == ["https://www.discogs.com/artist/12"]
    ask = walk.candidates("MusicBrainz", "Sam Jones", [MB_TWO[0], ("nope", "Sam Jones")], None)
    assert [c["url"] for c in ask["candidates"]] == ["https://musicbrainz.org/artist/7b031960-b66f-4af0-b3f8-d9d957105631"]


def test_the_box_is_one_a_site_marked_proposed_and_says_only_what_the_site_gave():
    asks = []
    walk.walk_one("Jack Schneider", ["Jack Schneider"], {}, set(), ask_look(mb=MB_TWO), asks)
    box = walk.which_boxes(asks)
    assert box.count("{{Which picker\n|status=proposed\n|site=") == 2 and box.index("site=Discogs") < box.index("site=MusicBrainz")
    assert '* [https://www.discogs.com/artist/3847115 Jack Schneider]: 24 releases, 1975 to 2025: "Streets Of September", "Something Crossed My Mind"\n' in box
    assert '* [https://www.discogs.com/artist/3926070 Jack Schneider]: 3 releases, 2014 to 2016: "Plaza"\n' in box
    assert "* [https://www.discogs.com/artist/5499013 Jack Schneider]\n" in box                      # nothing known: nothing said
    assert "* [https://musicbrainz.org/artist/7b031960-b66f-4af0-b3f8-d9d957105631 Jack Schneider] (fiddler, US): 1 release\n" in box
    assert box.endswith("}}\n")
    assert walk.candidate_line({"url": "u", "name": "N", "releases": 2, "years": [1956, 1956]}) == "* [u N]: 2 releases, 1956"
    assert walk.candidate_line({"url": "u", "name": "N", "releases": 0, "years": [], "titles": []}) == "* [u N]: 0 releases"


def test_a_sites_words_cannot_be_wikitext():
    hostile = "A|B {{Delete}} [[Category:X]] <script>x</script> " + "'" * 3 + " ~~~~ status=verified __NOTOC__ http://evil.example }}"
    ask = {"site": "Discogs", "name": hostile, "found": 1, "candidates": [
        {"url": "https://www.discogs.com/artist/1", "name": hostile, "releases": 1, "says": hostile, "titles": [hostile]}]}
    box = walk.which_boxes([ask])
    body = box[len("{{Which picker\n|status=proposed\n|site=Discogs\n|1=\n"):-len("}}\n")]
    for bad in ("{{", "}}", "[[", "]]", "<", "|", "'" * 2, "~~~", "=", "__", "://evil"):
        assert bad not in body.replace("* [https://www.discogs.com/artist/1 ", ""), bad
    assert box.count("{{") == 1 and box.count("}}") == 1          # the wiki's gate reads the call by its braces
    assert "\n" not in walk.plain("two\nlines\r\n* three")        # nor can they start a line of their own


def test_a_box_on_the_page_is_taken_out_before_its_links_are_read():
    text = ("{{Which picker\n|status=proposed\n|site=Discogs\n|1=\n* [https://www.discogs.com/artist/3847115 Jack Schneider]: {{nested|x}}\n"
            "* [https://www.discogs.com/artist/3926070 Jack Schneider (2)]\n}}\n{{MusicianInfo|name=Jack Schneider}}\nHe is [https://www.discogs.com/artist/3847115 this one].")
    rest, boxed = walk.without_boxes(text)
    assert boxed and "3926070" not in rest and "MusicianInfo" in rest and "this one" in rest
    assert walk.without_boxes("{{MusicianInfo|name=A B}}") == ("{{MusicianInfo|name=A B}}", False)
    assert walk.without_boxes("x {{which_picker|1=a") == ("x ", True)                              # never closed: all of it goes

    posted = []

    def wiki_get(params, post=False):
        if params["action"] == "parse":
            posted.append((params, post))
            return {"parse": {"externallinks": ["https://www.discogs.com/artist/3847115"]}}
        return {"query": {"pages": [
            {"title": "Jack Schneider", "revisions": [{"slots": {"main": {"content": text}}}],
             "categories": [{"title": "Category:Walk Requested"}],
             "extlinks": [{"url": "https://www.discogs.com/artist/3847115"}, {"url": "https://www.discogs.com/artist/3926070"}]},
            {"title": "Talk:Jack Schneider", "extlinks": [{"url": "https://archive.org/details/js2020-01-01"}]}]}}
    names, links, boxed, cats = walk.page_facts(wiki_get, "Jack Schneider")
    assert cats == {"Category:Walk_Requested"}
    assert boxed and links == {"discogs-artist": ["3847115"], "lma": ["js2020-01-01"]}                # the one said outside the box, and the talk page's
    assert posted[0][1] is True and "Which picker" not in posted[0][0]["text"] and posted[0][0]["title"] == "Jack Schneider"


def run_ask(cache, facts, prepend, asked=(("Jack Schneider", "2026-11-20T03:11:18Z"),), look=None):
    return walk.run(str(cache), list(asked), facts, [], look=look or ask_look(), stamp=lambda: "2026-11-20T04:00:00Z", prepend=prepend)


def test_a_walk_puts_its_question_at_the_top_of_the_page_once(tmp_path):
    saved = []

    def prepend(title, text, summary):
        saved.append((title, text, summary))
        return 18200
    done, waiting, report = run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), prepend)
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert done == 1 and len(saved) == 1 and saved[0][0] == "Jack Schneider"
    assert saved[0][1].startswith("{{Which picker\n|status=proposed\n|site=Discogs\n") and "Artificial Dumb" in saved[0][2]
    assert w["box"] == {"state": "written", "at": "2026-11-20T04:00:00Z", "rev": 18200} and len(w["asks"][0]["candidates"]) == 6
    assert "Which picker box: written (revision 18200)" in report[0]
    # the next run: not due, nothing wanted, nothing written
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, True), prepend)
    assert len(saved) == 1


def test_a_page_that_has_a_box_gets_no_second_one(tmp_path):
    saved = []
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, True), lambda *a: saved.append(a))
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert saved == [] and w["box"]["state"] == "the page has one" and w["asks"]                      # the candidates are still listed


def test_with_no_login_the_question_waits_and_a_later_run_writes_it(tmp_path):
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None)
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert w["box"]["state"] == "wanted" and "no login" in w["box"]["note"]
    saved = []
    done, waiting, report = run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), lambda *a: saved.append(a) or 7)
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert done == 0 and len(saved) == 1 and w["box"]["state"] == "written" and w["box"]["rev"] == 7
    assert "the question from its walk of 2026-11-20T04:00:00Z; Which picker box: written" in report[0]


def test_a_question_that_waited_is_dropped_when_the_page_has_answered_or_been_asked(tmp_path):
    for n, (facts, state) in enumerate(((lambda t: (["Jack Schneider"], {"discogs-artist": ["3847115"]}, False), "answered: the page links one"),
                                        (lambda t: (["Jack Schneider"], {}, True), "the page has one"))):
        cache = tmp_path / str(n)
        cache.mkdir()
        run_ask(cache, lambda t: (["Jack Schneider"], {}, False), None)
        saved = []
        run_ask(cache, facts, lambda *a: saved.append(a))
        assert saved == [] and json.load(open(cache / "walked.json"))["Jack Schneider"]["box"]["state"] == state


def test_one_site_answered_leaves_the_other_sites_question(tmp_path):
    saved = []
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None, look=ask_look(mb=MB_TWO))
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {"discogs-artist": ["3847115"]}, False), lambda *a: saved.append(a) or 9)
    assert len(saved) == 1 and "site=MusicBrainz" in saved[0][1] and "site=Discogs" not in saved[0][1] and "MusicBrainz" in saved[0][2]


def test_a_save_the_wiki_refuses_is_tried_again_next_run_and_the_walk_still_counts(tmp_path):
    def refuses(title, text, summary):
        raise RuntimeError("the wiki said pickipediaverification-bot-needs-proposed")
    done, waiting, report = run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), refuses)
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert done == 1 and w["box"] == {"state": "wanted", "note": "the wiki said pickipediaverification-bot-needs-proposed",
                                      "tried": "2026-11-20T04:00:00Z"}
    assert os.path.exists(tmp_path / "walked_sources.txt")
    tries = []
    later = lambda when: walk.run(str(tmp_path), [("Jack Schneider", "2026-11-20T03:11:18Z")], lambda t: (["Jack Schneider"], {}, False), [],
                                  look=ask_look(), stamp=lambda: when, prepend=lambda *a: tries.append(a) or 3)
    later("2026-11-20T04:05:00Z")                                # the next build, five minutes on: not yet
    later("2026-11-20T04:59:59Z")
    assert tries == []
    later("2026-11-20T05:00:00Z")                                # an hour on: again
    assert len(tries) == 1 and json.load(open(tmp_path / "walked.json"))["Jack Schneider"]["box"]["rev"] == 3


def test_old_walks_and_walks_that_asked_nothing_have_no_box(tmp_path):
    saved = []
    run_ask(tmp_path, lambda t: ([t], {}), lambda *a: saved.append(a), look=ask_look(discogs=SIX[:1]))   # facts in the old shape, two things
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert saved == [] and "box" not in w and "asks" not in w and w["sources"] == ["discogs 384711500"]


class FakeWiki:
    """The wiki's API as the editor meets it: tokens, a bot password's login, an edit."""
    def __init__(self, login="Success", edit=None):
        self.calls, self.login, self.edit = [], login, edit or {"edit": {"result": "Success", "newrevid": 18201}}
        self.text = "{{MusicianInfo|name=Jack Schneider}}\n[[Category:Walk Requested]]\n"
        self.saved = ["2026-11-20T05:00:00Z"]                    # when the page's newest revision was saved, at each read; the wiki's clock says 05:20:00

    def open(self, req, timeout=None):
        from urllib.parse import parse_qs, urlsplit
        q = {k: v[0] for k, v in parse_qs(req.data.decode() if req.data else urlsplit(req.full_url).query).items()}
        self.calls.append((req.get_method(), q))
        if q["action"] == "query" and "meta" not in q:
            body = {"curtimestamp": "2026-11-20T05:20:00Z", "query": {"pages": [
                {"title": q["titles"], "revisions": [{"revid": 41, "timestamp": (self.saved.pop(0) if len(self.saved) > 1 else self.saved[0]),
                                                      "slots": {"main": {"content": self.text}}}]}
                if self.text is not None else {"title": q["titles"], "missing": True}]}}
        elif q["action"] == "query":
            body = {"query": {"tokens": {q["type"] + "token": q["type"] + "+\\"}}}
        elif q["action"] == "login":
            body = {"login": {"result": self.login}}
        else:
            body = self.edit

        class Answer:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return json.dumps(body).encode()
        return Answer()


def test_the_editor_logs_in_once_and_prepends_to_a_page_that_exists():
    wiki = FakeWiki()
    prepend = walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki)
    assert prepend("Jack Schneider", "{{Which picker}}\n", "why") == 18201
    assert prepend("Sam Jones", "{{Which picker}}\n", "why") == 18201
    acts = [(m, q["action"]) for m, q in wiki.calls]
    assert acts == [("GET", "query"), ("POST", "login"), ("GET", "query"), ("POST", "edit"), ("GET", "query"), ("POST", "edit")]
    edit = wiki.calls[3][1]
    assert edit["prependtext"] == "{{Which picker}}\n" and edit["nocreate"] == "1" and edit["assert"] == "user" and edit["token"] == "csrf+\\"
    assert "text" not in edit and "appendtext" not in edit                                             # it can only add to the top
    assert all("s3cret" not in json.dumps(q) for m, q in wiki.calls if m == "GET")                     # the password goes by POST only


def test_the_editor_says_what_the_wiki_said_and_never_the_password():
    for wiki, word in ((FakeWiki(login="Failed"), "would not log the walk in (Failed)"),
                       (FakeWiki(edit={"error": {"code": "protectedpage", "info": "s3cret"}}), "the wiki said protectedpage"),
                       (FakeWiki(edit={"edit": {"result": "Failure"}}), "did not save it (Failure)")):
        try:
            walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki)("A B", "x", "y")
            assert False, "it should have raised"
        except RuntimeError as e:
            assert word in str(e) and "s3cret" not in str(e)


def test_an_artist_is_asked_about_once_a_walk_however_many_names_find_them():
    looked = []
    look = ask_look()
    look["discogs_about"] = lambda a: looked.append(a) or {"releases": 2}
    asks = []
    walk.walk_one("Jack Schneider", ["Jack Schneider", "Jack W. Schneider", "J. Schneider"], {}, set(), look, asks)
    assert len(asks) == 3 and sorted(looked) == sorted(i for i, _ in SIX)                           # three names, six lookups, not eighteen
    assert all(c["releases"] == 2 for a in asks for c in a["candidates"])
    assert walk.which_boxes(asks).count("* [https://www.discogs.com/artist/") == 6                  # and each once in the box


def test_past_its_budget_a_walk_lists_the_rest_by_name_and_link_alone():
    now = [0.0]
    look = ask_look(mb=MB_TWO)

    def slow(artist_id):                                         # a site answering in ten seconds
        now[0] += 10
        return {"releases": 1}
    look["discogs_about"] = look["mb_about"] = slow
    asks = []
    walk.walk_one("Jack Schneider", ["Jack Schneider"], {}, set(), look, asks, clock=lambda: now[0])
    told = [("releases" in c) for a in asks for c in a["candidates"]]
    assert told == [True, True, True] + [False] * 5 and now[0] == 30   # 25 seconds gone after the third: no fourth is asked, on either site
    box = walk.which_boxes(asks)
    assert "* [https://www.discogs.com/artist/7190407 Jack Schneider]\n" in box and "* [https://musicbrainz.org/artist/" + MB_TWO[1][0] + " Jack Schneider]\n" in box


def test_a_question_still_waiting_is_dropped_only_when_its_page_is_in_neither_category(tmp_path):
    # the walk itself moves a page from Walk Requested to Walked: its question stays (magent and blu, 20 Nov 2026)
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None)
    saved = []
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False, {"Category:Walked"}), lambda *a: saved.append(a) or 5, asked=())
    assert len(saved) == 1 and json.load(open(tmp_path / "walked.json"))["Jack Schneider"]["box"]["state"] == "written"
    # someone took it out of both: it isn't asked
    other = tmp_path / "out"
    other.mkdir()
    run_ask(other, lambda t: (["Jack Schneider"], {}, False), None)
    saved = []
    done, waiting, report = run_ask(other, lambda t: (["Jack Schneider"], {}, False, set()), lambda *a: saved.append(a) or 5, asked=())
    w = json.load(open(other / "walked.json"))["Jack Schneider"]
    assert saved == [] and w["box"] == {"state": "dropped: the page is in neither category", "at": "2026-11-20T04:00:00Z"} and w["asks"]
    assert "dropped: the page is in neither category" in report[0]
    run_ask(other, lambda t: (["Jack Schneider"], {}, False, {"Category:Walk_Requested"}), lambda *a: saved.append(a) or 5)
    assert saved == []                                           # put back with no new walk due: it stays dropped


def test_a_walk_by_hand_leaves_other_pages_questions_waiting(tmp_path):
    run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None)
    saved = []
    walk.run(str(tmp_path), [("Sam Jones", "2026-11-20T05:00:00Z")], lambda t: ([t], {}, False), [], look=ask_look(discogs=SIX[:1]),
             stamp=lambda: "2026-11-20T05:00:00Z", prepend=lambda *a: saved.append(a) or 5, by="hand")
    assert saved == [] and json.load(open(tmp_path / "walked.json"))["Jack Schneider"]["box"]["state"] == "wanted"


# ---------------------------------------------------------------------------
# The queue: a walked page goes from Walk Requested to Walked
# ---------------------------------------------------------------------------

def test_the_request_becomes_walked_where_it_stood_and_nothing_else_changes():
    swap = lambda text: walk.swap_category(text)[0]
    page = "{{MusicianInfo|name=J}}\nHe plays.\n[[Category:Walk Requested]]\n[[Category:Banjo players]]\n"
    assert walk.swap_category(page) == (page.replace("Walk Requested", "Walked"), None)
    assert swap("a\n[[category:walk_requested|Schneider, Jack]] [[Category:X]]\nb") == "a\n[[Category:Walked|Schneider, Jack]] [[Category:X]]\nb"
    assert swap("[[Category:Walk_Requested| ]]") == "[[Category:Walked| ]]"                             # a sort key of a space, to head the list: kept as it is
    assert swap("[[Category:Walked|Schneider, Jack]]\n[[Category:Walk Requested|Jack]]") == "[[Category:Walked|Schneider, Jack]]\n"   # in Walked already: its own key stands
    assert swap("a\n[[Category:X]] [[Category:Walk Requested]]") == "a\n[[Category:X]] [[Category:Walked]]"
    assert swap("a\n  [[ Category : Walk  Requested ]]") == "a\n  [[Category:Walked]]"
    # in Walked already: the request goes, and its own line with it
    assert swap("a\n[[Category:Walked]]\n[[Category:Walk Requested]]\nb\n") == "a\n[[Category:Walked]]\nb\n"
    assert swap("[[Category:Walk Requested]]\n[[Category:Walk Requested]]") == "[[Category:Walked]]\n"
    assert swap("a\n[[Category:Walked]] [[Category:Walk Requested]]") == "a\n[[Category:Walked]] "


def test_a_page_whose_own_text_does_not_hold_the_category_is_not_rewritten():
    for text in ("{{Walk me}}", "see [[:Category:Walk Requested]]", "<nowiki>[[Category:Walk Requested]]</nowiki>",
                 "<!-- [[Category:Walk Requested]] -->", "<pre>[[Category:Walk Requested]]</pre>", "[[Category:Walk Requested players]]", ""):
        assert walk.swap_category(text) == (None, walk.NOT_IN_TEXT), text
    both = "<!-- [[Category:Walk Requested]] -->\n[[Category:Walk Requested]]"
    assert walk.swap_category(both)[0] == "<!-- [[Category:Walk Requested]] -->\n[[Category:Walked]]"   # the real one moves, the comment stays


def test_a_request_that_shares_its_line_with_words_is_left_for_the_gate_would_refuse_it():
    # PickiPediaVerification lets a bot add or change a line unmarked only where it begins with a category
    for text in ("He plays bass. [[Category:Bassists]] [[Category:Walk Requested|Partin, Jeff]]\n",
                 "a [[Category:Walked]] x [[Category:Walk Requested]] y", "[[category:x]] [[Category:Walk Requested]]",
                 "{{MusicianInfo|name=J}}[[Category:Walk Requested]]", "* [[Category:Walk Requested]]"):
        assert walk.swap_category(text) == (None, walk.SHARES_A_LINE), text


def moved(tmp_path):
    return json.load(open(tmp_path / "walked.json"))["Jack Schneider"].get("category")


def test_a_walk_that_is_done_moves_its_page_the_box_first(tmp_path):
    did = []
    done, waiting, report = walk.run(str(tmp_path), [("Jack Schneider", "2026-11-20T03:11:18Z")], lambda t: (["Jack Schneider"], {}, False), [],
                                     look=ask_look(), stamp=lambda: "2026-11-20T04:00:00Z",
                                     prepend=lambda *a: did.append("box") or 7, swap=lambda title, summary: did.append(("swap", title, summary)) or 8)
    assert did[0] == "box" and did[1][:2] == ("swap", "Jack Schneider") and "Put Walk Requested back to walk again" in did[1][2] and len(did) == 2
    assert moved(tmp_path) == {"state": "moved to Walked", "at": "2026-11-20T04:00:00Z", "rev": 8}
    assert "Which picker box: written (revision 7); category: moved to Walked (revision 8)" in report[0]


def test_with_no_login_nothing_moves_and_the_walk_is_as_it_was(tmp_path):
    done, waiting, report = run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None)
    assert done == 1 and moved(tmp_path) is None and "category" not in report[0]
    done, waiting, report = run_ask(tmp_path, lambda t: (["Jack Schneider"], {}, False), None)     # still in the category: not walked again
    assert done == 0 and report == []


def test_pages_walked_before_and_still_in_the_category_are_moved_by_a_later_run(tmp_path):
    asked = [("Charlie Worsham", "2026-11-19T18:00:00Z"), ("Jack Schneider", "2026-11-20T03:11:18Z")]
    one = ask_look(discogs=SIX[:1])
    walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: "2026-11-20T04:00:00Z")       # no login: both walked, both stay
    did = []
    done, waiting, report = walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: "2026-11-20T06:00:00Z",
                                     swap=lambda title, summary: did.append(title) or 9)
    assert done == 0 and did == ["Charlie Worsham", "Jack Schneider"] and moved(tmp_path)["state"] == "moved to Walked"
    assert "Charlie Worsham: walked 2026-11-20T04:00:00Z; category: moved to Walked (revision 9)" in report
    walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: "2026-11-20T06:05:00Z", swap=lambda title, summary: did.append(title) or 9)
    assert len(did) == 2                                         # the wiki's list a build behind: not moved twice


def test_putting_the_request_back_walks_the_page_again_and_moves_it_again(tmp_path):
    one, did, facts = ask_look(discogs=SIX[:1]), [], lambda t: ([t], {})
    swap = lambda title, summary: did.append(title) or 9
    walk.run(str(tmp_path), [("Jack Schneider", "2026-11-20T03:11:18Z")], facts, [], look=one, stamp=lambda: "2026-11-20T04:00:00Z", swap=swap)
    done, _, _ = walk.run(str(tmp_path), [], facts, [], look=one, stamp=lambda: "2026-11-20T04:05:00Z", swap=swap)     # out of the queue: nothing to do
    assert done == 0 and did == ["Jack Schneider"]
    done, _, report = walk.run(str(tmp_path), [("Jack Schneider", "2026-11-27T12:00:00Z")], facts, [], look=one, stamp=lambda: "2026-11-27T12:03:00Z", swap=swap)
    w = json.load(open(tmp_path / "walked.json"))["Jack Schneider"]
    assert done == 1 and did == ["Jack Schneider"] * 2 and w["walked"] == "2026-11-27T12:03:00Z" and w["category"]["at"] == "2026-11-27T12:03:00Z"


def test_a_move_the_wiki_refuses_keeps_the_walk_and_is_tried_again_after_an_hour(tmp_path):
    asked, one, tries = [("Jack Schneider", "2026-11-20T03:11:18Z")], ask_look(discogs=SIX[:1]), []

    def conflict(title, summary):
        raise RuntimeError("the wiki said editconflict")
    done, _, report = walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: "2026-11-20T04:00:00Z", swap=conflict)
    assert done == 1 and moved(tmp_path) == {"state": "wanted", "note": "the wiki said editconflict", "tried": "2026-11-20T04:00:00Z"}
    assert json.load(open(tmp_path / "walked.json"))["Jack Schneider"]["sources"] == ["discogs 384711500"]
    later = lambda when: walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: when, swap=lambda t, s: tries.append(t) or 9)
    later("2026-11-20T04:05:00Z")
    assert tries == []
    later("2026-11-20T05:00:00Z")
    assert tries == ["Jack Schneider"] and moved(tmp_path)["state"] == "moved to Walked"


def test_a_page_in_the_category_by_a_template_is_left_and_said_so_once_an_hour(tmp_path):
    asked, one, tries = [("Jack Schneider", "2026-11-20T03:11:18Z")], ask_look(discogs=SIX[:1]), []
    swap = lambda title, summary: tries.append(title) or walk.NOT_IN_TEXT   # a reason, not a revision: nothing was saved
    for when in ("2026-11-20T04:00:00Z", "2026-11-20T04:05:00Z", "2026-11-20T04:10:00Z"):
        walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: when, swap=swap)
    assert len(tries) == 1 and moved(tmp_path) == {"state": "left: the category is not in the page's own text", "tried": "2026-11-20T04:00:00Z"}


def test_a_walk_by_hand_moves_nothing(tmp_path):
    did = []
    walk.run(str(tmp_path), [("Jack Schneider", "2026-11-20T03:11:18Z")], lambda t: ([t], {}), [], look=ask_look(discogs=SIX[:1]),
             stamp=lambda: "2026-11-20T04:00:00Z", swap=lambda *a: did.append(a) or 9, by="hand")
    assert did == [] and moved(tmp_path) is None


def test_moving_stops_with_the_budget(tmp_path):
    asked = [(f"Picker {n}", "2026-11-20T03:00:00Z") for n in "ABC"]
    one = ask_look(discogs=SIX[:1])
    walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], look=one, stamp=lambda: "2026-11-20T04:00:00Z")
    now, did = [0.0], []

    def swap(title, summary):
        now[0] += 20
        did.append(title)
        return 9
    walk.run(str(tmp_path), asked, lambda t: ([t], {}), [], budget=30, look=one, clock=lambda: now[0], stamp=lambda: "2026-11-20T06:00:00Z", swap=swap)
    assert did == ["Picker A", "Picker B"]                       # the third waits for the next build


def test_the_editor_moves_a_page_against_the_revision_it_read():
    wiki = FakeWiki()
    prepend = walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki)
    assert prepend.swap("Jack Schneider", "why") == 18201
    edit = [q for m, q in wiki.calls if q["action"] == "edit"][0]
    assert edit["text"] == "{{MusicianInfo|name=Jack Schneider}}\n[[Category:Walked]]\n" and edit["nocreate"] == "1" and edit["assert"] == "user"
    assert (edit["baserevid"], edit["basetimestamp"], edit["starttimestamp"]) == ("41", "2026-11-20T05:00:00Z", "2026-11-20T05:20:00Z")
    assert [q["action"] for m, q in wiki.calls].count("login") == 1 and prepend("A B", "x", "y") == 18201      # one login for both
    assert [q["action"] for m, q in wiki.calls].count("login") == 1


def test_the_editor_saves_nothing_where_the_text_has_no_request_and_says_what_the_wiki_said():
    wiki = FakeWiki()
    wiki.text = "{{MusicianInfo|name=Jack Schneider}}\n{{Walk me}}\n"
    assert walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki).swap("Jack Schneider", "why") == walk.NOT_IN_TEXT
    wiki.text = "He plays bass. [[Category:Walk Requested]]\n"
    assert walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki).swap("Jeff Partin", "why") == walk.SHARES_A_LINE
    assert not [q for m, q in wiki.calls if q["action"] == "edit"]
    wiki = FakeWiki(edit={"error": {"code": "editconflict", "info": "s3cret"}})
    for text, word in ((wiki.text, "the wiki said editconflict"), (None, "no such page")):
        wiki.text = text
        try:
            walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki).swap("Jack Schneider", "why")
            assert False, "it should have raised"
        except RuntimeError as e:
            assert word in str(e) and "s3cret" not in str(e)


def test_the_editor_does_not_save_over_a_revision_made_this_second():
    # the walk's own box, a second old: wait, read again, then save
    wiki, slept = FakeWiki(), []
    wiki.saved = ["2026-11-20T05:19:59Z", "2026-11-20T05:19:57Z"]
    prepend = walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki, sleep=slept.append)
    assert prepend.swap("Jack Schneider", "why") == 18201 and slept == [1.5]
    assert [q["action"] for m, q in wiki.calls if "meta" not in q].count("query") == 2 and [q for m, q in wiki.calls if q["action"] == "edit"][0]["basetimestamp"] == "2026-11-20T05:19:57Z"
    # edited again meanwhile: nothing is saved, and the move waits
    wiki, slept = FakeWiki(), []
    wiki.saved = ["2026-11-20T05:20:00Z", "2026-11-20T05:19:59Z"]
    try:
        walk.wiki_editor("https://wiki.example/", "Blu@walk", "s3cret", opener=wiki, sleep=slept.append).swap("Jack Schneider", "why")
        assert False, "it should have raised"
    except RuntimeError as e:
        assert "edited a moment ago" in str(e) and slept == [2.5] and not [q for m, q in wiki.calls if q["action"] == "edit"]
