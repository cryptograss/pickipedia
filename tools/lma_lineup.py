#!/usr/bin/env python3
"""
LMA lineup: who played, read out of a Live Music Archive item. A prototype.

    python3 tools/lma_lineup.py SGP2025-07-05 --name "Kyle Tuttle" --name "Molly Tuttle"

An Artificial Dumb reader for the connectome (Justin, #connectome, 9-10 Nov
2026). The archive's tapers write who played in free text, in many shapes:
"Lineup:" lists, "Name - Instrument" lines, footnote marks tied to setlist
songs ("% w/ Kyle Tuttle" under "07. Hobo Song %"), song-inline credits,
"with" lines, prose. Each line that names a person is put into one shape, and
each shape says how far the line reaches:

  song      the line ties the person to songs (a resolved footnote, an inline credit)
  show      on the stage for the show or a set (a lineup, a "with" line)
  stage     introduced on stage; no songs claimed (a banter track)
  bill      the same night, not the same stage ("opened", "also performing")
  festival  a festival's roster, pasted onto a set ("Artists at Large")
  none      names someone, but not as a player (taper, thanks, songwriter)
  song?     "Song (Name)": a guest or the songwriter; the line can't say which

A line no shape fits comes back with shape None, verbatim, for a person.
Names are copied as written and never merged. Nothing is written anywhere.

Measured 10 Nov 2026 on lines that name one of 115 people from Justin's and
Vickie Vaughn's circles: 98.1% of 1,630 lines read on the 1,030 items the
shapes were written against, and 94.7% of 436 lines on 400 items held out.
"Read" means a shape was assigned, not that it was right: whether each shape
is right is for a person to check on a sample.
"""
import argparse
import html
import json
import re
import sys
from urllib.request import Request, urlopen

MARKS = r"(?:\*{1,3}|\^{1,2}|#{1,2}|\${1,2}|%{1,2}|@{1,2}|&{1,2}|~{1,2}|§|\+{1,2}|!{1,2}|†|‡|\(\d{1,2}\)|\[\d{1,2}\]|\d{1,2}\))"
INSTR = (r"(?<=\()(?:g|m|b|f|bj|v|bs|dob|mand|gtr|vcl)(?=\))|banjo|banjer|guitar|mandolin|mando|fiddle|violin|viola|cello|bass|upright|dobro|resonator|"
         r"steel|vocals?|vox|harmony|harmonica|keys|keyboards?|piano|organ|b3|drums?|percussion|"
         r"sax(?:ophone)?|trumpet|trombone|horns?|flute|accordion|washboard|spoons|bones|ukulele|"
         r"clarinet|whistle|pipes|harp|melodica|synth|lap steel|pedal steel|slide")
HEADER = re.compile(r"(?i)^(?:the\s+)?(lineup|line-up|line up|personnel|band|musicians|players|"
                    r"guests?|special guests?|featuring|with|the guests|sit-?ins?|also appearing)\b[^a-z0-9]*$")
SETLIST_LINE = re.compile(r"^(?:d\d+t\d+|[a-z]?\d{1,3})\s*[.)\-:]?\s*[A-Za-z\"'(]|^(?:encore|set\s*[12i]+)\b", re.I)
TRAP_FESTIVAL = re.compile(r"(?i)^artists?\s+at\s+large\b")
TRAP_BILL = re.compile(r"(?i)\b(opened|opening(?: set| act)?|openers?|support(?:ed)? by|headlin)")
STAGE = re.compile(r"(?i)\b(intro|introduction|banter|tuning|band intros?)\b")


def lines_of(value):
    s = value if isinstance(value, str) else "\n".join(value or [])
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|<p[^>]*>|<div[^>]*>|</li>|<li[^>]*>|</tr>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return [l.strip() for l in s.replace("\r", "\n").split("\n") if l.strip()]


def footnote_mark(line):
    m = re.match(rf"^\s*({MARKS})\s*(?:[-=:–—]\s*)?(.+)$", line)
    return (m.group(1), m.group(2)) if m and not SETLIST_LINE.match(line) else None


def songs_marked(lines, mark):
    esc = re.escape(mark.strip("()[]") if mark[0] in "([" else mark)
    if mark[0] in "([":
        pat = re.compile(rf"[(\[]{esc}[)\]]")
    elif mark[0].isdigit():
        pat = re.compile(rf"\({esc}\b")
    else:
        # the mark, not part of a longer run of the same symbol (* vs **)
        sym = re.escape(mark[0])
        pat = re.compile(rf"(?<!{sym}){esc}(?!{sym})")
    out = []
    for l in lines:
        if footnote_mark(l):
            continue
        if pat.search(l):
            out.append(re.sub(rf"\s*{MARKS}+\s*$|\s*{MARKS}(?=\s|$)", "", l).strip(" >"))
    return out


def classify(lines, i, name="", creator=""):
    """The shape of lines[i], which contains name. Returns (shape, scope, detail) or None."""
    l = lines[i]
    core = re.sub(r"(?i)^the\s+|[:.]$|\s+(?:and friends|band)$", "", l.strip())
    if creator and (core.lower() in creator.lower() or creator.lower() in core.lower()) and len(core) <= len(creator) + 25:
        return ("band name", "show", l)
    # Not connections, though they name someone: say so, so a person never ticks them.
    if re.search(r"(?i)\b(thanks?|thank you)\b.*\b(for|to)\b|\ballowing (?:audio )?(?:recording|taping)\b", l):
        return ("thanks / permission", "none", l)
    if re.search(r"(?i)^(?:taper|taped by|recorded by|transfer(?:red)?(?: by)?|conversion by|shn conversion|mixed by|mastered by|seeded by|edited by|lineage|source)\b|\b(?:conversion|transfer|seeded|edited)\s+by\b", l):
        return ("crew (taper, transfer)", "none", l)
    if re.search(r"(?i)\b(other acts|also on the bill|before any of the others)\b", l):
        return ("same bill", "bill", l)
    if re.search(r"(?i)\b(written|composed|penned)\s+by\b|original artist|\bcover(?:ed)? of\b", l):
        return ("songwriter", "none", l)
    if re.search(r"(?i)\b(check out|online at|buy one of|support (?:the|this) (?:band|artist)|free .* concerts|available for download)\b", l):
        return ("promotion", "none", l)
    if re.search(r"(?i)\b(filler|bonus)\b.*\bfrom\b|\(on bt\.etree\.org\)|^barn\d+", l):
        return ("other recording", "none", l)
    if re.search(r"(?i)\.(flac|shn|mp3|wav|ffp|md5)\b|:[0-9a-f]{32}\b", l):
        return ("checksum / file list", "none", l)
    if creator and core.lower().startswith(creator.lower()) and re.search(r"\d{1,4}[/-]\d{1,2}[/-]\d{2,4}|\b(?:19|20)\d\d\b|\blive (?:from|at)\b", l):
        return ("band name", "show", l)
    if re.search(r"(?i)\b(lineup|line-up)\s*:", l) and l.count(",") >= 2:
        return ("festival day lineup", "festival", l)
    if re.search(r"(?i)\b(also performing|in support of|on the bill|same night)\b", l):
        return ("same bill", "bill", l)
    if re.search(r"(?i)\(([^()]*/[^()]*)\)", l) and re.search(r"(?i)\b(band|revival|boys|project)\b", l) and name and name.lower() in re.search(r"\(([^()]*)\)", l).group(1).lower():
        return ("affiliation", "none", l)
    if re.search(r"(?i)\b(billed as|feat\s*:|featuring\s*:)", l):
        return ("billing", "show", l)
    if re.search(r"(?i)\b(enter|welcome|introducing)\s+[A-Z]", l) or re.search(r"(?i)\[\s*welcome\b", l):
        return ("banter track", "stage", l)
    if re.search(r"(?i)\b(sitting in|sat in|played the whole show|for most of the show|whole show|entire show)\b", l):
        return ("prose", "show", l)
    if re.match(r"^[^,]{3,40}(?:,\s*[^,]{3,40}){1,}(?:,?\s*(?:and|&)\s+[^,]{3,40})?\s*(?:trio|duo|quartet|band)?\.?$", l, re.I) \
            and all(re.match(r"^(?:and |& )?[A-Z][\w.'’-]+(?: [A-Z&][\w.'’-]*){0,3}(?: (?:trio|duo|quartet))?$", p.strip(), re.I) for p in re.split(r",", l)):
        return ("billing names", "show", l)
    if re.search(r"(?i)\b(duo|trio)\b", l) and re.search(r"&|\band\b", l):
        return ("billing names", "show", l)
    m = re.match(r"^(?:\d{1,3}[.)]?\s*)?([^()]+?)\s*\(([^()]+)\)\s*[>*^%#$@&~+]*$", l)
    if m and name and name.lower() in m.group(2).lower() and not re.match(r"(?i)\s*(?:w/|with\b|feat)", m.group(2)):
        # "Song (Name, Name)": a guest or the songwriter; the line alone can't say which
        return ("song parenthetical (guest or writer?)", "song?", l)
    if re.search(r"\s[/|]\s.*\s[/|]\s", l):
        return ("bill list", "bill", l)
    if re.search(r"(?i)\b(intro(?:duction)?|outro|call back|thank you'?s)\b.*\bby\b", l):
        return ("banter track", "stage", l)
    if re.match(r"(?i)^notes?\s*:\s*", l):
        l = re.sub(r"(?i)^notes?\s*:\s*", "", l); lines = lines[:i] + [l] + lines[i+1:]
    # traps first: they look like connections
    for k in range(i, max(-1, i - 6), -1):
        if TRAP_FESTIVAL.match(lines[k]):
            return ("festival roster", "festival", lines[k])
        if lines[k] == "" or (k < i and not re.match(r"^[A-Z][\w.'’ -]+$", lines[k])):
            break
    if TRAP_BILL.search(l) and not re.search(r"(?i)\bw/|\bwith\b.*\bon\b", l):
        return ("same bill", "bill", l)
    fm = footnote_mark(l)
    if fm:
        songs = songs_marked(lines, fm[0])
        return ("footnote", "song" if songs else "show", songs)
    if SETLIST_LINE.match(l) or re.search(r"(?i)\((?:w/|with\b|feat\.?|featuring\b)", l) or re.search(r"(?i)\s[-–]\s*(?:w/|with)\s", l):
        if STAGE.search(l) and not re.search(r"(?i)\bw/|\bwith\b", l):
            return ("banter track", "stage", l)
        return ("song-inline", "song", l)
    if re.search(rf"(?i)\b({INSTR})\b", l):
        if re.search(rf"(?i)\bon\s+(?!{INSTR}).+?[.]?$", l) and re.search(r"(?i)^with\b|^w/", l) and not re.search(rf"(?i)\bon\s+({INSTR})", l):
            return ("prose", "song", l)
        return ("name-instrument", "show", l)
    if HEADER.match(l):
        return ("header", "show", l)
    for k in range(i - 1, max(-1, i - 15), -1):
        if HEADER.match(lines[k]):
            return ("listed under header", "show", lines[k])
        if SETLIST_LINE.match(lines[k]):
            break
    if re.match(r"(?i)^(with|w/|featuring|feat\.?|ft\.?|special guests?|featured)\b", l) or re.search(r"(?i)\b(?:with|featuring|feat\.?)\s|\bw/\s*[A-Z]", l):
        return ("with-line", "show", l)
    if re.search(r"(?i)\b(sat in|sits in|joined|joins|guest|guests)\b", l):
        return ("prose", "show", l)
    if re.match(r"^[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+){1,3}$", l):
        # a bare name on its own line, in a block of bare names: a list with no header
        nb = [x for x in lines[max(0, i - 3):i + 4] if re.match(r"^[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+){1,3}$", x)]
        if len(nb) >= 3:
            return ("bare name list", "show", l)
    return None


def read_item(j, names):
    """{name: [(where, shape, scope, detail)]} for each known name in the item.
    A name with no shape is listed with shape None."""
    m = j.get("metadata", {})
    out = {}
    creator = m.get("creator"); creator = creator[0] if isinstance(creator, list) else (creator or "")
    fields = [("description", lines_of(m.get("description"))), ("notes", lines_of(m.get("notes")))]
    for where, lines in fields:
        for i, l in enumerate(lines):
            for n in names:
                if n.lower() in l.lower():
                    out.setdefault(n, []).append((where, *(classify(lines, i, n, creator) or (None, None, l))))
    for f in j.get("files", []):
        for key in ("comment", "artist", "creator", "title"):
            v = str(f.get(key, ""))
            for n in names:
                if n.lower() in v.lower():
                    shape = ("file comment", "song", f.get("title") or f["name"]) if key == "comment" else \
                            ("file " + key, "song" if " ft. " in v or " feat" in v.lower() else "show", v)
                    out.setdefault(n, []).append(("files", *shape))
    for key in ("creator", "title", "subject"):
        v = m.get(key)
        v = " / ".join(v) if isinstance(v, list) else str(v or "")
        for n in names:
            if n.lower() in v.lower():
                out.setdefault(n, []).append((key, "item " + key, "show", v))
    return out


ON_STAGE = {"song", "song?", "show", "stage"}


def song_key(text):
    """A song as a footnote, an inline credit or a file title writes it, cut to
    what the three share: '07. Hobo Song %', 'd1t07 Hobo Song (w/ Kyle Tuttle)'
    and 'Hobo Song' all give 'hobosong'."""
    t = re.sub(r"(?i)^\s*(?:d\d+\s*t\d+|[a-z]?\d{1,3})\s*[.)\-:]?\s*", "", str(text))
    t = re.sub(r"(?i)\([^)]*\)|\[[^\]]*\]|\s[-–]\s*(?:w/|with)\s.*$|\bw/.*$", "", t)
    t = re.sub(rf"{MARKS}+", "", t)
    return re.sub(r"[^a-z0-9]", "", t.casefold())


def songs_of(rows):
    """The song keys a person's song-scope readings in one item name."""
    out = set()
    for where, shape, scope, detail in rows:
        if scope == "song":
            for d in detail if isinstance(detail, list) else [detail]:
                k = song_key(d)
                if len(k) >= 3:
                    out.add(k)
    return out


def pairs(found):
    """Each two people read out of one item, and how far the item puts them together:

      song   both are tied to the same song (by its key; see song_key)
      show   both are on the stage that night (song, song?, show or stage scope)
      apart  at least one of them isn't on the stage: a bill, a festival
             roster, a taper, a thank-you, or a line no shape fits

    Returns [{"a", "b", "kind", "songs"}], names sorted, songs as keys.
    """
    out = []
    names = sorted(found)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            shared = sorted(songs_of(found[a]) & songs_of(found[b]))
            sa = {r[2] for r in found[a]}
            sb = {r[2] for r in found[b]}
            kind = "song" if shared else "show" if (sa & ON_STAGE and sb & ON_STAGE) else "apart"
            out.append({"a": a, "b": b, "kind": kind, "songs": shared})
    return out


def fetch(identifier):
    req = Request(f"https://archive.org/metadata/{identifier}",
                  headers={"User-Agent": "pickipedia-lma-lineup/0.1 (https://pickipedia.xyz)"})
    with urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main(argv):
    ap = argparse.ArgumentParser(description="Who played, read out of a Live Music Archive item.")
    ap.add_argument("item", help="an archive.org identifier, or an archive.org/details/... URL")
    ap.add_argument("--name", action="append", required=True, help="a person to look for (repeatable)")
    ap.add_argument("--pairs", action="store_true", help="also say how far the item puts each two of them together")
    args = ap.parse_args(argv[1:])
    ident = re.sub(r"^https?://archive\.org/details/", "", args.item).strip("/")
    found = read_item(fetch(ident), args.name)
    print(f"https://archive.org/details/{ident}")
    for n in args.name:
        for where, shape, scope, detail in found.get(n, []):
            print(f"  {n}: [{scope or '?'}] {shape or 'not read; for a person'} ({where}): {detail}")
        if n not in found:
            print(f"  {n}: not named in this item")
    if args.pairs:
        for p in pairs(found):
            print(f"  {p['a']} + {p['b']}: {p['kind']}" + (f" ({', '.join(p['songs'])})" if p["songs"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
