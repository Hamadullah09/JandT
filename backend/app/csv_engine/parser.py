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

from app.core.items import all_dropship, normalise_items, order_columns
from app.csv_engine.schema import BulkRow, HeaderMapping, map_headers

RowStatus = Literal["ok", "error"]


@dataclass(slots=True)
class RowResult:
    """One order.  Usually one CSV row; several when rows share an order number."""

    row_no: int                       # 1-based index of the (first) data row
    status: RowStatus
    raw: dict[str, str]
    data: dict[str, Any] | None = None
    error_field: str | None = None
    error_message: str | None = None
    rows: list[int] | None = None     # every data row of a multi-item order


@dataclass(slots=True)
class ParseResult:
    filename: str
    mapping: HeaderMapping
    rows: list[RowResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fatal: str | None = None
    line_count: int = 0               # CSV data rows; more than orders when items share one

    @property
    def total(self) -> int:
        """Orders, which is fewer than :attr:`line_count` for multi-item orders."""
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
    lines: list[_Line] = []
    for index, record in enumerate(frame.to_dict(orient="records"), start=1):
        lines.append(
            _Line(
                row_no=index,
                raw={str(k): str(v) for k, v in record.items()},
                payload={
                    canonical: record.get(source_col, "")
                    for source_col, canonical in rename.items()
                },
            )
        )
    result.line_count = len(lines)

    for group in _group_by_order_no(lines):
        result.rows.append(_parse_one(group[0]) if len(group) == 1 else _parse_order(group))
    return result


# ---------------------------------------------------------------------------
# one row per item: rows sharing an order number are one order
# ---------------------------------------------------------------------------
#: fields that belong to an item line; everything else describes the order
ITEM_FIELDS = ("goods_name", "item_variant", "quantity", "image", "dropship")


@dataclass(slots=True)
class _Line:
    row_no: int
    raw: dict[str, str]
    payload: dict[str, Any]


def _group_by_order_no(lines: list[_Line]) -> list[list[_Line]]:
    """Rows sharing an order number, in order of first appearance.

    A row with no order number is never merged - it fails validation on its own.
    """
    groups: list[list[_Line]] = []
    by_number: dict[str, list[_Line]] = {}
    for line in lines:
        number = str(line.payload.get("order_no", "")).strip()
        if not number:
            groups.append([line])
        elif number in by_number:
            by_number[number].append(line)
        else:
            by_number[number] = [line]
            groups.append(by_number[number])
    return groups


def _parse_one(line: _Line) -> RowResult:
    try:
        row = BulkRow.model_validate(line.payload)
    except ValidationError as exc:
        field_name, message = _describe(exc)
        return RowResult(
            row_no=line.row_no,
            status="error",
            raw=line.raw,
            error_field=field_name,
            error_message=message,
        )
    return RowResult(
        row_no=line.row_no,
        status="ok",
        raw=line.raw,
        data={k: _jsonable(v) for k, v in row.model_dump().items()},
    )


def _parse_order(group: list[_Line]) -> RowResult:
    """Several rows with one order number: one order carrying several items.

    The first row holds the order - receiver, weight, payment.  Extra rows may
    leave those blank; if they fill them in, the values must match the first
    row, because guessing which one is right could ship to the wrong address.
    Any bad row stops the whole order: a parcel missing one of its items is
    worse than no parcel.
    """
    head_line = group[0]
    rows = [line.row_no for line in group]
    number = str(head_line.payload.get("order_no", "")).strip()
    spans = f"order {number} (rows {', '.join(map(str, rows))}) was not created"

    def failed(row_no: int, field_name: str, message: str) -> RowResult:
        return RowResult(
            row_no=head_line.row_no,
            status="error",
            raw=head_line.raw,
            error_field=field_name,
            error_message=f"row {row_no}: {message} - {spans}",
            rows=rows,
        )

    try:
        head = BulkRow.model_validate(head_line.payload)
    except ValidationError as exc:
        return failed(head_line.row_no, *_describe(exc))

    order_fields = [name for name in BulkRow.model_fields if name not in ITEM_FIELDS]
    item_rows = [head]
    for line in group[1:]:
        candidate = dict(head_line.payload)
        for name, value in line.payload.items():
            if name not in ITEM_FIELDS and str(value).strip():
                candidate[name] = value
        for name in ITEM_FIELDS:
            candidate[name] = line.payload.get(name, "")
        try:
            item_row = BulkRow.model_validate(candidate)
        except ValidationError as exc:
            return failed(line.row_no, *_describe(exc))
        for name in order_fields:
            if getattr(item_row, name) != getattr(head, name):
                return failed(
                    line.row_no,
                    name,
                    f"{name} differs from row {head_line.row_no} - on extra item rows, "
                    "leave the order details blank",
                )
        item_rows.append(item_row)

    items = normalise_items(
        {
            "name": r.goods_name,
            "variant": r.item_variant,
            "quantity": r.quantity,
            "image": r.image,
            "dropship": r.dropship,
        }
        for r in item_rows
    )
    data = {k: _jsonable(v) for k, v in head.model_dump().items()}
    data.update(order_columns(items))
    data["image"] = next((item["image"] for item in items if item.get("image")), "")
    data["dropship"] = all_dropship(items)
    data["items"] = items
    return RowResult(
        row_no=head_line.row_no, status="ok", raw=head_line.raw, data=data, rows=rows
    )
