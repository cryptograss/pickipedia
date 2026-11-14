#!/usr/bin/env python3
"""
Connectome card: the small graph on a musician's page, drawn from the connectome store.

    python3 tools/connectome_card.py --db connectome.sqlite --pairs pairs.json \\
        --wiki https://pickipedia.xyz/ --out DIR [--only "Kyle Tuttle"] [--today 2026-11-13]

Writes, into DIR:
  cards/<md5 of the page title>.html   one card per musician page the store knows
  graph.json                           the big graph's one file (connectome_graph.py)
  pairs.json                           the store's pairs, each name as the wiki knows it
  names.json                           each of those names -> the spellings the sources used
  cards.json                           what was built, and from what

Justin, #connectome, 13 Nov 2026: the card on every musician page, from the Kyle Tuttle mock.

What a card shows:
  the page's picker at the centre (a rabbit), and a path to each featured picker
  (Cryptograss:Connectome/Featured, the newest month that has begun): one hop is a
  spoke, two hops bend off the middle picker; the closest co-players as small dots,
  named on hover. Only people who played *with* the picker (same track or same show)
  get a dot; a same-record link is drawn only when a featured path needs it.
  The marks are the big graph's (assets/connectome/) and Rabbithole's: one colour, and
  it means one thing. A gold line is a Permanent Release (a Live Music Archive tape, or
  one of cryptograss's Creative Commons records); plain ink is a Full Release (no DRM);
  dotted grey is the rest, counted and not vouched for (PickiPedia:Release_Types;
  connectome_graph.tier reads which from the source). A bigger dot is more times
  together; a hollow dot has no page yet. A table gives the Bacon number to each
  featured picker, with the path on hover.

Names: a source's spelling becomes the page title the wiki resolves it to (a
redirect counts), so "Sam Grisman" and "Samson Grisman" are one picker, as the
wiki says. A spelling with no page stays as the source wrote it.

Every string that reaches the card is escaped here: the wiki puts the card into
the page as HTML, unparsed.
"""
import argparse
import hashlib
import heapq
import json
import math
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from html import escape

import connectome_graph

FEATURED_PAGE = 'Cryptograss:Connectome/Featured'
TEMPLATE = 'Template:MusicianInfo'
VIEWER = '/assets/connectome/'          # the big graph, served beside the wiki
ICON = '/index.php?title=Special:Redirect/file/Instrument-icon-{}.png'
UA = 'PickiPedia-connectome-card/1.0'
# The track a song page plays in Rabbithole: the first parameter of its {{Listen in Rabbithole}}.
LISTEN = re.compile(r'\{\{\s*Listen[ _]in[ _]Rabbithole\s*\|\s*([A-Za-z0-9]{20,})\s*[|}]')

GOLD = '#eda100'                        # a Permanent Release, and nothing else
INK2 = '#52514e'                        # a Full Release
SHUT = '#898781'                        # the rest: counted, not vouched for
PAPER = '#fcfcfb'
INK = '#0b0b0b'
RANK = {'record': 1, 'show': 2, 'track': 3}
WEIGHT = {'track': 1, 'show': 2, 'record': 3}
MAX_CROWD = 12
MAX_DRAWN_HOPS = 2
FS = 22.0                               # font size, in the card's own units (it scales to its box)
C = (320.0, 220.0)                      # the centre

# arthel names a song by its file; where the record's track list calls it something
# else, the record's name wins (4masks, track 10, is "Victory").
ARTHEL_TITLES = {'victory-ff7': 'Victory'}


# ---------------------------------------------------------------------------
# The wiki
# ---------------------------------------------------------------------------

class Wiki:
    """What the card needs from PickiPedia, read through its API."""

    def __init__(self, base):
        self.base = base.rstrip('/') + '/'

    def api(self, **q):
        q['format'] = 'json'
        req = urllib.request.Request(self.base + 'api.php?' + urllib.parse.urlencode(q),
                                     headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)

    def raw(self, title):
        req = urllib.request.Request(self.base + 'index.php?' + urllib.parse.urlencode(
            {'title': title, 'action': 'raw'}), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode('utf-8')

    def resolve(self, names):
        """name -> (the title the wiki shows for it, whether that page exists)."""
        out = {}
        names = sorted(set(names))
        for i in range(0, len(names), 50):
            batch = names[i:i + 50]
            q = self.api(action='query', titles='|'.join(batch), redirects=1)['query']
            norm = {x['from']: x['to'] for x in q.get('normalized', [])}
            red = {x['from']: x['to'] for x in q.get('redirects', [])}
            missing = {p['title'] for p in q.get('pages', {}).values() if 'missing' in p or 'invalid' in p}
            for n in batch:
                t = norm.get(n, n)
                t = red.get(t, t)
                out[n] = (t, t not in missing)
        return out

    def listens(self, titles):
        """title -> the track that page says to play in Rabbithole, for the pages that say one."""
        out = {}
        titles = sorted(set(titles))
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                m = LISTEN.search(revs[0]['slots']['main'].get('content', '') if revs else '')
                if m:
                    out[page['title']] = m.group(1)
        return out

    def musician_pages(self):
        out, cont = [], {}
        while True:
            q = self.api(action='query', list='embeddedin', eititle=TEMPLATE, einamespace=0,
                         eilimit=500, **cont)
            out += [p['title'] for p in q['query']['embeddedin']]
            if 'continue' not in q:
                return out
            cont = {'eicontinue': q['continue']['eicontinue']}

    def instruments(self):
        q = self.api(action='ask', query='[[Primary instrument::+]]|?Primary instrument|limit=1000')
        out = {}
        for row in (q.get('query', {}).get('results') or {}).values():
            v = row['printouts'].get('Primary instrument') or []
            if v:
                out[row['fulltext']] = v[0]['fulltext'].lower()
        return out


def featured_from(wikitext, today):
    """The [[links]] under the newest `== YYYY-MM ==` heading that has begun by today."""
    month = today.strftime('%Y-%m')
    best = None
    for m in re.finditer(r'^==\s*(\d{4}-\d{2})\s*==\s*$(.*?)(?=^==[^=]|\Z)', wikitext, re.M | re.S):
        if m.group(1) <= month and (best is None or m.group(1) > best[0]):
            best = (m.group(1), m.group(2))
    if not best:
        return None, []
    names = re.findall(r'^\*\s*\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]', best[1], re.M)
    return best[0], [n.strip().replace('_', ' ') for n in names]


# ---------------------------------------------------------------------------
# The store, in the wiki's names
# ---------------------------------------------------------------------------

def song(target, t):
    """A track as the card names it: arthel's file names become song titles."""
    source, position, title = (list(t) + ['', '', ''])[:3]
    if target.startswith('arthel:') and title:
        return ARTHEL_TITLES.get(title, title.replace('-', ' ').title())
    return title or re.sub(r'^\d+\s+', '', position or '')


def describe(p, targets):
    """What two played together, in a few words: the songs, then the record or the show."""
    title, when, artist = targets.get(p['target'], (p['target'], '', ''))
    where = f"{artist}, {when}" if p['target'].startswith('lma:') and artist else \
        (title or p['target']) + (f", {when}" if when else '')
    songs = [s for s in (song(p['target'], t) for t in p.get('tracks', [])[:2]) if s]
    return ('“' + '”, “'.join(songs) + '”, ' if songs else '') + where


class Store:
    def __init__(self, pairs, targets, groups, alias, tiers=None):
        """alias: a source's spelling -> the name the card uses. tiers: target -> 2, 1 or 0 (connectome_graph.tier)."""
        self.targets, self.groups = targets, groups
        self.tiers = tiers or {}
        self.raw = defaultdict(set)
        self.pairs = []
        for p in pairs:
            a, b = alias.get(p['a'], p['a']), alias.get(p['b'], p['b'])
            self.raw[a].add(p['a'])
            self.raw[b].add(p['b'])
            if a == b:
                continue                                    # two spellings of one picker
            self.pairs.append(dict(p, a=a, b=b))
        self.by = defaultdict(list)                         # name -> [(other, pair)]
        for p in self.pairs:
            self.by[p['a']].append((p['b'], p))
            self.by[p['b']].append((p['a'], p))

    def evidence(self, x, y=None):
        """Each time x played with y (or with anyone): one per show or record, its closest kind."""
        ev = defaultdict(dict)
        for o, p in self.by[x]:
            if p['kind'] not in RANK or (y is not None and o != y):
                continue
            g = self.groups.get(p['target'], p['target'])
            cur = ev[o].get(g)
            if cur is None or RANK[p['kind']] > RANK[cur['kind']]:
                ev[o][g] = {'kind': p['kind'], 'text': describe(p, self.targets), 'target': p['target'],
                            'tier': self.tiers.get(p['target'], connectome_graph.tier(p['target']))}
        out = {}
        for o, gs in ev.items():
            lst = sorted(gs.values(), key=lambda e: (-e['tier'], -RANK[e['kind']], e['text']))
            with_ = [e for e in lst if e['kind'] != 'record'] or lst     # played with, when they have
            out[o] = {'list': lst, 'kind': max((e['kind'] for e in lst), key=RANK.get),
                      'tier': max(e['tier'] for e in with_)}
        return out if y is None else out.get(y)

    def path(self, s, t):
        """Fewest hops first; among those, the closest links. Same-record counts; same-show-apart doesn't."""
        if s == t:
            return []
        dist, prev, heap = {s: (0, 0)}, {}, [(0, 0, s)]
        while heap:
            h, w, u = heapq.heappop(heap)
            if (h, w) > dist.get(u, (h, w)):
                continue
            if u == t:
                break
            best = {}
            for o, p in self.by[u]:
                if p['kind'] in WEIGHT and (o not in best or WEIGHT[p['kind']] < best[o]):
                    best[o] = WEIGHT[p['kind']]
            for o, k in best.items():
                c = (h + 1, w + k)
                if c < dist.get(o, (math.inf, math.inf)):
                    dist[o], prev[o] = c, u
                    heapq.heappush(heap, (c[0], c[1], o))
        if t not in dist:
            return None
        hops, c = [], t
        while c != s:
            hops.append((prev[c], c))
            c = prev[c]
        return hops[::-1]


# ---------------------------------------------------------------------------
# One card
# ---------------------------------------------------------------------------

def pol(r, deg):
    a = math.radians(deg)
    return (C[0] + r * math.cos(a), C[1] + r * math.sin(a))


def tw(s, fs=None, bold=False):
    return (0.56 if bold else 0.5) * (fs or FS) * len(s)     # Georgia, roughly


def hits(a, b, pad=4):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def seg_dist(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / ((dx * dx + dy * dy) or 1)))
    return math.dist(p, (ax + t * dx, ay + t * dy))


def ang(pt):
    return math.degrees(math.atan2(pt[1] - C[1], pt[0] - C[0])) % 360


def apart(a, b):
    return min(abs(a - b) % 360, 360 - abs(a - b) % 360)


def page_url(name):
    return '/wiki/' + urllib.parse.quote(name.replace(' ', '_'))


def viewer(**q):
    return VIEWER + '?' + urllib.parse.urlencode(q)


def attr(s):
    return escape(str(s), quote=True)


RABBIT = ('<circle r="21" fill="%s" stroke="%s" stroke-width="1.5"/>' % (PAPER, INK) +
          '<g fill="%s" transform="translate(1 2)">' % INK +
          '<ellipse cx="-5" cy="-12" rx="2.2" ry="6.5" transform="rotate(-8 -5 -12)"/>'
          '<ellipse cx="-1" cy="-11" rx="2.2" ry="6.5" transform="rotate(22 -1 -11)"/>'
          '<ellipse cx="3" cy="5" rx="9" ry="6.5"/><circle cx="7" cy="5" r="6"/>'
          '<circle cx="-6" cy="-2" r="5.2"/><circle cx="13" cy="2" r="2.6"/>'
          '<ellipse cx="-2" cy="11" rx="4.5" ry="1.8"/>'
          '<circle cx="-7.6" cy="-3" r="1" fill="%s"/></g>' % PAPER)


def card(center, store, featured, has_page, inst):
    """The card's HTML for one picker, or None when the store has nobody they played with."""
    nb = store.evidence(center)
    nb = {o: d for o, d in nb.items() if d['kind'] in ('track', 'show')}   # played *with*
    if not nb:
        return None

    # Paths to the featured pickers
    paths = {}
    for f in featured:
        if f != center:
            paths[f] = store.path(center, f)

    def hop_ev(a, b):
        e = store.evidence(a, b)
        return e['list'][0] if e else None

    spokes = [f for f in featured if paths.get(f) and len(paths[f]) == 1]
    bends = [(paths[f][0][1], f) for f in featured if paths.get(f) and len(paths[f]) == MAX_DRAWN_HOPS]
    mids = []
    for m, _ in bends:
        if m not in spokes and m not in mids:
            mids.append(m)
    ring = spokes + mids
    pos = {}
    if ring:
        step = 360 / len(ring)
        for i, n in enumerate(ring):                 # a quarter step past noon: nobody at noon or six
            pos[n] = pol(120, -90 + step / 4 + step * i)
    turns = defaultdict(int)
    for m, e in bends:
        mx, my = pos[m]
        k = turns[m]
        turns[m] += 1
        a = math.degrees(math.atan2(my - C[1], mx - C[0])) + (-40 if k % 2 == 0 else 40) * (1 + k // 2)
        pos[e] = (mx + 115 * math.cos(math.radians(a)), my + 115 * math.sin(math.radians(a)))
    ends = [e for _, e in bends]
    named = ring + ends

    def label_box(n, below=None):
        x, y = pos[n]
        w = tw(n, bold=True)
        if below is None:
            below = y > C[1] + 1
        by = y + 17 + FS * 0.8 if below else y - 17
        return (x, by, (x - w / 2, by - FS * 0.8, x + w / 2, by + FS * 0.25))

    labels = {}
    for n in named:                                  # a name that runs into one already placed flips sides
        lb = label_box(n)
        if any(hits(lb[2], b[2]) for b in labels.values()):
            lb = label_box(n, below=not (pos[n][1] > C[1] + 1))
        labels[n] = lb
    cw = tw(center, FS * 1.25, True)
    boxes = [b[2] for b in labels.values()] + [(C[0] - cw / 2, 266 - FS * 1.25, C[0] + cw / 2, 270)]
    segs = [(C, pos[n]) for n in ring] + [(pos[m], pos[e]) for m, e in bends]

    def clear(x, y, pad=6):
        if any(b[0] - pad < x < b[2] + pad and b[1] - pad < y < b[3] + pad for b in boxes):
            return False
        if any(seg_dist((x, y), a, b) < 14 for a, b in segs):
            return False
        return all(math.dist((x, y), p) > 20 for p in pos.values()) and math.dist((x, y), C) > 60

    crowd = sorted((o for o in nb if o not in named),
                   key=lambda o: (-len(nb[o]['list']), -RANK[nb[o]['kind']], o))[:MAX_CROWD]
    taken = [ang(pos[n]) for n in named]
    placed = []
    for i, o in enumerate(crowd):                    # strongest first; each takes the widest gap left
        rings = (150, 180, 210, 240) if i % 2 == 0 else (180, 150, 210, 240)
        best = None
        for a in range(0, 360, 2):
            r = next((r for r in rings if clear(*pol(r, a))), None)
            if r is None:
                continue
            gap = min((apart(a, t) for t in taken), default=180)
            if best is None or gap > best[0]:
                best = (gap, a, r)
        if best:
            pos[o] = pol(best[2], best[1])
            taken.append(best[1])
            placed.append(o)

    def rad(o):
        return 3 + 1.6 * math.sqrt(len(nb[o]['list']))

    fedges = [(center, n, hop_ev(center, n)) for n in ring] + [(m, e, hop_ev(m, e)) for m, e in bends]

    xs = [C[0]] + [p[0] for p in pos.values()] + [b[0] for b in boxes] + [b[2] for b in boxes]
    ys = [C[1]] + [p[1] for p in pos.values()] + [b[1] for b in boxes] + [b[3] for b in boxes]
    x0, y0, x1, y1 = min(xs) - 14, min(ys) - 14, max(xs) + 14, max(ys) + 14

    def line(a, b, **kw):
        attrs = ' '.join(f'{k.replace("_", "-")}="{attr(v)}"' for k, v in kw.items())
        return f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" {attrs}/>'

    def trim(a, b, ra, rb):
        d = math.dist(a, b) or 1
        ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
        return (a[0] + ux * ra, a[1] + uy * ra), (b[0] - ux * rb, b[1] - uy * rb)

    def tip(lines, x, y):
        maxc = int((x1 - x0 - 8) / (0.52 * FS))
        lines = [ln if len(ln) <= maxc else ln[:maxc - 1] + '…' for ln in lines]
        w = max(tw(ln, bold=(i == 0)) for i, ln in enumerate(lines))
        h = FS * 1.2 * len(lines)
        cx = min(max(x, x0 + 4 + w / 2), x1 - 4 - w / 2)
        ty = y - 14 - h + FS if y - 14 - h > y0 + 2 else y + 14 + FS
        spans = ''.join(f'<tspan x="{cx:.1f}" dy="{0 if i == 0 else FS * 1.2:.1f}"'
                        + (' font-weight="bold"' if i == 0 else '') + f'>{escape(ln)}</tspan>'
                        for i, ln in enumerate(lines))
        return (f'<g class="cc-tip"><rect x="{cx - w / 2 - 5:.1f}" y="{ty - FS - 2:.1f}" width="{w + 10:.1f}" '
                f'height="{h + 6:.1f}" rx="4" fill="{PAPER}" stroke="#a2a9b1"/>'
                f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" fill="{INK}">{spans}</text></g>')

    def what(n):
        ev = nb[n]['list']
        more = f' (+{len(ev) - 1} more)' if len(ev) > 1 else ''
        return ev[0]['text'] + more

    def focus(n):
        """Click: the big graph, lit on this connection, or on the path when it's two hops."""
        if n in nb:
            return attr(viewer(a=center, b=n))
        return attr(viewer(**{'from': center, 'to': n}))

    def dot(n, r):
        x, y = pos[n]
        fill = INK if has_page(n) else PAPER
        return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}" stroke="{INK}" stroke-width="1.5"/>'

    def strokes(a, b, tier, loose, lit):
        """A line by what it stands on: gold for a Permanent Release, ink for a Full one, dotted for the rest."""
        if loose or tier == 0:
            return line(a, b, stroke=SHUT, stroke_width=2 if lit else 1.2, stroke_dasharray='1 5', stroke_linecap='round')
        if tier == 2 and lit:
            return (line(a, b, stroke=GOLD, stroke_width=8, opacity='.6', stroke_linecap='round')
                    + line(a, b, stroke=INK, stroke_width=2, stroke_linecap='round'))
        if tier == 2:
            return line(a, b, stroke=GOLD, stroke_width=2.2, stroke_linecap='round')
        return line(a, b, stroke=INK2, stroke_width=2 if lit else 1.2, stroke_linecap='round')

    out = []
    o = out.append
    o(f'<svg xmlns="http://www.w3.org/2000/svg" class="cc" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" '
      f'width="100%" font-family="Georgia, serif" font-size="{FS:g}" role="img" '
      f'aria-label="{attr("Who " + center + " has played with")}">')
    o(f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}" fill="{PAPER}"/>')
    for n in placed:                                 # the crowd: thin spokes
        o(strokes(C, pos[n], nb[n]['tier'], False, False))
    for a, b, ev in fedges:
        pa = C if a == center else pos[a]
        o(strokes(pa, pos[b], ev['tier'] if ev else 0, not ev or ev['kind'] == 'record', True))
    for n in named:
        x, y = pos[n]
        lx, ly, _ = labels[n]
        r = 7 if n in mids else 10
        ic = ''
        if n in inst:                                # the instrument is the dot
            href = attr(ICON.format(urllib.parse.quote(inst[n])))
            ic = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="14" fill="{PAPER}" stroke="{INK}" stroke-width="2"/>'
                  f'<image href="{href}" x="{x - 10:.1f}" y="{y - 10:.1f}" width="20" height="20"></image>')
        o(f'<a href="{focus(n)}">{dot(n, r)}{ic}<text class="cc-lab" x="{lx:.1f}" y="{ly:.1f}" '
          f'text-anchor="middle" fill="{INK}" font-weight="bold">{escape(n)}</text></a>')
    o(f'<a href="{attr(viewer(p=center))}"><g transform="translate({C[0]:.0f} {C[1]:.0f})">{RABBIT}</g>'
      f'<text class="cc-lab" x="{C[0]:.0f}" y="266" text-anchor="middle" fill="{INK}" font-weight="bold" '
      f'font-size="1.25em" stroke-width="5px">{escape(center)}</text></a>')
    for a, b, ev in fedges:                          # named pickers: the same hover as the dots, no more
        pa = C if a == center else pos[a]
        x, y = pos[b]
        s, e = trim(pa, (x, y), 23 if a == center else 9, 12)
        if a == center:
            one = what(b) if b in nb else (ev['text'] if ev else '')
        else:
            one = f'via {a}: ' + (ev['text'] if ev else '')
        head = b + (f' · {inst[b]}' if b in inst else '')
        bx = labels[b][2]
        o(f'<g class="cc-h"><a href="{focus(b)}">{line(s, e, **{"class": "cc-hit"})}</a>'
          f'<a href="{focus(b)}"><circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="transparent"/>'
          f'<rect x="{bx[0]:.1f}" y="{bx[1]:.1f}" width="{bx[2] - bx[0]:.1f}" height="{bx[3] - bx[1]:.1f}" '
          f'fill="transparent"/></a>{tip([head, one], x, y)}</g>')
    for n in placed:                                 # last, so a shown note sits on top
        x, y = pos[n]
        s, e = trim(C, (x, y), 23, rad(n) + 2)
        head = n + (f' · {inst[n]}' if n in inst else '')
        o(f'<g class="cc-h"><a href="{focus(n)}">{line(s, e, **{"class": "cc-hit"})}</a>'
          f'{line(C, (x, y), **{"class": "cc-hi", "stroke": GOLD if nb[n]["tier"] == 2 else INK2, "stroke_width": 3.5})}'
          f'<a href="{focus(n)}">{dot(n, rad(n))}<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="transparent"/></a>'
          f'{tip([head, what(n)], x, y)}</g>')
    o('</svg>')

    rows = []
    for f in featured:
        if f == center:
            continue
        p = paths.get(f)
        name = f'<a href="{attr(page_url(f))}">{escape(f)}</a>' if has_page(f) else escape(f)
        if p is None:
            rows.append(f'<tr><td>{name}</td><td class="cc-n">–</td></tr>')
            continue
        why = [f'{a} → {b}: {hop_ev(a, b)["text"]}' for a, b in p]
        # The number is the way to the path itself, in the big graph: a finger has no hover to read the title by.
        rows.append(f'<tr><td>{name}</td><td class="cc-n" title="{attr(chr(10).join(why))}">'
                    f'<a href="{attr(viewer(a=center, b=f))}">{len(p)}</a></td></tr>')
    legend = ('<div class="cc-legend">'
              '<span class="cc-key cc-gold"></span> <a href="/wiki/PickiPedia:Release_Types">Permanent Release</a>: '
              'a taper\'s tape or Creative Commons<br>'
              '<span class="cc-key cc-ink"></span> Full Release: no DRM '
              '<span class="cc-key cc-rest"></span> the rest<br>'
              'bigger = more times · hollow = no page yet</div>')
    table = ('<table class="wikitable cc-bacon"><tr><th>Featured</th><th>Bacon #</th></tr>'
             + ''.join(rows) + '</table>') if rows else ''
    return (f'<div class="connectome-card" data-picker="{attr(center)}">'
            f'<div class="cc-head">Connectome <a class="cc-explore" href="{attr(viewer(p=center))}">⤢ explore</a></div>'
            + ''.join(out) + legend + table +
            f'<div class="cc-foot"><a href="{attr(page_url(FEATURED_PAGE))}">Featured</a> this month. '
            'A number opens the path.</div></div>')


def card_file(title):
    """Where a page's card is kept: the wiki finds it by the same hash of its title."""
    return hashlib.md5(title.encode('utf-8')).hexdigest() + '.html'


# ---------------------------------------------------------------------------

def load_store(db_path, pairs_path):
    db = sqlite3.connect(db_path)
    targets = {r[0]: r[1:] for r in db.execute('SELECT id, title, date, artist FROM targets')}
    groups = dict(db.execute('SELECT id, grp FROM targets'))
    with open(pairs_path) as f:
        pairs = json.load(f)
    return pairs, targets, groups


def load_whole(db_path):
    """What the big graph needs beyond the cards: each record or show in full, and every credit."""
    db = sqlite3.connect(db_path)
    cols = [c[1] for c in db.execute('PRAGMA table_info(targets)')]
    formats = 'formats' if 'formats' in cols else "''"      # a store built before records kept their formats
    whole = {r[0]: {'kind': r[1], 'title': r[2], 'date': r[3], 'artist': r[4], 'grp': r[5],
                    'formats': [f for f in (r[6] or '').split('; ') if f]}
             for r in db.execute(f'SELECT id, kind, title, date, artist, grp, {formats} FROM targets')}
    credits = db.execute('SELECT person, roles, target, scope, source FROM credits').fetchall()
    return whole, credits


def build(pairs, targets, groups, wiki, today, only=None, whole=None, credits=()):
    names = {p['a'] for p in pairs} | {p['b'] for p in pairs}
    resolved = wiki.resolve(names)
    alias = {n: (t if ok else n) for n, (t, ok) in resolved.items()}
    exists = {t for t, ok in resolved.values() if ok}
    tiers = {t: connectome_graph.tier(t, d.get('formats')) for t, d in (whole or {}).items()}
    store = Store(pairs, targets, groups, alias, tiers)

    month, featured_raw = featured_from(wiki.raw(FEATURED_PAGE), today)
    fres = wiki.resolve(featured_raw) if featured_raw else {}
    featured = [fres[n][0] for n in featured_raw]
    exists |= {t for t, ok in fres.values() if ok}
    for t in featured:                               # a featured picker the store doesn't know
        store.by.setdefault(t, [])
    inst = wiki.instruments()

    def has_page(n):
        return n in exists

    pages = [only] if only else wiki.musician_pages()
    cards, skipped = {}, []
    for title in pages:
        html = card(title, store, featured, has_page, inst) if title in store.by else None
        if html is None:
            skipped.append(title)
        else:
            cards[title] = html
    graph = None
    if whole is not None:                            # the big graph's one file, from the same store and names
        asked = connectome_graph.arthel_pages(store.pairs, whole, song)
        found = wiki.resolve(asked) if asked else {}
        pages = {n: page_url(t) for n, (t, ok) in found.items() if ok}
        song_page = {t: n[len('Song:'):] for n, (t, ok) in found.items() if ok and n.startswith('Song:')}
        heard = wiki.listens(song_page) if song_page else {}
        plays = {song_page[t]: cid for t, cid in heard.items() if t in song_page}
        graph = connectome_graph.export(
            store.pairs, whole, [(alias.get(c[0], c[0]),) + tuple(c[1:]) for c in credits],
            has_page, inst, featured, month, song, pages, today.isoformat(), plays)
    return {'month': month, 'featured': featured, 'cards': cards, 'skipped': sorted(skipped), 'graph': graph,
            'pairs': store.pairs, 'names': {k: sorted(v) for k, v in sorted(store.raw.items())}}


def write(result, out_dir, built_from):
    os.makedirs(os.path.join(out_dir, 'cards'), exist_ok=True)
    for title, html in result['cards'].items():
        with open(os.path.join(out_dir, 'cards', card_file(title)), 'w') as f:
            f.write(html)
    with open(os.path.join(out_dir, 'pairs.json'), 'w') as f:
        json.dump(result['pairs'], f)
    with open(os.path.join(out_dir, 'names.json'), 'w') as f:
        json.dump(result['names'], f)
    if result.get('graph') is not None:
        with open(os.path.join(out_dir, 'graph.json'), 'w') as f:
            json.dump(result['graph'], f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(out_dir, 'cards.json'), 'w') as f:
        json.dump({'month': result['month'], 'featured': result['featured'],
                   'cards': {t: card_file(t) for t in sorted(result['cards'])},
                   'no_card': result['skipped'], 'built_from': built_from}, f, indent=1)


def main(argv):
    ap = argparse.ArgumentParser(description='Connectome cards for musician pages.')
    ap.add_argument('--db', required=True)
    ap.add_argument('--pairs', required=True)
    ap.add_argument('--wiki', default='https://pickipedia.xyz/')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', help='one page title, for trying a card')
    ap.add_argument('--today', help='YYYY-MM-DD; picks the featured month')
    a = ap.parse_args(argv)
    today = date.fromisoformat(a.today) if a.today else date.today()
    pairs, targets, groups = load_store(a.db, a.pairs)
    whole, credits = load_whole(a.db)
    result = build(pairs, targets, groups, Wiki(a.wiki), today, a.only, whole, credits)
    write(result, a.out, {'db': os.path.basename(a.db), 'wiki': a.wiki, 'today': today.isoformat()})
    print(f"{len(result['cards'])} cards, featured {result['month']}: {', '.join(result['featured'])}; "
          f"no card for {len(result['skipped'])} pages", file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1:])
