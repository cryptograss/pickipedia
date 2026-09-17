"""
Turn arthel's studio ensembles into wikitext for a record page.

Who played what on which track is recorded in arthel, in
`src/data/songs_and_tunes/*.yaml`, because that is what the Rabbithole player
reads to follow a picker from one track to the next. The same data answers a
question the wiki could not: which records is this musician on?

It arrives here as JSON from arthel's exporter, and leaves as a block of
{{Studio track}} calls for the record's page. Each call records the personnel
of one track as semantic data, so a musician's page can ask for every track
that names them without anybody maintaining a list.

The block is delimited by comment markers. The importer replaces what is
between them and touches nothing else on the page, which is the whole
arrangement: inside the markers is transcribed from arthel and will be
overwritten; everything else on the page belongs to whoever is editing it.
"""

BEGIN = "<!-- studio sessions: from arthel; this block is rewritten by HearThatWhistleBlow -->"
END = "<!-- end studio sessions -->"

HEADING = "== Sessions =="


def track_call(track):
    """
    One {{Studio track}} call.

    Personnel are named parameters — the musician's name is the parameter and
    their instruments the value — because a track has no fixed number of
    players and naming them positionally would make the wikitext unreadable
    for anybody who opens it.

    @param track: one track from the exporter.
    @return: wikitext.
    """
    parts = ["{{Studio track", f"|track={track['title']}"]
    if track.get("number"):
        parts.append(f"|number={track['number']}")
    for field in ("studio", "recorded", "engineer"):
        if track.get(field):
            parts.append(f"|{field}={track[field]}")
    for player in track.get("personnel", []):
        instruments = ", ".join(player.get("instruments") or [])
        parts.append(f"|{player['name']}={instruments}")
    parts.append("}}")
    return "\n".join(parts)


def session_block(record):
    """
    The whole managed region for one record, markers included.

    @param record: one record from the exporter.
    @return: wikitext.
    """
    lines = [BEGIN, HEADING, ""]
    for track in record.get("tracks", []):
        lines.append(track_call(track))
    lines.append(END)
    return "\n".join(lines)


def splice(current, block):
    """
    Put the block on the page, replacing any earlier one.

    @param current: the page as it stands, or None for a page that does not
        exist yet.
    @param block: what session_block() produced.
    @return: the page to save.
    """
    if current is None:
        return block

    start = current.find(BEGIN)
    if start == -1:
        # No block yet. It goes at the end, before the categories, which are
        # conventionally last and look wrong anywhere else.
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
