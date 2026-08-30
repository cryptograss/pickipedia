#!/usr/bin/env python3
"""
Rank the subjects the podcasts talk about that PickiPedia has no page for.

    python3 podcast-most-wanted.py > mostwanted.wiki

Reads the wiki rather than the feeds. Every episode page carries Has topic and
Has podcast, and Semantic MediaWiki reports whether a page-valued property
points at something that exists — so one query answers the whole question, and
the answer reflects what the wiki actually says today, including corrections
somebody made by hand since the last import.

[[Special:WantedPages]] already ranks redlinks across the whole wiki and keeps
doing it for free. What it cannot say is *which shows were talking about
somebody*, or which episodes to listen to before writing about them. That
attribution is the reason this exists, and it is what makes the list a reading
list rather than a to-do list.
"""

import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

API = "https://pickipedia.xyz/api.php"
PAGE_SIZE = 500
TIMEOUT = 60

# Values the title parser yields that are not subjects worth a page.
NOT_A_SUBJECT = {"and more", "more", "others", "etc", "etc."}


def ask(query):
    """Run one SMW #ask, following offsets until the results run out."""
    results, offset = {}, 0
    while True:
        params = urllib.parse.urlencode({
            "action": "ask",
            "query": f"{query}|limit={PAGE_SIZE}|offset={offset}",
            "format": "json",
        })
        with urllib.request.urlopen(f"{API}?{params}", timeout=TIMEOUT) as r:
            data = json.load(r)
        if "error" in data:
            raise SystemExit(f"ask failed: {str(data['error'])[:300]}")
        batch = data.get("query", {}).get("results", {}) or {}
        results.update(batch)
        if len(batch) < PAGE_SIZE:
            return results
        offset += PAGE_SIZE


def collect():
    """
    @return: dict of subject -> {shows, episodes, exists}
    """
    raw = ask("[[Category:Podcast episodes]]|?Has topic|?Has podcast")
    print(f"{len(raw)} episode pages", file=sys.stderr)

    subjects = defaultdict(
        lambda: {"shows": set(), "episodes": [], "exists": False})

    for episode_title, page in raw.items():
        printouts = page.get("printouts", {})
        shows = [s.get("fulltext", "") for s in printouts.get("Has podcast", [])]
        for topic in printouts.get("Has topic", []):
            name = topic.get("fulltext", "").strip()
            if not name or name.lower() in NOT_A_SUBJECT:
                continue
            entry = subjects[name]
            # SMW reports '' for a page-valued property pointing at nothing.
            entry["exists"] = bool(topic.get("exists"))
            entry["shows"].update(s for s in shows if s)
            entry["episodes"].append(episode_title)

    return subjects


def render(subjects):
    missing = {n: e for n, e in subjects.items() if not e["exists"]}
    ranked = sorted(missing,
                    key=lambda n: (-len(missing[n]["episodes"]), n.lower()))
    repeated = [n for n in ranked if len(missing[n]["episodes"]) > 1]
    once = [n for n in ranked if len(missing[n]["episodes"]) == 1]

    total_shows = len({s for e in subjects.values() for s in e["shows"]})
    out = []
    out.append(
        "The people and bands the bluegrass podcasts talk about most, that "
        "PickiPedia has no page for yet.\n")
    out.append(
        f"Not a notability ranking. It counts how often somebody comes up "
        f"across {total_shows} shows and {len(subjects)} distinct subjects — a "
        f"measure of what the music actually talks about rather than of what "
        f"cleared an encyclopedia's bar. It moves as the shows keep "
        f"publishing.\n")
    out.append(
        "Every episode beside a name is a primary source you can cite and a "
        "recording you can listen to first. That is the point of the list: it "
        "is a reading list, not a chore list.\n")

    out.append("== Talked about more than once ==\n")
    out.append('{| class="wikitable sortable"')
    out.append("! Episodes !! Who or what !! Heard on")
    for name in repeated:
        entry = missing[name]
        shows = ", ".join(f"[[{s}]]" for s in sorted(entry["shows"]))
        out.append("|-")
        out.append(f"| {len(entry['episodes'])} || [[{name}]] || {shows}")
    out.append("|}\n")

    out.append("== Mentioned once, not yet reviewed ==\n")
    out.append(
        "Deliberately not linked. A name in two separate episodes is almost "
        "always a real person or band; a name in one is about as likely to be "
        "a fragment of an episode title, or the same person carrying a "
        "description — \"Banjo Legend Tony Trischka\" is [[Tony Trischka]]. "
        "Linking them all would put several hundred junk redlinks on the wiki "
        "and drown [[Special:WantedPages]], which is what makes redlinks "
        "useful in the first place.\n")
    out.append(
        "If you recognise somebody here, they belong in the table above — and "
        "the parser probably wants a pattern on that show's page so the next "
        "run finds them too.\n")
    out.append(" &middot; ".join(once) + "\n")

    out.append("== How this is built ==\n")
    out.append(
        "Generated by <code>tools/podcast-most-wanted.py</code> in "
        "[https://github.com/cryptograss/pickipedia cryptograss/pickipedia], "
        "from a single <code>#ask</code> over <code>Has topic</code> and "
        "<code>Has podcast</code>. It reads this wiki, not the feeds, so a "
        "correction made here is reflected the next time it runs.\n")
    out.append(
        "[[Special:WantedPages]] keeps its own ranking automatically and across "
        "everything, not just podcasts. What it will not tell you is which "
        "shows were talking about somebody, which is why this page also "
        "exists.\n")
    out.append("[[Category:PickiPedia documentation]]")
    return "\n".join(out)


def main():
    subjects = collect()
    missing = sum(1 for e in subjects.values() if not e["exists"])
    print(f"{len(subjects)} distinct subjects, {missing} without a page",
          file=sys.stderr)
    print(render(subjects))
    return 0


if __name__ == "__main__":
    sys.exit(main())
