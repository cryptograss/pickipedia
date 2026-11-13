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
    def __init__(self, redirects=None, pages=(), musicians=(), inst=None, featured=FEATURED):
        self.redirects, self.pages = redirects or {}, set(pages)
        self.musicians, self.inst, self.featured = list(musicians), inst or {}, featured

    def resolve(self, names):
        out = {}
        for n in names:
            t = self.redirects.get(n, n)
            out[n] = (t, t in self.pages)
        return out

    def raw(self, title):
        assert title == cc.FEATURED_PAGE
        return self.featured

    def musician_pages(self):
        return self.musicians

    def instruments(self):
        return self.inst


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


def test_a_card_draws_the_featured_paths_and_escapes_every_name():
    store = _store()
    html = cc.card('Kyle Tuttle', store, ['Justin Myles Holmes', 'Gaven Largent', 'Kyle Tuttle'],
                   lambda n: n in ('Justin Myles Holmes', 'Kyle Tuttle'), {'Justin Myles Holmes': 'guitar'})
    assert html.startswith('<div class="connectome-card"')
    assert '<script>' not in html and '&lt;script&gt;alert(1)&lt;/script&gt;' in html
    assert '>Justin Myles Holmes</a>' in html                            # the featured picker, linked
    assert 'Instrument-icon-guitar.png' in html
    # the table: one hop to Justin, two to Gaven through Molly; the picker isn't listed against themselves
    assert 'title="Kyle Tuttle → Justin Myles Holmes: “Silver 44”, 4masks">1<' in html
    assert 'Molly Tuttle → Gaven Largent: Some Record, 2015">2<' in html
    assert html.count('<tr>') == 3
    # a click opens the big graph on the connection, or on the path
    assert '/assets/connectome/?a=Kyle+Tuttle&amp;b=Justin+Myles+Holmes' in html
    assert '/assets/connectome/?from=Kyle+Tuttle&amp;to=Gaven+Largent' in html


def test_no_card_for_someone_who_played_with_nobody():
    store = cc.Store([pair('A', 'B', 'record', 'discogs:1')], TARGETS, GROUPS, {})
    assert cc.card('A', store, ['B'], lambda n: True, {}) is None


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
