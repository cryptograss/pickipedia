#!/usr/bin/env python3
"""
Splitting a matched title fragment into the separate entities it names.

A pattern's (?P<guest>...) group captures whatever sat where a name was
expected, and that is frequently several names at once: "Sam Bush, Jerry
Douglas, David Grisman". Left unsplit it becomes one wiki page title that
nobody will ever write, instead of three links to people the scene cares
about.

Lives in its own module, with an underscore in the name, for two reasons: the
tests import it rather than keeping their own copy of the logic, and the
Jenkinsfile's Copy Tools stage matches podcast_* as well as podcast-*, so it
reaches the VPS alongside the scripts that use it.
"""

import re

# Commas, ampersands and the word "and" all separate names in episode titles,
# often in the same title: "Sierra Hull, Alison Krauss and Wyatt Rice".
SEPARATOR_RE = re.compile(r"\s*(?:,|&|\band\b)\s*", re.I)

# Titles trail off into vagueness — "... and more", "... etc". These are not
# entities and would otherwise defeat the all-parts-look-like-names check
# below, costing us the split for the real names in front of them.
#
# The leading \b is load-bearing: without it this strips the tail of "Buddy
# Ashmore" and leaves "Buddy Ash". Real banjo player, real episode, and the
# test suite caught it.
TRAILING_VAGUE_RE = re.compile(
    r"(?:[,&]|\band\b)?\s*\b(?:more|others|etc\.?)\s*$", re.I
)


# Some patterns capture the word that introduced the name along with it, and
# "feat. Cory Walker" is not a person. Stripped per-part rather than once up
# front, because it can appear after a separator: "East Nash Grass, feat. Cory
# Walker".
LEADING_FEAT_RE = re.compile(r"^(?:feat(?:uring)?|ft)\.?\s+", re.I)


def split_names(raw):
    """
    Split a captured fragment into individual entity names.

    Conservative on purpose. Splitting wrongly invents entities that do not
    exist, which is worse than leaving a compound name whole: a name left
    whole is one redlink somebody can rename, while a bad split scatters
    several across the wiki.

    So a split only happens when *every* resulting part looks like a name in
    its own right — two words or more. That single rule handles the cases that
    would otherwise need special-casing:

    - "Natalie and Brittany Haas" stays whole. "Natalie" alone is one word, so
      the split is refused, which is right: they share the surname.
    - "Carter and Cleveland" stays whole, and should — it is what the duo call
      themselves.
    - "Sam Bush, Jerry Douglas, David Grisman" becomes three.

    @param raw: the fragment captured by a pattern's guest group.
    @return: list of names, possibly empty, never containing empty strings.
    """
    name = (raw or "").strip()
    if not name:
        return []

    name = TRAILING_VAGUE_RE.sub("", name).strip().strip(",&").strip()
    if not name:
        return []

    parts = [LEADING_FEAT_RE.sub("", part).strip() for part in SEPARATOR_RE.split(name)]
    parts = [part for part in parts if part]

    if len(parts) > 1 and all(len(part.split()) >= 2 for part in parts):
        return parts

    return [LEADING_FEAT_RE.sub("", name).strip() or name]
