"""Tests for set_stones.py: the contract's answers decoded, a favourite song found in its set, the stones placed
beside the graph's shows, and a chain that can't be read leaving the graph alone.

No network: the chain is handed in. python3 -m pytest -q test_set_stones.py
"""
import set_stones as ss


def word(n):
    return format(n, '064x')


def enc_uints(xs):
    return '0x' + word(32) + word(len(xs)) + ''.join(word(x) for x in xs)


def enc_string(s):
    b = s.encode().hex()
    return '0x' + word(32) + word(len(s.encode())) + b.ljust(((len(b) + 63) // 64) * 64 or 64, '0')


SCHELLING = {'sets': {0: {'songplays': ["Rueben's Train", {'Terrapin Station': {'mode': 'tease'}},
                                        {'From Bill to Brewster': {'mode': 'reprise'}}]}}}


def chain(stones, sets=1, total=None):
    """A fake Arbitrum: stones {token: (set, colours, message, favourite index, wei, holder)}, one show of `sets`."""
    seen = []

    def call(method, params):
        seen.append(params[-1] if params else None)
        if method == 'eth_blockNumber':
            return hex(526324266)
        data = params[0]['data'][2:]
        sel, args = data[:8], [int(data[8 + i:8 + i + 64], 16) for i in range(0, len(data) - 8, 64)]
        if sel == ss.SEL['getShowData']:
            return '0x' + word(0) + word(sets) + word(10 ** 17) + word(160) + word(192) + word(0) + word(0)
        if sel == ss.SEL['getStonesBySetId']:
            return enc_uints([t for t, s in sorted(stones.items()) if s[0] == args[2]])
        s = stones[args[0]] if args else None
        if sel == ss.SEL['getStoneColor']:
            return '0x' + ''.join(word(c) for c in s[1])
        if sel == ss.SEL['getCrystalizationMsg']:
            return enc_string(s[2])
        if sel == ss.SEL['getFavoriteSong']:
            return '0x' + word(s[3])
        if sel == ss.SEL['getPaidAmountWei']:
            return '0x' + word(s[4])
        if sel == ss.SEL['ownerOf']:
            return '0x' + '0' * 24 + s[5]
        if sel == ss.SEL['totalSupply']:
            return '0x' + word(len(stones) if total is None else total)
        raise AssertionError('unasked ' + sel)
    call.seen = seen
    return call


def graph():
    return {'music': [['lma:x', 'show'], ['arthel:show:0-21940657', 'show'], ['arthel:record', 'record']]}


def test_a_stone_is_read_with_its_show_set_colours_message_favourite_price_and_holder():
    call = chain({4: (0, [23, 10, 34], 'Loved dancing with Z to this diddy.', 2, 10 ** 17, '839395e2' + '0' * 32)})
    got = ss.read({'0-21940657': SCHELLING}, call)
    assert got['read'] == {'chain': 'arbitrum', 'contract': ss.CONTRACT, 'block': 526324266, 'total': 5 - 4}
    assert got['stones'] == [{'show': '0-21940657', 'set': 0, 'token': 4, 'color': [23, 10, 34],
                              'message': 'Loved dancing with Z to this diddy.',
                              'favorite': 'From Bill to Brewster',   # index 2: teases and reprises count, as arthel's do
                              'paid': '0.1', 'holder': '0x839395e2' + '0' * 32}]


def test_every_read_is_pinned_to_one_block():
    call = chain({4: (0, [1, 2, 3], '', 0, 10 ** 17, 'ab' * 20)})
    ss.read({'0-21940657': SCHELLING}, call)
    assert set(call.seen[1:]) == {hex(526324266)}


def test_a_favourite_past_the_set_list_is_left_empty_not_guessed():
    call = chain({0: (0, [1, 2, 3], '', 9, 10 ** 17, 'ab' * 20)})
    assert ss.read({'0-21940657': SCHELLING}, call)['stones'][0]['favorite'] == ''


def test_a_show_of_several_artists_asks_for_the_first_and_a_strange_file_name_is_skipped():
    assert ss.show_parts('0_7-20550008') == (0, 20550008)
    assert ss.show_parts('notes') is None


def test_wei_reads_as_short_eth():
    assert ss.eth(10 ** 17) == '0.1' and ss.eth(2 * 10 ** 18) == '2' and ss.eth(1234500000000000000) == '1.2345'


def test_stones_sit_beside_the_graphs_own_show_and_nowhere_else():
    g = graph()
    got = {'read': {'block': 1, 'total': 3}, 'stones': [
        {'show': '0-21940657', 'set': 1, 'token': 7, 'color': [1, 2, 3], 'message': 'b', 'favorite': '', 'paid': '0.1',
         'holder': '0xb'},
        {'show': '0-21940657', 'set': 0, 'token': 4, 'color': [4, 5, 6], 'message': 'a', 'favorite': 'X', 'paid': '0.1',
         'holder': '0xa'},
        {'show': '0-1', 'set': 0, 'token': 9, 'color': [7, 8, 9], 'message': '', 'favorite': '', 'paid': '0.1',
         'holder': '0xc'}]}
    assert ss.attach(g, got) == 2
    assert g['stones'] == {'1': [[4, 0, [4, 5, 6], 'a', 'X', '0.1', '0xa'], [7, 1, [1, 2, 3], 'b', '', '0.1', '0xb']]}
    assert g['stones_read'] == {'block': 1, 'total': 3}


def test_a_chain_that_cannot_be_read_leaves_the_graph_as_it_was(tmp_path):
    (tmp_path / 'shows').mkdir()
    (tmp_path / 'shows' / '0-21940657.yaml').write_text('title: x\n')

    def down(method, params):
        raise OSError('no route to host')
    g = graph()
    assert ss.into(g, str(tmp_path), down) is None
    assert 'stones' not in g and 'stones_read' not in g
