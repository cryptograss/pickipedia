"""A podcast feed must not be able to decide what the bot writes.

pickipedia#101. Feed titles and descriptions went into `{{PodcastEpisode}}`
parameters as raw f-string interpolations, so three characters belonging to
somebody else's XML — `|`, `{{`, `}}` — could set other parameters, close
the template and continue as page wikitext, or transclude a page the feed's
owner controls. The pages are written by a bot, unattended, on a schedule.

The hostile strings below are the point of the file. If someone later
"simplifies" the escaping away, these fail.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import podcast_wikitext  # noqa: E402
from podcast_wikitext import escape_param  # noqa: E402


def _load_hyphenated(name):
    """podcast-episodes.py is run, not imported, so load it by path."""
    spec = importlib.util.spec_from_file_location(
        name.replace('-', '_'), TOOLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class TestEscaping:
    def test_a_pipe_cannot_end_the_parameter(self):
        out = escape_param("Episode 12|topic=Tony Rice")
        assert "|" not in out
        assert "{{!}}" in out

    def test_a_closing_brace_pair_cannot_close_the_call(self):
        out = escape_param("Goodbye}}[[Category:Featured]]")
        assert "}}" not in out
        assert "[[" not in out

    def test_an_opening_brace_pair_cannot_transclude(self):
        assert "{{" not in escape_param("{{Delete}}")

    def test_the_pipe_escape_survives_the_brace_pass(self):
        """{{!}} is itself braces. Escaping in the wrong order eats it."""
        out = escape_param("a|b")
        assert out == "a{{!}}b"

    def test_a_lone_brace_is_left_alone(self):
        # Ordinary punctuation in a title; mangling it would be noise.
        assert escape_param("Set { of tunes") == "Set { of tunes"

    def test_newlines_become_spaces(self):
        # A line starting with a pipe inside a call reads as a parameter.
        assert "\n" not in escape_param("one\ntwo\r\nthree")

    def test_control_characters_are_dropped(self):
        assert escape_param("clean\x00er\x07") == "cleaner"

    def test_trimming_happens_before_escaping(self):
        """A cut must never land inside an entity and leave `&#12` behind."""
        out = escape_param("}} " + ("word " * 200), limit=50)
        assert "&#12" not in out.replace("&#123;", "").replace("&#125;", "")
        assert out.endswith("...")

    def test_none_and_numbers_are_tolerated(self):
        assert escape_param(None) == ""
        assert escape_param(3600) == "3600"

    def test_ordinary_text_is_untouched(self):
        plain = "Red Haired Boy, live at the Station Inn"
        assert escape_param(plain) == plain


@pytest.fixture(scope="module")
def episodes():
    return _load_hyphenated("podcast-episodes")


HOSTILE = {
    "title": "Nice Show|description=innocent}}[[Category:Featured]]{{Delete}}",
    "link": "https://example.com/a|b",
    "audio": "https://example.com/a.mp3|x",
    "pubdate": None,
    "description": "Sweet notes &#124;category=Spam&lcub;&lcub;Transclude&rcub;&rcub;",
}


class TestTheWholeTemplateCall:
    def test_a_hostile_feed_cannot_escape_its_parameters(self, episodes):
        text = episodes.make_wikitext("Some Podcast", dict(HOSTILE), [])

        # One opening and one closing brace pair: the ones we wrote.
        assert text.count("{{PodcastEpisode") == 1
        assert text.rstrip().endswith("}}")
        body = text[len("{{PodcastEpisode"):text.rstrip().rfind("}}")]
        assert "}}" not in body.replace("{{!}}", "")
        assert "[[" not in body

    def test_the_feed_cannot_invent_a_parameter(self, episodes):
        text = episodes.make_wikitext("Some Podcast", dict(HOSTILE), [])
        # Every line starting with a pipe is one we chose to write.
        ours = {"podcast", "title", "date", "url", "audio", "duration",
                "image", "description"}
        for line in text.splitlines():
            if line.startswith("|"):
                name = line[1:].split("=", 1)[0]
                assert name in ours or name.startswith("topic"), name

    def test_unescaped_entities_do_not_become_live_syntax(self, episodes):
        """html.unescape turns &#124; back into a pipe. The escape has to
        run after it, not instead of it."""
        text = episodes.make_wikitext("Some Podcast", dict(HOSTILE), [])
        desc = [l for l in text.splitlines() if l.startswith("|description=")]
        assert desc, "description should survive, just defanged"
        assert "{{!}}" in desc[0]
        assert "{{Transclude" not in desc[0]

    def test_a_hostile_topic_is_escaped_too(self, episodes):
        text = episodes.make_wikitext(
            "Some Podcast", dict(HOSTILE), ["Tony Rice|image=evil.png"])
        topic = [l for l in text.splitlines() if l.startswith("|topic=")][0]
        assert "|" not in topic[len("|topic="):]

    def test_an_ordinary_episode_is_unchanged_in_shape(self, episodes):
        text = episodes.make_wikitext("Some Podcast", {
            "title": "Red Haired Boy",
            "link": "https://example.com/1",
            "audio": "https://example.com/1.mp3",
            "pubdate": None,
            "description": "A tune and a chat.",
        }, ["Tony Rice"])
        assert "|title=Red Haired Boy" in text
        assert "|topic=Tony Rice" in text
        assert "|description=A tune and a chat." in text
        assert "&#12" not in text
