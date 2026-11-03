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
