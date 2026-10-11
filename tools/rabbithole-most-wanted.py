#!/usr/bin/env python3
"""
Rank the people Rabbithole would strand: ensemble members with no page.

    python3 rabbithole-most-wanted.py > mostwanted.wiki

Rabbithole's whole proposition is that you click a name and go somewhere. A
cut where one of the players is a redlink is a cut that plays fine and then
dead-ends — the listener does exactly what the player invited them to do and
lands on a page that does not exist. That is worse than a cut nobody can
reach, because it spends the listener's curiosity and returns nothing.

So this is the list to clear before Rabbithole is pointed at anybody. It is
not "every redlink on the wiki" — [[Special:WantedPages]] already does that,
for free, forever. What it cannot say is which of those redlinks is standing
in the middle of a playable track, or who else was in the room when they
played. That attribution is the reason this exists: it turns a list of missing
pages into a list of sessions somebody was present at, which is what you need
in order to write the page.

One query answers it. Every cut carries Has performer as a page-valued
property, and Semantic MediaWiki reports whether such a value points at
something that exists — so the wiki tells us who is missing without us
guessing from titles, and the answer reflects any page written by hand since
the last import.

A sibling of podcast-most-wanted.py, which does the same job for the subjects
podcasts talk about. Same shape, different question: that one asks who is
being discussed, this one asks who is being heard.
"""

import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

API = "https://pickipedia.xyz/api.php"
PAGE_SIZE = 500
TIMEOUT = 60


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
    Gather cuts and who played on them.

    {{Studio cut}} writes one subobject per musician, so a cut arrives as
    several rows that have to be gathered back together. The subobject key is
    "<composition page>#<hash>", and the cut's own identifier is in Has cut —
    which is the record's name for imported cuts, since the session data they
    came from has no block heights in it.
    """
    raw = ask("[[Has cut::+]][[Has performer::+]]"
              "|?Has cut|?Has performer|?Has instrument")

    cuts = defaultdict(lambda: {"players": {}, "missing": set()})
    for key, value in raw.items():
        composition = key.split("#")[0]
        printouts = value.get("printouts", {})
        cut = (printouts.get("Has cut") or [None])[0]
        instruments = printouts.get("Has instrument") or []

        for performer in printouts.get("Has performer") or []:
            name = performer.get("fulltext")
            if not name:
                continue
            entry = cuts[(composition, cut)]
            entry["players"][name] = ", ".join(instruments)
            # SMW says so; we do not guess from the title.
            if performer.get("exists") != "1":
                entry["missing"].add(name)

    return cuts


def rank(cuts):
    """
    Who to write about first.

    Ordered by how many cuts each missing person stands in the middle of,
    because one page can unblock several tracks, and a page nobody has the
    material to write is worth knowing about either way. Ties go to the name,
    so the list does not reshuffle between runs over nothing.
    """
    blocks = defaultdict(list)
    for (composition, cut), entry in cuts.items():
        for name in entry["missing"]:
            blocks[name].append((composition, cut, entry))

    return sorted(
        blocks.items(),
        key=lambda item: (-len(item[1]), item[0]),
    )


def render(cuts, ranked):
    """The list, as wikitext."""
    blocked = [c for c in cuts.values() if c["missing"]]
    out = []

    out.append("Ensemble members with no page, ranked by how many playable "
               "cuts they stand in the middle of.")
    out.append("")
    out.append(f"Of {len(cuts)} cuts on the wiki, {len(blocked)} would "
               f"dead-end a listener who clicked a name — "
               f"{len(ranked)} people between them.")
    out.append("")

    for name, appearances in ranked:
        out.append(f"=== {name} ===")
        out.append(f"{len(appearances)} "
                   f"cut{'s' if len(appearances) != 1 else ''}:")
        out.append("")
        for composition, cut, entry in sorted(appearances):
            instrument = entry["players"].get(name) or "instrument unrecorded"
            bandmates = sorted(n for n in entry["players"] if n != name)
            out.append(f"* [[{composition}]] "
                       f"{'(' + cut + ')' if cut else ''} — "
                       f"{instrument}")
            if bandmates:
                out.append(f"** with {', '.join(bandmates)}")
        out.append("")

    out.append("----")
    out.append("")
    out.append("Built by <code>tools/rabbithole-most-wanted.py</code> from a "
               "single <code>#ask</code> over <code>Has performer</code>. "
               "The instruments and bandmates come from the same session "
               "data, so this doubles as the material for writing the page: "
               "it says what they played and who they played it with.")

    return "\n".join(out)


def main():
    cuts = collect()
    if not cuts:
        raise SystemExit(
            "no cuts came back. Either Has performer stopped being annotated "
            "or the query is wrong — both are worth knowing, and neither is "
            "an empty most-wanted list."
        )

    ranked = rank(cuts)
    blocked = sum(1 for c in cuts.values() if c["missing"])

    print(render(cuts, ranked))
    print(f"\n{len(cuts)} cuts, {blocked} blocked, {len(ranked)} people",
          file=sys.stderr)


if __name__ == "__main__":
    main()
