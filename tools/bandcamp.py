#!/usr/bin/env python3
"""
Liner: a Bandcamp page's credits, copied word for word.

    python3 tools/bandcamp.py https://milkweed.bandcamp.com/album/milkweed-ep
    python3 tools/bandcamp.py --tracks https://milkweed.bandcamp.com/album/milkweed-ep
    python3 tools/bandcamp.py https://milkweed.bandcamp.com
    python3 tools/bandcamp.py --json <url>

An Artificial Dumb reader for the connectome. MusicBrainz and Discogs know
little about a band from Main Street in Binghamton; Bandcamp is where bands
like that put their credits. Bandcamp writes those credits in prose ("Joe
Biglin - keys", "Recorded at 25 Murray Studios"), with no fields for who
or what, so this tool does not try to read them. It copies them.

What it reads: the schema.org JSON-LD every Bandcamp album and track page
carries -- name, artist, label, release date, the credits (creditText), and
the about text (description) -- and nothing else from the page.

What it puts out: those fields, verbatim, under the page's URL, which is the
source a person cites. With --tracks, each track's page is read too, since a
track can carry credits of its own. Given an artist's page instead of an
album, it lists the album and track URLs found there.

What makes it dumb, deliberately:

  - Credits are copied, never parsed. Splitting "Joe - keys, vocals" into a
    person and two instruments is a judgement, and it belongs to the person
    who writes the {{Record personnel}} lines, with this text in front of them.
  - It names itself honestly in its User-Agent, and fetches with curl
    (see fetch() for why). Needs curl; nothing else outside the stdlib.
  - One request every 1.5 seconds.
  - It writes nothing.
"""

import argparse
import html
import json
import re
import subprocess
import sys
import time
from urllib.parse import urljoin, urlparse

USER_AGENT = "pickipedia-liner/0.1 (https://pickipedia.xyz; Artificial Dumb for the connectome)"
INTERVAL = 1.5
_last = [0.0]

LD_JSON = re.compile(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', re.S)
LINKS = re.compile(r'href="(/(?:album|track)/[A-Za-z0-9_-]+)"')


class NotAnAlbum(Exception):
    pass


def fetch(url):
    """(final URL after redirects, page). Fetched with curl, not urllib.

    Bandcamp answers Python's own HTTPS client with a JavaScript challenge
    page, whatever its headers say, and answers curl with the album (tested
    7 Nov 2026, same User-Agent both ways). So curl does the fetching: same
    honest User-Agent, no pretending to be a browser. Arguments are a list;
    no shell is involved.
    """
    wait = INTERVAL - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    try:
        out = subprocess.run(
            ["curl", "-sSL", "--max-time", "30", "-A", USER_AGENT,
             "-w", "\n%{url_effective}", "--", url],
            capture_output=True, text=True, check=True).stdout
    finally:
        _last[0] = time.monotonic()
    page, _, final = out.rpartition("\n")
    return final, page


def is_bandcamp(url):
    host = urlparse(url).hostname or ""
    return host == "bandcamp.com" or host.endswith(".bandcamp.com")


def ld_json(page):
    """The page's schema.org object, or None. A challenge page has none."""
    m = LD_JSON.search(page)
    return json.loads(m.group(1)) if m else None


def text(value):
    """Bandcamp's prose as written: entities decoded, Windows line ends made
    plain, nothing else touched."""
    if not value:
        return ""
    return html.unescape(value).replace("\r\n", "\n").strip()


def date(value):
    """'18 Jul 2013 00:00:00 GMT' -> '18 Jul 2013'. The time is always midnight."""
    return re.sub(r"\s+00:00:00 GMT$", "", value or "")


def read_page(url, page):
    """One album or track page -> its credits and the facts around them."""
    d = ld_json(page)
    if not d or d.get("@type") not in ("MusicAlbum", "MusicRecording"):
        raise NotAnAlbum(f"{url}: no album or track data on the page "
                         "(an artist page, a challenge page, or not Bandcamp)")
    tracks = []
    for entry in (d.get("track") or {}).get("itemListElement", []):
        item = entry.get("item", {})
        tracks.append({"position": entry.get("position"), "name": text(item.get("name")),
                       "url": item.get("@id") or item.get("mainEntityOfPage", "")})
    return {
        "url": url,
        "kind": "album" if d["@type"] == "MusicAlbum" else "track",
        "title": text(d.get("name")),
        "artist": text((d.get("byArtist") or {}).get("name")),
        "label": text((d.get("publisher") or {}).get("name")),
        "album": text((d.get("inAlbum") or {}).get("name")),
        "released": date(d.get("datePublished")),
        "credits": text(d.get("creditText")),
        "about": text(d.get("description")),
        "tracks": tracks,
    }


def discography(url, page):
    """Album and track URLs on an artist's page, in page order, once each."""
    seen, found = set(), []
    for path in LINKS.findall(page):
        full = urljoin(url, path)
        if full not in seen:
            seen.add(full)
            found.append(full)
    return found


def read(url, tracks=False, get=fetch):
    """Read url. Returns ("album", record) or ("artist", [urls]).

    An artist's URL (no /album/ or /track/ in it) is read as the artist's
    /music page. Their front page often redirects to one featured album,
    which would hide the rest.
    """
    path = urlparse(url).path
    if "/album/" not in path and "/track/" not in path:
        final, page = get(urljoin(url, "/music"))
        found = discography(final, page)
        if not found and ("/album/" in final or "/track/" in final):
            found = [final]  # one release: /music redirects straight to it
        return "artist", found
    final, page = get(url)
    record = read_page(final, page)
    if tracks:
        for t in record["tracks"]:
            if t["url"]:
                turl, tpage = get(t["url"])
                tr = read_page(turl, tpage)
                t["credits"], t["about"] = tr["credits"], tr["about"]
    return "album", record


def render(record):
    r = record
    lines = [f'{r["artist"]}: {r["title"]} ({r["kind"]}{", on " + r["album"] if r["album"] else ""})',
             f'  Source: {r["url"]}']
    if r["released"]:
        lines.append(f'  Released: {r["released"]}')
    if r["label"] and r["label"] != r["artist"]:
        lines.append(f'  Label: {r["label"]}')
    lines += ["", "  Credits, as Bandcamp has them:"]
    lines += [f"    {ln}" for ln in r["credits"].splitlines()] if r["credits"] else ["    (none)"]
    if r["about"]:
        lines += ["", "  About, as Bandcamp has it:"]
        lines += [f"    {ln}" for ln in r["about"].splitlines()]
    with_credits = [t for t in r["tracks"] if t.get("credits")]
    if with_credits:
        lines += ["", "  Track credits:"]
        for t in with_credits:
            lines.append(f'    {t["position"]}. {t["name"]}  {t["url"]}')
            lines += [f"      {ln}" for ln in t["credits"].splitlines()]
    elif r["tracks"] and any("credits" in t for t in r["tracks"]):
        lines += ["", "  No track carries credits of its own."]
    lines += ["", "  Nothing here is parsed. Who played what is for a person to read off the text above."]
    return "\n".join(lines)


def main(argv):
    ap = argparse.ArgumentParser(description="Liner: a Bandcamp page's credits, word for word.")
    ap.add_argument("url", help="a Bandcamp album, track or artist URL")
    ap.add_argument("--tracks", action="store_true", help="read each track's page for its own credits")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv[1:])
    if not is_bandcamp(args.url):
        ap.error("not a bandcamp.com URL")
    try:
        kind, result = read(args.url, tracks=args.tracks)
    except NotAnAlbum as e:
        print(e, file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif kind == "artist":
        print("\n".join(result) if result else "No albums or tracks found on that page.")
    else:
        print(render(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
