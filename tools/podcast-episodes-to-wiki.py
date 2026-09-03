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
from collections import Counter

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

import podcast_config                                      # noqa: E402
import podcast_wiki                                        # noqa: E402

# The wiki is a small VPS running its own database and there is no hurry.
WRITE_PAUSE = 0.4

EXEMPT_GROUP = "exempt-from-verification"

# How many pages a run may change before it stops and asks.
#
# A normal run changes nothing, or the handful of episodes published since the
# last one. Adding a whole show's worth of patterns changed twenty-two. A
# pattern accidentally written too broadly would change every episode of that
# show — two hundred and fifty-eight, for the largest feed here.
#
# There is an order of magnitude between honest pattern work and a runaway, so
# a ceiling in between lets people keep improving patterns freely while making
# it impossible for an unattended run to do something big. When a large change
# is meant — a new show with a deep back catalogue — raising it is a deliberate
# act by somebody who is watching.
DEFAULT_MAX_CHANGES = 50

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
    ap.add_argument("--max-changes", type=int, default=DEFAULT_MAX_CHANGES,
                    metavar="N",
                    help=f"refuse to write if more than N pages would change "
                         f"(default {DEFAULT_MAX_CHANGES}; 0 disables)")
    ap.add_argument("--allow-stale-config", action="store_true",
                    help="import anyway when the extractor fell back to the "
                         "checked-in config; say so out loud")
    args = ap.parse_args()

    payload = json.load(sys.stdin)

    # The extractor used to emit a bare list and now emits an object carrying
    # the configuration's provenance. Accept both, so an episodes.json produced
    # before this change still imports.
    if isinstance(payload, dict):
        episodes = payload["episodes"]
        config_source = payload.get("config_source", "unrecorded")
    else:
        episodes = payload
        config_source = "unrecorded"

    # A fallback config is right for the firehose and wrong here. The feed must
    # keep publishing when the wiki is unreachable; an import must not run on a
    # checked-in copy that may be months behind the patterns people have since
    # fixed. It would not fail — it would write several hundred pages that are
    # quietly wrong, with nothing but a log line to say why.
    if config_source == podcast_config.SOURCE_REPO_FALLBACK:
        if not args.allow_stale_config:
            raise SystemExit(
                "refusing to import: the extractor could not reach the wiki and "
                "fell back to the checked-in config.\n"
                "  Re-run podcast-episodes.py with a connection, or take a "
                "snapshot while you have one:\n"
                "    podcast-episodes.py --save-config-snapshot cfg.json ...\n"
                "    podcast-episodes.py --config-snapshot cfg.json ...\n"
                "  Or pass --allow-stale-config if you are sure."
            )
        print("WARNING: importing from a fallback config, as asked",
              file=sys.stderr)
    print(f"config source: {config_source}", file=sys.stderr)

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

    # Survey everything before writing anything. A budget that stops a run
    # halfway is worse than no budget at all: it leaves the wiki in a state
    # nobody chose, with some pages on the new patterns and some on the old.
    # Reading is cheap; being half-applied is not.
    plan = []
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
            plan.append((title, wanted_text, outcome, episode["podcast"]))
            tally[outcome] += 1
        except Exception as exc:                            # noqa: BLE001
            tally["failed"] += 1
            failures.append((title, str(exc)[:160]))
        if index % 100 == 0:
            print(f"  surveyed {index}/{len(episodes)}", file=sys.stderr)

    changes = [row for row in plan if row[2] != "unchanged"]
    print(f"\n{len(changes)} pages would change "
          f"({tally['created']} created, {tally['updated']} updated)",
          file=sys.stderr)

    if args.max_changes and len(changes) > args.max_changes:
        by_show = Counter(show for _, _, _, show in changes)
        detail = "\n".join(f"      {count:>4}  {show}"
                            for show, count in by_show.most_common())
        raise SystemExit(
            f"refusing to write: {len(changes)} pages would change, over the "
            f"limit of {args.max_changes}.\n\n"
            f"  by show:\n{detail}\n\n"
            f"  A run normally changes a handful — the episodes published since\n"
            f"  the last one. A number like this means a pattern changed, which\n"
            f"  is often intended and occasionally a mistake nobody has noticed\n"
            f"  yet. Look at the list above; if it is what you meant, re-run\n"
            f"  with --max-changes {len(changes)} (or 0 for no limit)."
        )

    if writing:
        for index, (title, wanted_text, outcome, _show) in enumerate(changes, 1):
            try:
                summary = SUMMARY_CREATE if outcome == "created" else SUMMARY_UPDATE
                wiki.save(title, wanted_text, summary)
                time.sleep(WRITE_PAUSE)
            except Exception as exc:                        # noqa: BLE001
                tally[outcome] -= 1
                tally["failed"] += 1
                failures.append((title, str(exc)[:160]))
                outcome = "FAILED"
            if index % 25 == 0 or outcome == "FAILED":
                print(f"  [{index}/{len(changes)}] {outcome:9} {title[:60]}",
                      file=sys.stderr)

    print("\n" + ", ".join(f"{k}={v}" for k, v in tally.items()), file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} failures:", file=sys.stderr)
        for title, why in failures[:25]:
            print(f"  {title[:66]} :: {why}", file=sys.stderr)

    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
