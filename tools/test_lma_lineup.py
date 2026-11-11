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
