#!/usr/bin/env python3
"""
Tests for Homeplace, the reader of our own sources.

What these guard: a show's ensemble and its featured guests both land on the
show, told apart by scope; a studio cut's ensemble lands on its record at
track scope; wiki rows group by record; names are copied as written and
never merged; every edge carries its source. Canned YAML and canned ask
rows only; nothing touches the network.
"""

import json

import homeplace
import rambler

BUNDY = {
    "title": "Justin Holmes at The Bundy Museum",
    "venue": "The Bundy Museum",
    "ensemble": {"Justin Holmes": ["guitar"], "Skyler Golden": ["bass"],
                 "Christina Docenko": ["fiddle"], "Paul Sanna": ["banjo"]},
    "sets": {0: {"songplays": [
        {"Vowel Sounds": {"mode": "segue"}},
        "Salt Creek",
        {"Startropics Theme": None, "mode": "segue",
         "ensemble-modifications": {"featuring": ["Fibonacci Emery Holmes (keys)"]}},  # arthel's flat form
        {"Can the Circle Be Unbroken": {"ensemble-modifications": {"featuring": ["Fibonacci Emery Holmes (vocals)"]}}},
        {"O Death": {"ensemble-modifications": {"solo": "Justin"}}},
    ]}},
}

AUGUST = {"studio_versions": {0: {"Vowel Sounds": {
    "record": "3 April, 2024", "engineer": "Jake Stargel",
    "ensemble": {"Justin Holmes": ["guitar", "six-whistle"], "Harry Clark": ["mandolin"],
                 "Maddie Denton": ["fiddle"]}}}}}


def test_show_ensemble_and_featured_guests():
    rec = homeplace.arthel_show("0-25254342", BUNDY, "src")
    assert rec["kind"] == "show" and rec["date"] == "block 25254342"
    assert rec["people"]["Christina Docenko"]["roles"] == {"fiddle"}
    assert rec["people"]["Christina Docenko"]["scopes"] == {"show"}
    fib = rec["people"]["Fibonacci Emery Holmes"]
    assert fib["roles"] == {"keys", "vocals"} and fib["scopes"] == {"song"}
    assert "Justin" not in rec["people"]  # a solo nickname is not a person
    assert all(p["sources"] == {"src"} for p in rec["people"].values())


def test_featured_entry_forms():
    assert homeplace.parse_featured("Shaka Lei Kaumaka") == ("Shaka Lei Kaumaka", [])
    assert homeplace.parse_featured("Mark Hansen (cajon)") == ("Mark Hansen", ["cajon"])
    assert homeplace.parse_featured("A Person (guitar, vocals)") == ("A Person", ["guitar", "vocals"])


def test_studio_cut_lands_on_its_record_at_track_scope():
    cuts = homeplace.arthel_cuts("august", AUGUST, "src")
    assert cuts == [("Vowel Sounds", "3 April, 2024",
                     {"Justin Holmes": ["guitar", "six-whistle"], "Harry Clark": ["mandolin"],
                      "Maddie Denton": ["fiddle"]})]


def test_read_arthel_builds_records_and_shows(tmp_path):
    import yaml
    (tmp_path / "shows").mkdir()
    (tmp_path / "songs_and_tunes").mkdir()
    (tmp_path / "shows" / "0-25254342.yaml").write_text(yaml.safe_dump(BUNDY))
    (tmp_path / "songs_and_tunes" / "august.yaml").write_text(yaml.safe_dump(AUGUST))
    (tmp_path / "songs_and_tunes" / "salt-creek.yaml").write_text("music_by: Traditional\n")
    records = homeplace.read_arthel(str(tmp_path))
    assert set(records) == {"show:0-25254342", "record:vowel sounds"}
    vs = records["record:vowel sounds"]
    assert vs["people"]["Harry Clark"]["scopes"] == {"track"}
    assert vs["sources"]["arthel"].endswith("songs_and_tunes/august.yaml")
    graph = homeplace.graph_of(records)
    # Justin Holmes is on both, so the show and the record are a pair
    assert graph["pairs"] == [{"records": ["record:vowel sounds", "show:0-25254342"],
                               "shared": ["Justin Holmes"]}]


def ask_row(page, **printouts):
    return {"fulltext": page, "printouts": {
        k: [{"fulltext": v} if k in ("Has performer", "Has personnel") else v for v in vs]
        for k, vs in printouts.items()}}


def test_wiki_cuts_group_by_record():
    rows = [
        ask_row("Song:August# 1", **{"Has performer": ["Harry Clark"], "Has instrument": ["mandolin"], "Has cut": ["4masks"]}),
        ask_row("Song:August# 2", **{"Has performer": ["Maddie Denton"], "Has instrument": ["fiddle"], "Has cut": ["4masks"]}),
        ask_row("Song:Bank Run# 1", **{"Has performer": ["Harry Clark"], "Has instrument": ["guitar"], "Has cut": ["Vowel Sounds"]}),
    ]
    records = homeplace.wiki_cuts(rows)
    assert set(records) == {"record:4masks", "record:vowel sounds"}
    harry = records["record:4masks"]["people"]["Harry Clark"]
    assert harry["roles"] == {"mandolin"} and harry["scopes"] == {"track"}
    assert harry["sources"] == {"https://pickipedia.xyz/wiki/Song:August"}
    pairs = homeplace.graph_of(records)["pairs"]
    assert pairs[0]["shared"] == ["Harry Clark"]


def test_wiki_personnel_is_release_scope():
    rows = [ask_row("Old Train (Seldom Scene album)# 1",
                    **{"Has personnel": ["John Duffey"], "Has instrument": ["mandolin"]})]
    records = homeplace.wiki_personnel(rows)
    rec = records["record:old train seldom scene album"]
    assert rec["people"]["John Duffey"]["scopes"] == {"release"}


def test_ask_pages_by_offset():
    pages = {0: {"query": {"results": {"a": {"fulltext": "A# 1", "printouts": {}}}}, "query-continue-offset": 500},
             500: {"query": {"results": {"b": {"fulltext": "B# 1", "printouts": {}}}}}}

    def get(q):
        return pages[int(q.rsplit("offset=", 1)[1])]

    assert [r["fulltext"] for r in homeplace.ask("[[X::+]]", get)] == ["A# 1", "B# 1"]


def test_merge_with_a_rambler_graph_keeps_names_exact():
    ours = homeplace.wiki_cuts([
        ask_row("Song:August# 1", **{"Has performer": ["Justin Holmes"], "Has instrument": ["guitar"], "Has cut": ["4masks"]})])
    rambler_graph = {"records": {"g1": {
        "id": "x", "group": "g1", "title": "Unit of Measure", "date": "2000", "artist": "The Tony Rice Unit",
        "compilation": False, "sources": {"MusicBrainz": "https://musicbrainz.org/release/x"},
        "people": {"Tony Rice": {"mbid": "t", "roles": ["guitar"], "scopes": ["release"], "sources": ["MusicBrainz"]},
                   "Justin Myles Holmes": {"mbid": None, "roles": ["guitar"], "scopes": ["track"], "sources": ["Discogs"]}}}}}
    merged = homeplace.merge(ours, json.loads(json.dumps(rambler_graph))["records"])
    graph = homeplace.graph_of(merged)
    assert set(graph["people"]) == {"Justin Holmes", "Justin Myles Holmes", "Tony Rice"}
    assert graph["pairs"] == []  # two spellings are two people; no edge invented
    assert graph["records"]["g1"]["people"]["Tony Rice"]["roles"] == {"guitar"}


def test_render_counts_shows_separately():
    rec = homeplace.arthel_show("0-1", BUNDY, "src")
    text = homeplace.render(homeplace.graph_of({rec["group"]: rec}))
    assert "1 of the records above are shows" in text
    assert rambler.wikitext(homeplace.graph_of({rec["group"]: rec}))  # Rambler's output works on our graph
