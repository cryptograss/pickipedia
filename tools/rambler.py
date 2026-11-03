#!/usr/bin/env python3
"""
Rambler: who was on a record with whom, walked outward from one record.

    python3 tools/rambler.py 750499ef-cec3-4c3c-9e8d-2caacff30e0e
    python3 tools/rambler.py --hops 2 --json <release-mbid>
    python3 tools/rambler.py --wikitext <release-mbid>

An Artificial Dumb crawler for the connectome, built on Sideman
(recording_credits.py) and its MusicBrainz and Discogs helpers. Starting at
one MusicBrainz release, it reads who is credited on it, finds the other
records those people are on, reads who is credited on those, and so on for
--hops steps. What comes out is a record-level graph: people and records,
and the pairs of records that share a person.

That is the edge Has personnel stores -- "on this record", not "on this
track". Sideman's output keeps track and release scope apart because a
release-wide credit cannot answer "who played on this song". It can answer
"who was on this record", which is the only question Rambler asks, so here
both scopes count as an edge and the scope is kept beside it.

What makes it dumb, deliberately:

  - An edge comes only from a record's own credits. Finding a record through
    a person (their releases, their release relationships) is how Rambler
    looks; it is not evidence. A record reached through someone who is not
    then credited on it adds no edge for them, and the output says so.
  - People are matched by exact name. "James Kerwin" and "Jim Kerwin" are two
    people. Rambler can miss an edge; it cannot invent one.
  - Only people with a MusicBrainz id are walked onward. Discogs-only names
    are kept as edges but go no further.
  - Compilations are skipped: a track on one does not put its players on a
    record together.

Records that come back with nobody credited are listed as the worklist:
they need liner notes, or someone who was there.

--wikitext prints {{Record personnel}} calls for each record, one per person,
each with the source it came from. It writes nothing; a person decides
where, and whether, they go.
"""

import argparse
import json
import re
import sys
from collections import defaultdict

import recording_credits as sideman

# Discovery caps. A prolific player is on hundreds of records; walking all of
# them from one seed is a hairball, not a map.
DEFAULT_PER_PERSON = 5
DEFAULT_MAX_RECORDS = 40


# ---------------------------------------------------------------------------
# One record's credits
# ---------------------------------------------------------------------------

def mb_people(release):
    """Performance credits on a MusicBrainz release, release- and track-level.

    Returns {name: {"mbid", "roles", "scopes"}}. Track-level credits count:
    a person credited on any track is on the record.
    """
    people = {}

    def add(rel, scope):
        if rel.get("type") not in sideman.MB_PERFORMANCE_TYPES or "artist" not in rel:
            return
        a = rel["artist"]
        p = people.setdefault(a["name"], {"mbid": a.get("id"), "roles": set(), "scopes": set()})
        p["roles"].add(", ".join(rel.get("attributes") or []) or rel["type"])
        p["scopes"].add(scope)

    for rel in release.get("relations", []):
        add(rel, "release")
    for medium in release.get("media", []):
        for track in medium.get("tracks", []):
            for rel in track.get("recording", {}).get("relations", []):
                add(rel, "track")
    return people


def discogs_people(release):
    """Performance credits on a Discogs release, release- and track-level."""
    people = {}

    def add(entry, scope):
        roles = sideman.performance_roles(entry.get("role", ""))
        if not roles:
            return
        name = sideman.strip_discogs_suffix(entry["name"])
        p = people.setdefault(name, {"mbid": None, "roles": set(), "scopes": set()})
        p["roles"].update(roles)
        p["scopes"].add("track" if (entry.get("tracks") or "").strip() else scope)

    for e in release.get("extraartists", []):
        add(e, "release")
    for track in release.get("tracklist", []):
        for e in track.get("extraartists", []):
            add(e, "track")
    return people


def is_compilation(release):
    group = release.get("release-group") or {}
    return "Compilation" in (group.get("secondary-types") or [])


def read_record(release_id):
    """Fetch one record and everyone credited on it, from both sources."""
    release = sideman.mb_get(
        f"release/{release_id}",
        inc="artist-credits+release-groups+recordings+artist-rels+recording-level-rels+url-rels")
    record = {
        "id": release_id,
        "group": (release.get("release-group") or {}).get("id", release_id),
        "title": release.get("title", ""),
        "date": release.get("date", ""),
        "artist": sideman.credit_line(release.get("artist-credit", [])),
        "compilation": is_compilation(release),
        "sources": {"MusicBrainz": f"https://musicbrainz.org/release/{release_id}"},
        "people": {},
    }
    for name, p in mb_people(release).items():
        record["people"][name] = {**p, "sources": {"MusicBrainz"}}
    did = sideman.discogs_id(release)
    if did:
        record["sources"]["Discogs"] = f"https://www.discogs.com/release/{did}"
        for name, p in discogs_people(sideman.discogs_get(f"releases/{did}")).items():
            q = record["people"].setdefault(name, {"mbid": None, "roles": set(), "scopes": set(), "sources": set()})
            q["roles"] |= p["roles"]
            q["scopes"] |= p["scopes"]
            q["sources"].add("Discogs")
    return record


# ---------------------------------------------------------------------------
# Finding a person's other records
# ---------------------------------------------------------------------------

def candidate_releases(mbid, per_person):
    """A person's other records: those they have a relationship to (sideman
    credits) and those under their own name. Earliest first, one per title."""
    found = []
    artist = sideman.mb_get(f"artist/{mbid}", inc="release-rels")
    for rel in artist.get("relations", []):
        if rel.get("type") in sideman.MB_PERFORMANCE_TYPES and "release" in rel:
            r = rel["release"]
            found.append((r.get("date") or "9999", r["id"], r.get("title", "")))
    own = sideman.mb_get("release", artist=mbid, inc="release-groups", limit=100)
    for r in own.get("releases", []):
        if "Compilation" in ((r.get("release-group") or {}).get("secondary-types") or []):
            continue
        found.append((r.get("date") or "9999", r["id"], r.get("title", "")))
    return pick_earliest(found, per_person)


def pick_earliest(found, limit):
    """Earliest dated first; one release per title, so reissues and
    second pressings do not use up the cap."""
    seen, picked = set(), []
    for date, rid, title in sorted(found):
        key = sideman.normalize_title(title)
        if key in seen:
            continue
        seen.add(key)
        picked.append(rid)
        if len(picked) == limit:
            break
    return picked


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------

def ramble(seed, hops=1, per_person=DEFAULT_PER_PERSON, max_records=DEFAULT_MAX_RECORDS,
           read=read_record, candidates=candidate_releases, log=lambda msg: None):
    """Walk outward from seed. read and candidates are passed in so the walk
    can be tested without the network."""
    records = {}           # release-group id -> record
    found_via = {}         # release-group id -> name of the person it was found through
    walked = set()         # people already expanded
    frontier = [(seed, None)]
    for hop in range(hops + 1):
        next_people = []
        for release_id, via in frontier:
            if len(records) >= max_records:
                log(f"stopped at {max_records} records")
                break
            rec = read(release_id)
            if rec["group"] in records or rec["compilation"]:
                continue
            records[rec["group"]] = rec
            if via:
                found_via[rec["group"]] = via
            log(f"hop {hop}: {rec['title']} ({rec['date'] or 'undated'}), {len(rec['people'])} credited")
            for name, p in sorted(rec["people"].items()):
                if p.get("mbid") and name not in walked:
                    walked.add(name)
                    next_people.append((name, p["mbid"]))
        if hop == hops:
            break
        frontier = []
        for name, mbid in next_people:
            for rid in candidates(mbid, per_person):
                frontier.append((rid, name))
    return summarize(records, found_via)


def summarize(records, found_via):
    people = defaultdict(list)
    for gid, rec in records.items():
        for name in rec["people"]:
            people[name].append(gid)
    pairs = []
    gids = sorted(records)
    for i, a in enumerate(gids):
        for b in gids[i + 1:]:
            shared = sorted(set(records[a]["people"]) & set(records[b]["people"]))
            if shared:
                pairs.append({"records": [a, b], "shared": shared})
    not_credited = sorted(
        (gid, via) for gid, via in found_via.items() if via not in records[gid]["people"])
    return {
        "records": records,
        "people": {n: sorted(g) for n, g in sorted(people.items())},
        "pairs": pairs,
        "worklist": sorted(gid for gid, rec in records.items() if not rec["people"]),
        "found_but_not_credited": [{"record": g, "via": v} for g, v in not_credited],
    }


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def label(rec):
    return f"{rec['title']} ({rec['date'][:4] or 'undated'}, {rec['artist'] or 'no artist'})"


def render(graph):
    recs = graph["records"]
    edges = sum(len(r["people"]) for r in recs.values())
    out = [f"{len(recs)} records, {len(graph['people'])} people, {edges} person-record edges, "
           f"{len(graph['pairs'])} record pairs sharing a person", ""]
    hubs = sorted(graph["people"].items(), key=lambda kv: (-len(kv[1]), kv[0]))
    out.append("On the most records:")
    for name, gids in hubs[:10]:
        if len(gids) > 1:
            out.append(f"  {name}: {len(gids)}")
    out.append("")
    out.append("Record pairs:")
    for p in graph["pairs"]:
        a, b = (recs[g] for g in p["records"])
        out.append(f"  {label(a)}  <->  {label(b)}  via {', '.join(p['shared'])}")
    if graph["worklist"]:
        out += ["", "No personnel in either source (liner notes, or someone who was there):"]
        out += [f"  {label(recs[g])}  {recs[g]['sources']['MusicBrainz']}" for g in graph["worklist"]]
    if graph["found_but_not_credited"]:
        out += ["", "Reached through someone the record does not credit (no edge added):"]
        out += [f"  {label(recs[x['record']])} via {x['via']}" for x in graph["found_but_not_credited"]]
    return "\n".join(out)


def wikitext(graph):
    """{{Record personnel}} calls per record. One source per call: MusicBrainz
    where it credits the person, else Discogs."""
    out = []
    for gid in sorted(graph["records"], key=lambda g: (graph["records"][g]["date"] or "9999", g)):
        rec = graph["records"][gid]
        if not rec["people"]:
            continue
        out.append(f"== {label(rec)} ==")
        for name, p in sorted(rec["people"].items()):
            src = "MusicBrainz" if "MusicBrainz" in p["sources"] else "Discogs"
            url = rec["sources"].get(src)
            roles = ", ".join(sorted(p["roles"]))
            cite = f"|source={url}" if url else ""
            out.append(f"{{{{Record personnel|{name}|instrument={roles}{cite}}}}}")
        out.append("")
    return "\n".join(out)


def jsonable(graph):
    def fix(o):
        if isinstance(o, set):
            return sorted(o)
        if isinstance(o, dict):
            return {k: fix(v) for k, v in o.items()}
        if isinstance(o, list):
            return [fix(v) for v in o]
        return o
    return fix(graph)


MBID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def main(argv):
    ap = argparse.ArgumentParser(description="Rambler: record-to-record walk from one MusicBrainz release.")
    ap.add_argument("seed", help="MusicBrainz release id, or a musicbrainz.org/release/... URL")
    ap.add_argument("--hops", type=int, default=1, help="record-to-record steps (default 1)")
    ap.add_argument("--per-person", type=int, default=DEFAULT_PER_PERSON)
    ap.add_argument("--max-records", type=int, default=DEFAULT_MAX_RECORDS)
    out = ap.add_mutually_exclusive_group()
    out.add_argument("--json", action="store_true")
    out.add_argument("--wikitext", action="store_true")
    args = ap.parse_args(argv[1:])
    m = MBID.search(args.seed)
    if not m:
        ap.error("seed must contain a MusicBrainz release id")
    graph = ramble(m.group(0), args.hops, args.per_person, args.max_records,
                   log=lambda msg: print(msg, file=sys.stderr))
    if args.json:
        print(json.dumps(jsonable(graph), indent=2, ensure_ascii=False))
    elif args.wikitext:
        print(wikitext(graph))
    else:
        print(render(graph))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
