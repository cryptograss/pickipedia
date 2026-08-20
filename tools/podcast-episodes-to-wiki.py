#!/usr/bin/env python3
"""
Create or update a podcast episode page on the wiki for every extracted episode.

Composes with the extractor:

    python3 podcast-episodes.py --json | python3 podcast-episodes-to-wiki.py --dry-run
    python3 podcast-episodes.py --json | python3 podcast-episodes-to-wiki.py --write

Writes go through the pickipedia MCP server, driven over stdio, rather than
straight to the MediaWiki API. That is not a detour: the MCP middleware is what
wraps a bot's claims in <proposed>, and a page written past it would either be
turned away by the verification gate or — far worse — land as an unmarked
assertion that nobody agreed to.

Idempotent on purpose, and that is what makes a large run safe to be bold with.
Every episode is compared against what is already on the wiki with the proposal
wrapper stripped, so a re-run after fixing a pattern touches only the pages
whose content actually changed. Running it twice costs reads and nothing else,
which means a bad extraction is a re-run rather than a cleanup.
"""

import argparse
import json
import re
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from podcast_mcp import McpStdioClient, PICKIPEDIA          # noqa: E402

# Between writes. The wiki is a small VPS running its own database, and there
# is no hurry — a few hundred pages either way is minutes.
WRITE_PAUSE = 0.6
READ_PAUSE = 0.05

# A first attempt at this run created about forty-five pages and then failed on
# every one after that, until it was left alone for a minute and carried on
# fine. That is MediaWiki throttling a burst of edits, not anything wrong with
# the page — so back off and try again rather than recording several hundred
# spurious failures and leaving the wiki half populated.
RETRY_BACKOFF = (3, 10, 30, 60)

PROPOSED_RE = re.compile(r"</?proposed\b[^>]*>", re.I)
WS_RE = re.compile(r"\s+")


def comparable(wikitext):
    """
    The page as it would be without the proposal wrapper, whitespace flattened.

    Stored pages carry <proposed by="..."> around the claim, which this script
    never writes and must not diff against, or every page would look changed on
    every run and the whole thing would churn revisions forever.
    """
    return WS_RE.sub(" ", PROPOSED_RE.sub("", wikitext or "")).strip()


def with_retries(action, describe, on_notice):
    """
    Run a write, giving the wiki time to recover from a throttle.

    @param action: callable returning (text, is_error) from an MCP tool call.
    @param describe: short label for logging.
    @param on_notice: called once with the first error text seen.
    @return: the successful text.
    """
    last = ""
    for attempt, pause in enumerate((0,) + RETRY_BACKOFF):
        if pause:
            time.sleep(pause)
        text, is_error = action()
        if not is_error:
            return text
        last = text
        if attempt == 0:
            on_notice(text)
    raise RuntimeError(f"{describe} refused after retries: {last[:160]}")


def parse_metadata(text):
    """Pull the revision id out of the MCP's get-page response."""
    match = re.search(r"Latest revision ID:\s*(\d+)", text or "")
    return int(match.group(1)) if match else None


def fetch(client, title):
    """
    @return: (exists, revision_id, source) for a page.
    """
    text, is_error = client.call_tool(
        "get-page", {"title": title, "content": "source", "metadata": True})
    if is_error:
        if "does not exist" in text or "rest-nonexistent-title" in text:
            return False, None, ""
        raise RuntimeError(f"reading {title!r}: {text[:200]}")
    source = ""
    if "Source:" in text:
        source = text.split("Source:", 1)[1]
    return True, parse_metadata(text), source


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="report what would change, touch nothing (default)")
    mode.add_argument("--write", action="store_true",
                      help="actually create and update pages")
    ap.add_argument("--show", action="append",
                    help="restrict to one podcast; repeatable")
    ap.add_argument("--limit", type=int,
                    help="stop after this many episodes")
    args = ap.parse_args()

    episodes = json.load(sys.stdin)
    if args.show:
        wanted = set(args.show)
        episodes = [e for e in episodes if e["podcast"] in wanted]
    if args.limit:
        episodes = episodes[:args.limit]

    writing = bool(args.write)
    print(f"{len(episodes)} episodes; mode = {'WRITE' if writing else 'dry run'}",
          file=sys.stderr)

    command, env = PICKIPEDIA
    client = McpStdioClient(command, env).start()

    tally = {"created": 0, "updated": 0, "unchanged": 0, "failed": 0}
    failures = []
    seen_notices = set()

    def notice(text):
        """Surface the first instance of each distinct wiki complaint."""
        key = text[:80]
        if key not in seen_notices:
            seen_notices.add(key)
            print(f"  ! backing off: {text[:200]}", file=sys.stderr)

    try:
        for index, episode in enumerate(episodes, 1):
            title = episode["page_title"]
            wanted_text = episode["wikitext"]

            try:
                exists, revid, current = fetch(client, title)
                time.sleep(READ_PAUSE)

                if not exists:
                    if writing:
                        with_retries(
                            lambda: client.call_tool("create-page", {
                                "title": title,
                                "source": wanted_text,
                                "comment": "Podcast episode, subjects parsed from the feed title",
                            }),
                            f"create {title}", notice)
                        time.sleep(WRITE_PAUSE)
                    tally["created"] += 1
                    verb = "create"
                elif comparable(current) != comparable(wanted_text):
                    if writing:
                        with_retries(
                            lambda: client.call_tool("update-page", {
                                "title": title,
                                "source": wanted_text,
                                "latestId": revid,
                                "comment": "Refresh episode data from the feed",
                            }),
                            f"update {title}", notice)
                        time.sleep(WRITE_PAUSE)
                    tally["updated"] += 1
                    verb = "update"
                else:
                    tally["unchanged"] += 1
                    verb = "skip"

            except Exception as exc:                        # noqa: BLE001
                tally["failed"] += 1
                failures.append((title, str(exc)[:160]))
                verb = "FAIL"

            if index % 25 == 0 or verb == "FAIL":
                print(f"  [{index}/{len(episodes)}] {verb:6} {title[:70]}",
                      file=sys.stderr)
    finally:
        client.close()

    print("\n" + ", ".join(f"{k}={v}" for k, v in tally.items()), file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} failures:", file=sys.stderr)
        for title, why in failures[:25]:
            print(f"  {title[:70]} :: {why}", file=sys.stderr)

    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
