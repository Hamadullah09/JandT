"""Where an order came from: the shop's own website, a marketplace, social media.

The admin portal filters orders by it.  An order made on the Normal Order page
says which source it came from; a CSV can carry a ``source`` column.  Common
spellings are tidied into one name ("daraz.pk" -> Daraz, "fb" -> Facebook); any
other source is kept as written, so a new marketplace simply appears as its own
filter.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

DEFAULT_SOURCE = "Website"
MAX_SOURCE = 32


@dataclass(frozen=True, slots=True)
class Source:
    name: str
    #: national: sells in Malaysia / Pakistan; international: worldwide
    kind: str


#: in the order the admin portal shows them
SOURCES: tuple[Source, ...] = (
    Source("Website", "own"),
    Source("WhatsApp", "social"),
    Source("Facebook", "social"),
    Source("Instagram", "social"),
    Source("TikTok Shop", "social"),
    Source("Daraz", "national"),
    Source("Shopee", "national"),
    Source("Lazada", "national"),
    Source("Amazon", "international"),
    Source("eBay", "international"),
    Source("Etsy", "international"),
    Source("Other", "other"),
)

_ALIASES = {
    "web": "Website",
    "site": "Website",
    "web site": "Website",
    "own website": "Website",
    "online store": "Website",
    "wa": "WhatsApp",
    "whats app": "WhatsApp",
    "fb": "Facebook",
    "facebook marketplace": "Facebook",
    "ig": "Instagram",
    "insta": "Instagram",
    "tiktok": "TikTok Shop",
    "tik tok": "TikTok Shop",
    "tiktokshop": "TikTok Shop",
    "tik tok shop": "TikTok Shop",
    "others": "Other",
}


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


_BY_KEY = {_key(source.name): source.name for source in SOURCES}


def normalise_source(text: str | None) -> str:
    """``"daraz.pk"`` -> ``"Daraz"``; blank -> ``"Website"``; unknown kept as written."""
    raw = " ".join(str(text or "").split())
    if not raw:
        return DEFAULT_SOURCE
    key = _key(raw)
    if key in _BY_KEY:
        return _BY_KEY[key]
    if key in _ALIASES:
        return _ALIASES[key]
    # "daraz pk", "amazon uk", "shopee my": the marketplace, whatever the country
    first = key.split(" ")[0] if key else ""
    if first in _BY_KEY:
        return _BY_KEY[first]
    if first in _ALIASES:
        return _ALIASES[first]
    return raw[:MAX_SOURCE]


def ordered(names: set[str]) -> list[str]:
    """The known sources in their usual order, then any others A-Z."""
    known = [source.name for source in SOURCES]
    return known + sorted((names - set(known)), key=str.casefold)
