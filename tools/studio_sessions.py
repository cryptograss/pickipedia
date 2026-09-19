"""
Turn session data into wikitext for a composition's page.

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

from dataclasses import dataclass, field
from typing import List, Optional

BEGIN = "<!-- studio recordings: from session data; this block is rewritten by HearThatWhistleBlow -->"
END = "<!-- end studio recordings -->"

HEADING = "== Studio recordings =="

# Compositions live in their own namespace, because a record and the song it
# takes its name from collide otherwise — "Vowel Sounds" is both.
NAMESPACE = "Song:"


@dataclass
class Player:
    """One musician on one cut, and what they played on it."""

    name: str
    instruments: List[str] = field(default_factory=list)

    @classmethod
    def from_json(cls, raw):
        return cls(name=raw["name"], instruments=list(raw.get("instruments") or []))

    def as_parameter(self):
        """The wikitext parameter naming this player: "|Harry Clark=mandolin"."""
        return f"|{self.name}={', '.join(self.instruments)}"


@dataclass
class Cut:
    """
    One recording of a composition: one lineup, one session.

    `record` is optional because plenty is cut in a studio that never lands on
    an album — and when it is absent the cut is still a cut, with everything
    else about it intact.
    """

    record: Optional[str] = None
    number: Optional[int] = None
    recorded: Optional[str] = None
    studio: Optional[str] = None
    engineer: Optional[str] = None
    players: List[Player] = field(default_factory=list)

    @classmethod
    def from_track(cls, record_name, track):
        return cls(
            record=record_name,
            number=track.get("number"),
            recorded=track.get("recorded"),
            studio=track.get("studio"),
            engineer=track.get("engineer"),
            players=[Player.from_json(p) for p in track.get("personnel", [])],
        )

    def as_wikitext(self):
        """
        One {{Studio cut}} call.

        Players are named parameters — the musician's name is the parameter and
        their instruments the value — because a session has no fixed number of
        players, and naming them positionally would make the wikitext
        unreadable for anybody who opens it.
        """
        lines = ["{{Studio cut"]
        # The studio goes first because it is half of what identifies the cut.
        for name, value in (("studio", self.studio), ("record", self.record),
                            ("number", self.number), ("recorded", self.recorded),
                            ("engineer", self.engineer)):
            if value:
                lines.append(f"|{name}={value}")
        lines.extend(player.as_parameter() for player in self.players)
        lines.append("}}")
        return "\n".join(lines)


@dataclass
class Composition:
    """A composition and every cut of it the session data knows about."""

    title: str
    cuts: List[Cut] = field(default_factory=list)

    @property
    def page(self):
        return NAMESPACE + self.title

    def block(self):
        """The whole managed region for this composition, markers included."""
        lines = [BEGIN, HEADING, ""]
        lines.extend(cut.as_wikitext() for cut in self.cuts)
        lines.append(END)
        return "\n".join(lines)


def compositions(records):
    """
    Invert the exporter's records-with-tracks into compositions-with-cuts.

    @param records: the exporter's "records" list.
    @return: [Composition], in title order.
    """
    found = {}
    for record in records:
        for track in record.get("tracks", []):
            composition = found.setdefault(
                track["title"], Composition(title=track["title"]))
            composition.cuts.append(Cut.from_track(record["name"], track))

    for composition in found.values():
        composition.cuts.sort(key=lambda cut: cut.record or "")
    return [found[title] for title in sorted(found)]


def splice(current, block):
    """
    Put the block on the page, replacing any earlier one.

    @param current: the page as it stands, or None for a page that does not
        exist yet.
    @param block: what Composition.block() produced.
    @return: the page to save.
    """
    if current is None:
        return block

    start = current.find(BEGIN)
    if start == -1:
        body, categories = split_trailing_categories(current)
        joined = body.rstrip() + "\n\n" + block
        return (joined + "\n\n" + categories).rstrip() if categories else joined

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
