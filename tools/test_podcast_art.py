#!/usr/bin/env python3
"""Tests for episode artwork, using feed shapes our shows actually publish."""

from xml.etree.ElementTree import fromstring

from podcast_art import channel_image, episode_image, usable_image_url

NS = 'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"'


def feed(channel_bits, item_bits):
    root = fromstring(
        f'<rss {NS}><channel>{channel_bits}<item><title>x</title>{item_bits}</item>'
        f'</channel></rss>')
    return root.find("channel"), root.find(".//item")


class TestUsableImageUrl:
    def test_plain_jpg(self):
        url = "https://static.libsyn.com/p/assets/e/c/f/3/ecf39d/176_-_Ron_Stewart.jpg"
        assert usable_image_url(url) == url

    def test_buzzsprout_query_suffix(self):
        # Buzzsprout really does end its URLs "?.jpg".
        url = "https://storage.buzzsprout.com/v27trrjkyy9no5povh72y09jgv1e?.jpg"
        assert usable_image_url(url) == url

    def test_surrounding_whitespace_is_stripped(self):
        assert usable_image_url("  https://a.example/x.png\n") == "https://a.example/x.png"

    def test_not_an_image(self):
        assert usable_image_url("https://a.example/cover") is None

    def test_pipe_would_break_the_template_call(self):
        assert usable_image_url("https://a.example/a|b.jpg") is None

    def test_braces_would_break_the_template_call(self):
        assert usable_image_url("https://a.example/}}{{x.jpg") is None

    def test_not_http(self):
        assert usable_image_url("javascript:alert(1)//.jpg") is None

    def test_empty(self):
        assert usable_image_url(None) is None
        assert usable_image_url("") is None


class TestChannelImage:
    def test_itunes_image(self):
        channel, _ = feed('<itunes:image href="https://a.example/show.jpg"/>', "")
        assert channel_image(channel) == "https://a.example/show.jpg"

    def test_rss_image_only(self):
        channel, _ = feed("<image><url>https://a.example/show.png</url></image>", "")
        assert channel_image(channel) == "https://a.example/show.png"

    def test_bad_itunes_image_falls_through_to_rss_image(self):
        channel, _ = feed('<itunes:image href="https://a.example/show"/>'
                          "<image><url>https://a.example/show.png</url></image>", "")
        assert channel_image(channel) == "https://a.example/show.png"

    def test_none(self):
        channel, _ = feed("", "")
        assert channel_image(channel) is None


class TestEpisodeImage:
    def test_episode_has_its_own(self):
        _, item = feed("", '<itunes:image href="https://a.example/guest.jpg"/>')
        assert episode_image(item, "https://a.example/show.jpg") == "https://a.example/guest.jpg"

    def test_falls_back_to_the_show(self):
        _, item = feed("", "")
        assert episode_image(item, "https://a.example/show.jpg") == "https://a.example/show.jpg"

    def test_unusable_episode_image_falls_back(self):
        _, item = feed("", '<itunes:image href="https://a.example/guest"/>')
        assert episode_image(item, "https://a.example/show.jpg") == "https://a.example/show.jpg"

    def test_nothing_anywhere(self):
        _, item = feed("", "")
        assert episode_image(item, None) is None
