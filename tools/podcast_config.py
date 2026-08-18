#!/usr/bin/env python3
"""
Podcast configuration, read from the wiki with the repo as a fallback.

Which podcasts we aggregate, and how guest names are pulled out of their
episode titles, is knowledge that lives with the people who listen to bluegrass
podcasts — not with the people who have push access to this repository. Keeping
it in JSON here meant adding a show required a GitHub account, a pull request
and a deploy, which selects for exactly the wrong people.

So the wiki is the source of truth. Each podcast gets a page in
Category:Podcasts holding a {{PodcastFeed}} template and, optionally, a block of
guest-name patterns.

Two decisions worth explaining, because both look arbitrary otherwise:

Patterns live in a <pre> block rather than in template parameters or SMW
properties. Both of those parse "|" as syntax, and regex alternation is made of
pipes — measured against the live wiki, a pattern containing (?:Interview|Chat)
comes back truncated from either. Read as raw wikitext, a <pre> block preserves
it byte for byte.

The repo JSON stays, as a fallback rather than as history. The firehose runs on
a timer and publishes a feed real people subscribe to; it must not stop
publishing because the wiki is briefly down, or because somebody left a brace
open while editing at midnight.
"""

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen, Request

WIKI_API = "https://pickipedia.xyz/api.php"
PODCAST_CATEGORY = "Category:Podcasts"
USER_AGENT = "PickiPedia Podcast Config/1.0"
FETCH_TIMEOUT = 30

HERE = Path(__file__).parent
FEEDS_JSON = HERE / "podcast-feeds.json"
PATTERNS_JSON = HERE / "podcast-guest-patterns.json"

# <pre class="guest-patterns"> ... </pre>, anywhere on the page. The class is
# what marks it, so a page can also use <pre> for ordinary examples.
PATTERN_BLOCK = re.compile(
    r'<pre[^>]*\bclass\s*=\s*"[^"]*\bguest-patterns\b[^"]*"[^>]*>\n?(.*?)</pre>',
    re.S | re.I,
)

# The {{Podcast}} infobox that already exists on the wiki, which carries the
# feed URL as rss= and adds [[Category:Podcasts]] on its own — so being in the
# category and having the template are the same fact, and there is no second
# thing for an editor to remember.
#
# Reading it as template parameters is safe where reading patterns that way is
# not: URLs, names and hosts contain no pipes, and pipes are the whole problem.
FEED_TEMPLATE = re.compile(r"\{\{\s*Podcast\s*(\|[^}]*)\}\}", re.S | re.I)


def _api(params):
    """GET the MediaWiki API and return parsed JSON."""
    url = f"{WIKI_API}?{urlencode({**params, 'format': 'json'})}"
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return json.load(resp)


def _category_members():
    """Page titles in Category:Podcasts."""
    data = _api({
        "action": "query",
        "list": "categorymembers",
        "cmtitle": PODCAST_CATEGORY,
        "cmlimit": "500",
    })
    return [p["title"] for p in data.get("query", {}).get("categorymembers", [])]


def _page_source(title):
    """Raw wikitext of a page."""
    data = _api({
        "action": "query",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": title,
    })
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        revs = page.get("revisions")
        if revs:
            return revs[0]["slots"]["main"]["*"]
    return None


def parse_feed_template(source):
    """
    Pull the {{PodcastFeed}} parameters out of a page.

    @param source: Raw wikitext.
    @return: dict of parameter name to value, empty if the template is absent.
    """
    match = FEED_TEMPLATE.search(source)
    if not match:
        return {}
    fields = {}
    for part in match.group(1).split("|"):
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        fields[key.strip().lower()] = value.strip()
    return fields


def parse_patterns(source, on_error=None):
    """
    Pull guest-name patterns out of a page's <pre class="guest-patterns"> block.

    Line format, chosen so a picker who is not a programmer can still read it:

        # comments start with a hash
        ^Show \\d+ - (?P<guest>.+)$
        skip: ^Show \\d+ (?:Update|Recap)$

    A pattern that does not compile is dropped and reported, never raised. One
    bad line should cost that line, not the whole run — and certainly not the
    twelve other podcasts in the feed.

    @param source: Raw wikitext.
    @param on_error: Called with (line, message) for each rejected pattern.
    @return: List of dicts shaped like the entries in podcast-guest-patterns.json.
    """
    match = PATTERN_BLOCK.search(source)
    if not match:
        return []

    entries = []
    for line in match.group(1).split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        skip = False
        if line.lower().startswith("skip:"):
            skip = True
            line = line[len("skip:"):].strip()
            if not line:
                continue

        try:
            re.compile(line)
        except re.error as e:
            if on_error:
                on_error(line, str(e))
            continue

        entry = {"pattern": line}
        if skip:
            entry["skip"] = True
        entries.append(entry)

    return entries


def load_from_wiki(on_error=None):
    """
    Read every podcast page in the category.

    @param on_error: Called with (context, message) for anything skipped.
    @return: (feeds, patterns) in the same shape the JSON files use.
    @raises Exception: If the wiki cannot be reached at all. Callers that need
        to keep running should use load(), which falls back.
    """
    feeds = []
    patterns = {}

    for title in _category_members():
        source = _page_source(title)
        if source is None:
            if on_error:
                on_error(title, "page has no content")
            continue

        fields = parse_feed_template(source)
        url = fields.get("rss")
        if not url:
            if on_error:
                on_error(title, "no {{Podcast}} rss= on the page")
            continue

        # The page title is the podcast's name. The template's name= parameter
        # exists for display and may differ; the title is what the pattern
        # block is keyed on, so the title is what the tools use.
        feed = {"name": title, "url": url}
        for optional in ("host", "website", "frequency"):
            if fields.get(optional):
                feed[optional] = fields[optional]
        feeds.append(feed)

        found = parse_patterns(
            source,
            on_error=(lambda line, msg, t=title: on_error(t, f"bad pattern {line!r}: {msg}"))
            if on_error else None,
        )
        if found:
            patterns[title] = found

    return feeds, patterns


def load_from_repo():
    """(feeds, patterns) from the JSON files checked in beside this module."""
    feeds = json.loads(FEEDS_JSON.read_text())
    patterns = json.loads(PATTERNS_JSON.read_text())["patterns"]
    return feeds, patterns


def load(prefer_wiki=True, log=None):
    """
    Configuration for the podcast tools.

    @param prefer_wiki: Read the wiki first. Set false to force the repo copy,
        which is what the tests do and what you want when debugging a pattern
        without publishing it.
    @param log: Called with a string for anything noteworthy. Defaults to
        stderr, because silence about a dropped podcast is worse than noise.
    @return: (feeds, patterns)
    """
    if log is None:
        def log(message):
            print(f"[config] {message}", file=sys.stderr)

    repo_feeds, repo_patterns = load_from_repo()

    if not prefer_wiki:
        return repo_feeds, repo_patterns

    try:
        wiki_feeds, wiki_patterns = load_from_wiki(
            on_error=lambda context, message: log(f"{context}: {message}")
        )
    except Exception as e:
        log(f"wiki unreachable ({e}); using the checked-in config alone")
        return repo_feeds, repo_patterns

    # The wiki wins where it speaks, and the repo covers what has not been
    # migrated yet. Replacing outright would be cleaner semantically and much
    # worse in practice: with three of thirteen podcasts on the wiki and none of
    # them carrying patterns, a straight switch drops guest extraction from
    # seven hundred episodes to zero, silently, at whatever hour the cron runs.
    #
    # Merging makes the migration incremental — move one podcast, watch it work,
    # move the next. Once every show has a page the repo entries go inert and
    # the JSON is nothing but the offline fallback it claims to be.
    wiki_names = {feed["name"] for feed in wiki_feeds}
    inherited = [feed for feed in repo_feeds if feed["name"] not in wiki_names]

    feeds = wiki_feeds + inherited
    patterns = {**repo_patterns, **wiki_patterns}

    log(f"{len(wiki_feeds)} podcasts from the wiki, "
        f"{len(inherited)} still only in the checked-in config")
    if inherited:
        log("not yet migrated: " + ", ".join(sorted(f["name"] for f in inherited)))

    return feeds, patterns


if __name__ == "__main__":
    feeds, patterns = load(prefer_wiki="--repo" not in sys.argv)
    print(f"{len(feeds)} feeds, {sum(len(v) for v in patterns.values())} patterns")
    for feed in feeds:
        count = len(patterns.get(feed["name"], []))
        print(f"  {feed['name']:46} {count:2} patterns  {feed['url']}")
