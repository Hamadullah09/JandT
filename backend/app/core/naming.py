"""Output directory validation and waybill file naming (spec section 10)."""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

from app.config import get_settings

ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
WHITESPACE = re.compile(r"\s+")
MAX_STEM = 100
PREFIX = "OrderNo_"

#: Reserved device names on Windows - a file called ``CON.pdf`` is not creatable.
_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class OutputDirError(ValueError):
    """The chosen output directory is unusable - raised before any order exists."""


def sanitise_stem(value: str) -> str:
    """Make *value* safe as a filename stem on both Windows and POSIX."""
    cleaned = ILLEGAL.sub("", str(value or ""))
    cleaned = WHITESPACE.sub(" ", cleaned).strip()
    cleaned = cleaned.strip(". ")                    # Windows drops trailing dots
    if cleaned.upper() in _WINDOWS_RESERVED:
        cleaned = f"_{cleaned}"
    return cleaned[:MAX_STEM]


def waybill_filename(customer_order_no: str | None, tracking_no: str) -> str:
    """``OrderNo_12808.pdf``; falls back to ``<tracking_no>.pdf`` when blank."""
    stem = sanitise_stem(customer_order_no or "")
    if not stem:
        return f"{sanitise_stem(tracking_no)}.pdf"
    return f"{PREFIX}{stem}.pdf"


def unique_path(directory: Path, filename: str, taken: set[str] | None = None) -> Path:
    """Resolve collisions as ``name_1.pdf``, ``name_2.pdf``, ... never overwriting.

    *taken* lets a batch reserve names in memory so two rows in the same run
    cannot race for the same file before either has been written.
    """
    stem, suffix = Path(filename).stem, Path(filename).suffix
    seen = taken if taken is not None else set()

    candidate = filename
    index = 0
    while candidate.lower() in seen or (directory / candidate).exists():
        index += 1
        candidate = f"{stem}_{index}{suffix}"
    seen.add(candidate.lower())
    return directory / candidate


def validate_output_dir(raw: str | os.PathLike[str] | None) -> Path:
    """Resolve, create and write-test the batch output directory.

    Called *before* the pipeline allocates a single tracking number, so a bad
    path costs nothing.  Raises :class:`OutputDirError` with a message meant for
    the user's screen.
    """
    if raw is None or not str(raw).strip():
        raise OutputDirError("An output directory is required.")

    try:
        path = Path(str(raw).strip()).expanduser()
    except (OSError, ValueError) as exc:
        raise OutputDirError(f"Not a valid path: {raw!r} ({exc})") from exc

    if not path.is_absolute():
        raise OutputDirError(f"The output directory must be an absolute path: {raw!r}")

    root = get_settings().output_root_path
    if root is not None:
        try:
            resolved = path.resolve()
        except OSError as exc:
            raise OutputDirError(f"Cannot resolve {path}: {exc}") from exc
        if resolved != root and root not in resolved.parents:
            raise OutputDirError(
                f"The output directory must be inside {root} (got {resolved}). "
                "In Docker this is the mounted ./waybills volume."
            )
        path = resolved

    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise OutputDirError(f"Cannot create {path}: {exc}") from exc

    if not path.is_dir():
        raise OutputDirError(f"Not a directory: {path}")

    probe = path / f".jt_write_test_{uuid.uuid4().hex}"
    try:
        probe.write_bytes(b"")
    except OSError as exc:
        raise OutputDirError(f"Directory is not writable: {path} ({exc})") from exc
    finally:
        try:
            probe.unlink()
        except OSError:
            pass

    return path
