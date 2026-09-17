"""Smart address filling and the postcode check for the Normal Order page."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.schemas import AddressCheckIn, AddressCheckOut, AddressParseIn, AddressParseOut
from app.core import address

router = APIRouter(prefix="/address", tags=["address"])


def check_out(result: address.AddressCheck) -> AddressCheckOut:
    return AddressCheckOut(
        postcode=result.postcode,
        known=result.known,
        state=result.state,
        city=result.city,
        cities=result.cities,
        ok=result.ok,
        field=result.field,
        message=result.message,
        notice=result.notice,
        suggestions=result.suggestions,
        suggestions_total=result.suggestions_total,
        suggestions_for=result.suggestions_for,
    )


@router.post("/check", response_model=AddressCheckOut)
async def check_address(body: AddressCheckIn) -> AddressCheckOut:
    """The postcode's state and town, and whether the given state and city match it."""
    return check_out(address.check(body.postcode, body.state, body.city))


@router.post("/parse", response_model=AddressParseOut)
async def parse_address(body: AddressParseIn) -> AddressParseOut:
    """Split a pasted address into the receiver fields."""
    parsed = address.parse(body.text)
    return AddressParseOut(
        name=parsed.name,
        phone=parsed.phone,
        postcode=parsed.postcode,
        city=parsed.city,
        state=parsed.state,
        address=parsed.address,
        check=check_out(parsed.check or address.check("")),
    )
