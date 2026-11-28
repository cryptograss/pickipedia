"""Tests for band_dumb.py: a band's stints set beside what its tapes say.

What these guard: a stint and an ensemble never answer for each other (a tape names who it names, the roster is
only what the stints say); what doesn't agree is flagged for a person and nothing is made of it; the band comes
from its page's verified lines the same as from a file. Every tape here is made up; the stints are the trial's
(band_mccourys.json). No test touches the network.
"""
import json
import pathlib

import band_dumb as bd

HERE = pathlib.Path(__file__).parent
BAND = json.loads((HERE / "band_mccourys.json").read_text())
NAMES = ["Sierra Hull", "Mike Bub", "David Grier"]


def tape(ident, date, lines, title=None, creator="The Travelin' McCourys"):
    return {"metadata": {"identifier": ident, "date": date, "creator": creator,
                         "title": title or f"The Travelin' McCourys Live at Somewhere on {date}",
                         "description": "\n".join(lines)}, "files": []}


FIVE = ["Ronnie McCoury - mandolin", "Robbie McCoury - banjo", "Allen Bartram - bass", "Jason Carter - fiddle",
        "Cody Kilby - guitar"]
TAPES = [
    tape("tm2016", "2016-06-01", FIVE + ["with Sierra Hull - mandolin"]),
    tape("tm2014", "2014-05-24", FIVE),                                        # Kilby, a year and a half before his stint
    tape("tm2021", "2021-06-30", ["Jason Carter - fiddle", "Cody Kilby - guitar"]),
    tape("jcb2024", "2024-01-12", ["Jason Carter - fiddle", "Mike Bub - bass", "David Grier - guitar"],
         title="Jason Carter Band Live at The Station Inn on 2024-01-12"),
    tape("tm2025", "2025-06-19", ["Ronnie McCoury - mandolin", "Rob McCoury - banjo", "Alan Bartram - bass",
                                  "Christian Ward - fiddle", "Cody Kilby - guitar"]),
]


def rows():
    return {r["id"]: r for r in bd.audit(BAND, TAPES, NAMES)}


def test_the_trials_file_is_a_band_as_the_tool_takes_it():
    assert BAND["name"] == "The Travelin' McCourys" and len(BAND["stints"]) == 6
    for s in BAND["stints"]:                                    # every stint says where it was read
        assert s["name"] and s["plays"] and s["source"].startswith("https://")
    assert all(set(s) <= {"name", "plays", "from", "until", "source", "also_written"} for s in BAND["stints"])


def test_the_lineups_come_from_the_stints_alone_and_are_the_stores():
    import connectome_store
    assert bd.lineups is connectome_store.lineups and bd.lineup_at is connectome_store.lineup_at      # one reading of a stint
    got = bd.lineups(BAND["stints"])
    assert [(a, b) for a, b, _ in got] == [("", "2015-11-10"), ("2015-11-10", "2025-02-10"), ("2025-02-10", "2025-02-24"),
                                           ("2025-02-24", "")]
    assert [len(who) for _, _, who in got] == [4, 5, 4, 5]
    assert "Jason Carter" not in got[2][2] and "Christian Ward" in got[3][2] and "Christian Ward" not in got[2][2]


def test_a_tape_is_set_beside_the_roster_of_its_night():
    got = rows()
    assert [r["id"] for r in bd.audit(BAND, TAPES, NAMES)] == ["tm2014", "tm2016", "tm2021", "jcb2024", "tm2025"]   # by night
    r = got["tm2016"]
    assert r["roster"] == r["said"] == ["Alan Bartram", "Cody Kilby", "Jason Carter", "Rob McCoury", "Ronnie McCoury"]
    assert r["unsaid"] == [] and r["others"] == ["Sierra Hull"] and r["flags"] == []
    # a name a taper wrote another way is the member, and nobody else
    assert "Robbie McCoury" not in r["others"] and "Allen Bartram" not in r["others"]
    r = got["tm2025"]                                           # after the change of fiddlers
    assert "Christian Ward" in r["said"] and "Jason Carter" not in r["roster"] and r["flags"] == []


def test_what_does_not_agree_is_flagged_and_nothing_is_made_of_it():
    got = rows()
    early = got["tm2014"]
    assert early["roster"] == ["Alan Bartram", "Jason Carter", "Rob McCoury", "Ronnie McCoury"]     # the stints, not the tape
    assert early["others"] == ["Cody Kilby"] and early["flags"] == ["Cody Kilby named outside their stint"]
    assert got["tm2021"]["flags"] == ["names 2 of the 5 members"]
    assert got["tm2021"]["unsaid"] == ["Alan Bartram", "Rob McCoury", "Ronnie McCoury"]
    other = got["jcb2024"]                                      # another act's night, filed under the band
    assert other["flags"][0] == "the tape's own title names another act"
    assert BAND["stints"] == json.loads((HERE / "band_mccourys.json").read_text())["stints"]        # nothing written back


def test_candidates_are_who_the_bands_own_tapes_name_without_a_stint():
    got = bd.candidates(BAND, bd.audit(BAND, TAPES, NAMES))
    assert got == [("Sierra Hull", 1, "2016-06-01", "2016-06-01")]      # not Bub or Grier (another act's night), not Kilby (a member)


def test_the_timeline_has_a_bar_for_each_stint_and_a_tick_for_each_naming():
    svg = bd.timeline_svg(BAND, bd.audit(BAND, TAPES, NAMES), "2026-11-27", [["A Record", "2018-05-25"]])
    assert svg.startswith("<svg ") and svg.rstrip().endswith("</svg>")
    assert svg.count('opacity="0.82"/>') == 6 + 5               # six bars, and the five instruments of the key
    assert svg.count('fill="url(#unsourced)"/>') == 4           # four stints no source gives a start for: they fade in
    assert "Cody Kilby named on the tape of 2014-05-24" in svg
    red = [l for l in svg.splitlines() if 'stroke="#c0392b"' in l]
    assert len(red) == 1 and "Cody Kilby named on the tape of 2014-05-24" in red[0]         # outside his stint, and only that
    assert "named on the tape of 2024-01-12" not in svg         # another act's night makes no tick
    assert ">A Record</text>" in svg
    assert "#eda100" not in svg                                 # gold means Permanent, and nothing here is that


PAGE = """{{BandInfo
|kind=regular
|offshoot_of=[[The Del McCoury Band]]
|billed_as=Travelin' McCourys; The Traveling McCourys
}}
== Members ==
{{Band member|Ronnie McCoury|mandolin|source=https://www.thetravelinmccourys.com/about|checked=2026-11-27}}
{{Band member|[[Rob McCoury|Robbie]]|banjo}}
{{Band member|Jason Carter|fiddle|until=2025-02-10|source=https://example.com/a?b=c}}
{{Band member|Odd Dates|guitar|from=November 2015}}
<proposed by="Blu">
{{Band member|Christian Ward|fiddle|from=2025-02-24}}
</proposed>
"""


def test_a_band_is_read_from_its_pages_verified_lines():
    band = bd.from_page("The Travelin' McCourys", PAGE)
    assert band["name"] == "The Travelin' McCourys" and band["kind"] == "regular"
    assert band["offshoot_of"] == "The Del McCoury Band" and band["billed_as"] == ["Travelin' McCourys", "The Traveling McCourys"]
    assert [s["name"] for s in band["stints"]] == ["Ronnie McCoury", "Rob McCoury", "Jason Carter"]      # not the one that waits
    assert band["unread"] == ["Odd Dates: November 2015 to ?"]
    assert bd.from_page("A Person", "Just a picker, no band here.") is None
    assert bd.from_page("Nobody Yet", '<proposed by="Blu">\n{{BandInfo|kind=regular}}\n{{Band member|Ann}}\n</proposed>') is None
    # and it audits as a file's band does
    got = {r["id"]: r for r in bd.audit(band, TAPES, NAMES + ["Christian Ward"])}
    assert got["tm2025"]["roster"] == ["Rob McCoury", "Ronnie McCoury"]
    assert "Christian Ward" in got["tm2025"]["others"]          # on the tape; in the band only once a person agrees


def test_the_first_argument_is_a_file_or_a_pages_title(tmp_path, capsys):
    assert bd.load_band(str(HERE / "band_mccourys.json"))["name"] == "The Travelin' McCourys"
    asked = []
    band = bd.load_band("The Travelin' McCourys", get=lambda title: asked.append(title) or PAGE)
    assert asked == ["The Travelin' McCourys"] and len(band["stints"]) == 3
    assert bd.load_band("A Person", get=lambda title: "nothing") is None

    md = tmp_path / "md"
    md.mkdir()
    for t in TAPES + [tape("else2020", "2020-01-01", FIVE, creator="Somebody Else")]:
        (md / (t["metadata"]["identifier"] + ".json")).write_text(json.dumps(t))
    names = tmp_path / "names.txt"
    names.write_text("# the list\nSierra Hull\nMike Bub\nDavid Grier\n")
    out, svg = tmp_path / "out.json", tmp_path / "out.svg"
    assert bd.main(["band_dumb.py", str(HERE / "band_mccourys.json"), str(md), str(names), "--json", str(out), "--svg", str(svg)]) == 0
    said = capsys.readouterr().out
    assert "The Travelin' McCourys: 6 stints, 4 lineups, 5 tapes" in said          # the other creator's tape is not the band's
    assert "not a member, named on 1 tape(s), 2016-06-01 to 2016-06-01: Sierra Hull" in said
    wrote = json.loads(out.read_text())
    assert wrote["band"] == "The Travelin' McCourys" and len(wrote["tapes"]) == 5 and len(wrote["lineups"]) == 4
    assert svg.read_text().startswith("<svg ")
    # no file, and a page with no band on it: said, and nothing written
    assert bd.main(["band_dumb.py", "A Person", str(md), str(names)], get=lambda title: "Just a picker.") == 1
    assert "A Person: no file of that name, and no page with a verified band on it" in capsys.readouterr().out
