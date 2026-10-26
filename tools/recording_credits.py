#!/usr/bin/env python3
"""
Who plays on a recording: an Artificial Dumb lookup.

    python3 tools/recording_credits.py "Tony Rice" "House of the Rising Sun"

Asks MusicBrainz for every recording of the title whose artist credit
mentions the artist, then reads each release's credits from MusicBrainz and,
where MusicBrainz links one, from Discogs. It prints what each source says,
and nothing else: no merging of people across sources and no guessing.

The scope of each credit matters as much as the credit. Both databases mostly
attach players to the whole release ("tracks: all"), which says who is on the
record, not who plays on this song. So every credit is marked:

  track     the source attaches it to this track
  release   the source attaches it to the whole release

Only "track" credits answer the question. "release" credits are a lead to
check against liner notes, and the output says so instead of
promoting them.

Reissues are folded together: one release per MusicBrainz release group,
the earliest dated one.
"""

import json
import re
import sys
import time
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

USER_AGENT = "pickipedia-recording-credits/0.1 (https://pickipedia.xyz)"
MB = "https://musicbrainz.org/ws/2"
DISCOGS = "https://api.discogs.com"

# MusicBrainz asks for at most one request a second; Discogs allows 25 a
# minute without a key.
MB_INTERVAL = 1.1
DISCOGS_INTERVAL = 2.5

# MusicBrainz relationship types that mean someone performed.
MB_PERFORMANCE_TYPES = {"instrument", "vocal", "performer", "performing orchestra"}

# Discogs roles that mean someone did something other than perform. Discogs
# roles are free text, so this list is the dumb part: a role not on it is
# shown as a performance. Extend it when a new one turns up.
DISCOGS_OTHER_ROLES = (
    "producer", "executive-producer", "co-producer", "mixed by", "mastered by",
    "recorded by", "engineer", "liner notes", "design", "layout", "photography",
    "art direction", "artwork", "written-by", "written by", "arranged by",
    "composed by", "lyrics by", "music by", "lacquer cut", "coordinator",
    "management", "booking", "edited by", "remastered by", "transferred by",
    "notes", "illustration", "cover", "a&r", "copyright", "licensed",
)

_last_call = {}


def _get_json(url, host, interval, attempts=4):
    """GET a JSON document, pacing calls to each host.

    Both services answer 503 (MusicBrainz) or 429 (Discogs) when we are going
    too fast; those get retried with a growing wait. Anything else is raised.
    """
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(attempts):
        wait = _last_call.get(host, 0) + interval * (2 ** attempt) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            with urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except HTTPError as e:
            if e.code not in (429, 503) or attempt == attempts - 1:
                raise
        finally:
            _last_call[host] = time.monotonic()


def mb_get(path, **params):
    params["fmt"] = "json"
    return _get_json(f"{MB}/{path}?{urlencode(params)}", "mb", MB_INTERVAL)


def discogs_get(path):
    return _get_json(f"{DISCOGS}/{path}", "discogs", DISCOGS_INTERVAL)


def normalize_title(title):
    """Lowercase, straighten quotes, drop punctuation and a leading article."""
    t = title.lower().replace("’", "'")
    t = re.sub(r"[^\w\s']", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"^(the|a|an) ", "", t)


def strip_discogs_suffix(name):
    """Discogs disambiguates names as 'Craig Miller (3)'; the number isn't the name."""
    return re.sub(r"\s\(\d+\)$", "", name)


def credit_line(artist_credit):
    return "".join(a["name"] + a.get("joinphrase", "") for a in artist_credit)


def find_recordings(artist, title):
    """Every MusicBrainz recording of title whose artist credit mentions artist."""
    query = f'recording:"{title}" AND artist:"{artist}"'
    data = mb_get("recording/", query=query, limit=100)
    want = normalize_title(title)
    return [
        r for r in data.get("recordings", [])
        if normalize_title(r["title"]) == want
        and artist.lower() in credit_line(r["artist-credit"]).lower()
    ]


def pick_releases(recordings):
    """One release per release group, the earliest dated; undated ones last."""
    groups = {}
    for rec in recordings:
        for rel in rec.get("releases", []):
            group = rel.get("release-group", {}).get("id", rel["id"])
            key = (rel.get("date") or "9999", rel["id"])
            if group not in groups or key < groups[group][0]:
                groups[group] = (key, rec["id"], rel["id"])
    return [(rec_id, rel_id) for _, rec_id, rel_id in sorted(groups.values())]


def mb_credits(release, recording_id):
    """Performance credits from a MusicBrainz release, with their scope."""
    credits = []
    for rel in release.get("relations", []):
        if rel["type"] in MB_PERFORMANCE_TYPES and "artist" in rel:
            credits.append(_mb_credit(rel, "release"))
    track = None
    for medium in release.get("media", []):
        for t in medium.get("tracks", []):
            if t["recording"]["id"] == recording_id:
                track = t
                for rel in t["recording"].get("relations", []):
                    if rel["type"] in MB_PERFORMANCE_TYPES and "artist" in rel:
                        credits.append(_mb_credit(rel, "track"))
    return track, credits


def _mb_credit(rel, scope):
    role = ", ".join(rel.get("attributes") or []) or rel["type"]
    return {"name": rel["artist"]["name"], "role": role, "scope": scope, "source": "MusicBrainz"}


def discogs_id(release):
    for rel in release.get("relations", []):
        m = re.match(r"https?://(?:www\.)?discogs\.com/release/(\d+)", rel.get("url", {}).get("resource", ""))
        if m:
            return m.group(1)
    return None


def track_in_spec(position, spec):
    """Whether a Discogs 'tracks' spec such as '1, 3 to 5' or 'A2' covers position."""
    for part in (p.strip() for p in spec.split(",")):
        if " to " in part:
            lo, hi = (x.strip() for x in part.split(" to ", 1))
            if lo.isdigit() and hi.isdigit() and position.isdigit():
                if int(lo) <= int(position) <= int(hi):
                    return True
            elif part == position:
                return True
        elif part == position:
            return True
    return False


def is_performance(role):
    r = role.lower()
    return not any(r.startswith(other) for other in DISCOGS_OTHER_ROLES)


def discogs_credits(release, title):
    """Performance credits from a Discogs release for the track titled title."""
    want = normalize_title(title)
    track = next((t for t in release.get("tracklist", []) if normalize_title(t["title"]) == want), None)
    credits = []
    position = track["position"] if track else None
    for e in release.get("extraartists", []):
        if not is_performance(e["role"]):
            continue
        spec = (e.get("tracks") or "").strip()
        if not spec:
            scope = "release"
        elif position and track_in_spec(position, spec):
            scope = "track"
        else:
            continue  # credited on other tracks only
        credits.append({"name": strip_discogs_suffix(e["name"]), "role": e["role"],
                        "scope": scope, "source": "Discogs"})
    for e in (track or {}).get("extraartists", []):
        if is_performance(e["role"]):
            credits.append({"name": strip_discogs_suffix(e["name"]), "role": e["role"],
                            "scope": "track", "source": "Discogs"})
    return track, credits


def lookup(artist, title):
    """Everything the sources say about who plays on each version."""
    versions = []
    for recording_id, release_id in pick_releases(find_recordings(artist, title)):
        release = mb_get(f"release/{release_id}",
                         inc="artist-credits+labels+recordings+artist-rels+recording-level-rels+url-rels")
        track, credits = mb_credits(release, recording_id)
        version = {
            "artist": credit_line(release.get("artist-credit", [])),
            "release": release["title"],
            "date": release.get("date", ""),
            "labels": [f'{li["label"]["name"]} {li.get("catalog-number") or ""}'.strip()
                       for li in release.get("label-info", []) if li.get("label")],
            "track": track["position"] if track else None,
            "sources": [f"https://musicbrainz.org/release/{release_id}"],
            "credits": credits,
        }
        did = discogs_id(release)
        if did:
            dtrack, dcredits = discogs_credits(discogs_get(f"releases/{did}"), title)
            version["sources"].append(f"https://www.discogs.com/release/{did}")
            version["credits"] += dcredits
            if dtrack is None:
                version["note"] = "Discogs tracklist has no track with this title"
        versions.append(version)
    return versions


def render(artist, title, versions):
    lines = [f'Who plays on {artist}: "{title}"', ""]
    if not versions:
        lines.append("MusicBrainz has no recording with this title and artist.")
    for v in versions:
        lines.append(f'{v["artist"]}: {v["release"]} ({v["date"] or "undated"}), '
                     f'{"; ".join(v["labels"]) or "no label"}, track {v["track"]}')
        for scope, heading in (("track", "Credited on this track"),
                               ("release", "Credited on the whole release (check liner notes)")):
            rows = [c for c in v["credits"] if c["scope"] == scope]
            lines.append(f"  {heading}:")
            if not rows:
                lines.append("    (none)")
            for c in rows:
                lines.append(f'    {c["name"]}: {c["role"]} [{c["source"]}]')
        if v.get("note"):
            lines.append(f'  Note: {v["note"]}')
        lines.append("  Sources: " + " ".join(v["sources"]))
        lines.append("")
    return "\n".join(lines)


def main(argv):
    args = [a for a in argv[1:] if a != "--json"]
    if len(args) != 2:
        print(__doc__.strip().splitlines()[0])
        print('usage: recording_credits.py [--json] "ARTIST" "TITLE"')
        return 2
    artist, title = args
    versions = lookup(artist, title)
    print(json.dumps(versions, indent=2) if "--json" in argv else render(artist, title, versions))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
