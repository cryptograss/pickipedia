#!/usr/bin/env python3
"""
A band's page, written dumbly from MusicBrainz (Justin, #connectome, 27 Nov 2026, 21:27Z: "you can just go ahead and
make the band's pages as needed").

    python3 band_page_dumb.py [--out DIR] "Della Mae" ["Another Band" ...]

writes each page's wikitext to DIR/<name>.wiki (DIR is band-pages unless said) and nothing to the wiki: whoever
runs it reads the file and puts it on the page, where each line waits for a person as any bot's claim does.

For each name: the one MusicBrainz artist of that name that is a group (two of one name: nothing, and it says so);
its "member of band" relationships, each a {{Band member}} line with the instrument, the years and whether it has
ended, as MusicBrainz gives them (one who has left with no year given gets no line: a line with no end would say
they are still in it); its official homepage, where it lists one. Nothing is inferred: no kind, no leader,
no offshoot. A member MusicBrainz gives two instruments in one relationship gets one line naming both, commas
between (Justin, #connectome, 28 Nov 2026: doubling is one stint, not two); two relationships stay two lines. The
source of every line is the band's relationships page at MusicBrainz, and `checked` is the day this ran.

An instrument is written as PickiPedia writes it where INSTRUMENTS says how; any other as MusicBrainz has it.

Run from a Mood's own directory until 28 Nov 2026, when re's namespace audit found it in no repository
(Cryptograss:Namespace audit/26510549, row E4). By then it had written the members of Della Mae, 10 String
Symphony, The Del McCoury Band and The McCrary Sisters.
"""
import datetime
import os
import sys

import rambler
import recording_credits as sideman

INSTRUMENTS = {"double bass": "bass", "five-string banjo": "banjo", "steel-string acoustic guitar": "guitar",
               "acoustic guitar": "guitar", "violin": "fiddle", "resonator guitar": "dobro", "lead vocals": "vocals",
               "background vocals": "vocals", "bass guitar": "bass", "electric bass guitar": "bass",
               "acoustic bass guitar": "bass", "upright bass": "bass"}
NOT_A_CHAIR = {"original", "founder", "eponymous", "minor", "additional", "guest", "solo"}


def facts(name):
    found = [(i, n) for i, n in rambler.mb_artists_named(name)]
    groups = []
    for mbid, mb_name in found:
        a = sideman.mb_get(f"artist/{mbid}", inc="artist-rels+url-rels")
        if a.get("type") in ("Group", "Orchestra", "Choir"):
            groups.append(a)
    if len(groups) != 1:
        return None, f"{name}: MusicBrainz has {len(groups)} groups of that name ({len(found)} artists)"
    return groups[0], ""


def page(name, a, today):
    src = f"https://musicbrainz.org/artist/{a['id']}/relationships"
    home = next((r["url"]["resource"] for r in a.get("relations", []) if r.get("type") == "official homepage"
                 and not r.get("ended")), "")
    lines = ["{{BandInfo" + (f"\n|website={home}" if home else "") + "\n}}"]
    members = [r for r in a.get("relations", []) if r.get("type") == "member of band" and r.get("direction") == "backward"]
    members.sort(key=lambda r: (r.get("begin") or "0000", r.get("end") or "9999", r["artist"]["name"]))
    stints, left = [], []
    for r in members:
        if r.get("ended") and not r.get("end"):
            left.append(r["artist"]["name"])             # gone, and no year: a line with no end would say "still in it"
            continue
        chairs = [INSTRUMENTS.get(x, x) for x in r.get("attributes") or [] if x not in NOT_A_CHAIR]
        plays = ", ".join(dict.fromkeys(chairs))
        parts = [r["artist"]["name"]] + ([plays] if plays else [])
        if r.get("begin"):
            parts.append("from=" + r["begin"])
        if r.get("end"):
            parts.append("until=" + r["end"])
        stints.append("{{Band member|" + "|".join(parts) + f"|source={src}|checked={today}" + "}}")
    began = (a.get("life-span") or {}).get("begin")
    if stints:
        lines += ["", "== Members =="] + stints + ["", "The members, what they play and the years are as [" + src
                  + " MusicBrainz lists them], read " + today + "."
                  + (" It also lists " + " and ".join(left) + " as having left, with no year, so no line is written."
                     if left else "")]
    else:
        lines += ["", "[" + src + " MusicBrainz] lists no members for this band, read " + today + "."]
    if began:
        lines += ["", f"MusicBrainz gives {began} as the year the band began."]
    return "\n".join(lines), len(stints)


def main(argv, today=None):
    today = today or datetime.date.today().isoformat()
    args = list(argv[1:])
    out_dir = "band-pages"
    if "--out" in args:
        i = args.index("--out")
        out_dir = args[i + 1]
        del args[i:i + 2]
    if not args:
        print(__doc__)
        return 2
    os.makedirs(out_dir, exist_ok=True)
    for name in args:
        a, why = facts(name)
        if a is None:
            print(why)
            continue
        text, n = page(name, a, today)
        out = os.path.join(out_dir, name.replace("/", "_") + ".wiki")
        with open(out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"{name}: MusicBrainz {a['name']} ({a.get('type')}), {a['id']}; {n} stints -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
