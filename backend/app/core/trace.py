"""Track & trace: where a parcel is, as J&T's tracking page shows it.

J&T's own page cannot be read automatically (it asks for a slide puzzle
first), so the statuses live here: the admin portal records each scan as a
tracking event, and the tracking page shows them the way jtexpress.my does.

An event is one scan - ``Departure`` from a transit center, ``Delivered`` - and
a parcel's status is the status of its latest scan:

    CREATED -> PICKED_UP -> IN_TRANSIT -> ON_DELIVERY -> DELIVERED
                                                      \\-> RETURNED

Times are Malaysia time (UTC+8, no daylight saving), like J&T's page.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MYT = timezone(timedelta(hours=8), "MYT")

CREATED = "CREATED"
PICKED_UP = "PICKED_UP"
IN_TRANSIT = "IN_TRANSIT"
ON_DELIVERY = "ON_DELIVERY"
DELIVERED = "DELIVERED"
RETURNED = "RETURNED"

STATUSES = (CREATED, PICKED_UP, IN_TRANSIT, ON_DELIVERY, DELIVERED, RETURNED)
STATUS_LABELS = {
    CREATED: "Order Created",
    PICKED_UP: "Picked Up",
    IN_TRANSIT: "In Transit",
    ON_DELIVERY: "On Delivery",
    DELIVERED: "Delivered",
    RETURNED: "Returned",
}


@dataclass(frozen=True, slots=True)
class EventType:
    code: str
    #: as J&T's page prints it
    label: str
    #: the parcel's status after this scan
    status: str
    #: the description J&T shows; ``{location}`` is the scan's place
    template: str
    #: the description when no place was given
    without_location: str


EVENT_TYPES: dict[str, EventType] = {
    event.code: event
    for event in (
        EventType("PICKED_UP", "Picked Up", PICKED_UP,
                  "Package is received by J&T", "Package is received by J&T"),
        EventType("DEPARTURE", "Departure", IN_TRANSIT,
                  "Package is departing from 【{location}】", "Package is in transit"),
        EventType("DC_ARRIVAL", "Dc Arrival", IN_TRANSIT,
                  "Package is arrived to 【{location}】", "Package is arrived to the transit center"),
        EventType("DP_ARRIVAL", "Dp Arrival", IN_TRANSIT,
                  "Package is arrived to 【{location}】", "Package is arrived to the drop point"),
        EventType("ON_DELIVERY", "On Delivery", ON_DELIVERY,
                  "The package is out for delivery", "The package is out for delivery"),
        EventType("DELIVERED", "Delivered", DELIVERED,
                  "Package is received by customer", "Package is received by customer"),
        EventType("RETURNED", "Returned", RETURNED,
                  "Package is returned to the sender", "Package is returned to the sender"),
    )
}

#: the scan recorded when the dashboard marks parcels with a status in one click
QUICK_EVENT = {
    PICKED_UP: "PICKED_UP",
    IN_TRANSIT: "DEPARTURE",
    ON_DELIVERY: "ON_DELIVERY",
    DELIVERED: "DELIVERED",
    RETURNED: "RETURNED",
}

#: the order row itself, shown as the first line of every timeline
CREATED_LABEL = "Order Created"
CREATED_DESCRIPTION = "Order is created, waiting for J&T to pick up the package"


class TraceError(ValueError):
    pass


def event_type(code: str) -> EventType:
    try:
        return EVENT_TYPES[code]
    except KeyError:
        raise TraceError(
            f"unknown status update {code!r} - use one of {', '.join(EVENT_TYPES)}"
        ) from None


def describe(code: str, location: str | None) -> str:
    """The description J&T prints for a scan at *location*."""
    kind = event_type(code)
    place = (location or "").strip()
    return kind.template.format(location=place) if place else kind.without_location


def as_myt(moment: datetime) -> datetime:
    """A naive time is taken as Malaysia time - what the admin typed."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=MYT)
    return moment.astimezone(MYT)


@dataclass(frozen=True, slots=True)
class Scan:
    """What the status is computed from: one stored event."""

    id: int
    code: str
    occurred_at: datetime


def latest(scans: Iterable[Scan]) -> Scan | None:
    """The scan that decides the status: the latest time, then the latest entry."""
    return max(scans, key=lambda scan: (scan.occurred_at, scan.id), default=None)


def status_of(scans: Iterable[Scan]) -> str:
    last = latest(scans)
    return EVENT_TYPES[last.code].status if last else CREATED


def date_label(moment: datetime) -> str:
    """``2026-08-27, Thursday``"""
    local = as_myt(moment)
    return f"{local:%Y-%m-%d}, {local:%A}"


def time_label(moment: datetime) -> str:
    """``04:45 PM``"""
    return f"{as_myt(moment):%I:%M %p}"


# ---------------------------------------------------------------------------
# the stage icons across the top of the tracking card
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Step:
    key: str
    label: str
    reached: bool


_STEP_REACHED = {
    CREATED: 0,
    PICKED_UP: 1,
    IN_TRANSIT: 2,
    ON_DELIVERY: 3,
    DELIVERED: 4,
    RETURNED: 4,
}


def steps(status: str) -> list[Step]:
    """Picked Up, In Transit, Delivery, then Delivered - or Returned."""
    done = _STEP_REACHED.get(status, 0)
    last = ("returned", "Returned") if status == RETURNED else ("delivered", "Delivered")
    shape = [("picked_up", "Picked Up"), ("in_transit", "In Transit"), ("delivery", "Delivery"), last]
    return [Step(key, label, index < done) for index, (key, label) in enumerate(shape)]
