#!/usr/bin/env python3
"""
Podcast Episode Page Generator - Extracts guest names from podcast RSS feeds
and generates wiki page content for each episode using {{PodcastEpisode}}.

Modes:
  --dry-run     Show what pages would be created (default)
  --preview N   Show full wikitext for N sample pages
  --create      Actually create pages on the wiki via MCP
  --json        Output structured JSON for all episodes with guests
  --unmatched   List titles no pattern matched — the pattern-writing worklist
"""

import json
import re
import sys
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import urlopen, Request
from xml.etree.ElementTree import fromstring

import podcast_budget
import podcast_config
import podcast_net

TOOLS_DIR = Path(__file__).parent
USER_AGENT = "PickiPedia Bluegrass Podcast Firehose/1.0"

# Wall-clock allowance for applying one show's patterns to its episodes. Real
# extraction across all thirteen takes well under a second; anything near this
# is a runaway pattern, not slow work.
PATTERN_BUDGET_SECONDS = 20
FETCH_TIMEOUT = 30


def load_config(prefer_wiki=True):
    """
    Which podcasts to read, and how to pull guest names out of their titles.

    Both come from the wiki — each podcast's own page carries its feed URL in
    the {{Podcast}} infobox and its patterns in a guest-patterns block — so a
    picker who spots a mis-parsed title can fix it where they already are,
    rather than opening a pull request.

    @param prefer_wiki: Set false to force the checked-in copy, which is what
        you want when testing a pattern before publishing it.
    @return: (feeds, patterns)
    """
    return podcast_config.load(prefer_wiki=prefer_wiki)


def fetch_episodes(feed_url):
    """Fetch RSS feed and return list of (title, link, pubdate, description) tuples."""
    try:
        raw = podcast_net.fetch_bytes(feed_url, USER_AGENT, timeout=FETCH_TIMEOUT)
    except podcast_net.UnsafeFeedURL as e:
        print(f"  REFUSED {feed_url}: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  WARN: {e}", file=sys.stderr)
        return []

    try:
        root = fromstring(raw)
    except Exception as e:
        print(f"  WARN: parse error: {e}", file=sys.stderr)
        return []

    episodes = []
    for item in root.findall(".//item"):
        title_el = item.find("title")
        link_el = item.find("link")
        pd_el = item.find("pubDate")
        desc_el = item.find("description")

        title = title_el.text.strip() if title_el is not None and title_el.text else ""
        link = link_el.text.strip() if link_el is not None and link_el.text else ""
        desc = desc_el.text.strip() if desc_el is not None and desc_el.text else ""

        pubdate = None
        if pd_el is not None and pd_el.text:
            try:
                pubdate = parsedate_to_datetime(pd_el.text)
            except (ValueError, TypeError):
                pass

        if title:
            episodes.append({
                "title": title,
                "link": link,
                "pubdate": pubdate,
                "description": desc,
            })

    return episodes


def extract_guest(title, patterns_for_podcast):
    """Try to extract guest name(s) from episode title using patterns.
    Returns (guests_list, should_skip) tuple."""
    for p in patterns_for_podcast:
        m = re.match(p["pattern"], title)
        if m:
            if p.get("skip"):
                return [], True
            groups = m.groupdict()
            guests = []
            if "guest" in groups and groups["guest"]:
                guest = groups["guest"].strip()
                # Split on " & " or " and " for multi-guest episodes
                parts = re.split(r'\s*(?:&|and)\s*', guest)
                # Only split if parts look like individual names (2+ words each)
                if len(parts) > 1 and all(len(p.strip().split()) >= 2 for p in parts):
                    guests.extend(p.strip() for p in parts)
                else:
                    guests.append(guest)
            if "feat" in groups and groups["feat"]:
                guests.append(groups["feat"].strip())
            return guests, False
    return [], False


def make_page_title(podcast_name, episode_title):
    """Generate a wiki page title for an episode."""
    # Sanitize: remove characters not allowed in MediaWiki titles
    safe_title = re.sub(r'[#<>\[\]|{}]', '', episode_title)
    safe_title = safe_title.strip()
    if len(safe_title) > 120:
        safe_title = safe_title[:120].rsplit(' ', 1)[0]
    return f"{podcast_name}/{safe_title}"


def make_wikitext(podcast_name, episode, guests):
    """Generate wikitext for an episode page."""
    date_str = ""
    if episode["pubdate"]:
        date_str = episode["pubdate"].strftime("%Y-%m-%d")

    # Build template params
    params = [f"|podcast={podcast_name}"]
    params.append(f"|title={episode['title']}")
    if date_str:
        params.append(f"|date={date_str}")
    if episode["link"]:
        params.append(f"|url={episode['link']}")

    for i, guest in enumerate(guests):
        key = "guest" if i == 0 else f"guest{i+1}"
        params.append(f"|{key}={guest}")

    # Clean description (strip HTML tags/entities, truncate)
    desc = re.sub(r'<[^>]+>', '', episode.get("description", ""))
    import html
    desc = html.unescape(desc)
    if len(desc) > 500:
        desc = desc[:500].rsplit(' ', 1)[0] + "..."
    if desc:
        params.append(f"|description={desc}")

    template_call = "{{PodcastEpisode\n" + "\n".join(params) + "\n}}"
    return template_call


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate podcast episode wiki pages")
    parser.add_argument("--dry-run", action="store_true", default=True,
                        help="Show what pages would be created (default)")
    parser.add_argument("--preview", type=int, metavar="N",
                        help="Show full wikitext for N sample pages")
    parser.add_argument("--json", action="store_true",
                        help="Output structured JSON")
    parser.add_argument("--podcast", type=str,
                        help="Only process this podcast")
    parser.add_argument("--unmatched", action="store_true",
                        help="List episode titles that matched no pattern, grouped "
                             "by podcast. This is the worklist for improving "
                             "podcast-guest-patterns.json")
    args = parser.parse_args()

    feeds, patterns = load_config()

    all_episodes = []
    total_guests = 0
    total_skipped = 0
    total_unmatched = 0
    unmatched_titles = []

    for feed in feeds:
        name = feed["name"]
        if args.podcast and name != args.podcast:
            continue

        pats = patterns.get(name, [])
        if not pats:
            continue

        print(f"Fetching: {name}...", file=sys.stderr)
        episodes = fetch_episodes(feed["url"])

        # Patterns come off a wiki page anyone may edit, and Python's re has no
        # timeout. A nested quantifier — the kind of thing somebody writes by
        # accident reaching for a name — takes longer than the age of the
        # universe on an ordinary title. The budget keeps that to one show.
        try:
            with podcast_budget.budget(PATTERN_BUDGET_SECONDS, name):
                for ep in episodes:
                    guests, skipped = extract_guest(ep["title"], pats)
                    if skipped:
                        total_skipped += 1
                        continue
                    if not guests:
                        total_unmatched += 1
                        unmatched_titles.append((name, ep["title"]))
                        continue

                    total_guests += 1
                    page_title = make_page_title(name, ep["title"])
                    wikitext = make_wikitext(name, ep, guests)

                    all_episodes.append({
                        "page_title": page_title,
                        "podcast": name,
                        "episode_title": ep["title"],
                        "guests": guests,
                        "date": ep["pubdate"].isoformat() if ep["pubdate"] else None,
                        "link": ep["link"],
                        "wikitext": wikitext,
                    })
        except podcast_budget.Overran as e:
            # Whatever this show produced before the timer is kept; the rest of
            # the feed carries on. Say it loudly, because a stalled pattern is
            # invisible otherwise and somebody has to go fix the page.
            print(f"  STALLED {e}. Check the guest patterns on [[{name}]] for a "
                  f"nested quantifier such as ([A-Za-z ]+)+", file=sys.stderr)

    print(f"\nResults: {total_guests} episodes with guests, "
          f"{total_skipped} skipped, {total_unmatched} unmatched",
          file=sys.stderr)

    # The unmatched pile is where pattern work comes from. A count alone says
    # something is being missed without saying what, which is the least useful
    # possible amount of information — some of these are monologues that ought
    # to be skipped, and some are interviews whose title format nobody has
    # written a pattern for yet, and the only way to tell is to read them.
    if args.unmatched:
        by_podcast = {}
        for podcast_name, episode_title in unmatched_titles:
            by_podcast.setdefault(podcast_name, []).append(episode_title)
        for podcast_name in sorted(by_podcast):
            titles = by_podcast[podcast_name]
            print(f"\n{podcast_name} ({len(titles)} unmatched)")
            for episode_title in titles:
                print(f"  {episode_title}")

    if args.json:
        # Strip wikitext from JSON output to keep it clean
        output = []
        for ep in all_episodes:
            out = {k: v for k, v in ep.items() if k != "wikitext"}
            output.append(out)
        json.dump(output, sys.stdout, indent=2, default=str)
        print()
    elif args.preview:
        for ep in all_episodes[:args.preview]:
            print(f"=== {ep['page_title']} ===")
            print(ep["wikitext"])
            print()
    else:
        # Dry run - show page titles and guests
        for ep in all_episodes:
            guests_str = ", ".join(ep["guests"])
            print(f"  {ep['page_title']}  =>  [{guests_str}]")


if __name__ == "__main__":
    main()
