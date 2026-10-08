"""Make feed text safe to sit inside a template parameter.

A podcast feed is somebody else's document. We read titles and descriptions
out of it and write them into `{{PodcastEpisode|...}}` calls on pages a bot
saves unattended, on a schedule. Until this existed those values were
interpolated raw, so three characters belonging to the feed decided what the
bot wrote rather than merely what it said:

    |    ends the parameter and starts another, letting a title set any
         other parameter of the template
    }}   closes the call, after which the rest of the feed text is page
         wikitext: headings, categories, another template call
    {{   opens a transclusion, so every imported episode page could pull in
         a page the feed's owner controls

The description was already being run through `html.unescape`, which makes
this worse rather than better: it turns `&#124;` and `&lcub;` back into real
pipes and braces. Unescaping is right for reading the text; it just has to
be followed by escaping for the place the text is going.

The project knew this. `podcast_config.py` justifies parsing `{{Podcast|…}}`
on pipes with "URLs, names and hosts contain no pipes, and pipes are the
whole problem" — true of URLs, and never applied to titles.
"""

import re

# Pairs, not single characters: a lone brace is ordinary punctuation in a
# title and mangling it would be noise. Numeric entities render as the
# character, so the page still reads the way the feed wrote it.
_PAIRS = (
    ("{{", "&#123;&#123;"),
    ("}}", "&#125;&#125;"),
    ("[[", "&#91;&#91;"),
    ("]]", "&#93;&#93;"),
)

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def escape_param(value, limit=None):
    """One feed-supplied value, safe to put after `|name=`.

    @param value: whatever the feed gave us; None and non-strings are fine.
    @param limit: trim to about this many characters, on a word boundary.
    @return: a string that cannot end its parameter or close its template.
    """
    text = "" if value is None else str(value)

    # Newlines are not dangerous on their own, but a line beginning with a
    # pipe inside a template call reads as a new parameter, and the pipe
    # escape below is easier to trust if the value is one line.
    text = _CONTROL.sub("", text)
    text = " ".join(text.split())

    # Trim before escaping, so a cut never lands inside an entity and leaves
    # `&#12` on the page.
    if limit and len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip() + "..."

    for raw, safe in _PAIRS:
        text = text.replace(raw, safe)

    # Last, because {{!}} is itself braces: running the pair pass after this
    # would mangle the escape we just inserted. {{!}} is MediaWiki's own
    # answer for a literal pipe inside a template call.
    text = text.replace("|", "{{!}}")

    return text.strip()
