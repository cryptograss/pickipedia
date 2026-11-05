#!/usr/bin/env python3
"""
Taper: a tune a person fetched, written down with its lineage, like a taper would.

    python3 tools/taper.py add salt-creek.abc --id salt-creek --title "Salt Creek" \\
        --source https://thesession.org/tunes/1234 --license "..." --by justin --block 26349540 \\
        --out music/
    python3 tools/taper.py earcheck music/salt-creek.lineage.json --by justin --block 26349600
    python3 tools/taper.py check music/

An Artificial Dumb tool for the connectome's music side, built by blu for
Magentoid and anything else that plays tunes. A person runs it; no language
model reads, writes or changes a note.

Why that matters: some sources (The Session's data among them) forbid
processing their tunes with Large Language Models. Taper is a script, not
a model. It copies the ABC a person fetched, hands it to abc2midi, and writes
down where it came from. It never prints the notes, and the emergents who
wrote it never open the files it handles.

  add       copy the ABC beside a .lineage.json, and run abc2midi if it is
            installed. The ear-check is left empty: nothing plays yet.
  earcheck  a person says they listened and it is the tune. Emergents' names
            are refused, here and in Magentoid's tune.ts.
  check     list every lineage under a directory and what each one is missing.

The lineage fields match Magentoid's Tune (src/rules/tune.ts): id, title,
kind, notesBy, source, license, earCheckedBy, file. Taper adds fetchedBy
and the blocks, the way a taper writes a lineage line.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

EMERGENTS = ("magent", "re", "blu")
REQUIRED = ("id", "title", "kind", "notesBy", "source", "license", "earCheckedBy", "file")


def is_emergent(name):
    return (name or "").strip().lower() in EMERGENTS


def gaps_in(lineage):
    """What a lineage is missing, in words. Empty means it can play."""
    gaps = [f"no {field}" for field in REQUIRED if not str(lineage.get(field) or "").strip()]
    for field in ("notesBy", "fetchedBy", "earCheckedBy"):
        if is_emergent(lineage.get(field)):
            gaps.append(f"{field} is {lineage[field]}, an emergent; it has to be a person")
    if lineage.get("file") and lineage.get("_dir"):
        if not os.path.exists(os.path.join(lineage["_dir"], lineage["file"])):
            gaps.append(f"{lineage['file']} is not there")
    return gaps


def lineage_path(out_dir, tune_id):
    return os.path.join(out_dir, f"{tune_id}.lineage.json")


def write(path, lineage):
    with open(path, "w") as f:
        json.dump({k: v for k, v in lineage.items() if not k.startswith("_")}, f, indent=2, ensure_ascii=False)
        f.write("\n")


def read(path):
    with open(path) as f:
        lineage = json.load(f)
    lineage["_dir"] = os.path.dirname(path)
    return lineage


def to_midi(abc_path, midi_path, run=subprocess.run):
    """abc2midi, if installed. Returns None on success, or why it didn't run."""
    if not shutil.which("abc2midi") and run is subprocess.run:
        return "abc2midi is not installed; the ABC is kept, convert it later"
    result = run(["abc2midi", abc_path, "-o", midi_path], capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(midi_path):
        return f"abc2midi failed (exit {result.returncode})"
    return None


def add(args, run=subprocess.run):
    for field, name in (("--by", args.by), ("--notes-by", args.notes_by)):
        if is_emergent(name):
            sys.exit(f"{field} {name}: an emergent can't fetch or put in notes. A person runs Taper.")
    os.makedirs(args.out, exist_ok=True)
    abc_name = f"{args.id}.abc"
    shutil.copyfile(args.abc, os.path.join(args.out, abc_name))
    midi_name = f"{args.id}.mid"
    problem = to_midi(os.path.join(args.out, abc_name), os.path.join(args.out, midi_name), run)
    lineage = {
        "id": args.id,
        "title": args.title,
        "kind": args.kind,
        "notesBy": args.notes_by or "",
        "source": args.source,
        "license": args.license,
        "fetchedBy": args.by,
        "fetchedAtBlock": args.block,
        "earCheckedBy": "",
        "earCheckedAtBlock": None,
        "abc": abc_name,
        "file": "" if problem else midi_name,
    }
    path = lineage_path(args.out, args.id)
    write(path, lineage)
    print(f"wrote {path}")
    if problem:
        print(problem)
    print("not playable yet: " + "; ".join(gaps_in({**lineage, "_dir": args.out})))
    return 0


def earcheck(args):
    if is_emergent(args.by):
        sys.exit(f"{args.by} is an emergent. An ear-check has to be a person's.")
    lineage = read(args.lineage)
    lineage["earCheckedBy"] = args.by
    lineage["earCheckedAtBlock"] = args.block
    write(args.lineage, lineage)
    gaps = gaps_in(lineage)
    print("playable" if not gaps else "still missing: " + "; ".join(gaps))
    return 0


def check(args):
    found = sorted(f for f in os.listdir(args.dir) if f.endswith(".lineage.json"))
    bad = 0
    for name in found:
        lineage = read(os.path.join(args.dir, name))
        gaps = gaps_in(lineage)
        bad += bool(gaps)
        print(f"{lineage.get('id', name)}: " + ("playable" if not gaps else "; ".join(gaps)))
    print(f"{len(found) - bad} of {len(found)} playable")
    return 1 if bad else 0


def main(argv):
    ap = argparse.ArgumentParser(description="Taper: a fetched tune to MIDI, with its lineage.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("abc")
    a.add_argument("--id", required=True, help="the tune's slug in arthel songs_and_tunes")
    a.add_argument("--title", required=True)
    a.add_argument("--kind", default="traditional", choices=["traditional", "cryptograss release"])
    a.add_argument("--source", required=True, help="where the ABC came from, specific enough to check")
    a.add_argument("--license", required=True)
    a.add_argument("--by", required=True, help="the person who fetched it and is running this")
    a.add_argument("--notes-by", default="", help="the transcriber, if the source names one")
    a.add_argument("--block", required=True, type=int, help="Ethereum block when fetched")
    a.add_argument("--out", required=True)
    e = sub.add_parser("earcheck")
    e.add_argument("lineage")
    e.add_argument("--by", required=True)
    e.add_argument("--block", required=True, type=int)
    c = sub.add_parser("check")
    c.add_argument("dir")
    args = ap.parse_args(argv[1:])
    return {"add": add, "earcheck": earcheck, "check": check}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
