"""
What survives when the importer meets a page a person has edited.

An episode's date, audio, artwork and running time come off the feed and are
re-derivable; regenerating them every night is the point of the importer. The
topics are different. They are a *guess*, pulled out of an episode title by a
regular expression, and a title routinely gives a first name where a page needs
a full one — "Billy" for Billy Strings, "McCoury" for Del.

Someone who fixes that on the page is not undoing the import, they are doing
the one thing the parser cannot. So a page whose last edit came from somebody
other than the bot keeps the topics it has, and the run updates only the fields
the feed owns.

The cost is that a wrong human edit also survives, and that is the right way
round: this is a wiki, and the next person can fix it again. What must never
happen is the bot silently reverting a person night after night, with the
history showing the machine winning an argument nobody knew they were having.

The description is protected for the same reason, learned the same way. The
feed gives it as plain prose; a person reading the page turns names in it into
links — [[Carlton Haney]], [[Muleskinner News]] — which is the whole point of
an encyclopedia and something no feed will ever do. Refreshing that field
every night threw the links away every night. It is the same argument as the
topics, about a different line.

A field the feed owns outright is left alone here: date, url, audio, duration
and artwork are re-derived nightly, which is what the importer is for.

When the bad name comes from the *format* of a show's titles rather than one
odd episode, the pattern on the show's page is the better fix — it corrects
every episode at once, and the importer will apply it here because those pages
were last edited by the bot.
"""

import re

# |topic=…, |topic2=…, and the guest aliases the template still accepts.
TOPIC_PARAM = re.compile(r"^\|(?:topic|guest)\d*\s*=", re.IGNORECASE)

# A link, with or without a piped label: [[Carlton Haney]], [[A|b]].
WIKILINK = re.compile(r"\[\[(?:[^\[\]|]*\|)?([^\[\]|]*)\]\]")

# Two or more apostrophes: wikitext bold, italic, and the two together.
BOLD_OR_ITALIC = re.compile(r"'{2,}")

# A space the publisher left in front of its own punctuation.
SPACE_BEFORE_PUNCTUATION = re.compile(r"\s+([.,;:!?])")


def topic_lines(text):
    """
    The topic parameter lines of a {{PodcastEpisode}} call, as written.

    @param text: page wikitext.
    @return: list of lines, in page order.
    """
    return [line for line in (text or "").splitlines() if TOPIC_PARAM.match(line.strip())]


def renumber(lines):
    """
    Rewrite topic lines as topic=, topic2=, topic3=… whatever they came in as.

    A person editing by hand writes what looks right — a second |topic= rather
    than |topic2=, or the older |guest= — and MediaWiki quietly keeps only the
    last of two same-named parameters. Renumbering keeps every name they wrote.

    @param lines: topic parameter lines.
    @return: list of normalised lines.
    """
    out = []
    for index, line in enumerate(lines):
        value = line.split("=", 1)[1].strip()
        if not value:
            continue
        key = "topic" if len(out) == 0 else f"topic{len(out) + 1}"
        out.append(f"|{key}={value}")
    return out


def same_topics(text_a, text_b):
    """@return: True if two versions of a page name the same topics."""
    return renumber(topic_lines(text_a)) == renumber(topic_lines(text_b))


def who_set(revisions, differs):
    """
    The author of the revision that introduced what the page says now.

    The subtle part, and the reason this is shared rather than written twice:
    asking "who edited last?" gets the wrong answer. When the importer keeps a
    person's value it still writes the page — new artwork, a corrected date —
    and that write makes the bot the latest editor. The next night the bot
    reads itself as the author and regenerates the field, undoing the very
    correction it kept. That flip-flop is how Farayi Malek went back to
    "Farayi" on 2026-09-17, and it is how [[Carlton Haney]] lost his brackets
    on 2026-09-25.

    So walk back from the newest revision while the field stays the same; the
    oldest revision in that run is where it was set.

    @param revisions: newest first, as returned by Wiki.history().
    @param differs: f(older_text, newest_text) -> True when the field they
        carry is not the same.
    @return: a username, or None if there is no history or the author is
        hidden. If the field never changes within the revisions given, the
        oldest one's author is the best available answer.
    """
    if not revisions:
        return None
    newest = revisions[0].get("text")
    setter = revisions[0].get("user")
    for rev in revisions[1:]:
        if differs(rev.get("text"), newest):
            break
        setter = rev.get("user")
    return setter


def who_set_topics(revisions):
    """
    The author of the revision that put the page's current topics there.

    Not the author of the latest revision. When the importer keeps a person's
    topics it still writes the page — new artwork, a corrected date — and that
    write makes the bot the latest editor. Asking "who edited last?" the next
    night answers "the bot", and the bot then regenerates the page and undoes
    the very correction it kept the night before. That flip-flop is how Farayi
    Malek went back to "Farayi" on 2026-09-17.

    So walk back from the newest revision while the topics stay the same; the
    oldest revision in that run is where they were set.

    @param revisions: newest first, as returned by Wiki.history().
    @return: a username, or None if there is no history or the author is
        hidden. If the topics never change within the revisions given, the
        oldest one's author is the best available answer.
    """
    return who_set(revisions, lambda older, newest: not same_topics(older, newest))


def keep_human_topics(wanted, current):
    """
    The text to write when a person has edited this page since the bot did.

    Everything the feed owns comes from `wanted`; the topics come from
    `current`. A page a person stripped of topics stays stripped — that is an
    edit too, and re-adding them would be the same argument in the other
    direction.

    @param wanted: the wikitext this run generated.
    @param current: the wikitext now on the wiki.
    @return: (text, kept) — the merged text, and True if it differs from
        `wanted` because of the human's topics.
    """
    theirs = renumber(topic_lines(current))
    ours = renumber(topic_lines(wanted))
    if theirs == ours:
        return wanted, False

    lines = wanted.splitlines()
    merged = []
    placed = False
    for line in lines:
        if TOPIC_PARAM.match(line.strip()):
            # Their topics go where ours were, so the parameter order of the
            # template call stays the order the template documents.
            if not placed:
                merged.extend(theirs)
                placed = True
            continue
        merged.append(line)

    if not placed and theirs:
        # We produced no topics at all this run, so there is no slot to fill.
        # The closing braces are the only fixed landmark in the call.
        for index in range(len(merged) - 1, -1, -1):
            if merged[index].strip() == "}}":
                merged[index:index] = theirs
                placed = True
                break
        if not placed:
            merged.extend(theirs)

    text = "\n".join(merged)
    if wanted.endswith("\n") and not text.endswith("\n"):
        text += "\n"
    return text, True


def param_block(text, name):
    """
    Where a named template parameter starts and ends, and what it says.

    A parameter runs until the next line that begins one — or until the call
    closes. The importer writes the description on a single line, but a person
    wrapping it over three is writing the same parameter, and reading only the
    first line would quietly truncate them to a third of what they wrote.

    @param text: page wikitext.
    @param name: parameter name, without the leading pipe.
    @return: (start, stop, value) as line indices and the joined value, or
        None when the parameter is absent.
    """
    lines = (text or "").splitlines()
    opener = re.compile(r"^\|" + re.escape(name) + r"\s*=", re.IGNORECASE)
    for index, line in enumerate(lines):
        if not opener.match(line.strip()):
            continue
        value = [line.split("=", 1)[1]]
        stop = index + 1
        while stop < len(lines):
            following = lines[stop].strip()
            if following.startswith("|") or following.startswith("}}"):
                break
            value.append(lines[stop])
            stop += 1
        return index, stop, "\n".join(value).strip()
    return None


def description(text):
    """@return: the |description= value, or None when there is not one."""
    found = param_block(text, "description")
    return found[2] if found else None


def same_description(text_a, text_b):
    """@return: True if two versions of a page carry the same description."""
    return description(text_a) == description(text_b)


def who_set_description(revisions):
    """
    The author of the revision that put the page's current description there.

    See who_set for why this is not "who edited last".
    """
    return who_set(revisions, lambda older, newest: not same_description(older, newest))


def plain(value):
    """
    A description with its wiki markup taken off, for comparison only.

    This tells one kind of human edit from another. Somebody who links a name
    in the feed's prose leaves the prose alone; somebody whose page no longer
    matches the feed even with the links stripped is looking at a description
    the publisher has since rewritten. Both keep their text — only the second
    is worth anybody's attention, so only the second is reported.
    """
    without_links = WIKILINK.sub(r"\1", value or "")
    without_bold = BOLD_OR_ITALIC.sub("", without_links)
    # Feed descriptions arrive with stray spaces before punctuation, left
    # behind when the publisher's HTML was flattened: "Muleskinner News ."
    # Somebody linking that name closes the gap in passing, and that is the
    # same edit, not a different description. Ignoring the space here is what
    # keeps this from reporting every tidied blurb as a rewritten one.
    tidied = SPACE_BEFORE_PUNCTUATION.sub(r"\1", without_bold)
    return " ".join(tidied.split())


def is_annotation(theirs, ours):
    """@return: True when theirs is ours with wiki markup added, nothing more."""
    return plain(theirs) == plain(ours)


def keep_human_description(wanted, current):
    """
    The text to write when a person has edited this page's description.

    @param wanted: the wikitext this run generated.
    @param current: the wikitext now on the wiki.
    @return: (text, kept) — the merged text, and True if it differs from
        `wanted` because of the human's description.
    """
    theirs = description(current)
    if theirs is None or theirs == description(wanted):
        return wanted, False

    found = param_block(wanted, "description")
    if not found:
        return wanted, False

    start, stop, _ = found
    lines = wanted.splitlines()
    lines[start:stop] = ("|description=" + theirs).splitlines()
    text = "\n".join(lines)
    if wanted.endswith("\n") and not text.endswith("\n"):
        text += "\n"
    return text, True
