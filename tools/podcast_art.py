"""
Artwork for podcast episodes, read off the feed.

Most of our shows publish a picture per episode — usually the guest — in an
<itunes:image> on the item. A few (Bluegrass Jam Along, County Sales, Fiddle
Studio) only ever publish the show's own cover, on the channel. An episode gets
its own picture where there is one and the show's cover otherwise, so every row
in a firehose has something in the art column.

The URL ends up bare in wikitext, where MediaWiki turns it into an <img> only
if it looks like an image ($wgAllowExternalImages). Anything else would render
as a raw link in the middle of the row, or — with a pipe or brace in it — break
the template call it sits in. So a URL that is not plainly an image is refused
rather than repaired.
"""

import re

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"

# What MediaWiki's external-image rule will accept, and nothing that can escape
# a template parameter: no whitespace, pipes, braces, brackets or quotes.
# Buzzsprout's URLs end "?.jpg", which is odd but passes both tests.
_IMAGE_URL = re.compile(
    r"^https?://[^\s|{}\[\]<>\"]+\.(?:jpe?g|png|gif)$",
    re.IGNORECASE,
)


def usable_image_url(url):
    """
    @return: the URL, stripped, if it will render as an image; otherwise None.
    """
    if not url:
        return None
    url = url.strip()
    return url if _IMAGE_URL.match(url) else None


def channel_image(channel):
    """
    The show's own cover. Feeds give it as <itunes:image href> or as the older
    <image><url>, and some give only one of the two.

    @param channel: the <channel> element, or None.
    """
    if channel is None:
        return None
    el = channel.find(ITUNES + "image")
    if el is not None:
        found = usable_image_url(el.get("href"))
        if found:
            return found
    el = channel.find("image/url")
    if el is not None:
        return usable_image_url(el.text)
    return None


def episode_image(item, fallback):
    """
    The episode's own picture, or the show's cover if it has none.

    @param item: the <item> element.
    @param fallback: the channel image, already checked.
    """
    el = item.find(ITUNES + "image")
    if el is not None:
        found = usable_image_url(el.get("href"))
        if found:
            return found
    return fallback
