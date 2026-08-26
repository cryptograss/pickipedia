#!/usr/bin/env python3
"""
Create or update a wiki page for every episode the extractor found.

Composes with it:

    python3 podcast-episodes.py --json --with-wikitext > episodes.json
    python3 podcast-episodes-to-wiki.py --dry-run < episodes.json
    python3 podcast-episodes-to-wiki.py --write   < episodes.json

This is an import bot, in the same sense as blue-railroad-import: it transcribes
a feed into wiki pages and makes no judgements of its own. It therefore runs
under its own account, not under Magent's.

That distinction is the point rather than bookkeeping. An edit by Magent is a
claim by an AI that a person should check, and the verification workflow wraps
it in <proposed> and files it for review. An episode page is a mechanical
transcription — title, date, link and audio, straight off the feed, re-derivable
by anyone who runs this again. Filing several hundred of those for human review
does not make the wiki more careful; it buries the handful of claims that
genuinely wanted checking. The provenance is on the page itself, in
Has episode url and Has audio url, which is a better audit trail than a tag.

So the bot account belongs to the exempt-from-verification group, and this
script refuses to run as an account that is not — see check_identity below.
Importing under an editorial identity is the mistake it exists to prevent.

Idempotent, which is what makes a run of this size safe. Each page is compared
with what is already on the wiki and skipped when identical, so a re-run after
fixing a pattern touches only what changed. A bad extraction is a re-run rather
than a cleanup.

Credentials come from the environment; see podcast_wiki.
"""

import argparse
import json
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

import podcast_wiki                                        # noqa: E402

# The wiki is a small VPS running its own database and there is no hurry.
WRITE_PAUSE = 0.4

EXEMPT_GROUP = "exempt-from-verification"

SUMMARY_CREATE = "Import podcast episode from feed"
SUMMARY_UPDATE = "Refresh podcast episode from feed"


def main():
    ap = argparse.ArgumentParser(
        description="Import podcast episode pages into PickiPedia")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="report what would change, touch nothing (default)")
    mode.add_argument("--write", action="store_true",
                      help="actually create and update pages")
    ap.add_argument("--show", action="append",
                    help="restrict to one podcast; repeatable")
    ap.add_argument("--limit", type=int, help="stop after this many episodes")
    ap.add_argument("--api", default=podcast_wiki.DEFAULT_API,
                    help="MediaWiki api.php to write to")
    args = ap.parse_args()

    episodes = json.load(sys.stdin)
    if args.show:
        wanted = set(args.show)
        episodes = [e for e in episodes if e["podcast"] in wanted]
    if args.limit:
        episodes = episodes[:args.limit]

    missing = [e["page_title"] for e in episodes if not e.get("wikitext")]
    if missing:
        raise SystemExit(
            f"{len(missing)} episodes carry no wikitext. Regenerate the input "
            f"with: podcast-episodes.py --json --with-wikitext")

    writing = bool(args.write)
    wiki = podcast_wiki.Wiki(api_url=args.api)

    if writing:
        wiki.login()
        account = wiki.require_group(EXEMPT_GROUP, because=(
            "This is an import bot and needs its own account; running it as a "
            "reviewing identity files machine output for human verification, "
            "which drowns the claims that actually wanted reviewing."))
        print(f"writing as {account}", file=sys.stderr)
    else:
        print("dry run: reading only, no credentials needed", file=sys.stderr)

    print(f"{len(episodes)} episodes", file=sys.stderr)

    tally = {"created": 0, "updated": 0, "unchanged": 0, "failed": 0}
    failures = []

    for index, episode in enumerate(episodes, 1):
        title = episode["page_title"]
        wanted_text = episode["wikitext"]
        try:
            current = wiki.get_text(title)
            if current is None:
                outcome = "created"
            elif current.strip() != wanted_text.strip():
                outcome = "updated"
            else:
                outcome = "unchanged"

            if writing and outcome != "unchanged":
                summary = SUMMARY_CREATE if current is None else SUMMARY_UPDATE
                wiki.save(title, wanted_text, summary)
                time.sleep(WRITE_PAUSE)

            tally[outcome] += 1
        except Exception as exc:                            # noqa: BLE001
            tally["failed"] += 1
            failures.append((title, str(exc)[:160]))
            outcome = "FAILED"

        if index % 25 == 0 or outcome == "FAILED":
            print(f"  [{index}/{len(episodes)}] {outcome:9} {title[:66]}",
                  file=sys.stderr)

    print("\n" + ", ".join(f"{k}={v}" for k, v in tally.items()), file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} failures:", file=sys.stderr)
        for title, why in failures[:25]:
            print(f"  {title[:66]} :: {why}", file=sys.stderr)

    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
