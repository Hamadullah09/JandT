"""Malaysian receiver addresses: a postcode's town and state, reading a pasted
address, and whether an address agrees with its postcode.

Postcodes, towns and states come from ``app/db/data/malaysia_postcodes.json``,
the post-office list (see ``app/db/data/README.md``).  ``postcode_zone`` is not
used here: it is generated from number ranges for sortation, so its cities are
only approximate - it says SUNGAI BULOH for 47100, which is Puchong.

A mismatch is reported only when it is certain: a state that is not the
postcode's state, or a post-office town that is not the postcode's town.  A
locality the list does not know - "Kota Damansara", "Bandar Utama" - is never
called a mismatch, because people write those instead of the post-office town
all the time.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from dataclasses import field as _field  # "field" is also an AddressCheck attribute
from functools import lru_cache
from pathlib import Path

from app.core.phone import PhoneError, normalise_my_mobile

DATA = Path(__file__).resolve().parent.parent / "db" / "data" / "malaysia_postcodes.json"

#: the list's state names that are shown differently
_STATE_DISPLAY = {
    "Wp Kuala Lumpur": "Kuala Lumpur",
    "Wp Labuan": "Labuan",
    "Wp Putrajaya": "Putrajaya",
}
#: other ways people write a state -> its name
_STATE_ALIASES = {
    "penang": "Pulau Pinang",
    "p pinang": "Pulau Pinang",
    "malacca": "Melaka",
    "johore": "Johor",
    "negri sembilan": "Negeri Sembilan",
    "n sembilan": "Negeri Sembilan",
    "trengganu": "Terengganu",
    "kl": "Kuala Lumpur",
    "wilayah persekutuan": "Kuala Lumpur",
}
_TERRITORIES = {"Kuala Lumpur", "Labuan", "Putrajaya"}
_TERRITORY_PREFIX = re.compile(r"^(?:wp|w p|wilayah persekutuan|federal territory(?: of)?)\s+")

#: words that start an address line, never a person's name
_ADDRESS_WORDS = {
    "no", "lot", "jalan", "jln", "taman", "tmn", "blok", "block", "blk", "unit",
    "level", "lorong", "lrg", "kampung", "kg", "lebuh", "persiaran", "residensi",
    "apartment", "apt", "flat", "rumah", "house", "pangsapuri", "kondominium",
    "condo", "bangunan", "wisma", "menara", "tower", "jalan", "batu", "km",
}
_LABEL = re.compile(
    r"^\s*(?:receiver name|receiver|penerima|name|nama|phone number|phone no|phone|"
    r"telephone|tel|h/p|hp|mobile|contact no|contact|no tel|address|alamat|"
    r"postcode|poskod|zip code|zip|city|bandar|state|negeri)\s*[:：=-]\s*",
    re.IGNORECASE,
)
# 01X-XXX XXXX; only 011 and 015 numbers have a digit more.  Exact lengths keep
# a house number after the phone ("0123456789 7, Jalan ...") out of it.
_PHONE = re.compile(
    r"(?<![\d+])(?:\+[ \t]*)?(?:6[ \t]*)?0?[ \t]*1[ \t]*"
    r"(?:[15](?:[ \t-]*\d){7,8}|[02346789](?:[ \t-]*\d){7})(?!\d)"
)
_POSTCODE = re.compile(r"(?<!\d)\d{5}(?!\d)")
_COUNTRY = re.compile(r"\bmalaysia\b", re.IGNORECASE)
_NAME = re.compile(r"[A-Za-z][A-Za-z .'@/-]{1,59}")


def _key(text: str | None) -> str:
    """Comparison form: lower case, punctuation and repeated spaces gone."""
    return re.sub(r"[^0-9a-z]+", " ", str(text or "").casefold()).strip()


@dataclass(frozen=True, slots=True)
class Place:
    town: str
    state: str


@dataclass(slots=True)
class _Book:
    places: dict[str, tuple[Place, ...]]
    #: town key -> the town's name as the list writes it
    towns: dict[str, str]
    #: state key (name or alias) -> state name
    states: dict[str, str]
    #: town key -> state name -> the town's postcodes
    town_postcodes: dict[str, dict[str, list[str]]]
    #: (compiled pattern, state name) for finding a state inside free text
    state_patterns: list[tuple[re.Pattern[str], str]]


def _words_pattern(words: str) -> str:
    return r"[\s.]+".join(re.escape(word) for word in words.split())


@lru_cache(maxsize=1)
def _book() -> _Book:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    places: dict[str, list[Place]] = {}
    towns: dict[str, str] = {}
    states: dict[str, str] = {}
    town_postcodes: dict[str, dict[str, list[str]]] = {}
    for state in raw["state"]:
        state_name = _STATE_DISPLAY.get(state["name"], state["name"])
        states[_key(state_name)] = state_name
        for city in state["city"]:
            towns.setdefault(_key(city["name"]), city["name"])
            town_postcodes.setdefault(_key(city["name"]), {}).setdefault(state_name, []).extend(
                city["postcode"]
            )
            for code in city["postcode"]:
                places.setdefault(code, []).append(Place(city["name"], state_name))
    for alias, state_name in _STATE_ALIASES.items():
        states[alias] = state_name

    patterns = []
    for key, state_name in states.items():
        body = _words_pattern(key)
        if state_name in _TERRITORIES:
            body = rf"(?:(?:w[\s.]*p|wilayah[\s.]+persekutuan)[\s.]+)?{body}"
        patterns.append((re.compile(rf"\b{body}\b", re.IGNORECASE), state_name))
    return _Book(
        places={code: tuple(found) for code, found in places.items()},
        towns=towns,
        states=states,
        town_postcodes=town_postcodes,
        state_patterns=patterns,
    )


def canonical_state(text: str | None) -> str | None:
    """``"penang"``, ``"W.P. Kuala Lumpur"``, ``"SELANGOR/PETALING/SERI KEMBANGAN"``
    -> the state's name; ``None`` for text that is not a state."""
    head = str(text or "").split("/")[0]
    key = _key(head)
    book = _book()
    return book.states.get(key) or book.states.get(_TERRITORY_PREFIX.sub("", key))


def town_name(text: str | None) -> str | None:
    """The post-office town *text* names, as the list writes it; else ``None``."""
    return _book().towns.get(_key(text))


# ---------------------------------------------------------------------------
# check
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class AddressCheck:
    postcode: str
    #: the postcode is on the post-office list
    known: bool
    #: the postcode's state and post-office town(s), when known
    state: str = ""
    city: str = ""
    cities: list[str] = _field(default_factory=list)
    #: what disagrees with the postcode: "receiver_state" or "receiver_city"
    field: str | None = None
    message: str | None = None
    #: a postcode that is not on the list at all: worth a second look, not an error
    notice: str | None = None
    #: the postcodes of the city (and state) that was entered, closest first
    suggestions: list[str] = _field(default_factory=list)
    suggestions_total: int = 0
    #: whose postcodes they are: "Bayan Lepas, Pulau Pinang"
    suggestions_for: str = ""

    @property
    def ok(self) -> bool:
        return self.message is None


#: postcodes offered at most; the closest to the one typed come first
MAX_SUGGESTIONS = 8


def _closeness(typed: str, candidate: str) -> tuple[int, int]:
    """Fewest different digits first (a typo: 11090 for 11900), then the nearest."""
    if len(typed) == 5 and typed.isdigit():
        return sum(a != b for a, b in zip(typed, candidate)), abs(int(typed) - int(candidate))
    return 5, int(candidate)


def suggest(result: AddressCheck, state: str | None, city: str | None) -> None:
    """Offer the postcodes of the city that was entered, in the state entered.

    Nothing is offered without a post-office town: a state alone has hundreds.
    """
    town = town_name(city)
    if not town:
        return
    by_state = _book().town_postcodes.get(_key(town), {})
    wanted = canonical_state(state)
    states = [wanted] if wanted else sorted(by_state)
    codes = sorted(
        {code for name in states for code in by_state.get(name, [])},
        key=lambda code: _closeness(result.postcode, code),
    )
    if not codes:
        return
    result.suggestions = codes[:MAX_SUGGESTIONS]
    result.suggestions_total = len(codes)
    place = wanted or (states[0] if len(states) == 1 else "")
    result.suggestions_for = f"{town}, {place}" if place and place != town else town


def check(postcode: str | None, state: str | None = "", city: str | None = "") -> AddressCheck:
    """Whether *state* and *city* belong to *postcode* - and which postcodes would.

    Blank values are not mismatches.  Neither is a postcode the list does not
    have; when a city was entered, its postcodes are offered with a notice.
    """
    code = str(postcode or "").strip()
    found = _book().places.get(code)
    if not found:
        result = AddressCheck(postcode=code, known=False)
        if len(code) == 5 and code.isdigit():
            suggest(result, state, city)
            if result.suggestions:
                result.notice = f"{code} is not a postcode on the post-office list."
        return result

    towns = list(dict.fromkeys(place.town for place in found))
    states = {place.state for place in found}
    result = AddressCheck(
        postcode=code, known=True, state=found[0].state, city=towns[0], cities=towns
    )

    given_state = canonical_state(state)
    if given_state and given_state not in states:
        result.field = "receiver_state"
        result.message = (
            f"Zip code does not match the state: {code} is in {result.state}, "
            f"not {given_state}."
        )
        suggest(result, state, city)
        return result

    given_town = town_name(city)
    if given_town and _key(given_town) not in {_key(town) for town in towns}:
        result.field = "receiver_city"
        result.message = (
            f"Zip code does not match the city: {code} belongs to {' / '.join(towns)}, "
            f"not {given_town}."
        )
        suggest(result, state, city)
    return result


# ---------------------------------------------------------------------------
# reading a pasted address
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class ParsedAddress:
    name: str = ""
    phone: str = ""
    postcode: str = ""
    city: str = ""
    state: str = ""
    address: str = ""
    #: the postcode against the city and state the text itself named
    check: AddressCheck | None = None


def _tidy(text: str) -> str:
    text = re.sub(r"\s*,[\s,]*", ", ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip(" \t,;-")


def _looks_like_name(text: str) -> bool:
    text = text.strip(" ,;")
    if not _NAME.fullmatch(text):
        return False
    key = _key(text)
    first = key.split(" ")[0] if key else ""
    book = _book()
    return (
        first not in _ADDRESS_WORDS
        and key not in book.states
        and key not in book.towns
        and key != "malaysia"
    )


def _last_state(text: str) -> tuple[int, int, str] | None:
    """The last state named in *text*: ``(start, end, name)``."""
    best: tuple[int, int, str] | None = None
    for pattern, state_name in _book().state_patterns:
        for match in pattern.finditer(text):
            candidate = (match.start(), match.end(), state_name)
            # the latest end wins; at the same end the longer name ("Pulau Pinang"
            # over "Pinang")
            if best is None or (match.end(), -match.start()) > (best[1], -best[0]):
                best = candidate
    return best


def _split_town(segment: str) -> tuple[str | None, str]:
    """``"Puchong"`` -> ``("Puchong", "")``;
    ``"Kota Damansara Petaling Jaya"`` -> ``("Petaling Jaya", "Kota Damansara")``;
    a locality alone -> ``(None, segment)``."""
    exact = town_name(segment)
    if exact:
        return exact, ""
    key = _key(segment)
    for town_key in sorted(_book().towns, key=len, reverse=True):
        if key.endswith(" " + town_key):
            words = len(town_key.split(" "))
            locality = " ".join(segment.split()[:-words])
            return _book().towns[town_key], locality.strip(" ,")
    return None, segment


def parse(text: str | None) -> ParsedAddress:
    """Read a pasted receiver address.

    Understands one line - ``Ramli Roslan 0123456789 No. 2, Jalan Contoh,
    47400 Petaling Jaya, Selangor`` - and several, as addresses are sent on
    WhatsApp: name, street, ``postcode town``, state, ``Malaysia``, phone.
    Labels such as ``Name:`` and ``Alamat:`` are ignored.

    Missing city and state are filled in from the postcode; a city or state
    the text names that does not belong to the postcode is kept as written,
    and ``check`` says what is wrong.
    """
    result = ParsedAddress()
    lines = [_LABEL.sub("", line).strip(" \t,;") for line in str(text or "").splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return result

    # phone - anywhere
    before_phone = ""
    for index, line in enumerate(lines):
        match = _PHONE.search(line)
        if not match:
            continue
        try:
            national = normalise_my_mobile(match.group()).removeprefix("+60 ")
        except PhoneError:
            continue
        result.phone = f"0{national}"
        before_phone = line[: match.start()] if index == 0 else ""
        lines[index] = f"{line[: match.start()]} , {line[match.end():]}"
        break

    # name - the first line of several, or what precedes the phone on one line
    if len(lines) > 1 and _looks_like_name(lines[0]):
        result.name = lines.pop(0).strip(" ,;")
    elif before_phone and _looks_like_name(before_phone):
        result.name = before_phone.strip(" ,;")
        lines[0] = lines[0][len(before_phone):]

    body = _tidy(", ".join(lines))

    # postcode - the last one on the list, else the last five-digit number
    matches = list(_POSTCODE.finditer(body))
    chosen = next((m for m in reversed(matches) if m.group() in _book().places), None)
    chosen = chosen or (matches[-1] if matches else None)
    if chosen:
        result.postcode = chosen.group()
        street, tail = body[: chosen.start()], body[chosen.end():]
    else:
        street, tail = body, ""

    # state - the last one named after the postcode, never in the street
    # ("Jalan Johor"); with no postcode, only in the address's last part
    if chosen:
        prefix, search_in = "", tail
    else:
        cut = street.rfind(",") + 1
        prefix, search_in = street[:cut], street[cut:]
    named_state = _last_state(search_in)
    if named_state:
        start, end, _ = named_state
        search_in = f"{search_in[:start]} , {search_in[end:]}"
    search_in = _COUNTRY.sub(" , ", search_in)
    if chosen:
        tail = search_in
    else:
        # no postcode: a town at the end still is the city ("..., Kajang, Selangor")
        parts = [s.strip() for s in _tidy(prefix + search_in).split(",") if s.strip()]
        ending_town = town_name(parts[-1]) if len(parts) > 1 else None
        if ending_town:
            parts.pop()
            tail = ending_town
        street = ", ".join(parts)

    # town - the first part after the postcode
    segments = [s.strip() for s in _tidy(tail).split(",") if s.strip()]
    named_town, locality = (None, "")
    if segments:
        named_town, locality = _split_town(segments[0])
        extra = [locality] if locality else []
        extra += segments[1:]
    else:
        extra = []

    result.check = check(result.postcode, named_state[2] if named_state else "", named_town or "")
    known = result.check.known
    result.state = named_state[2] if named_state else (result.check.state if known else "")
    if named_town:
        result.city = named_town
    elif known:
        result.city = result.check.city
    elif extra:
        result.city = extra.pop(0)
    result.address = _tidy(", ".join([street, *extra]))
    return result
