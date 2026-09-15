"""CSV reading and per-row validation.

One bad row never aborts the batch (harness rule H6): every row is validated
independently, failures are collected with the offending field and a human
message, and the good rows carry on.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from pydantic import ValidationError

from app.csv_engine.schema import BulkRow, HeaderMapping, map_headers

RowStatus = Literal["ok", "error"]


@dataclass(slots=True)
class RowResult:
    row_no: int                       # 1-based index of the data row
    status: RowStatus
    raw: dict[str, str]
    data: dict[str, Any] | None = None
    error_field: str | None = None
    error_message: str | None = None


@dataclass(slots=True)
class ParseResult:
    filename: str
    mapping: HeaderMapping
    rows: list[RowResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fatal: str | None = None

    @property
    def total(self) -> int:
        return len(self.rows)

    @property
    def ok_rows(self) -> list[RowResult]:
        return [r for r in self.rows if r.status == "ok"]

    @property
    def error_rows(self) -> list[RowResult]:
        return [r for r in self.rows if r.status == "error"]


def _jsonable(value: Any) -> Any:
    return str(value) if isinstance(value, Decimal) else value


def _read_frame(source: bytes | str | Path) -> pd.DataFrame:
    """Read every cell as text, preserving blanks as empty strings."""
    buffer: Any
    if isinstance(source, (bytes, bytearray)):
        buffer = io.BytesIO(bytes(source))
    else:
        buffer = Path(source)
    return pd.read_csv(
        buffer,
        dtype=str,
        keep_default_na=False,
        na_filter=False,
        encoding="utf-8-sig",      # tolerate a UTF-8 BOM
        skip_blank_lines=True,
    )


def _describe(exc: ValidationError) -> tuple[str, str]:
    """Collapse a pydantic error set into ``(first_field, joined_message)``."""
    parts: list[str] = []
    first_field = ""
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ())) or "row"
        msg = err.get("msg", "invalid value").removeprefix("Value error, ")
        if not first_field:
            first_field = loc
        # validators already name their field; don't say it twice
        parts.append(msg if loc == "row" or msg.startswith(loc) else f"{loc}: {msg}")
    return first_field or "row", "; ".join(parts)


def parse_csv(source: bytes | str | Path, filename: str = "upload.csv") -> ParseResult:
    """Parse and validate a bulk-import CSV.

    A structural problem (unreadable file, missing required columns) comes back
    as ``fatal``; row-level problems come back as ``error`` rows.
    """
    try:
        frame = _read_frame(source)
    except Exception as exc:                        # noqa: BLE001
        return ParseResult(
            filename=filename,
            mapping=HeaderMapping(),
            fatal=f"Could not read the CSV: {exc}",
        )

    mapping = map_headers([str(c) for c in frame.columns])
    result = ParseResult(filename=filename, mapping=mapping, warnings=mapping.warnings)

    if not mapping.ok:
        result.fatal = (
            "Missing required column(s): " + ", ".join(mapping.missing_required)
        )
        return result

    if frame.empty:
        result.fatal = "The CSV contains a header row but no data rows."
        return result

    # csv header -> canonical, applied once
    rename = mapping.columns
    records = frame.to_dict(orient="records")

    for index, record in enumerate(records, start=1):
        raw = {str(k): str(v) for k, v in record.items()}
        payload = {
            canonical: record.get(source_col, "")
            for source_col, canonical in rename.items()
        }
        try:
            row = BulkRow.model_validate(payload)
        except ValidationError as exc:
            field_name, message = _describe(exc)
            result.rows.append(
                RowResult(
                    row_no=index,
                    status="error",
                    raw=raw,
                    error_field=field_name,
                    error_message=message,
                )
            )
            continue

        result.rows.append(
            RowResult(
                row_no=index,
                status="ok",
                raw=raw,
                data={k: _jsonable(v) for k, v in row.model_dump().items()},
            )
        )

    return result
