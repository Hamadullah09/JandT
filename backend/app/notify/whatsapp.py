"""Queue created orders for the WhatsApp group.

Every created order becomes one JSON job in the outbox folder.  The WhatsApp
service (``whatsapp/service.js``) drains the outbox and posts three messages
per order into the group:

1. ``Order created #<order_no>`` and the tracking number
2. the product photo, captioned with the variant and delivery address -
   plain text when no photo is found
3. the waybill PDF, as a document

Order creation never talks to WhatsApp itself, for two reasons:

* a linked WhatsApp session can only be driven by one process, while orders
  are created by both the CLI and the API server;
* queueing is a local file write, so a WhatsApp problem - the service is not
  running, the phone is offline - can never fail or slow down order creation.
  Jobs wait in the outbox until the service is back.

Queueing is off unless ``JT_WHATSAPP_ENABLED=true``.
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.core.items import items_of

log = logging.getLogger(__name__)

JOB_VERSION = 1
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
COUNTRY = "Malaysia"
# The service rewrites its heartbeat every few seconds, but can go ~40 s
# without one while it waits out a retry, so allow comfortably more.
HEARTBEAT_STALE_SECONDS = 90


@dataclass(slots=True)
class QueueResult:
    queued: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ServiceStatus:
    running: bool
    connected: bool
    group: str | None
    pending: int
    state: str | None = None

    @property
    def restricted(self) -> bool:
        return self.running and self.state == "RESTRICTED"

    def describe(self) -> str:
        waiting = f"{self.pending} waiting to send" if self.pending else "nothing waiting"
        if not self.running:
            return f"service NOT running - {waiting}. Start jt-whatsapp to send."
        if self.restricted:
            return (
                "WhatsApp has RESTRICTED this number from sending - sending is paused, "
                f"{waiting}. Check the jt-whatsapp window."
            )
        if not self.connected:
            return f"service running, but WhatsApp is not connected - {waiting}"
        return f'service running, posting to "{self.group}" - {waiting}'


def pending_jobs(outbox: Path) -> int:
    try:
        return sum(
            1 for p in outbox.iterdir()
            if p.suffix == ".json" and not p.name.startswith(".")
        )
    except OSError:
        return 0


def service_status(now: datetime | None = None) -> ServiceStatus:
    """Whether queued orders will actually go out, from the service heartbeat."""
    outbox = get_settings().whatsapp_outbox_path
    pending = pending_jobs(outbox)
    try:
        beat = json.loads((outbox.parent / "heartbeat.json").read_text(encoding="utf-8"))
        at = datetime.fromisoformat(str(beat["at"]).replace("Z", "+00:00"))
        age = ((now or datetime.now(timezone.utc)) - at).total_seconds()
    except (OSError, ValueError, KeyError, TypeError):
        return ServiceStatus(running=False, connected=False, group=None, pending=pending)
    if age > HEARTBEAT_STALE_SECONDS:
        return ServiceStatus(running=False, connected=False, group=None, pending=pending)
    return ServiceStatus(
        running=True,
        connected=beat.get("state") in {"CONNECTED", "RESTRICTED"},
        group=beat.get("group"),
        pending=pending,
        state=beat.get("state"),
    )


# ---------------------------------------------------------------------------
# formatting
# ---------------------------------------------------------------------------
def format_phone(phone: str | None) -> str:
    """``+60 171234567`` -> ``+60 17-123 4567``, the way WhatsApp users write it.

    011 numbers carry one extra digit: ``+60 1123456789`` -> ``+60 11-2345 6789``.
    Anything that is not a stored Malaysian mobile is returned unchanged.
    """
    raw = phone or ""
    digits = re.sub(r"\D", "", raw)
    if not digits.startswith("60"):
        return raw
    national = digits[2:]
    if len(national) == 9:
        return f"+60 {national[:2]}-{national[2:5]} {national[5:]}"
    if len(national) == 10:
        return f"+60 {national[:2]}-{national[2:6]} {national[6:]}"
    return raw


def _name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def resolve_image(
    image: str | None, goods_name: str | None, images_dir: Path
) -> tuple[Path | None, str | None]:
    """Find the product photo for an order.

    1. the CSV ``image`` value - an absolute path, or a file name inside
       *images_dir*;
    2. otherwise a file in *images_dir* named after the product, such as
       ``Embroidered Maxi Chic.jpg`` (case-insensitive, any image type);
    3. otherwise no photo.

    Returns ``(path, warning)``.  The warning is set only when the CSV named a
    photo that does not exist, because that is a mistake worth reporting; a
    product with no photo at all is normal.
    """
    warning = None
    if image:
        candidate = Path(image)
        if not candidate.is_absolute():
            candidate = images_dir / candidate
        if candidate.is_file():
            return candidate.resolve(), None
        warning = f"photo not found: {image}"

    if goods_name and images_dir.is_dir():
        wanted = _name_key(goods_name)
        for path in sorted(images_dir.iterdir()):
            if path.suffix.lower() in IMAGE_SUFFIXES and _name_key(path.stem) == wanted:
                return path.resolve(), warning
    return None, warning


def build_messages(
    order: Mapping[str, Any], image: Path | None, pdf: Path | None
) -> list[dict[str, str]]:
    """The three group messages for one order.

    Message 2 opens with the colour/size alone (``Pink / L``) - never the
    product name - exactly like the merchant's own WhatsApp orders: the photo
    shows the product.  A quantity above one is added (``Pink / L x2``), one
    line per item; items without a colour/size add no line.
    """
    order_no = str(order.get("customer_order_no") or "").strip()
    tracking = str(order.get("tracking_no") or "").strip()

    header = f"Order created #{order_no}" if order_no else "Order created"
    if tracking:
        header += f"\nTracking: {tracking}"

    top = "\n".join(
        str(item["variant"]) + (f" x{item['quantity']}" if int(item["quantity"]) > 1 else "")
        for item in items_of(order)
        if item.get("variant")
    )

    postcode = str(order.get("receiver_postcode") or "").strip()
    city = str(order.get("receiver_city") or "").strip()
    address = [
        str(order.get("receiver_name") or "").strip(),
        str(order.get("receiver_address") or "").strip(),
        " ".join(part for part in (postcode, city) if part),
        str(order.get("receiver_state") or "").strip(),
        COUNTRY,
        format_phone(str(order.get("receiver_phone") or "")),
    ]
    body = "\n".join(line for line in address if line)
    details = f"{top}\n\n{body}" if top else body

    messages = [{"type": "text", "text": header}]
    if image is not None:
        messages.append({"type": "image", "path": str(image), "caption": details})
    else:
        messages.append({"type": "text", "text": details})
    if pdf is not None:
        messages.append({"type": "document", "path": str(pdf)})
    return messages


# ---------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------
def build_job(
    order: Mapping[str, Any],
    *,
    image: str | None,
    waybill_path: str | None,
    job_id: str,
    images_dir: Path,
) -> tuple[dict[str, Any], list[str]]:
    """One outbox job, plus any warnings worth showing the user."""
    warnings: list[str] = []
    label = str(order.get("customer_order_no") or order.get("tracking_no") or "")

    # the order's own photo first, then each item's photo or a file named after it
    photo, photo_warning = resolve_image(image, None, images_dir)
    if photo is None:
        for item in items_of(order):
            photo, _ = resolve_image(item.get("image"), item["name"], images_dir)
            if photo is not None:
                break
    if photo_warning:
        instead = f"using {photo.name} instead" if photo is not None else "sending text instead"
        warnings.append(f"{label}: {photo_warning} - {instead}")

    pdf = Path(waybill_path) if waybill_path else None
    if pdf is not None and not pdf.is_file():
        warnings.append(f"{label}: waybill PDF missing, not attached ({pdf})")
        pdf = None

    job = {
        "version": JOB_VERSION,
        "id": job_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "order_no": order.get("customer_order_no"),
        "tracking_no": order.get("tracking_no"),
        "messages": build_messages(order, photo, pdf),
        # The service records progress here so a retry resumes after the last
        # message that went through, instead of posting duplicates.
        "sent": 0,
        "attempts": 0,
        "last_error": None,
    }
    return job, warnings


def enqueue(job: Mapping[str, Any], outbox: Path) -> Path:
    """Write *job* atomically: the service never sees a half-written file."""
    outbox.mkdir(parents=True, exist_ok=True)
    final = outbox / f"{job['id']}.json"
    temp = outbox / f".{job['id']}.tmp"
    temp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, final)
    return final


def job_id(stamp: str, index: int, tracking_no: str | None) -> str:
    """Sortable, so the service posts orders in the order they were created."""
    return f"{stamp}-{index:05d}-{tracking_no or 'order'}"


def queue_orders(entries: Iterable[tuple[Mapping[str, Any], str | None, str | None]]) -> QueueResult:
    """Queue ``(order fields, image, waybill_path)`` entries.

    Never raises: a failure to queue is reported as a warning, because the
    orders already exist and must not be rolled back over a notification.
    """
    settings = get_settings()
    result = QueueResult()
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S%f")

    for index, (order, image, waybill_path) in enumerate(entries):
        label = str(order.get("customer_order_no") or order.get("tracking_no") or "")
        try:
            job, warnings = build_job(
                order,
                image=image,
                waybill_path=waybill_path,
                job_id=job_id(stamp, index, order.get("tracking_no")),
                images_dir=settings.whatsapp_images_path,
            )
            enqueue(job, settings.whatsapp_outbox_path)
        except Exception as exc:                  # noqa: BLE001
            log.exception("could not queue WhatsApp job for %s", label)
            result.warnings.append(
                f"{label}: not queued for WhatsApp ({type(exc).__name__}: {exc})"
            )
            continue
        result.queued += 1
        result.warnings.extend(warnings)
    return result


def queue_created_rows(rows: Iterable[Any]) -> QueueResult:
    """Queue every freshly created pipeline row, if WhatsApp is enabled."""
    if not get_settings().whatsapp_enabled:
        return QueueResult()
    entries = [
        (
            {**row.enriched, "tracking_no": row.tracking_no,
             "customer_order_no": row.order_no},
            row.payload.get("image") or None,
            row.waybill_path,
        )
        for row in rows
        if row.status == "created"
    ]
    return queue_orders(entries) if entries else QueueResult()
