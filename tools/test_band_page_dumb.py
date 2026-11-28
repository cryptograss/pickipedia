"""Tests for band_page_dumb.py: a band's page written from MusicBrainz, and nothing inferred.

What these guard: a name two groups share writes nothing; a line says only what MusicBrainz says (a member who
left with no year gets no line, since a line with no end reads "still in it"); every line carries its source and
the day it was read; the tool writes files, never the wiki. MusicBrainz is canned, so no test touches the network.
"""
import band_page_dumb as bp

ID = "0a1b2c3d-0000-4000-8000-000000000001"
SRC = f"https://musicbrainz.org/artist/{ID}/relationships"


def member(name, attributes=(), begin=None, end=None, ended=False, direction="backward", kind="member of band"):
    return {"type": kind, "direction": direction, "artist": {"name": name}, "attributes": list(attributes),
            "begin": begin, "end": end, "ended": ended}


def group(relations, name="Della Mae", kind="Group", begin="2009", mbid=ID):
    return {"id": mbid, "name": name, "type": kind, "life-span": {"begin": begin}, "relations": relations}


RELATIONS = [
    member("Kimber Ludiker", ["violin", "original"], begin="2009"),
    member("Celia Woodsmith", ["lead vocals", "acoustic guitar"], begin="2011"),
    member("Jenni Lyn Gardner", ["mandolin"], begin="2009", end="2019", ended=True),
    member("Gone Sometime", ["double bass"], ended=True),                       # left, and no year
    member("No Chair Given"),
    member("Another Band", ["guitar"], direction="forward"),                    # the band is in that one: not a member of this
    member("A Producer", kind="producer"),
    {"type": "official homepage", "url": {"resource": "https://dellamae.com/"}, "ended": False},
    {"type": "official homepage", "url": {"resource": "https://old.example/"}, "ended": True},
]


def test_a_page_says_what_musicbrainz_says_and_where_it_was_read():
    text, n = bp.page("Della Mae", group(RELATIONS), "2026-11-27")
    lines = text.split("\n")
    assert lines[:3] == ["{{BandInfo", "|website=https://dellamae.com/", "}}"]            # the homepage still in use
    stints = [l for l in lines if l.startswith("{{Band member|")]
    assert n == len(stints) == 5
    assert stints == [
        "{{Band member|No Chair Given|source=" + SRC + "|checked=2026-11-27}}",           # no date: first, as nobody says since when
        "{{Band member|Jenni Lyn Gardner|mandolin|from=2009|until=2019|source=" + SRC + "|checked=2026-11-27}}",
        "{{Band member|Kimber Ludiker|fiddle|from=2009|source=" + SRC + "|checked=2026-11-27}}",      # a violin is a fiddle here
        "{{Band member|Celia Woodsmith|vocals|from=2011|source=" + SRC + "|checked=2026-11-27}}",     # two chairs: two lines
        "{{Band member|Celia Woodsmith|guitar|from=2011|source=" + SRC + "|checked=2026-11-27}}"]
    assert "original" not in text                               # a word about the member is no chair
    assert "Another Band" not in text and "A Producer" not in text
    # who left with no year gets no line, and the page says why
    assert "{{Band member|Gone Sometime" not in text
    assert "It also lists Gone Sometime as having left, with no year, so no line is written." in text
    assert "MusicBrainz gives 2009 as the year the band began." in text
    assert "kind=" not in text and "leader=" not in text and "offshoot_of=" not in text     # nothing inferred


def test_an_instrument_musicbrainz_alone_names_is_written_as_it_has_it():
    text, n = bp.page("A Band", group([member("Ann One", ["hammered dulcimer"]), member("Ann One", ["hammered dulcimer", "guest"])],
                                      begin=None), "2026-11-27")
    assert n == 2 and text.count("{{Band member|Ann One|hammered dulcimer|") == 2
    assert "website" not in text and "began" not in text


def test_a_band_with_no_members_listed_says_so():
    text, n = bp.page("A Band", group([], begin=None), "2026-11-27")
    assert n == 0 and "== Members ==" not in text
    assert text == "{{BandInfo\n}}\n\n[" + SRC + " MusicBrainz] lists no members for this band, read 2026-11-27."


def canned(monkeypatch, artists):
    monkeypatch.setattr(bp.rambler, "mb_artists_named", lambda name: [(a["id"], a["name"]) for a in artists])
    monkeypatch.setattr(bp.sideman, "mb_get", lambda path, **params: next(a for a in artists if path == "artist/" + a["id"]))


def test_one_group_of_the_name_is_the_band_and_two_are_nobody(monkeypatch):
    person = group([], name="Della Mae", kind="Person", mbid="p-1")
    canned(monkeypatch, [group(RELATIONS), person])
    a, why = bp.facts("Della Mae")
    assert a["id"] == ID and why == ""                          # a person of the same name is not the band
    canned(monkeypatch, [group(RELATIONS), group([], mbid="g-2")])
    assert bp.facts("Della Mae") == (None, "Della Mae: MusicBrainz has 2 groups of that name (2 artists)")
    canned(monkeypatch, [person])
    assert bp.facts("Della Mae") == (None, "Della Mae: MusicBrainz has 0 groups of that name (1 artists)")


def test_it_writes_files_and_says_what_it_skipped(monkeypatch, tmp_path, capsys):
    canned(monkeypatch, [group(RELATIONS)])
    monkeypatch.setattr(bp.rambler, "mb_artists_named",
                        lambda name: [(ID, "Della Mae")] if name in ("Della Mae", "AC/DC") else [])
    out = tmp_path / "pages"
    assert bp.main(["band_page_dumb.py", "--out", str(out), "Della Mae", "Nobody", "AC/DC"], today="2026-11-27") == 0
    said = capsys.readouterr().out
    assert f"Della Mae: MusicBrainz Della Mae (Group), {ID}; 5 stints -> " in said
    assert "Nobody: MusicBrainz has 0 groups of that name (0 artists)" in said
    assert sorted(p.name for p in out.iterdir()) == ["AC_DC.wiki", "Della Mae.wiki"]         # a slash is no path
    text = (out / "Della Mae.wiki").read_text()
    assert text.endswith("\n") and text.rstrip("\n") == bp.page("Della Mae", group(RELATIONS), "2026-11-27")[0]
    assert bp.main(["band_page_dumb.py"]) == 2                  # no band named: the usage, and nothing written
