"""Tests for connectome_graph.py: the big graph's one file, and the release tier read from a record's source."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import connectome_card as cc  # noqa: E402
import connectome_graph as cg  # noqa: E402


def pair(a, b, kind, target, tracks=()):
    return {'a': a, 'b': b, 'kind': kind, 'target': target, 'tracks': [list(t) for t in tracks]}


def test_a_tape_or_a_cryptograss_record_is_permanent():
    assert cg.tier('lma:SGP2025-07-05') == 2
    assert cg.tier('arthel:4masks', []) == 2


def test_a_record_is_full_only_when_its_source_lists_a_carrier_with_no_drm():
    assert cg.tier('discogs:1', ['CD (Album)']) == 1
    assert cg.tier('discogs:1', ['Vinyl (LP, Album, Limited Edition)']) == 1
    assert cg.tier('mb:x', ['12" Vinyl']) == 1
    assert cg.tier('discogs:1', ['File (FLAC)', 'CDr (EP)']) == 1          # one open carrier is enough


def test_what_the_source_does_not_say_is_not_guessed():
    assert cg.tier('discogs:1', []) == 0                                    # no format listed
    assert cg.tier('discogs:1') == 0
    assert cg.tier('discogs:1', ['File (FLAC)']) == 0                       # a file, of a kind nobody says
    assert cg.tier('mb:x', ['Digital Media']) == 0
    assert cg.tier('discogs:1', ['CD (Album, Copy Protected)']) == 0
    assert cg.tier('discogs:1', ['SACD (Album)', 'DVD']) == 0


def test_a_duet_weighs_more_than_a_seat_in_a_choir():
    duet = pair('A', 'B', 'track', 'discogs:1', [('u', '1', 'Duet')])
    choir = [pair(x, y, 'track', 'discogs:1', [('u', '2', 'Choir')])
             for i, x in enumerate('CDEFG') for y in 'CDEFG'[i + 1:]]
    track, stage, record = cg.casts([duet] + choir)
    assert cg.weight(duet, track, stage, record) == 1.0
    assert cg.weight(choir[0], track, stage, record) == 0.25               # five were there: 1 / (5 - 1)


def test_a_show_counts_once_however_many_songs_they_share_and_a_record_by_its_tracks():
    p = pair('A', 'B', 'track', 'lma:x', [('u', '', '01 One'), ('u', '', '02 Two'), ('u', '', '03 Three')])
    crowd = [pair('A', 'C', 'track', 'lma:x', [('u', '', '02 Two')]), pair('B', 'C', 'track', 'lma:x', [('u', '', '02 Two')])]
    track, stage, record = cg.casts([p] + crowd)
    assert cg.weight(p, track, stage, record, show=True) == 1.0             # a show: the closest they got there, a duet
    assert cg.weight(p, track, stage, record) == 2.5                        # a record: two duets and a trio, each cut
    show = [pair('A', 'B', 'show', 'lma:y'), pair('A', 'C', 'show', 'lma:y'), pair('B', 'C', 'show', 'lma:y')]
    track, stage, record = cg.casts(show)
    assert cg.weight(show[0], track, stage, record) == 0.5


TARGETS = {
    'arthel:4masks': {'kind': 'record', 'title': '4masks', 'date': '', 'artist': '', 'grp': 'arthel:4masks', 'formats': []},
    'lma:tape1': {'kind': 'show', 'title': 'SGP Live at Grassfire on 2025-07-05', 'date': '2025-07-05',
                  'artist': 'Sam Grisman Project', 'grp': 'lma-show:SGP|2025-07-05', 'formats': []},
    'lma:tape2': {'kind': 'show', 'title': 'SGP Live at Grassfire on 2025-07-05 (aud)', 'date': '2025-07-05',
                  'artist': 'Sam Grisman Project', 'grp': 'lma-show:SGP|2025-07-05', 'formats': []},
    'discogs:7': {'kind': 'record', 'title': 'Safe, Sensible And Sane', 'date': '2025', 'artist': 'Alison Brown',
                  'grp': 'discogs-master:9', 'formats': ['CD (Album)']},
    'discogs:8': {'kind': 'record', 'title': 'Streamed Only', 'date': '2024', 'artist': 'X', 'grp': 'discogs:8',
                  'formats': ['File (AAC)']},
}


def _export(pairs, credits=(), featured=('Kyle Tuttle',), pages=None, plays=None):
    return cg.export(pairs, TARGETS, list(credits), lambda n: n in ('Kyle Tuttle', 'Molly Tuttle'), {'Kyle Tuttle': 'banjo'},
                     list(featured), '2026-11', cc.song, pages or {}, '2026-11-13', plays)


def test_export_keeps_one_entry_a_show_the_closest_way_they_are_together():
    pairs = [pair('Kyle Tuttle', 'Molly Tuttle', 'show', 'lma:tape1'),
             pair('Kyle Tuttle', 'Molly Tuttle', 'track', 'lma:tape2', [('u', '', '01. My Mountain so High')]),
             pair('Kyle Tuttle', 'Sam Bush', 'apart', 'lma:tape1')]             # one bill, not one stage: no tie
    g = _export(pairs)
    names = [p[0] for p in g['people']]
    assert names == ['Kyle Tuttle', 'Molly Tuttle']                             # Sam Bush has no tie, so no place
    assert g['people'][0] == ['Kyle Tuttle', 1, 'banjo'] and g['featured'] == [0]
    assert len(g['ties']) == 1
    a, b, ev = g['ties'][0]
    assert (a, b) == (0, 1) and len(ev) == 1                                    # two tapes of one show: one time
    m, how, w, songs = ev[0]
    assert g['music'][m][0] == 'lma:tape2' and how == 3 and w == 1.0 and songs == ['01. My Mountain so High']
    two = _export([pair('Kyle Tuttle', 'Justin Myles Holmes', 'track', 'arthel:4masks', [('u', '', 'silver-44'), ('u', '', 'victory-ff7')])])
    assert two['ties'][0][2][0][2] == 2.0                                       # a record: each track they share counts
    assert g['music'][m][5] == 2 and g['music'][m][6] == 'https://archive.org/details/tape2'


def test_export_says_each_records_tier_and_where_to_check_it():
    pairs = [pair('Molly Tuttle', 'Vickie Vaughn', 'track', 'discogs:7', [('u', '9', "Girl, Have Money When You're Old")]),
             pair('Molly Tuttle', 'Vickie Vaughn', 'record', 'discogs:8'),
             pair('Kyle Tuttle', 'Justin Myles Holmes', 'track', 'arthel:4masks', [('gh/silver-44.yaml', '', 'silver-44')])]
    credits = [('Kyle Tuttle', '5-string banjo', 'arthel:4masks', 'track', 'gh/silver-44.yaml'),
               ('Justin Myles Holmes', 'guitar; Guitar; vocals', 'arthel:4masks', 'track', 'gh/silver-44.yaml'),
               ('Molly Tuttle', 'Vocals', 'discogs:7', 'track', 'https://www.discogs.com/release/7'),
               ('Somebody Else', 'Bass', 'discogs:7', 'release', 'https://www.discogs.com/release/7')]
    g = _export(pairs, credits, pages={'4masks': '/wiki/4masks', 'Song:Silver 44': '/wiki/Song:Silver_44'})
    music = {m[0]: m for m in g['music']}
    assert music['discogs:7'][5] == 1 and music['discogs:7'][6] == 'https://www.discogs.com/release/7'
    assert music['discogs:8'][5] == 0                                           # a file, of a kind nobody says
    assert music['arthel:4masks'][5:] == [2, 'gh/silver-44.yaml', '/wiki/4masks']
    assert g['songs'] == {'Silver 44': '/wiki/Song:Silver_44'}
    names = [p[0] for p in g['people']]
    cast = dict(zip([m[0] for m in g['music']], g['cast']))
    assert [names[i] for i, _ in cast['arthel:4masks']] == ['Justin Myles Holmes', 'Kyle Tuttle']
    assert dict((names[i], r) for i, r in cast['arthel:4masks'])['Justin Myles Holmes'] == 'guitar; vocals'
    assert [names[i] for i, _ in cast['discogs:7']] == ['Molly Tuttle']         # only pickers the graph has a place for
    tie = next(ev for a, b, ev in g['ties'] if {names[a], names[b]} == {'Molly Tuttle', 'Vickie Vaughn'})
    assert [e[1] for e in tie] == [3, 1]                                        # the track first, the looser record after


def test_the_pages_asked_after_are_cryptograsss_records_and_their_songs():
    pairs = [pair('A', 'B', 'track', 'arthel:4masks', [('u', '', 'silver-44'), ('u', '', 'victory-ff7')]),
             pair('A', 'B', 'track', 'lma:tape1', [('u', '', '01. Not [a] title')])]
    assert cg.arthel_pages(pairs, TARGETS, cc.song) == ['4masks', 'Song:Silver 44', 'Song:Victory']


def test_only_a_cryptograss_records_own_track_plays_in_rabbithole():
    pairs = [pair('Kyle Tuttle', 'Justin Myles Holmes', 'track', 'arthel:4masks', [('gh/silver-44.yaml', '', 'silver-44')]),
             pair('Kyle Tuttle', 'Molly Tuttle', 'track', 'lma:tape2', [('https://archive.org/details/tape2', '', '01. Silver 44')]),
             pair('Molly Tuttle', 'Vickie Vaughn', 'track', 'discogs:7', [('u', '9', 'Victory')])]
    plays = {'Silver 44': 'QmSilver', '01. Silver 44': 'QmTaped', 'Victory': 'QmVictory', 'Unasked': 'QmNo'}
    assert _export(pairs, plays=plays)['plays'] == {'Silver 44': 'QmSilver'}      # not the tape's take, nor another label's record
    assert _export(pairs)['plays'] == {}
