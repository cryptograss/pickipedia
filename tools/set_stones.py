#!/usr/bin/env python3
"""
Set stones, read off Arbitrum for the big graph: which show and set each is in, its three colours, the
message it was crystallized with, its favourite song, what was paid, and who holds it.

Justin, #connectome, 21 Nov 2026, 19:41Z: "let's definitely display them anywhere a show is displayed,
including connecting lines." So graph.json carries, beside each show that has stones:

  stones       music index -> [[token, set, [c1, c2, c3], message, favourite song, paid (ETH), holder], ...]
               c1..c3 index the NES palette, as arthel's stones do (setstone_color_palette.js). The favourite
               song is the set's songplay at the stone's index, as arthel's YAML writes it ("" where the set
               has none there). The holder is the address that owns it on chain.
  stones_read  {chain, contract, block, total}: the Arbitrum block every read was pinned to, and how many
               stones the contract says there are, so a reader can tell a stone the graph missed

A stone ties nobody to anybody: it sits beside its show, and gives no Bacon number.

Read at the cards' build, not the store's: a stone minted today is on tomorrow's graph without the store
being built again. Only the standard library and PyYAML: the contract is read with eth_call and its
answers decoded here.

    python3 tools/set_stones.py ../arthel/src/data      # print what would be attached
"""
import json
import os
import re
import sys
import urllib.request

CONTRACT = '0x39269b3FddFc9bf0626e5CFe4424aa51A77f7678'   # arthel src/build_logic/constants.js
RPC = os.environ.get('ARBITRUM_RPC', 'https://arb1.arbitrum.io/rpc')

# keccak-256 selectors of the contract's view functions (arthel src/abi/setStoneABI.js), worked out once
SEL = {
    'getShowData': '528ba72f',            # getShowData(uint16,uint64)
    'getStonesBySetId': '82c9bceb',       # getStonesBySetId(uint16,uint64,uint8)
    'getStoneColor': 'f070228b',          # getStoneColor(uint256)
    'getCrystalizationMsg': '35970803',   # getCrystalizationMsg(uint256)
    'getFavoriteSong': '0ffea278',        # getFavoriteSong(uint256)
    'getPaidAmountWei': 'ab08298a',       # getPaidAmountWei(uint256)
    'ownerOf': '6352211e',                # ownerOf(uint256)
    'totalSupply': '18160ddd',            # totalSupply()
}


def rpc(method, params, url=RPC):
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    req = urllib.request.Request(url, body, {'content-type': 'application/json', 'user-agent': 'pickipedia-connectome'})
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.load(r)
    if 'error' in out:
        raise RuntimeError(out['error'])
    return out['result']


def words(hexdata):
    h = hexdata[2:] if hexdata.startswith('0x') else hexdata
    return [h[i:i + 64] for i in range(0, len(h), 64)]


def uints(hexdata):
    """A returned uint256[] (the only thing returned)."""
    w = words(hexdata)
    start = int(w[0], 16) // 32
    n = int(w[start], 16)
    return [int(x, 16) for x in w[start + 1:start + 1 + n]]


def string(hexdata):
    """A returned string (the only thing returned)."""
    w = words(hexdata)
    start = int(w[0], 16) // 32
    n = int(w[start], 16)
    return bytes.fromhex(''.join(w[start + 1:])[:n * 2]).decode('utf-8', 'replace')


def show_parts(show_id):
    """'0-14628177' -> (0, 14628177); '0_7-123' asks for the first artist, as arthel's chain reading does."""
    m = re.fullmatch(r'(\d+)(?:_\d+)*-(\d+)', show_id)
    return (int(m.group(1)), int(m.group(2))) if m else None


def songplays(show_yaml, order):
    """The set's songplays by name, in the order arthel indexes them (every entry: teases and reprises too)."""
    sets = (show_yaml or {}).get('sets') or {}
    s = sets.get(order, sets.get(str(order))) or {}
    out = []
    for e in s.get('songplays') or []:
        out.append(e if isinstance(e, str) else (next(iter(e)) if isinstance(e, dict) and e else ''))
    return out


def eth(wei):
    """Wei as ETH, written short: 100000000000000000 -> '0.1'."""
    whole, frac = divmod(int(wei), 10 ** 18)
    return str(whole) + ('.' + str(frac).rjust(18, '0').rstrip('0') if frac else '')


def read(shows, call=rpc):
    """shows: {show id: its YAML}. Every stone in them, as of one block: {'read': {...}, 'stones': [...]}."""
    block = call('eth_blockNumber', [])

    def ask(fn, *args):
        return call('eth_call', [{'to': CONTRACT, 'data': '0x' + SEL[fn] + ''.join(format(int(a), '064x') for a in args)},
                                 block])

    stones = []
    for show_id in sorted(shows):
        parts = show_parts(show_id)
        if not parts:
            continue
        sets = int(words(ask('getShowData', *parts))[1], 16)
        for order in range(sets):
            for token in uints(ask('getStonesBySetId', *parts, order)):
                c = words(ask('getStoneColor', token))
                fav = int(ask('getFavoriteSong', token), 16)
                played = songplays(shows[show_id], order)
                stones.append({
                    'show': show_id, 'set': order, 'token': token,
                    'color': [int(c[0], 16), int(c[1], 16), int(c[2], 16)],
                    'message': string(ask('getCrystalizationMsg', token)),
                    'favorite': played[fav] if 0 <= fav < len(played) else '',
                    'paid': eth(int(ask('getPaidAmountWei', token), 16)),
                    'holder': '0x' + ask('ownerOf', token)[-40:],
                })
    return {'read': {'chain': 'arbitrum', 'contract': CONTRACT, 'block': int(block, 16),
                     'total': int(ask('totalSupply'), 16)},
            'stones': stones}


def load_shows(arthel_data):
    import yaml
    out = {}
    d = os.path.join(arthel_data, 'shows')
    for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if fn.endswith('.yaml'):
            with open(os.path.join(d, fn)) as f:
                out[fn[:-5]] = yaml.safe_load(f) or {}
    return out


def attach(graph, got):
    """Put what read() found into graph.json, beside the shows the graph has. Returns how many were placed."""
    at = {m[0]: i for i, m in enumerate(graph.get('music') or [])}
    placed = {}
    n = 0
    for s in sorted(got['stones'], key=lambda s: (s['show'], s['set'], s['token'])):
        i = at.get('arthel:show:' + s['show'])
        if i is None:
            continue
        placed.setdefault(str(i), []).append([s['token'], s['set'], s['color'], s['message'], s['favorite'], s['paid'],
                                              s['holder']])
        n += 1
    graph['stones'] = placed
    graph['stones_read'] = got['read']
    return n


def into(graph, arthel_data, call=rpc):
    """The build's one call: read and attach; a chain that can't be read leaves the graph as it was, and says so."""
    try:
        got = read(load_shows(arthel_data), call)
    except Exception as err:                                       # the graph is worth more than its stones
        print(f'Set stones: not read ({err})', file=sys.stderr)
        return None
    n = attach(graph, got)
    print(f"Set stones: {n} of {got['read']['total']} placed, read at Arbitrum block {got['read']['block']}",
          file=sys.stderr)
    return n


if __name__ == '__main__':
    print(json.dumps(read(load_shows(sys.argv[1])), indent=1, ensure_ascii=False))
