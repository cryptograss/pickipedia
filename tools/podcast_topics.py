"""
Whose topics win when the importer meets a page a person has edited.

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

When the bad name comes from the *format* of a show's titles rather than one
odd episode, the pattern on the show's page is the better fix — it corrects
every episode at once, and the importer will apply it here because those pages
were last edited by the bot.
"""

import re

# |topic=…, |topic2=…, and the guest aliases the template still accepts.
TOPIC_PARAM = re.compile(r"^\|(?:topic|guest)\d*\s*=", re.IGNORECASE)


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
