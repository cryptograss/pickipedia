#!/usr/bin/env python3
"""
Tests for yielding to a human's topics.

The case that prompted this: a title says "Billy", the page needs "Billy
Strings", somebody fixes it, and the importer must not put "Billy" back the
next night.
"""

import importlib.util
from pathlib import Path

from podcast_topics import keep_human_topics, renumber, topic_lines, who_set_topics

TOOLS = Path(__file__).parent


def load_script(name):
    """Import a hyphenated script, which a plain import statement cannot."""
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), TOOLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


to_wiki = load_script("podcast-episodes-to-wiki")


def page(*topics, title="Ep 1", extra=""):
    lines = ["{{PodcastEpisode", "|podcast=Toy Heart with Tom Power",
             f"|title={title}", "|date=2026-01-02"]
    for index, topic in enumerate(topics):
        key = "topic" if index == 0 else f"topic{index + 1}"
        lines.append(f"|{key}={topic}")
    if extra:
        lines.append(extra)
    lines.append("}}")
    return "\n".join(lines)


class TestTopicLines:
    def test_finds_numbered_and_unnumbered(self):
        assert topic_lines(page("Del McCoury", "Ronnie McCoury")) == [
            "|topic=Del McCoury", "|topic2=Ronnie McCoury"]

    def test_finds_the_guest_alias(self):
        assert topic_lines("{{PodcastEpisode\n|guest2=Del McCoury\n}}") == [
            "|guest2=Del McCoury"]

    def test_ignores_other_parameters(self):
        assert topic_lines("|title=Topics of the day\n|audio=x.mp3") == []

    def test_empty_page(self):
        assert topic_lines("") == []
        assert topic_lines(None) == []


class TestRenumber:
    def test_a_hand_written_second_topic_is_kept(self):
        # MediaWiki keeps only the last of two |topic= parameters, so a person
        # writing the obvious thing would otherwise lose a name.
        assert renumber(["|topic=Del McCoury", "|topic=Ronnie McCoury"]) == [
            "|topic=Del McCoury", "|topic2=Ronnie McCoury"]

    def test_guest_aliases_become_topics(self):
        assert renumber(["|guest=Del McCoury"]) == ["|topic=Del McCoury"]

    def test_blank_values_dropped(self):
        assert renumber(["|topic=", "|topic2=Del McCoury"]) == ["|topic=Del McCoury"]


class TestKeepHumanTopics:
    def test_a_corrected_name_survives(self):
        wanted = page("Billy")
        current = page("Billy Strings")
        text, kept = keep_human_topics(wanted, current)
        assert kept
        assert "|topic=Billy Strings" in text
        assert "|topic=Billy\n" not in text

    def test_feed_fields_still_refresh(self):
        wanted = page("Billy", extra="|duration=3600")
        current = page("Billy Strings")
        text, _ = keep_human_topics(wanted, current)
        assert "|duration=3600" in text
        assert "|topic=Billy Strings" in text

    def test_identical_topics_change_nothing(self):
        wanted = page("Del McCoury")
        text, kept = keep_human_topics(wanted, page("Del McCoury"))
        assert not kept
        assert text == wanted

    def test_a_person_adding_a_second_name(self):
        text, kept = keep_human_topics(page("Del McCoury"),
                                       page("Del McCoury", "Ronnie McCoury"))
        assert kept
        assert "|topic2=Ronnie McCoury" in text

    def test_a_person_removing_the_topics_is_respected(self):
        text, kept = keep_human_topics(page("Roots Revival"), page())
        assert kept
        assert "Roots Revival" not in text

    def test_topics_land_where_ours_were(self):
        text, _ = keep_human_topics(page("Billy"), page("Billy Strings"))
        lines = text.splitlines()
        assert lines.index("|topic=Billy Strings") == lines.index("|date=2026-01-02") + 1

    def test_topics_appear_even_when_the_parser_found_none(self):
        # An episode nobody could parse, filed by hand. Nothing to replace, so
        # the names go in before the closing braces rather than after them.
        wanted = "{{PodcastEpisode\n|podcast=Grass Talk Radio\n}}"
        text, kept = keep_human_topics(wanted, page("Bradley Laird"))
        assert kept
        assert text.splitlines()[-1] == "}}"
        assert "|topic=Bradley Laird" in text

    def test_trailing_newline_preserved(self):
        wanted = page("Billy") + "\n"
        text, _ = keep_human_topics(wanted, page("Billy Strings"))
        assert text.endswith("\n")


class TestWhoEditedLast:
    def test_bot_password_suffix_is_stripped(self):
        assert to_wiki.base_account("HearThatWhistleBlow@import") == "HearThatWhistleBlow"

    def test_plain_name_untouched(self):
        assert to_wiki.base_account("JMyles") == "JMyles"

    def test_missing_name(self):
        assert to_wiki.base_account(None) == ""

    def test_our_own_edit(self):
        assert to_wiki.is_ours("HearThatWhistleBlow", "HearThatWhistleBlow")

    def test_somebody_elses_edit(self):
        assert not to_wiki.is_ours("JMyles", "HearThatWhistleBlow")

    def test_unknown_editor_counts_as_somebody_else(self):
        # A suppressed revision hides its author. Leaving the page alone is the
        # safe reading of "we cannot tell".
        assert not to_wiki.is_ours(None, "HearThatWhistleBlow")

    def test_unknown_bot_name_never_claims_an_edit(self):
        assert not to_wiki.is_ours("JMyles", "")


class FakeWiki:
    """A page's revision history, and the importer's writes appended to it."""

    def __init__(self, revisions):
        # oldest first here, so a test reads like the page's history
        self.revisions = list(revisions)
        self.history_reads = 0

    def get_text_and_last_editor(self, title):
        if not self.revisions:
            return None, None
        return self.revisions[-1]["text"], self.revisions[-1]["user"]

    def history(self, title, limit=50):
        self.history_reads += 1
        return list(reversed(self.revisions))[:limit]

    def write(self, user, text):
        self.revisions.append({"user": user, "text": text})


BOT = "HearThatWhistleBlow"


def run_import(wiki, wanted):
    """One night: decide, and write if the page would change."""
    current, text, kept_for = to_wiki.decide_text(wiki, "Ep", wanted, BOT)
    if current is None or current.strip() != text.strip():
        wiki.write(BOT, text)
    return kept_for


class TestWhoSetTopics:
    def test_the_person_behind_the_bots_merge(self):
        history = [  # newest first
            {"user": BOT, "text": page("Farayi Malek", extra="|image=a.png")},
            {"user": "JMyles", "text": page("Farayi Malek")},
            {"user": BOT, "text": page("Farayi")},
        ]
        assert who_set_topics(history) == "JMyles"

    def test_the_bot_when_it_set_them(self):
        history = [
            {"user": BOT, "text": page("Farayi", extra="|image=a.png")},
            {"user": BOT, "text": page("Farayi")},
        ]
        assert who_set_topics(history) == BOT

    def test_no_history(self):
        assert who_set_topics([]) is None


class TestNightAfterNight:
    """pickipedia 2026-09-17: a kept correction was reverted the next night."""

    def test_a_correction_survives_every_night_not_just_the_first(self):
        wiki = FakeWiki([
            {"user": BOT, "text": page("Farayi")},
            {"user": "JMyles", "text": page("Farayi Malek")},
        ])
        artwork = page("Farayi", extra="|image=a.png")

        assert run_import(wiki, artwork) == "JMyles"      # night 1: kept, art added
        assert wiki.revisions[-1]["user"] == BOT
        assert run_import(wiki, artwork) == "JMyles"      # night 2: the bug
        run_import(wiki, artwork)                          # night 3, for good measure

        final = wiki.revisions[-1]["text"]
        assert "|topic=Farayi Malek" in final
        assert "|image=a.png" in final
        assert len(wiki.revisions) == 3, "nights 2 and 3 should change nothing"

    def test_a_pattern_change_still_applies_to_bot_set_pages(self):
        wiki = FakeWiki([{"user": BOT, "text": page("Farayi")}])
        run_import(wiki, page("Farayi Malek"))
        assert "|topic=Farayi Malek" in wiki.revisions[-1]["text"]

    def test_history_is_not_read_when_topics_agree(self):
        wiki = FakeWiki([{"user": BOT, "text": page("Del McCoury")}])
        run_import(wiki, page("Del McCoury", extra="|image=a.png"))
        assert wiki.history_reads == 0
