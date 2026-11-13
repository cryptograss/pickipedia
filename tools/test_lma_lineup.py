#!/usr/bin/env python3
"""
Tests for the LMA lineup reader. Every line here is copied from a real Live
Music Archive item (named beside it), so the shapes are the archive's own.
No test touches the network.
"""
import pytest

import lma_lineup as L


def shape(lines, name, creator=""):
    i = next(k for k, l in enumerate(lines) if name in l)
    return L.classify(lines, i, name, creator)


def test_footnote_resolves_to_the_marked_songs():
    # billystrings2019-05-10.mbho.ka300
    lines = ["06. Home Of The Red Fox > %", "07. Hobo Song %", "08. Other Song", "% w/ Kyle Tuttle"]
    assert shape(lines, "Kyle Tuttle") == ("footnote", "song", ["06. Home Of The Red Fox", "07. Hobo Song"])


def test_footnote_mark_is_not_confused_with_a_longer_run():
    # gsbg2018-12-29.Neumann: * and ** are different footnotes
    lines = ["9.Reuben’s Train>*", "15.Ashes**", "*w/ Jeff Austin and Kyle Tuttle", "** First Time Played"]
    assert shape(lines, "Kyle Tuttle")[2] == ["9.Reuben’s Train"]


def test_two_marks_on_one_song():
    # SGP2025-07-05: "My Mountain so High $@" carries Kyle ($) and Molly (@)
    lines = ["Dawggy Mountain Breakdown $", "My Mountain so High $@", "Fanny Hill *", "$-with Kyle Tuttle", "@-With Molly Tuttle"]
    assert shape(lines, "Kyle Tuttle")[2] == ["Dawggy Mountain Breakdown", "My Mountain so High"]
    assert shape(lines, "Molly Tuttle")[2] == ["My Mountain so High"]


@pytest.mark.parametrize("line,expected", [
    ("Kyle Tuttle - Banjo", ("name-instrument", "show")),                       # JeffAustinBand2018-10-12
    ("Love Please Come Home (w/ Kyle Tuttle on Banjo)", ("song-inline", "song")),  # AIRSHOW2025-10-11
    ("08. Wild Bill Jones - With Kyle Tuttle", ("song-inline", "song")),        # pns2024-06-29.Audience
    ("Kyle Tuttle Band opened", ("same bill", "bill")),                        # TG2020-05-30.flac.24
    ("04. Anders Banter - Kyle Tuttle Intro", ("banter track", "stage")),      # gsbg2025-09-20
    ("Taper: Dan Knobler", ("crew (taper, transfer)", "none")),                # CapCo2007-06-27
    ("Thank you to Sam Grisman for allowing recording and Peter for the Soundboard Feed.", ("thanks / permission", "none")),
    ("These Days- by Jackson Browne", None),                                   # a songwriter credit we don't catch yet
])
def test_single_line_shapes(line, expected):
    got = L.classify([line], 0, "Kyle Tuttle")
    assert (got[:2] if got else None) == expected


def test_festival_roster_is_a_trap():
    # the same block sat on 7 bands' sets at one festival, 20 Sep 2025
    lines = ["Artists at Large :", "Holly Bowling", "Kyle Tuttle", "Patrick Rainey"]
    assert shape(lines, "Kyle Tuttle")[:2] == ("festival roster", "festival")


def test_listed_under_a_header():
    # SGP2024-10-16
    lines = ["Lineup :", "Sam Grisman", "Chris J. English", "Victor Furtado"]
    assert shape(lines, "Victor Furtado")[:2] == ("listed under header", "show")


def test_band_name_heading_is_the_band():
    assert L.classify(["Sam Grisman Project"], 0, "Sam Grisman", "Sam Grisman Project")[:2] == ("band name", "show")


def test_song_parenthetical_is_flagged_as_ambiguous():
    # "Song (Name)" is a guest in one taper's notes and a songwriter in another's
    assert L.classify(["Plane (Jason Mraz)"], 0, "Jason Mraz")[1] == "song?"


def test_read_item_covers_description_files_and_fields():
    item = {"metadata": {"creator": "Billy Strings", "description": "07. Hobo Song %<br>% w/ Kyle Tuttle"},
            "files": [{"name": "t07.flac", "title": "Hobo Song", "comment": "w/ Kyle Tuttle"}]}
    got = L.read_item(item, ["Kyle Tuttle"])["Kyle Tuttle"]
    assert ("description", "footnote", "song", ["07. Hobo Song"]) in got
    assert ("files", "file comment", "song", "Hobo Song") in got


def test_song_key_meets_across_footnote_inline_and_file_title():
    # SGP2025-07-05 writes the song three ways for the same guest
    assert L.song_key("07. Hobo Song %") == L.song_key("d1t07 Hobo Song (w/ Kyle Tuttle)") == L.song_key("Hobo Song") == "hobosong"
    assert L.song_key("My Mountain so High $@") == "mymountainsohigh"


def test_pairs_song_show_and_apart():
    found = {
        # SGP2025-07-05: "My Mountain so High $@", "$ with Kyle Tuttle", "@ With Molly Tuttle"
        "Kyle Tuttle": [("description", "footnote", "song", ["My Mountain so High"])],
        "Molly Tuttle": [("description", "footnote", "song", ["My Mountain so High"])],
        # in the lineup for the whole show
        "Sam Grisman": [("description", "listed under header", "show", "Lineup:")],
        # a taper is not a player
        "Jamie Burks": [("description", "crew (taper, transfer)", "none", "Taped by Jamie Burks")],
    }
    got = {(p["a"], p["b"]): p for p in L.pairs(found)}
    assert got[("Kyle Tuttle", "Molly Tuttle")] == {"a": "Kyle Tuttle", "b": "Molly Tuttle", "kind": "song", "songs": ["mymountainsohigh"]}
    assert got[("Kyle Tuttle", "Sam Grisman")]["kind"] == "show"
    assert got[("Jamie Burks", "Kyle Tuttle")]["kind"] == "apart"


def test_pairs_different_songs_is_show_not_song():
    found = {"A Person": [("description", "song-inline", "song", "05. Julius (w/ A Person)")],
             "B Person": [("description", "song-inline", "song", "09. Reuben's Train (w/ B Person)")]}
    assert L.pairs(found)[0]["kind"] == "show"


# Names must be whole names, not strings inside longer ones. Each line is
# copied from a real item (identifier in the comment).
def test_mentions_not_inside_a_longer_name():
    # kglw2018-08-22.amt: Ambrose Kenny-Smith of King Gizzard, not Kenny Smith
    assert not L.mentions("Kenny Smith", "Ambrose Kenny Smith - harmonica, keyboards, synthesizer, organ, vocals")
    # travelinmccourys2011-05-28
    assert not L.mentions("Chris Davis", "+ Donnie Davisson, Chris Davisson")
    assert not L.mentions("Kenny Smith", "Kenny Smith-Jones")


def test_mentions_glued_by_stripped_markup():
    # travelinmccourys2025-09-30: <br> lost, names run into the line before
    line = "Rob McCoury - Banjo And VocalsChristian Ward - Fiddle And Vocals"
    assert L.mentions("Christian Ward", line)
    assert L.mentions("Mike Merenda", "Mike Merenda-Vocals,Guitars,Harmonica")
    # SB_ws2014-09-27: a file title with the track number run on
    assert L.mentions("Sam Bush", "STE-010Sam Bush ws01")
    assert L.mentions("Chris Elliott", "Bill Browning-Mandolin, Chris Elliott-Banjo, Paul Murin-Guitar")


def test_mentions_after_lead_in_words_and_known_names():
    assert L.mentions("Sam Bush", "Enter Sam Bush")
    assert L.mentions("Sam Grisman", "(with The Sam Grisman Project)")
    assert L.mentions("Jerry Douglas", "JD\tJerry Douglas - dobro & vocals")  # SGP2025-01-09.sgp
    assert L.mentions("Jackson Browne", "THESE DAYS Jackson Browne")
    assert L.mentions("Bronwyn Keith-Hynes", "Kyle Tuttle Bronwyn Keith-Hynes and North Fork Crossing",
                      ["Kyle Tuttle", "Bronwyn Keith-Hynes"])
    assert L.mentions("Kenny Smith", "Sat in: Kenny Smith.")
    assert L.mentions("Kenny Smith", "Kenny Smith’s band")


def test_read_item_skips_a_longer_name():
    item = {"metadata": {"creator": "King Gizzard & The Lizard Wizard",
                         "description": "Lineup:\nStu Mackenzie - guitar\nAmbrose Kenny Smith - harmonica, keyboards"}}
    assert "Kenny Smith" not in L.read_item(item, ["Kenny Smith"])


# narrowed(): read_item asks mentions() only about the names that are somewhere in the item (13 Nov 2026).
# The store's build went from minutes to seconds by it, and must read exactly what it read before.

def every_name_on_every_string(j, names):
    """read_item as it was before narrowed(): mentions() asked about every name, on every string."""
    m = j.get("metadata", {})
    out = {}
    creator = m.get("creator"); creator = creator[0] if isinstance(creator, list) else (creator or "")
    fields = [("description", L.lines_of(m.get("description"))), ("notes", L.lines_of(m.get("notes")))]
    for where, lines in fields:
        for i, l in enumerate(lines):
            for n in names:
                if L.mentions(n, l, names):
                    out.setdefault(n, []).append((where, *(L.classify(lines, i, n, creator) or (None, None, l))))
    for f in j.get("files", []):
        for key in ("comment", "artist", "creator", "title"):
            v = str(f.get(key, ""))
            for n in names:
                if L.mentions(n, v, names):
                    shape = ("file comment", "song", f.get("title") or f["name"]) if key == "comment" else \
                            ("file " + key, "song" if " ft. " in v or " feat" in v.lower() else "show", v)
                    out.setdefault(n, []).append(("files", *shape))
    for key in ("creator", "title", "subject"):
        v = m.get(key)
        v = " / ".join(v) if isinstance(v, list) else str(v or "")
        for n in names:
            if L.mentions(n, v, names):
                out.setdefault(n, []).append((key, "item " + key, "show", v))
    return out


NAMES = ["Kyle Tuttle", "Sam Bush", "Kenny Smith", "Honza Špringl", "Christian Ward", "Kim Lee", "Jason Carter",
         "Bronwyn Keith-Hynes", "Molly Tuttle", "Jerry Douglas"]

ITEMS = [
    # plain ASCII, in three cases, with a footnote and a file title
    {"metadata": {"identifier": "a", "creator": "Billy Strings", "title": "Billy Strings Live with KYLE TUTTLE",
                  "description": "06. Home Of The Red Fox > %<br>07. Hobo Song %<br>% w/ kyle tuttle<br>Lineup: Sam Bush, Jerry Douglas, Molly Tuttle",
                  "subject": ["bluegrass", "Sam Bush"]},
     "files": [{"name": "t01.flac", "title": "Hobo Song ft. Sam Bush"}, {"name": "t02.flac", "artist": "Billy Strings"},
               {"name": "t03.flac", "comment": "with Jerry Douglas", "title": "Freeborn Man"}]},
    # lines that are not ASCII: a curly quote, a long dash, a name in capitals with its háček
    {"metadata": {"identifier": "b", "creator": ["Kyle Tuttle Band"], "title": "Kyle Tuttle Band — Station Inn",
                  "notes": "9.Reuben’s Train>*\n*w/ Jeff Austin and Kyle Tuttle\nSpecial guest: HONZA ŠPRINGL on banjo\nwith Honza Špringl"},
     "files": [{"name": "x.flac", "title": "Reuben’s Train (w/ Molly Tuttle)"}]},
    # letters a regex's re.I takes for i, s and k, and lower() does not
    {"metadata": {"identifier": "c", "creator": "Somebody",
                  "description": "with Jaſon Carter on fiddle\nwith Kİm Lee\nwith Kim Lee and Kım Lee\nwith ſam Buſh"},
     "files": []},
    # glued by stripped markup; a longer name that is not the shorter one; nobody known at all
    {"metadata": {"identifier": "d", "creator": "King Gizzard",
                  "description": "<b>Vocals</b>Christian Ward - Fiddle<br>Ambrose Kenny Smith - harmonica<br>Kyle Tuttle Bronwyn Keith-Hynes"},
     "files": [{"name": "y.flac", "title": "The River", "creator": "Ambrose Kenny Smith"}]},
    {"metadata": {"identifier": "e", "creator": "Nobody Here", "description": "A fine night.\nTaped by a friend."}, "files": [{"name": "z.flac"}]},
    {"metadata": {}},
]


def test_read_item_reads_what_asking_every_name_on_every_string_reads():
    found = 0
    for j in ITEMS:
        was, now = every_name_on_every_string(j, NAMES), L.read_item(j, NAMES)
        assert now == was
        assert list(now) == list(was)                      # and the names in the same order
        found += len(was)
    assert found >= 12                                     # the items do name people: the test isn't empty


def test_narrowed_never_drops_a_name_the_regex_finds():
    import re
    texts = [l for j in ITEMS for l in L.lines_of(j["metadata"].get("description")) + L.lines_of(j["metadata"].get("notes"))]
    texts += ["KENNY SMITH", "kenny smith", "Kenny  Smith", "", "sam bush\nJerry Douglas"]
    worth = L.narrowed(NAMES, texts)
    hits = 0
    for t in texts:
        for n in NAMES:
            if re.search(re.escape(n), t, re.I):
                assert n in worth(t), (n, t)
                hits += 1
    assert hits >= 15
    # the letters only a regex folds: these are found, so they are asked about
    assert "Jason Carter" in worth("with Jaſon Carter on fiddle")
    assert "Kim Lee" in worth("with Kİm Lee") and "Kim Lee" in worth("with Kim Lee and Kım Lee")
    assert "Honza Špringl" in worth("Special guest: HONZA ŠPRINGL on banjo")


def test_narrowed_asks_only_about_names_in_the_item():
    texts = ["01. Tune", "02. Song", "% w/ Kyle Tuttle", "Taped by a friend"]
    worth = L.narrowed(NAMES, texts)
    assert worth("% w/ Kyle Tuttle") == ["Kyle Tuttle"] and worth("01. Tune") == ["Kyle Tuttle"]
    asked = []
    real = L.mentions
    L.mentions = lambda n, t, known=(): asked.append(n) or real(n, t, known)
    try:
        L.read_item({"metadata": {"description": "<br>".join(texts)}, "files": [{"name": "a.flac", "title": "Tune"}] * 50}, NAMES)
    finally:
        L.mentions = real
    assert set(asked) == {"Kyle Tuttle"}                   # not 10 names on 200-odd strings
    assert len(asked) < 300
