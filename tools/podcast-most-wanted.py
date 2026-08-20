#!/usr/bin/env python3
"""
Rank the people and bands the podcasts talk about that PickiPedia has no page
for, and write it out as wikitext.

Reads the JSON that podcast-episodes.py emits, so the two compose:

    python3 podcast-episodes.py --json | python3 podcast-most-wanted.py

Why this exists when MediaWiki has Special:WantedPages: once the episode pages
are created, every unresolved topic is a redlink and that special page ranks
them for free, across the whole wiki, forever. What it cannot tell you is which
shows were talking about somebody, or which episodes to listen to before
writing about them. That is the part worth generating.

The ranking is a claim about the scene, not about notability. It counts how
often somebody comes up in eight years of bluegrass podcasts — which is a
measure of what the music actually talks about, and will move as the shows keep
publishing.
"""

import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

API = "https://pickipedia.xyz/api.php"
BATCH = 50
TIMEOUT = 30

# Values the title parser yields that are not entities worth a page.
NOT_AN_ENTITY = {"and more", "more", "etc", "etc.", "others"}


def existing_pages(titles):
    """
    Which of these titles already have a page.

    @param titles: iterable of candidate page titles.
    @return: set of the titles that exist.
    """
    found = set()
    titles = [t for t in titles
              if t and len(t) < 250 and not any(c in t for c in "#<>[]|{}")]

    for i in range(0, len(titles), BATCH):
        batch = titles[i:i + BATCH]
        query = urllib.parse.urlencode({
            "action": "query",
            "titles": "|".join(batch),
            "format": "json",
            "formatversion": "2",
        })
        try:
            with urllib.request.urlopen(f"{API}?{query}", timeout=TIMEOUT) as r:
                data = json.load(r)
        except Exception as e:                                  # noqa: BLE001
            print(f"  WARN: lookup failed for a batch: {e}", file=sys.stderr)
            continue

        by_title = {p["title"]: p for p in data.get("query", {}).get("pages", [])}
        for page in by_title.values():
            if not page.get("missing", False):
                found.add(page["title"])
        # MediaWiki normalises "foo bar" to "Foo bar"; map the answer back to
        # what we asked about, or every name we sent would look missing.
        for norm in data.get("query", {}).get("normalized", []):
            if norm["to"] in found:
                found.add(norm["from"])

    return found


def collect(episodes):
    """
    @return: dict of name -> {"episodes": [...], "shows": set}
    """
    wanted = defaultdict(lambda: {"episodes": [], "shows": set()})
    for episode in episodes:
        for name in episode.get("guests", []):
            name = (name or "").strip()
            if not name or name.lower() in NOT_AN_ENTITY:
                continue
            entry = wanted[name]
            entry["episodes"].append(episode)
            entry["shows"].add(episode["podcast"])
    return wanted


def render(wanted, missing):
    """Wikitext for the ranked list."""
    ranked = sorted(
        missing,
        key=lambda n: (-len(wanted[n]["episodes"]), n.lower()),
    )
    repeated = [n for n in ranked if len(wanted[n]["episodes"]) > 1]
    once = [n for n in ranked if len(wanted[n]["episodes"]) == 1]

    out = []
    out.append(
        "The people and bands the bluegrass podcasts talk about most, that "
        "PickiPedia has no page for yet.\n")
    out.append(
        "This is not a notability ranking. It counts how often somebody comes "
        "up across {shows} shows and {eps} episodes with an identified "
        "subject — a measure of what the music actually talks about rather "
        "than of what cleared an encyclopedia's bar. It will move as the shows "
        "keep publishing.\n".format(
            shows=len({e["podcast"] for n in wanted for e in wanted[n]["episodes"]}),
            eps=len({e["page_title"] for n in wanted for e in wanted[n]["episodes"]}),
        ))
    out.append(
        "Writing one of these is the single most useful thing you can do here. "
        "Every episode listed beside a name is a primary source you can cite "
        "and a recording you can listen to first.\n")

    out.append("== Talked about more than once ==\n")
    out.append('{| class="wikitable sortable"')
    out.append("! Episodes !! Who !! Shows")
    for name in repeated:
        entry = wanted[name]
        shows = ", ".join(f"[[{s}]]" for s in sorted(entry["shows"]))
        out.append("|-")
        out.append(f"| {len(entry['episodes'])} || [[{name}]] || {shows}")
    out.append("|}\n")

    out.append("== Mentioned once, not yet reviewed ==\n")
    out.append(
        "Deliberately not linked. A name that turns up in two separate "
        "episodes is almost always a real person or band; a name that turns up "
        "once is about as likely to be a fragment of an episode title — "
        "\"Basic Passing Chords\", \"Part Two\", \"Australia\" — or the same "
        "person carrying a description, as in \"Banjo Legend Tony Trischka\". "
        "Linking them all would put several hundred junk redlinks on the wiki "
        "and drown [[Special:WantedPages]], which is the thing that makes "
        "redlinks useful in the first place.\n")
    out.append(
        "So they are listed as plain text, to be read and promoted by hand. If "
        "you recognise somebody here, they belong in the table above — and the "
        "parser probably needs a pattern so the next run finds them too.\n")
    out.append(" &middot; ".join(once) + "\n")

    out.append("== How this is built ==\n")
    out.append(
        "Generated by <code>tools/podcast-most-wanted.py</code> in "
        "[https://github.com/cryptograss/pickipedia cryptograss/pickipedia], "
        "from the subjects parsed out of episode titles. It is a snapshot — "
        "re-run it to refresh.\n")
    out.append(
        "Once the episode pages exist, [[Special:WantedPages]] keeps its own "
        "version of this ranking automatically, across the whole wiki. What it "
        "will not tell you is which shows were talking about somebody, which "
        "is why this page also exists.\n")
    out.append("[[Category:PickiPedia documentation]]")
    return "\n".join(out)


def main():
    episodes = json.load(sys.stdin)
    wanted = collect(episodes)
    print(f"{len(wanted)} distinct subjects; checking which have pages...",
          file=sys.stderr)

    have = existing_pages(sorted(wanted))
    missing = [n for n in wanted if n not in have]
    print(f"  {len(have)} already have a page, {len(missing)} do not",
          file=sys.stderr)

    print(render(wanted, missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
