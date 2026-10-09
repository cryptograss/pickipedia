#!/usr/bin/env python3
"""
Tests for episode wikitext generation.

The description is the part that goes wrong quietly. It arrives as HTML and
leaves as one line of wikitext, and the rule for what a tag becomes is not the
same for every tag: a </p> has to leave a space behind or the sentences run
together, while a </strong> must not, because it sits mid-sentence where the
writer already chose the spacing.

Getting that wrong is not only cosmetic. The description is capped at 500
characters, so each injected space is spent out of the budget and a real word
drops off the end. HearThatWhistleBlow published the inline-tag version of
episode 52 of What's The Reason For This Podcast for seven weeks before anyone
noticed the "East Nash Grass ." it was leaving on the page.
"""

import importlib.util
from datetime import datetime
from pathlib import Path

# The module has a hyphen in its name, so it cannot be imported normally.
_spec = importlib.util.spec_from_file_location(
    "podcast_episodes", Path(__file__).parent / "podcast-episodes.py"
)
episodes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(episodes)


# Verbatim from the feed, the stretch that was coming out wrong. Two block
# boundaries (</p><p>, </p><ul><li>), four inline tags, an entity, and a
# period and a colon each sitting directly against a closing tag.
REAL_SHOW_NOTES = (
    "<p>In this jam-packed episode, we’re coming to you live from "
    "<em>backstage at RockyGrass</em> with two of the most dynamic forces in "
    "modern bluegrass—<strong>Harry and Cory of East Nash Grass</strong>. "
    "From fanboy moments to mandolin heroes.</p>"
    "<p>\U0001f3b6 <strong>Episode Highlights:</strong></p>"
    "<ul><li>\U0001fa95 <em>Banjo Beginnings &amp; Mandolin Magic</em>: Hear "
    "how Cory and Harry each found their musical footing.</li></ul>"
)


def episode(description, title="Episode 52 - The Creek Freak Diaries"):
    return {
        "title": title,
        "link": "https://rss.com/podcasts/whatsthereasonforthis/2151099",
        "pubdate": datetime(2025, 8, 4),
        "description": description,
        "audio": "",
        "duration": "",
        "image": "",
    }


def description_of(wikitext):
    for line in wikitext.split("\n"):
        if line.startswith("|description="):
            return line[len("|description="):]
    return None


def test_inline_tags_leave_no_space():
    """An inline tag is inside a sentence; the writer's spacing stands."""
    desc = description_of(
        episodes.make_wikitext("What's The Reason For This Podcast",
                               episode(REAL_SHOW_NOTES), [])
    )
    assert "East Nash Grass." in desc, desc
    assert "East Nash Grass ." not in desc, desc
    assert "Mandolin Magic:" in desc, desc
    assert "Mandolin Magic :" not in desc, desc
    assert "bluegrass—Harry" in desc, desc


def test_block_tags_still_separate_sentences():
    """The reason tags became spaces in the first place has not gone away."""
    desc = description_of(
        episodes.make_wikitext(
            "x", episode("<p>exactly who he is.</p><p>This one gets loud.</p>"), []
        )
    )
    assert "is. This one" in desc, desc
    assert "is.This one" not in desc, desc


def test_list_items_separate():
    """</li><li> is a block boundary too, or the bullets run together."""
    desc = description_of(
        episodes.make_wikitext(
            "x", episode("<ul><li>first thing</li><li>second thing</li></ul>"), []
        )
    )
    assert "first thing second thing" in desc, desc


def test_entities_are_unescaped():
    desc = description_of(
        episodes.make_wikitext("x", episode("<p>Banjo &amp; Mandolin</p>"), [])
    )
    assert "Banjo & Mandolin" in desc, desc


def test_no_space_before_punctuation_anywhere():
    """The symptom, stated as the symptom, over the whole real description."""
    desc = description_of(
        episodes.make_wikitext("x", episode(REAL_SHOW_NOTES), [])
    )
    for punct in (".", ",", ":", ";", "!", "?"):
        assert f" {punct}" not in desc, (punct, desc)


def test_description_is_capped():
    desc = description_of(
        episodes.make_wikitext("x", episode("<p>" + "word " * 400 + "</p>"), [])
    )
    assert len(desc) <= 503, len(desc)
    assert desc.endswith("...")


def test_no_description_no_parameter():
    assert description_of(
        episodes.make_wikitext("x", episode(""), [])
    ) is None


if __name__ == "__main__":
    import sys
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
