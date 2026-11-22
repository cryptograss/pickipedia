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
  target      {"kind": "record" | "show", "id", "title", "date"}; a record also carries
              "formats", what the source says it came out on ("CD (Album)", "Vinyl (LP)"; for a tape,
              "archive.org collection: etree"),
              as written: the release tier is read from this, and nothing is guessed
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

A fetch can be given a budget of seconds (fetch --budget 20). Past it, the sources
the cache still lacks wait for the next run, so a long list of new ones comes in
over several builds and nothing queues behind it.
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import sys
import time
from urllib.parse import quote

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

def carrier(name, descriptions=()):
    """A format as the source wrote it: its name, and what the source says about it."""
    name = str(name or "").strip()
    said = [str(d).strip() for d in descriptions or () if str(d).strip()]
    return name + (" (" + ", ".join(said) + ")" if name and said else "")


def from_discogs(release):
    rid = str(release["id"])
    artist = ", ".join(sideman.strip_discogs_suffix(a["name"]) for a in release.get("artists", []))
    formats = [carrier(f.get("name"), f.get("descriptions")) for f in release.get("formats") or []]
    target = {"kind": "record", "id": f"discogs:{rid}", "title": release.get("title", ""),
              "date": str(release.get("released") or release.get("year") or ""), "artist": artist,
              "group": f"discogs-master:{release['master_id']}" if release.get("master_id") else f"discogs:{rid}",
              "formats": [f for f in formats if f]}
    return [credit(r["name"], r["roles"], target, r["scope"], r["tracks"], DISCOGS_PAGE + rid, "Discogs",
                   "recording_credits.discogs_credit_rows",
                   **({"tracks_as_written": r["tracks_as_written"]} if "tracks_as_written" in r else {}))
            for r in sideman.discogs_credit_rows(release)]


def from_mb(release):
    rg = release.get("release-group") or {}
    formats = [carrier(m.get("format")) for m in release.get("media") or []]
    target = {"kind": "record", "id": f"mb:{release['id']}", "title": release.get("title", ""),
              "date": release.get("date", ""), "artist": sideman.credit_line(release.get("artist-credit", [])),
              "group": f"mb-group:{rg['id']}" if rg.get("id") else f"mb:{release['id']}",
              "formats": sorted({f for f in formats if f})}
    return [credit(r["name"], r["roles"], target, r["scope"], r["tracks"], MB_PAGE + release["id"], "MusicBrainz",
                   "recording_credits.mb_credit_rows", mbid=r.get("mbid"))
            for r in sideman.mb_credit_rows(release)]


# arthel's artist ids, as a person who knows has named them: the id is what a show's file name starts with.
ARTHEL_ARTISTS = {"0": "Justin Holmes and the Immutable String Band"}


def said(value):
    """One line of what a source gave for a field: the first of a list, trimmed; '' for nothing or a placeholder."""
    if isinstance(value, list):
        value = value[0] if value else ""
    value = re.sub(r"\s+", " ", str(value or "")).strip(" ,;")
    return "" if value.lower() in {"unknown", "n/a", "na", "none", "?", "tba"} else value


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
        stem = os.path.basename(fn)[:-5]
        rec = homeplace.arthel_show(stem, data, src)
        # Who played it: arthel names a show's artist only by the id its file name starts with. Its YAML's
        # venue was standing in as the artist, so the graph named these shows by their title. Artist 0 is Justin
        # Holmes and the Immutable String Band (Justin, #connectome, 15 Nov 2026); an id nobody has said stays
        # unnamed (0_7: two ETHPrague shows, 2025), and that show goes by its title as before.
        # Where it was, as its file says: the venue, and the town with its region ("Barcelona, Catalonia").
        # (Justin, #connectome, 21 Nov 2026: "if the name of the show (festival or if the show itself has a
        # name), city and venue are available, display them in various relevant places.")
        target = {"kind": "show", "id": "arthel:" + rec["id"], "title": rec["title"], "date": rec["date"],
                  "artist": ARTHEL_ARTISTS.get(stem.split("-")[0], ""), "group": "arthel:" + rec["id"],
                  "venue": said(data.get("venue")),
                  "city": ", ".join(x for x in (said(data.get("locality")), said(data.get("region1"))) if x),
                  "poster": arthel_poster(stem, data)}
        for name, p in rec["people"].items():
            for scope in sorted(p["scopes"]):
                rows.append(credit(name, p["roles"], target, scope, [], src, "arthel", "homeplace.arthel_show"))
    return rows


# A show's poster (Justin, #connectome, 22 Nov 2026, 00:45Z: "Many of the shows (at least my shows) have posters on
# arthel. Have we captured these as part of the dataset? It'd be nice to show them. I wonder if other show posters
# are available as well, eg on archive.org?"; 00:46Z, posters and the tapers' cover art both). arthel's are put on
# the wiki as File:Show poster <show id>.<its extension>, so the wiki makes the small ones; the build draws one only
# where the wiki has it. A tape's is an image uploaded with it: one named a poster or a flyer first, else the cover
# or folder art its taper chose; archive.org's IIIF service gives it small. Nothing else is taken for one: a photo
# called IMG_2754 may be anything.
POSTER_NAMES = (re.compile(r"poster|flyer|flier", re.I), re.compile(r"cover|folder", re.I))
IMAGE = re.compile(r"\.(jpe?g|png|gif)$", re.I)
IIIF = "https://iiif.archive.org/image/iiif/3/{ident}%2F{name}/full/!240,240/0/default.jpg"


def arthel_poster(stem, data):
    """The wiki file arthel's show poster goes by, where its YAML names one: '' where it names none."""
    path = said(data.get("poster"))
    ext = os.path.splitext(path)[1].lower()
    return f"Show poster {stem}{ext}" if path and ext else ""


def tape_poster(item):
    """A small picture of the poster an archive.org item carries, or of its taper's cover art: '' for neither."""
    ident = item.get("metadata", {}).get("identifier", "")
    names = [f.get("name", "") for f in item.get("files") or [] if isinstance(f, dict) and f.get("source") == "original"
             and IMAGE.search(f.get("name", "")) and not re.match(r"(__ia|thumb)", os.path.basename(f.get("name", "")), re.I)]
    for want in POSTER_NAMES:
        for name in sorted(names):
            if want.search(os.path.basename(name)):
                return IIIF.format(ident=quote(ident, safe=""), name=quote(name, safe=""))
    return ""


def from_lma(item, names):
    """One archive.org item, read by lma_lineup for each of names (the parser finds names it's given)."""
    m = item.get("metadata", {})
    ident = m.get("identifier", "")
    creator = m.get("creator")
    creator = creator[0] if isinstance(creator, list) else (creator or "")
    collections = m.get("collection")
    collections = collections if isinstance(collections, list) else [collections] if collections else []
    # The tape's collections, as archive.org lists them: the release tier is read from these (etree's
    # policy makes a tape a Permanent Release; connectome_graph.tier).
    # Where the tape was made, as the taper filled it in: archive.org's `venue` and `coverage` (the town).
    target = {"kind": "show", "id": f"lma:{ident}", "title": m.get("title", ""), "date": m.get("date", ""),
              "artist": creator, "group": f"lma-show:{creator}|{m.get('date', '')}",
              "formats": [f"archive.org collection: {c}" for c in collections],
              "venue": said(m.get("venue")), "city": said(m.get("coverage")), "poster": tape_poster(item)}
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

SOURCE_LINE = re.compile(r"^(discogs [0-9]+|mb [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                         r"|lma [A-Za-z0-9._-]+)$")


def read_sources(path):
    """A sources file (connectome_sources.txt): `discogs <id>`, `mb <mbid>`, `lma <identifier>`, one a line."""
    out = {"discogs": [], "mb": [], "lma": []}
    for n, line in enumerate(open(path), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not SOURCE_LINE.match(line):
            raise ValueError(f"{path}:{n}: not a source: {line!r}")
        kind, ident = line.split(" ", 1)
        out[kind].append(ident)
    return out


def read_names(path):
    return [l.strip() for l in open(path) if l.strip() and not l.lstrip().startswith("#")]


def fetch(raw, discogs=(), mb=(), lma=(), budget=None, clock=time.monotonic):
    """Fetch what the cache under raw lacks; a source that fails is reported and left for the next run.

    budget is how many seconds this run may go on starting fetches; None is as long as it takes. Past it,
    what the cache still lacks is counted as waiting and left for the next run, in the sources' own order.
    The store is built from whatever the cache holds, so new sources reach the graph a run's worth at a time.

    Why: the Jenkins stage that runs this is in the wiki's own build, one build at a time. archive.org took
    0.4 to 4 seconds an item from blu's machine (13 Nov 2026), so 1,000 new sources fetched in one go keep
    every pickipedia deploy waiting 8 to 18 minutes.

    A fetch already started is not cut short: a run can go past its budget by one request's own timeout.

    Returns (got, failed, waiting).
    """
    start = clock()
    got, failed, waiting = 0, [], 0
    for kind, ids, get in (("discogs", discogs, lambda d: sideman.discogs_get(f"releases/{d}")),
                           ("mb", mb, lambda r: sideman.mb_get(f"release/{r}", inc=MB_INC)),
                           (os.path.join("lma", "items"), lma, lma_lineup.fetch)):
        for ident in ids:
            path = os.path.join(raw, kind, f"{ident}.json")
            if kind.startswith("lma") and any(os.path.exists(p) for p in
                                              glob.glob(os.path.join(raw, "lma", "*", f"{glob.escape(ident)}.json"))):
                continue
            if os.path.exists(path):
                continue
            if budget is not None and clock() - start >= budget:
                waiting += 1
                continue
            try:
                doc = get(ident)
            except Exception as e:                      # a source down today is fetched next time
                failed.append(f"{kind} {ident}: {e}")
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".part", "w") as out:
                json.dump(doc, out)
            os.replace(path + ".part", path)
            got += 1
    return got, failed, waiting


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
CREATE TABLE targets (id TEXT PRIMARY KEY, kind TEXT, title TEXT, date TEXT, artist TEXT, grp TEXT,
                      formats TEXT,   -- what the source says a record came out on, "; " between
                      venue TEXT, city TEXT,   -- where a show was, as its source says; '' for a record
                      poster TEXT);            -- a show's poster: a wiki file, or a small picture's address
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
        db.execute("INSERT OR IGNORE INTO targets VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (t["id"], t["kind"], t["title"], t["date"], t.get("artist", ""), t.get("group", t["id"]),
                    "; ".join(t.get("formats") or []), t.get("venue", ""), t.get("city", ""), t.get("poster", "")))
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


ON_STAGE = {"song", "song?", "show", "stage"}


def pairs(rows):
    """Each two people credited on one target, and how far the credits put them together:

      track   the same source puts both on the same track (position and title)
      show    both on the stage at one show (song, song?, show or stage scope)
      apart   one show, but at least one of them not on its stage (bill, festival, taper, unread)
      record  one record, and no source puts them on the same track

    Returns [{"a", "b", "target", "kind", "tracks"}], names sorted; tracks are
    the shared ones, as [source, position, title].
    """
    by_target = {}
    kinds = {}
    for r in rows:
        t = r["target"]["id"]
        kinds[t] = r["target"]["kind"]
        p = by_target.setdefault(t, {}).setdefault(r["person"], {"tracks": set(), "scopes": set()})
        p["scopes"].add(r["scope"])
        for tr in r["tracks"]:
            p["tracks"].add((r["source"], tr["position"], tr["title"]))
    out = []
    for t in sorted(by_target):
        people = by_target[t]
        names = sorted(people)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                shared = sorted(people[a]["tracks"] & people[b]["tracks"])
                if shared:
                    kind = "track"
                elif kinds[t] == "show":
                    kind = "show" if (people[a]["scopes"] & ON_STAGE and people[b]["scopes"] & ON_STAGE) else "apart"
                else:
                    kind = "record"
                out.append({"a": a, "b": b, "target": t, "kind": kind, "tracks": [list(x) for x in shared]})
    return out


def main(argv):
    ap = argparse.ArgumentParser(description="Connectome store: credits off the wiki.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--raw", required=True)
    f.add_argument("--discogs", nargs="*", default=[])
    f.add_argument("--mb", nargs="*", default=[])
    f.add_argument("--sources", nargs="+", default=[],
                   help="sources files (connectome_sources.txt; the walker's walked_sources.txt), fetched as well")
    f.add_argument("--budget", type=float, metavar="SECONDS",
                   help="stop starting fetches after this long; what's left waits for the next run")
    b = sub.add_parser("build")
    b.add_argument("--raw", required=True)
    b.add_argument("--arthel")
    b.add_argument("--lma-names", nargs="+", default=[],
                   help="files, one name per line, for the LMA parser to look for (connectome_names.txt; walked_names.txt)")
    b.add_argument("--out", required=True)
    b.add_argument("--db")
    e = sub.add_parser("pairs", help="write every pair as JSON, for a viewer")
    e.add_argument("--credits", required=True)
    e.add_argument("--out", required=True)
    q = sub.add_parser("together")
    q.add_argument("name")
    q.add_argument("--db", required=True)
    args = ap.parse_args(argv[1:])
    if args.cmd == "fetch":
        src = {"discogs": [], "mb": [], "lma": []}
        for path in args.sources:
            for kind, ids in read_sources(path).items():
                src[kind] += [i for i in ids if i not in src[kind]]
        got, failed, waiting = fetch(args.raw, args.discogs + src["discogs"], args.mb + src["mb"], src["lma"],
                                     budget=args.budget)
        print(f"fetched {got}; {len(failed)} failed" + (f"; {waiting} waiting for the next run" if waiting else "")
              + "".join("\n  " + f for f in failed[:20]))
    elif args.cmd == "build":
        names = []
        for path in args.lma_names:
            names += [n for n in read_names(path) if n not in names]
        rows = build(args.raw, args.arthel, names)
        with open(args.out, "w") as out:
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        if args.db:
            to_sqlite(rows, args.db)
        people = {r["person"] for r in rows}
        targets = {r["target"]["id"] for r in rows}
        print(f"{len(rows)} credits, {len(people)} names, {len(targets)} targets")
    elif args.cmd == "pairs":
        rows = [json.loads(l) for l in open(args.credits)]
        ps = pairs(rows)
        json.dump(ps, open(args.out, "w"), ensure_ascii=False)
        from collections import Counter
        print(len(ps), "pairs", dict(Counter(p["kind"] for p in ps)))
    elif args.cmd == "together":
        db = sqlite3.connect(args.db)
        for other, title, pos, track, src in db.execute(SAME_TRACK, (args.name,)):
            print(f"{other}: {track} ({pos or 'no position'}) on {title}  {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
