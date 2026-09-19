"""
Turn arthel's studio ensembles into wikitext for a composition's page.

The composition is the page — see PickiPedia:Compositions. One cut of it is a
{{Studio cut}} call naming the session, everyone who played, and the record it
appears on if there is one. The record's own page builds its track listing by
asking which compositions name it. Neither page keeps a copy of the other's
data, so a lineup is corrected in one place.

The data arrives as JSON from arthel's exporter, grouped by record, because
that is the shape the site wants. Here it is turned inside out.

A cut wants a block height and a studio to identify it; the session data has
neither reliably, so imported cuts fall back to being identified by the record
they were made for. That is enough until the same performance turns up on a
second record, and filling in a block height by hand is what fixes it — see
Template:Studio cut.

The block is delimited by comment markers. The importer replaces what is
between them and touches nothing else on the page: inside the markers is
transcribed and will be overwritten, everything else belongs to whoever is
editing the page.
"""

BEGIN = "<!-- studio recordings: from session data; this block is rewritten by HearThatWhistleBlow -->"
END = "<!-- end studio recordings -->"

HEADING = "== Studio recordings =="

# Compositions live in their own namespace, because a record and the song it
# takes its name from collide otherwise — "Vowel Sounds" is both.
NAMESPACE = "Song:"


def page_title(song_title):
    """@return: the wiki page for a composition."""
    return NAMESPACE + song_title


def by_song(records):
    """
    Invert the exporter's records-with-tracks into compositions-with-recordings.

    @param records: the exporter's "records" list.
    @return: {song title: [recording, ...]}, each recording naming its record.
    """
    songs = {}
    for record in records:
        for track in record.get("tracks", []):
            songs.setdefault(track["title"], []).append({
                "record": record["name"],
                "number": track.get("number"),
                "recorded": track.get("recorded"),
                "studio": track.get("studio"),
                "engineer": track.get("engineer"),
                "personnel": track.get("personnel", []),
            })
    for versions in songs.values():
        versions.sort(key=lambda v: v["record"])
    return songs


def version_call(version):
    """
    One {{Studio cut}} call.

    Personnel are named parameters — the musician's name is the parameter and
    their instruments the value — because a session has no fixed number of
    players and naming them positionally would make the wikitext unreadable
    for anybody who opens it.
    """
    parts = ["{{Studio cut"]
    if version.get("studio"):
        parts.append(f"|studio={version['studio']}")
    parts.append(f"|record={version['record']}")
    if version.get("number"):
        parts.append(f"|number={version['number']}")
    for field in ("recorded", "engineer"):
        if version.get(field):
            parts.append(f"|{field}={version[field]}")
    for player in version.get("personnel", []):
        instruments = ", ".join(player.get("instruments") or [])
        parts.append(f"|{player['name']}={instruments}")
    parts.append("}}")
    return "\n".join(parts)


def song_block(versions):
    """
    The whole managed region for one composition, markers included.

    @param versions: that composition's recordings.
    @return: wikitext.
    """
    lines = [BEGIN, HEADING, ""]
    for version in versions:
        lines.append(version_call(version))
    lines.append(END)
    return "\n".join(lines)


def splice(current, block):
    """
    Put the block on the page, replacing any earlier one.

    @param current: the page as it stands, or None for a page that does not
        exist yet.
    @param block: what song_block() produced.
    @return: the page to save.
    """
    if current is None:
        return block

    start = current.find(BEGIN)
    if start == -1:
        body, tail = split_trailing_categories(current)
        joined = body.rstrip() + "\n\n" + block
        return (joined + "\n\n" + tail).rstrip() if tail else joined

    end = current.find(END, start)
    if end == -1:
        # An opening marker with no closing one means somebody edited the
        # block by hand and cut it short. Replacing to the end of the page
        # would eat whatever follows, so refuse and let a person look.
        raise ValueError(
            "found the opening marker but not the closing one; "
            "fix the page by hand before importing again")

    return current[:start] + block + current[end + len(END):]


def split_trailing_categories(text):
    """
    Separate a page's trailing category links from its body.

    @return: (body, categories) — categories is "" when there are none.
    """
    lines = text.rstrip().split("\n")
    categories = []
    while lines and (lines[-1].strip().startswith("[[Category:")
                     or lines[-1].strip() == ""):
        line = lines.pop()
        if line.strip():
            categories.insert(0, line)
    return "\n".join(lines), "\n".join(categories)
