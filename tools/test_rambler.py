#!/usr/bin/env python3
"""
Tests for Rambler, the record-to-record walk.

What these guard: an edge comes only from a record's own credits, never from
how the record was found; names match exactly and are never merged; the walk
stops where it is told to. Everything runs on canned records, so no test
touches the network.
"""

import rambler


def person(mbid=None, roles=("guitar",), scopes=("release",), sources=("MusicBrainz",)):
    return {"mbid": mbid, "roles": set(roles), "scopes": set(scopes), "sources": set(sources)}


def record(rid, title, people, date="2000", compilation=False, group=None):
    return {"id": rid, "group": group or f"g-{rid}", "title": title, "date": date,
            "artist": "Someone", "compilation": compilation,
            "sources": {"MusicBrainz": f"https://musicbrainz.org/release/{rid}"},
            "people": people}


# A small world:
#   seed: Tony Rice (mbid t), Wyatt Rice (mbid w)
#   r1:   Tony Rice, Larry Rice (mbid l)      found through Tony
#   r2:   Wyatt Rice, Rickie Simpkins (no mbid; Discogs only)  found through Wyatt
#   r3:   nobody credited                    found through Wyatt
#   r4:   Ricky Skaggs only                  found through Tony, who is not credited
#   r5:   Jerry Douglas                      found through Larry (hop 2)
#   comp: a compilation                      found through Tony
WORLD = {
    "seed": record("seed", "Unit of Measure", {"Tony Rice": person("t"), "Wyatt Rice": person("w")}),
    "r1": record("r1", "Mr. Poverty", {"Tony Rice": person("t"), "Larry Rice": person("l")}, date="1975"),
    "r2": record("r2", "Hurricanes", {"Wyatt Rice": person("w"),
                                       "Rickie Simpkins": person(None, sources=("Discogs",))}),
    "r3": record("r3", "Guitar", {}),
    "r4": record("r4", "Someone Else's Record", {"Ricky Skaggs": person("s")}),
    "r5": record("r5", "Hop Two", {"Jerry Douglas": person("j")}),
    "comp": record("comp", "100 Tracks Bluegrass", {"Tony Rice": person("t")}, compilation=True),
}
FOUND = {"t": ["r1", "r4", "comp"], "w": ["r2", "r3"], "l": ["r5"], "s": [], "j": []}


def walk(**kw):
    calls = []

    def read(rid):
        calls.append(rid)
        return WORLD[rid]

    def candidates(mbid, per_person):
        return FOUND[mbid][:per_person]

    graph = rambler.ramble("seed", read=read, candidates=candidates, **kw)
    return graph, calls


def test_one_hop_reaches_records_through_credited_people():
    graph, _ = walk(hops=1)
    assert set(graph["records"]) == {"g-seed", "g-r1", "g-r2", "g-r3", "g-r4"}
    assert "g-r5" not in graph["records"]


def test_two_hops_go_one_record_further():
    graph, _ = walk(hops=2)
    assert "g-r5" in graph["records"]


def test_found_through_someone_is_not_an_edge():
    graph, _ = walk(hops=1)
    assert graph["people"]["Tony Rice"] == ["g-r1", "g-seed"]
    assert graph["found_but_not_credited"] == [
        {"record": "g-r3", "via": "Wyatt Rice"}, {"record": "g-r4", "via": "Tony Rice"}]


def test_compilations_are_skipped():
    graph, calls = walk(hops=1)
    assert "comp" in calls
    assert "g-comp" not in graph["records"]


def test_people_without_mbid_are_edges_but_not_walked():
    graph, _ = walk(hops=2)
    assert graph["people"]["Rickie Simpkins"] == ["g-r2"]


def test_records_with_no_personnel_go_on_the_worklist():
    graph, _ = walk(hops=1)
    assert graph["worklist"] == ["g-r3"]


def test_pairs_name_who_is_shared():
    graph, _ = walk(hops=1)
    pairs = {tuple(p["records"]): p["shared"] for p in graph["pairs"]}
    assert pairs[("g-r1", "g-seed")] == ["Tony Rice"]
    assert pairs[("g-r2", "g-seed")] == ["Wyatt Rice"]
    assert ("g-r1", "g-r2") not in pairs


def test_names_are_exact():
    world = {"seed": record("seed", "A", {"James Kerwin": person("k1")}),
             "x": record("x", "B", {"Jim Kerwin": person("k2")})}
    graph = rambler.ramble("seed", hops=1, read=world.__getitem__,
                           candidates=lambda mbid, n: ["x"] if mbid == "k1" else [])
    assert graph["pairs"] == []
    assert set(graph["people"]) == {"James Kerwin", "Jim Kerwin"}


def test_max_records_stops_the_walk():
    graph, _ = walk(hops=2, max_records=2)
    assert len(graph["records"]) == 2


def test_reissues_in_one_group_fold():
    world = {"seed": record("seed", "A", {"Tony Rice": person("t")}, group="g1"),
             "reissue": record("reissue", "A", {"Tony Rice": person("t")}, group="g1")}
    graph = rambler.ramble("seed", hops=1, read=world.__getitem__,
                           candidates=lambda mbid, n: ["reissue"])
    assert list(graph["records"]) == ["g1"]


def test_pick_earliest_one_per_title():
    found = [("1987", "b", "Me & My Guitar"), ("1986", "a", "Me & My Guitar"),
             ("1978", "c", "Live"), ("9999", "d", "Undated")]
    assert rambler.pick_earliest(found, 5) == ["c", "a", "d"]
    assert rambler.pick_earliest(found, 1) == ["c"]


def test_mb_people_counts_track_credits_and_skips_producers():
    release = {
        "relations": [
            {"type": "instrument", "attributes": ["mandolin"], "artist": {"id": "g", "name": "Jimmy Gaudreau"}},
            {"type": "producer", "attributes": [], "artist": {"id": "w", "name": "Bill Wolf"}},
        ],
        "media": [{"tracks": [{"recording": {"relations": [
            {"type": "vocal", "attributes": ["lead vocals"], "artist": {"id": "j", "name": "Jerry Garcia"}}]}}]}],
    }
    people = rambler.mb_people(release)
    assert set(people) == {"Jimmy Gaudreau", "Jerry Garcia"}
    assert people["Jerry Garcia"]["scopes"] == {"track"}
    assert people["Jimmy Gaudreau"]["mbid"] == "g"


def test_discogs_people_judges_composite_roles():
    release = {"extraartists": [
        {"name": "Tony Rice", "role": "Guitar, Producer", "tracks": ""},
        {"name": "Bill Wolf", "role": "Producer, Mixed By", "tracks": ""},
        {"name": "Craig Miller (3)", "role": "Harmonica", "tracks": "4"}],
        "tracklist": []}
    people = rambler.discogs_people(release)
    assert set(people) == {"Tony Rice", "Craig Miller"}
    assert people["Tony Rice"]["roles"] == {"Guitar"}
    assert people["Craig Miller"]["scopes"] == {"track"}


def test_wikitext_one_call_per_person_with_a_source():
    graph, _ = walk(hops=1)
    text = rambler.wikitext(graph)
    assert "{{Record personnel|Larry Rice|instrument=guitar|source=https://musicbrainz.org/release/r1}}" in text
    assert "== Guitar" not in text  # nobody credited, nothing to write
    # Discogs-only credit on a record whose Discogs link is unknown: no source, not a crash
    assert "{{Record personnel|Rickie Simpkins|instrument=guitar}}" in text


# ---------------------------------------------------------------------------
# Discogs seeds, and what each source said
# ---------------------------------------------------------------------------

DISCOGS_RELEASE = {
    "title": "The First TV Dinner", "year": 2012, "master_id": 0,
    "artists": [{"name": "The Turpentine Ray"}],
    "formats": [{"descriptions": ["Album"]}],
    "extraartists": [{"name": "Nick Jennings", "role": "5-String Banjo, Producer", "tracks": ""}],
    "tracklist": [],
}


def test_discogs_seed_is_read_alone_when_musicbrainz_lacks_it(monkeypatch):
    def mb_get(path, **params):
        raise rambler.sideman.HTTPError("u", 404, "Not Found", {}, None)
    monkeypatch.setattr(rambler.sideman, "mb_get", mb_get)
    monkeypatch.setattr(rambler.sideman, "discogs_get", lambda path: DISCOGS_RELEASE)
    rec = rambler.read_record("discogs:24433085")
    assert rec["id"] == "discogs:24433085" and rec["artist"] == "The Turpentine Ray"
    assert rec["sources"] == {"Discogs": "https://www.discogs.com/release/24433085"}
    assert rec["people"]["Nick Jennings"]["by_source"] == {"Discogs": {"roles": {"5-String Banjo"}, "scopes": {"release"}}}
    assert rec["people"]["Nick Jennings"]["mbid"] is None  # goes no further


def test_discogs_seed_linked_on_musicbrainz_is_read_from_both(monkeypatch):
    def mb_get(path, **params):
        if path == "url":
            return {"relations": [{"target-type": "release", "release": {"id": "mb-1"}}]}
        return {"title": "The First TV Dinner", "date": "2012", "release-group": {"id": "g"},
                "artist-credit": [{"name": "The Turpentine Ray"}],
                "relations": [{"type": "instrument", "attributes": ["banjo"],
                               "artist": {"id": "n", "name": "Nick Jennings"}}], "media": []}
    monkeypatch.setattr(rambler.sideman, "mb_get", mb_get)
    monkeypatch.setattr(rambler.sideman, "discogs_get", lambda path: DISCOGS_RELEASE)
    rec = rambler.read_record("https://www.discogs.com/release/24433085")
    assert rec["id"] == "mb-1"
    assert set(rec["sources"]) == {"MusicBrainz", "Discogs"}
    nick = rec["people"]["Nick Jennings"]
    assert nick["mbid"] == "n"  # walked onward, since MusicBrainz knows him
    assert nick["roles"] == {"banjo", "5-String Banjo"}
    assert nick["by_source"]["MusicBrainz"]["roles"] == {"banjo"}
    assert nick["by_source"]["Discogs"]["roles"] == {"5-String Banjo"}


def test_render_says_what_each_source_said():
    rec = record("r", "Ways of the World", {"Paul Brown": {
        "mbid": "p", "roles": {"banjo", "Banjo"}, "scopes": {"track"}, "sources": {"MusicBrainz", "Discogs"},
        "by_source": {"MusicBrainz": {"roles": {"banjo"}, "scopes": {"track"}},
                      "Discogs": {"roles": {"Banjo"}, "scopes": {"track", "release"}}}}})
    rec["sources"]["Discogs"] = "https://www.discogs.com/release/1"
    text = rambler.render(rambler.summarize({"g-r": rec}, {}))
    assert "    Paul Brown: Discogs says Banjo [release+track]; MusicBrainz says banjo [track]" in text
    assert "    Discogs: https://www.discogs.com/release/1" in text


def test_seed_forms():
    assert rambler.DISCOGS_SEED.search("https://www.discogs.com/release/24433085-The-Turpentine-Ray").group(1) == "24433085"
    assert rambler.DISCOGS_SEED.search("discogs:5").group(1) == "5"
    assert rambler.DISCOGS_SEED.search("750499ef-cec3-4c3c-9e8d-2caacff30e0e") is None


# ---------------------------------------------------------------------------
# --between: a wanted connection
# ---------------------------------------------------------------------------

def between_world(records, mb_titles, dg_titles, mb_ids=None, dg_ids=None):
    """mb_titles/dg_titles: {person: {norm title: (date, rid, title)}}."""
    mb_ids = mb_ids or {"A": [("ma", "A")], "B": [("mb", "B")]}
    dg_ids = dg_ids or {"A": [], "B": []}
    by_id = {i: n for n, ids in mb_ids.items() for i, _ in ids}
    dg_by_id = {i: n for n, ids in dg_ids.items() for i, _ in ids}
    reads = []

    def read(rid):
        reads.append(rid)
        return records[rid]
    kw = dict(read=read,
              mb_named=lambda n: mb_ids.get(n, []), mb_records=lambda i: mb_titles[by_id[i]],
              dg_named=lambda n: dg_ids.get(n, []), dg_records=lambda i: dg_titles[dg_by_id[i]])
    return kw, reads


def test_between_counts_only_records_whose_own_credits_name_both():
    recs = {"r1": record("r1", "Together", {"A": person(), "B": person()}),
            "r2": record("r2", "Art Only", {"A": person()})}
    kw, reads = between_world(recs, {
        "A": {"together": ("2000", "r1", "Together"), "art only": ("2001", "r2", "Art Only"), "solo": ("1999", "r9", "Solo")},
        "B": {"together": ("2000", "r1", "Together"), "art only": ("2001", "r2", "Art Only")}}, {})
    result = rambler.between("A", "B", **kw)
    assert [c["record"]["title"] for c in result["connections"]] == ["Together"]
    assert result["not_confirmed"] == [{"record": recs["r2"], "missing": ["B"]}]
    assert "r9" not in reads  # a title only one of them has is never read


def test_between_matches_names_ignoring_case_and_reports_as_credited():
    recs = {"r1": record("r1", "T", {"Tony RICE": person(), "B": person()})}
    kw, _ = between_world(recs, {"A": {"t": ("2000", "r1", "T")}, "B": {"t": ("2000", "r1", "T")}}, {},
                          mb_ids={"Tony Rice": [("ma", "Tony Rice")], "B": [("mb", "B")]})
    result = rambler.between("Tony Rice", "B", **{**kw, "mb_records": lambda i: {"t": ("2000", "r1", "T")}})
    assert result["connections"][0]["as_credited"] == ["Tony RICE", "B"]


def test_between_prefers_musicbrainz_release_and_folds_groups():
    rec = record("mb1", "T", {"A": person(), "B": person()}, group="g")
    recs = {"mb1": rec, "discogs:5": rec}
    kw, reads = between_world(recs, {"A": {"t": ("2000", "mb1", "T")}, "B": {}},
                              {"B": {"t": ("1999", "discogs:5", "T")}},
                              dg_ids={"A": [], "B": [("d", "B")]})
    result = rambler.between("A", "B", **kw)
    assert reads == ["mb1"] and len(result["connections"]) == 1


def test_between_says_who_is_unresolved_and_when_candidates_are_capped():
    kw, _ = between_world({}, {"A": {}, "B": {}}, {}, mb_ids={"A": [("ma", "A")]})
    result = rambler.between("A", "Nobody", **kw)
    assert result["unresolved"] == ["Nobody"]
    text = rambler.render_between("A", "Nobody", result)
    assert "Neither source has an artist named exactly Nobody." in text
    assert "None found" in text
    recs = {f"r{i}": record(f"r{i}", f"T{i}", {"A": person(), "B": person()}) for i in range(3)}
    titles = {f"t{i}": ("2000", f"r{i}", f"T{i}") for i in range(3)}
    kw, reads = between_world(recs, {"A": titles, "B": titles}, {})
    result = rambler.between("A", "B", max_candidates=2, **kw)
    assert len(reads) == 2 and result["unread"] == 1
