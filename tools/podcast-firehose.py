#!/usr/bin/env python3
"""
Bluegrass Podcast Firehose - Aggregates RSS feeds from bluegrass podcasts
into a single combined feed, sorted by publication date.

Reads feed URLs from a config file, fetches each one, merges all episodes,
and outputs a combined RSS XML file.
"""

import json
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime, format_datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

import podcast_config
import podcast_net

USER_AGENT = "PickiPedia Bluegrass Podcast Firehose/1.0"
FETCH_TIMEOUT = 30
MAX_EPISODES_PER_FEED = 50
MAX_TOTAL_EPISODES = 200


def load_feeds(prefer_wiki=True):
    """
    Which podcasts to aggregate.

    Comes from the wiki, where the people who actually listen to these shows can
    add one without a GitHub account. Falls back to the checked-in JSON when the
    wiki is unreachable — this runs on a timer and publishes a feed people
    subscribe to, so it must not stop publishing because the wiki is down.

    @param prefer_wiki: Set false to force the checked-in copy.
    @return: List of feed dicts with at least name and url.
    """
    feeds, _patterns = podcast_config.load(prefer_wiki=prefer_wiki)
    return feeds


def fetch_feed(url, display_name=None):
    """
    Fetch and parse an RSS feed, returning (channel_info, items).

    display_name is our curated name for the show, from podcast-feeds.json. It
    overrides the feed's own title — see channel_info below for why.
    """
    try:
        raw = podcast_net.fetch_bytes(url, USER_AGENT, timeout=FETCH_TIMEOUT)
    except podcast_net.UnsafeFeedURL as e:
        # Somebody put a URL on a wiki page that points at our own network, or
        # at something too large to parse. Skip the show, keep the feed.
        print(f"  REFUSED {url}: {e}", file=sys.stderr)
        return None, []
    except (URLError, TimeoutError) as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return None, []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        print(f"  WARN: Failed to parse {url}: {e}", file=sys.stderr)
        return None, []

    channel = root.find("channel")
    if channel is None:
        return None, []

    title_el = channel.find("title")
    link_el = channel.find("link")

    # Our name for the show wins over whatever the feed calls itself. Upstream
    # titles are not maintained for display: one of these feeds announces
    # itself as "The Appalachian Sunday Morning With Host Danny Hensley
    # 9-24-2023", a stale episode title, and every one of its episodes would
    # carry that as its label. podcast-feeds.json is where we decide what a
    # show is called.
    channel_info = {
        "title": display_name or (title_el.text if title_el is not None else "Unknown"),
        "link": link_el.text if link_el is not None else "",
    }

    items = []
    for item in channel.findall("item")[:MAX_EPISODES_PER_FEED]:
        items.append((channel_info, item, raw_pubdate(item)))

    return channel_info, items


def raw_pubdate(item):
    """Extract pubDate as datetime for sorting. Returns epoch 0 on failure."""
    pd = item.find("pubDate")
    if pd is not None and pd.text:
        try:
            return parsedate_to_datetime(pd.text)
        except (ValueError, TypeError):
            pass
    return datetime(1970, 1, 1)


def select_episodes(all_items, max_total):
    """
    Choose which episodes make the cut, giving every show a turn before giving
    any show a second one.

    Sorting everything by date and taking the top N silences the quiet feeds
    outright. A podcast that publishes monthly never outranks one that
    publishes several times a week, so it disappears from a firehose whose
    entire purpose is to show the scene — measured on the live feeds, five of
    thirteen shows had zero episodes in the output. Toy Heart and County Sales
    Radio Hour are not less worth hearing for being less frequent.

    So: round-robin through the shows, newest first within each, until the
    budget runs out. Every show that published anything gets at least one slot,
    and the leftover capacity still flows to whoever posts most. The result is
    sorted by date at the end, so the feed still reads chronologically.

    @param all_items: (channel_info, item, pubdate) tuples across every feed.
    @param max_total: How many episodes the combined feed may carry.
    @return: The selected tuples, newest first.
    """
    by_show = {}
    for entry in all_items:
        channel_info = entry[0]
        key = channel_info.get("link") or channel_info.get("title")
        by_show.setdefault(key, []).append(entry)

    for entries in by_show.values():
        entries.sort(key=lambda x: x[2], reverse=True)

    selected = []
    round_index = 0
    while len(selected) < max_total:
        took_any = False
        for entries in by_show.values():
            if round_index < len(entries):
                selected.append(entries[round_index])
                took_any = True
                if len(selected) >= max_total:
                    break
        if not took_any:
            # Every show is exhausted; the feeds simply hold less than the cap.
            break
        round_index += 1

    selected.sort(key=lambda x: x[2], reverse=True)
    return selected


def build_combined_feed(feeds_config, all_items):
    """Build a combined RSS feed XML string."""
    now = format_datetime(datetime.now().astimezone())

    rss = ET.Element("rss", version="2.0")
    rss.set("xmlns:itunes", "http://www.itunes.com/dtds/podcast-1.0.dtd")
    rss.set("xmlns:content", "http://purl.org/rss/1.0/modules/content/")

    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "PickiPedia Bluegrass Podcast Firehose"
    ET.SubElement(channel, "link").text = "https://pickipedia.xyz/wiki/Bluegrass_Podcast_Firehose"
    ET.SubElement(channel, "description").text = (
        "A combined feed of bluegrass and traditional music podcasts, "
        "aggregated by PickiPedia. Episodes from multiple shows sorted by date."
    )
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "lastBuildDate").text = now
    ET.SubElement(channel, "generator").text = "PickiPedia Bluegrass Podcast Firehose"

    for channel_info, item, pubdate in select_episodes(all_items, MAX_TOTAL_EPISODES):
        new_item = ET.SubElement(channel, "item")

        # Copy standard elements
        for tag in ("title", "link", "description", "pubDate", "guid", "enclosure"):
            el = item.find(tag)
            if el is not None:
                new_el = ET.SubElement(new_item, tag)
                new_el.text = el.text
                for k, v in el.attrib.items():
                    new_el.set(k, v)

        # Copy itunes elements
        ns = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
        for itunes_tag in ("duration", "summary", "image", "explicit"):
            el = item.find(f"itunes:{itunes_tag}", ns)
            if el is not None:
                new_el = ET.SubElement(new_item, f"itunes:{itunes_tag}")
                new_el.text = el.text
                for k, v in el.attrib.items():
                    new_el.set(k, v)

        # Prepend podcast name to title
        title_el = new_item.find("title")
        if title_el is not None and title_el.text:
            title_el.text = f"[{channel_info['title']}] {title_el.text}"

        # Add source category
        source_el = ET.SubElement(new_item, "source", url=channel_info.get("link", ""))
        source_el.text = channel_info["title"]

    return rss


def main():
    feeds = load_feeds()
    print(f"Fetching {len(feeds)} feeds...", file=sys.stderr)

    all_items = []
    for feed in feeds:
        name = feed.get("name", feed["url"])
        print(f"  Fetching: {name}...", file=sys.stderr)
        channel_info, items = fetch_feed(feed["url"], feed.get("name"))
        if items:
            print(f"    Got {len(items)} episodes", file=sys.stderr)
            all_items.extend(items)
        else:
            print(f"    No episodes found", file=sys.stderr)

    print(f"Total episodes: {len(all_items)}", file=sys.stderr)

    rss = build_combined_feed(feeds, all_items)

    # Output
    ET.indent(rss)
    tree = ET.ElementTree(rss)
    output = sys.argv[1] if len(sys.argv) > 1 else None
    if output:
        tree.write(output, encoding="unicode", xml_declaration=True)
        print(f"Written to {output}", file=sys.stderr)
    else:
        print('<?xml version="1.0" encoding="UTF-8"?>')
        ET.dump(rss)


if __name__ == "__main__":
    main()
