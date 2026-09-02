#!/usr/bin/env python3
"""
Tests for reading podcast configuration off the wiki.

The wiki is editable by anyone, which is the point of moving the config there
and also the reason these tests exist. Every case below is something a person
will eventually type — an unclosed bracket, a heading where a pattern should
be, a podcast page nobody has finished — and none of them may take the feed
down.
"""

import podcast_config as pc


# ---------------------------------------------------------------------------
# Reading the {{Podcast}} infobox
# ---------------------------------------------------------------------------

PAGE = """{{Podcast
|name=What's The Reason For This Podcast
|host=Kodi Nottingham
|description=Conversations, stories and a whole lot of laughs.
|website=https://rss.com/podcasts/whatsthereasonforthis/
|rss=https://media.rss.com/whatsthereasonforthis/feed.xml
}}

The podcast is co-hosted by [[Kodi Nottingham]] and someone named Shay.
"""


def test_reads_the_feed_url():
    assert pc.parse_feed_template(PAGE)["rss"] == \
        "https://media.rss.com/whatsthereasonforthis/feed.xml"


def test_reads_the_other_fields():
    fields = pc.parse_feed_template(PAGE)
    assert fields["host"] == "Kodi Nottingham"
    assert fields["website"] == "https://rss.com/podcasts/whatsthereasonforthis/"


def test_a_page_without_the_template_yields_nothing():
    assert pc.parse_feed_template("Just some prose about a podcast.") == {}


# ---------------------------------------------------------------------------
# Reading the pattern block
# ---------------------------------------------------------------------------

def block(body):
    return f'Some prose.\n\n<pre class="guest-patterns">\n{body}\n</pre>\n'


def test_reads_patterns_in_order():
    # Order is load-bearing: patterns are tried top to bottom and the first
    # match wins, so a general pattern above a specific one silently shadows it.
    got = pc.parse_patterns(block("^A - (?P<guest>.+)$\n^B - (?P<guest>.+)$"))
    assert [e["pattern"] for e in got] == ["^A - (?P<guest>.+)$", "^B - (?P<guest>.+)$"]


def test_skip_prefix_marks_an_episode_as_having_no_guest():
    got = pc.parse_patterns(block("skip: ^Backing track"))
    assert got == [{"pattern": "^Backing track", "skip": True}]


def test_comments_and_blank_lines_are_ignored():
    got = pc.parse_patterns(block("# why this one exists\n\n^A - (?P<guest>.+)$\n"))
    assert len(got) == 1


def test_alternation_pipes_survive():
    # The reason patterns live in a <pre> block rather than a template
    # parameter or an SMW property: both of those parse "|" as syntax and
    # truncate the pattern. Verified against the live wiki.
    source = block(r"^S\d+E\d+ - (?P<guest>Mason Via|Randy Steele|High Country)$")
    got = pc.parse_patterns(source)
    assert got[0]["pattern"].count("|") == 2


def test_a_broken_pattern_is_dropped_and_reported():
    # One person's stray bracket must not cost the other twelve podcasts their
    # guest names, so a pattern that will not compile is skipped, not raised.
    errors = []
    got = pc.parse_patterns(
        block("^good - (?P<guest>.+)$\n^bad ( unclosed\n^also good - (?P<guest>.+)$"),
        on_error=lambda line, msg: errors.append(line),
    )
    assert len(got) == 2
    assert errors == ["^bad ( unclosed"]


def test_a_page_with_no_block_has_no_patterns():
    assert pc.parse_patterns("Prose, an infobox, no patterns yet.") == []


def test_an_unmarked_pre_block_is_not_mistaken_for_patterns():
    # Pages use <pre> for ordinary examples too. Only the marked one counts.
    source = '<pre>\nnot patterns\n</pre>\n<pre class="guest-patterns">\n^A$\n</pre>'
    assert [e["pattern"] for e in pc.parse_patterns(source)] == ["^A$"]


# ---------------------------------------------------------------------------
# Merging the wiki with the checked-in fallback
# ---------------------------------------------------------------------------

def fake_wiki(monkeypatch, feeds, patterns):
    monkeypatch.setattr(pc, "load_from_wiki", lambda on_error=None: (feeds, patterns))


def fake_repo(monkeypatch, feeds, patterns):
    monkeypatch.setattr(pc, "load_from_repo", lambda: (feeds, patterns))


def test_the_wiki_wins_where_it_speaks(monkeypatch):
    fake_repo(monkeypatch, [{"name": "A", "url": "old"}], {"A": [{"pattern": "^old$"}]})
    fake_wiki(monkeypatch, [{"name": "A", "url": "new"}], {"A": [{"pattern": "^new$"}]})

    feeds, patterns = pc.load(log=lambda m: None)

    assert [f["url"] for f in feeds] == ["new"]
    assert patterns["A"] == [{"pattern": "^new$"}]


def test_podcasts_not_yet_migrated_are_kept(monkeypatch):
    # Mid-migration is the normal state for a while. Dropping the shows that
    # have not moved yet would quietly shrink the feed at whatever hour the
    # cron next ran.
    fake_repo(monkeypatch, [{"name": "A", "url": "a"}, {"name": "B", "url": "b"}],
              {"B": [{"pattern": "^b$"}]})
    fake_wiki(monkeypatch, [{"name": "A", "url": "a-wiki"}], {})

    feeds, patterns = pc.load(log=lambda m: None)

    assert sorted(f["name"] for f in feeds) == ["A", "B"]
    assert patterns["B"] == [{"pattern": "^b$"}]


def test_an_unreachable_wiki_falls_back_rather_than_failing(monkeypatch):
    def explode(on_error=None):
        raise OSError("connection refused")

    fake_repo(monkeypatch, [{"name": "A", "url": "a"}], {"A": []})
    monkeypatch.setattr(pc, "load_from_wiki", explode)

    said = []
    feeds, _ = pc.load(log=said.append)

    assert [f["name"] for f in feeds] == ["A"]
    assert any("unreachable" in m for m in said)


def test_forcing_the_repo_does_not_touch_the_network(monkeypatch):
    def explode(on_error=None):
        raise AssertionError("should not have called the wiki")

    fake_repo(monkeypatch, [{"name": "A", "url": "a"}], {})
    monkeypatch.setattr(pc, "load_from_wiki", explode)

    feeds, _ = pc.load(prefer_wiki=False, log=lambda m: None)
    assert [f["name"] for f in feeds] == ["A"]


# ---------------------------------------------------------------------------
# Named patterns
#
# Names change nothing about matching. They exist so a list of patterns can be
# reviewed — podcast-parsers.py reports the hit count per name, which is how a
# format the show really uses is told apart from a one-off bolted on to rescue
# a single straggler. A forty-one-pattern list is what happens without that.
# ---------------------------------------------------------------------------

def block(body):
    return '<pre class="guest-patterns">\n' + body + '\n</pre>'


def test_a_name_line_names_the_pattern_under_it():
    entries = pc.parse_patterns(block(
        "name: Guest then subject\n"
        "^(?P<guest>[A-Z][a-z]+ [A-Z][a-z]+) on .+$"
    ))
    assert entries[0]["name"] == "Guest then subject"
    assert entries[0]["pattern"].startswith("^(?P<guest>")


def test_a_skip_can_be_named_too():
    entries = pc.parse_patterns(block(
        "name: Jam tracks\n"
        "skip:^.+ bpm"
    ))
    assert entries[0]["name"] == "Jam tracks"
    assert entries[0]["skip"] is True


def test_a_name_applies_only_to_the_next_pattern():
    entries = pc.parse_patterns(block(
        "name: Only the first\n"
        "^first (?P<guest>.+)$\n"
        "^second (?P<guest>.+)$"
    ))
    assert entries[0]["name"] == "Only the first"
    assert "name" not in entries[1]


def test_patterns_without_names_still_work():
    entries = pc.parse_patterns(block("^(?P<guest>.+) interview$"))
    assert len(entries) == 1
    assert "name" not in entries[0]


def test_an_empty_name_is_not_recorded():
    entries = pc.parse_patterns(block(
        "name:\n"
        "^(?P<guest>.+)$"
    ))
    assert "name" not in entries[0]


def test_a_comment_is_not_a_name():
    entries = pc.parse_patterns(block(
        "# this is prose, not a name\n"
        "^(?P<guest>.+)$"
    ))
    assert "name" not in entries[0]
