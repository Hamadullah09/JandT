"""Font registration and text fitting for the waybill.

Two hard rules from the spec, enforced here rather than in the renderer:

* text is **truncated with a trailing** ``-``, never wrapped past its box and
  never overlapping a neighbour;
* a non-Latin receiver name must still render, so a TrueType fallback is
  registered for anything Helvetica's WinAnsi encoding cannot represent.

The fallback is Bitstream Vera, which ships inside ReportLab itself.  Using the
bundled copy rather than a system DejaVu keeps output byte-identical between a
Windows host and the Linux container (AC10).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FALLBACK = "JTFallback"
FALLBACK_BOLD = "JTFallback-Bold"
FALLBACK_BOLD_ITALIC = "JTFallback-BoldOblique"

_RL_FONTS = Path(reportlab.__file__).parent / "fonts"
_FALLBACK_FILES = {
    FALLBACK: "Vera.ttf",
    FALLBACK_BOLD: "VeraBd.ttf",
    FALLBACK_BOLD_ITALIC: "VeraBI.ttf",
}

TRUNC_SUFFIX = "-"


@lru_cache(maxsize=1)
def register_fonts() -> bool:
    """Register the TTF fallbacks once per process.  Returns success."""
    try:
        for name, filename in _FALLBACK_FILES.items():
            path = _RL_FONTS / filename
            if not path.exists():
                return False
            pdfmetrics.registerFont(TTFont(name, str(path)))
        return True
    except Exception:            # noqa: BLE001 - a waybill must always render
        return False


def _is_latin1(text: str) -> bool:
    try:
        text.encode("cp1252")
        return True
    except (UnicodeEncodeError, UnicodeDecodeError):
        return False


def pick_font(text: str, font: str) -> str:
    """Swap in the TTF fallback when *text* leaves Helvetica's encoding."""
    if _is_latin1(text):
        return font
    if not register_fonts():
        return font
    if font.endswith("-BoldOblique"):
        return FALLBACK_BOLD_ITALIC
    if font.endswith("-Bold"):
        return FALLBACK_BOLD
    return FALLBACK


def sanitise(text: str, font: str) -> str:
    """Drop characters the chosen font still cannot encode, so drawing cannot fail."""
    if font.startswith(FALLBACK) or _is_latin1(text):
        return text
    return text.encode("cp1252", "replace").decode("cp1252")


def width_of(text: str, font: str, size: float) -> float:
    return pdfmetrics.stringWidth(text, font, size)


def fit(text: str, font: str, size: float, max_width: float) -> str:
    """Truncate *text* to *max_width*, appending ``-`` when it had to be cut.

    Already-hyphenated tails are not doubled, so ``"... Palazzo -  M"`` cut at
    the dash comes back as ``"... Palazzo -"`` exactly like the reference.
    """
    text = text or ""
    if max_width <= 0:
        return ""
    if width_of(text, font, size) <= max_width:
        return text

    suffix_w = width_of(TRUNC_SUFFIX, font, size)
    budget = max_width - suffix_w
    cut = text
    while cut and width_of(cut, font, size) > budget:
        cut = cut[:-1]
    cut = cut.rstrip()
    while cut.endswith(TRUNC_SUFFIX):
        cut = cut[: -len(TRUNC_SUFFIX)].rstrip()
    return f"{cut} {TRUNC_SUFFIX}" if cut else TRUNC_SUFFIX


def fit_items(
    parts: list[str], font: str, size: float, min_size: float, max_width: float
) -> tuple[str, float]:
    """Fit a comma-separated item list on one line: ``"Maxi Chic x2, Gown"``.

    A label line has no room for a second row, so a long list first shrinks,
    down to *min_size*.  If it still does not fit, it shows as many whole items
    as it can followed by ``"+N more"``: a packer must never read a cut-off
    list and believe it is complete.  Returns ``(text, font_size)``.
    """
    if not parts:
        return "", size
    joined = ", ".join(parts)
    current = size
    while current >= min_size:
        if width_of(joined, font, current) <= max_width:
            return joined, current
        current = round(current - 0.25, 2)

    for shown in range(len(parts) - 1, 0, -1):
        text = f"{', '.join(parts[:shown])} +{len(parts) - shown} more"
        if width_of(text, font, min_size) <= max_width:
            return text, min_size

    # not even the first item fits beside the count: shorten that item
    more = f" +{len(parts) - 1} more" if len(parts) > 1 else ""
    first = fit(parts[0], font, min_size, max_width - width_of(more, font, min_size))
    return f"{first}{more}", min_size


def wrap(
    text: str, font: str, size: float, max_width: float, max_lines: int
) -> list[str]:
    """Greedy word wrap, hard-capped at *max_lines*.

    The final line is truncated with a trailing ``-`` if content remains, so
    overflow is always visible as a cut rather than silently dropped.
    """
    words = (text or "").split()
    if not words:
        return []

    lines: list[str] = []
    current = ""
    for index, word in enumerate(words):
        candidate = f"{current} {word}".strip()
        if width_of(candidate, font, size) <= max_width:
            current = candidate
            continue
        if not current:
            # single word longer than the box - hard-cut it
            current = fit(word, font, size, max_width)
        lines.append(current)
        current = word
        if len(lines) == max_lines:
            remainder = " ".join(words[index:])
            lines[-1] = fit(f"{lines[-1]} {remainder}", font, size, max_width)
            return lines[:max_lines]
    if current and len(lines) < max_lines:
        lines.append(current)
    elif current:
        lines[-1] = fit(f"{lines[-1]} {current}", font, size, max_width)
    return lines[:max_lines]
