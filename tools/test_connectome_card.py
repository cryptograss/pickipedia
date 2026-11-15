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

    def studio_cuts(self):
        return self.cuts

    def record_artists(self, titles):
        return {t: self._ra[t] for t in titles if t in self._ra}


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
    assert ('title="Kyle Tuttle → Justin Myles Holmes: “Silver 44”, 4masks">'
            '<a href="/assets/connectome/?a=Kyle+Tuttle&amp;b=Justin+Myles+Holmes">1</a></td>') in html   # the number opens the path
    assert 'Molly Tuttle → Gaven Largent: Some Record, 2015"><a href="/assets/connectome/?a=Kyle+Tuttle&amp;b=Gaven+Largent">2</a></td>' in html
    assert html.count('<tr>') == 3
    # a click opens the big graph on the connection, or on the path
    assert '/assets/connectome/?a=Kyle+Tuttle&amp;b=Justin+Myles+Holmes' in html
    assert '/assets/connectome/?from=Kyle+Tuttle&amp;to=Gaven+Largent' in html


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
                       [], lambda n: True, {})
        assert f'stroke="{colour}"' in html and 'stroke-dasharray="1 5"' not in html
    html = cc.card('K', cc.Store(pairs[2:], targets, {t: t for t in targets}, {}, tiers), [], lambda n: True, {})
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
    # the CID goes in the links (data-cut, the explore href, the centre's link, the play chip), not the text
    assert card.count('QmSongCid') == 4 and card.count('href="/rabbithole/?track=QmSongCid"') == 1
    assert '?cut=QmSongCid' in card                                          # the explore link opens this cut's graph
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


def test_a_cut_with_no_artist_said_carries_none():
    import connectome_graph as cg
    g = cg.export([], song_whole(), [], lambda n: True, {}, [], '2026-11', cc.song, {}, '2026-11-15', {},
                  songcuts={'August': [{'record': '4masks', 'number': '5', 'cid': 'QmAugCut', 'recorded': '',
                                        'artist': '', 'cast': {'Kyle Tuttle': 'banjo'}}]})
    assert g['songcast']['QmAugCut']['artist'] is None
