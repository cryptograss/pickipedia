#!/usr/bin/env python3
"""
A wall-clock budget for work that might not finish.

Python's re module has no timeout, and a regular expression with a nested
quantifier can take longer than the age of the universe on a perfectly ordinary
input. Measured on a real Python 3.12 with ^(?P<guest>[A-Za-z ]+)+$ — which is
a plausible thing to write while trying to capture a name, not an attack:

    16 chars    0.002s
    24 chars    0.467s
    28 chars    7.502s      and it doubles with every added character

A fifty-character episode title against that pattern never returns. The cron
fires again six hours later and starts a second one.

So the budget is not really about malice. It is about the ordinary mistake that
the language gives us no other way to survive.

Scoped per podcast rather than per match: one timer for a show costs nothing,
where one per title across thirteen feeds and eighty patterns is thousands of
syscalls. It also puts the blast radius in the right place — a bad pattern
costs that show its guest names, and the other twelve are unaffected, which is
the same bargain the config loader already makes for a pattern that will not
compile.

Unix and the main thread only, which a cron script is.
"""

import signal
from contextlib import contextmanager


class Overran(Exception):
    """The work inside the budget did not finish in time."""


@contextmanager
def budget(seconds, what):
    """
    Abandon the block if it runs longer than `seconds`.

    @param seconds: Wall-clock allowance. Zero or None disables the budget,
        which is what the tests want when they are checking something else.
    @param what: Named in the exception, so the log says which podcast stalled.
    @raises Overran: If the allowance is exhausted.
    """
    if not seconds:
        yield
        return

    def expired(signum, frame):
        raise Overran(f"{what} exceeded its {seconds}s budget")

    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        # Clear the timer before restoring the handler, or an alarm landing
        # between the two would fire into whatever was there before.
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
