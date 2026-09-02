#!/usr/bin/env python3
"""
Report how each of a show's title parsers is actually doing.

    python3 podcast-parsers.py                        # every show
    python3 podcast-parsers.py "Bluegrass Jam Along"  # one
    python3 podcast-parsers.py --unmatched "Grass Talk Radio"

Most podcasts use a handful of title formats. The job of a pattern list is to
name those formats and stop — not to grow a new line every time an episode
slips through, which is how a list reaches forty entries that nobody can reason
about and starts matching things that are not people.

This is the tool for telling those apart. A format the show really uses catches
episodes by the dozen. A one-off bolted on to catch a single straggler catches
one, forever, and is usually better deleted: the episode it rescues is worth
less than the confidence that the list means what it says.

Patterns are tried in order and the first match wins, so the counts here are
what each pattern caught *after* everything above it had its turn. A pattern
reading zero may be genuinely dead, or it may be shadowed by a broader one
above it — the report says which.
"""

import argparse
import re
import sys
from collections import Counter

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

import podcast_budget                                      # noqa: E402
import podcast_config                                      # noqa: E402
import podcast_net                                         # noqa: E402
from xml.etree.ElementTree import fromstring                # noqa: E402

USER_AGENT = "PickiPedia Bluegrass Podcast Firehose/1.0"
BUDGET_SECONDS = 20


def feed_titles(url):
    raw = podcast_net.fetch_bytes(url, USER_AGENT, timeout=30)
    return [(item.findtext("title") or "").strip()
            for item in fromstring(raw).findall(".//item")]


def label(entry, index):
    """A pattern's name, or a stand-in that makes its absence obvious."""
    if entry.get("name"):
        return entry["name"]
    return f"(unnamed #{index + 1})"


def review(show, patterns, titles):
    """
    @return: (rows, unmatched) where a row is (label, kind, count, example).
    """
    counts = Counter()
    examples = {}
    unmatched = []

    for title in titles:
        for index, entry in enumerate(patterns):
            if re.match(entry["pattern"], title):
                counts[index] += 1
                examples.setdefault(index, title)
                break
        else:
            unmatched.append(title)

    # A pattern that caught nothing may be dead, or merely shadowed by a
    # broader one above it. Saying which turns "delete this" into a decision
    # somebody can make without re-deriving it.
    shadowed = set()
    for index, entry in enumerate(patterns):
        if counts[index]:
            continue
        for title in titles:
            if re.match(entry["pattern"], title):
                shadowed.add(index)
                break

    rows = []
    for index, entry in enumerate(patterns):
        kind = "skip" if entry.get("skip") else "get"
        if not counts[index]:
            kind += " SHADOWED" if index in shadowed else " DEAD"
        rows.append((label(entry, index), kind, counts[index],
                     examples.get(index, "")))
    return rows, unmatched


def main():
    ap = argparse.ArgumentParser(description="Review podcast title parsers")
    ap.add_argument("show", nargs="*", help="podcast page titles; default all")
    ap.add_argument("--unmatched", action="store_true",
                    help="list the titles nothing matched")
    ap.add_argument("--no-wiki", action="store_true",
                    help="use the checked-in patterns instead of the wiki's")
    args = ap.parse_args()

    feeds, patterns = podcast_config.load(prefer_wiki=not args.no_wiki)
    wanted = set(args.show)

    for feed in feeds:
        show = feed["name"]
        if wanted and show not in wanted:
            continue
        entries = patterns.get(show, [])
        if not entries:
            print(f"\n{'=' * 72}\n{show} — no patterns")
            continue

        try:
            titles = feed_titles(feed["url"])
        except Exception as exc:                            # noqa: BLE001
            print(f"\n{'=' * 72}\n{show} — feed unreadable: {exc}",
                  file=sys.stderr)
            continue

        try:
            with podcast_budget.budget(BUDGET_SECONDS, show):
                rows, unmatched = review(show, entries, titles)
        except podcast_budget.Overran as exc:
            print(f"\n{'=' * 72}\n{show} — patterns overran: {exc}",
                  file=sys.stderr)
            continue

        caught = sum(c for _, k, c, _ in rows if k.startswith("get"))
        skipped = sum(c for _, k, c, _ in rows if k.startswith("skip"))
        print(f"\n{'=' * 72}")
        print(f"{show}")
        print(f"  {len(titles)} episodes: {caught} parsed, {skipped} skipped, "
              f"{len(unmatched)} unmatched")
        print(f"  {len(entries)} patterns, "
              f"{sum(1 for _, k, _, _ in rows if 'DEAD' in k)} dead, "
              f"{sum(1 for _, k, c, _ in rows if c == 1)} matching only one")
        print()
        for name, kind, count, example in sorted(rows, key=lambda r: -r[2]):
            print(f"  {count:>4}  {kind:<14} {name[:40]}")
            if example and count:
                print(f"        e.g. {example[:60]}")

        if args.unmatched and unmatched:
            print(f"\n  unmatched ({len(unmatched)}):")
            for title in unmatched[:40]:
                print(f"     {title[:70]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
