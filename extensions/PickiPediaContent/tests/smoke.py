#!/usr/bin/env python3
"""A smoke test for the studio modules: the source on one side, the result on the other.

It asks a running wiki for every page that carries a {{Studio cut}}, reads what the
page's source says (who played what, on which record, which release), and reads what
the wiki made of it: the rendered page, and the facts Semantic MediaWiki stored. Then
it checks that the second follows from the first. Record pages and musician pages are
checked the same way, against the song pages' sources, because that is where their
lists come from.

No expected value is written here. What a page should show is worked out from its
own source each run; a link is found by the page it names, and a URL is checked by
opening it and reading which page and action the wiki says it served. Which
parameters are session details and not players is read from lua/pickipedia/studio.lua,
the module in this checkout, so a wiki running an older module fails here rather than
passing by agreement. What it does rely on: the class names our modules emit (the
ones tests/check-classes.php holds to the stylesheet), and three things of
MediaWiki's: a link's title names its page, a page says its wgPageName and wgAction,
and api.php.

    tests/smoke.py                              the live wiki
    tests/smoke.py --wiki http://host:4010      a preview
    tests/smoke.py -v                           every check, not only each page's tally
    tests/smoke.py --page "Song:August"         one page (repeatable)

It only reads: GET requests, no sign-in, nothing saved. Sources that no page has
(a cut nobody can identify, a lineup with nobody in it) go through the parser with
action=parse, which renders text without saving it.

Python 3, standard library only.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

AGENT = 'pickipedia-smoke/1.0 (extensions/PickiPediaContent/tests/smoke.py)'
MODULE = Path(__file__).resolve().parent.parent / 'lua' / 'pickipedia' / 'studio.lua'


# --- asking the wiki ---------------------------------------------------------------

class Wiki:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.api = self.base + '/api.php'
        self.known = {}  # a title as written -> the page it names
        self._missing = None

    @property
    def missing(self):
        """How this wiki titles a link to a page nobody has written, as a pattern: its own message, not a guess."""
        if self._missing is None:
            said = self.get(action='query', meta='allmessages', ammessages='red-link-title')['query']['allmessages']
            words = (said[0].get('content') if said else None) or '$1 (page does not exist)'
            self._missing = re.compile('^' + re.escape(words).replace(re.escape('$1'), '(.*)') + '$')
        return self._missing

    def get(self, **params):
        params = {'format': 'json', 'formatversion': 2, **params}
        url = self.api + '?' + urllib.parse.urlencode(params)
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=60) as r:
            answer = json.load(r)
        if 'error' in answer:
            raise RuntimeError(f"{answer['error'].get('code')}: {answer['error'].get('info')}")
        return answer

    def learn(self, titles):
        """Ask which page each title names: [[Justin Holmes]] and [[Justin Myles Holmes]] are one page."""
        unknown = sorted({t for t in titles if t and t not in self.known})
        for i in range(0, len(unknown), 40):
            query = self.get(action='query', titles='|'.join(unknown[i:i + 40]), redirects=1)['query']
            moved = {m['from']: m['to'] for m in query.get('normalized', [])}
            redirected = {m['from']: m['to'] for m in query.get('redirects', [])}
            for title in unknown[i:i + 40]:
                named = moved.get(title, title)
                self.known[title] = redirected.get(named, named)

    def named(self, title):
        """The page a title names, redirects followed."""
        if title not in self.known:
            self.learn([title])
        return self.known.get(title, title)

    def same(self, a, b):
        return self.named(a) == self.named(b)

    def using(self, template, namespace=None):
        """Titles of the pages that transclude `template`, optionally in one namespace (by name)."""
        params = {'action': 'query', 'list': 'embeddedin', 'eititle': template, 'eilimit': 500}
        if namespace is not None:
            spaces = self.get(action='query', meta='siteinfo', siprop='namespaces')['query']['namespaces']
            ids = [n['id'] for n in spaces.values() if n.get('name') == namespace]
            if not ids:
                return []
            params['einamespace'] = ids[0]
        return [p['title'] for p in self.get(**params)['query']['embeddedin']]

    def page(self, title):
        """(source, rendered) of a page as it stands."""
        parsed = self.get(action='parse', page=title, prop='wikitext|text', disablelimitreport=1)['parse']
        return parsed['wikitext'], Html.read(parsed['text'])

    def render(self, source, title):
        """`source` through the wiki's parser as if it were on `title`. Nothing is saved."""
        parsed = self.get(action='parse', text=source, title=title, prop='text', contentmodel='wikitext',
                          disablelimitreport=1)['parse']
        return Html.read(parsed['text'])

    def stored(self, title):
        """What Semantic MediaWiki holds of the page's cuts: [{cut, performer, instruments, record, number, release}]."""
        answer = self.get(action='ask', query=f'[[-Has subobject::{title}]]|?Has cut|?Has performer|?Has instrument'
                                                '|?Has record|?Has track number|?Has release|limit=500')
        results = answer.get('query', {}).get('results') or {}
        rows = []
        for found in (results.values() if isinstance(results, dict) else results):
            out = found.get('printouts', {})
            name = lambda values: [v['fulltext'] if isinstance(v, dict) else str(v) for v in values]
            if out.get('Has cut'):
                rows.append({'cut': name(out['Has cut'])[0], 'performer': (name(out.get('Has performer', [])) or [''])[0],
                             'instruments': name(out.get('Has instrument', [])),
                             'record': (name(out.get('Has record', [])) or [''])[0],
                             'number': (name(out.get('Has track number', [])) or [''])[0],
                             'release': (name(out.get('Has release', [])) or [''])[0]})
        return rows

    def opens(self, url):
        """(status, body) of an address a page links to."""
        if url.startswith('//'):
            url = 'https:' + url
        elif url.startswith('/'):
            url = self.base + url
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=60) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', 'replace')


# --- reading the two sides ---------------------------------------------------------

def calls(source, template):
    """Each {{template|...}} in `source`, as {parameter: value}. Positional ones are numbered from '1'."""
    source = re.sub(r'<!--.*?-->|<nowiki>.*?</nowiki>|<pre>.*?</pre>', '', source, flags=re.S)
    wanted = template.replace('_', ' ').lower()
    found, at = [], 0
    while True:
        at = source.find('{{', at)
        if at < 0:
            return found
        depth, i, parts, last = 0, at, [], at + 2
        while i < len(source):
            two = source[i:i + 2]
            if two in ('{{', '[['):
                depth, i = depth + 1, i + 2
            elif two in ('}}', ']]'):
                depth, i = depth - 1, i + 2
                if depth == 0:
                    break
            else:
                if source[i] == '|' and depth == 1:
                    parts.append(source[last:i])
                    last = i + 1
                i += 1
        parts.append(source[last:i - 2])
        if parts[0].strip().replace('_', ' ').lower() == wanted:
            params, n = {}, 0
            for part in parts[1:]:
                key, equals, value = part.partition('=')
                if equals and not re.search(r'[\[\]{}]', key):
                    params[key.strip()] = value.strip()
                else:
                    n += 1
                    params[str(n)] = part.strip()
            found.append(params)
            at = i
        else:
            at += 2


def session_parameters():
    """The {{Studio cut}} parameters the module in this checkout reads as session details, not players."""
    table = re.search(r'local NOT_A_PLAYER = \{(.*?)\}', MODULE.read_text(), flags=re.S)
    if not table:
        raise SystemExit(f'smoke.py: no NOT_A_PLAYER table in {MODULE}')
    return set(re.findall(r'(\w+)\s*=\s*true', table.group(1)))


def listed(value):
    """'guitar, vocals' -> ['guitar', 'vocals'], as the module splits it."""
    return [part.strip() for part in value.split(',') if part.strip()]


class Html(HTMLParser):
    """Rendered HTML as a small tree: enough to ask for a class, a link, the words."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}

    class Node:
        def __init__(self, tag, attrs, parent):
            self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

        def walk(self):
            for child in self.children:
                if isinstance(child, Html.Node):
                    yield child
                    yield from child.walk()

        def having(self, name):
            return [n for n in self.walk() if name in (n.attrs.get('class') or '').split()]

        def links(self):
            return [n for n in self.walk() if n.tag == 'a']

        def words(self):
            return re.sub(r'\s+', ' ', ''.join(c if isinstance(c, str) else c.words() for c in self.children)).strip()

    @classmethod
    def read(cls, html):
        reader = cls(convert_charrefs=True)
        reader.root = reader.at = cls.Node('root', {}, None)
        reader.feed(html)
        return reader.root

    def handle_starttag(self, tag, attrs):
        node = self.Node(tag, attrs, self.at)
        self.at.children.append(node)
        if tag not in self.VOID:
            self.at = node

    def handle_startendtag(self, tag, attrs):
        self.at.children.append(self.Node(tag, attrs, self.at))

    def handle_endtag(self, tag):
        node = self.at
        while node.parent is not None and node.tag != tag:
            node = node.parent
        if node.parent is not None:
            self.at = node.parent

    def handle_data(self, data):
        self.at.children.append(data)


def names(node, missing):
    """The page each wiki link under `node` names: MediaWiki puts it in the link's title."""
    out = []
    for a in node.links():
        kinds, title = (a.attrs.get('class') or '').split(), a.attrs.get('title') or ''
        if 'new' in kinds and missing.match(title):
            title = missing.match(title).group(1)
        if title and 'external' not in kinds:
            out.append(title)
    return out



# --- the checks ---------------------------------------------------------------------

class Tally:
    def __init__(self, verbose):
        self.verbose, self.failed, self.ran, self.page_failed, self.page_ran = verbose, 0, 0, 0, 0

    def check(self, name, ok, detail=''):
        self.ran += 1
        self.page_ran += 1
        if ok:
            if self.verbose:
                print(f'    ok   {name}')
        else:
            self.failed += 1
            self.page_failed += 1
            print(f'    FAIL {name}' + (f'\n         {detail}' if detail != '' else ''))

    def page(self, title, about):
        mark = 'FAIL' if self.page_failed else 'ok  '
        print(f'  {mark} {title}: {about}, {self.page_ran} checks' + (f', {self.page_failed} FAILED' if self.page_failed else ''))
        self.page_failed = self.page_ran = 0


def players_of(wiki, cut, session):
    """{the page a player's name means: the instruments written beside it}."""
    written = {name: value for name, value in cut.items() if name not in session and not name.isdigit()}
    wiki.learn(written)
    return {wiki.named(name): value for name, value in written.items()}


def pages(wiki, node):
    """The pages the wiki links under `node` name, redirects followed."""
    found = names(node, wiki.missing)
    wiki.learn(found)
    return [wiki.named(title) for title in found]


def check_cut(tally, wiki, cut, shown, session):
    """One {{Studio cut}} as written against the one row the wiki rendered for it."""
    players = players_of(wiki, cut, session)
    rendered = {}
    for who, what in zip(shown.having('pp-players-who'), shown.having('pp-players-what')):
        rendered[(pages(wiki, who) or [who.words()])[0]] = what.words()
    tally.check('the players shown are the players written, and nobody else',
                sorted(rendered) == sorted(players) and len(shown.having('pp-players-who')) == len(players),
                f'written {sorted(players)}; shown {sorted(rendered)}')
    wrong = {p: (players[p], rendered[p]) for p in players if p in rendered and listed(rendered[p]) != listed(players[p])}
    tally.check('each with the instruments written beside them', not wrong, wrong)

    head = (shown.having('pp-row-head') or [shown])[0]
    record, number, cid = cut.get('record', ''), cut.get('number', ''), cut.get('cid', '')
    if record:
        tally.check('the heading links the record', wiki.named(record) in pages(wiki, head), pages(wiki, head))
        if number:
            beside = ' '.join(n.words() for n in head.having('pp-qualifier'))
            tally.check('and says which track', number in beside.split(), head.words())
    else:
        tally.check('a cut on no record is headed as one, with no record linked',
                    bool(shown.having('pp-unreleased')), head.words())
    note = ' '.join(n.words() for n in shown.having('pp-row-note'))
    missing = [f for f in ('recorded', 'studio', 'engineer', 'blockheight') if cut.get(f) and cut[f] not in note]
    tally.check('the session details written are shown', not missing, f'not shown: {missing}; the note: {note!r}')

    if not cid:
        return
    linked = pages(wiki, shown)
    tally.check('the release is linked', wiki.named(f'Release:{cid}') in linked, linked)
    tally.check('and its chart', wiki.named(f'Release:{cid}/Metadata') in linked, linked)
    # The two links that leave the wiki's pages are told apart by what answers, not by what they are called:
    # what an edit address looks like is MediaWiki's to decide, and what a link says is an editor's.
    outward = [a.attrs.get('href', '') for n in shown.having('pp-cut-links') for a in n.links()
               if 'external' in (a.attrs.get('class') or '').split()]
    answers = {href: wiki.opens(href) for href in outward}
    tally.check("one link opens the chart's edit form",
                any(status == 200 and re.search(r'"wgAction":\s*"edit"', body)
                    and re.search(r'"wgPageName":\s*"Release:' + re.escape(cid) + '/Metadata"', body)
                    for status, body in answers.values()),
                {href: status for href, (status, body) in answers.items()})
    tally.check('and one opens Rabbithole on this track',
                any(status == 200 and cid in urllib.parse.parse_qs(urllib.parse.urlsplit(href).query).get('track', [])
                    for href, (status, body) in answers.items()),
                {href: status for href, (status, body) in answers.items()})
    listen = [a.attrs.get('href', '') for n in shown.having('pp-cut-listen') for a in n.links()]
    tally.check('the listen button plays this track', any(cid in href for href in listen), listen)


def check_stored(tally, wiki, cuts, stored, session):
    """Every {{Studio cut}} on a page against what Semantic MediaWiki stored for the page."""
    wiki.learn([row['performer'] for row in stored] + [row['record'] for row in stored])
    by_cut = {}
    for row in stored:
        by_cut.setdefault(row['cut'], []).append(row)
    unmatched = dict(by_cut)
    performers = lambda rows: sorted(wiki.named(r['performer']) for r in rows if r['performer'])
    for n, cut in enumerate(cuts, 1):
        players = players_of(wiki, cut, session)
        which = f'cut {n}' if len(cuts) > 1 else 'the cut'
        match = next((id for id, rows in unmatched.items() if performers(rows) == sorted(players)), None)
        tally.check(f'{which} is stored, with the players written and nobody else', match is not None,
                    f'written {sorted(players)}; stored ' + str({id: performers(rows) for id, rows in by_cut.items()}))
        if match is None:
            continue
        rows = unmatched.pop(match)
        wrong = {r['performer']: r['instruments'] for r in rows if r['performer']
                 and sorted(r['instruments']) != sorted(listed(players[wiki.named(r['performer'])]))}
        tally.check('each with the instruments written', not wrong, wrong)
        if cut.get('record'):
            placed = [r for r in rows if r['record']]
            ok = (len(placed) == 1 and wiki.same(placed[0]['record'], cut['record'])
                  and (not cut.get('number') or placed[0]['number'] == cut['number'])
                  and (not cut.get('cid') or wiki.same(placed[0]['release'], 'Release:' + cut['cid'])))
            tally.check('and its place on the record: the record, the track number, the release', ok,
                        f"written {cut.get('record')!r} {cut.get('number', '')!r} {cut.get('cid', '')!r}; stored {placed}")
    if len(cuts) > 1:
        tally.check('each cut on the page is stored as its own', len(by_cut) >= len(cuts), sorted(by_cut))


def songs(wiki, tally, only, session):
    print('\nSong pages: each {{Studio cut}} as written, as shown, and as stored')
    sources = {}
    for title in wiki.using('Template:Studio cut', 'Song'):
        source, rendered = wiki.page(title)
        cuts = calls(source, 'Studio cut')
        sources[title] = cuts
        if only and title not in only:
            continue
        shown = rendered.having('pp-row--cut')
        tally.check('every cut written is shown, and none is refused', len(shown) == len(cuts),
                    f'{len(cuts)} written, {len(shown)} shown')
        for cut, row in zip(cuts, shown):
            check_cut(tally, wiki, cut, row, session)
        check_stored(tally, wiki, cuts, wiki.stored(title), session)
        tally.page(title, f'{len(cuts)} cut' + ('s' if len(cuts) != 1 else ''))
    return sources


def rows_of(wiki, rendered):
    """The rows a studio listing rendered: [(the pages its head links, the pages its detail links)]."""
    found = []
    for row in rendered.having('pp-row'):
        head, detail = row.having('pp-row-head'), row.having('pp-row-detail')
        if head and 'pp-row--cut' not in row.attrs.get('class', ''):
            found.append((pages(wiki, head[0]), pages(wiki, detail[0]) if detail else []))
    return found


def records(wiki, tally, only, sources, session):
    print('\nRecord pages: {{Record tracks}} against the song pages that name the record')
    for title in wiki.using('Template:Record tracks', ''):
        if only and title not in only:
            continue
        source, rendered = wiki.page(title)
        record = wiki.named((calls(source, 'Record tracks') or [{}])[0].get('1') or title)
        written = {}
        for song, cuts in sources.items():
            here = [cut for cut in cuts if cut.get('record') and wiki.named(cut['record']) == record]
            if here:
                written[song] = sorted({p for cut in here for p in players_of(wiki, cut, session)})
        shown = {}
        for head, detail in rows_of(wiki, rendered):
            for song in (n for n in head if n in sources):
                shown.setdefault(song, []).append(sorted(set(detail)))
        tally.check('the tracks listed are the songs that name this record, each once',
                    sorted(shown) == sorted(written) and all(len(rows) == 1 for rows in shown.values()),
                    f'named by {sorted(written)}; listed {sorted(shown)}')
        wrong = {song: (written[song], shown[song][0]) for song in shown if song in written and shown[song][0] != written[song]}
        tally.check("each track lists its own cut's players and nobody else's", not wrong, wrong)
        tally.page(title, f'{len(written)} tracks')


def musicians(wiki, tally, only, sources, session):
    print('\nMusician pages: {{In the studio}} against the song pages that name the musician')
    for title in wiki.using('Template:In the studio', ''):
        if only and title not in only:
            continue
        source, rendered = wiki.page(title)
        who = wiki.named((calls(source, 'In the studio') or [{}])[0].get('1') or title)
        written = {}
        for song, cuts in sources.items():
            for cut in cuts:
                if cut.get('record') and who in players_of(wiki, cut, session):
                    written.setdefault(wiki.named(cut['record']), set()).add(song)
        shown, strangers, wrong = set(), [], {}
        for head, detail in rows_of(wiki, rendered):
            record = next((r for r in written if r in head), None)
            listed_songs = sorted(n for n in detail if n in sources)
            if record is None:
                if listed_songs:
                    strangers.append((head, listed_songs))
                continue
            shown.add(record)
            if listed_songs != sorted(written[record]):
                wrong[record] = (sorted(written[record]), listed_songs)
        tally.check('every record shown is one they played on', not strangers, strangers)
        tally.check('and under each, the songs they played on it and no others', not wrong, wrong)
        hidden = sorted(set(written) - shown)
        tally.page(title, f'{len(shown)} of their {len(written)} records shown'
                   + (f' (not shown here: {", ".join(hidden)})' if hidden else ''))


def check_lineup(tally, wiki, lineup, shown):
    """One {{Lineup}} as written against the row the wiki rendered for it."""
    label, members = lineup.get('1') or lineup.get('name') or '', listed(lineup.get('2') or lineup.get('members') or '')
    wiki.learn(members)
    who = pages(wiki, (shown.having('pp-lineup-members') or [shown])[0])
    tally.check('its members are linked, in the order written', who == [wiki.named(m) for m in members],
                f'written {members}; shown {who}')
    if label:
        said = ' '.join(n.words() for n in shown.having('pp-lineup-label'))
        tally.check('under the label written', label in said, f'written {label!r}; shown {said!r}')


def lineups(wiki, tally, only):
    print('\nLineups: each {{Lineup}} as written and as shown')
    for title in wiki.using('Template:Lineup', ''):
        if only and title not in only:
            continue
        source, rendered = wiki.page(title)
        written, shown = calls(source, 'Lineup'), rendered.having('pp-lineup')
        tally.check('every lineup written is shown, and none is refused', len(shown) == len(written),
                    f'{len(written)} written, {len(shown)} shown')
        for lineup, row in zip(written, shown):
            check_lineup(tally, wiki, lineup, row)
        tally.page(title, f'{len(written)} lineups')


def unwritten(wiki, tally, session):
    """Sources no page carries, through the same parser: rendered, never saved."""
    print('\nSources no page has, rendered and not saved')
    refused = wiki.render('{{Studio cut|Somebody=guitar}}', 'Song:Smoke test')
    tally.check('a cut with nothing to identify it is refused, and says so',
                not refused.having('pp-row--cut') and bool(refused.having('error')), refused.words())
    loose = {'blockheight': '1', 'studio': 'a kitchen', 'Somebody': 'guitar'}
    shown = wiki.render('{{Studio cut|' + '|'.join(f'{k}={v}' for k, v in loose.items()) + '}}',
                        'Song:Smoke test').having('pp-row--cut')
    tally.check('a cut that never made a record is still a cut', len(shown) == 1)
    if shown:
        check_cut(tally, wiki, loose, shown[0], session)
    nothing = wiki.render('X{{#invoke:Studio sessions|tracks|A record nobody made}}X', 'Smoke test')
    tally.check('a record with no cuts lists nothing', nothing.words() == 'XX', nothing.words())
    empty = wiki.render('{{Lineup|21}}', 'Smoke test')
    tally.check('a lineup with nobody in it is refused, and says so',
                not empty.having('pp-lineup') and bool(empty.having('error')), empty.words())
    for written in ('{{Lineup|21|David Grier, }}', '{{Lineup|The Rhythm Section|  Jake Stargel ,  Skyler Golden }}',
                    '{{Lineup|name=34|members=David Grier}}'):
        shown = wiki.render(written, 'Smoke test').having('pp-lineup')
        tally.check(f'{written} is one lineup', len(shown) == 1)
        if shown:
            check_lineup(tally, wiki, calls(written, 'Lineup')[0], shown[0])
    tally.page('unwritten sources', '7 sources')



def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--wiki', default='https://pickipedia.xyz', help='the wiki to read (its api.php is asked)')
    parser.add_argument('--page', action='append', default=[], help='only this page (repeatable)')
    parser.add_argument('-v', '--verbose', action='store_true', help='print every check')
    args = parser.parse_args()

    wiki, tally, session = Wiki(args.wiki), Tally(args.verbose), session_parameters()
    print(f'smoke.py: {wiki.base}; session parameters per {MODULE.name}: {", ".join(sorted(session))}')
    sources = songs(wiki, tally, args.page, session)
    records(wiki, tally, args.page, sources, session)
    musicians(wiki, tally, args.page, sources, session)
    lineups(wiki, tally, args.page)
    if not args.page:
        unwritten(wiki, tally, session)
    print(f'\n{tally.ran} checks: ' + ('all passed.' if not tally.failed else f'{tally.failed} FAILED'))
    sys.exit(1 if tally.failed else 0)


if __name__ == '__main__':
    main()
