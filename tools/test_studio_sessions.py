#!/usr/bin/env python3
"""Tests for writing studio recordings onto composition pages."""

import importlib.util
from pathlib import Path

import pytest

from studio_sessions import (BEGIN, END, by_song, page_title, song_block,
                             splice, version_call)

TOOLS = Path(__file__).parent


def load_script(name):
    """Import a hyphenated script, which a plain import statement cannot."""
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), TOOLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


to_wiki = load_script("studio-sessions-to-wiki")

VERSION = {
    "record": "4masks",
    "number": 1,
    "recorded": "3 April, 2024",
    "studio": "Tunesmith Studios, Nashville TN",
    "engineer": "Jake Stargel",
    "personnel": [
        {"name": "Justin Holmes", "instruments": ["guitar", "vocals"]},
        {"name": "Harry Clark", "instruments": ["mandolin"]},
    ],
}

EXPORT = {"records": [
    {"name": "4masks", "tracks": [
        {"title": "Silver 44", "number": 1, "personnel": VERSION["personnel"]},
        {"title": "Barlows", "personnel": [
            {"name": "David Grier", "instruments": ["guitar"]}]},
    ]},
    {"name": "Vowel Sounds", "tracks": [
        {"title": "Barlows", "personnel": [
            {"name": "Cory Walker", "instruments": ["5-string banjo"]}]},
    ]},
]}


class TestBySong:
    def test_one_entry_per_composition(self):
        songs = by_song(EXPORT["records"])
        assert sorted(songs) == ["Barlows", "Silver 44"]

    def test_a_tune_cut_twice_keeps_both(self):
        # The point of the composition being the page: one Barlows, two
        # recordings of it, rather than two pages sharing a name.
        assert [v["record"] for v in by_song(EXPORT["records"])["Barlows"]] == [
            "4masks", "Vowel Sounds"]

    def test_each_recording_names_its_record(self):
        silver = by_song(EXPORT["records"])["Silver 44"][0]
        assert silver["record"] == "4masks"
        assert silver["number"] == 1

    def test_compositions_live_in_their_own_namespace(self):
        assert page_title("Barlows") == "Song:Barlows"


class TestVersionCall:
    def test_names_the_record(self):
        assert "|record=4masks" in version_call(VERSION)

    def test_a_player_is_a_named_parameter(self):
        assert "|Harry Clark=mandolin" in version_call(VERSION)

    def test_several_instruments_are_listed(self):
        assert "|Justin Holmes=guitar, vocals" in version_call(VERSION)

    def test_session_details_travel_too(self):
        assert "|engineer=Jake Stargel" in version_call(VERSION)

    def test_absent_fields_are_left_out(self):
        call = version_call({"record": "4masks", "personnel": []})
        assert "|number=" not in call
        assert call.endswith("}}")


class TestSplice:
    def test_a_page_that_does_not_exist_yet(self):
        assert splice(None, song_block([VERSION])).startswith(BEGIN)

    def test_the_block_lands_before_the_categories(self):
        page = "{{Song|composer=Justin Myles Holmes}}\n\nProse.\n\n[[Category:Compositions]]"
        out = splice(page, song_block([VERSION]))
        assert out.index(BEGIN) < out.index("[[Category:Compositions]]")
        assert out.endswith("[[Category:Compositions]]")

    def test_prose_is_untouched(self):
        page = "{{Song}}\n\nA tune Barlow probably never played.\n"
        assert "Barlow probably never played" in splice(page, song_block([VERSION]))

    def test_a_second_run_replaces_the_block_rather_than_repeating_it(self):
        page = splice("{{Song}}\n\nProse.", song_block([VERSION]))
        again = splice(page, song_block([VERSION]))
        assert again.count(BEGIN) == 1
        assert again.count("Prose.") == 1

    def test_a_half_deleted_block_is_refused(self):
        page = splice("{{Song}}", song_block([VERSION])).replace(END, "")
        with pytest.raises(ValueError) as caught:
            splice(page, song_block([VERSION]))
        assert "closing" in str(caught.value)

    def test_the_block_is_idempotent(self):
        once = splice("{{Song}}\n\n[[Category:Compositions]]", song_block([VERSION]))
        assert splice(once, song_block([VERSION])) == once


class FakeWiki:
    """Enough wiki to plan against: some pages, and some redirects."""

    def __init__(self, pages=None, redirects=None):
        self.pages = pages or {}
        self.redirects = redirects or {}
        self.resolved = []

    def resolve(self, title):
        self.resolved.append(title)
        return self.redirects.get(title, title)

    def get_text(self, title):
        return self.pages.get(title)


class TestPlan:
    def test_missing_pages_are_created(self):
        wiki = FakeWiki()
        plan, skipped = to_wiki.plan_for(wiki, by_song(EXPORT["records"]))
        assert skipped == []
        assert sorted((row[0], row[2]) for row in plan) == [
            ("Song:Barlows", "created"), ("Song:Silver 44", "created")]

    def test_a_renamed_composition_keeps_its_data(self):
        # Somebody checks the sleeve and moves Song:Barlows Jig to Song:Barlows.
        # The importer must write through the redirect, not over it.
        wiki = FakeWiki(
            pages={"Song:Barlows": "{{Song}}\n\nA jig.\n"},
            redirects={"Song:Barlows Jig": "Song:Barlows"})
        export = {"records": [{"name": "4masks", "tracks": [
            {"title": "Barlows Jig", "personnel": VERSION["personnel"]}]}]}
        plan, _ = to_wiki.plan_for(wiki, by_song(export["records"]))
        title, text, outcome, asked = plan[0]
        assert (title, asked, outcome) == ("Song:Barlows", "Song:Barlows Jig", "updated")
        assert "A jig." in text

    def test_an_unchanged_page_is_left_alone(self):
        songs = by_song(EXPORT["records"])
        wiki = FakeWiki(pages={"Song:Silver 44": song_block(songs["Silver 44"])})
        plan, _ = to_wiki.plan_for(wiki, {"Silver 44": songs["Silver 44"]})
        assert plan[0][2] == "unchanged"

    def test_a_page_with_a_broken_block_is_skipped_not_mangled(self):
        songs = by_song(EXPORT["records"])
        broken = song_block(songs["Silver 44"]).replace(END, "") + "\n\nProse below."
        wiki = FakeWiki(pages={"Song:Silver 44": broken})
        plan, skipped = to_wiki.plan_for(wiki, {"Silver 44": songs["Silver 44"]})
        assert plan == []
        assert "closing" in skipped[0][1]
