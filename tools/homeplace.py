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
WIKI_API = "https://pickipedia.xyz/api.php"
WIKI_PAGE = "https://pickipedia.xyz/wiki/"
USER_AGENT = "pickipedia-homeplace/0.1 (https://pickipedia.xyz; blu@cryptograss.live)"


def person(instruments, scope, source):
    return {"mbid": None, "roles": set(instruments), "scopes": {scope}, "sources": {source}}


def add_person(record, name, instruments, scope, source):
    name = name.strip()
    if not name:
        return
    p = record["people"].setdefault(name, person((), scope, source))
    p["roles"].update(i.strip() for i in instruments if i and i.strip())
    p["scopes"].add(scope)
    p["sources"].add(source)


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
            rec["sources"].setdefault("arthel", source)
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
                    add_person(records[rid], name, p["roles"], next(iter(p["scopes"])), next(iter(p["sources"])))
                    records[rid]["people"][name]["scopes"].update(p["scopes"])
                    records[rid]["people"][name]["sources"].update(p["sources"])
                records[rid]["sources"].update(rec.get("sources") or {})
            else:
                records[rid] = {**rec, "people": {
                    n: {**p, "roles": set(p["roles"]), "scopes": set(p["scopes"]), "sources": set(p["sources"])}
                    for n, p in rec["people"].items()}}
    return records


def graph_of(records):
    return rambler.summarize(records, {})


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
    print(json.dumps(rambler.jsonable(graph), indent=2, ensure_ascii=False) if args.json else render(graph))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
