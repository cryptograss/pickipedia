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
  the page's picker at the centre (a rabbit), and a spoke to each of the ones it names:
  those they played with, by Justin's order (standing(): Creative Commons studio tracks,
  Creative Commons shows, DRM-free studio tracks, other shows), two at most by any one
  record or show while there are others, as the big graph's ring is (connectome-core.js
  fewPer); the next closest as small dots, named on hover. Only people who played *with*
  the picker (same track or same show) get a dot. The featured pickers
  (Cryptograss:Connectome/Featured) are set aside for now (Justin, #connectome,
  15 Nov 2026: "something that needs to be revisited later"): no card draws paths to
  them, and featured_from() waits for that.
  The marks are the big graph's (assets/connectome/) and Rabbithole's: one colour, and
  it means one thing. A gold line is a Permanent Release (a tape in archive.org's etree collection, or
  one of cryptograss's Creative Commons records); plain ink is a Full Release (no DRM);
  dotted grey is the rest, counted and not vouched for (PickiPedia:Release_Types;
  connectome_graph.tier reads which from the source). A bigger dot is more times
  together; a hollow dot has no page yet.

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
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from html import escape

import connectome_graph
import set_stones
from connectome_graph import icon_for

FEATURED_PAGE = 'Cryptograss:Connectome/Featured'
TEMPLATE = 'Template:MusicianInfo'
# The picture a musician's page gives for them: {{MusicianInfo|image=Some file.jpg|...}}, with or without "File:".
PORTRAIT = re.compile(r'\{\{\s*MusicianInfo\b[^{}]*?\|\s*image\s*=\s*(?:File:|Image:)?\s*([^|{}\[\]<>\n]+)', re.S | re.I)
VIEWER = '/bacon'                      # the big graph's page (Justin, 16 Nov 2026); its files: assets/connectome/
ICON = '/index.php?title=Special:Redirect/file/Instrument-icon-{}.png'
UA = 'PickiPedia-connectome-card/1.0'
# The track a song page plays in Rabbithole: the first parameter of its {{Listen in Rabbithole}}; or, since
# the song pages state their cut (HearThatWhistleBlow), the cid of that page's {{Studio cut}}.
LISTEN = re.compile(r'\{\{\s*Listen[ _]in[ _]Rabbithole\s*\|\s*([A-Za-z0-9]{20,})\s*[|}]')
STUDIO_CUT_CID = re.compile(r'\{\{\s*Studio[ _]cut\b[^}]*?\bcid\s*=\s*([A-Za-z0-9]{20,})', re.S)

GOLD = '#eda100'                        # a Permanent Release, and nothing else
INK2 = '#52514e'                        # a Full Release
SHUT = '#898781'                        # the rest: counted, not vouched for
PAPER = '#fcfcfb'
INK = '#0b0b0b'
RANK = {'record': 1, 'show': 2, 'track': 3}
WEIGHT = {'track': 1, 'show': 2, 'record': 3}
MAX_CROWD = 12
NAMED = 4                                # who a card names round its picker: as many as the featured four were
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
                text = revs[0]['slots']['main'].get('content', '') if revs else ''
                m = LISTEN.search(text) or STUDIO_CUT_CID.search(text)
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

    def bacon_pages(self):
        """The pages that ask for a bacon graph of their own: those that carry {{Bacon graph of this page}},
        in any namespace."""
        out, cont = [], {}
        while True:
            q = self.api(action='query', list='embeddedin', eititle=PAGE_TEMPLATE, eilimit=500, **cont)
            out += [p['title'] for p in q['query']['embeddedin']]
            if 'continue' not in q:
                return out
            cont = {'eicontinue': q['continue']['eicontinue']}

    def links(self, titles):
        """title -> the main-namespace pages it links to, as the page writes them (redirects not yet followed)."""
        out = {}
        for t in sorted(set(titles)):
            cont, got = {}, []
            while True:
                q = self.api(action='query', titles=t, prop='links', plnamespace=0, pllimit='max',
                             formatversion=2, **cont)
                for page in q['query'].get('pages', []):
                    got += [x['title'] for x in page.get('links', [])]
                if 'continue' not in q:
                    break
                cont = {'plcontinue': q['continue']['plcontinue']}
            out[t] = got
        return out

    def portraits(self, titles):
        """title -> the file its {{MusicianInfo}} gives as image=, for the pages that give one. The page says which
        picture is the picker's; nothing here chooses one."""
        out = {}
        titles = sorted(set(titles))
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                m = PORTRAIT.search(revs[0]['slots']['main'].get('content', '') if revs else '')
                if m and m.group(1).strip():
                    out[page['title']] = m.group(1).strip()
        return out

    def instruments(self):
        q = self.api(action='ask', query='[[Primary instrument::+]]|?Primary instrument|limit=1000')
        out = {}
        for row in (q.get('query', {}).get('results') or {}).values():
            v = row['printouts'].get('Primary instrument') or []
            if v:
                out[row['fulltext']] = v[0]['fulltext'].lower()
        return out

    def studio_cuts(self):
        """The song pages that state a cut: title -> [{'record', 'number', 'cid', 'cast': {name: roles}}],
        one entry per {{Studio cut}} on the page. The page is the source here (track precedence, as the
        schema consensus has it); the store's credits fill the songs these don't reach."""
        titles, cont = [], {}
        while True:
            q = self.api(action='query', list='embeddedin', eititle='Template:Studio cut',
                         eilimit=500, eifilterredir='nonredirects', **cont)
            titles += [p['title'] for p in q['query']['embeddedin']]
            if 'continue' not in q:
                break
            cont = {'eicontinue': q['continue']['eicontinue']}
        out = {}
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                text = revs[0]['slots']['main'].get('content', '') if revs else ''
                cuts = studio_cuts_from(text)
                writers = writers_from(text)
                charts = chartifacts_from(text, cuts)
                for c in cuts:
                    c['writers'] = writers
                    c['charts'] = charts.get(c['cid'], [])
                if cuts:
                    out[page['title']] = cuts
        return out

    def song_authors(self):
        """Who wrote each song, as its page's {{Song}} says: title (without "Song:") -> its composers as written,
        or 'traditional' where the page says the tradition carries it (Template:Song: composer=, traditional=yes).
        A page that says neither is left out: nobody is guessed."""
        titles, cont = [], {}
        while True:
            q = self.api(action='query', list='embeddedin', eititle='Template:Song', eilimit=500,
                         eifilterredir='nonredirects', **cont)
            titles += [p['title'] for p in q['query']['embeddedin']]
            if 'continue' not in q:
                break
            cont = {'eicontinue': q['continue']['eicontinue']}
        out = {}
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                said = authors_from(revs[0]['slots']['main'].get('content', '') if revs else '')
                if said:
                    out[page['title'][len('Song:'):] if page['title'].startswith('Song:') else page['title']] = said
        return out

    def record_artists(self, titles):
        """Who a record page's {{Record}} names as the artist: title -> name. The recording artist of a
        cut's track is the node a route home points at (Justin, #connectome, 15 Nov 2026)."""
        out = {}
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                text = revs[0]['slots']['main'].get('content', '') if revs else ''
                m = re.search(r'\|\s*artist\s*=\s*([^\n|}]+)', text)
                if m:
                    out[page['title']] = m.group(1).strip()
        return out

    def record_art(self, titles):
        """The file a record page's {{Record|art=}} names: title -> file name (no File: prefix)."""
        out = {}
        for i in range(0, len(titles), 50):
            q = self.api(action='query', titles='|'.join(titles[i:i + 50]), prop='revisions', rvprop='content',
                         rvslots='main', formatversion=2)['query']
            for page in q.get('pages', []):
                revs = page.get('revisions') or []
                text = revs[0]['slots']['main'].get('content', '') if revs else ''
                m = re.search(r'\{\{\s*Record\b[^{}]*?\|\s*art\s*=\s*([^\n|}]+)', text)
                if m and m.group(1).strip():
                    out[page['title']] = re.sub(r'^(?:File|Image):', '', m.group(1).strip())
        return out

    def instrument_icons(self):
        """The instruments the wiki keeps an icon for: the names after Instrument-icon-."""
        q = self.api(action='query', list='allimages', aiprefix='Instrument-icon-', ailimit=100)
        return {i['name'].split('Instrument-icon-')[-1].replace('.png', '')
                for i in q.get('query', {}).get('allimages', [])}


def studio_cuts_from(text):
    """The {{Studio cut}} blocks of a page's wikitext: their record, number, cid, and each person's roles.
    The store writes roles "; "-joined; a page writes them with commas, so they arrive in the store's shape."""
    cuts = []
    for m in re.finditer(r'\{\{\s*Studio[ _]cut\b(.*?)\}\}', text, re.S):
        fields, cast = {}, {}
        for line in m.group(1).split('\n'):
            k, _, v = line.strip().lstrip('|').partition('=')
            k, v = k.strip(), v.strip()
            if not k:
                continue
            if k in ('record', 'number', 'cid', 'recorded'):
                fields[k] = v
            elif k not in ('studio', 'recorded', 'engineer', 'status', 'note') and v:
                cast[k] = re.sub(r'\s*,\s*', '; ', v)
        cuts.append({'record': fields.get('record', ''), 'number': fields.get('number', ''),
                     'cid': fields.get('cid', ''), 'recorded': fields.get('recorded', ''), 'cast': cast})
    return cuts


def chartifacts_from(text, cuts=()):
    """The {{Chartifact}} blocks of a song page, each given to its cut: the cid its `cut=` names, or, where it names
    none, the page's only studio cut (Template:Chartifact's own rule). On a page of two cuts a chartifact naming
    neither is no cut's, and is left out. -> {cid: [[section, kind, picker, instrument], ...]}, in page order."""
    out = {}
    cids = [c['cid'] for c in cuts if c.get('cid')]
    for m in re.finditer(r'\{\{\s*Chartifact\b(.*?)\}\}', text, re.S):
        f = {}
        for part in m.group(1).split('|'):
            k, _, v = part.partition('=')
            if k.strip():
                f[k.strip()] = re.sub(r'\s+', ' ', v).strip()
        cid = f.get('cut') or (cids[0] if len(cids) == 1 else '')
        if cid and f.get('picker'):
            out.setdefault(cid, []).append([f.get('section', ''), f.get('kind', ''), f['picker'], f.get('instrument', '')])
    return out


def writers_from(text):
    """Who a song page's {{Song|composer=}} says wrote it, as written: "Justin Holmes", "[[A|a]] and B" -> A, B.
    A traditional song has nobody here, and nobody is guessed."""
    m = re.search(r'\{\{\s*Song\b[^{}]*?\|\s*composer\s*=\s*((?:\[\[[^\]]*\]\]|[^\n|{}\[])*)', text)
    if not m:
        return []
    said = re.sub(r'\[\[([^\]|]*)(?:\|[^\]]*)?\]\]', r'\1', m.group(1))             # a link: the page it names
    return [n.strip() for n in re.split(r'\s*(?:,|;|&|/|\band\b)\s*', said) if n.strip()]


def song_key(name):
    """A song's name as two spellings of it agree: lower case, no accents, letters and digits only ("Barlows Jig" and
    "Barlow's Jig" are one song)."""
    plain = ''.join(c for c in unicodedata.normalize('NFKD', (name or '').lower()) if not unicodedata.combining(c))
    return re.sub(r'[\W_]+', '', plain)


def authors_from(text):
    """Who a song page says wrote it: its composers as written (writers_from), else 'traditional' where its {{Song}}
    says traditional=yes, else None. The composer is the one the template shows where a page says both."""
    by = writers_from(text)
    if by:
        return by
    m = re.search(r'\{\{\s*Song\b[^{}]*?\|\s*traditional\s*=\s*(?:yes|true|1)\s*(?:\||\}\})', text, re.I)
    return 'traditional' if m else None


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
    where = f"{artist}, {when}" if p['target'].startswith(('lma:', 'arthel:show:')) and artist else \
        (title or p['target']) + (f", {when}" if when else '')
    songs = [s for s in (song(p['target'], t) for t in p.get('tracks', [])[:2]) if s]
    return ('“' + '”, “'.join(songs) + '”, ' if songs else '') + where


class Store:
    def __init__(self, pairs, targets, groups, alias, tiers=None, shows=None):
        """alias: a source's spelling -> the name the card uses. tiers: target -> 2, 1 or 0 (connectome_graph.tier).
        shows: the targets that are shows (the store's own kinds); not given, those any pair calls a show."""
        self.targets, self.groups = targets, groups
        self.tiers = tiers or {}
        self.shows = set(shows) if shows is not None else {p['target'] for p in pairs if p['kind'] == 'show'}
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
                            'songs': [s for s in (song(p['target'], t) for t in p.get('tracks', [])) if s],
                            'tier': self.tiers.get(p['target'], connectome_graph.tier(p['target'])),
                            'show': p['target'] in self.shows}
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


def line_svg(a, b, **kw):
    attrs = ' '.join(f'{k.replace("_", "-")}="{attr(v)}"' for k, v in kw.items())
    return f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" {attrs}/>'


def trim_svg(a, b, ra, rb):
    d = math.dist(a, b) or 1
    ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
    return (a[0] + ux * ra, a[1] + uy * ra), (b[0] - ux * rb, b[1] - uy * rb)


def tip_box(lines, x, y, box):
    """A hover note, kept inside the card's box (x0, y0, x1, y1); the first line bold."""
    x0, y0, x1, y1 = box
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


def strokes_svg(a, b, tier, loose, lit):
    """A line by what it stands on: gold for a Permanent Release, ink for a Full one, dotted for the rest."""
    if loose or tier == 0:
        return line_svg(a, b, stroke=SHUT, stroke_width=2 if lit else 1.2, stroke_dasharray='1 5', stroke_linecap='round')
    if tier == 2 and lit:
        return (line_svg(a, b, stroke=GOLD, stroke_width=8, opacity='.6', stroke_linecap='round')
                + line_svg(a, b, stroke=INK, stroke_width=2, stroke_linecap='round'))
    if tier == 2:
        return line_svg(a, b, stroke=GOLD, stroke_width=2.2, stroke_linecap='round')
    return line_svg(a, b, stroke=INK2, stroke_width=2 if lit else 1.2, stroke_linecap='round')


NOTE = ('<circle r="21" fill="%s" stroke="%s" stroke-width="1.5"/>' % (PAPER, INK) +
        '<g fill="%s">' % INK +
        '<ellipse cx="-3.5" cy="7" rx="5" ry="3.8" transform="rotate(-18 -3.5 7)"/>' +
        '<rect x="1.2" y="-13" width="2.4" height="20"/>' +
        '<path d="M1.2 -13 q 7.5 1.5 7.5 7 q 0 -3.4 -7.5 -4.4 z"/></g>')


RABBIT = ('<circle r="21" fill="%s" stroke="%s" stroke-width="1.5"/>' % (PAPER, INK) +
          '<g fill="%s" transform="translate(1 2)">' % INK +
          '<ellipse cx="-5" cy="-12" rx="2.2" ry="6.5" transform="rotate(-8 -5 -12)"/>'
          '<ellipse cx="-1" cy="-11" rx="2.2" ry="6.5" transform="rotate(22 -1 -11)"/>'
          '<ellipse cx="3" cy="5" rx="9" ry="6.5"/><circle cx="7" cy="5" r="6"/>'
          '<circle cx="-6" cy="-2" r="5.2"/><circle cx="13" cy="2" r="2.6"/>'
          '<ellipse cx="-2" cy="11" rx="4.5" ry="1.8"/>'
          '<circle cx="-7.6" cy="-3" r="1" fill="%s"/></g>' % PAPER)


def standing(kind, tier, show=False):
    """Justin's order (#connectome, 15 Nov 2026), as connectome-core.js's standing(): 1 Creative Commons
    studio tracks, 2 Creative Commons shows, 3 DRM-free studio tracks, 4 other shows; then a track not known
    to be free, then a record two are only both on. show: the thing is a show, though the two may be on one
    song of it (a sit-in on a tape is a show, not a studio track)."""
    if kind not in ('track', 'show'):
        return 0
    if show or kind == 'show':
        return 4 if tier == 2 else 2
    return 5 if tier == 2 else (3 if tier == 1 else 1)


def song_key(name):
    """A song's name as two spellings of it agree ("Barlow's Jig", "Barlows Jig"): connectome-core.js's songKey()."""
    s = unicodedata.normalize('NFKD', str(name or '').lower())
    s = ''.join(ch for ch in s if not unicodedata.combining(ch) and ch not in "'\u2019")
    return ' '.join(re.sub(r'[\W_]+', ' ', s).split())


def owners(graph):
    """Whose each record is and who wrote each song, by name, from graph.json: target -> {name}, the pickers who
    made it (its made); (target, song_key) -> {name}, whoever the song's page says wrote it, of those on the cut."""
    people = [p[0] for p in graph.get('people', [])]
    music = graph.get('music', [])
    made = {m[0]: {people[i] for i in ids} for m, ids in zip(music, graph.get('made', []))}
    wrote = defaultdict(set)
    for c in (graph.get('songcast') or {}).values():
        for mi in c.get('on', []):
            wrote[(music[mi][0], song_key(c['song']))] |= {people[w] for w in c.get('writers', [])}
    return made, dict(wrote)


def closest(store, center, nb, want=NAMED, cap=2, made=None, wrote=None):
    """Who a card names round its picker: down those they played with by Justin's order, each by the best
    record or show they share that hasn't already brought in `cap` others (Justin, #connectome, 15 Nov 2026:
    "only at most two 1-hop connections from any given record or show, unless there are no other connecting
    objects available"); those whose every one is full come after, in their own order.

    Of those who'd come in as near the front by one record, its recording artist first, then a writer of the
    song (Justin, #connectome, 15 Nov 2026, 07:29Z: "1. the recording artist who made it, 2. the song writer if
    they're on the track, 3. another person from the ensemble"), as connectome-core.js's fewPer(). made and
    wrote: owners()."""
    made, wrote = made or {}, wrote or {}

    def claim(o, e):
        if e['kind'] != 'track' or e.get('show'):
            return 2
        if o in made.get(e['target'], ()):
            return 0
        return 1 if any(o in wrote.get((e['target'], song_key(s)), ()) for s in e.get('songs', ())) else 2

    def ways(o):
        return [(standing(e['kind'], e['tier'], e.get('show', False)), store.groups.get(e['target'], e['target']), claim(o, e))
                for e in nb[o]['list']]
    order = sorted(nb, key=lambda o: (-max(w[0] for w in ways(o)), -len(nb[o]['list']), o))
    used, out, left = defaultdict(int), [], list(order)
    while left and len(out) < want:
        pick = None
        for i, o in enumerate(left):
            room = [w for w in ways(o) if used[w[1]] < cap]
            if room:
                best = max(room, key=lambda w: (w[0], -w[2]))
                if pick is None or (best[0], -best[2]) > (pick[1][0], -pick[1][2]):
                    pick = (i, best)
        if pick is None:
            break
        used[pick[1][1]] += 1
        out.append(left.pop(pick[0]))
    return out + left[:max(0, want - len(out))]


def card(center, store, has_page, inst, named=None, made=None, wrote=None):
    """The card's HTML for one picker, or None when the store has nobody they played with. named: who it
    names round them, in order (closest() when not given, with made and wrote)."""
    nb = store.evidence(center)
    nb = {o: d for o, d in nb.items() if d['kind'] in ('track', 'show')}   # played *with*
    if not nb:
        return None

    def hop_ev(a, b):
        e = store.evidence(a, b)
        return e['list'][0] if e else None

    ring = [n for n in (closest(store, center, nb, made=made, wrote=wrote) if named is None else named) if n in nb and n != center]
    pos = {}
    if ring:
        step = 360 / len(ring)
        for i, n in enumerate(ring):                 # a quarter step past noon: nobody at noon or six
            pos[n] = pol(120, -90 + step / 4 + step * i)
    named = ring

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
    segs = [(C, pos[n]) for n in ring]

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

    fedges = [(center, n, hop_ev(center, n)) for n in ring]

    xs = [C[0]] + [p[0] for p in pos.values()] + [b[0] for b in boxes] + [b[2] for b in boxes]
    ys = [C[1]] + [p[1] for p in pos.values()] + [b[1] for b in boxes] + [b[3] for b in boxes]
    x0, y0, x1, y1 = min(xs) - 14, min(ys) - 14, max(xs) + 14, max(ys) + 14

    def line(a, b, **kw):
        return line_svg(a, b, **kw)

    def trim(a, b, ra, rb):
        return trim_svg(a, b, ra, rb)

    def tip(lines, x, y):
        return tip_box(lines, x, y, (x0, y0, x1, y1))

    def what(n):
        ev = nb[n]['list']
        more = f' (+{len(ev) - 1} more)' if len(ev) > 1 else ''
        return ev[0]['text'] + more

    def focus(n):
        """Click: the big graph, lit on this connection, or on the path when it's two hops. Written as /bacon writes
        it in the address bar once it is there (?a=&b=, which it reads ?from=&to= as too), so a card's way in is the
        same address as the graph's own (Justin, #connectome, 26 Nov 2026, 02:15Z: "Same URLs too")."""
        return attr(viewer(a=center, b=n))

    def dot(n, r):
        x, y = pos[n]
        fill = INK if has_page(n) else PAPER
        return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}" stroke="{INK}" stroke-width="1.5"/>'

    strokes = strokes_svg

    out = []
    o = out.append
    o(f'<svg xmlns="http://www.w3.org/2000/svg" class="cc" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" '
      f'width="100%" font-family="Georgia, serif" font-size="{FS:g}" role="img" '
      f'aria-label="{attr("Who " + center + " has played with")}">')
    # The paper itself is a way in: a click that lands on nothing else opens the big graph on this picker
    # (Justin, #connectome, 15 Nov 2026: "too easy to click ... and not hit anything").
    o(f'<a class="cc-bg" href="{attr(viewer(p=center))}" aria-label="{attr("Explore " + center + " in the connectome")}">'
      f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}" fill="{PAPER}"/></a>')
    for n in placed:                                 # the crowd: thin spokes
        o(strokes(C, pos[n], nb[n]['tier'], False, False))
    for a, b, ev in fedges:
        pa = C if a == center else pos[a]
        o(strokes(pa, pos[b], ev['tier'] if ev else 0, not ev or ev['kind'] == 'record', True))
    for n in named:
        x, y = pos[n]
        lx, ly, _ = labels[n]
        r = 10
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

    legend = ('<div class="cc-legend">'
              '<span class="cc-key cc-gold"></span> <a href="/wiki/PickiPedia:Release_Types">Permanent Release</a>: '
              'an etree tape or Creative Commons<br>'
              '<span class="cc-key cc-ink"></span> Full Release: no DRM '
              '<span class="cc-key cc-rest"></span> the rest<br>'
              'bigger = more times · hollow = no page yet</div>')
    return (f'<div class="connectome-card" data-picker="{attr(center)}">'
            f'<div class="cc-head">Connectome <a class="cc-explore" href="{attr(viewer(p=center))}">⤢ explore</a></div>'
            + ''.join(out) + legend + '</div>')


def card_file(title):
    """Where a page's card is kept: the wiki finds it by the same hash of its title."""
    return hashlib.md5(title.encode('utf-8')).hexdigest() + '.html'


SONG_RING = 120.0                      # the ring a song's cast sits on; wider when the cast is a big one
PAGE_TEMPLATE = 'Template:Bacon graph of this page'   # a page that carries it asks for a graph of its own
PAGE_MOST = 16                          # the most a page's graph names round it; the rest are counted under it
PAGE_WIDE = 440                         # a page's graph is never narrower, so a note's line isn't cut short
HOME = 'Justin Myles Holmes'            # whose way each picker on a page's graph is given: how far from cryptograss


def song_cut(whole, tiers, pages, target):
    """What a song's card says about the cut it draws: its record, when, its page, its release kind."""
    d = whole.get(target, {})
    return {'target': target, 'tier': tiers.get(target, connectome_graph.tier(target, d.get('formats'))),
            'title': d.get('title') or target, 'date': d.get('date') or '', 'artist': d.get('artist') or '',
            'page': pages.get(d.get('title', '')) or ''}


def song_card(title, cut, cast, store, has_page, inst, play=None, icons=()):
    """The song-centred card: the song in the middle, the pickers of its cut on the ring, each labelled
    with the instrument the track-level credits gave them, and a line between two of them when the store
    knows they played together elsewhere (Justin, #rabbithole, 15 Nov 2026, 00:23Z). cut: what song_cut()
    returned; cast: [(picker, roles as that cut's credits wrote them)]."""
    if not cast:
        return None
    ring = [n for n, _ in cast]
    roles = dict(cast)
    r = SONG_RING + max(0, len(ring) - 8) * 9
    step = 360 / len(ring)
    pos = {n: pol(r, -90 + step / 4 + step * i) for i, n in enumerate(ring)}

    def label(n, below=None):
        x, y = pos[n]
        if below is None:
            below = y > C[1] + 1
        w = max(tw(n, bold=True), tw(roles[n]) * 0.62 if roles[n] else 0)
        ny = y + 17 + FS * 0.8 if below else y - 17                 # the name's baseline
        top = ny - FS * 0.8 if below else ny - FS * 1.5
        h = FS * (1.55 if roles[n] else 1.0)
        return [x, ny, below, (x - w / 2, top, x + w / 2, top + h)]

    labels = {}
    for n in ring:                                                  # a label that runs into one placed flips sides
        lb = label(n)
        if any(hits(lb[3], L[3]) for L in labels.values()):
            lb = label(n, below=not lb[2])
        labels[n] = lb
    cw = tw(title, FS * 1.25, True)
    boxes = [L[3] for L in labels.values()] + [(C[0] - cw / 2, 266 - FS * 1.25, C[0] + cw / 2, 270)]

    def elsewhere(n):
        ev = store.evidence(n) or {}                                # every cut they're on, this one left out
        out = [e for d in ev.values() for e in d['list'] if e['target'] != cut['target']]
        out.sort(key=lambda e: (-e['tier'], -RANK[e['kind']], e['text']))
        return out

    edges = []
    for i, x in enumerate(ring):
        for y in ring[i + 1:]:
            ev = store.evidence(x, y) or {'list': []}
            others = [e for e in ev['list'] if e['target'] != cut['target']]
            if not others:
                continue
            e = others[0]
            s, t = trim_svg(pos[x], pos[y], 12, 12)
            if e['tier'] == 0:
                html = line_svg(s, t, stroke=SHUT, stroke_width=1.2, stroke_dasharray='1 5', stroke_linecap='round')
            else:
                col = GOLD if e['tier'] == 2 else INK2
                w = 2.2 if e['kind'] == 'track' else 1.2            # the same cut again: solid; a record or a stage: thin
                html = line_svg(s, t, stroke=col, stroke_width=w, stroke_linecap='round')
            edges.append((x, y, html, e, len(others)))

    xs = [C[0]] + [p[0] for p in pos.values()] + [b[0] for b in boxes] + [b[2] for b in boxes]
    ys = [C[1]] + [p[1] for p in pos.values()] + [b[1] for b in boxes] + [b[3] for b in boxes]
    x0, y0, x1, y1 = min(xs) - 14, min(ys) - 14, max(xs) + 14, max(ys) + 14

    def tip(lines, x, y):
        return tip_box(lines, x, y, (x0, y0, x1, y1))

    out = []
    o = out.append
    o(f'<svg xmlns="http://www.w3.org/2000/svg" class="cc" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" '
      f'width="100%" font-family="Georgia, serif" font-size="{FS:g}" role="img" '
      f'aria-label="{attr("Who played " + title)}">')
    # the cut's graph, as /bacon writes it in the address bar: its song, then its cut (?s=&cut=), not the cut alone,
    # which the graph would rewrite (Justin, #connectome, 26 Nov 2026, 02:15Z: "Same URLs too")
    whole = viewer(s=title, cut=cut["key"]) if cut.get("key") else viewer(s=title)
    o(f'<a class="cc-bg" href="{attr(whole)}" aria-label="{attr("Explore " + title + " in the connectome")}">'    # the paper is a way in, too
      f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}" fill="{PAPER}"/></a>')
    for _, _, html, _, _ in edges:
        o(html)
    for n in ring:
        x, y = pos[n]
        icon = icon_for(roles[n], icons)                            # the icon the wiki has for this cut's own roles
        if icon:
            href = attr(ICON.format(urllib.parse.quote(icon)))
            ic = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="14" fill="{PAPER}" stroke="{INK}" stroke-width="2"/>'
                  f'<image href="{href}" x="{x - 10:.1f}" y="{y - 10:.1f}" width="20" height="20"></image>')
        else:
            ic = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="10" fill="{INK if has_page(n) else PAPER}" '
                  f'stroke="{INK}" stroke-width="1.5"/>')
        x_lab, ny, below, nbox = labels[n]
        ry = ny + FS * 1.05 if below else ny - FS * 1.05            # the roles line, out from the name
        o(f'<a href="{attr(viewer(p=n))}">{ic}<text class="cc-lab" x="{x_lab:.1f}" y="{ny:.1f}" '
          f'text-anchor="middle" fill="{INK}" font-weight="bold">{escape(n)}</text>'
          + (f'<text class="cc-lab" x="{x_lab:.1f}" y="{ry:.1f}" text-anchor="middle" fill="{INK2}" '
             f'font-size="0.62em">{escape(roles[n])}</text>' if roles[n] else '') + '</a>')
    o(f'<a href="{attr(whole)}"><g transform="translate({C[0]:.0f} {C[1]:.0f})">{NOTE}</g>'
      f'<text class="cc-lab" x="{C[0]:.0f}" y="266" text-anchor="middle" fill="{INK}" font-weight="bold" '
      f'font-size="1.25em" stroke-width="5px">{escape(title)}</text></a>')
    if play:
        o(f'<a class="cc-play" href="/rabbithole/?track={attr(play)}" aria-label="Play {escape(title)} in Rabbithole">'
          f'<text x="{C[0] + tw(title, FS * 1.25, True) / 2 + 14:.1f}" y="266" fill="{INK}" font-weight="bold">▶</text></a>')
    for x, y, _, e, more in edges:                                  # the lines say where else the two have played
        mx, my = (pos[x][0] + pos[y][0]) / 2, (pos[x][1] + pos[y][1]) / 2
        tail = f' (+{more - 1} more)' if more > 1 else ''
        o(f'<g class="cc-h">{tip([f"{x} & {y}", "also: " + e["text"] + tail], mx, my)}</g>')
    for n in ring:
        x, y = pos[n]
        ev = elsewhere(n)
        here = f"on {cut['title']}" + (f", {cut['date']}" if cut['date'] else '')
        where = ('elsewhere: ' + ev[0]['text'] + (f' (+{len(ev) - 1} more)' if len(ev) > 1 else '')) if ev else here
        head = n + (f' · {roles[n]}' if roles[n] else '')
        o(f'<g class="cc-h"><a href="{attr(viewer(p=n))}"><circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="transparent"/></a>'
          f'<rect x="{labels[n][3][0]:.1f}" y="{labels[n][3][1]:.1f}" width="{labels[n][3][2] - labels[n][3][0]:.1f}" '
          f'height="{labels[n][3][3] - labels[n][3][1]:.1f}" fill="transparent"/>'
          f'{tip([head, where], x, y)}</g>')
    o('</svg>')

    legend = ('<div class="cc-legend">'
              '<span class="cc-key cc-gold"></span> <a href="/wiki/PickiPedia:Release_Types">Permanent Release</a>: '
              "an etree tape or Creative Commons<br>"
              '<span class="cc-key cc-ink"></span> Full Release: no DRM '
              '<span class="cc-key cc-rest"></span> the rest<br>'
              'a solid line: the same cut again · a thin one: a record or a stage</div>')
    record = f'<a href="{attr(cut["page"])}">{escape(cut["title"])}</a>' if cut['page'] else escape(cut['title'])
    which = ', track ' + escape(cut['number']) if cut.get('number') else ''
    took = ', recorded ' + escape(cut['recorded']) if cut.get('recorded') else ''
    playnote = ' The ▶ opens it in Rabbithole.' if play else ''
    return (f'<div class="connectome-card" data-song="{attr(title)}" data-cut="{attr(cut.get("key", ""))}">'
            f'<div class="cc-head">Connectome <a class="cc-explore" href="{attr(whole)}">⤢ explore</a></div>'
            + ''.join(out) + legend +
            f'<div class="cc-foot">On {record}{which}{took}.{playnote}</div></div>')


PAGE = ('<circle r="21" fill="%s" stroke="%s" stroke-width="1.5"/>' % (PAPER, INK) +
        '<path d="M-7 -11 h9 l5 5 v17 h-14 z" fill="%s" stroke="%s" stroke-width="1.6" stroke-linejoin="round"/>'
        % (PAPER, INK) +
        '<path d="M2 -11 v5 h5 M-4 -1 h8 M-4 3 h8 M-4 7 h5" fill="none" stroke="%s" stroke-width="1.3"/>' % INK)


def played_way(store, s, t):
    """The fewest jumps from s to t, a jump being two who played together on a stage or a track (as the
    challenge and the big graph count them; a shared record is no jump): [s, ..., t], or None."""
    if s == t:
        return [s]
    prev, front = {s: None}, [s]
    while front and t not in prev:
        nxt = []
        for u in front:
            for o, p in sorted(store.by[u], key=lambda op: op[0]):
                if p['kind'] in ('track', 'show') and o not in prev:
                    prev[o] = u
                    nxt.append(o)
        front = nxt
    if t not in prev:
        return None
    way = [t]
    while prev[way[-1]] is not None:
        way.append(prev[way[-1]])
    return way[::-1]


def page_order(title, members, store):
    """The pickers a page links, as its graph takes them: once each, the store's own, those with the most ties among
    the page's own first, then those with the most company. Returns (ranked, ties: name -> those of the page's own
    they played with, on a stage or a track; a shared record isn't playing together)."""
    members = [n for n in dict.fromkeys(members) if n != title and n in store.by]

    def played(x, y):
        ev = store.evidence(x, y)
        return bool(ev) and any(e['kind'] != 'record' for e in ev['list'])

    ties = {n: [o for o in members if o != n and played(n, o)] for n in members}
    return sorted(members, key=lambda n: (-len(ties[n]), -len(store.by[n]), n)), ties


def page_card(title, members, store, has_page, inst, home=HOME):
    """A page's own bacon graph (Justin, #connectome, 17 Nov 2026, 19:39Z: "a tag which makes a graph for the
    page itself, understand every linked page as a connection through that page ... a reasonable way to connect,
    for example, awards pages"): the page in the middle, the pickers it links round it, and a line between two of
    them where the store knows they played together. Being on the page together joins them here and nowhere else
    (19:42Z: "only for the purposes of that page. It doesn't otherwise count as a connectome link unless it has
    some other reason to"): the lines out from the middle are faint, and the store, the big graph and every jump
    stay as they were. members: the pickers the page links, as the store names them. Those with the most ties
    among the page's own come first, PAGE_MOST at most, each set beside one they played with where it can be."""
    ranked, ties = page_order(title, members, store)
    if not ranked:
        return None
    chosen, more = ranked[:PAGE_MOST], max(0, len(ranked) - PAGE_MOST)
    ring, left = [], list(chosen)
    while left:                                     # round the ring: next, one the last played with, if any is left
        last = ring[-1] if ring else None
        n = next((o for o in left if last is not None and o in ties[last]), left[0])
        ring.append(n)
        left.remove(n)
    roles = {n: inst.get(n, '') for n in ring}
    r = SONG_RING + max(0, len(ring) - 8) * 9
    step = 360 / len(ring)
    pos = {n: pol(r, -90 + step / 4 + step * i) for i, n in enumerate(ring)}

    def label(n, below=None):
        x, y = pos[n]
        if below is None:
            below = y > C[1] + 1
        w = max(tw(n, bold=True), tw(roles[n]) * 0.62 if roles[n] else 0)
        ny = y + 17 + FS * 0.8 if below else y - 17
        top = ny - FS * 0.8 if below else ny - FS * 1.5
        h = FS * (1.55 if roles[n] else 1.0)
        return [x, ny, below, (x - w / 2, top, x + w / 2, top + h)]

    labels = {}
    for n in ring:                                  # a label that runs into one placed flips sides
        lb = label(n)
        if any(hits(lb[3], L[3]) for L in labels.values()):
            lb = label(n, below=not lb[2])
        labels[n] = lb
    boxes = [L[3] for L in labels.values()]        # the page's own name isn't drawn: the card is on that page

    edges = []
    for i, x in enumerate(ring):
        for y in ring[i + 1:]:
            ev = store.evidence(x, y)
            if not ev:
                continue
            with_ = [e for e in ev['list'] if e['kind'] != 'record']
            e = (with_ or ev['list'])[0]
            s, t = trim_svg(pos[x], pos[y], 12, 12)
            if not with_ or e['tier'] == 0:         # only a record shared, or nothing to vouch for it: dotted
                html = line_svg(s, t, stroke=SHUT, stroke_width=1.2, stroke_dasharray='1 5', stroke_linecap='round')
            else:
                col = GOLD if e['tier'] == 2 else INK2
                html = line_svg(s, t, stroke=col, stroke_width=2.2 if e['kind'] == 'track' else 1.4,
                                stroke_linecap='round')
            said = e['text'] if with_ else 'on a record: ' + e['text']
            edges.append((x, y, html, dict(e, text=said), len(ev['list'])))

    xs = [C[0]] + [p[0] for p in pos.values()] + [b[0] for b in boxes] + [b[2] for b in boxes]
    ys = [C[1]] + [p[1] for p in pos.values()] + [b[1] for b in boxes] + [b[3] for b in boxes]
    x0, y0, x1, y1 = min(xs) - 14, min(ys) - 14, max(xs) + 14, max(ys) + 14
    if x1 - x0 < PAGE_WIDE:                         # room for a note's line, however few are round the page
        x0, x1 = x0 - (PAGE_WIDE - (x1 - x0)) / 2, x1 + (PAGE_WIDE - (x1 - x0)) / 2

    def tip(lines, x, y):
        return tip_box(lines, x, y, (x0, y0, x1, y1))

    out = []
    o = out.append
    o(f'<svg xmlns="http://www.w3.org/2000/svg" class="cc" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" '
      f'width="100%" font-family="Georgia, serif" font-size="{FS:g}" role="img" '
      f'aria-label="{attr("The pickers " + title + " names, and who of them played together")}">')
    here = attr(viewer(page=title))                 # the paper and the middle: this page's graph on the big one
    o(f'<a class="cc-bg" href="{here}" aria-label="{attr("Explore " + title + " on the big graph")}">'
      f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}" fill="{PAPER}"/></a>')
    for n in ring:                                  # on the page together: here and only here; a hairline, not a tie
        s, t = trim_svg(C, pos[n], 22, 12)
        o(line_svg(s, t, stroke=SHUT, stroke_width=1, opacity=0.35))
    for _, _, html, _, _ in edges:
        o(html)
    for n in ring:
        x, y = pos[n]
        if roles[n]:
            href = attr(ICON.format(urllib.parse.quote(roles[n])))
            ic = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="14" fill="{PAPER}" stroke="{INK}" stroke-width="2"/>'
                  f'<image href="{href}" x="{x - 10:.1f}" y="{y - 10:.1f}" width="20" height="20"></image>')
        else:
            ic = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="10" fill="{INK if has_page(n) else PAPER}" '
                  f'stroke="{INK}" stroke-width="1.5"/>')
        x_lab, ny, below, _ = labels[n]
        ry = ny + FS * 1.05 if below else ny - FS * 1.05
        o(f'<a href="{attr(viewer(p=n))}">{ic}<text class="cc-lab" x="{x_lab:.1f}" y="{ny:.1f}" '
          f'text-anchor="middle" fill="{INK}" font-weight="bold">{escape(n)}</text>'
          + (f'<text class="cc-lab" x="{x_lab:.1f}" y="{ry:.1f}" text-anchor="middle" fill="{INK2}" '
             f'font-size="0.62em">{escape(roles[n])}</text>' if roles[n] else '') + '</a>')
    o(f'<a href="{here}"><g transform="translate({C[0]:.0f} {C[1]:.0f})"><title>{escape(title)}</title>{PAGE}</g></a>')
    for x, y, _, e, n_ev in edges:                  # a line says where the two played together
        mx, my = (pos[x][0] + pos[y][0]) / 2, (pos[x][1] + pos[y][1]) / 2
        tail = f' (+{n_ev - 1} more)' if n_ev > 1 else ''
        o(f'<g class="cc-h">{tip([f"{x} & {y}", e["text"] + tail], mx, my)}</g>')
    for n in ring:
        x, y = pos[n]
        lines = [n + (f' · {roles[n]}' if roles[n] else '')]
        if ties[n]:
            lines.append('played with ' + ties[n][0] + (f' and {len(ties[n]) - 1} more' if len(ties[n]) > 1 else ''))
        if n != home:
            way = played_way(store, n, home) if home in store.by else None
            if way:
                jumps = len(way) - 1
                lines.append(f'{jumps} jump{"s" if jumps != 1 else ""} from {home}')
                if jumps > 1:
                    lines.append(f'by way of {way[1]}')
        box = labels[n][3]
        o(f'<g class="cc-h"><a href="{attr(viewer(p=n))}"><circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="transparent"/>'
          f'<rect x="{box[0]:.1f}" y="{box[1]:.1f}" width="{box[2] - box[0]:.1f}" height="{box[3] - box[1]:.1f}" '
          f'fill="transparent"/></a>{tip(lines, x, y)}</g>')
    o('</svg>')

    legend = ('<div class="cc-legend">'
              '<span class="cc-key cc-gold"></span> <a href="/wiki/PickiPedia:Release_Types">Permanent Release</a>: '
              "an etree tape or Creative Commons<br>"
              '<span class="cc-key cc-ink"></span> Full Release: no DRM '
              '<span class="cc-key cc-rest"></span> the rest<br>'
              'a line between two: they played together; dotted: only a record, or the rest · '
              'a hairline from the middle: on this page, and only here'
              '</div>')
    count = f'{len(ring)} of the pickers this page links' + (f' ({more} more not drawn)' if more else '')
    return (f'<div class="connectome-card" data-page="{attr(title)}">'
            f'<div class="cc-head">Connectome <a class="cc-explore" href="{here}">⤢ explore</a></div>'
            + ''.join(out) + legend +
            f'<div class="cc-foot">{escape(count)}. A name opens their bacon graph.</div></div>')

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
    venue, city = ('venue', 'city') if 'venue' in cols else ("''", "''")     # or before shows kept where they were
    poster = 'poster' if 'poster' in cols else "''"                           # or their posters
    bands = 'bands' if 'bands' in cols else "''"                              # or a show page's bands
    whole = {r[0]: {'kind': r[1], 'title': r[2], 'date': r[3], 'artist': r[4], 'grp': r[5],
                    'formats': [f for f in (r[6] or '').split('; ') if f], 'venue': r[7] or '', 'city': r[8] or '',
                    'poster': r[9] or '', 'bands': json.loads(r[10]) if r[10] else []}
             for r in db.execute(f'SELECT id, kind, title, date, artist, grp, {formats}, {venue}, {city}, {poster}, {bands} '
                                 'FROM targets')}
    credits = db.execute('SELECT person, roles, target, scope, source FROM credits').fetchall()
    return whole, credits


def build(pairs, targets, groups, wiki, today, only=None, whole=None, credits=()):
    names = {p['a'] for p in pairs} | {p['b'] for p in pairs} | {c[0] for c in credits}   # a credit's spelling joins too
    # and each name a record's artist credit gives, so who made it is known by the wiki's own name
    names |= {n for d in (whole or {}).values() if d.get('kind') == 'record' for n in connectome_graph.credited(d.get('artist', ''))}
    resolved = wiki.resolve(names)
    alias = {n: (t if ok else n) for n, (t, ok) in resolved.items()}
    exists = {t for t, ok in resolved.values() if ok}
    tiers = {t: connectome_graph.tier(t, d.get('formats')) for t, d in (whole or {}).items()}
    shows = {t for t, d in (whole or {}).items() if d.get('kind') == 'show'} if whole else None
    store = Store(pairs, targets, groups, alias, tiers, shows)

    # The featured pickers are set aside for now (Justin, #connectome, 15 Nov 2026): the page isn't read.
    month, featured = None, []
    inst = wiki.instruments()

    def has_page(n):
        return n in exists

    musicians = [only] if only and not only.startswith('Song:') else ([] if only else wiki.musician_pages())
    pics = wiki.portraits(musicians) if musicians else {}   # each musician page's own picture, for the big graph
    graph = None
    song_cards = {}
    cut_cards = {}
    if whole is not None:                            # the big graph's one file, from the same store and names
        # The song pages' own cuts are the source (magent, #connectome, 15 Nov 2026); the store's credits
        # and pairs stay out of songcast — a page's key is the song's real title, and the store's arthel
        # slugs made ghosts beside them. The icons the wiki keeps decide what a role draws.
        icons = wiki.instrument_icons() if hasattr(wiki, 'instrument_icons') else set()
        cutmap = {}
        for page_title, cs in (wiki.studio_cuts() if hasattr(wiki, 'studio_cuts') else {}).items():
            song_title = page_title[len('Song:'):] if page_title.startswith('Song:') else page_title
            entry = []
            for c in cs:
                target = next((t for t, d in whole.items() if d.get('kind') == 'record' and d.get('title') == c['record']), None)
                if target is None:
                    continue
                entry.append({'record': c['record'], 'number': c['number'], 'cid': c['cid'],
                              'recorded': c.get('recorded', ''), 'target': target,
                              'cast': {alias.get(n, n): r for n, r in c['cast'].items()},
                              'writers': [alias.get(n, n) for n in c.get('writers', [])],
                              'charts': [[sec, kind, alias.get(who, who), inst] for sec, kind, who, inst in c.get('charts', [])]})
            if entry:
                cutmap[song_title] = entry
        # The recording artist of each cut: the record page's {{Record|artist=}} — the node a route home
        # points at when a reader walks out of a cut's graph (Justin, #connectome, 15 Nov 2026, 04:53Z).
        recs = sorted({c['record'] for cs in cutmap.values() for c in cs})
        artists = wiki.record_artists(recs) if recs and hasattr(wiki, 'record_artists') else {}
        for cs in cutmap.values():
            for c in cs:
                c['artist'] = artists.get(c['record'], '')
        asked = connectome_graph.arthel_pages(store.pairs, whole, song)
        found = wiki.resolve(asked) if asked else {}
        # The store's arthel slugs are titles of their own mind ('To' where the page has 'to'); ask the
        # pages' own titles too, so a cut's card reaches the page it sits on.
        stale = ['Song:' + s for s in cutmap if 'Song:' + s not in found]
        if stale:
            found.update(wiki.resolve(stale))
        pages = {n: page_url(t) for n, (t, ok) in found.items() if ok}
        song_page = {t: n[len('Song:'):] for n, (t, ok) in found.items() if ok and n.startswith('Song:')}
        heard = wiki.listens(song_page) if song_page else {}
        plays = {song_page[t]: cid for t, cid in heard.items() if t in song_page}
        # cryptograss's own records, as their Record pages give them (Justin, #connectome, 15 Nov 2026): the
        # artist, so a cut says whose it is; and the art, drawn in the record's circle and its cuts'.
        own = sorted({d['title'] for t, d in whole.items() if t.startswith('arthel:') and d.get('kind') == 'record'
                      and d.get('title')})
        who = wiki.record_artists(own) if own and hasattr(wiki, 'record_artists') else {}
        art = wiki.record_art(own) if own and hasattr(wiki, 'record_art') else {}
        for t, d in whole.items():
            if t.startswith('arthel:') and d.get('kind') == 'record':
                if who.get(d.get('title')) and not d.get('artist'):
                    d['artist'] = alias.get(who[d['title']], who[d['title']])
                if art.get(d.get('title')):
                    d['art'] = art[d['title']]
        # A show's poster, in its circle as a record's art is (connectome_store.py, arthel_poster and tape_poster):
        # a small picture's address as it stands; a wiki file only where the wiki has it, so a poster not yet put
        # there draws nothing rather than a broken picture.
        files = sorted({'File:' + d['poster'] for d in whole.values() if d.get('kind') == 'show' and d.get('poster')
                        and not d['poster'].startswith('https://')})
        there = {n[len('File:'):] for n, (_, ok) in (wiki.resolve(files) if files else {}).items() if ok}
        for d in whole.values():
            p = d.get('poster') if d.get('kind') == 'show' else ''
            if p and (p.startswith('https://') or p in there):
                d['art'] = p
        # Who made each record, by the wiki's own names: the recording artist stands first at the end of a
        # song's line (Justin, #connectome, 15 Nov 2026, 07:29Z), and a credit writes "Bronwyn Keith-Hynes"
        # where her page is Bronwyn.
        for t, d in whole.items():
            if d.get('kind') == 'record':
                d['makers'] = [alias.get(n, n) for n in connectome_graph.credited(d.get('artist', ''))]
            if d.get('bands'):                                      # a show page's bands, by the wiki's names
                d['bands'] = [{'title': b.get('title', ''), 'members': [alias.get(n, n) for n in b.get('members', [])]}
                              for b in d['bands']]
        graph = connectome_graph.export(
            store.pairs, whole, [(alias.get(c[0], c[0]),) + tuple(c[1:]) for c in credits],
            has_page, inst, featured, month, song, pages, today.isoformat(), plays, cutmap, icons,
            pics=pics)
        # Who wrote each song, where its page says (Justin, #connectome, 23 Nov 2026, 18:30Z: a song's card says
        # "by <author(s)>" or "traditional", and its pills the authors "in most situations"): song -> [names], or
        # 'traditional'. Only songs the graph names: a track's songs, and the cuts'.
        named = {s for _, _, ev in graph['ties'] for e in ev for s in e[3]} | {c['song'] for c in graph['songcast'].values()}
        heard_by = wiki.song_authors() if hasattr(wiki, 'song_authors') else {}
        # keyed by the graph's own name for the song: a store's slug may say "Barlows Jig" for "Barlow's Jig"
        by_key = {song_key(s): said for s, said in heard_by.items()}
        graph['authors'] = {s: by_key[song_key(s)] for s in sorted(named) if song_key(s) in by_key}
        # The places and the acts of the shows, where the wiki has a page for them (Justin, #connectome, 26 Nov 2026,
        # 02:15Z: "The venue also makes sense to have a bacon vector, at least if it has a pickipedia page"): name ->
        # its page. A venue or an act with no page is drawn all the same, and goes nowhere.
        places = {m[9][1] for m in graph['music'] if len(m) > 9 and m[9][1]} | \
                 {a[0] for acts in graph.get('acts', {}).values() for a in acts if a[0]}
        placed = wiki.resolve(sorted(n for n in places if not re.search(r'[\[\]{}|#<>]', n))) if places and hasattr(wiki, 'resolve') else {}
        graph['wikipages'] = {n: page_url(tt) for n, (tt, ok) in sorted(placed.items()) if ok}
        # Song cards: one graph per cut, the page's file carrying each of its cuts in the page's own order
        # (Justin, #connectome, 15 Nov 2026, 01:58Z: each cut displays its own graph).
        songcast = graph.get('songcast') or {}
        people = graph.get('people') or []
        targets = graph.get('music') or []
        real = {t for t, ok in found.values() if ok}                # found is keyed by the asked slug; the
        for song_title, cs in cutmap.items():                       # page's own title is what a cut names
            page_title = 'Song:' + song_title
            if page_title not in real or (only and only != page_title):
                continue
            parts = []
            for c in cs:
                key = c['cid'] or (c['target'] + '|' + song_title if song_title else '')
                sc = songcast.get(key)
                if not sc or not sc['pickers'] or not sc['on']:
                    continue
                cast = [(people[i][0], r) for i, r, _ in sc['pickers'] if 0 <= i < len(people)]
                cut = song_cut(whole, tiers, pages, targets[sc['on'][0]][0])
                if not cast:
                    continue
                cut['key'] = key
                cut['number'] = sc.get('number', '')
                cut['recorded'] = sc.get('recorded', '')
                html = song_card(song_title, cut, cast, store, has_page, inst, play=c['cid'], icons=icons)
                if html:
                    parts.append(html)
                    cut_cards.setdefault(page_title, {})[f"{c['record']}|{c['number']}|{c['cid']}"] = html
            if parts:
                song_cards[page_title] = ''.join(parts)
    # The cards, once whose each record and song is is known: a card names a song's artist before its sidemen.
    made, wrote = owners(graph) if graph else ({}, {})
    cards, skipped = {}, []
    for title in musicians:
        html = card(title, store, has_page, inst, made=made, wrote=wrote) if title in store.by else None
        if html is None:
            skipped.append(title)
        else:
            cards[title] = html
    # The pages that ask for a graph of their own ({{Bacon graph of this page}}): the pickers they link, through
    # the wiki's redirects, round them. A picker's own page, or a song's, keeps the card it has.
    page_cards = {}
    if not (only and only.startswith('Song:')):
        asking = [only] if only else (wiki.bacon_pages() if hasattr(wiki, 'bacon_pages') else [])
        asking = [t for t in asking if t not in cards and t not in song_cards]
        linked = wiki.links(asking) if asking and hasattr(wiki, 'links') else {}
        seen = wiki.resolve(sorted({x for xs in linked.values() for x in xs})) if linked else {}
        for t in asking:
            html = page_card(t, [seen.get(x, (x, False))[0] for x in linked.get(t, [])], store, has_page, inst)
            if html:
                page_cards[t] = html
                if graph is not None:
                    idx = {row[0]: i for i, row in enumerate(graph.get('people') or [])}
                    ranked, _ = page_order(t, [seen.get(x, (x, False))[0] for x in linked.get(t, [])], store)
                    graph.setdefault('pages', {})[t] = [idx[n] for n in ranked if n in idx]
    return {'month': month, 'featured': featured, 'cards': cards, 'skipped': sorted(skipped), 'graph': graph,
            'song_cards': song_cards, 'cut_cards': cut_cards, 'page_cards': page_cards,
            'pairs': store.pairs, 'names': {k: sorted(v) for k, v in sorted(store.raw.items())}}


def write(result, out_dir, built_from):
    os.makedirs(os.path.join(out_dir, 'cards'), exist_ok=True)
    for title, html in result['cards'].items():
        with open(os.path.join(out_dir, 'cards', card_file(title)), 'w') as f:
            f.write(html)
    for title, html in result.get('song_cards', {}).items():
        with open(os.path.join(out_dir, 'cards', card_file(title)), 'w') as f:
            f.write(html)
    for title, html in result.get('page_cards', {}).items():
        with open(os.path.join(out_dir, 'cards', card_file(title)), 'w') as f:
            f.write(html)
    # Each cut its own file, named as Connectome::cutFileFor names it: the page's title and the cut's own
    # params, as {{Studio cut}} passes them (Justin, #connectome, 15 Nov 2026: the graph lives with the block).
    for title, cuts in result.get('cut_cards', {}).items():
        for key, html in cuts.items():
            record, number, cid = (key.split('|') + ['', '', ''])[:3]
            with open(os.path.join(out_dir, 'cards',
                                   card_file(title + '|' + record + '|' + number + '|' + cid)), 'w') as f:
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
                   'song_cards': {t: card_file(t) for t in sorted(result.get('song_cards', {}))},
                   'page_cards': {t: card_file(t) for t in sorted(result.get('page_cards', {}))},
                   'cut_cards': {t: {k: card_file(t + '|' + k) for k in sorted(ks)}
                                 for t, ks in sorted(result.get('cut_cards', {}).items())},
                   'no_card': result['skipped'], 'built_from': built_from}, f, indent=1)


def main(argv):
    ap = argparse.ArgumentParser(description='Connectome cards for musician pages.')
    ap.add_argument('--db', required=True)
    ap.add_argument('--pairs', required=True)
    ap.add_argument('--wiki', default='https://pickipedia.xyz/')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', help='one page title, for trying a card')
    ap.add_argument('--today', help="YYYY-MM-DD; the build's date")
    ap.add_argument('--arthel', help="arthel's src/data: the shows whose set stones graph.json carries (set_stones.py)")
    a = ap.parse_args(argv)
    today = date.fromisoformat(a.today) if a.today else date.today()
    pairs, targets, groups = load_store(a.db, a.pairs)
    whole, credits = load_whole(a.db)
    result = build(pairs, targets, groups, Wiki(a.wiki), today, a.only, whole, credits)
    if a.arthel and result.get('graph') is not None:
        set_stones.into(result['graph'], a.arthel)
    write(result, a.out, {'db': os.path.basename(a.db), 'wiki': a.wiki, 'today': today.isoformat()})
    print(f"{len(result['cards'])} cards; "
          f"{len(result.get('song_cards', {}))} song cards; "
          f"{len(result.get('page_cards', {}))} page cards; "
          f"no card for {len(result['skipped'])} pages", file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1:])
