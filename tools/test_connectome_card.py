"""Tests for connectome_card.py: the card on a musician's page, from the connectome store."""
import hashlib
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
import connectome_card as cc  # noqa: E402

FEATURED = """{{Bot_proposes|intro|by=Blu}}

== 2026-12 ==
* [[Someone Later]]

== 2026-11 ==
* [[Justin Myles Holmes]]
* [[Jake Stargel|Jake]]
* [[Gaven_Largent]]

== 2026-10 ==
* [[Older Picker]]
"""


def pair(a, b, kind, target, tracks=()):
    return {'a': a, 'b': b, 'kind': kind, 'target': target, 'tracks': [list(t) for t in tracks]}


TARGETS = {
    'arthel:4masks': ('4masks', '', ''),
    'lma:show1': ('Kyle Live', '2025-07-05', 'Sam Grisman Project'),
    'discogs:1': ('Some Record', '2015', 'Somebody'),
}
GROUPS = {t: t for t in TARGETS}


class FakeWiki:
    def __init__(self, redirects=None, pages=(), musicians=(), inst=None, featured=FEATURED, listens=None, cuts=None,
                 record_artists=None):
        self.redirects, self.pages, self.heard = redirects or {}, set(pages), listens or {}
        self.musicians, self.inst, self.featured = list(musicians), inst or {}, featured
        self.cuts = cuts or {}
        self._ra = record_artists or {}

    def resolve(self, names):
        out = {}
        for n in names:
            t = self.redirects.get(n, n)
            out[n] = (t, t in self.pages)
        return out

    def raw(self, title):
        assert title == cc.FEATURED_PAGE
        return self.featured

    def listens(self, titles):
        return {t: self.heard[t] for t in titles if t in self.heard}

    def musician_pages(self):
        return self.musicians

    def instruments(self):
        return self.inst

    def portraits(self, titles):
        return {t: self.pics[t] for t in titles if t in getattr(self, 'pics', {})}

    def studio_cuts(self):
        return self.cuts

    def record_artists(self, titles):
        return {t: self._ra[t] for t in titles if t in self._ra}

    def record_art(self, titles):
        return {t: self.art[t] for t in titles if t in getattr(self, 'art', {})}


def test_featured_is_the_newest_month_begun():
    month, names = cc.featured_from(FEATURED, date(2026, 11, 13))
    assert month == '2026-11'
    assert names == ['Justin Myles Holmes', 'Jake Stargel', 'Gaven Largent']


def test_featured_before_any_month_is_nobody():
    assert cc.featured_from(FEATURED, date(2026, 9, 1)) == (None, [])


def test_featured_takes_the_next_month_when_it_begins():
    assert cc.featured_from(FEATURED, date(2026, 12, 1)) == ('2026-12', ['Someone Later'])


def test_two_spellings_the_wiki_joins_are_one_picker():
    pairs = [pair('Sam Grisman', 'Kyle Tuttle', 'show', 'lma:show1'),
             pair('Samson Grisman', 'Kyle Tuttle', 'track', 'arthel:4masks'),
             pair('Sam Grisman', 'Samson Grisman', 'track', 'arthel:4masks')]
    store = cc.Store(pairs, TARGETS, GROUPS, {'Sam Grisman': 'Samson Grisman'})
    assert {p['a'] for p in store.pairs} | {p['b'] for p in store.pairs} == {'Samson Grisman', 'Kyle Tuttle'}
    assert store.raw['Samson Grisman'] == {'Sam Grisman', 'Samson Grisman'}
    ev = store.evidence('Kyle Tuttle', 'Samson Grisman')
    assert ev['kind'] == 'track' and len(ev['list']) == 2


def test_path_takes_fewest_hops_then_the_closest_links():
    pairs = [pair('A', 'B', 'record', 'discogs:1'),                      # one hop, loose
             pair('A', 'M', 'track', 'arthel:4masks'), pair('M', 'B', 'track', 'arthel:4masks')]
    store = cc.Store(pairs, TARGETS, GROUPS, {})
    assert store.path('A', 'B') == [('A', 'B')]                          # a Bacon number counts hops
    pairs += [pair('A', 'N', 'show', 'lma:show1'), pair('N', 'C', 'show', 'lma:show1'),
              pair('M', 'C', 'track', 'arthel:4masks')]
    store = cc.Store(pairs, TARGETS, GROUPS, {})
    assert store.path('A', 'C') == [('A', 'M'), ('M', 'C')]              # two hops either way; tracks win


def test_path_ignores_people_who_were_not_on_stage_together():
    store = cc.Store([pair('A', 'B', 'apart', 'lma:show1')], TARGETS, GROUPS, {})
    assert store.path('A', 'B') is None


def test_arthel_songs_get_their_titles():
    p = pair('A', 'B', 'track', 'arthel:4masks',
             [('https://github.com/x/silver-44.yaml', '', 'silver-44'), ('u', '', 'victory-ff7')])
    assert cc.describe(p, TARGETS) == '“Silver 44”, “Victory”, 4masks'
    show = pair('A', 'B', 'show', 'lma:show1')
    assert cc.describe(show, TARGETS) == 'Sam Grisman Project, 2025-07-05'


def _store():
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1'),
             pair('Molly Tuttle', 'Gaven Largent', 'record', 'discogs:1'),
             pair('Kyle Tuttle', '<script>alert(1)</script>', 'show', 'lma:show1')]
    alias = {'Justin Holmes': 'Justin Myles Holmes'}
    return cc.Store(pairs, TARGETS, GROUPS, alias)


def test_a_card_names_their_closest_and_escapes_every_name():
    # the featured pickers set aside (Justin, #connectome, 15 Nov 2026): a card names who its picker played with
    store = _store()
    html = cc.card('Kyle Tuttle', store, lambda n: n in ('Justin Myles Holmes', 'Kyle Tuttle'), {'Justin Myles Holmes': 'guitar'})
    assert html.startswith('<div class="connectome-card"')
    assert '<script>' not in html and '&lt;script&gt;alert(1)&lt;/script&gt;' in html
    assert '>Justin Myles Holmes</text></a>' in html and '>Molly Tuttle</text></a>' in html   # named round them, linked
    assert 'Instrument-icon-guitar.png' in html
    assert '<table' not in html and 'Featured' not in html and 'Bacon' not in html   # no table of paths to anyone
    assert '"/bacon?a=Kyle+Tuttle&amp;b=Justin+Myles+Holmes"' in html     # a click opens the two of them
    assert 'Gaven Largent' not in html                                               # two hops off: not on a card now


def test_a_card_names_two_at_most_by_any_one_record_or_show_by_justins_order():
    # Justin, #connectome, 15 Nov 2026: "Priority list as described above, but only at most two 1-hop connections
    # from any given record or show, unless there are no other connecting objects available"
    targets = {'r': ('Ours', '2025', 'K'), 's': ('Live', '2025-01-01', 'K'), 'f': ('Theirs', '2024', 'Z')}
    pairs = ([pair('K', n, 'track', 'r', [('u', '1', 'Song')]) for n in ('A', 'B', 'C')]
             + [pair('K', n, 'show', 's') for n in ('D', 'E', 'F')]
             + [pair('K', 'G', 'track', 'f', [('u', '1', 'Other')])])
    store = cc.Store(pairs, targets, {t: t for t in targets}, {}, {'r': 2, 's': 2, 'f': 1})
    nb = store.evidence('K')
    # a Creative Commons record's two, then the show's two, then the DRM-free record; and only then a third of the record
    assert cc.closest(store, 'K', nb, want=6) == ['A', 'B', 'D', 'E', 'G', 'C']
    assert cc.closest(store, 'K', nb, want=4) == ['A', 'B', 'D', 'E']
    assert cc.closest(store, 'K', nb, want=7, cap=3) == ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    html = cc.card('K', store, lambda n: True, {})
    assert all(f'>{n}</text></a>' in html for n in 'ABDE') and '>C</text></a>' not in html   # the card names four


def test_a_sit_in_on_one_song_of_a_tape_is_a_show_not_a_studio_track():
    # a tape's track-level sit-in ranked as a Creative Commons studio track filled Kyle Tuttle's card with shows
    targets = {'r': ('Ours', '2025', 'K'), 'tape': ('Live', '2025-01-01', 'Band')}
    pairs = [pair('K', 'Studio', 'track', 'r', [('u', '1', 'Song')]), pair('K', 'Sitin', 'track', 'tape', [('u', '1', 'Tune')])]
    store = cc.Store(pairs, targets, {t: t for t in targets}, {}, {'r': 2, 'tape': 2}, shows={'tape'})
    assert cc.closest(store, 'K', store.evidence('K')) == ['Studio', 'Sitin']
    assert cc.standing('track', 2, show=True) == cc.standing('show', 2) == 4 and cc.standing('track', 2) == 5


def test_a_card_names_a_songs_artist_before_its_sidemen_then_its_writer():
    # Justin, #connectome, 15 Nov 2026, 07:29Z, and 20:15Z: Maddie Denton's card named Harry and Gaven by 4masks,
    # and Justin, whose record it is, nowhere. Of those by one record, the one who made it first; then the writer.
    targets = {'r': ('Ours', '2025', 'Zed'), 's': ('Live', '2025-01-01', 'Band'), 'q': ('Theirs', '2024', 'Band X')}
    pairs = ([pair('M', n, 'track', 'r', [('u', '1', 'One')]) for n in ('Harry', 'Gaven', 'Zed')]
             + [pair('M', 'Cory', 'show', 's')]
             + [pair('M', n, 'track', 'q', [('u', '1', "Barlow's Jig")]) for n in ('Side', 'Writer')])
    store = cc.Store(pairs, targets, {t: t for t in targets}, {}, {'r': 2, 's': 2, 'q': 1})
    nb = store.evidence('M')
    made, wrote = {'r': {'Zed'}}, {('q', cc.song_key('Barlows Jig')): {'Writer'}}
    assert cc.closest(store, 'M', nb, want=6) == ['Gaven', 'Harry', 'Cory', 'Side', 'Writer', 'Zed']   # nobody's: the alphabet
    assert cc.closest(store, 'M', nb, want=6, made=made, wrote=wrote) == ['Zed', 'Gaven', 'Cory', 'Writer', 'Side', 'Harry']
    html = cc.card('M', store, lambda n: True, {}, made=made, wrote=wrote)
    assert '>Zed</text></a>' in html and '>Writer</text></a>' in html and '>Harry</text></a>' not in html
    assert cc.song_key("Barlow\u2019s  Jig") == cc.song_key('barlows jig') == 'barlows jig'


def test_the_build_knows_who_made_a_record_by_the_wikis_own_name(tmp_path):
    # a credit writes "Bronwyn Keith-Hynes" where her page is Bronwyn: Rattlin' Bones is hers, in the graph and on the card
    whole = {'discogs:9': {'kind': 'record', 'title': "Rattlin' Bones", 'date': '2026', 'artist': 'Bronwyn Keith-Hynes',
                           'grp': 'discogs:9', 'formats': ['CD (Album)']}}
    targets = {'discogs:9': ("Rattlin' Bones", '2026', 'Bronwyn Keith-Hynes')}
    pairs = [pair('Kyle Tuttle', n, 'track', 'discogs:9', [('u', '1', 'Sticks And Stones')])
             for n in ('Allen Cooke', 'Ann Picker', 'Bronwyn Keith-Hynes')]
    wiki = FakeWiki(redirects={'Bronwyn Keith-Hynes': 'Bronwyn'}, pages={'Bronwyn', 'Kyle Tuttle', 'Allen Cooke'},
                    musicians=['Kyle Tuttle'])
    out = cc.build(pairs, targets, {t: t for t in targets}, wiki, date(2026, 11, 15), None, whole, [])
    g = out['graph']
    assert [g['people'][i][0] for i in g['made'][0]] == ['Bronwyn']
    store = cc.Store(pairs, targets, {t: t for t in targets}, {'Bronwyn Keith-Hynes': 'Bronwyn'}, {'discogs:9': 1})
    nb = store.evidence('Kyle Tuttle')
    assert cc.closest(store, 'Kyle Tuttle', nb) == ['Allen Cooke', 'Ann Picker', 'Bronwyn']           # nobody's: the alphabet
    assert cc.closest(store, 'Kyle Tuttle', nb, made=cc.owners(g)[0]) == ['Bronwyn', 'Allen Cooke', 'Ann Picker']
    card = out['cards']['Kyle Tuttle']                                # the ring's names in its order, the middle's last
    assert card.index('>Bronwyn</text></a>') < card.index('>Allen Cooke</text></a>') < card.index('>Ann Picker</text></a>')


def test_a_card_is_gold_for_permanent_ink_for_full_and_dotted_for_the_rest():
    targets = dict(TARGETS, **{'discogs:2': ('Looser', '2016', 'Else')})
    pairs = [pair('K', 'Tape', 'show', 'lma:show1'), pair('K', 'Disc', 'track', 'discogs:1', [('u', '1', 'Song')]),
             pair('K', 'Unknown', 'track', 'discogs:2', [('u', '1', 'Other')])]
    tiers = {'lma:show1': 2, 'discogs:1': 1, 'discogs:2': 0}
    store = cc.Store(pairs, targets, {t: t for t in targets}, {}, tiers)
    assert store.evidence('K', 'Tape')['tier'] == 2 and store.evidence('K', 'Disc')['tier'] == 1

    def spoke(html, name):                                                # the lines drawn before this picker's dot
        return html[:html.index('>' + name + ' ')]

    for name, colour in (('Tape', cc.GOLD), ('Disc', cc.INK2)):
        html = cc.card('K', cc.Store([p for p in pairs if name in (p['a'], p['b'])], targets, {t: t for t in targets}, {}, tiers),
                       lambda n: True, {})
        assert f'stroke="{colour}"' in html and 'stroke-dasharray="1 5"' not in html
    html = cc.card('K', cc.Store(pairs[2:], targets, {t: t for t in targets}, {}, tiers), lambda n: True, {})
    assert 'stroke-dasharray="1 5"' in html and f'stroke="{cc.GOLD}"' not in html
    assert 'Permanent Release' in html and 'Full Release' in html         # the legend names the tiers


def test_a_store_with_no_tiers_given_draws_a_tape_full_not_permanent():
    # the build always gives tiers, read from each tape's collections; with none given, nothing says etree
    store = cc.Store([pair('K', 'Tape', 'show', 'lma:show1'), pair('K', 'Disc', 'record', 'discogs:1')], TARGETS, GROUPS, {})
    assert store.evidence('K', 'Tape')['tier'] == 1 and store.evidence('K', 'Disc')['tier'] == 0


def test_build_writes_the_big_graphs_file_beside_the_cards(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1')]
    whole = {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []},
             'lma:show1': {'kind': 'show', 'title': 'Kyle Live', 'date': '2025-07-05', 'artist': 'Sam Grisman Project',
                           'grp': 'lma:show1', 'formats': []}}
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', '4masks', 'Song:Silver 44'},
                    musicians=['Kyle Tuttle'], inst={'Kyle Tuttle': 'banjo'})
    credits = [('Justin Holmes', 'guitar', 'arthel:4masks', 'track', 'u')]
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 13), None, whole, credits)
    g = result['graph']
    names = [p[0] for p in g['people']]
    assert 'Justin Myles Holmes' in names and 'Justin Holmes' not in names   # the wiki's name, as on the cards
    assert g['songs'] == {'Silver 44': '/wiki/Song%3ASilver_44'}
    assert g['plays'] == {}                                    # the song's page names no track to play
    assert [names[i] for i, _ in g['cast'][[m[0] for m in g['music']].index('arthel:4masks')]] == ['Justin Myles Holmes']
    cc.write(result, str(tmp_path), {})
    assert (tmp_path / 'graph.json').exists()
    assert cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 13))['graph'] is None   # the cards alone, as before


def test_no_card_for_someone_who_played_with_nobody():
    store = cc.Store([pair('A', 'B', 'record', 'discogs:1')], TARGETS, GROUPS, {})
    assert cc.card('A', store, lambda n: True, {}) is None


def test_card_file_is_the_md5_the_wiki_looks_for():
    assert cc.card_file('Kyle Tuttle') == hashlib.md5(b'Kyle Tuttle').hexdigest() + '.html'
    assert cc.card_file('Bronwyn Keith-Hynés') == hashlib.md5('Bronwyn Keith-Hynés'.encode()).hexdigest() + '.html'


def test_build_makes_cards_only_for_musician_pages_the_store_knows(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1')]
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Jake Stargel', 'Gaven Largent'},
                    musicians=['Kyle Tuttle', 'Justin Myles Holmes', 'Billy Strings'])
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 13))
    assert sorted(result['cards']) == ['Justin Myles Holmes', 'Kyle Tuttle']
    assert result['skipped'] == ['Billy Strings']
    assert result['names']['Justin Myles Holmes'] == ['Justin Holmes']
    cc.write(result, str(tmp_path), {'db': 'x'})
    assert (tmp_path / 'cards' / cc.card_file('Kyle Tuttle')).read_text().startswith('<div class="connectome-card"')
    assert {p['a'] for p in __import__('json').load(open(tmp_path / 'pairs.json'))} <= {'Kyle Tuttle', 'Justin Myles Holmes'}


class PageWiki(FakeWiki):
    """A wiki where some pages carry {{Bacon graph of this page}}, and what each links."""
    def __init__(self, asking=(), links=None, **kw):
        super().__init__(**kw)
        self.asking, self._links = list(asking), links or {}

    def bacon_pages(self):
        return self.asking

    def links(self, titles):
        return {t: self._links.get(t, []) for t in titles}


def test_a_page_that_asks_gets_a_graph_of_the_pickers_it_links_for_that_page_only(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Bronwyn Keith-Hynes', 'show', 'lma:show1'),
             pair('Molly Tuttle', 'Somebody Else', 'record', 'discogs:1'),
             pair('Molly Tuttle', 'Kyle Tuttle', 'record', 'discogs:1')]
    grammys = '69th Annual Grammy Awards'
    wiki = PageWiki(asking=[grammys, 'Kyle Tuttle', 'A Page Of Nobody'],
                    links={grammys: ['Bronwyn Keith-Hynes', 'Molly Tuttle', 'Recording Academy', 'Kyle Tuttle'],
                           'A Page Of Nobody': ['Recording Academy'], 'Kyle Tuttle': ['Bronwyn Keith-Hynes']},
                    redirects={'Justin Holmes': 'Justin Myles Holmes', 'Bronwyn Keith-Hynes': 'Bronwyn'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Bronwyn'}, musicians=['Kyle Tuttle'])
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 17))
    assert sorted(result['page_cards']) == [grammys]          # a picker's own page keeps its card; no pickers, no graph
    html = result['page_cards'][grammys]
    # round the page, the pickers it links, by the wiki's own names (a redirect followed; a red link counts too)
    assert '>Bronwyn<' in html and '>Kyle Tuttle<' in html and '>Molly Tuttle<' in html
    assert 'Recording Academy' not in html and '>Bronwyn Keith-Hynes<' not in html
    # a line where two played together, with its note; Molly only shares a record with Kyle: dotted, and said so
    assert 'Kyle Tuttle &amp; Bronwyn' in html or 'Bronwyn &amp; Kyle Tuttle' in html
    assert '>on a record: Some Record' in html and 'Molly Tuttle &amp; Bronwyn' not in html
    assert html.count('played with') == 2                     # Kyle's and Bronwyn's notes; not Molly's
    # each one's way to cryptograss, in jumps of playing together; a shared record is no jump
    assert '>2 jumps from Justin Myles Holmes<' in html and '>by way of Kyle Tuttle<' in html
    assert '>1 jump from Justin Myles Holmes<' in html
    assert '…' not in html                                     # no note's line cut short
    assert html.count('jump') == 2
    # on the page together is a connection here and nowhere else: the store gained no tie
    assert sorted((p['a'], p['b']) for p in result['pairs']) == [
        ('Kyle Tuttle', 'Bronwyn'), ('Kyle Tuttle', 'Justin Myles Holmes'), ('Molly Tuttle', 'Kyle Tuttle'),
        ('Molly Tuttle', 'Somebody Else')]
    cc.write(result, str(tmp_path), {'db': 'x'})
    assert (tmp_path / 'cards' / cc.card_file(grammys)).read_text() == html
    assert __import__('json').load(open(tmp_path / 'cards.json'))['page_cards'] == {grammys: cc.card_file(grammys)}


def test_the_big_graph_learns_a_pages_pickers_for_that_pages_view_and_no_tie():
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1')]
    whole = {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []},
             'lma:show1': {'kind': 'show', 'title': 'Kyle Live', 'date': '2025-07-05', 'artist': 'Sam Grisman Project',
                           'grp': 'lma:show1', 'formats': []}}
    wiki = PageWiki(asking=['Awards'], links={'Awards': ['Molly Tuttle', 'Justin Holmes', 'Kyle Tuttle', 'Nobody']},
                    redirects={'Justin Holmes': 'Justin Myles Holmes'}, pages={'Justin Myles Holmes', 'Kyle Tuttle'})
    plain = cc.build(pairs, TARGETS, GROUPS, FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                     pages={'Justin Myles Holmes', 'Kyle Tuttle'}), date(2026, 11, 17), None, whole, [])['graph']
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 17), None, whole, [])
    g = result['graph']
    names = [p[0] for p in g['people']]
    # the page's pickers, by their places in people: Kyle first (he played with both), then the others
    assert [names[i] for i in g['pages']['Awards']] == ['Kyle Tuttle', 'Justin Myles Holmes', 'Molly Tuttle']
    # and nothing else changed: Molly and Justin, on one page and never on a stage, are no tie
    assert g['ties'] == plain['ties'] and g['people'] == plain['people']
    # the card's paper, its middle and its explore all open this page's graph on the big one
    html = result['page_cards']['Awards']
    assert html.count(f'href="{cc.VIEWER}?page=Awards"') == 3


def test_a_page_graph_escapes_every_name_and_draws_sixteen_at_most():
    pairs = [pair(f'P{i:02} <i>', 'Hub & Co', 'show', 'lma:show1') for i in range(20)]
    store = cc.Store(pairs, TARGETS, GROUPS, {})
    html = cc.page_card('A <b>page</b> & more', [f'P{i:02} <i>' for i in range(20)], store, lambda n: False, {})
    assert '<b>' not in html and '<i>' not in html and 'A &lt;b&gt;page&lt;/b&gt; &amp; more' in html
    assert html.count('r="15" fill="transparent"') == cc.PAGE_MOST
    assert '16 of the pickers this page links (4 more not drawn)' in html
    assert 'jump' not in html                                  # nobody here has a way to cryptograss
    assert cc.page_card('A page', ['Nobody'], store, lambda n: False, {}) is None


def test_a_song_plays_in_rabbithole_where_its_page_says_which_track(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44'), ('u', '', 'august')])]
    whole = {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []}}
    wiki = FakeWiki(pages={'Kyle Tuttle', '4masks', 'Song:Silver 44', 'Song:August'}, musicians=['Kyle Tuttle'],
                    listens={'Song:August': 'QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a', 'Song:Elsewhere': 'QmNotAsked'})
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 13), None, whole, [])['graph']
    assert g['plays'] == {'August': 'QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a'}        # Silver 44's page names none
    assert sorted(g['songs']) == ['August', 'Silver 44']


def test_the_track_a_page_plays_is_read_from_its_listen_template():
    cid = 'QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a'

    class Api(cc.Wiki):
        def api(self, **q):
            assert q['prop'] == 'revisions' and q['titles'] == 'Song:August|Song:Plain|Song:Silver 44'
            text = {'Song:August': '{{Listen in Rabbithole|%s}}\n\n{{Song}}' % cid,
                    'Song:Silver 44': '<proposed by="Magent">\n{{ Listen_in_Rabbithole | %s |label=Hear it}} Nobody has charted it.' % cid[::-1],
                    'Song:Plain': 'A song. [https://pickipedia.xyz/rabbithole/?track=%s]' % cid}
            return {'query': {'pages': [{'title': t, 'revisions': [{'slots': {'main': {'content': x}}}]} for t, x in text.items()]
                              + [{'title': 'Song:Gone', 'missing': True}]}}

    heard = Api('https://example.test/').listens(['Song:Silver 44', 'Song:August', 'Song:Plain', 'Song:August'])
    assert heard == {'Song:August': cid, 'Song:Silver 44': cid[::-1]}       # a bare link in prose is not the template


# ---- the song-centred card: who the store's credits put on a cut (Justin, #rabbithole, 15 Nov 2026) ----

AUG = 'https://github.com/cryptograss/arthel/blob/main/src/data/songs_and_tunes/august.yaml'


def song_whole():
    return {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '2025', 'artist': '', 'grp': 'arthel:4masks', 'formats': []},
            'arthel:vowel sounds': {'kind': 'record', 'title': 'Vowel Sounds', 'date': '2026', 'artist': '', 'grp': 'arthel:vowel sounds', 'formats': []}}


def test_the_store_alone_makes_no_songcast():
    import connectome_graph as cg
    pairs = [pair('Kyle Tuttle', 'Maddie Denton', 'track', 'arthel:vowel sounds', [(AUG, '', 'august')])]
    credits = [('Justin Holmes', 'guitar; vocals', 'arthel:vowel sounds', 'track', AUG),
               ('Maddie Denton', 'fiddle', 'arthel:vowel sounds', 'track', AUG),
               ('Kyle Tuttle', '5-string banjo', 'arthel:vowel sounds', 'track', AUG)]
    g = cg.export(pairs, song_whole(), credits, lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {})
    assert g['songcast'] == {}                                             # a page's cut is the only source


def test_the_pages_cuts_alone_are_songcast_and_carry_their_icons():
    import connectome_graph as cg
    songcuts = {'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugustCut', 'recorded': '', 'cast': {'Kyle Tuttle': '5-string banjo', 'Justin Holmes': 'guitar; six-whistle'}}]}
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts=songcuts, icons={'banjo', 'guitar', 'tin_whistle'})
    cast = g['songcast']['QmAugustCut']['pickers']
    names = [p[0] for p in g['people']]
    by_name = {names[p]: (r, i) for p, r, i in cast}
    assert by_name['Kyle Tuttle'] == ('5-string banjo', 'banjo')           # the qualifier goes; the icon is banjo's
    assert by_name['Justin Holmes'] == ('guitar; six-whistle', 'guitar')   # the first role that has an icon
    assert cg and __import__('connectome_graph').icon_for('six-whistle', {'tin_whistle'}) == 'tin_whistle'
    g2 = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {}, songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugustCut', 'recorded': '', 'cast': {'Kyle Tuttle': 'x', 'Justin Holmes': 'y'}}]})
    assert [i for _, _, i in g2['songcast']['QmAugustCut']['pickers']] == ['', '']   # no icons known: none said


def test_a_song_card_labels_the_cut_and_escapes_every_name():
    store = _store()
    cut = cc.song_cut(song_whole(), {}, {'4masks': '/wiki/4masks'}, 'arthel:4masks')
    html = cc.song_card('<b>Silver 44</b>', cut, [('Kyle Tuttle', '5-string banjo'), ('Molly Tuttle', '')],
                        store, lambda n: n == 'Kyle Tuttle', {'Kyle Tuttle': 'banjo'}, play='QmTest')
    assert html.startswith('<div class="connectome-card"') and 'data-song="' in html
    assert '&lt;b&gt;' in html and '<b>' not in html                       # nothing reaches the card as markup
    assert '5-string banjo' in html                                        # the instrument this cut gave them
    assert cc.attr(viewer := cc.viewer(s='<b>Silver 44</b>')) in html or 's=%3Cb%3E' in html
    assert 'Rabbithole' in html and 'On ' in html


def test_a_song_cards_lines_are_the_ways_on_elsewhere():
    pairs = [pair('A', 'B', 'track', 'arthel:4masks', [('u', '', 'the-song')]),
             pair('A', 'C', 'show', 'lma:show1'),                          # A and C: elsewhere, a stage
             pair('B', 'C', 'record', 'discogs:1'),                        # B and C: elsewhere, a record only
             pair('A', 'D', 'track', 'lma:show1', [('u', '', 'the-song')]),     # A and D: the same song again, on a tape
             pair('B', 'D', 'track', 'arthel:4masks', [('u', '', 'the-song')])]  # B and D: this cut, nothing else
    store = cc.Store(pairs, TARGETS, GROUPS, {})
    cut = cc.song_cut(song_whole(), {}, {}, 'arthel:4masks')
    html = cc.song_card('The Song', cut, [('A', 'fiddle'), ('B', 'banjo'), ('C', 'guitar'), ('D', 'bass')],
                        store, lambda n: True, {})
    assert html.count('stroke-width="2.2"') == 1                           # the same song on another stage: solid
    assert html.count('stroke-width="1.2"') == 2                           # a stage or a record: thin
    assert 'also: ' in html


def test_a_song_card_without_another_cut_says_so():
    pairs = [pair('A', 'B', 'track', 'arthel:4masks', [('u', '', 'the-song')])]
    store = cc.Store(pairs, TARGETS, GROUPS, {})
    html = cc.song_card('The Song', cc.song_cut(song_whole(), {}, {}, 'arthel:4masks'),
                        [('A', ''), ('B', '')], store, lambda n: True, {})
    assert 'stroke-width' not in html.split('</svg>')[0].split('viewBox')[1] or 'also: ' not in html
    assert 'only here' not in html                                          # the ring's tips say the cut itself


def test_build_builds_a_song_card_for_a_song_page_and_names_it_like_the_wiki_does(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:vowel sounds', [(AUG, '', 'august')]),
             pair('Kyle Tuttle', 'Maddie Denton', 'track', 'arthel:vowel sounds', [(AUG, '', 'august')])]
    whole = song_whole()
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Vowel Sounds', 'Song:August'},
                    musicians=['Kyle Tuttle'], inst={'Kyle Tuttle': 'banjo'},
                    listens={'Song:August': 'QmSongCid'},
                    cuts={'Song:August': [{'record': 'Vowel Sounds', 'number': '1', 'cid': 'QmSongCid', 'recorded': '',
                                           'cast': {'Justin Holmes': 'guitar; vocals', 'Kyle Tuttle': '5-string banjo',
                                                    'Maddie Denton': 'fiddle'}}]})
    credits = [('Justin Holmes', 'guitar; vocals', 'arthel:vowel sounds', 'track', AUG),
               ('Kyle Tuttle', '5-string banjo', 'arthel:vowel sounds', 'track', AUG),
               ('Maddie Denton', 'fiddle', 'arthel:vowel sounds', 'track', AUG)]
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, whole, credits)
    assert 'Song:August' in result['song_cards']                            # keyed as the page names itself
    card = result['song_cards']['Song:August']
    assert 'August' in card
    # the CID goes in the links (data-cut, the explore href, the paper, the centre's link, the play chip), not the text
    assert card.count('QmSongCid') == 5 and card.count('href="/rabbithole/?track=QmSongCid"') == 1
    assert '"/bacon?s=August&amp;cut=QmSongCid"' in card                      # the explore link opens this cut's graph,
    assert '?cut=' not in card                                               # written as /bacon's own address writes it
    assert 'Justin Myles Holmes' in card and 'guitar; vocals' in card
    cc.write(result, str(tmp_path), {})
    want = hashlib.md5('Song:August'.encode()).hexdigest() + '.html'
    assert (tmp_path / 'cards' / want).exists()                             # the wiki looks for exactly this file
    cards = (tmp_path / 'cards.json')
    assert '"Song:August"' in cards.read_text()
    only = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), 'Song:August', whole, credits)
    assert only['song_cards'] and only['cards'] == {}                       # a song page alone: the song card only


def test_a_song_page_whose_cut_says_its_cid_plays_that(tmp_path):
    class Api(cc.Wiki):
        def api(self, **q):
            text = {'Song:August': "{{Song}}\n{{Studio cut\n|record=4masks\n|cid=QmStudioCidThisIsLongEnoughForARealOne\n}}"}
            return {'query': {'pages': [{'title': t, 'revisions': [{'slots': {'main': {'content': x}}}]} for t, x in text.items()]}}
    heard = Api('https://example.test/').listens(['Song:August'])
    assert heard == {'Song:August': 'QmStudioCidThisIsLongEnoughForARealOne'}                     # the cut's cid plays when no Listen line says one


# ---- the song pages' cuts come first (magent, #connectome, 15 Nov 2026) ----

def test_the_song_pages_cut_names_the_record_and_the_whole_cast(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Maddie Denton', 'track', 'arthel:vowel sounds', [(AUG, '', 'august')])]
    whole = song_whole()
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Kyle Tuttle', 'Justin Myles Holmes', '4masks', 'Song:August'}, musicians=['Kyle Tuttle'],
                    cuts={'Song:August': [{'record': '4masks', 'number': '5',
                                           'cid': 'QmCutCid', 'recorded': '3 April, 2024', 'cast': {'Justin Holmes': 'guitar; vocals',
                                                                       'Lauren Luz': 'vocals',
                                                                       'Harry Clark': 'mandolin'}}]})
    credits = [('Justin Holmes', 'guitar', 'arthel:vowel sounds', 'track', AUG)]
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, whole, credits)
    sc = result['graph']['songcast']['QmCutCid']
    assert sc['song'] == 'August' and sc['number'] == '5' and sc['recorded'] == '3 April, 2024'
    music = result['graph']['music']
    cut = music[sc['on'][0]]
    assert cut[0] == 'arthel:4masks'                                       # the page's record, not the store's grouping
    cast = {p[0]: p[1] for p in sc['pickers']}
    names = [p[0] for p in result['graph']['people']]
    assert cast[names.index('Justin Myles Holmes')] == 'guitar; vocals'    # the page's roles, in the store's shape
    assert cast[names.index('Lauren Luz')] == 'vocals'                     # whom the store's credits left out
    assert result['song_cards']['Song:August']


def test_the_page_writes_roles_with_commas_the_store_with_semicolons():
    cuts = cc.studio_cuts_from('{{Studio cut\n|record=4masks\n|cid=QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a\n'
                               '|Justin Holmes=guitar, six-whistle\n|Kyle Tuttle=5-string banjo\n}}')
    assert cuts == [{'record': '4masks', 'number': '', 'cid': 'QmS3QEZFa1c75BBa9vwNEsXkS6GBmS75Cs6RyDJBXqRx8a', 'recorded': '',
                     'cast': {'Justin Holmes': 'guitar; six-whistle', 'Kyle Tuttle': '5-string banjo'}}]
    assert cc.studio_cuts_from('no cut here') == []


def test_a_store_song_the_pages_dont_reach_has_no_songcast():
    import connectome_graph as cg
    pairs = [pair('A', 'B', 'track', 'arthel:4masks', [('u', '', 'only-in-store')])]
    credits = [('A', 'fiddle', 'arthel:4masks', 'track', 'u'), ('B', 'banjo', 'arthel:4masks', 'track', 'u')]
    g = cg.export(pairs, song_whole(), credits, lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {})
    assert 'Only In Store' not in g['songcast']                            # no page, no song node: the ties still know them
    assert g['ties']                                                       # and the credits' work is the ties


def test_a_cut_whose_record_the_store_doesnt_know_is_left_out():
    import connectome_graph as cg
    pairs = [pair('A', 'B', 'track', 'arthel:4masks', [('u', '', 'other-song')])]
    g = cg.export(pairs, song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': 'Some Other Record', 'number': '', 'cid': '', 'recorded': '', 'cast': {'A': 'guitar'}},
                                       {'record': '4masks', 'number': '5', 'cid': 'QmCutCid', 'recorded': '', 'cast': {'A': 'guitar'}}]})
    want = g['music'].index(next(m for m in g['music'] if m[0] == 'arthel:4masks'))
    assert all( e['on'] == [want] for e in g['songcast'].values() ) and len(g['songcast']) == 1


def test_each_cut_of_a_page_carries_its_own_graph_in_the_pages_order():
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:vowel sounds', [(AUG, '', 'barlow')])]
    whole = song_whole()
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Vowel Sounds', 'Song:Barlow'},
                    musicians=['Kyle Tuttle'], inst={'Kyle Tuttle': 'banjo'},
                    cuts={'Song:Barlow': [
                        {'record': 'Vowel Sounds', 'number': '6', 'cid': 'QmCutOne', 'recorded': '3 April, 2024',
                         'cast': {'Justin Holmes': 'guitar', 'Kyle Tuttle': 'banjo'}},
                        {'record': 'Vowel Sounds', 'number': '2', 'cid': 'QmCutTwo', 'recorded': '20 June, 2024',
                         'cast': {'Justin Holmes': 'guitar', 'Kyle Tuttle': 'banjo'}}]})
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, whole, [])
    card = result['song_cards']['Song:Barlow']
    assert card.count('data-cut=') == 2                                          # each cut its own graph
    assert card.index('QmCutOne') < card.index('QmCutTwo')                       # in the page's own order
    assert 'track 6' in card and 'recorded 3 April, 2024' in card                # each cut named by its own facts
    g = result['graph']
    assert set(g['songcast']) == {'QmCutOne', 'QmCutTwo'}
    assert g['songcast']['QmCutOne']['recorded'] == '3 April, 2024'
    assert g['songcast']['QmCutTwo']['song'] == 'Barlow'


def test_each_cuts_card_file_is_named_as_the_php_names_it(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:vowel sounds', [(AUG, '', 'barlow')])]
    whole = song_whole()
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Vowel Sounds', 'Song:Barlow'},
                    musicians=['Kyle Tuttle'], inst={'Kyle Tuttle': 'banjo'},
                    cuts={'Song:Barlow': [
                        {'record': 'Vowel Sounds', 'number': '6', 'cid': 'QmCutOne', 'recorded': '',
                         'cast': {'Justin Holmes': 'guitar', 'Kyle Tuttle': 'banjo'}}]})
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, whole, [])
    cc.write(result, str(tmp_path), {'today': '2026-11-15'})
    # Connectome::cutFileFor: md5( title|record|number|cid ) — the template passes the block's own params
    want = hashlib.md5("Song:Barlow|Vowel Sounds|6|QmCutOne".encode()).hexdigest() + '.html'
    assert (tmp_path / 'cards' / want).exists()
    html = (tmp_path / 'cards' / want).read_text()
    assert html.count('data-cut=') == 1                                     # one cut, its own graph


def test_a_cut_with_no_cid_keys_itself_by_its_record_and_track():
    import connectome_graph as cg

    wiki = FakeWiki(pages={'Kyle Tuttle', 'Song:August'}, musicians=['Kyle Tuttle'],
                    cuts={'Song:August': [{'record': '4masks', 'number': '5', 'cid': '',
                                           'recorded': '', 'cast': {'Kyle Tuttle': 'banjo'}}]})
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': '', 'recorded': '',
                                        'cast': {'Kyle Tuttle': 'banjo'}}]})
    assert 'QmAugCut' not in g and [k for k in g['songcast']] == ['arthel:4masks|August']  # record and song, since no cid
    assert g['songcast']['arthel:4masks|August']['song'] == 'August'


def test_a_cuts_entry_says_who_the_record_names_as_the_artist():
    import connectome_graph as cg
    whole = song_whole()
    wiki = FakeWiki(pages={'Kyle Tuttle', 'Song:August', '4masks'}, musicians=['Kyle Tuttle'],
                    record_artists={'4masks': 'Justin Myles Holmes'},
                    cuts={'Song:August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                           'cast': {'Kyle Tuttle': 'banjo'}}]})
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                        'artist': 'Justin Myles Holmes', 'cast': {'Kyle Tuttle': 'banjo'}}]})
    names = [p[0] for p in g['people']]
    assert 'Justin Myles Holmes' in names                        # the record's artist is a node even off the cast
    assert g['songcast']['QmAugCut']['artist'] == names.index('Justin Myles Holmes')
    # and the one who made the record, though its credit is blank
    assert g['made'][[m[0] for m in g['music']].index('arthel:4masks')] == [names.index('Justin Myles Holmes')]


def test_a_cut_with_no_artist_said_carries_none():
    import connectome_graph as cg
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                        'artist': '', 'cast': {'Kyle Tuttle': 'banjo'}}]})
    assert g['songcast']['QmAugCut']['artist'] is None


def test_cryptograss_records_carry_their_pages_artist_and_art():
    # Justin, #connectome, 15 Nov 2026: a cut says whose it is; where there's an image, use it
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:vowel sounds', [(AUG, '', 'barlow')]),
             pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [(AUG, '', 'august')])]
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Vowel Sounds', '4masks'}, musicians=['Kyle Tuttle'],
                    record_artists={'Vowel Sounds': 'Justin Holmes', '4masks': 'Justin Myles Holmes'})
    wiki.art = {'4masks': 'Four-masks-temp.png'}
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, song_whole(), [])['graph']
    music = {m[0]: m for m in g['music']}
    assert music['arthel:vowel sounds'][2] == 'Justin Myles Holmes'          # the page's artist, by the wiki's own name
    assert music['arthel:vowel sounds'][8] == ''                             # no art said
    assert music['arthel:4masks'][8] == 'Four-masks-temp.png'


def test_the_cards_paper_is_a_way_in_and_lies_under_everything_else():
    # Justin, #connectome, 15 Nov 2026: a click on whitespace opens the big graph on the picker, or the cut.
    html = cc.card('Kyle Tuttle', _store(), lambda n: True, {})
    svg = html[html.index('<svg'):]
    first = svg[svg.index('>') + 1:]
    assert first.startswith('<a class="cc-bg" href="/bacon?p=Kyle+Tuttle" aria-label="Explore Kyle Tuttle in the connectome"><rect ')
    assert svg.count('class="cc-bg"') == 1 and svg.index('cc-bg') < svg.index('<line')        # under every line and dot
    cut = cc.song_cut(song_whole(), {}, {'4masks': '/wiki/4masks'}, 'arthel:4masks')
    song = cc.song_card('<b>Silver 44</b>', cut, [('Kyle Tuttle', 'banjo'), ('Molly Tuttle', '')], _store(), lambda n: True, {})
    svg = song[song.index('<svg'):]
    assert svg[svg.index('>') + 1:].startswith('<a class="cc-bg" href="/bacon?')
    assert 'aria-label="Explore &lt;b&gt;Silver 44&lt;/b&gt; in the connectome"' in svg and '<b>' not in song


def test_a_pickers_picture_is_the_one_their_page_gives():
    # Justin, #connectome, 15 Nov 2026: a profile pic in the graph instead of the icon, where the object has one.
    find = lambda text: (cc.PORTRAIT.search(text) or [None, None])[1]
    assert find('{{MusicianInfo\n|image=Kyle Tuttle under the lights.jpg\n|does1=Has a band.\n}}').strip() == 'Kyle Tuttle under the lights.jpg'
    assert find('{{ musicianInfo | does1=x | image = File:A B.png }}').strip() == 'A B.png'
    assert find('{{MusicianInfo|does1=no picture given}}') is None
    assert find('{{MusicianInfo|image=|does1=x}}') is None                    # given empty: none
    assert find('[[File:Loose thumb.jpg|thumb]] {{MusicianInfo|does1=x}}') is None      # a loose thumb is not the page's say
    assert find('{{Other|image=Not theirs.jpg}} {{MusicianInfo|does1=x}}') is None


def test_the_graph_carries_a_picture_only_for_those_whose_page_gives_one(tmp_path):
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1')]
    whole = {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []},
             'lma:show1': {'kind': 'show', 'title': 'Kyle Live', 'date': '2025-07-05', 'artist': 'Sam Grisman Project',
                           'grp': 'lma:show1', 'formats': []}}
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'}, pages={'Justin Myles Holmes', 'Kyle Tuttle'},
                    musicians=['Kyle Tuttle', 'Justin Myles Holmes'], inst={'Kyle Tuttle': 'banjo'})
    wiki.pics = {'Kyle Tuttle': 'Kyle <b>.jpg'}
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, whole, [])
    people = {p[0]: p for p in result['graph']['people']}
    assert people['Kyle Tuttle'] == ['Kyle Tuttle', 1, 'banjo', 'Kyle <b>.jpg']     # as the page wrote it: the page escapes it
    assert len(people) > 2 and all(len(p) == 3 for n, p in people.items() if n != 'Kyle Tuttle')    # nobody else gets one


def test_a_song_pages_writers_are_its_composer_as_written():
    assert cc.writers_from('{{Song\n|status=proposed\n|composer=Justin Holmes\n}}') == ['Justin Holmes']
    assert cc.writers_from('{{Song|composer=[[Bill Monroe|Monroe]] and Lester Flatt, Earl Scruggs}}') == \
        ['Bill Monroe', 'Lester Flatt', 'Earl Scruggs']
    assert cc.writers_from('{{Song\n|traditional=yes\n}}') == []                      # nobody guessed
    assert cc.writers_from('{{Studio cut\n|composer=Somebody\n}}') == []              # only the Song block says


def test_a_cuts_writers_are_those_of_them_on_the_cut():
    # Justin, #connectome, 15 Nov 2026, 07:29Z: the song writer, if they're on the track
    import connectome_graph as cg
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                        'artist': 'Justin Myles Holmes',
                                        'writers': ['Kyle Tuttle', 'Justin Myles Holmes', 'Nobody Here'],   # Justin: not on it
                                        'cast': {'Kyle Tuttle': 'banjo', 'Harry Clark': 'mandolin'}}]})
    names = [p[0] for p in g['people']]
    assert g['songcast']['QmAugCut']['writers'] == [names.index('Kyle Tuttle')]
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                        'artist': '', 'cast': {'Kyle Tuttle': 'banjo'}}]})
    assert g['songcast']['QmAugCut']['writers'] == []


def test_a_cuts_writer_comes_through_the_build_by_the_wikis_own_name():
    # the page writes "Justin Holmes"; the wiki redirects it, and the graph knows him by his page
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:vowel sounds', [(AUG, '', 'barlow')])]
    wiki = FakeWiki(redirects={'Justin Holmes': 'Justin Myles Holmes'},
                    pages={'Justin Myles Holmes', 'Kyle Tuttle', 'Vowel Sounds', 'Song:Barlow'},
                    musicians=['Kyle Tuttle'], inst={'Kyle Tuttle': 'banjo'},
                    cuts={'Song:Barlow': [
                        {'record': 'Vowel Sounds', 'number': '6', 'cid': 'QmCutOne', 'recorded': '', 'writers': ['Justin Holmes'],
                         'cast': {'Justin Holmes': 'guitar', 'Kyle Tuttle': 'banjo'}}]})
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 15), None, song_whole(), [])['graph']
    names = [p[0] for p in g['people']]
    assert g['songcast']['QmCutOne']['writers'] == [names.index('Justin Myles Holmes')]


def test_a_chartifact_belongs_to_the_cut_it_names_or_the_page_s_only_cut():
    one = ("{{Studio cut\n|record=4masks\n|cid=QmA\n|Harry Clark=mandolin\n}}\n"
           "{{Chartifact\n|section=third A part\n|picker= Harry Clark\n|kind= break\n|instrument= mandolin\n}}\n"
           "{{Chartifact\n|section= second B part \n|kind=break\n|picker=Kyle Tuttle\n|instrument=5-string banjo\n|cut=QmB\n}}\n"
           "{{Chartifact\n|section=tag\n|instrument=fiddle\n}}\n")
    cuts = cc.studio_cuts_from(one)
    assert cc.chartifacts_from(one, cuts) == {"QmA": [["third A part", "break", "Harry Clark", "mandolin"]],
                                               "QmB": [["second B part", "break", "Kyle Tuttle", "5-string banjo"]]}
    two = one.replace("{{Chartifact", "{{Studio cut\n|record=Other\n|cid=QmC\n}}\n{{Chartifact", 1)
    # two cuts on the page: one naming no cut is no cut's
    assert cc.chartifacts_from(two, cc.studio_cuts_from(two)) == {"QmB": [["second B part", "break", "Kyle Tuttle", "5-string banjo"]]}


# ---- who wrote a song: its card says "by" them or "traditional" (Justin, #connectome, 23 Nov 2026, 18:30Z) ----

def test_a_songs_authors_are_its_composer_or_the_tradition():
    assert cc.authors_from('{{Song\n|composer=Justin Holmes\n}}') == ['Justin Holmes']
    assert cc.authors_from('{{Song\n|status=proposed\n|traditional=yes\n}}') == 'traditional'
    assert cc.authors_from('{{Song|traditional = Yes}}') == 'traditional'
    assert cc.authors_from('{{Song\n|composer=Justin Holmes\n|traditional=yes\n}}') == ['Justin Holmes']   # as the template shows it
    assert cc.authors_from('{{Song\n|status=proposed\n}}') is None                                         # nobody guessed
    assert cc.authors_from('{{Song\n|traditional=\n}}') is None
    assert cc.authors_from('Traditional, says the prose. {{Song}}') is None


def test_song_authors_are_read_off_every_page_with_a_song_block():
    class Api(cc.Wiki):
        def api(self, **q):
            if q.get('list') == 'embeddedin':
                assert q['eititle'] == 'Template:Song'
                return {'query': {'embeddedin': [{'title': 'Song:August'}, {'title': 'Song:Drowsy Maggie'}, {'title': 'Song:Victory'}]}}
            text = {'Song:August': '{{Song\n|composer=Justin Holmes\n}}', 'Song:Drowsy Maggie': '{{Song\n|traditional=yes\n}}',
                    'Song:Victory': '{{Song\n|status=proposed\n}}'}
            return {'query': {'pages': [{'title': t, 'revisions': [{'slots': {'main': {'content': x}}}]} for t, x in text.items()]}}

    assert Api('https://example.test/').song_authors() == {'August': ['Justin Holmes'], 'Drowsy Maggie': 'traditional'}


def test_the_graph_carries_the_authors_of_the_songs_it_names():
    pairs = [pair('Kyle Tuttle', 'Justin Holmes', 'track', 'arthel:4masks', [('u', '', 'august'), ('u', '', 'barlows-jig')])]
    whole = {'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []}}
    wiki = FakeWiki(pages={'Kyle Tuttle', '4masks'}, musicians=['Kyle Tuttle'])
    wiki.song_authors = lambda: {'August': ['Justin Holmes'], "Barlow's Jig": ['Justin Holmes'], 'Elsewhere': 'traditional'}
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 13), None, whole, [])['graph']
    named = {s for _, _, ev in g['ties'] for e in ev for s in e[3]}
    assert named == {'August', 'Barlows Jig'}
    assert g['authors'] == {'August': ['Justin Holmes'], 'Barlows Jig': ['Justin Holmes']}   # by the graph's own spelling; Elsewhere isn't in it


def test_the_graph_says_which_venues_and_acts_have_a_page():
    pairs = [pair('Kyle Tuttle', 'Sam Leslie', 'show', 'wiki:Show:K')]
    whole = {'wiki:Show:K': {'kind': 'show', 'title': 'Show:K', 'date': 'block 1', 'artist': 'Kyle Tuttle', 'grp': 'wiki:Show:K',
                             'formats': [], 'venue': "Dee's Country Cocktail Lounge", 'city': '', 'poster': '',
                             'bands': [{'title': '', 'members': ['Kyle Tuttle', 'Sam Leslie']}]}}
    wiki = FakeWiki(pages={'Kyle Tuttle', 'Sam Leslie', "Dee's Country Cocktail Lounge"}, musicians=['Kyle Tuttle'])
    credits = [('Kyle Tuttle', '', 'wiki:Show:K', 'show', 'u'), ('Sam Leslie', 'bass', 'wiki:Show:K', 'show', 'u')]
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 26), None, whole, credits)['graph']
    names = [p[0] for p in g['people']]
    k = [i for i, m in enumerate(g['music']) if m[0] == 'wiki:Show:K'][0]
    assert g['acts'][str(k)] == [['Kyle Tuttle', [names.index('Kyle Tuttle'), names.index('Sam Leslie')], names.index('Kyle Tuttle')]]
    assert "Dee's Country Cocktail Lounge" in g['wikipages'] and 'Kyle Tuttle' in g['wikipages']


def test_a_band_named_in_a_source_is_the_band_and_never_a_picker():
    pairs = [pair('Kyle Tuttle', 'Della Mae', 'show', 'lma:show1'), pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:show1'),
             pair('Della Mae', 'Molly Tuttle', 'show', 'lma:show1'), pair('Kyle Tuttle', 'The Dellas', 'record', 'discogs:1'),
             pair('Kyle Tuttle', 'Molly Tuttle', 'track', 'arthel:4masks', [('u', '', 'silver-44')])]
    whole = {'lma:show1': {'kind': 'show', 'title': 'Kyle Live', 'date': '2025-07-05', 'artist': 'Sam Grisman Project',
                           'grp': 'lma:show1', 'formats': []},
             'discogs:1': {'kind': 'record', 'title': 'Some Record', 'date': '2015', 'artist': 'Somebody', 'grp': 'discogs:1',
                           'formats': []},
             'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []}}
    credits = [('Kyle Tuttle', 'banjo', 'lma:show1', 'show', 'u'), ('Molly Tuttle', 'guitar', 'lma:show1', 'show', 'u'),
               ('della mae', '', 'lma:show1', 'show', 'u'), ('The Dellas', '', 'discogs:1', 'release', 'v'),
               ('Della Mae', '', 'arthel:4masks', 'none', 'w')]      # named there, and not as playing ("a Della Mae cover")
    wiki = FakeWiki(redirects={'The Dellas': 'Della Mae', 'Kimber': 'Kimber Ludiker'},
                    pages={'Kyle Tuttle', 'Molly Tuttle', 'Della Mae', 'Kimber Ludiker'}, musicians=['Kyle Tuttle'])
    bands = [{'band': 'Della Mae', 'kind': 'regular', 'leader': '', 'offshoot_of': '', 'billed_as': ['della mae'],
              'stints': [{'name': 'Kimber', 'plays': 'fiddle', 'from': '', 'until': ''}]}]
    result = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 27), None, whole, credits, bands)
    g = result['graph']
    names = [p[0] for p in g['people']]
    assert names == ['Kimber Ludiker', 'Kyle Tuttle', 'Molly Tuttle']       # the band is out; its member is in, by her page's name
    assert [(names[a], names[b]) for a, b, _ in g['ties']] == [('Kyle Tuttle', 'Molly Tuttle')]
    music = [m[0] for m in g['music']]
    # where a source names it: the show. Not the record nobody else here is on, nor where it is named and not playing
    assert 'arthel:4masks' in music and 'discogs:1' not in music
    assert g['bands'] == [['Della Mae', 'regular', -1, '', ['della mae'], [[0, 'fiddle', '', '']], [music.index('lma:show1')]]]
    assert 'Della Mae' not in result['cards']['Kyle Tuttle']                # nor on anybody's card
    before = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 27), None, whole, credits)['graph']
    assert 'Della Mae' in [p[0] for p in before['people']] and 'bands' not in before    # with no band page, as it was


def test_the_bands_are_read_back_from_the_store_and_an_older_store_has_none(tmp_path):
    import sqlite3
    import connectome_store
    bands = [{'band': 'The Band', 'kind': 'regular', 'leader': 'Ann', 'offshoot_of': '', 'billed_as': ['Band', 'Them'],
              'stints': [{'name': 'Ann', 'plays': 'fiddle', 'from': '2015', 'until': '', 'source': 'u', 'checked': '2026-11-27'},
                         {'name': 'Bob', 'plays': 'bass', 'from': '', 'until': '2019-03'}]}]
    connectome_store.to_sqlite([], str(tmp_path / 'c.sqlite'), bands).close()
    assert cc.load_bands(str(tmp_path / 'c.sqlite')) == [
        {'band': 'The Band', 'kind': 'regular', 'leader': 'Ann', 'offshoot_of': '', 'billed_as': ['Band', 'Them'],
         'stints': [{'name': 'Ann', 'plays': 'fiddle', 'from': '2015', 'until': ''},
                    {'name': 'Bob', 'plays': 'bass', 'from': '', 'until': '2019-03'}]}]
    sqlite3.connect(str(tmp_path / 'old.sqlite')).execute('CREATE TABLE targets (id TEXT)').connection.commit()
    assert cc.load_bands(str(tmp_path / 'old.sqlite')) == []


def test_a_band_billed_as_its_leader_leaves_the_leader_a_picker():
    pairs = [pair('Billy Strings', 'Jarrod Walker', 'show', 'lma:show1'), pair('Billy Strings Band', 'Jarrod Walker', 'show', 'lma:show1')]
    whole = {'lma:show1': {'kind': 'show', 'title': 'Live', 'date': '2025-07-05', 'artist': 'Billy Strings', 'grp': 'lma:show1',
                           'formats': []}}
    credits = [('Billy Strings', 'guitar', 'lma:show1', 'show', 'u'), ('Jarrod Walker', 'mandolin', 'lma:show1', 'show', 'u')]
    wiki = FakeWiki(pages={'Billy Strings', 'Jarrod Walker', 'Billy Strings (band)'})
    bands = [{'band': 'Billy Strings (band)', 'kind': 'regular', 'leader': 'Billy Strings', 'offshoot_of': '',
              'billed_as': ['Billy Strings', 'Billy Strings Band'], 'stints': [{'name': 'Jarrod Walker', 'plays': 'mandolin', 'from': '', 'until': ''}]}]
    g = cc.build(pairs, TARGETS, GROUPS, wiki, date(2026, 11, 27), None, whole, credits, bands)['graph']
    names = [p[0] for p in g['people']]
    assert names == ['Billy Strings', 'Jarrod Walker']                      # the leader stays; "Billy Strings Band" is the band
    assert g['bands'][0][:3] == ['Billy Strings (band)', 'regular', 0]
    assert [(names[a], names[b]) for a, b, _ in g['ties']] == [('Billy Strings', 'Jarrod Walker')]
