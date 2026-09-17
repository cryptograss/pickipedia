#!/usr/bin/env python3
"""
Put arthel's studio ensembles on the wiki's record pages.

    node src/build_logic/export_studio_sessions.js > sessions.json   # in arthel
    python3 studio-sessions-to-wiki.py --dry-run < sessions.json
    python3 studio-sessions-to-wiki.py --write   < sessions.json

Transcription, like the podcast importer, and it runs under the same bot
account for the same reason: who played mandolin on a track is read off a file
somebody else maintains, not judged here.

Unlike the podcast importer it does not own the pages it writes to. A record
page is written by people; this fills in one delimited block of it and leaves
the rest exactly as it found it. The markers are in studio_sessions.py.

This one does not run on the wiki VPS — it reads the arthel checkout, which
lives wherever the site is built. It is left out of the Jenkinsfile's Copy
Tools stage on purpose.

Credentials come from the environment; see podcast_wiki.
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import podcast_wiki                                        # noqa: E402
import studio_sessions                                     # noqa: E402

EXEMPT_GROUP = "exempt-from-verification"
WRITE_PAUSE = 0.4
SUMMARY = "Update studio personnel from arthel"

# A record is a handful of tracks and there are three records. A run that wants
# to change more pages than this is not doing what this script is for.
DEFAULT_MAX_CHANGES = 20


def main():
    ap = argparse.ArgumentParser(
        description="Import studio personnel into PickiPedia record pages")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="report what would change, touch nothing (default)")
    mode.add_argument("--write", action="store_true",
                      help="actually update the record pages")
    ap.add_argument("--record", action="append",
                    help="restrict to one record; repeatable")
    ap.add_argument("--api", default=podcast_wiki.DEFAULT_API,
                    help="MediaWiki api.php to write to")
    ap.add_argument("--max-changes", type=int, default=DEFAULT_MAX_CHANGES,
                    metavar="N", help=f"refuse to write if more than N pages "
                                      f"would change (default {DEFAULT_MAX_CHANGES})")
    ap.add_argument("--show-diff", action="store_true",
                    help="print the block that would be written")
    args = ap.parse_args()

    payload = json.load(sys.stdin)
    records = payload["records"] if isinstance(payload, dict) else payload
    if args.record:
        wanted = set(args.record)
        records = [r for r in records if r["name"] in wanted]
    if not records:
        raise SystemExit("no records to import")

    wiki = podcast_wiki.Wiki(api_url=args.api)
    if args.write:
        wiki.login()
        account = wiki.require_group(EXEMPT_GROUP, because=(
            "This is transcription from arthel, not an editorial claim, and "
            "belongs under the import account."))
        print(f"writing as {account}", file=sys.stderr)
    else:
        print("dry run: reading only, no credentials needed", file=sys.stderr)

    plan = []
    for record in records:
        title = record["name"]
        tracks = record.get("tracks", [])
        current = wiki.get_text(title)
        try:
            wanted_text = studio_sessions.splice(
                current, studio_sessions.session_block(record))
        except ValueError as exc:
            print(f"  SKIPPED {title}: {exc}", file=sys.stderr)
            continue

        if current is None:
            outcome = "created"
        elif current.strip() == wanted_text.strip():
            outcome = "unchanged"
        else:
            outcome = "updated"

        players = {p["name"] for t in tracks for p in t.get("personnel", [])}
        print(f"  {outcome:9} {title:24} {len(tracks):2} tracks, "
              f"{len(players):2} musicians", file=sys.stderr)
        if args.show_diff and outcome != "unchanged":
            print(studio_sessions.session_block(record), file=sys.stderr)
        if outcome != "unchanged":
            plan.append((title, wanted_text, outcome))

    if args.max_changes and len(plan) > args.max_changes:
        raise SystemExit(
            f"refusing to write: {len(plan)} pages would change, over the "
            f"limit of {args.max_changes}. Re-run with --max-changes if that "
            f"is what you meant.")

    if not args.write:
        print(f"\n{len(plan)} page(s) would change", file=sys.stderr)
        return 0

    failed = 0
    for title, text, outcome in plan:
        try:
            wiki.save(title, text, SUMMARY)
            print(f"  {outcome} {title}", file=sys.stderr)
            time.sleep(WRITE_PAUSE)
        except Exception as exc:                            # noqa: BLE001
            failed += 1
            print(f"  FAILED {title}: {str(exc)[:160]}", file=sys.stderr)

    print(f"\n{len(plan) - failed} written, {failed} failed", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
