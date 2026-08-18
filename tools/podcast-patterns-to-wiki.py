#!/usr/bin/env python3
"""
Render the checked-in guest patterns as the wikitext section podcast pages use.

One-way and one-time: after the patterns live on the wiki, the JSON here is a
fallback for when the wiki is unreachable, not a source anyone edits. Kept in
the repo because the migration is worth being able to re-run and re-read.

Usage:
    podcast-patterns-to-wiki.py                  # every podcast
    podcast-patterns-to-wiki.py "Grass Talk Radio"
"""

import json
import sys
from pathlib import Path

PATTERNS_JSON = Path(__file__).parent / "podcast-guest-patterns.json"

PREAMBLE = """== Guest name patterns ==

These are used by the [[Bluegrass Podcast Firehose]] to pull guest names out of \
episode titles. They are tried in order and the first match wins, so the \
specific ones belong above the general ones.

* A line starting with <code>skip:</code> marks episodes that have no guest — \
a backing track, a monologue, a festival announcement. Skipping them is not the \
same as failing to parse them, and keeping the two apart is what makes the \
unmatched list worth reading.
* A line starting with <code>#</code> is a comment.
* Anything else is a Python regular expression with a named group \
<code>(?P&lt;guest&gt;...)</code> around the part to capture.

Edit these freely. A pattern that does not compile is skipped and logged rather \
than breaking the feed, so a mistake here costs one show's guest names until \
somebody fixes it — never the feed itself."""


def section_for(name, entries):
    """
    The wikitext section for one podcast.

    @param name: Podcast name, used only in the empty-case comment.
    @param entries: Pattern dicts from podcast-guest-patterns.json.
    @return: Wikitext, or None when there is nothing to migrate.
    """
    if not entries:
        return None

    lines = []
    for entry in entries:
        note = entry.get("_note")
        if note:
            lines.append(f"# {note}")
        pattern = entry["pattern"]
        lines.append(f"skip: {pattern}" if entry.get("skip") else pattern)

    body = "\n".join(lines)
    return f'{PREAMBLE}\n\n<pre class="guest-patterns">\n{body}\n</pre>'


def main():
    patterns = json.loads(PATTERNS_JSON.read_text())["patterns"]
    wanted = sys.argv[1:] or list(patterns)

    for name in wanted:
        if name not in patterns:
            print(f"no patterns for {name!r}", file=sys.stderr)
            continue
        section = section_for(name, patterns[name])
        if section is None:
            print(f"--- {name}: no patterns, nothing to migrate ---", file=sys.stderr)
            continue
        print(f"===== {name} =====")
        print(section)
        print()


if __name__ == "__main__":
    main()
