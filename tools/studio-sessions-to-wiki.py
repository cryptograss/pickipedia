#!/usr/bin/env python3
"""
Put studio ensembles on the wiki, one page per composition.

    node src/build_logic/export_studio_sessions.js > sessions.json   # in arthel
    python3 studio-sessions-to-wiki.py --dry-run < sessions.json
    python3 studio-sessions-to-wiki.py --write   < sessions.json

A composition is a page in the Song: namespace, and its recordings are written
into one delimited block on it — see PickiPedia:Compositions. Record pages and
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import podcast_wiki                                        # noqa: E402
import studio_sessions                                     # noqa: E402

EXEMPT_GROUP = "exempt-from-verification"
WRITE_PAUSE = 0.4
SUMMARY = "Update studio recordings from session data"

# Every composition on every record this wiki describes is a few dozen pages.
# A run that wants to change more than this is not doing what it is for.
DEFAULT_MAX_CHANGES = 100


def plan_for(wiki, songs, follow_redirects=True):
    """
    Work out what each composition's page should say.

    @param songs: {title: [recording, ...]}, from studio_sessions.by_song.
    @return: (plan, skipped) — plan is a list of (title, text, outcome), and
        skipped a list of (title, why).
    """
    plan, skipped = [], []
    for song_title in sorted(songs):
        asked = studio_sessions.page_title(song_title)
        title = wiki.resolve(asked) if follow_redirects else asked
        block = studio_sessions.song_block(songs[song_title])
        try:
            current = wiki.get_text(title)
            wanted = studio_sessions.splice(current, block)
        except ValueError as exc:
            skipped.append((title, str(exc)))
            continue
        except Exception as exc:                            # noqa: BLE001
            skipped.append((title, str(exc)[:160]))
            continue

        if current is None:
            outcome = "created"
        elif current.strip() == wanted.strip():
            outcome = "unchanged"
        else:
            outcome = "updated"

        plan.append((title, wanted, outcome, asked))
    return plan, skipped


def main():
    ap = argparse.ArgumentParser(
        description="Import studio recordings onto PickiPedia composition pages")
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
    args = ap.parse_args()

    payload = json.load(sys.stdin)
    records = payload["records"] if isinstance(payload, dict) else payload
    songs = studio_sessions.by_song(records)
    if args.song:
        wanted = set(args.song)
        songs = {title: v for title, v in songs.items() if title in wanted}
    if not songs:
        raise SystemExit("no compositions to import")

    wiki = podcast_wiki.Wiki(api_url=args.api)
    if args.write:
        wiki.login()
        account = wiki.require_group(EXEMPT_GROUP, because=(
            "This is transcription from session data, not an editorial claim, "
            "and belongs under the import account."))
        print(f"writing as {account}", file=sys.stderr)
    else:
        print("dry run: reading only, no credentials needed", file=sys.stderr)

    recordings = sum(len(v) for v in songs.values())
    print(f"{len(songs)} compositions, {recordings} recordings", file=sys.stderr)

    plan, skipped = plan_for(wiki, songs)

    for title, why in skipped:
        print(f"  SKIPPED {title}: {why}", file=sys.stderr)

    changes = [row for row in plan if row[2] != "unchanged"]
    for title, text, outcome, asked in changes:
        moved = "" if title == asked else f"  (redirected from {asked})"
        print(f"  {outcome:9} {title}{moved}", file=sys.stderr)
        if args.show_diff:
            print(text, file=sys.stderr)

    print(f"\n{len(changes)} page(s) would change "
          f"({sum(1 for r in changes if r[2] == 'created')} created, "
          f"{sum(1 for r in changes if r[2] == 'updated')} updated)",
          file=sys.stderr)

    if args.max_changes and len(changes) > args.max_changes:
        raise SystemExit(
            f"refusing to write: {len(changes)} pages would change, over the "
            f"limit of {args.max_changes}. Re-run with --max-changes if that "
            f"is what you meant.")

    if not args.write:
        return 0

    failed = 0
    for title, text, outcome, _asked in changes:
        try:
            wiki.save(title, text, SUMMARY)
            time.sleep(WRITE_PAUSE)
        except Exception as exc:                            # noqa: BLE001
            failed += 1
            print(f"  FAILED {title}: {str(exc)[:160]}", file=sys.stderr)

    print(f"\n{len(changes) - failed} written, {failed} failed", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
