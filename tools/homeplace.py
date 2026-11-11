#!/usr/bin/env python3
"""
Homeplace: who played with whom, read from our own house.

    python3 tools/homeplace.py --arthel ../arthel/src/data
    python3 tools/homeplace.py --wiki
    python3 tools/homeplace.py --arthel ../arthel/src/data --wiki --json
    python3 tools/homeplace.py --wiki --merge rambler.json

An Artificial Dumb reader for the connectome. Sideman and Rambler look
outward, at MusicBrainz and Discogs; those know nothing about a Binghamton
fiddler at a museum show. Homeplace reads the sources we keep ourselves:

  - arthel's YAML: each show (shows/*.yaml: its ensemble, plus anyone
    featured on a song) and each studio cut (songs_and_tunes/*.yaml,
    studio_versions: the record it is on and the ensemble that cut it).
  - PickiPedia's own properties: Has performer on each {{Studio cut}}
    subobject (who played which instrument on which record's cut), and
    Has personnel from {{Record personnel}} (who is on a record).

It puts out the same graph Rambler does -- records (and shows), people, and
the pairs that share a person -- so the two can be merged with --merge and
walked as one. A show is a record with kind "show": people who were on the
same stage, which is a lower-resolution edge than a cut and is marked so.

What makes it dumb, deliberately:

  - It copies names as written. "Justin Holmes" and "Justin Myles Holmes"
    are two people until a person says otherwise; a solo marked "Justin"
    is not matched to anyone.
  - Every edge names its source: the YAML file, or the wiki page the
    subobject is on.
  - It writes nothing. The wiki's own data model is read, never added to.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import rambler

ARTHEL_BLOB = "https://github.com/cryptograss/arthel/blob/main/src/data/"
ARTHEL_TREE = "https://github.com/cryptograss/arthel/tree/main/src/data/"
WIKI_API = "https://pickipedia.xyz/api.php"
WIKI_PAGE = "https://pickipedia.xyz/wiki/"
USER_AGENT = "pickipedia-homeplace/0.1 (https://pickipedia.xyz; blu@cryptograss.live)"


NARROW = {"track": 0, "song": 1, "show": 2, "release": 3}


def person(instruments, scope, source):
    return {"mbid": None, "roles": set(instruments), "scopes": {scope}, "sources": {source},
            "source_scopes": {source: scope}}


def add_person(record, name, instruments, scope, source):
    name = name.strip()
    if not name:
        return
    p = record["people"].setdefault(name, person((), scope, source))
    p["roles"].update(i.strip() for i in instruments if i and i.strip())
    p["scopes"].add(scope)
    p["sources"].add(source)
    # Which scope each source gives this person, so a pair can be cited by the
    # files both are in. Kept narrowest-first: a cut beats a release credit.
    ss = p.setdefault("source_scopes", {})
    if source not in ss or NARROW.get(scope, 9) < NARROW.get(ss[source], 9):
        ss[source] = scope


def new_record(rid, title, date="", artist="", kind="record", sources=None):
    return {"id": rid, "group": rid, "title": title, "date": date, "artist": artist,
            "kind": kind, "compilation": False, "sources": dict(sources or {}), "people": {}}


# ---------------------------------------------------------------------------
# arthel
# ---------------------------------------------------------------------------

FEATURED = re.compile(r"^\s*(?P<name>[^(]+?)\s*(?:\((?P<instrument>[^)]*)\))?\s*$")


def parse_featured(entry):
    """'Fibonacci Emery Holmes (keys)' -> ('Fibonacci Emery Holmes', ['keys']);
    'Shaka Lei Kaumaka' -> ('Shaka Lei Kaumaka', [])."""
    m = FEATURED.match(str(entry))
    if not m:
        return str(entry).strip(), []
    inst = m.group("instrument")
    return m.group("name").strip(), [i.strip() for i in inst.split(",")] if inst else []


def arthel_show(stem, data, source):
    """One shows/*.yaml file as a record of kind 'show'.

    The filename is '<artist id>-<block height>'; the block is the date we
    keep. The ensemble is on the whole show; anyone featured on a song is
    on the show too, with scope 'song' so a later walk can tell them apart.
    """
    block = stem.split("-", 1)[-1] if "-" in stem else ""
    rec = new_record(f"show:{stem}", data.get("title") or stem,
                     date=f"block {block}" if block else "", artist=data.get("venue", ""),
                     kind="show", sources={"arthel": source})
    for name, instruments in (data.get("ensemble") or {}).items():
        add_person(rec, name, instruments if isinstance(instruments, list) else [instruments], "show", source)
    for s in (data.get("sets") or {}).values():
        for play in (s or {}).get("songplays") or []:
            if not isinstance(play, dict):
                continue
            # '- Title:\n  mode: segue' parses flat: {"Title": None, "mode": ...},
            # so the modifications sit beside the title, or under it if indented.
            mods = [play.get("ensemble-modifications")]
            mods += [v.get("ensemble-modifications") for v in play.values() if isinstance(v, dict)]
            for entry in (e for m in mods if m for e in m.get("featuring") or []):
                name, instruments = parse_featured(entry)
                add_person(rec, name, instruments, "song", source)
    return rec


def arthel_cuts(stem, data, source):
    """The studio cuts in one songs_and_tunes/*.yaml, as (record title, people).

    A cut's ensemble is on that record, at track scope: this is the same
    fact {{Studio cut}} stores on the wiki.
    """
    out = []
    for version in (data.get("studio_versions") or {}).values():
        for record_title, cut in (version or {}).items():
            people = {}
            for name, instruments in ((cut or {}).get("ensemble") or {}).items():
                people[name] = instruments if isinstance(instruments, list) else [instruments]
            out.append((record_title, (cut or {}).get("record", ""), people))
    return out


def read_arthel(data_dir):
    """Every show and every studio cut under an arthel src/data directory."""
    import yaml  # only needed for this source
    records = {}
    shows_dir = os.path.join(data_dir, "shows")
    for fn in sorted(os.listdir(shows_dir)) if os.path.isdir(shows_dir) else []:
        if not fn.endswith(".yaml"):
            continue
        with open(os.path.join(shows_dir, fn)) as f:
            data = yaml.safe_load(f) or {}
        source = ARTHEL_BLOB + "shows/" + fn
        rec = arthel_show(fn[:-5], data, source)
        records[rec["group"]] = rec
    songs_dir = os.path.join(data_dir, "songs_and_tunes")
    for fn in sorted(os.listdir(songs_dir)) if os.path.isdir(songs_dir) else []:
        if not fn.endswith(".yaml"):
            continue
        with open(os.path.join(songs_dir, fn)) as f:
            data = yaml.safe_load(f) or {}
        source = ARTHEL_BLOB + "songs_and_tunes/" + fn
        for record_title, date, people in arthel_cuts(fn[:-5], data, source):
            rid = "record:" + rambler.sideman.normalize_title(record_title)
            rec = records.setdefault(rid, new_record(rid, record_title, date=str(date)))
            # The record's own source is the folder, not one song's file: a song
            # file only says who is on that cut. Each person carries their files.
            rec["sources"].setdefault("arthel", ARTHEL_TREE + "songs_and_tunes")
            for name, instruments in people.items():
                add_person(rec, name, instruments, "track", source)
    return records


# ---------------------------------------------------------------------------
# PickiPedia
# ---------------------------------------------------------------------------

def ask(query, get=None):
    """Every row of a Semantic MediaWiki #ask query, paged by offset."""
    get = get or _ask_get
    rows, offset = [], 0
    while True:
        data = get(f"{query}|limit=500|offset={offset}")
        results = (data.get("query") or {}).get("results") or {}
        rows += list(results.values())
        if not data.get("query-continue-offset"):
            return rows
        offset = data["query-continue-offset"]


def _ask_get(query):
    url = f"{WIKI_API}?{urlencode({'action': 'ask', 'query': query, 'format': 'json'})}"
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as resp:
        return json.load(resp)


def page_url(title):
    return WIKI_PAGE + quote(title.replace(" ", "_"), safe=":/'(),!")


def _names(printout):
    return [v["fulltext"] if isinstance(v, dict) else str(v) for v in printout or []]


def _page_of(subobject_title):
    return subobject_title.split("#", 1)[0]


def wiki_cuts(rows):
    """Has performer rows (one per musician per cut) -> records at track scope."""
    records = {}
    for row in rows:
        po = row.get("printouts") or {}
        page = _page_of(row.get("fulltext") or row.get("title", ""))
        source = page_url(page)
        for record_title in _names(po.get("Has cut")) or _names(po.get("Has record")) or [""]:
            if not record_title:
                continue
            rid = "record:" + rambler.sideman.normalize_title(record_title)
            rec = records.setdefault(rid, new_record(rid, record_title, sources={
                "PickiPedia": page_url(record_title)}))
            for name in _names(po.get("Has performer")):
                add_person(rec, name, _names(po.get("Has instrument")), "track", source)
    return records


def wiki_personnel(rows):
    """Has personnel rows ({{Record personnel}} on a record page) -> release scope."""
    records = {}
    for row in rows:
        po = row.get("printouts") or {}
        page = _page_of(row.get("fulltext") or row.get("title", ""))
        source = page_url(page)
        rid = "record:" + rambler.sideman.normalize_title(page)
        rec = records.setdefault(rid, new_record(rid, page, sources={"PickiPedia": source}))
        for name in _names(po.get("Has personnel")):
            add_person(rec, name, _names(po.get("Has instrument")), "release", source)
    return records


def read_wiki(get=None):
    records = wiki_cuts(ask("[[Has performer::+]]|?Has performer|?Has instrument|?Has cut", get))
    for rid, rec in wiki_personnel(ask("[[Has personnel::+]]|?Has personnel|?Has instrument", get)).items():
        if rid in records:
            for name, p in rec["people"].items():
                add_person(records[rid], name, p["roles"], "release", next(iter(p["sources"])))
        else:
            records[rid] = rec
    return records


# ---------------------------------------------------------------------------
# Putting it together
# ---------------------------------------------------------------------------

def merge(*graphs):
    """Union of record dicts (from read_* or a --json file of either tool)."""
    records = {}
    for g in graphs:
        for rid, rec in g.items():
            if rid in records:
                for name, p in rec["people"].items():
                    for src, scope in source_scopes(p).items():
                        add_person(records[rid], name, p["roles"], scope, src)
                    records[rid]["people"][name]["scopes"].update(p["scopes"])
                records[rid]["sources"].update(rec.get("sources") or {})
            else:
                records[rid] = {**rec, "people": {
                    n: {**p, "roles": set(p["roles"]), "scopes": set(p["scopes"]), "sources": set(p["sources"]),
                        "source_scopes": source_scopes(p)}
                    for n, p in rec["people"].items()}}
    return records


def source_scopes(p):
    """{source: scope} for a person. A graph from Rambler, or an older
    Homeplace one, has no source_scopes: each source gets the person's
    widest scope, so nothing is promoted to a cut it never said it was."""
    if p.get("source_scopes"):
        return dict(p["source_scopes"])
    widest = max(p.get("scopes") or ["release"], key=lambda s: NARROW.get(s, 9))
    return {src: widest for src in p.get("sources") or []}


def hops(records):
    """Every pair of people on a record, cited by the sources both are in.

    kind is "cut" when a shared source puts both on the same cut (an arthel
    song file, or a wiki Song: page, at track scope), "show" when it is a
    show both were on, and "record" when all they share is the record: the
    same LP, maybe not the same track. A pair with no shared source is
    still listed, as "record", with no sources -- never with someone
    else's file.
    """
    out = []
    for rid in sorted(records):
        rec = records[rid]
        names = sorted(rec["people"])
        ss = {n: source_scopes(rec["people"][n]) for n in names}
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                shared = sorted(set(ss[a]) & set(ss[b]))
                cuts = [s for s in shared if s.startswith("http") and ss[a][s] == ss[b][s] == "track"]
                if cuts:
                    kind, cite = "cut", cuts
                elif rec.get("kind") == "show" and shared:
                    kind, cite = "show", shared
                else:
                    kind, cite = "record", shared
                out.append({"a": a, "b": b, "record": rid, "title": rec["title"], "kind": kind, "sources": cite})
    return out


def graph_of(records):
    graph = rambler.summarize(records, {})
    graph["hops"] = hops(records)
    return graph


def render_with(graph, name):
    """Everyone name shares a record or show with, and what says so."""
    rank = {"cut": 0, "show": 1, "record": 2}
    rows = [h for h in graph["hops"] if name in (h["a"], h["b"])]
    if not rows:
        return f"{name}: no one shares a record or show with them here."
    lines = [f"{name}: {len({h['a'] if h['b'] == name else h['b'] for h in rows})} people", ""]
    for h in sorted(rows, key=lambda h: (rank[h["kind"]], h["b"] if h["a"] == name else h["a"])):
        other = h["b"] if h["a"] == name else h["a"]
        cite = ", ".join(s.rsplit("/", 1)[-1] for s in h["sources"]) or "no shared source: the record only"
        lines.append(f"  {other}: same {h['kind']}, {h['title']} ({cite})")
    return "\n".join(lines)


def render(graph):
    text = rambler.render(graph)
    shows = [r for r in graph["records"].values() if r.get("kind") == "show"]
    if shows:
        text += f"\n\n{len(shows)} of the records above are shows (same stage, not the same cut)."
    return text


def main(argv):
    ap = argparse.ArgumentParser(description="Homeplace: who played with whom, from arthel and PickiPedia.")
    ap.add_argument("--arthel", metavar="DIR", help="an arthel checkout's src/data directory")
    ap.add_argument("--wiki", action="store_true", help="read Has performer and Has personnel from PickiPedia")
    ap.add_argument("--merge", metavar="FILE", action="append", default=[],
                    help="a --json graph from Rambler or Homeplace to fold in")
    ap.add_argument("--with", dest="with_", metavar="NAME",
                    help="list NAME's co-players, each cited by the files both are in")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv[1:])
    if not (args.arthel or args.wiki or args.merge):
        ap.error("nothing to read: give --arthel DIR, --wiki, or --merge FILE")
    parts = []
    if args.arthel:
        parts.append(read_arthel(args.arthel))
    if args.wiki:
        parts.append(read_wiki())
    for fn in args.merge:
        with open(fn) as f:
            parts.append(json.load(f)["records"])
    graph = graph_of(merge(*parts))
    if args.json:
        print(json.dumps(rambler.jsonable(graph), indent=2, ensure_ascii=False))
    elif args.with_:
        print(render_with(graph, args.with_))
    else:
        print(render(graph))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
