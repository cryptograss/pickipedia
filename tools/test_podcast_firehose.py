#!/usr/bin/env python3
"""
Tests for the combined-feed builder.

The interesting decision the firehose makes is which episodes survive the cap.
Getting it wrong is quiet and consequential: sort everything by date, take the
top N, and the shows that publish rarely simply stop appearing. Measured
against the live feeds, that lost five of thirteen shows — including Toy Heart
and County Sales Radio Hour, which are not less worth hearing for being less
frequent.
"""

import importlib.util
from datetime import datetime
from pathlib import Path

# The module has a hyphen in its name, so it cannot be imported normally.
_spec = importlib.util.spec_from_file_location(
    "podcast_firehose", Path(__file__).parent / "podcast-firehose.py"
)
firehose = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(firehose)


def entry(show, day):
    """A (channel_info, item, pubdate) tuple of the shape fetch_feed returns."""
    return ({"title": show, "link": f"https://{show}.example"}, None, datetime(2026, 1, day))


def shows_in(selected):
    return {channel_info["title"] for channel_info, _, _ in selected}


def counts_in(selected):
    counts = {}
    for channel_info, _, _ in selected:
        counts[channel_info["title"]] = counts.get(channel_info["title"], 0) + 1
    return counts


def test_a_prolific_show_does_not_crowd_out_a_quiet_one():
    # "loud" published 20 times this month, "quiet" once — and that once is the
    # oldest episode in the set, so a straight date sort would drop it first.
    items = [entry("loud", day) for day in range(2, 22)]
    items.append(entry("quiet", 1))

    selected = firehose.select_episodes(items, max_total=5)

    assert "quiet" in shows_in(selected), (
        "the quiet show vanished, which is the bug this function exists to prevent"
    )


def test_every_show_appears_when_there_is_room():
    items = [entry(f"show{n}", day) for n in range(13) for day in range(1, 6)]
    selected = firehose.select_episodes(items, max_total=13)
    assert len(shows_in(selected)) == 13


def test_the_cap_is_respected():
    items = [entry(f"show{n}", day) for n in range(5) for day in range(1, 21)]
    assert len(firehose.select_episodes(items, max_total=17)) == 17


def test_leftover_capacity_goes_to_whoever_has_more():
    # One show has plenty, one has a single episode. With room for six, the
    # quiet show still gets its one and the rest flow to the prolific show.
    items = [entry("loud", day) for day in range(1, 11)]
    items.append(entry("quiet", 5))

    counts = counts_in(firehose.select_episodes(items, max_total=6))

    assert counts["quiet"] == 1
    assert counts["loud"] == 5


def test_fewer_episodes_than_the_cap_is_not_an_error():
    items = [entry("a", 1), entry("b", 2)]
    selected = firehose.select_episodes(items, max_total=100)
    assert len(selected) == 2


def test_no_episodes_at_all():
    assert firehose.select_episodes([], max_total=10) == []


def test_output_is_sorted_newest_first():
    items = [entry(f"show{n}", day) for n in range(4) for day in range(1, 9)]
    selected = firehose.select_episodes(items, max_total=20)
    dates = [pubdate for _, _, pubdate in selected]
    assert dates == sorted(dates, reverse=True)


def test_each_show_contributes_its_newest_first():
    # Within a show, selection should start at the top. Taking the oldest first
    # would mean the firehose showed stale episodes while newer ones existed.
    items = [entry("a", day) for day in (1, 15, 28)]
    selected = firehose.select_episodes(items, max_total=1)
    assert selected[0][2] == datetime(2026, 1, 28)


def test_shows_are_told_apart_by_link_not_title():
    # Two shows can share a display name; the feed link is what identifies
    # them. Collapsing them would let one silence the other.
    a = ({"title": "same name", "link": "https://a.example"}, None, datetime(2026, 1, 2))
    b = ({"title": "same name", "link": "https://b.example"}, None, datetime(2026, 1, 1))

    selected = firehose.select_episodes([a, a, b], max_total=2)

    links = {channel_info["link"] for channel_info, _, _ in selected}
    assert links == {"https://a.example", "https://b.example"}
