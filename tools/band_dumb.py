#!/usr/bin/env python3
"""
A band, read dumbly: a prototype for the band model (Justin, #connectome, 27 Nov 2026, 18:15Z: "it's time for a
model of a band ... A good band to consider for building out the band model with Artificial Dumb are The Travelin'
McCourys").

Two kinds of fact, never allowed to answer for each other:

  a stint      someone was a member of the band from one date until another: a claim about the band, with a source
               (what a {{Band member}} line on the band's page would say)
  an ensemble  who a source names on one stage on one night: what the tape reader (lma_lineup.py) already reads

From the stints alone come the band's lineups (its "versions"): the stretches of time over which the roster did not
change. Nobody writes a lineup down; it can't drift from the stints. Then every tape billed to the band is set
beside the lineup of its night, and what doesn't agree is listed for a person. Nothing is written anywhere.

    python3 band_dumb.py band.json md/ names.txt [--svg out.svg] [--json out.json]
    python3 band_dumb.py "The Travelin' McCourys" md/ names.txt ...     the band as its PickiPedia page has it, verified

    band.json    {name, billed_as: [...], stints: [{name, plays, from, until, source, also_written: [...]}], today,
                 records: [[title, date]]}: band_mccourys.json is the trial's, each stint from the source it names.
                 A first argument that is no file is a page's title: its verified {{Band member}} lines, as the
                 store reads them (connectome_store.band_page). The page is the record; the file is a way to try
                 stints nobody has verified yet.
    md/          archive.org's metadata for each tape, one <identifier>.json a tape (the walk's and the store's cache)
    names.txt    the names the tape reader looks for (connectome_names.txt)

What a lineup is, and who was in the band on a day, are the store's (connectome_store.lineups, lineup_at): one
reading of a stint's dates, here and in the graphs.

Run from its first trial in a Mood's own directory until 28 Nov 2026, when re's namespace audit found it in no
repository (Cryptograss:Namespace audit/26510549, row E4).
"""
import datetime
import json
import sys
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

import connectome_store
import lma_lineup
from connectome_store import lineup_at, lineups

ON_STAGE = {"song", "song?", "show", "stage"}
WIKI_RAW = "https://pickipedia.xyz/index.php?action=raw&title="
UA = "PickiPedia-band-dumb/1.0"


def from_page(title, text):
    """A band as this tool takes it, from its page's wikitext: the verified stints and the names it is billed as.
    None where the page has nothing verified of a band on it."""
    page = connectome_store.band_page(title, text)
    if page is None:
        return None
    return {"name": page["band"], "kind": page["kind"], "offshoot_of": page["offshoot_of"], "billed_as": page["billed_as"],
            "stints": page["stints"], "unread": page["unread"]}


def load_band(arg, get=None):
    """band.json where the argument is a file; else the page of that title, fetched as it stands now."""
    if Path(arg).is_file():
        return json.loads(Path(arg).read_text())
    get = get or (lambda title: urlopen(Request(WIKI_RAW + quote(title.replace(" ", "_")), headers={"User-Agent": UA}),
                                        timeout=30).read().decode("utf-8"))
    return from_page(arg, get(arg))


def on_stage(item, names, written):
    """{name: scopes} for everyone the tape's own words put on its stage, each under the name their page has."""
    found = lma_lineup.read_item(item, names)
    out = {}
    for name, rows in found.items():
        scopes = {row[2] for row in rows if row[2] in ON_STAGE and row[0] in ("description", "notes", "files")}
        if scopes:
            out.setdefault(written.get(name, name), set()).update(scopes)
    return out


def audit(band, items, names):
    """One row for each tape billed to the band: the lineup of its night beside who the tape names."""
    written = {alias: s["name"] for s in band["stints"] for alias in s.get("also_written", [])}
    written.update(band.get("also_written", {}))
    names = sorted(set(names) | {s["name"] for s in band["stints"]} | set(written))
    rows = []
    for item in items:
        m = item.get("metadata", {})
        date = str(m.get("date") or "")[:10]
        title = m.get("title") if isinstance(m.get("title"), str) else " / ".join(m.get("title") or [])
        stage = on_stage(item, names, written)
        roster = sorted(lineup_at(band["stints"], date))
        said = sorted(n for n in roster if n in stage)
        unsaid = sorted(n for n in roster if n not in stage)
        others = sorted(n for n in stage if n not in roster)
        flags = []
        billed = [band["name"]] + band.get("billed_as", [])
        if not any(b.lower().replace("the ", "") in title.lower() for b in billed):
            flags.append("the tape's own title names another act")
        if stage and roster and len(said) * 2 < len(roster):
            flags.append(f"names {len(said)} of the {len(roster)} members")
        for n in others:
            past = [s for s in band["stints"] if s["name"] == n]
            if past:
                flags.append(f"{n} named outside their stint")
        rows.append({"id": m.get("identifier"), "date": date, "title": title, "roster": roster, "said": said,
                     "unsaid": unsaid, "others": others, "flags": flags})
    return sorted(rows, key=lambda r: (r["date"], r["id"]))


def candidates(band, rows):
    """Who the tapes name again and again without a stint: for a person to look into, never a stint by itself."""
    members = {s["name"] for s in band["stints"]}
    seen = {}
    for r in rows:
        if "the tape's own title names another act" in r["flags"]:
            continue
        for n in r["others"]:
            if n not in members:
                seen.setdefault(n, []).append(r["date"])
    return sorted(((n, len(d), min(d), max(d)) for n, d in seen.items()), key=lambda x: -x[1])


# ---------------------------------------------------------------------------------------------------------------
# The timeline: a row for each member, a bar for each stint, coloured by what they play; and on each bar a tick for
# each tape that names them. The bar is what the band's page claims; the ticks are what a taper wrote down.
# ---------------------------------------------------------------------------------------------------------------

# The wiki's instrument families, in the order a bluegrass band is introduced. Not gold: gold means Permanent.
COLOURS = {"guitar": "#2f6f9f", "mandolin": "#3f8f5f", "banjo": "#b5532a", "fiddle": "#7d4f9f", "bass": "#5f5f5f",
           "dobro": "#1f7f8f", "vocals": "#8f6f2f"}


def year_of(text):
    parts = (text.split("-") + ["1", "1"])[:3]
    return int(parts[0]) + (int(parts[1] or 1) - 1) / 12 + (int(parts[2] or 1) - 1) / 365


def esc(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def timeline_svg(band, rows, today, records=()):
    stints = band["stints"]
    dates = [r["date"] for r in rows if r["date"]] + [s[k] for s in stints for k in ("from", "until") if s.get(k)]
    first, last = int(year_of(min(dates))), int(year_of(today)) + 1
    left, right, top, row_h = 150, 28, 46, 30
    width = 860
    scale = (width - left - right) / (last - first)
    x = lambda text: left + (year_of(text) - first) * scale
    height = top + row_h * len(stints) + 86
    seen = {}
    for r in rows:
        if "the tape's own title names another act" in r["flags"]:
            continue
        for n in r["said"] + r["others"]:
            seen.setdefault(n, []).append(r["date"])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'font-family="Georgia, serif" font-size="13" role="img" aria-label="{esc(band["name"])}: members over time">',
           '<defs><linearGradient id="unsourced" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/>'
           '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>',
           f'<rect width="{width}" height="{height}" fill="#fbf8f1"/>',
           f'<text x="{left}" y="22" font-size="16" font-weight="bold" fill="#2b1d12">{esc(band["name"])}</text>']
    for y in range(first, last + 1):
        big = y % 5 == 0
        out.append(f'<line x1="{left + (y - first) * scale:.1f}" y1="{top - 6}" x2="{left + (y - first) * scale:.1f}" '
                   f'y2="{top + row_h * len(stints)}" stroke="#d9cdb8" stroke-width="{1 if big else 0.5}"/>')
        if big or y in (first, last):
            out.append(f'<text x="{left + (y - first) * scale:.1f}" y="{top + row_h * len(stints) + 16}" text-anchor="middle" '
                       f'fill="#6b5a45" font-size="11">{y}</text>')
    for i, s in enumerate(stints):
        yy = top + i * row_h
        colour = COLOURS.get(s.get("plays", ""), "#888")
        x1 = x(s["from"]) if s.get("from") else left
        x2 = x(s["until"]) if s.get("until") else x(today)
        out.append(f'<text x="{left - 10}" y="{yy + 17}" text-anchor="end" fill="#2b1d12">{esc(s["name"])}</text>')
        tip = f'{s["name"]}, {s.get("plays", "")}: {s.get("from") or "from: no source says"} to {s.get("until") or "now"}'
        out.append(f'<g><title>{esc(tip)}</title><rect x="{x1:.1f}" y="{yy + 5}" width="{max(2, x2 - x1):.1f}" height="16" rx="3" fill="{colour}" opacity="0.82"/>')
        if not s.get("from"):                                 # no source gives the start: the bar fades in, it has no left end
            out.append(f'<rect x="{x1:.1f}" y="{yy + 4}" width="{min(70, x2 - x1):.1f}" height="18" fill="url(#unsourced)"/>')
        out.append('</g>')
        for d in sorted(set(seen.get(s["name"], []))):
            inside = (not s.get("from") or s["from"] <= d) and (not s.get("until") or d < s["until"])
            out.append(f'<line x1="{x(d):.1f}" y1="{yy + 1}" x2="{x(d):.1f}" y2="{yy + 25}" stroke="{"#2b1d12" if inside else "#c0392b"}" '
                       f'stroke-width="1.6"><title>{esc(s["name"])} named on the tape of {d}</title></line>')
    base = top + row_h * len(stints)
    for title, date in records:
        out.append(f'<line x1="{x(date):.1f}" y1="{top - 6}" x2="{x(date):.1f}" y2="{base}" stroke="#2b1d12" stroke-width="1" stroke-dasharray="3 3"/>'
                   f'<text x="{x(date) + 4:.1f}" y="{top - 9}" font-size="10" font-style="italic" fill="#2b1d12">{esc(title)}</text>')
    ly = base + 40
    lx = left
    for inst in dict.fromkeys(s.get("plays", "") for s in stints):
        out.append(f'<rect x="{lx}" y="{ly - 10}" width="14" height="11" rx="2" fill="{COLOURS.get(inst, "#888")}" opacity="0.82"/>'
                   f'<text x="{lx + 19}" y="{ly}" font-size="11" fill="#2b1d12">{esc(inst)}</text>')
        lx += 30 + 7 * len(inst)
    out.append(f'<line x1="{left}" y1="{ly + 12}" x2="{left}" y2="{ly + 26}" stroke="#2b1d12" stroke-width="1.6"/>'
               f'<text x="{left + 8}" y="{ly + 23}" font-size="11" fill="#2b1d12">a tape that names them (red: outside the stint) · a bar that fades in: no source gives the start</text>')
    out.append('</svg>')
    return "\n".join(out)


def main(argv, today=None, get=None):
    today = today or datetime.date.today().isoformat()
    band = load_band(argv[1], get)
    if band is None:
        print(f"{argv[1]}: no file of that name, and no page with a verified band on it")
        return 1
    items = [json.loads(p.read_text()) for p in sorted(Path(argv[2]).glob("*.json"))]
    creators = [band["name"]] + band.get("billed_as", [])
    def by(item):
        c = item.get("metadata", {}).get("creator")
        return (c[0] if isinstance(c, list) else c) in creators
    items = [i for i in items if by(i)]
    names = [l.strip() for l in Path(argv[3]).read_text().splitlines() if l.strip() and not l.startswith("#")]
    rows = audit(band, items, names)
    out = {"band": band["name"], "lineups": lineups(band["stints"]), "tapes": rows, "candidates": candidates(band, rows)}
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(json.dumps(out, indent=1))
    if "--svg" in argv:
        Path(argv[argv.index("--svg") + 1]).write_text(timeline_svg(band, rows, band.get("today") or today, band.get("records", [])))
    print(f'{band["name"]}: {len(band["stints"])} stints, {len(out["lineups"])} lineups, {len(rows)} tapes')
    for a, b, who in out["lineups"]:
        print(f'  lineup {a or "?"} to {b or "now"}: {", ".join(who)}')
    for r in rows:
        print(f'  {r["date"]} {r["id"][:42]:42} said {len(r["said"])}/{len(r["roster"])}'
              + (f' | unsaid: {", ".join(r["unsaid"])}' if r["unsaid"] else '')
              + (f' | others: {", ".join(r["others"])}' if r["others"] else '')
              + (f' | FLAG: {"; ".join(r["flags"])}' if r["flags"] else ''))
    for n, k, a, b in out["candidates"]:
        print(f'  not a member, named on {k} tape(s), {a} to {b}: {n}')
    for line in band.get("unread", []):
        print(f'  a stint with dates nobody can read, left out: {line}')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
