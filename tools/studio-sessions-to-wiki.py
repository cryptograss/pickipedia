#!/usr/bin/env python3
"""
Put studio cuts on the wiki, one page per composition.

    node src/build_logic/export_studio_sessions.js > sessions.json   # in arthel
    python3 studio-sessions-to-wiki.py --dry-run < sessions.json
    python3 studio-sessions-to-wiki.py --write   < sessions.json

A composition is a page in the Song: namespace, and its cuts are written into
one delimited block on it — see PickiPedia:Compositions. Record pages and
musicians' pages then query that data rather than holding copies of it.

Transcription, like the podcast importer, and it runs under the same bot
account for the same reason: who played mandolin on a session is read off a
file somebody else maintains, not judged here.

It does not own the pages it writes to. Everything outside the markers belongs
to whoever is editing the page, and a composition renamed on the wiki keeps its
data, because redirects are followed rather than written through.

Run rarely: this data changes when a record is made.

Credentials come from the environment; see podcast_wiki.
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).parent))

import podcast_wiki                                        # noqa: E402
import studio_sessions                                     # noqa: E402

EXEMPT_GROUP = "exempt-from-verification"
WRITE_PAUSE = 0.4
SUMMARY = "Update studio recordings from session data"

# Every composition on every record this wiki describes is a few dozen pages.
# A run that wants to change more than this is not doing what it is for.
DEFAULT_MAX_CHANGES = 100


@dataclass
class Planned:
    """What one composition's page should say, and how that differs from now."""

    page: str
    text: str
    outcome: str        # created, updated, unchanged
    asked_for: str      # the title before redirects were followed

    @property
    def redirected(self):
        return self.page != self.asked_for

    def describe(self):
        via = f"  (redirected from {self.asked_for})" if self.redirected else ""
        return f"  {self.outcome:9} {self.page}{via}"


@dataclass
class Skipped:
    """A page the importer would not touch, and why."""

    page: str
    why: str


def read_compositions(stream, only=None):
    """
    The compositions in an exporter's JSON, optionally narrowed to some titles.

    @param only: titles to keep, or None for all of them.
    """
    payload = json.load(stream)
    records = payload["records"] if isinstance(payload, dict) else payload
    found = studio_sessions.compositions(records)
    if only:
        wanted = set(only)
        found = [c for c in found if c.title in wanted]
    return found


def plan_for(wiki, compositions, follow_redirects=True
             ) -> Tuple[List[Planned], List[Skipped]]:
    """Work out what each composition's page should say."""
    planned, skipped = [], []
    for composition in compositions:
        asked_for = composition.page
        page = wiki.resolve(asked_for) if follow_redirects else asked_for
        try:
            current = wiki.get_text(page)
            text = studio_sessions.splice(current, composition.block())
        except ValueError as exc:
            skipped.append(Skipped(page, str(exc)))
            continue
        except Exception as exc:                            # noqa: BLE001
            skipped.append(Skipped(page, str(exc)[:160]))
            continue

        if current is None:
            outcome = "created"
        elif current.strip() == text.strip():
            outcome = "unchanged"
        else:
            outcome = "updated"

        planned.append(Planned(page, text, outcome, asked_for))
    return planned, skipped


def report(compositions, planned, skipped, show_diff=False):
    """Say what the run found, before anything is written."""
    cuts = sum(len(c.cuts) for c in compositions)
    print(f"{len(compositions)} compositions, {cuts} cuts", file=sys.stderr)

    for entry in skipped:
        print(f"  SKIPPED {entry.page}: {entry.why}", file=sys.stderr)

    changes = [entry for entry in planned if entry.outcome != "unchanged"]
    for entry in changes:
        print(entry.describe(), file=sys.stderr)
        if show_diff:
            print(entry.text, file=sys.stderr)

    created = sum(1 for entry in changes if entry.outcome == "created")
    print(f"\n{len(changes)} page(s) would change "
          f"({created} created, {len(changes) - created} updated)",
          file=sys.stderr)
    return changes


def write_pages(wiki, changes) -> int:
    """Save each planned page. @return: how many failed."""
    failed = 0
    for entry in changes:
        try:
            wiki.save(entry.page, entry.text, SUMMARY)
            time.sleep(WRITE_PAUSE)
        except Exception as exc:                            # noqa: BLE001
            failed += 1
            print(f"  FAILED {entry.page}: {str(exc)[:160]}", file=sys.stderr)

    print(f"\n{len(changes) - failed} written, {failed} failed", file=sys.stderr)
    return failed


def connect(api_url, writing) -> podcast_wiki.Wiki:
    """A wiki client, logged in and checked when the run intends to write."""
    wiki = podcast_wiki.Wiki(api_url=api_url)
    if not writing:
        print("dry run: reading only, no credentials needed", file=sys.stderr)
        return wiki

    wiki.login()
    account = wiki.require_group(EXEMPT_GROUP, because=(
        "This is transcription from session data, not an editorial claim, "
        "and belongs under the import account."))
    print(f"writing as {account}", file=sys.stderr)
    return wiki


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Import studio cuts onto PickiPedia composition pages")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="report what would change, touch nothing (default)")
    mode.add_argument("--write", action="store_true",
                      help="actually write the composition pages")
    ap.add_argument("--song", action="append",
                    help="restrict to one composition, by title; repeatable")
    ap.add_argument("--api", default=podcast_wiki.DEFAULT_API,
                    help="MediaWiki api.php to write to")
    ap.add_argument("--max-changes", type=int, default=DEFAULT_MAX_CHANGES,
                    metavar="N", help=f"refuse to write if more than N pages "
                                      f"would change (default {DEFAULT_MAX_CHANGES})")
    ap.add_argument("--show-diff", action="store_true",
                    help="print the block that would be written")
    return ap.parse_args(argv)


def main():
    args = parse_args()

    compositions = read_compositions(sys.stdin, only=args.song)
    if not compositions:
        raise SystemExit("no compositions to import")

    wiki = connect(args.api, writing=args.write)
    planned, skipped = plan_for(wiki, compositions)
    changes = report(compositions, planned, skipped, show_diff=args.show_diff)

    if args.max_changes and len(changes) > args.max_changes:
        raise SystemExit(
            f"refusing to write: {len(changes)} pages would change, over the "
            f"limit of {args.max_changes}. Re-run with --max-changes if that "
            f"is what you meant.")

    if not args.write:
        return 0
    return 1 if write_pages(wiki, changes) else 0


if __name__ == "__main__":
    sys.exit(main())
