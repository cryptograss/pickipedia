#!/usr/bin/env python3
"""Tests for writing studio cuts onto composition pages."""

import importlib.util
import io
import json
from pathlib import Path

import pytest

from studio_sessions import BEGIN, END, Composition, Cut, Player, compositions, splice

TOOLS = Path(__file__).parent


def load_script(name):
    """Import a hyphenated script, which a plain import statement cannot."""
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), TOOLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


to_wiki = load_script("studio-sessions-to-wiki")

PLAYERS = [
    {"name": "Justin Holmes", "instruments": ["guitar", "vocals"]},
    {"name": "Harry Clark", "instruments": ["mandolin"]},
]

EXPORT = {"records": [
    {"name": "4masks", "tracks": [
        {"title": "Silver 44", "number": 1, "personnel": PLAYERS,
         "studio": "Tunesmith Studios, Nashville TN",
         "recorded": "3 April, 2024", "engineer": "Jake Stargel"},
        {"title": "Barlows", "personnel": [
            {"name": "David Grier", "instruments": ["guitar"]}]},
    ]},
    {"name": "Vowel Sounds", "tracks": [
        {"title": "Barlows", "personnel": [
            {"name": "Cory Walker", "instruments": ["5-string banjo"]}]},
    ]},
]}


def silver():
    return [c for c in compositions(EXPORT["records"]) if c.title == "Silver 44"][0]


class TestCompositions:
    def test_one_entry_per_composition(self):
        assert [c.title for c in compositions(EXPORT["records"])] == [
            "Barlows", "Silver 44"]

    def test_a_tune_cut_twice_keeps_both_cuts(self):
        # The point of the composition being the page: one Barlows, two cuts of
        # it, rather than two pages that happen to share a name.
        barlows = compositions(EXPORT["records"])[0]
        assert [cut.record for cut in barlows.cuts] == ["4masks", "Vowel Sounds"]

    def test_each_cut_knows_its_session(self):
        cut = silver().cuts[0]
        assert (cut.record, cut.number, cut.engineer) == ("4masks", 1, "Jake Stargel")

    def test_compositions_live_in_their_own_namespace(self):
        assert silver().page == "Song:Silver 44"


class TestCutWikitext:
    def test_it_is_a_cut(self):
        assert silver().cuts[0].as_wikitext().startswith("{{Studio cut")

    def test_names_the_record(self):
        assert "|record=4masks" in silver().cuts[0].as_wikitext()

    def test_the_studio_is_given_since_it_helps_identify_the_cut(self):
        assert "|studio=Tunesmith Studios, Nashville TN" in silver().cuts[0].as_wikitext()

    def test_a_player_is_a_named_parameter(self):
        assert "|Harry Clark=mandolin" in silver().cuts[0].as_wikitext()

    def test_several_instruments_are_listed(self):
        assert "|Justin Holmes=guitar, vocals" in silver().cuts[0].as_wikitext()

    def test_absent_fields_are_left_out(self):
        text = Cut(record="4masks").as_wikitext()
        assert "|number=" not in text and "|engineer=" not in text
        assert text.endswith("}}")

    def test_a_cut_with_no_record_is_still_a_cut(self):
        # Plenty is cut in a studio that never lands on an album.
        text = Cut(studio="a kitchen",
                   players=[Player("David Grier", ["guitar"])]).as_wikitext()
        assert "|record=" not in text
        assert "|David Grier=guitar" in text


class TestSplice:
    def test_a_page_that_does_not_exist_yet(self):
        assert splice(None, silver().block()).startswith(BEGIN)

    def test_the_block_lands_before_the_categories(self):
        page = "{{Song|composer=Justin Myles Holmes}}\n\nProse.\n\n[[Category:Compositions]]"
        out = splice(page, silver().block())
        assert out.index(BEGIN) < out.index("[[Category:Compositions]]")
        assert out.endswith("[[Category:Compositions]]")

    def test_prose_is_untouched(self):
        page = "{{Song}}\n\nA tune Barlow probably never played.\n"
        assert "Barlow probably never played" in splice(page, silver().block())

    def test_a_second_run_replaces_the_block_rather_than_repeating_it(self):
        once = splice("{{Song}}\n\nProse.", silver().block())
        twice = splice(once, silver().block())
        assert twice.count(BEGIN) == 1
        assert twice.count("Prose.") == 1

    def test_a_half_deleted_block_is_refused(self):
        page = splice("{{Song}}", silver().block()).replace(END, "")
        with pytest.raises(ValueError) as caught:
            splice(page, silver().block())
        assert "closing" in str(caught.value)

    def test_the_block_is_idempotent(self):
        once = splice("{{Song}}\n\n[[Category:Compositions]]", silver().block())
        assert splice(once, silver().block()) == once


class FakeWiki:
    """Enough wiki to plan against: some pages, and some redirects."""

    def __init__(self, pages=None, redirects=None):
        self.pages = pages or {}
        self.redirects = redirects or {}

    def resolve(self, title):
        return self.redirects.get(title, title)

    def get_text(self, title):
        return self.pages.get(title)


class TestReadCompositions:
    def test_reads_the_exporter_output(self):
        found = to_wiki.read_compositions(io.StringIO(json.dumps(EXPORT)))
        assert [c.title for c in found] == ["Barlows", "Silver 44"]

    def test_narrows_to_the_titles_asked_for(self):
        found = to_wiki.read_compositions(
            io.StringIO(json.dumps(EXPORT)), only=["Barlows"])
        assert [c.title for c in found] == ["Barlows"]


class TestPlan:
    def test_missing_pages_are_created(self):
        planned, skipped = to_wiki.plan_for(FakeWiki(), compositions(EXPORT["records"]))
        assert skipped == []
        assert sorted((entry.page, entry.outcome) for entry in planned) == [
            ("Song:Barlows", "created"), ("Song:Silver 44", "created")]

    def test_a_renamed_composition_keeps_its_data(self):
        # Somebody checks the sleeve and moves Song:Barlows Jig to Song:Barlows.
        # The importer must write through the redirect, not over it.
        wiki = FakeWiki(
            pages={"Song:Barlows": "{{Song}}\n\nA jig.\n"},
            redirects={"Song:Barlows Jig": "Song:Barlows"})
        export = [{"name": "4masks", "tracks": [
            {"title": "Barlows Jig", "personnel": PLAYERS}]}]
        entry = to_wiki.plan_for(wiki, compositions(export))[0][0]
        assert (entry.page, entry.asked_for, entry.outcome) == (
            "Song:Barlows", "Song:Barlows Jig", "updated")
        assert entry.redirected
        assert "A jig." in entry.text

    def test_an_unchanged_page_is_left_alone(self):
        composition = silver()
        wiki = FakeWiki(pages={"Song:Silver 44": composition.block()})
        assert to_wiki.plan_for(wiki, [composition])[0][0].outcome == "unchanged"

    def test_a_page_with_a_broken_block_is_skipped_not_mangled(self):
        composition = silver()
        broken = composition.block().replace(END, "") + "\n\nProse below."
        wiki = FakeWiki(pages={"Song:Silver 44": broken})
        planned, skipped = to_wiki.plan_for(wiki, [composition])
        assert planned == []
        assert "closing" in skipped[0].why


class TestWrite:
    class Recorder(FakeWiki):
        def __init__(self, fail=()):
            super().__init__()
            self.saved = []
            self.fail = set(fail)

        def save(self, title, text, summary):
            if title in self.fail:
                raise RuntimeError("the wiki said no")
            self.saved.append(title)

    def test_writes_each_planned_page(self, monkeypatch):
        monkeypatch.setattr(to_wiki.time, "sleep", lambda _: None)
        wiki = self.Recorder()
        planned, _ = to_wiki.plan_for(FakeWiki(), compositions(EXPORT["records"]))
        assert to_wiki.write_pages(wiki, planned) == 0
        assert sorted(wiki.saved) == ["Song:Barlows", "Song:Silver 44"]

    def test_one_failure_does_not_stop_the_rest(self, monkeypatch):
        monkeypatch.setattr(to_wiki.time, "sleep", lambda _: None)
        wiki = self.Recorder(fail={"Song:Barlows"})
        planned, _ = to_wiki.plan_for(FakeWiki(), compositions(EXPORT["records"]))
        assert to_wiki.write_pages(wiki, planned) == 1
        assert wiki.saved == ["Song:Silver 44"]
