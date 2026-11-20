#!/usr/bin/env python3
"""
Connectome walker: whoever is in Category:Walk Requested, looked up on Discogs, MusicBrainz and archive.org.

    python3 tools/connectome_walk.py --cache DIR [--wiki https://pickipedia.xyz/] [--budget SECONDS]
    python3 tools/connectome_walk.py --cache DIR --request "Maddie Dalton"    (a walk by hand, category or not)

Justin, #connectome, 18 Nov 2026, 06:20Z: "I don't want [[Category:Walk Requested]] to trigger a wake; I want it to
trigger Artificial Dumb only." So a walk is plain lookups, the same for whoever runs them, and nothing inferred:

  who          the pages in Category:Walk_Requested, and when each was put there (categorymembers' timestamp). A page
               is walked when it was put there after its last walk. The category is a queue: when a page's walk is
               done the walk takes it out of Walk Requested and puts it in Category:Walked, and putting Walk
               Requested back on the page walks it again (see "The queue" below).
  names        the page's title, its {{MusicianInfo}} name=, and the titles of the redirects to it; only names of two
               words or more, since one word ("Bronwyn") is too loose to look anybody up by.
  links        Discogs releases and artists, MusicBrainz releases and artists, and archive.org items linked from the
               page or its talk page, taken as they are. That is how a person says which "Frank Evans" is meant.
               A link that is only inside a {{Which picker}} box is the question, not the answer, and isn't taken.
  Discogs      for each name, the one artist Discogs has by that name (ignoring case and its "(2)"), unless the links
               name an artist: their releases as Main, Appearance or TrackAppearance, one per title, newest first.
  MusicBrainz  the same: the one artist of that name, unless linked; the releases they have a performance
               relationship to or are credited on (rambler.mb_records_of), one per title, newest first.
  archive.org  items whose metadata names them (the name, quoted): Live Music Archive tapes (etree), and audio in the
               Tapers Section, where these pickers' tapes mostly are (18 Nov 2026: Tristan Scroggins 7 there, 0 in
               etree; Maddie Dalton 2 and 0).

Two or more artists of one name on a site, and none linked: nothing from that site, and the walk says so. At most CAP
of each kind, and nothing the store's sources already have. Who played on what is for the readers to say
(connectome_store.py), as for any other source.

Then the walk asks which one (Justin, #connectome, 20 Nov 2026, 03:29Z: "a template, 'Which <picker_name> is this?'
that can appear on a page in a warning-ish style, and ask an editor to sort it out", and 03:31Z, that the Artificial
Dumb do it during a walk; re's spec, 03:32Z). For each such site it lists the artists of that name with what the site
says of each, how many releases and from when, and the first few titles: in walked.json ("asks"), and on the page, in
a {{Which picker|status=proposed}} box put at the top. This is the one place a walk edits the wiki, and all it ever
writes there. A page that has a box already, by hand or from a walk, gets no second one. With no login for the wiki
in the build (CONNECTOME_WALK_BOT_USER and CONNECTOME_WALK_BOT_PASSWORD, a bot password; never printed), nothing is
written to the page: the question waits in walked.json ("box": wanted), and a later run with a login writes it. A
save the wiki refuses waits too, and is tried again after an hour. A question still waiting is dropped only when
its page is in neither category: someone took it out of both.

The queue (Justin, #connectome, 20 Nov 2026, 04:29Z: "the category seems to stay even after the walk", and 04:41Z:
"what's the disadvantage of removing the category once the walk is complete?"; settled with magent, 05:11Z). With
the same login, a walk that is done rewrites one thing in the page's own text: [[Category:Walk Requested]] becomes
[[Category:Walked]], where it stood. So Walk Requested holds only pages waiting for a walk, Walked those that have
had one, and "walk again" is putting Walk Requested back. Every page still in Walk Requested from a walk already
done is moved too, a few a run. A page that is in the category by a template, not in its own text, is left as it
is, and so is one whose request shares its line with other words (the wiki's gate lets a bot change no such
line); walked.json says which. With no login nothing moves, and a page is still walked once for each time it was put
in the category, as before.

What a walk finds goes into the cache, never into git, each line saying which request added it:
  walked.json          page -> {"requested", "by", "walked", "names", "sources", "notes", "asks", "box", "category"}
  walked_sources.txt   the sources, in connectome_sources.txt's shape, under a comment naming the page and the times
  walked_names.txt     the names, for the LMA reader
"""
import argparse
import datetime
import http.cookiejar
import json
import os
import re
import sys
import time
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

import recording_credits as sideman
import rambler

HERE = os.path.dirname(os.path.abspath(__file__))
CATEGORY = "Category:Walk_Requested"
WALKED = "Category:Walked"
_CAT = r"\[\[\s*Category\s*:\s*{}\s*(\|[^\]\n]*)?\]\]"
REQUESTED_LINK = re.compile(_CAT.format(r"Walk[ _]+Requested"), re.I)
WALKED_LINK = re.compile(_CAT.format("Walked"), re.I)
NOT_WIKITEXT = re.compile(r"<nowiki\b.*?</nowiki\s*>|<!--.*?-->|<pre\b.*?</pre\s*>", re.I | re.S)
CAP = {"discogs": 20, "mb": 10, "lma": 20}
LINKS_CAP = 50                    # sources a page and its talk page can name, taken as they are
CANDIDATES_CAP = 6                # artists of one name a walk lists for a site
ABOUT_BUDGET = 25                 # seconds a walk spends asking the sites about them: each is a paced request or two,
                                  # and the build stops a walk at 90. Past it the rest are listed by name and link alone.
TITLES_SHOWN = 3
SITES = {"Discogs": ("discogs", "https://www.discogs.com/artist/", re.compile(r"\d+$")),
         "MusicBrainz": ("mb", "https://musicbrainz.org/artist/", re.compile(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$"))}
WHICH_BOX = re.compile(r"\{\{\s*Which[ _]picker\b", re.I)
BOT_USER, BOT_PASSWORD = "CONNECTOME_WALK_BOT_USER", "CONNECTOME_WALK_BOT_PASSWORD"
RETRY_AFTER = 3600                # seconds before a save the wiki refused is tried again: the build runs every five minutes
SETTLED = 2                       # seconds old a revision must be before the walk saves a page's text against it (wiki_editor)
DISCOGS_ROLES = {"Main", "Appearance", "TrackAppearance"}
IA_QUERY = '"{name}" AND (mediatype:etree OR (mediatype:audio AND collection:taperssection))'
IA_SEARCH = "https://archive.org/advancedsearch.php"
USER_AGENT = "pickipedia-connectome-walk/0.1 (https://pickipedia.xyz; Artificial Dumb)"
IA_INTERVAL = 1.0
_last_ia = [0.0]


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _json(url, timeout=30):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=timeout) as r:
        return json.load(r)


def wiki_getter(wiki):
    """A function asking the wiki's API: by GET, or by POST for what is too long for an address."""
    api = wiki.rstrip("/") + "/api.php"

    def get(params, post=False):
        q = urlencode(dict(params, format="json", formatversion="2"))
        if not post:
            return _json(api + "?" + q)
        with urlopen(Request(api, data=q.encode(), headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=30) as r:
            return json.load(r)
    return get


def wiki_editor(wiki, user, password, opener=None, sleep=time.sleep):
    """A function putting text at the top of a page that exists, as a bot password's login: prepend(title, text,
    summary) -> the new revision's id; and, as its .swap, one moving a page from Walk Requested to Walked. Logs in
    at the first call. Raises with the wiki's own word for what went wrong, never with the password. Standard
    library only, as the build's image is bare."""
    api = wiki.rstrip("/") + "/api.php"
    opener = opener or build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    state = {"in": False}

    def call(params, post=False):
        q = urlencode(dict(params, format="json", formatversion="2"))
        req = Request(api, data=q.encode(), headers={"User-Agent": USER_AGENT}) if post else Request(api + "?" + q, headers={"User-Agent": USER_AGENT})
        with opener.open(req, timeout=30) as r:
            data = json.load(r)
        if "error" in data:
            raise RuntimeError("the wiki said " + str(data["error"].get("code", "error")))
        return data

    def login():
        if not state["in"]:
            token = call({"action": "query", "meta": "tokens", "type": "login"})["query"]["tokens"]["logintoken"]
            result = call({"action": "login", "lgname": user, "lgpassword": password, "lgtoken": token}, post=True)["login"]["result"]
            if result != "Success":
                raise RuntimeError("the wiki would not log the walk in (" + str(result) + ")")
            state["in"] = True

    def prepend(title, text, summary):
        login()
        token = call({"action": "query", "meta": "tokens", "type": "csrf"})["query"]["tokens"]["csrftoken"]
        done = call({"action": "edit", "title": title, "prependtext": text, "summary": summary, "nocreate": "1", "bot": "1",
                     "assert": "user", "token": token}, post=True).get("edit", {})
        if done.get("result") != "Success":
            raise RuntimeError("the wiki did not save it (" + str(done.get("result") or done.get("code") or "no result") + ")")
        return done.get("newrevid")

    def swap(title, summary):
        """Move a page from Walk Requested to Walked in its own text (swap_category): the new revision's id, or
        the reason it can't be done, as a string, with nothing saved. Saved against the revision it was read at,
        so an edit made meanwhile is not overwritten: the wiki refuses, and a later run reads the page afresh."""
        login()
        # MediaWiki tells one revision from the next by the second. Read a page whose newest revision was saved this
        # very second, and an edit a person makes in that same second after the read is not seen as a conflict: the
        # save below would lie on top of it (seen on a real 1.43.6, 20 Nov 2026: a sort key added to the request, gone).
        # So the page is saved only against a revision at least SETTLED seconds old: any edit after the read then
        # bears a later second, and the wiki merges it or refuses. The walk's own box, just written, is such a
        # young revision: wait it out and read again.
        for again in (True, False):
            data = call({"action": "query", "titles": title, "prop": "revisions", "rvprop": "content|ids|timestamp",
                         "rvslots": "main", "curtimestamp": "1"})
            page = (data.get("query", {}).get("pages") or [{}])[0]
            rev = (page.get("revisions") or [None])[0]
            if not rev:
                raise RuntimeError("the wiki has no such page")
            age = since(rev["timestamp"], data["curtimestamp"])
            if age >= SETTLED:
                break
            if not again:
                raise RuntimeError("the page was edited a moment ago, and again; the move waits")
            sleep(SETTLED - age + 0.5)
        text, why = swap_category(rev["slots"]["main"]["content"])
        if text is None:
            return why
        token = call({"action": "query", "meta": "tokens", "type": "csrf"})["query"]["tokens"]["csrftoken"]
        done = call({"action": "edit", "title": title, "text": text, "summary": summary, "nocreate": "1", "bot": "1",
                     "assert": "user", "baserevid": rev["revid"], "basetimestamp": rev["timestamp"],
                     "starttimestamp": data["curtimestamp"], "token": token}, post=True).get("edit", {})
        if done.get("result") != "Success":
            raise RuntimeError("the wiki did not save it (" + str(done.get("result") or done.get("code") or "no result") + ")")
        return done.get("newrevid", rev["revid"])
    prepend.swap = swap
    return prepend


def ia_search(query, rows):
    """archive.org's advanced search: the identifiers of items matching query, newest first."""
    wait = _last_ia[0] + IA_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    try:
        params = [("q", query), ("fl[]", "identifier"), ("sort[]", "date desc"), ("rows", rows), ("output", "json")]
        return [d["identifier"] for d in _json(IA_SEARCH + "?" + urlencode(params))["response"]["docs"]]
    finally:
        _last_ia[0] = time.monotonic()


# ---------------------------------------------------------------------------
# Who asked, and who is due
# ---------------------------------------------------------------------------

def requests(wiki_get):
    """[(page title, when it was put in the category)], from the wiki, pickers' pages only (the main namespace)."""
    out, cont = [], {}
    while True:
        data = wiki_get(dict({"action": "query", "list": "categorymembers", "cmtitle": CATEGORY,
                              "cmprop": "title|timestamp", "cmnamespace": "0", "cmlimit": "500"}, **cont))
        out += [(m["title"], m["timestamp"]) for m in data.get("query", {}).get("categorymembers", [])]
        if "continue" not in data:
            return out
        cont = data["continue"]


def due(asked, walked):
    """The requests made since each page's last walk, the oldest first. walked: walked.json's contents."""
    return sorted(((t, ts) for t, ts in asked if ts > (walked.get(t) or {}).get("requested", "")),
                  key=lambda r: (r[1], r[0]))


# ---------------------------------------------------------------------------
# What a page says: its names, and what it links
# ---------------------------------------------------------------------------

LINKS = (
    (re.compile(r"discogs\.com/(?:[a-z]{2}/)?release/(\d+)"), "discogs"),
    (re.compile(r"discogs\.com/(?:[a-z]{2}/)?artist/(\d+)"), "discogs-artist"),
    (re.compile(r"musicbrainz\.org/release/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"), "mb"),
    (re.compile(r"musicbrainz\.org/artist/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"), "mb-artist"),
    (re.compile(r"archive\.org/details/([A-Za-z0-9._-]+)"), "lma"),
)
MUSICIAN_NAME = re.compile(r"\{\{\s*MusicianInfo\b[^{}]*?\|\s*name\s*=\s*([^|}\n]+)", re.I)


def linked(urls):
    """{kind: [id, ...]} for the sources and artists a list of URLs names, in their order, each once."""
    out = {}
    for url in urls:
        for pat, kind in LINKS:
            m = pat.search(url)
            if m and m.group(1) not in out.setdefault(kind, []):
                out[kind].append(m.group(1))
    return out


NOT_IN_TEXT = "the category is not in the page's own text"
SHARES_A_LINE = "the request shares its line with other words, and the wiki lets a bot change no such line"


def swap_category(text):
    """A page's wikitext with [[Category:Walk Requested]] turned into [[Category:Walked]] where it stood, its sort
    key kept: (the new text, None), or (None, why not). A link in a comment, <nowiki> or <pre> is not one. Already in Walked: the
    request just goes, and a line it leaves empty with it. Nothing else in the text is touched.

    Why not: the text has no such link of its own (the page is in the category by a template); or the link shares
    its line with words, and PickiPediaVerification's gate takes any changed line that doesn't begin with a
    category for a new claim and refuses a bot's edit that makes one (seen on a real wiki, 20 Nov 2026). A line of
    nothing but categories, as they are nearly always written, is changed freely."""
    skip = [m.span() for m in NOT_WIKITEXT.finditer(text)]
    real = lambda m: not any(a <= m.start() < b for a, b in skip)
    found = [m for m in REQUESTED_LINK.finditer(text) if real(m)]
    if not found:
        return None, NOT_IN_TEXT
    has = any(real(m) for m in WALKED_LINK.finditer(text))
    out, at = [], 0
    for n, m in enumerate(found):
        out.append(text[at:m.start()])
        at = m.end()
        if n == 0 and not has:
            out.append("[[Category:Walked" + (m.group(1) or "") + "]]")   # its sort key goes with it (re's review, 20 Nov 2026)
            continue
        # the link goes, and its line with it where nothing else is on it
        before = "".join(out)
        start = before.rfind("\n") + 1
        end = text.find("\n", at)
        if not before[start:].strip() and not text[at:len(text) if end < 0 else end].strip():
            out = [before[:start]]
            at = len(text) if end < 0 else end + 1
    new = "".join(out) + text[at:]
    was = {line.strip() for line in text.split("\n")}
    if any(line.strip() and line.strip() not in was and not line.strip().startswith("[[Category:") for line in new.split("\n")):
        return None, SHARES_A_LINE
    return new, None


def without_boxes(text):
    """A page's wikitext with every {{Which picker}} call taken out, braces matched; and whether there was one."""
    out, at, found = [], 0, False
    while True:
        m = WHICH_BOX.search(text, at)
        if not m:
            return "".join(out) + text[at:], found
        found = True
        out.append(text[at:m.start()])
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith("{{", i):
                depth, i = depth + 1, i + 2
            elif text.startswith("}}", i):
                depth, i = depth - 1, i + 2
                if depth == 0:
                    break
            else:
                i += 1
        at = i


def page_facts(wiki_get, title):
    """The names to look the page's picker up by, what the page and its talk page link, whether the page asks
    which picker it is already, and which of the walk's two categories it is in (a set of their names). The artists a {{Which picker}} box lists are links on the page too, and they are the
    question: with a box on it, the page's links are those it has without the box (the wiki parses it so)."""
    data = wiki_get({"action": "query", "titles": f"{title}|Talk:{title}", "prop": "redirects|extlinks|revisions|categories",
                     "rvprop": "content", "rvslots": "main", "rdlimit": "max", "ellimit": "max",
                     "clcategories": f"{CATEGORY}|{WALKED}", "cllimit": "max"})
    names, urls, boxed, cats = [title], [], False, set()
    for p in data.get("query", {}).get("pages", []):
        if p.get("title") != title:
            urls += [e.get("url", "") for e in p.get("extlinks", [])]
            continue
        cats = {c["title"].replace(" ", "_") for c in p.get("categories", [])}
        names += [r["title"] for r in p.get("redirects", [])]
        text = ((p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", ""))
        rest, boxed = without_boxes(text)
        if boxed:
            parsed = wiki_get({"action": "parse", "title": title, "text": rest, "prop": "externallinks",
                               "contentmodel": "wikitext", "disablelimitreport": "1"}, post=True)
            urls += parsed.get("parse", {}).get("externallinks", [])
        else:
            urls += [e.get("url", "") for e in p.get("extlinks", [])]
        m = MUSICIAN_NAME.search(text)
        if m:
            names.append(m.group(1).strip())
    seen, kept = set(), []
    for n in names:
        n = " ".join(n.replace("_", " ").split())
        if len(n.split()) >= 2 and n.casefold() not in seen:
            seen.add(n.casefold())
            kept.append(n)
    return kept, linked(urls), boxed, cats


# ---------------------------------------------------------------------------
# The lookups
# ---------------------------------------------------------------------------

def discogs_releases(artist_id, get):
    """An artist's Discogs releases as Main, Appearance or TrackAppearance, a master as its main release; one per
    title, newest first."""
    data = get(f"artists/{artist_id}/releases?per_page=100&sort=year&sort_order=desc")
    out, titles = [], set()
    for r in sorted(data.get("releases", []), key=lambda r: -(r.get("year") or 0)):
        if r.get("role") not in DISCOGS_ROLES:
            continue
        rid = r.get("main_release") if r.get("type") == "master" else r.get("id")
        key = sideman.normalize_title(r.get("title", ""))
        if rid and key not in titles:
            titles.add(key)
            out.append(f"discogs {rid}")
    return out


def mb_releases(mbid, records_of):
    """An artist's MusicBrainz releases (rambler.mb_records_of: performance relationships and their own; one per
    title), newest first."""
    found = records_of(mbid).values()
    return [f"mb {rid}" for date, rid, title in sorted(found, key=lambda x: x[0] if x[0] != "9999" else "", reverse=True)]


def discogs_about(artist_id, get):
    """What Discogs lists for an artist: how many releases, from when to when, and the newest few titles."""
    data = get(f"artists/{artist_id}/releases?per_page=100&sort=year&sort_order=desc")
    rel = data.get("releases", [])
    years = sorted(r["year"] for r in rel if r.get("year"))
    return {"releases": data.get("pagination", {}).get("items", len(rel)), "years": [years[0], years[-1]] if years else [],
            "titles": list(dict.fromkeys(r.get("title", "") for r in rel if r.get("title")))[:TITLES_SHOWN]}


def mb_about(mbid, get):
    """What MusicBrainz lists under an artist's own name: how many releases, from when to when, a few titles; and
    what it says to tell them from others of the name (its disambiguation, where they are from)."""
    artist = get(f"artist/{mbid}")
    data = get("release", artist=mbid, limit=25)
    rel = data.get("releases", [])
    years = sorted(int(r["date"][:4]) for r in rel if re.match(r"\d{4}", r.get("date") or ""))
    says = ", ".join(x for x in (artist.get("disambiguation"), artist.get("country")) if x)
    return {"releases": data.get("release-count", len(rel)), "years": [years[0], years[-1]] if years else [], "says": says,
            "titles": list(dict.fromkeys(r.get("title", "") for r in rel if r.get("title")))[:TITLES_SHOWN]}


def candidates(site, name, found, about):
    """The question a site's several artists of one name make: {"site", "name", "found", "candidates"}, each
    candidate {"url", "name"} with what `about` says of them (walk_one's: once an artist, within the walk's
    budget, a failure kept as a note); the first CANDIDATES_CAP of them."""
    key, base, shape = SITES[site]
    out = []
    for artist_id, artist_name in found:
        if not shape.match(str(artist_id)):
            continue                                         # an id that isn't one makes no link
        if len(out) >= CANDIDATES_CAP:
            break
        c = {"url": base + str(artist_id), "name": artist_name}
        if about:
            c.update(about(str(artist_id)))
        out.append(c)
    return {"site": site, "name": name, "found": len(found), "candidates": out}


def lookup_artists(site, names, linked_ids, named, notes, asks=None, about=None):
    """The artists to walk on one site: the linked ones, or else, for each name, the one artist of that name. Where
    a name has several and nothing is linked, the question goes into asks (candidates())."""
    if linked_ids:
        return list(linked_ids)
    out = []
    for name in names:
        try:
            found = named(name)
        except Exception as e:                               # a site down today: the next request walks it
            notes.append(f"{site}: {name}: {e}")
            continue
        if len(found) == 1:
            out.append(found[0][0])
        elif found:
            notes.append(f"{site}: {len(found)} artists named {name}; a link to one on the page or its talk page says which")
            if asks is not None and site in SITES:
                asks.append(candidates(site, name, found, about))
        else:
            notes.append(f"{site}: no artist named {name}")
    return list(dict.fromkeys(out))


def walk_one(title, names, links, known, look, asks=None, clock=time.monotonic):
    """One walk: the sources to add, newest first, at most CAP of each kind past those known, and what was noted.

    look: {"discogs_named", "discogs_releases", "mb_named", "mb_releases", "ia_search"}, the lookups (tests swap them),
    and, where given, "discogs_about" and "mb_about". asks: a list the walk's questions are added to (candidates()).
    An artist is asked about once a walk, however many of the page's names find them (re's review, 20 Nov 2026: a
    page with two redirects asked three times over), and none is asked about once ABOUT_BUDGET seconds have gone
    on it: those are listed without their details.
    """
    notes, adding = [], []
    have = set(known)
    told, spent = {}, [0.0]

    def once(key):
        about = look.get(key + "_about")
        if not about:
            return None

        def ask(artist_id):
            if (key, artist_id) not in told:
                if spent[0] >= ABOUT_BUDGET:
                    return {}                                # out of time: named and linked, nothing more
                start = clock()
                try:
                    told[(key, artist_id)] = about(artist_id)
                except Exception as e:                       # the list still asks; this one says less
                    told[(key, artist_id)] = {"note": str(e)[:80]}
                finally:
                    spent[0] += clock() - start
            return dict(told[(key, artist_id)])
        return ask

    def add(lines, cap=None):
        n = 0
        for line in lines:
            if line in have:
                continue
            if cap is not None and n >= cap:
                break
            have.add(line)
            adding.append(line)
            n += 1
        return n

    add([f"discogs {i}" for i in links.get("discogs", [])] + [f"mb {i}" for i in links.get("mb", [])] +
        [f"lma {i}" for i in links.get("lma", [])], LINKS_CAP)
    for site, key, named, releases in (("Discogs", "discogs", look["discogs_named"], look["discogs_releases"]),
                                       ("MusicBrainz", "mb", look["mb_named"], look["mb_releases"])):
        lines = []
        for artist in lookup_artists(site, names, links.get(key + "-artist", []), named, notes, asks, once(key)):
            try:
                lines += releases(artist)
            except Exception as e:                           # a site down today: the next request walks it
                notes.append(f"{site}: artist {artist}: {e}")
        n = add(lines, CAP[key])
        if lines:
            notes.append(f"{site}: {n} added of {len(lines)} found")
    lines = []
    for name in names:
        try:
            lines += [f"lma {i}" for i in look["ia_search"](IA_QUERY.format(name=name.replace('"', "")), 100)]
        except Exception as e:
            notes.append(f"archive.org: {name}: {e}")
    n = add(lines, CAP["lma"])
    notes.append(f"archive.org: {n} added of {len(lines)} found")
    return adding, notes


LOOKUPS = {
    "discogs_named": rambler.discogs_artists_named,
    "discogs_releases": lambda a: discogs_releases(a, sideman.discogs_get),
    "mb_named": rambler.mb_artists_named,
    "mb_releases": lambda a: mb_releases(a, rambler.mb_records_of),
    "ia_search": ia_search,
    "discogs_about": lambda a: discogs_about(a, sideman.discogs_get),
    "mb_about": lambda a: mb_about(a, sideman.mb_get),
}


# ---------------------------------------------------------------------------
# The question, as a box on the page
# ---------------------------------------------------------------------------

_PLAIN = (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ("[", "&#91;"), ("]", "&#93;"), ("{", "&#123;"), ("}", "&#125;"),
          ("|", "&#124;"), ("'", "&#39;"), ("~", "&#126;"), ("=", "&#61;"), ("://", ":&#47;/"), ("__", "&#95;_"))


def plain(text):
    """A site's words as wikitext that says them and does nothing else: no link, template, tag, bold or signature."""
    text = " ".join(str(text).split())
    for a, b in _PLAIN:
        text = text.replace(a, b)
    return text


def candidate_line(c):
    """One artist of the name, as a line of the box: the link, what the site says to tell them apart, how many
    releases and from when, and a few titles; only what the site gave."""
    line = f"* [{c['url']} {plain(c['name'])}]" + (f" ({plain(c['says'])})" if c.get("says") else "")
    parts = []
    if c.get("releases") is not None:
        years = c.get("years") or []
        when = "" if not years else (f", {years[0]}" if years[0] == years[-1] else f", {years[0]} to {years[-1]}")
        parts.append(f"{c['releases']} release" + ("" if c["releases"] == 1 else "s") + when)
    if c.get("titles"):
        parts.append(", ".join('"' + plain(t) + '"' for t in c["titles"]))
    return line + (": " + ": ".join(parts) if parts else "")


def which_boxes(asks):
    """The {{Which picker}} boxes a walk's questions make, one a site, each marked as a bot's and not yet checked
    (status=proposed, which the wiki's gate asks of a bot and Template:Which picker says on the box)."""
    out = []
    for site in SITES:
        mine = [a for a in asks if a["site"] == site and a["candidates"]]
        if not mine:
            continue
        lines, seen = [], set()
        for a in mine:
            for c in a["candidates"]:
                if c["url"] in seen:
                    continue
                seen.add(c["url"])
                lines.append(candidate_line(c))
            if a["found"] > len(a["candidates"]):
                lines.append(f"* and {a['found'] - len(a['candidates'])} more named {plain(a['name'])} that this walk did not look at")
        out.append("{{Which picker\n|status=proposed\n|site=" + site + "\n|1=\n" + "\n".join(lines) + "\n}}\n")
    return "".join(out)


def settle_box(title, w, boxed, links, prepend, stamp):
    """What becomes of a walk's question: w["box"] is set to what was done. Nothing is written where the page has a
    box already, where the page or its talk page now links an artist on each site that was asked about, or where
    there is no login; a failure to save is kept as wanted, for the next run."""
    asks = [a for a in w.get("asks", []) if a["candidates"]]
    if not asks:
        return
    if boxed:
        w["box"] = {"state": "the page has one", "at": stamp()}
        return
    asks = [a for a in asks if not links.get(SITES[a["site"]][0] + "-artist")]
    if not asks:
        w["box"] = {"state": "answered: the page links one", "at": stamp()}
        return
    if prepend is None:
        w["box"] = {"state": "wanted", "note": "no login for the wiki in this build; the candidates are in asks"}
        return
    sites = " and ".join(dict.fromkeys(a["site"] for a in asks))
    try:
        rev = prepend(title, which_boxes(asks), f"Connectome walk (Artificial Dumb): more than one artist of this name on {sites}; which is this?")
        w["box"] = {"state": "written", "at": stamp(), "rev": rev}
    except Exception as e:
        w["box"] = {"state": "wanted", "note": str(e)[:120], "tried": stamp()}


# ---------------------------------------------------------------------------
# The cache's files
# ---------------------------------------------------------------------------

def known_sources(paths):
    """Every source line in the files given (connectome_sources.txt's shape), comments and blanks left out."""
    out = set()
    for path in paths:
        if os.path.exists(path):
            out |= {l.strip() for l in open(path) if l.strip() and not l.lstrip().startswith("#")}
    return out


def _write(path, text):
    with open(path + ".part", "w") as f:
        f.write(text)
    os.replace(path + ".part", path)


def write_files(cache, walked):
    """walked.json, and walked_sources.txt and walked_names.txt made from it, the oldest walk first."""
    _write(os.path.join(cache, "walked.json"), json.dumps(walked, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    order = sorted(walked, key=lambda t: (walked[t]["walked"], t))
    src = ["# Sources the connectome build's walker added for Category:Walk Requested (tools/connectome_walk.py).",
           "# Not in git; each one under the page whose request added it. connectome_sources.txt's shape."]
    names, seen = [], set()
    for t in order:
        w = walked[t]
        src.append(f"# {t}: " + (f"put in the category {w['requested']}" if w.get("by", "category") == "category"
                                  else "asked for by hand") + f", walked {w['walked']}")
        src += w["sources"]
        for n in w["names"]:
            if n.casefold() not in seen:
                seen.add(n.casefold())
                names.append(n)
    _write(os.path.join(cache, "walked_sources.txt"), "\n".join(src) + "\n")
    _write(os.path.join(cache, "walked_names.txt"), "".join(n + "\n" for n in names))


def run(cache, asked, facts, known_paths, budget=None, look=LOOKUPS, clock=time.monotonic, stamp=now_iso, by="category",
        prepend=None, swap=None):
    """Walk the requests due, the oldest first, starting no new walk once budget seconds have gone; a walk started
    is finished. asked: [(page, when it was asked for)], from the category (by="category") or by hand ("hand", asked
    now). A page the wiki doesn't answer for waits for the next run. Writes the cache's files. Returns (walks,
    waiting, report lines).

    facts(title) -> (names, links), or with whether the page has a {{Which picker}} box, or with that and the set
    of the walk's categories the page is in. prepend: the wiki's editor (wiki_editor), or None with no login: then
    a walk's question waits in walked.json, and a later run that has a login writes it, while there is budget
    left. swap: the editor's .swap, moving a walked page from Walk Requested to Walked; None, and nothing moves."""
    path = os.path.join(cache, "walked.json")
    walked = json.load(open(path)) if os.path.exists(path) else {}
    todo = due(asked, walked)
    start, done, report = clock(), 0, []
    for title, requested in todo:
        if budget is not None and clock() - start >= budget:
            break
        try:
            names, links, boxed, cats = four(facts(title))
        except Exception as e:
            report.append(f"{title}: not walked, the wiki didn't answer ({e}); next run")
            continue
        known = known_sources(known_paths) | {s for t, w in walked.items() if t != title for s in w["sources"]}
        asks = []
        sources, notes = walk_one(title, names, links, known, look, asks, clock)
        walked[title] = {"requested": requested, "by": by, "walked": stamp(), "names": names, "sources": sources,
                         "notes": notes}
        if asks:
            walked[title]["asks"] = asks
            settle_box(title, walked[title], boxed, links, prepend, stamp)
        write_files(cache, walked)                           # the walk is kept before the page is moved: a move that fails loses nothing
        if by == "category":                                 # the box first, then out of the queue: the page reads top to bottom as it happened
            settle_category(title, walked[title], swap, stamp)
            write_files(cache, walked)
        done += 1
        report.append(f"{title}: {len(sources)} sources ({'; '.join(notes)})" + box_says(walked[title]) + category_says(walked[title]))
    # Questions an earlier run could not put on their pages (no login then, or the wiki said no): now, one by one.
    # A page someone has taken out of both categories since is not asked which (re's review; the walk itself moves
    # a page from one to the other, and that drops nothing).
    for title in sorted(t for t, w in walked.items() if (w.get("box") or {}).get("state") == "wanted"):
        if by != "category":
            break                                            # a walk by hand settles only what it walked
        if prepend is None or (budget is not None and clock() - start >= budget):
            break
        tried = walked[title]["box"].get("tried")
        if tried and since(tried, stamp()) < RETRY_AFTER:
            continue                                         # the wiki said no not long ago (or in this very run)
        try:
            names, links, boxed, cats = four(facts(title))
        except Exception as e:
            report.append(f"{title}: its question waits, the wiki didn't answer ({e})")
            continue
        if cats is not None and not cats:
            walked[title]["box"] = {"state": "dropped: the page is in neither category", "at": stamp()}
        else:
            settle_box(title, walked[title], boxed, links, prepend, stamp)
        write_files(cache, walked)
        report.append(f"{title}: the question from its walk of {walked[title]['walked']}" + box_says(walked[title]))
    # Pages still in Walk Requested whose walk is done: walked before there was a login, or before the walk moved
    # pages at all, or the wiki refused the move. Out of the queue now, one by one.
    for title, requested in sorted(asked):
        w = walked.get(title)
        if by != "category" or swap is None or (budget is not None and clock() - start >= budget):
            break
        if not w or requested > w.get("requested", "") or (w.get("category") or {}).get("at", "") >= w["walked"]:
            continue                                         # never walked, or due a walk, or moved since this walk
        tried = (w.get("category") or {}).get("tried")
        if tried and since(tried, stamp()) < RETRY_AFTER:
            continue
        settle_category(title, w, swap, stamp)
        write_files(cache, walked)
        report.append(f"{title}: walked {w['walked']}" + category_says(w))
    if not os.path.exists(os.path.join(cache, "walked_sources.txt")):
        write_files(cache, walked)
    return done, len(todo) - done, report


def four(facts):
    """What a page says, whichever shape it came in: names, links, whether it has a box (no, if unsaid), and the
    set of the walk's categories it is in (None, if unsaid: then nothing is concluded from it)."""
    facts = tuple(facts)
    return facts[0], facts[1], facts[2] if len(facts) > 2 else False, facts[3] if len(facts) > 3 else None


def settle_category(title, w, swap, stamp):
    """Take a walked page out of Walk Requested and into Walked: w["category"] says what came of it. With no login
    nothing is tried and nothing is said. A save the wiki refuses (an edit made meanwhile, say) is wanted still,
    and tried again after RETRY_AFTER."""
    if swap is None:
        return
    try:
        rev = swap(title, "Connectome walk (Artificial Dumb): walked, so out of Walk Requested and into Walked. Put Walk Requested back to walk again.")
        w["category"] = ({"state": "left: " + rev, "tried": stamp()} if isinstance(rev, str) else
                         {"state": "moved to Walked", "at": stamp(), "rev": rev})
    except Exception as e:
        w["category"] = {"state": "wanted", "note": str(e)[:120], "tried": stamp()}


def category_says(w):
    c = w.get("category")
    return "" if not c else f"; category: {c['state']}" + (f" (revision {c['rev']})" if c.get("rev") else "") + (f" ({c['note']})" if c.get("note") else "")


def since(then, now):
    """Seconds from one of the walk's own stamps to another."""
    at = lambda t: datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ")
    return (at(now) - at(then)).total_seconds()


def box_says(w):
    box = w.get("box")
    if not box:
        return ""
    return f"; Which picker box: {box['state']}" + (f" (revision {box['rev']})" if box.get("rev") else "") + (f" ({box['note']})" if box.get("note") else "")


def main(argv):
    ap = argparse.ArgumentParser(description="Walk whoever is in Category:Walk Requested (Artificial Dumb).")
    ap.add_argument("--cache", required=True, help="the connectome cache: walked.json and the walked_* files go here")
    ap.add_argument("--wiki", default="https://pickipedia.xyz/")
    ap.add_argument("--budget", type=float, metavar="SECONDS", help="start no walk after this long; the rest wait")
    ap.add_argument("--sources", nargs="*", default=[os.path.join(HERE, "connectome_sources.txt")],
                    help="sources files the store already reads: what's in them isn't added again")
    ap.add_argument("--request", action="append", default=[], metavar="PAGE",
                    help="walk this page now, in the category or not (repeatable)")
    ap.add_argument("--no-edit", action="store_true",
                    help="write nothing to the wiki, login or not: no Which picker box, and no page moved to Walked")
    args = ap.parse_args(argv[1:])
    os.makedirs(args.cache, exist_ok=True)
    wiki_get = wiki_getter(args.wiki)
    user, password = os.environ.get(BOT_USER, ""), os.environ.get(BOT_PASSWORD, "")
    prepend = wiki_editor(args.wiki, user, password) if user and password and not args.no_edit else None
    asked = [(t, now_iso()) for t in args.request] if args.request else requests(wiki_get)
    done, waiting, report = run(args.cache, asked, lambda t: page_facts(wiki_get, t), args.sources, args.budget,
                                by="hand" if args.request else "category", prepend=prepend,
                                swap=prepend.swap if prepend else None)
    print(f"Connectome walk: {done} walked" + (f"; {waiting} waiting for the next run" if waiting else "")
          + "".join("\n  " + r for r in report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
