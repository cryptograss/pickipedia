#!/usr/bin/env python3
"""
Connectome walker: whoever is in Category:Walk Requested, looked up on Discogs, MusicBrainz and archive.org.

    python3 tools/connectome_walk.py --cache DIR [--wiki https://pickipedia.xyz/] [--budget SECONDS]
    python3 tools/connectome_walk.py --cache DIR --request "Maddie Dalton"    (a walk by hand, category or not)

Justin, #connectome, 18 Nov 2026, 06:20Z: "I don't want [[Category:Walk Requested]] to trigger a wake; I want it to
trigger Artificial Dumb only." So a walk is plain lookups, the same for whoever runs them, and nothing inferred:

  who          the pages in Category:Walk_Requested, and when each was put there (categorymembers' timestamp). A page
               is walked when it was put there after its last walk, so taking the category off and putting it back
               walks it again. Nothing here edits the wiki.
  names        the page's title, its {{MusicianInfo}} name=, and the titles of the redirects to it; only names of two
               words or more, since one word ("Bronwyn") is too loose to look anybody up by.
  links        Discogs releases and artists, MusicBrainz releases and artists, and archive.org items linked from the
               page or its talk page, taken as they are. That is how a person says which "Frank Evans" is meant.
  Discogs      for each name, the one artist Discogs has by that name (ignoring case and its "(2)"), unless the links
               name an artist: their releases as Main, Appearance or TrackAppearance, one per title, newest first.
  MusicBrainz  the same: the one artist of that name, unless linked; the releases they have a performance
               relationship to or are credited on (rambler.mb_records_of), one per title, newest first.
  archive.org  items whose metadata names them (the name, quoted): Live Music Archive tapes (etree), and audio in the
               Tapers Section, where these pickers' tapes mostly are (18 Nov 2026: Tristan Scroggins 7 there, 0 in
               etree; Maddie Dalton 2 and 0).

Two or more artists of one name on a site, and none linked: nothing from that site, and the walk says so. At most CAP
of each kind, and nothing the store's sources already have. Who played on what is for the readers to say
(connectome_store.py), as for any other source.

What a walk finds goes into the cache, never into git, each line saying which request added it:
  walked.json          page -> {"requested", "by", "walked", "names", "sources", "notes"}
  walked_sources.txt   the sources, in connectome_sources.txt's shape, under a comment naming the page and the times
  walked_names.txt     the names, for the LMA reader
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import recording_credits as sideman
import rambler

HERE = os.path.dirname(os.path.abspath(__file__))
CATEGORY = "Category:Walk_Requested"
CAP = {"discogs": 20, "mb": 10, "lma": 20}
LINKS_CAP = 50                    # sources a page and its talk page can name, taken as they are
DISCOGS_ROLES = {"Main", "Appearance", "TrackAppearance"}
IA_QUERY = '"{name}" AND (mediatype:etree OR (mediatype:audio AND collection:taperssection))'
IA_SEARCH = "https://archive.org/advancedsearch.php"
USER_AGENT = "pickipedia-connectome-walk/0.1 (https://pickipedia.xyz; Artificial Dumb)"
IA_INTERVAL = 1.0
_last_ia = [0.0]


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _json(url, timeout=30):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=timeout) as r:
        return json.load(r)


def wiki_getter(wiki):
    api = wiki.rstrip("/") + "/api.php"
    return lambda params: _json(api + "?" + urlencode(dict(params, format="json", formatversion="2")))


def ia_search(query, rows):
    """archive.org's advanced search: the identifiers of items matching query, newest first."""
    wait = _last_ia[0] + IA_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    try:
        params = [("q", query), ("fl[]", "identifier"), ("sort[]", "date desc"), ("rows", rows), ("output", "json")]
        return [d["identifier"] for d in _json(IA_SEARCH + "?" + urlencode(params))["response"]["docs"]]
    finally:
        _last_ia[0] = time.monotonic()


# ---------------------------------------------------------------------------
# Who asked, and who is due
# ---------------------------------------------------------------------------

def requests(wiki_get):
    """[(page title, when it was put in the category)], from the wiki, pickers' pages only (the main namespace)."""
    out, cont = [], {}
    while True:
        data = wiki_get(dict({"action": "query", "list": "categorymembers", "cmtitle": CATEGORY,
                              "cmprop": "title|timestamp", "cmnamespace": "0", "cmlimit": "500"}, **cont))
        out += [(m["title"], m["timestamp"]) for m in data.get("query", {}).get("categorymembers", [])]
        if "continue" not in data:
            return out
        cont = data["continue"]


def due(asked, walked):
    """The requests made since each page's last walk, the oldest first. walked: walked.json's contents."""
    return sorted(((t, ts) for t, ts in asked if ts > (walked.get(t) or {}).get("requested", "")),
                  key=lambda r: (r[1], r[0]))


# ---------------------------------------------------------------------------
# What a page says: its names, and what it links
# ---------------------------------------------------------------------------

LINKS = (
    (re.compile(r"discogs\.com/(?:[a-z]{2}/)?release/(\d+)"), "discogs"),
    (re.compile(r"discogs\.com/(?:[a-z]{2}/)?artist/(\d+)"), "discogs-artist"),
    (re.compile(r"musicbrainz\.org/release/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"), "mb"),
    (re.compile(r"musicbrainz\.org/artist/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"), "mb-artist"),
    (re.compile(r"archive\.org/details/([A-Za-z0-9._-]+)"), "lma"),
)
MUSICIAN_NAME = re.compile(r"\{\{\s*MusicianInfo\b[^{}]*?\|\s*name\s*=\s*([^|}\n]+)", re.I)


def linked(urls):
    """{kind: [id, ...]} for the sources and artists a list of URLs names, in their order, each once."""
    out = {}
    for url in urls:
        for pat, kind in LINKS:
            m = pat.search(url)
            if m and m.group(1) not in out.setdefault(kind, []):
                out[kind].append(m.group(1))
    return out


def page_facts(wiki_get, title):
    """The names to look the page's picker up by, and what the page and its talk page link."""
    data = wiki_get({"action": "query", "titles": f"{title}|Talk:{title}", "prop": "redirects|extlinks|revisions",
                     "rvprop": "content", "rvslots": "main", "rdlimit": "max", "ellimit": "max"})
    names, urls = [title], []
    for p in data.get("query", {}).get("pages", []):
        urls += [e.get("url", "") for e in p.get("extlinks", [])]
        if p.get("title") != title:
            continue
        names += [r["title"] for r in p.get("redirects", [])]
        text = ((p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", ""))
        m = MUSICIAN_NAME.search(text)
        if m:
            names.append(m.group(1).strip())
    seen, kept = set(), []
    for n in names:
        n = " ".join(n.replace("_", " ").split())
        if len(n.split()) >= 2 and n.casefold() not in seen:
            seen.add(n.casefold())
            kept.append(n)
    return kept, linked(urls)


# ---------------------------------------------------------------------------
# The lookups
# ---------------------------------------------------------------------------

def discogs_releases(artist_id, get):
    """An artist's Discogs releases as Main, Appearance or TrackAppearance, a master as its main release; one per
    title, newest first."""
    data = get(f"artists/{artist_id}/releases?per_page=100&sort=year&sort_order=desc")
    out, titles = [], set()
    for r in sorted(data.get("releases", []), key=lambda r: -(r.get("year") or 0)):
        if r.get("role") not in DISCOGS_ROLES:
            continue
        rid = r.get("main_release") if r.get("type") == "master" else r.get("id")
        key = sideman.normalize_title(r.get("title", ""))
        if rid and key not in titles:
            titles.add(key)
            out.append(f"discogs {rid}")
    return out


def mb_releases(mbid, records_of):
    """An artist's MusicBrainz releases (rambler.mb_records_of: performance relationships and their own; one per
    title), newest first."""
    found = records_of(mbid).values()
    return [f"mb {rid}" for date, rid, title in sorted(found, key=lambda x: x[0] if x[0] != "9999" else "", reverse=True)]


def lookup_artists(site, names, linked_ids, named, notes):
    """The artists to walk on one site: the linked ones, or else, for each name, the one artist of that name."""
    if linked_ids:
        return list(linked_ids)
    out = []
    for name in names:
        try:
            found = named(name)
        except Exception as e:                               # a site down today: the next request walks it
            notes.append(f"{site}: {name}: {e}")
            continue
        if len(found) == 1:
            out.append(found[0][0])
        elif found:
            notes.append(f"{site}: {len(found)} artists named {name}; a link to one on the page or its talk page says which")
        else:
            notes.append(f"{site}: no artist named {name}")
    return list(dict.fromkeys(out))


def walk_one(title, names, links, known, look):
    """One walk: the sources to add, newest first, at most CAP of each kind past those known, and what was noted.

    look: {"discogs_named", "discogs_releases", "mb_named", "mb_releases", "ia_search"}, the lookups (tests swap them).
    """
    notes, adding = [], []
    have = set(known)

    def add(lines, cap=None):
        n = 0
        for line in lines:
            if line in have:
                continue
            if cap is not None and n >= cap:
                break
            have.add(line)
            adding.append(line)
            n += 1
        return n

    add([f"discogs {i}" for i in links.get("discogs", [])] + [f"mb {i}" for i in links.get("mb", [])] +
        [f"lma {i}" for i in links.get("lma", [])], LINKS_CAP)
    for site, key, named, releases in (("Discogs", "discogs", look["discogs_named"], look["discogs_releases"]),
                                       ("MusicBrainz", "mb", look["mb_named"], look["mb_releases"])):
        lines = []
        for artist in lookup_artists(site, names, links.get(key + "-artist", []), named, notes):
            try:
                lines += releases(artist)
            except Exception as e:                           # a site down today: the next request walks it
                notes.append(f"{site}: artist {artist}: {e}")
        n = add(lines, CAP[key])
        if lines:
            notes.append(f"{site}: {n} added of {len(lines)} found")
    lines = []
    for name in names:
        try:
            lines += [f"lma {i}" for i in look["ia_search"](IA_QUERY.format(name=name.replace('"', "")), 100)]
        except Exception as e:
            notes.append(f"archive.org: {name}: {e}")
    n = add(lines, CAP["lma"])
    notes.append(f"archive.org: {n} added of {len(lines)} found")
    return adding, notes


LOOKUPS = {
    "discogs_named": rambler.discogs_artists_named,
    "discogs_releases": lambda a: discogs_releases(a, sideman.discogs_get),
    "mb_named": rambler.mb_artists_named,
    "mb_releases": lambda a: mb_releases(a, rambler.mb_records_of),
    "ia_search": ia_search,
}


# ---------------------------------------------------------------------------
# The cache's files
# ---------------------------------------------------------------------------

def known_sources(paths):
    """Every source line in the files given (connectome_sources.txt's shape), comments and blanks left out."""
    out = set()
    for path in paths:
        if os.path.exists(path):
            out |= {l.strip() for l in open(path) if l.strip() and not l.lstrip().startswith("#")}
    return out


def _write(path, text):
    with open(path + ".part", "w") as f:
        f.write(text)
    os.replace(path + ".part", path)


def write_files(cache, walked):
    """walked.json, and walked_sources.txt and walked_names.txt made from it, the oldest walk first."""
    _write(os.path.join(cache, "walked.json"), json.dumps(walked, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    order = sorted(walked, key=lambda t: (walked[t]["walked"], t))
    src = ["# Sources the connectome build's walker added for Category:Walk Requested (tools/connectome_walk.py).",
           "# Not in git; each one under the page whose request added it. connectome_sources.txt's shape."]
    names, seen = [], set()
    for t in order:
        w = walked[t]
        src.append(f"# {t}: " + (f"put in the category {w['requested']}" if w.get("by", "category") == "category"
                                  else "asked for by hand") + f", walked {w['walked']}")
        src += w["sources"]
        for n in w["names"]:
            if n.casefold() not in seen:
                seen.add(n.casefold())
                names.append(n)
    _write(os.path.join(cache, "walked_sources.txt"), "\n".join(src) + "\n")
    _write(os.path.join(cache, "walked_names.txt"), "".join(n + "\n" for n in names))


def run(cache, asked, facts, known_paths, budget=None, look=LOOKUPS, clock=time.monotonic, stamp=now_iso, by="category"):
    """Walk the requests due, the oldest first, starting no new walk once budget seconds have gone; a walk started
    is finished. asked: [(page, when it was asked for)], from the category (by="category") or by hand ("hand", asked
    now). A page the wiki doesn't answer for waits for the next run. Writes the cache's files. Returns (walks,
    waiting, report lines)."""
    path = os.path.join(cache, "walked.json")
    walked = json.load(open(path)) if os.path.exists(path) else {}
    todo = due(asked, walked)
    start, done, report = clock(), 0, []
    for title, requested in todo:
        if budget is not None and clock() - start >= budget:
            break
        try:
            names, links = facts(title)
        except Exception as e:
            report.append(f"{title}: not walked, the wiki didn't answer ({e}); next run")
            continue
        known = known_sources(known_paths) | {s for t, w in walked.items() if t != title for s in w["sources"]}
        sources, notes = walk_one(title, names, links, known, look)
        walked[title] = {"requested": requested, "by": by, "walked": stamp(), "names": names, "sources": sources,
                         "notes": notes}
        write_files(cache, walked)
        done += 1
        report.append(f"{title}: {len(sources)} sources ({'; '.join(notes)})")
    if not os.path.exists(os.path.join(cache, "walked_sources.txt")):
        write_files(cache, walked)
    return done, len(todo) - done, report


def main(argv):
    ap = argparse.ArgumentParser(description="Walk whoever is in Category:Walk Requested (Artificial Dumb).")
    ap.add_argument("--cache", required=True, help="the connectome cache: walked.json and the walked_* files go here")
    ap.add_argument("--wiki", default="https://pickipedia.xyz/")
    ap.add_argument("--budget", type=float, metavar="SECONDS", help="start no walk after this long; the rest wait")
    ap.add_argument("--sources", nargs="*", default=[os.path.join(HERE, "connectome_sources.txt")],
                    help="sources files the store already reads: what's in them isn't added again")
    ap.add_argument("--request", action="append", default=[], metavar="PAGE",
                    help="walk this page now, in the category or not (repeatable)")
    args = ap.parse_args(argv[1:])
    os.makedirs(args.cache, exist_ok=True)
    wiki_get = wiki_getter(args.wiki)
    asked = [(t, now_iso()) for t in args.request] if args.request else requests(wiki_get)
    done, waiting, report = run(args.cache, asked, lambda t: page_facts(wiki_get, t), args.sources, args.budget,
                                by="hand" if args.request else "category")
    print(f"Connectome walk: {done} walked" + (f"; {waiting} waiting for the next run" if waiting else "")
          + "".join("\n  " + r for r in report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
