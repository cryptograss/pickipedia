#!/usr/bin/env python3
"""
Tests for yielding to what a person wrote.

Two cases prompted this, a week apart and the same shape. A title says
"Billy", the page needs "Billy Strings", somebody fixes it, and the importer
must not put "Billy" back the next night. Then: a blurb names Carlton Haney,
somebody makes it [[Carlton Haney]], and the importer must not unlink him.

Both are a person doing the thing the feed cannot. Neither may be undone by a
machine that keeps no note of having disagreed.
"""

import hashlib
import importlib.util
from pathlib import Path

from podcast_preserve import (description, is_annotation, keep_human_description,
                              keep_human_topics, param_block, renumber, topic_lines,
                              who_set_description, who_set_topics)

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


class TestTextSha1:
    """text_sha1 has to agree with the hash MediaWiki stores."""

    def test_matches_a_real_revision(self):
        # Checked against the live API on 2026-09-16: the sha1 of
        # "Fiddle Studio/Megan Lynch Chowning (John Rice)" is the sha1 of its
        # text exactly as stored, which has no trailing newline.
        stored = "{{PodcastEpisode\n|podcast=Fiddle Studio\n}}"
        expected = hashlib.sha1(stored.encode("utf-8")).hexdigest()
        assert to_wiki.text_sha1(stored) == expected
        assert to_wiki.text_sha1(stored + "\n") == expected

    def test_normalises_to_nfc_like_the_wiki(self):
        composed = "Béla Fleck"
        decomposed = "Béla Fleck"
        assert to_wiki.text_sha1(decomposed) == to_wiki.text_sha1(composed)


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
    """
    One night: decide, and write if the page would change.

    @return: {field: editor} for whatever was kept from a person, so a test
        can say which field it means. Empty when the feed's version won.
    """
    current, text, kept = to_wiki.decide_text(wiki, "Ep", wanted, BOT)
    if current is None or current.strip() != text.strip():
        wiki.write(BOT, text)
    return {field: editor for field, editor, _note in kept}


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

        assert run_import(wiki, artwork) == {"topics": "JMyles"}   # night 1
        assert wiki.revisions[-1]["user"] == BOT
        assert run_import(wiki, artwork) == {"topics": "JMyles"}   # night 2: the bug
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


class TestDescription:
    """
    The description is the feed's words until a person improves them.

    On 2026-09-25 somebody turned two names in a Bluegrass Unlimited blurb
    into [[Carlton Haney]] and [[Muleskinner News]], and the next night's run
    put the plain text back. The topics had been protected from exactly this
    a week earlier; the description had not, because the feed does own the
    words — but it does not own the links.
    """

    FEED = ("{{PodcastEpisode\n|title=Ep\n|topic=Fred Bartenstein\n"
            "|description=his work with Carlton Haney and the Muleskinner News.\n}}")
    LINKED = FEED.replace(
        "his work with Carlton Haney and the Muleskinner News.",
        "his work with [[Carlton Haney]] and the [[Muleskinner News]].")

    def test_the_links_survive_the_next_run(self):
        merged, kept = keep_human_description(self.FEED, self.LINKED)
        assert kept
        assert "[[Carlton Haney]]" in merged
        assert "[[Muleskinner News]]" in merged

    def test_the_rest_of_the_page_still_refreshes(self):
        feed = self.FEED.replace("|topic=Fred Bartenstein",
                                 "|topic=Fred Bartenstein\n|duration=4194")
        merged, _ = keep_human_description(feed, self.LINKED)
        assert "|duration=4194" in merged

    def test_an_untouched_description_changes_nothing(self):
        merged, kept = keep_human_description(self.FEED, self.FEED)
        assert not kept
        assert merged == self.FEED

    def test_a_page_without_one_is_left_alone(self):
        bare = "{{PodcastEpisode\n|title=Ep\n}}"
        merged, kept = keep_human_description(self.FEED, bare)
        assert not kept
        assert merged == self.FEED

    def test_a_wrapped_description_is_read_whole(self):
        # Someone who wraps the blurb over three lines is writing one
        # parameter. Reading only the first would truncate them silently.
        wrapped = ("{{PodcastEpisode\n|description=first line\n"
                   "second line\nthird line\n|topic=Fred\n}}")
        assert description(wrapped) == "first line\nsecond line\nthird line"
        assert param_block(wrapped, "description")[:2] == (1, 4)

    def test_only_adding_links_is_recognised_as_such(self):
        assert is_annotation(description(self.LINKED), description(self.FEED))

    def test_a_rewritten_blurb_is_not(self):
        # The publisher changing the words under somebody's links is the one
        # case worth a human's attention, so it must be distinguishable.
        rewritten = self.FEED.replace("his work with Carlton Haney and the "
                                      "Muleskinner News.", "An entirely new blurb.")
        assert not is_annotation(description(self.LINKED), description(rewritten))

    def test_piped_links_and_bold_are_stripped_for_the_comparison(self):
        fancy = self.FEED.replace(
            "his work with Carlton Haney and the Muleskinner News.",
            "his work with [[Carlton Haney|Haney]] and the '''Muleskinner News'''.")
        plain_feed = self.FEED.replace("Carlton Haney", "Haney")
        assert is_annotation(description(fancy), description(plain_feed))


class TestWhoSetDescription:
    """
    The same flip-flop the topics had, for a different line.

    Keeping somebody's description still means writing the page, so the bot
    becomes the latest editor. Asking "who edited last?" the next night
    answers "the bot" — and the bot then regenerates the field and undoes what
    it kept. Walking back to who *set* it is what stops that.
    """

    def page(self, blurb):
        return "{{PodcastEpisode\n|title=Ep\n|description=" + blurb + "\n}}"

    def test_the_person_who_added_the_links_is_found_through_bot_edits(self):
        revisions = [
            {"user": "HearThatWhistleBlow", "text": self.page("[[Carlton Haney]]")},
            {"user": "HearThatWhistleBlow", "text": self.page("[[Carlton Haney]]")},
            {"user": "JMyles", "text": self.page("[[Carlton Haney]]")},
            {"user": "HearThatWhistleBlow", "text": self.page("Carlton Haney")},
        ]
        assert who_set_description(revisions) == "JMyles"

    def test_three_nights_running_the_answer_does_not_drift(self):
        # The regression in full: bot writes, person links, bot keeps and
        # writes, bot keeps and writes. On none of those nights may the
        # description come back as the feed's.
        revisions = [{"user": "HearThatWhistleBlow", "text": self.page("Carlton Haney")}]
        assert who_set_description(revisions) == "HearThatWhistleBlow"

        revisions.insert(0, {"user": "JMyles", "text": self.page("[[Carlton Haney]]")})
        assert who_set_description(revisions) == "JMyles"

        for _ in range(2):
            revisions.insert(0, {"user": "HearThatWhistleBlow",
                                 "text": self.page("[[Carlton Haney]]")})
            assert who_set_description(revisions) == "JMyles"

    def test_the_bot_keeps_its_own_when_nobody_has_touched_it(self):
        revisions = [
            {"user": "HearThatWhistleBlow", "text": self.page("Carlton Haney")},
            {"user": "HearThatWhistleBlow", "text": self.page("Carlton Haney")},
        ]
        assert who_set_description(revisions) == "HearThatWhistleBlow"

    def test_no_history_is_nobody(self):
        assert who_set_description([]) is None


class TestBothFieldsAtOnce:
    """
    The two protected fields are decided independently, on one read of history.

    A person may correct a name and leave the blurb alone, or link the blurb
    and leave the name alone. Neither should drag the other along, and neither
    should cost a second trip to the API.
    """

    def linked(self, topic="Farayi", blurb="plain words"):
        return ("{{PodcastEpisode\n|podcast=Toy Heart with Tom Power\n"
                "|title=Ep 1\n|date=2026-01-02\n|topic=" + topic + "\n"
                "|description=" + blurb + "\n}}")

    def test_a_linked_blurb_survives_while_the_feed_fixes_the_topic(self):
        wiki = FakeWiki([
            {"user": BOT, "text": self.linked()},
            {"user": "JMyles", "text": self.linked(blurb="[[Carlton Haney]]")},
        ])
        kept = run_import(wiki, self.linked(topic="Farayi Malek"))
        final = wiki.revisions[-1]["text"]
        assert kept == {"description": "JMyles"}
        assert "[[Carlton Haney]]" in final, "their links stay"
        assert "|topic=Farayi Malek" in final, "the bot still set the topic it owns"

    def test_both_kept_when_both_were_touched(self):
        wiki = FakeWiki([
            {"user": BOT, "text": self.linked()},
            {"user": "JMyles",
             "text": self.linked(topic="Farayi Malek", blurb="[[Carlton Haney]]")},
        ])
        kept = run_import(wiki, self.linked())
        assert kept == {"topics": "JMyles", "description": "JMyles"}

    def test_history_is_read_once_for_two_fields(self):
        wiki = FakeWiki([
            {"user": BOT, "text": self.linked()},
            {"user": "JMyles",
             "text": self.linked(topic="Farayi Malek", blurb="[[Carlton Haney]]")},
        ])
        run_import(wiki, self.linked())
        assert wiki.history_reads == 1, "two contested fields, one trip to the API"

    def test_history_is_not_read_when_neither_field_is_contested(self):
        wiki = FakeWiki([{"user": BOT, "text": self.linked()}])
        run_import(wiki, self.linked().replace("|date=2026-01-02", "|date=2026-01-03"))
        assert wiki.history_reads == 0


class TestStraySpaces:
    """
    Feed blurbs arrive with spaces in front of their own punctuation —
    "the Muleskinner News ." — left behind when the publisher's HTML was
    flattened. Somebody linking that name closes the gap in passing.

    That happened on the Fred Bartenstein page on 2026-09-25, and the first
    version of this check called it a rewritten description. It is not; it is
    the same sentence, tidied. Reporting it would train everyone to ignore the
    report.
    """

    def test_closing_the_gap_is_still_only_an_annotation(self):
        feed = "his work with Carlton Haney and the Muleskinner News ."
        theirs = "his work with [[Carlton Haney]] and the [[Muleskinner News]]."
        assert is_annotation(theirs, feed)

    def test_a_genuinely_different_sentence_is_not(self):
        feed = "his work with Carlton Haney and the Muleskinner News ."
        theirs = "an entirely different blurb about something else."
        assert not is_annotation(theirs, feed)
