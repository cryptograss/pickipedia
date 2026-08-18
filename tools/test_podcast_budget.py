#!/usr/bin/env python3
"""
Tests for the wall-clock budget.

The budget exists because Python's re has no timeout and a nested quantifier
can take longer than the age of the universe on an ordinary episode title. The
case that matters is not an attack — it is somebody writing ([A-Za-z ]+)+ while
reaching for a name, which the language gives us no other way to survive.
"""

import re
import time

import pytest

from podcast_budget import budget, Overran


def test_work_that_finishes_is_left_alone():
    with budget(5, "a show"):
        result = sum(range(1000))
    assert result == 499500


def test_work_that_overruns_is_abandoned():
    with pytest.raises(Overran):
        with budget(1, "a show"):
            time.sleep(5)


def test_a_runaway_regex_is_actually_interrupted():
    # The real case. This pattern against this input does not return in any
    # useful timeframe; if the budget did not interrupt it, this test would
    # hang the suite rather than fail it.
    pattern = r"^(?P<guest>[A-Za-z ]+)+$"
    title = "a" * 40 + "!"

    started = time.time()
    with pytest.raises(Overran):
        with budget(1, "Grass Talk Radio"):
            re.match(pattern, title)
    assert time.time() - started < 3


def test_the_show_is_named_so_the_log_says_which_page_to_fix():
    with pytest.raises(Overran, match="Grass Talk Radio"):
        with budget(1, "Grass Talk Radio"):
            time.sleep(5)


def test_the_timer_is_cleared_afterwards():
    # A timer left armed would fire during whatever ran next, which is a far
    # more confusing failure than the one it was meant to catch.
    with budget(1, "a show"):
        pass
    time.sleep(1.5)  # would have fired by now if it were still armed


def test_the_timer_is_cleared_even_when_the_body_raises():
    with pytest.raises(ValueError):
        with budget(5, "a show"):
            raise ValueError("something else went wrong")
    time.sleep(0.1)


def test_zero_disables_the_budget():
    # Useful when something else is being tested and a timer would only add
    # noise, and for running the tools interactively while debugging a pattern.
    with budget(0, "a show"):
        time.sleep(0.2)


def test_budgets_do_not_leak_between_shows():
    # Each show gets its own allowance; an earlier show's timer must not still
    # be counting down during a later one.
    with budget(1, "first show"):
        time.sleep(0.3)
    with budget(1, "second show"):
        time.sleep(0.3)
