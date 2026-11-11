#!/usr/bin/env python3
"""
Connectome store: credits, one row per person per source per target, kept off the wiki.

    python3 tools/connectome_store.py fetch --discogs 34168519 --mb 073bfbd6-... --raw DIR
    python3 tools/connectome_store.py build --raw DIR --arthel ../arthel/src/data \\
        --lma-names names.txt --out credits.jsonl --db connectome.sqlite
    python3 tools/connectome_store.py together "Justin Holmes" --db connectome.sqlite

Justin, #connectome, 11 Nov 2026: develop the data structure before the wiki;
record which tracks a credit covers; get a few thousand nodes to query.

The atom is a credit:

  person      the name as the source wrote it (never merged; see the people table)
  mbid        MusicBrainz's id for the person, when the source gives one
  roles       instruments or parts, as written
  target      {"kind": "record" | "show", "id", "title", "date"}
  scope       how far the credit reaches: track | release (records);
              song | song? | show | stage | bill | festival | none (LMA shows)
  tracks      [{"position", "title"}] the credit covers; [] when it covers the whole
              target or the source doesn't say
  source      the URL the credit was read from (a release page, a YAML file, an item)
  source_kind Discogs | MusicBrainz | arthel | LMA
  excerpt     for LMA, the line as the taper wrote it
  read_by     which reader produced it

Several sources agreeing make several rows. Nothing here judges; each row is
what one reader said about one source. Raw responses are kept under --raw so a
build never refetches.
"""
import argparse
import glob
import json
import os
import sqlite3
import sys

import recording_credits as sideman
import homeplace
import lma_lineup

DISCOGS_PAGE = "https://www.discogs.com/release/"
MB_PAGE = "https://musicbrainz.org/release/"
MB_INC = "artist-credits+release-groups+recordings+artist-rels+recording-level-rels+url-rels"


def credit(person, roles, target, scope, tracks, source, source_kind, read_by, mbid=None, excerpt=None, **extra):
    row = {"person": person.strip(), "mbid": mbid, "roles": sorted({r for r in roles if r}),
           "target": target, "scope": scope, "tracks": tracks, "source": source,
           "source_kind": source_kind, "read_by": read_by}
    if excerpt is not None:
        row["excerpt"] = excerpt
    row.update(extra)
    return row


# ---------------------------------------------------------------------------
# Readers: raw source document -> credits
# ---------------------------------------------------------------------------

def from_discogs(release):
    rid = str(release["id"])
    artist = ", ".join(sideman.strip_discogs_suffix(a["name"]) for a in release.get("artists", []))
    target = {"kind": "record", "id": f"discogs:{rid}", "title": release.get("title", ""),
              "date": str(release.get("released") or release.get("year") or ""), "artist": artist,
              "group": f"discogs-master:{release['master_id']}" if release.get("master_id") else f"discogs:{rid}"}
    return [credit(r["name"], r["roles"], target, r["scope"], r["tracks"], DISCOGS_PAGE + rid, "Discogs",
                   "recording_credits.discogs_credit_rows",
                   **({"tracks_as_written": r["tracks_as_written"]} if "tracks_as_written" in r else {}))
            for r in sideman.discogs_credit_rows(release)]


def from_mb(release):
    rg = release.get("release-group") or {}
    target = {"kind": "record", "id": f"mb:{release['id']}", "title": release.get("title", ""),
              "date": release.get("date", ""), "artist": sideman.credit_line(release.get("artist-credit", [])),
              "group": f"mb-group:{rg['id']}" if rg.get("id") else f"mb:{release['id']}"}
    return [credit(r["name"], r["roles"], target, r["scope"], r["tracks"], MB_PAGE + release["id"], "MusicBrainz",
                   "recording_credits.mb_credit_rows", mbid=r.get("mbid"))
            for r in sideman.mb_credit_rows(release)]


def from_arthel(data_dir):
    """Studio cuts (songs_and_tunes) and shows, from arthel's YAML, through Homeplace's readers."""
    import yaml
    rows = []
    songs = os.path.join(data_dir, "songs_and_tunes")
    for fn in sorted(glob.glob(os.path.join(songs, "*.yaml"))):
        with open(fn) as f:
            data = yaml.safe_load(f) or {}
        stem = os.path.basename(fn)[:-5]
        src = homeplace.ARTHEL_BLOB + "songs_and_tunes/" + os.path.basename(fn)
        title = data.get("title") or stem
        for record_title, date, people in homeplace.arthel_cuts(stem, data, src):
            target = {"kind": "record", "id": "arthel:" + sideman.normalize_title(record_title), "title": record_title,
                      "date": str(date or ""), "artist": "", "group": "arthel:" + sideman.normalize_title(record_title)}
            for name, inst in people.items():
                rows.append(credit(name, inst, target, "track", [{"position": "", "title": title}], src, "arthel",
                                   "homeplace.arthel_cuts"))
    shows = os.path.join(data_dir, "shows")
    for fn in sorted(glob.glob(os.path.join(shows, "*.yaml"))):
        with open(fn) as f:
            data = yaml.safe_load(f) or {}
        src = homeplace.ARTHEL_BLOB + "shows/" + os.path.basename(fn)
        rec = homeplace.arthel_show(os.path.basename(fn)[:-5], data, src)
        target = {"kind": "show", "id": "arthel:" + rec["id"], "title": rec["title"], "date": rec["date"],
                  "artist": rec["artist"], "group": "arthel:" + rec["id"]}
        for name, p in rec["people"].items():
            for scope in sorted(p["scopes"]):
                rows.append(credit(name, p["roles"], target, scope, [], src, "arthel", "homeplace.arthel_show"))
    return rows


def from_lma(item, names):
    """One archive.org item, read by lma_lineup for each of names (the parser finds names it's given)."""
    m = item.get("metadata", {})
    ident = m.get("identifier", "")
    creator = m.get("creator")
    creator = creator[0] if isinstance(creator, list) else (creator or "")
    target = {"kind": "show", "id": f"lma:{ident}", "title": m.get("title", ""), "date": m.get("date", ""),
              "artist": creator, "group": f"lma-show:{creator}|{m.get('date', '')}"}
    rows = []
    for name, readings in lma_lineup.read_item(item, names).items():
        for where, shape, scope, detail in readings:
            songs = detail if isinstance(detail, list) else []
            rows.append(credit(name, [], target, scope or "unread",
                               [{"position": "", "title": s} for s in songs] if scope == "song" and songs else [],
                               f"https://archive.org/details/{ident}", "LMA", "lma_lineup.read_item",
                               excerpt=("; ".join(detail) if isinstance(detail, list) else str(detail)),
                               shape=shape, where=where))
    return rows


# ---------------------------------------------------------------------------
# Fetch (raw, once) and build
# ---------------------------------------------------------------------------

def fetch(raw, discogs=(), mb=()):
    for d in discogs:
        path = os.path.join(raw, "discogs", f"{d}.json")
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            json.dump(sideman.discogs_get(f"releases/{d}"), open(path, "w"))
    for r in mb:
        path = os.path.join(raw, "mb", f"{r}.json")
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            json.dump(sideman.mb_get(f"release/{r}", inc=MB_INC), open(path, "w"))


def build(raw, arthel=None, lma_names=()):
    rows = []
    for fn in sorted(glob.glob(os.path.join(raw, "discogs", "*.json"))):
        rows += from_discogs(json.load(open(fn)))
    for fn in sorted(glob.glob(os.path.join(raw, "mb", "*.json"))):
        rows += from_mb(json.load(open(fn)))
    if arthel:
        rows += from_arthel(arthel)
    if lma_names:
        for fn in sorted(glob.glob(os.path.join(raw, "lma", "*", "*.json"))):
            try:
                item = json.load(open(fn))
            except ValueError:
                continue
            if isinstance(item, dict) and "metadata" in item:
                rows += from_lma(item, lma_names)
    return rows


SCHEMA = """
CREATE TABLE targets (id TEXT PRIMARY KEY, kind TEXT, title TEXT, date TEXT, artist TEXT, grp TEXT);
CREATE TABLE credits (n INTEGER PRIMARY KEY, person TEXT, mbid TEXT, roles TEXT, target TEXT REFERENCES targets(id),
                      scope TEXT, source TEXT, source_kind TEXT, read_by TEXT, excerpt TEXT);
CREATE TABLE credit_tracks (credit INTEGER REFERENCES credits(n), position TEXT, title TEXT);
CREATE TABLE people (name TEXT PRIMARY KEY, person TEXT, decided_by TEXT);  -- filled by a person, never by a reader
CREATE INDEX credits_person ON credits(person);
CREATE INDEX credits_target ON credits(target);
"""


def to_sqlite(rows, path):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    for i, r in enumerate(rows):
        t = r["target"]
        db.execute("INSERT OR IGNORE INTO targets VALUES (?,?,?,?,?,?)",
                   (t["id"], t["kind"], t["title"], t["date"], t.get("artist", ""), t.get("group", t["id"])))
        db.execute("INSERT INTO credits VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (i, r["person"], r.get("mbid"), "; ".join(r["roles"]), t["id"], r["scope"], r["source"],
                    r["source_kind"], r["read_by"], r.get("excerpt")))
        for tr in r["tracks"]:
            db.execute("INSERT INTO credit_tracks VALUES (?,?,?)", (i, tr["position"], tr["title"]))
    db.commit()
    return db


# Two people on the same track of the same target, by the same source's own numbering.
SAME_TRACK = """
SELECT DISTINCT b.person, t.title, ta.position, ta.title, a.source
FROM credits a JOIN credit_tracks ta ON ta.credit = a.n
JOIN credits b ON b.target = a.target AND b.source = a.source AND b.person != a.person
JOIN credit_tracks tb ON tb.credit = b.n AND tb.position = ta.position AND tb.title = ta.title
JOIN targets t ON t.id = a.target
WHERE a.person = ? ORDER BY b.person
"""


def main(argv):
    ap = argparse.ArgumentParser(description="Connectome store: credits off the wiki.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--raw", required=True)
    f.add_argument("--discogs", nargs="*", default=[])
    f.add_argument("--mb", nargs="*", default=[])
    b = sub.add_parser("build")
    b.add_argument("--raw", required=True)
    b.add_argument("--arthel")
    b.add_argument("--lma-names", help="a file, one name per line, for the LMA parser to look for")
    b.add_argument("--out", required=True)
    b.add_argument("--db")
    q = sub.add_parser("together")
    q.add_argument("name")
    q.add_argument("--db", required=True)
    args = ap.parse_args(argv[1:])
    if args.cmd == "fetch":
        fetch(args.raw, args.discogs, args.mb)
    elif args.cmd == "build":
        names = [l.strip() for l in open(args.lma_names) if l.strip()] if args.lma_names else []
        rows = build(args.raw, args.arthel, names)
        with open(args.out, "w") as out:
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        if args.db:
            to_sqlite(rows, args.db)
        people = {r["person"] for r in rows}
        targets = {r["target"]["id"] for r in rows}
        print(f"{len(rows)} credits, {len(people)} names, {len(targets)} targets")
    elif args.cmd == "together":
        db = sqlite3.connect(args.db)
        for other, title, pos, track, src in db.execute(SAME_TRACK, (args.name,)):
            print(f"{other}: {track} ({pos or 'no position'}) on {title}  {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
