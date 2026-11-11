#!/usr/bin/env python3
"""
Sideman: who plays on a recording, an Artificial Dumb lookup.

    python3 tools/recording_credits.py "Tony Rice" "House of the Rising Sun"
    python3 tools/recording_credits.py --album "Tony Rice" "Manzanita"

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

--album asks the other question, "who is on this record?", and asks it of
each source separately: MusicBrainz, then Discogs on its own, because a
record MusicBrainz has never heard of is often on Discogs. Each source's
answer is printed under that source, every person with the roles and the
scope that source gives them. Nobody is merged across sources; a reader
sees two readings of the same record and decides. This is what Rambler
reads, and what a person verifies.

--bandcamp URL adds a third reading: the record's Bandcamp page, where small
bands put the credits MusicBrainz and Discogs never got. Bandcamp's credits
are prose ("Joe Biglin - keys", "Recorded at 25 Murray Studios") with no
fields for who or what, so Sideman copies them word for word and parses
nothing: splitting a line into a person and an instrument is the judgement
of the person who writes it up, with the text in front of them. Bandcamp
challenges searches, so the page is a URL a person hands in.

    python3 tools/recording_credits.py --album "Milkweed" "Milkweed EP" \
        --bandcamp https://milkweed.bandcamp.com/album/milkweed-ep
"""

import argparse
import html
import json
import re
import subprocess
import sys
import time
from urllib.parse import urlencode, urlparse
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

def _norm_role(text):
    """A Discogs role reduced to bare words: 'Lead Guitar [Electric]' -> 'lead guitar'.

    Discogs writes the same job several ways -- 'Executive Producer' and
    'Executive-Producer', 'Written By' and 'Written-By' -- so both the list
    below and each role being tested go through here before they are compared.
    The bracketed part is a qualifier ('Liner Notes [Song Notes]'), never the job.
    """
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text)).strip()


# Discogs roles that mean someone did something other than perform. Discogs
# roles are free text, so this list is the dumb part: a role not on it is
# shown as a performance. Extend it when a new one turns up; the entries are
# normalized the same way a role is, so write them however reads best.
#
# An entry matches anywhere in a role, as whole words, not only at its start:
# a job title usually ends with the job and starts with a qualifier, so
# 'Assistant Engineer' and 'Guitar Technician' are both jobs, not players.
DISCOGS_OTHER_ROLES = tuple(_norm_role(r) for r in (
    "producer", "executive producer", "co producer", "associate producer",
    "mixed by", "mixing", "mastered by", "mastering", "recorded by",
    "engineer", "technician", "tech", "assistant", "roadie",
    "liner notes", "sleeve notes", "song notes", "notes",
    "design", "layout", "graphic design", "art direction", "artwork",
    "illustration", "cover", "photography", "photography by", "photographer",
    "written by", "songwriter", "composed by", "lyrics by", "music by",
    "arranged by", "lacquer cut", "coordinator", "project coordination",
    "project manager", "production manager", "management", "booking",
    "edited by", "editor", "remastered by", "transferred by", "compiled by",
    "a&r", "copyright", "licensed", "manufactured by", "distributed by",
    "created by", "directed by", "film director", "music director", "legal",
))

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


MB_PAGE = 100
MB_MAX_RESULTS = 1000  # "Shady Grove" territory: enough, and a ceiling on calls


def find_recordings(artist, title):
    """Every MusicBrainz recording of title whose artist credit mentions artist.

    MusicBrainz answers at most 100 per call; a title with more recordings
    than that is paged through by offset until its count is reached.
    """
    query = f'recording:"{title}" AND artist:"{artist}"'
    want = normalize_title(title)
    found, offset = [], 0
    while True:
        data = mb_get("recording/", query=query, limit=MB_PAGE, offset=offset)
        page = data.get("recordings", [])
        found += [
            r for r in page
            if normalize_title(r["title"]) == want
            and artist.lower() in credit_line(r["artist-credit"]).lower()
        ]
        offset += len(page)
        if not page or offset >= min(data.get("count", 0), MB_MAX_RESULTS):
            return found


def pick_releases(recordings):
    """One release per release group, the earliest dated; undated ones last.

    Releases outside a group that share a title and date are folded too: the
    same show turns up as several release groups, sometimes one per taper.
    """
    groups = {}
    for rec in recordings:
        for rel in rec.get("releases", []):
            group = rel.get("release-group", {}).get("id", rel["id"])
            key = (rel.get("date") or "9999", rel["id"])
            if group not in groups or key < groups[group][0]:
                groups[group] = (key, rec["id"], rel["id"], rel)
    seen, picked = set(), []
    for key, rec_id, rel_id, rel in sorted(groups.values()):
        shown = (normalize_title(rel.get("title", "")), rel.get("date") or "")
        if shown in seen:
            continue
        seen.add(shown)
        picked.append((rec_id, rel_id))
    return picked


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
    """Whether a Discogs 'tracks' spec such as '1, 3 to 5' or 'A2' covers position.

    A sub-track of a medley is positioned '2.1'; a credit on track '2' covers it.
    """
    positions = [position]
    if "." in position:
        positions.append(position.split(".", 1)[0])
    for part in (p.strip() for p in spec.split(",")):
        if " to " in part:
            lo, hi = (x.strip() for x in part.split(" to ", 1))
            for pos in positions:
                if lo.isdigit() and hi.isdigit() and pos.isdigit():
                    if int(lo) <= int(pos) <= int(hi):
                        return True
                elif part == pos:
                    return True
        elif part in positions:
            return True
    return False


def discogs_tracks(release):
    """Every track on a Discogs release, sub-tracks of medleys included."""
    for t in release.get("tracklist", []):
        yield t
        yield from t.get("sub_tracks", [])


def performance_roles(role):
    """The parts of a Discogs role that mean performing.

    A role is often several jobs at once -- 'Banjo, Producer, Mixed By' -- so
    each part is judged on its own. Judging the whole string would let the
    first word hide the rest: 'Guitar, Producer' starts with 'guitar', and
    reporting it as a performance would credit a producer as a player.
    """
    parts = []
    for part in re.split(r"[,/]", role):
        norm = _norm_role(part)
        if norm and not any(re.search(rf"\b{re.escape(other)}\b", norm) for other in DISCOGS_OTHER_ROLES):
            parts.append(part.strip())
    return parts


def is_performance(role):
    return bool(performance_roles(role))


def discogs_credits(release, title):
    """Performance credits from a Discogs release for the track titled title."""
    want = normalize_title(title)
    track = next((t for t in discogs_tracks(release) if normalize_title(t["title"]) == want), None)
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
        credits.append({"name": strip_discogs_suffix(e["name"]),
                        "role": ", ".join(performance_roles(e["role"])),
                        "scope": scope, "source": "Discogs"})
    for e in (track or {}).get("extraartists", []):
        if is_performance(e["role"]):
            credits.append({"name": strip_discogs_suffix(e["name"]),
                            "role": ", ".join(performance_roles(e["role"])),
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


# ---------------------------------------------------------------------------
# A whole record: --album
# ---------------------------------------------------------------------------

def mb_people(release):
    """Everyone credited as performing on a MusicBrainz release.

    Returns {name: {"mbid", "roles", "scopes"}}. A person credited on any
    track is on the record, so track credits count, marked "track"; credits
    on the release itself are marked "release".
    """
    people = {}

    def add(rel, scope):
        if rel.get("type") not in MB_PERFORMANCE_TYPES or "artist" not in rel:
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
    """Everyone credited as performing on a Discogs release, same shape as
    mb_people. A release-level credit naming tracks is a track credit."""
    people = {}

    def add(entry, scope):
        roles = performance_roles(entry.get("role", ""))
        if not roles:
            return
        name = strip_discogs_suffix(entry["name"])
        p = people.setdefault(name, {"mbid": None, "roles": set(), "scopes": set()})
        p["roles"].update(roles)
        p["scopes"].add("track" if (entry.get("tracks") or "").strip() else scope)

    for e in release.get("extraartists", []):
        add(e, "release")
    for track in discogs_tracks(release):
        for e in track.get("extraartists", []):
            add(e, "track")
    return people


def discogs_credit_rows(release):
    """Every performance credit on a Discogs release, one row per credit as
    Discogs gives it, with the tracks it covers.

    [{"name", "roles", "scope", "tracks": [{"position", "title"}]}]. A
    release-level credit with a "tracks" spec covers the tracks the spec
    names; with none, the whole release (scope "release", tracks []). A
    credit on a track covers that track.
    """
    tracks = list(discogs_tracks(release))
    rows = []
    for e in release.get("extraartists", []):
        roles = performance_roles(e.get("role", ""))
        if not roles:
            continue
        spec = (e.get("tracks") or "").strip()
        covered = [{"position": t.get("position", ""), "title": t.get("title", "")}
                   for t in tracks if spec and t.get("position") and track_in_spec(t["position"], spec)]
        rows.append({"name": strip_discogs_suffix(e["name"]), "roles": roles,
                     "scope": "track" if spec else "release", "tracks": covered,
                     **({"tracks_as_written": spec} if spec else {})})
    for t in tracks:
        for e in t.get("extraartists", []):
            roles = performance_roles(e.get("role", ""))
            if roles:
                rows.append({"name": strip_discogs_suffix(e["name"]), "roles": roles, "scope": "track",
                             "tracks": [{"position": t.get("position", ""), "title": t.get("title", "")}]})
    return rows


def mb_credit_rows(release):
    """Every performance credit on a MusicBrainz release (fetched with
    recording-level relations), same shape as discogs_credit_rows. A track's
    position is "<medium>-<number>", as MusicBrainz numbers them."""
    rows = []

    def row(rel, scope, tracks):
        if rel.get("type") not in MB_PERFORMANCE_TYPES or "artist" not in rel:
            return
        rows.append({"name": rel["artist"]["name"], "mbid": rel["artist"].get("id"),
                     "roles": [", ".join(rel.get("attributes") or []) or rel["type"]],
                     "scope": scope, "tracks": tracks})

    for rel in release.get("relations", []):
        row(rel, "release", [])
    for medium in release.get("media", []):
        for track in medium.get("tracks", []):
            pos = f"{medium.get('position', 1)}-{track.get('number') or track.get('position')}"
            for rel in track.get("recording", {}).get("relations", []):
                row(rel, "track", [{"position": pos, "title": track.get("title", "")}])
    return rows


def _one_per_group_earliest(hits, group_of):
    groups = {}
    for hit in hits:
        g = group_of(hit)
        key = (hit.get("date") or hit.get("year") or "9999", hit["id"])
        if g not in groups or key < groups[g][0]:
            groups[g] = (key, hit)
    return [hit for _, hit in sorted(groups.values(), key=lambda kv: kv[0])]


def find_releases(artist, title):
    """MusicBrainz releases titled title whose artist credit mentions artist:
    one per release group, the earliest dated."""
    want = normalize_title(title)
    data = mb_get("release/", query=f'release:"{title}" AND artist:"{artist}"', limit=25)
    hits = [r for r in data.get("releases", [])
            if normalize_title(r.get("title", "")) == want
            and artist.lower() in credit_line(r.get("artist-credit", [])).lower()]
    return _one_per_group_earliest(hits, lambda r: (r.get("release-group") or {}).get("id", r["id"]))


def discogs_find_releases(artist, title):
    """Discogs releases of title by artist, searched directly: a record that
    MusicBrainz has never heard of is often here. One per master, earliest."""
    want_title, want_artist = normalize_title(title), normalize_title(artist)
    data = discogs_get("database/search?" + urlencode(
        {"artist": artist, "release_title": title, "type": "release", "per_page": 25}))
    hits = []
    for r in data.get("results", []):
        # Discogs search titles read "Artist - Title".
        got_artist, _, got_title = r.get("title", "").partition(" - ")
        if normalize_title(got_title) == want_title and want_artist in normalize_title(strip_discogs_suffix(got_artist)):
            hits.append({**r, "id": str(r["id"])})
    return _one_per_group_earliest(hits, lambda r: r.get("master_id") or r["id"])


# ---------------------------------------------------------------------------
# Bandcamp: credits copied, never parsed
# ---------------------------------------------------------------------------

BANDCAMP_UA = "pickipedia-recording-credits/0.1 (https://pickipedia.xyz; Artificial Dumb)"
BANDCAMP_INTERVAL = 1.5
LD_JSON = re.compile(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', re.S)


class NotABandcampRecord(Exception):
    pass


def is_bandcamp(url):
    host = urlparse(url).hostname or ""
    return host == "bandcamp.com" or host.endswith(".bandcamp.com")


def bandcamp_get(url):
    """(final URL, page), fetched with curl, not urllib.

    Bandcamp answers Python's own HTTPS client with a JavaScript challenge
    page whatever its headers say, and answers curl with the album (tested
    7 Nov 2026, same User-Agent both ways). Same honest User-Agent; an
    argument list, no shell.
    """
    wait = BANDCAMP_INTERVAL - (time.monotonic() - _last_call.get("bandcamp", 0.0))
    if wait > 0:
        time.sleep(wait)
    try:
        out = subprocess.run(
            ["curl", "-sSL", "--max-time", "30", "-A", BANDCAMP_UA,
             "-w", "\n%{url_effective}", "--", url],
            capture_output=True, text=True, check=True).stdout
    finally:
        _last_call["bandcamp"] = time.monotonic()
    page, _, final = out.rpartition("\n")
    return final, page


def _bc_text(value):
    """Bandcamp's prose as written: entities decoded, line ends made plain."""
    return html.unescape(value).replace("\r\n", "\n").strip() if value else ""


def bandcamp_reading(url, get=bandcamp_get):
    """A Bandcamp album or track page, from the schema.org JSON-LD it carries:
    the credits and about text verbatim, and nothing parsed out of them."""
    final, page = get(url)
    m = LD_JSON.search(page)
    d = json.loads(m.group(1)) if m else {}
    if d.get("@type") not in ("MusicAlbum", "MusicRecording"):
        raise NotABandcampRecord(f"{url}: no album or track data on the page "
                                 "(an artist page, or Bandcamp's challenge page)")
    return {
        "source": "Bandcamp",
        "url": final,
        "id": final,
        "group": f"bandcamp-{final}",
        "artist": _bc_text((d.get("byArtist") or {}).get("name")),
        "title": _bc_text(d.get("name")),
        "date": re.sub(r"\s+00:00:00 GMT$", "", d.get("datePublished") or ""),
        "tracks": len((d.get("track") or {}).get("itemListElement", [])),
        "people": {},
        "credits_text": _bc_text(d.get("creditText")),
        "about_text": _bc_text(d.get("description")),
    }


def album(artist, title, bandcamp=None, bandcamp_get=bandcamp_get):
    """What each source says about who is on a record, source by source.

    MusicBrainz and Discogs are searched independently, so a record one has
    and the other lacks still comes back. Where MusicBrainz links a Discogs
    release, that Discogs release is read under the MusicBrainz entry rather
    than found again. Nothing is merged across sources: the same person
    appears once per source that names them, with what that source says.
    A Bandcamp URL, if given, is read last; its credits stay text.
    """
    readings = []
    linked_discogs = set()
    for hit in find_releases(artist, title):
        release = mb_get(f"release/{hit['id']}",
                         inc="artist-credits+release-groups+recordings+artist-rels+recording-level-rels+url-rels")
        readings.append({
            "source": "MusicBrainz",
            "url": f"https://musicbrainz.org/release/{hit['id']}",
            "id": hit["id"],
            "group": (release.get("release-group") or {}).get("id", hit["id"]),
            "artist": credit_line(release.get("artist-credit", [])),
            "title": release.get("title", ""),
            "date": release.get("date", ""),
            "tracks": sum(len(m.get("tracks", [])) for m in release.get("media", [])),
            "people": mb_people(release),
        })
        did = discogs_id(release)
        if did:
            linked_discogs.add(did)
            readings.append(_discogs_reading(discogs_get(f"releases/{did}"), did, linked_to=hit["id"]))
    for hit in discogs_find_releases(artist, title):
        if hit["id"] not in linked_discogs:
            readings.append(_discogs_reading(discogs_get(f"releases/{hit['id']}"), hit["id"]))
    if bandcamp:
        readings.append(bandcamp_reading(bandcamp, get=bandcamp_get))
    return readings


def _discogs_reading(release, did, linked_to=None):
    return {
        "source": "Discogs",
        "url": f"https://www.discogs.com/release/{did}",
        "id": str(did),
        "group": f"discogs-master-{release.get('master_id') or did}",
        "linked_to": linked_to,
        "artist": ", ".join(strip_discogs_suffix(a["name"]) for a in release.get("artists", [])),
        "title": release.get("title", ""),
        "date": str(release.get("year") or ""),
        "tracks": len(release.get("tracklist", [])),
        "people": discogs_people(release),
    }


def render_album(artist, title, readings):
    lines = [f'Who is on {artist}: "{title}"', ""]
    if not readings:
        lines.append("Neither MusicBrainz nor Discogs has a release with this title and artist.")
    for r in readings:
        if r["source"] == "Bandcamp":
            lines.append(f'Bandcamp: {r["artist"]}: {r["title"]} ({r["date"] or "undated"}), {r["tracks"]} tracks')
            lines.append(f'  {r["url"]}')
            lines.append("  Credits, word for word (not parsed; a person reads who played what):")
            lines += [f"    {ln}" for ln in r["credits_text"].splitlines()] or ["    (none)"]
            if r["about_text"]:
                lines.append("  About, word for word:")
                lines += [f"    {ln}" for ln in r["about_text"].splitlines()]
            lines.append("")
            continue
        linked = f', linked from MusicBrainz release {r["linked_to"]}' if r.get("linked_to") else ""
        lines.append(f'{r["source"]}: {r["artist"]}: {r["title"]} ({r["date"] or "undated"}), '
                     f'{r["tracks"]} tracks{linked}')
        lines.append(f'  {r["url"]}')
        if not r["people"]:
            lines.append("  Nobody credited as performing. Liner notes, or someone who was there.")
        for name, p in sorted(r["people"].items()):
            scope = "track" if p["scopes"] == {"track"} else "release" if p["scopes"] == {"release"} else "track+release"
            lines.append(f'  {name}: {", ".join(sorted(p["roles"]))} [{scope}]')
        lines.append("")
    return "\n".join(lines)


def render(artist, title, versions):
    lines = [f'Who plays on {artist}: "{title}"', ""]
    if not versions:
        lines.append("MusicBrainz has no recording with this title and artist.")
    for v in versions:
        lines.append(f'{v["artist"]}: {v["release"]} ({v["date"] or "undated"}), '
                     f'{"; ".join(v["labels"]) or "no label"}, '
                     f'{"track " + str(v["track"]) if v["track"] is not None else "track not found"}')
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


def _jsonable(o):
    if isinstance(o, set):
        return sorted(o)
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_jsonable(v) for v in o]
    return o


def main(argv):
    ap = argparse.ArgumentParser(
        description=__doc__.strip().splitlines()[0],
        usage='%(prog)s [--json] "ARTIST" "SONG TITLE"\n'
              '       %(prog)s [--json] --album "ARTIST" "RECORD TITLE" [--bandcamp URL]')
    ap.add_argument("artist")
    ap.add_argument("title")
    ap.add_argument("--album", action="store_true", help="who is on a whole record, source by source")
    ap.add_argument("--bandcamp", metavar="URL", help="with --album: the record's Bandcamp page, read too")
    ap.add_argument("--json", action="store_true")
    try:
        args = ap.parse_args(argv[1:])
    except SystemExit as e:
        return e.code
    if args.bandcamp and not args.album:
        ap.print_usage()
        print("--bandcamp goes with --album")
        return 2
    if args.bandcamp and not is_bandcamp(args.bandcamp):
        print(f"not a bandcamp.com URL: {args.bandcamp}")
        return 2
    if args.album:
        try:
            readings = album(args.artist, args.title, bandcamp=args.bandcamp)
        except NotABandcampRecord as e:
            print(e, file=sys.stderr)
            return 1
        print(json.dumps(_jsonable(readings), indent=2, ensure_ascii=False) if args.json
              else render_album(args.artist, args.title, readings))
    else:
        versions = lookup(args.artist, args.title)
        print(json.dumps(versions, indent=2) if args.json else render(args.artist, args.title, versions))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
