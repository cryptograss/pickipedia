#!/usr/bin/env python3
"""
Tests for Taper. The ABC used here is a bare C-major scale, written for
the test; it is nobody's transcription. abc2midi is faked, so nothing here
needs it installed.
"""

import json
import subprocess

import pytest

import taper

SCALE = "X:1\nT:Test scale\nM:4/4\nL:1/8\nK:C\nCDEF GABc|\n"


def args(tmp_path, **kw):
    abc = tmp_path / "in.abc"
    abc.write_text(SCALE)
    base = dict(abc=str(abc), id="test-scale", title="Test scale", kind="traditional",
                source="typed in for the test", license="CC0-1.0", by="justin", notes_by="justin",
                block=26349540, out=str(tmp_path / "music"))
    base.update(kw)
    return taper.argparse.Namespace(**base)


def fake_abc2midi(cmd, **kw):
    open(cmd[cmd.index("-o") + 1], "wb").write(b"MThd")
    return subprocess.CompletedProcess(cmd, 0)


def test_add_writes_lineage_with_empty_earcheck(tmp_path):
    taper.add(args(tmp_path), run=fake_abc2midi)
    path = tmp_path / "music" / "test-scale.lineage.json"
    lineage = json.loads(path.read_text())
    assert lineage["file"] == "test-scale.mid" and lineage["abc"] == "test-scale.abc"
    assert lineage["fetchedBy"] == "justin" and lineage["fetchedAtBlock"] == 26349540
    assert lineage["earCheckedBy"] == ""
    assert taper.gaps_in(taper.read(str(path))) == ["no earCheckedBy"]


def test_failed_conversion_leaves_no_file(tmp_path):
    taper.add(args(tmp_path), run=lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1))
    lineage = taper.read(str(tmp_path / "music" / "test-scale.lineage.json"))
    assert lineage["file"] == "" and "no file" in taper.gaps_in(lineage)


def test_earcheck_makes_it_playable(tmp_path, capsys):
    taper.add(args(tmp_path), run=fake_abc2midi)
    path = str(tmp_path / "music" / "test-scale.lineage.json")
    taper.earcheck(taper.argparse.Namespace(lineage=path, by="skyler", block=26349600))
    assert capsys.readouterr().out.strip().endswith("playable")
    assert taper.check(taper.argparse.Namespace(dir=str(tmp_path / "music"))) == 0


@pytest.mark.parametrize("name", ["blu", "Magent", " re "])
def test_emergents_cannot_fetch_or_earcheck(tmp_path, name):
    with pytest.raises(SystemExit):
        taper.add(args(tmp_path, by=name), run=fake_abc2midi)
    taper.add(args(tmp_path), run=fake_abc2midi)
    with pytest.raises(SystemExit):
        taper.earcheck(taper.argparse.Namespace(
            lineage=str(tmp_path / "music" / "test-scale.lineage.json"), by=name, block=1))


def test_hand_edited_emergent_name_is_a_gap():
    gaps = taper.gaps_in({"id": "x", "title": "x", "kind": "traditional", "notesBy": "blu",
                              "source": "s", "license": "l", "earCheckedBy": "justin", "file": "x.mid"})
    assert gaps == ["notesBy is blu, an emergent; it has to be a person"]


def test_check_fails_when_any_tune_has_gaps(tmp_path):
    taper.add(args(tmp_path), run=fake_abc2midi)
    assert taper.check(taper.argparse.Namespace(dir=str(tmp_path / "music"))) == 1


def test_missing_midi_on_disk_is_a_gap(tmp_path):
    taper.add(args(tmp_path), run=fake_abc2midi)
    (tmp_path / "music" / "test-scale.mid").unlink()
    lineage = taper.read(str(tmp_path / "music" / "test-scale.lineage.json"))
    assert "test-scale.mid is not there" in taper.gaps_in(lineage)
