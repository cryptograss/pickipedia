#!/usr/bin/env python3
"""Tests for splicing arthel's studio ensembles into a record page."""

import pytest

from studio_sessions import BEGIN, END, session_block, splice, track_call

TRACK = {
    "title": "Silver 44",
    "number": 1,
    "studio": "Tunesmith Studios, Nashville TN",
    "recorded": "3 April, 2024",
    "engineer": "Jake Stargel",
    "personnel": [
        {"name": "Justin Holmes", "instruments": ["guitar", "vocals"]},
        {"name": "Harry Clark", "instruments": ["mandolin"]},
    ],
}

RECORD = {"name": "4masks", "tracks": [TRACK]}


class TestTrackCall:
    def test_names_the_track(self):
        assert "|track=Silver 44" in track_call(TRACK)

    def test_a_player_is_a_named_parameter(self):
        assert "|Harry Clark=mandolin" in track_call(TRACK)

    def test_several_instruments_are_listed(self):
        assert "|Justin Holmes=guitar, vocals" in track_call(TRACK)

    def test_session_details_travel_too(self):
        call = track_call(TRACK)
        assert "|engineer=Jake Stargel" in call
        assert "|studio=Tunesmith Studios, Nashville TN" in call

    def test_absent_fields_are_left_out(self):
        call = track_call({"title": "Masks", "personnel": []})
        assert "|number=" not in call
        assert "|engineer=" not in call
        assert call.endswith("}}")


class TestSplice:
    def test_a_page_that_does_not_exist_yet(self):
        assert splice(None, session_block(RECORD)).startswith(BEGIN)

    def test_the_block_lands_before_the_categories(self):
        page = "{{Record|artist=Justin Myles Holmes}}\n\nProse.\n\n[[Category:Records]]"
        out = splice(page, session_block(RECORD))
        assert out.index(BEGIN) < out.index("[[Category:Records]]")
        assert out.endswith("[[Category:Records]]")

    def test_prose_is_untouched(self):
        page = "{{Record}}\n\nA record made in a hurry.\n"
        out = splice(page, session_block(RECORD))
        assert "A record made in a hurry." in out

    def test_a_second_run_replaces_the_block_rather_than_repeating_it(self):
        page = splice("{{Record}}\n\nProse.", session_block(RECORD))
        again = splice(page, session_block(RECORD))
        assert again.count(BEGIN) == 1
        assert again.count("Prose.") == 1

    def test_editing_around_the_block_survives_a_rerun(self):
        page = splice("{{Record}}", session_block(RECORD))
        edited = page.replace("{{Record}}", "{{Record|artist=Justin Myles Holmes}}\n\nSomebody's note.")
        again = splice(edited, session_block(RECORD))
        assert "Somebody's note." in again
        assert "|artist=Justin Myles Holmes" in again

    def test_new_tracks_replace_old_ones(self):
        page = splice(None, session_block(RECORD))
        renamed = {"name": "4masks", "tracks": [dict(TRACK, title="Silver 45")]}
        again = splice(page, session_block(renamed))
        assert "Silver 45" in again
        assert "Silver 44" not in again

    def test_a_half_deleted_block_is_refused(self):
        # Replacing to the end of the page would eat everything after it.
        page = splice("{{Record}}", session_block(RECORD)).replace(END, "")
        with pytest.raises(ValueError) as caught:
            splice(page, session_block(RECORD))
        assert "closing" in str(caught.value)

    def test_the_block_is_idempotent(self):
        once = splice("{{Record}}\n\n[[Category:Records]]", session_block(RECORD))
        twice = splice(once, session_block(RECORD))
        assert once == twice
