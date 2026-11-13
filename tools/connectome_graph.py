#!/usr/bin/env python3
"""
Connectome graph: the one file the big graph (assets/connectome/) draws from.

Built beside the cards, by connectome_card.py, from the same store and the same
names, so a card and the graph it opens never disagree. (Justin, #connectome,
13 Nov 2026: the big graph, again from scratch.)

graph.json:
  people    [name, has a page (1/0), instrument]; a picker's place in this list is
            its number everywhere below. The instrument is the wiki's own
            (Primary instrument), or "" when the wiki doesn't say
  music     [id, kind, artist, date, title, tier, source, page]: a record or a show.
            source is where a reader can check it; page is its wiki page, "" without one
  cast      beside each music: [picker, roles as the source wrote them], who is on it
  ties      [a, b, [[music, how, weight, songs], ...]]: each time two pickers are on
            one record or show; one entry per record or show, the closest way the
            sources put them together
  songs     song title -> its wiki page, for the songs that have one
  featured  this month's featured pickers (Cryptograss:Connectome/Featured), and month

how:    3 the same track, 2 the same stage, 1 the same record (no source puts them
        on the same track). Only 3 and 2 are "played with".

tier (PickiPedia:Release_Types), read from the source and never guessed:
        2 Permanent Release: a Live Music Archive tape, or one of cryptograss's
          Creative Commons records
        1 Full Release: the source lists it on a carrier with no DRM (a CD that isn't
          marked copy-protected, vinyl, tape)
        0 not known to be either: counted, and not named up front

weight: 1 / (how many were there - 1), Newman's collaboration weight (Phys. Rev. E 64,
        016132, 2001): a duet ties two pickers closer than a seat in a choir of
        eighty does. "There" is the smallest thing the sources put both in: a track,
        or else the stage, or else the record. On a record each track they share
        counts, since each was cut on its own. A show counts once, however many of its
        songs they share, so a taper who notes a guest on every song doesn't outweigh
        one who names the band once. A pair's tie is the sum over all of them.
"""
import re
from collections import defaultdict

PERMANENT = ('lma:', 'arthel:')
HOW = {'track': 3, 'show': 2, 'record': 1}
ON_STAGE = {'song', 'song?', 'show', 'stage', 'track', 'release'}   # a credit that puts the picker in the music

# Carriers with no DRM on them. A CD is Red Book audio unless its source says otherwise;
# SACD, DVD, Blu-ray and MiniDisc carry copy controls; "File" and "Digital Media" don't
# say which kind of file, so they stay unknown.
OPEN_CARRIERS = {'cd', 'cdr', 'cd-r', 'hdcd', 'enhanced cd', 'vinyl', 'shellac', 'cassette', 'lathe cut',
                 'flexi-disc', 'acetate', 'reel-to-reel', '8-track cartridge'}

SOURCE = {'discogs': 'https://www.discogs.com/release/', 'mb': 'https://musicbrainz.org/release/',
          'lma': 'https://archive.org/details/'}


def tier(target_id, formats=()):
    """2 Permanent, 1 Full, 0 not known: see the module's notes."""
    if target_id.startswith(PERMANENT):
        return 2
    for f in formats or ():
        name, _, said = f.partition(' (')
        name = name.strip().lower()
        if 'copy protected' in said.lower():
            continue
        if name in OPEN_CARRIERS or name.endswith(' vinyl'):
            return 1
    return 0


def source_url(target_id, sources=()):
    """Where a reader can check a record or a show: its own page at the source."""
    kind, _, ident = target_id.partition(':')
    if kind in SOURCE:
        return SOURCE[kind] + ident
    return sorted(sources)[0] if sources else ''


def casts(pairs):
    """How many were there, for each thing two pickers can share: a track, a stage, a record."""
    track, stage, record = defaultdict(set), defaultdict(set), defaultdict(set)
    for p in pairs:
        both = {p['a'], p['b']}
        if p['kind'] == 'track':
            for t in p.get('tracks', []):
                track[(p['target'],) + tuple(t)] |= both
        if p['kind'] == 'show':
            stage[p['target']] |= both
        if p['kind'] in ('track', 'record'):
            record[p['target']] |= both
    return track, stage, record


def weight(p, track, stage, record, show=False):
    """How much one record or show ties the two: see the module's notes. show: the target is a show."""
    def one(n):
        return 1.0 / max(1, n - 1)
    if p['kind'] == 'track':
        each = [one(len(track[(p['target'],) + tuple(t)])) for t in p.get('tracks', [])] or [one(2)]
        return max(each) if show else sum(each)
    if p['kind'] == 'show':
        return one(len(stage[p['target']]))
    return one(len(record[p['target']]))


def export(pairs, targets, credits, has_page, inst, featured, month, song_title, pages, built):
    """
    pairs     the store's pairs, each name already as the wiki knows it
    targets   id -> {kind, title, date, artist, grp, formats: [..]}
    credits   [(person, roles, target, scope, source)], names as the wiki knows them
    has_page  name -> bool;  inst: name -> instrument (the wiki's)
    song_title(target, track) -> the song's name, as the cards name it
    pages     title -> the wiki page's URL, for record and Song: pages that exist
    """
    track, stage, record = casts(pairs)

    # One entry per pair per record or show: the closest way they're together there.
    best = {}
    for p in pairs:
        if p['kind'] not in HOW:
            continue                                        # one show, but not on its stage together
        t = targets.get(p['target'], {})
        key = (p['a'], p['b'], t.get('grp') or p['target'])
        cand = (HOW[p['kind']], tier(p['target'], t.get('formats')),
                weight(p, track, stage, record, t.get('kind') == 'show'), p['target'])
        if key not in best or cand[:3] > best[key][0][:3]:
            best[key] = (cand, p)

    names = sorted({n for a, b, _ in best for n in (a, b)} | set(featured))
    pid = {n: i for i, n in enumerate(names)}
    used = sorted({c[3] for c, _ in best.values()})
    mid = {t: i for i, t in enumerate(used)}

    sources, cast = defaultdict(set), defaultdict(dict)
    for person, roles, target, scope, source in credits:
        if target not in mid:
            continue
        sources[target].add(source)
        if scope in ON_STAGE and person in pid:
            said = cast[target].setdefault(person, [])
            for r in (roles or '').split(';'):
                r = r.strip()
                if r and r.lower() not in {x.lower() for x in said}:
                    said.append(r)

    music = []
    for t in used:
        d = targets.get(t, {})
        page = pages.get(d.get('title', '')) if t.startswith('arthel:') and d.get('kind') == 'record' else ''
        music.append([t, d.get('kind', ''), d.get('artist', ''), d.get('date', ''), d.get('title', ''),
                      tier(t, d.get('formats')), source_url(t, sources[t]), page or ''])

    songs = {}
    ties = defaultdict(list)
    for (a, b, _), (cand, p) in sorted(best.items()):
        titles = []
        for tr in p.get('tracks', []):
            s = song_title(p['target'], tr)
            if s and s not in titles:
                titles.append(s)
                if pages.get('Song:' + s):
                    songs[s] = pages['Song:' + s]
        ties[(pid[a], pid[b])].append([mid[p['target']], cand[0], round(cand[2], 4), titles])

    return {
        'v': 1, 'built': built, 'month': month, 'featured': [pid[f] for f in featured if f in pid],
        'people': [[n, 1 if has_page(n) else 0, inst.get(n, '')] for n in names],
        'music': music,
        'cast': [[[pid[n], '; '.join(r)] for n, r in sorted(cast[t].items())] for t in used],
        'ties': [[a, b, sorted(ev, key=lambda e: (-e[1], -e[2], e[0]))] for (a, b), ev in sorted(ties.items())],
        'songs': dict(sorted(songs.items())),
    }


def arthel_pages(pairs, targets, song_title):
    """The wiki titles worth asking after: cryptograss's records, and the songs on them."""
    want = set()
    for p in pairs:
        if not p['target'].startswith('arthel:'):
            continue
        d = targets.get(p['target'], {})
        if d.get('kind') == 'record' and d.get('title'):
            want.add(d['title'])
        for tr in p.get('tracks', []):
            s = song_title(p['target'], tr)
            if s and not re.search(r'[\[\]{}|#<>]', s):
                want.add('Song:' + s)
    return sorted(want)
