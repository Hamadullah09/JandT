"""Track & trace, the admin portal and the zip code check, over HTTP.

Needs the separate test database (see conftest.py) and skips without it.
"""
from __future__ import annotations

import csv
import io

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.main import app
from tests.conftest import requires_db

pytestmark = [requires_db, pytest.mark.db]

ORDER = {
    "receiver_name": "Nur Aisyah Rahman",
    "receiver_phone": "0171234567",
    "receiver_postcode": "47100",
    "receiver_address": "12 Jalan Contoh 3, Taman Contoh",
    "goods_name": "Chiffon Gown",
    "item_variant": "Red / M",
    "actual_weight": "0.8",
    "customer_order_no": "TRACK-0001",
}


@pytest.fixture
async def client(session, tmp_out, logged_in_admin):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        c.out_dir = str(tmp_out)          # type: ignore[attr-defined]
        yield c


async def create(client, **changes) -> str:
    response = await client.post(
        "/api/v1/orders", json={**ORDER, **changes, "output_dir": client.out_dir}
    )
    assert response.status_code == 201, response.text
    return response.json()["tracking_no"]


async def update(client, tracking_nos, event_type, **extra):
    response = await client.post(
        "/api/v1/tracking/events",
        json={"tracking_nos": tracking_nos, "event_type": event_type, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestZipCode:
    async def test_a_mismatched_city_is_refused_and_nothing_is_created(self, client):
        response = await client.post(
            "/api/v1/orders",
            json={**ORDER, "receiver_city": "Kajang", "output_dir": client.out_dir},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == (
            "Zip code does not match the city: 47100 belongs to Puchong, not Kajang."
        )
        listed = (await client.get("/api/v1/admin/orders")).json()
        assert listed["total"] == 0

    async def test_a_blank_city_is_filled_from_the_post_office_list(self, client):
        tracking_no = await create(client)
        order = (await client.get(f"/api/v1/orders/{tracking_no}")).json()
        assert (order["receiver_city"], order["receiver_state"]) == ("Puchong", "Selangor")

    async def test_parse_and_check_endpoints(self, client):
        parsed = (
            await client.post(
                "/api/v1/address/parse",
                json={"text": "Tan Mei Ling 0123456789 No. 1, Jalan Contoh 1, 47100 Kajang, Selangor"},
            )
        ).json()
        assert (parsed["phone"], parsed["city"], parsed["check"]["ok"]) == ("0123456789", "Kajang", False)
        checked = (
            await client.post("/api/v1/address/check", json={"postcode": "47810", "state": "Selangor"})
        ).json()
        assert (checked["ok"], checked["city"]) == (True, "Petaling Jaya")


class TestTracking:
    async def test_a_new_order_is_order_created(self, client):
        tracking_no = await create(client)
        [result] = (await client.get(f"/api/v1/tracking?awb={tracking_no}")).json()
        assert (result["found"], result["status"], result["status_label"]) == (
            True, "CREATED", "Order Created"
        )
        assert [e["label"] for day in result["days"] for e in day["events"]] == ["Order Created"]

    async def test_scans_make_the_journey_newest_first(self, client):
        tracking_no = await create(client)
        await update(client, [tracking_no], "PICKED_UP",
                     location="Drop Point PDP T.L PERDANA 216", occurred_at="2026-09-17T14:30")
        await update(client, [tracking_no], "DEPARTURE",
                     location="Transit Center SHAHALAM GATEWAY", occurred_at="2026-09-17T17:30")

        [result] = (await client.get(f"/api/v1/tracking?awb={tracking_no}")).json()
        assert result["status"] == "IN_TRANSIT"
        assert [s["reached"] for s in result["steps"]] == [True, True, False, False]
        events = [e for day in result["days"] for e in day["events"]]
        assert [e["label"] for e in events] == ["On the Way", "Picked Up", "Order Created"]
        assert events[0]["time_label"] == "05:30 PM"
        assert events[0]["description"] == "The parcel has left Transit Center SHAHALAM GATEWAY"
        # the public page never shows who the parcel is for
        assert "Nur Aisyah" not in str(result)

    async def test_several_waybills_and_unknown_ones(self, client):
        tracking_no = await create(client)
        results = (await client.get(f"/api/v1/tracking?awb={tracking_no},000000000000")).json()
        assert [(r["tracking_no"], r["found"]) for r in results] == [
            (tracking_no, True), ("000000000000", False)
        ]
        too_many = ",".join(str(n) for n in range(11))
        assert (await client.get(f"/api/v1/tracking?awb={too_many}")).status_code == 400

    async def test_deleting_a_mistake_puts_the_status_back(self, client):
        tracking_no = await create(client)
        await update(client, [tracking_no], "PICKED_UP")
        await update(client, [tracking_no], "DELIVERED")
        detail = (await client.get(f"/api/v1/admin/orders/{tracking_no}")).json()
        delivered = next(e for e in detail["events"] if e["event_type"] == "DELIVERED")

        assert (await client.delete(f"/api/v1/tracking/events/{delivered['id']}")).status_code == 204
        detail = (await client.get(f"/api/v1/admin/orders/{tracking_no}")).json()
        assert detail["order"]["tracking_status"] == "PICKED_UP"

    async def test_an_unknown_status_is_refused(self, client):
        tracking_no = await create(client)
        response = await client.post(
            "/api/v1/tracking/events", json={"tracking_nos": [tracking_no], "event_type": "LOST"}
        )
        assert response.status_code == 422


class TestAdmin:
    async def test_counts_filters_and_bulk_updates(self, client):
        first = await create(client, customer_order_no="TRACK-0001")
        second = await create(client, customer_order_no="TRACK-0002")
        third = await create(client, customer_order_no="TRACK-0003")
        result = await update(client, [first, second, "000000000000"], "DELIVERED")
        assert (result["updated"], result["not_found"]) == (2, ["000000000000"])

        page = (await client.get("/api/v1/admin/orders")).json()
        assert page["counts"]["DELIVERED"] == 2 and page["counts"]["CREATED"] == 1
        assert (page["total"], page["today"]) == (3, 3)
        assert [o["tracking_no"] for o in page["items"]] == [third, second, first]   # newest first
        assert page["items"][0]["tracking_url"].endswith(f"/tracking/{third}")

        delivered = (await client.get("/api/v1/admin/orders?status=DELIVERED")).json()
        assert {o["tracking_no"] for o in delivered["items"]} == {first, second}
        found = (await client.get("/api/v1/admin/orders?q=TRACK-0003")).json()
        assert [o["tracking_no"] for o in found["items"]] == [third]

    async def test_orders_are_listed_by_date_not_by_when_they_were_entered(self, client, session):
        today = await create(client, customer_order_no="TRACK-0001")
        last_week = await create(client, customer_order_no="TRACK-0002")   # entered later...
        await session.execute(                                                # ...for an older date
            text("UPDATE orders SET created_at = created_at - interval '7 days' WHERE tracking_no = :no"),
            {"no": last_week},
        )
        await session.commit()

        page = (await client.get("/api/v1/admin/orders")).json()
        assert [o["tracking_no"] for o in page["items"]] == [today, last_week]
        mine = (await client.get("/api/v1/orders")).json()
        assert [o["tracking_no"] for o in mine["items"]] == [today, last_week]
        export = await client.get("/api/v1/admin/orders/export.csv")
        rows = list(csv.DictReader(io.StringIO(export.content.decode("utf-8-sig"))))
        assert [row["Tracking Link"].rsplit("/", 1)[-1] for row in rows] == [today, last_week]

    async def test_export_links_every_tracking_number(self, client):
        tracking_no = await create(client)
        response = await client.get("/api/v1/admin/orders/export.csv")
        assert response.status_code == 200
        assert "attachment" in response.headers["content-disposition"]
        rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
        assert len(rows) == 1
        assert rows[0]["Tracking Number"].startswith("=HYPERLINK(")
        assert rows[0]["Tracking Link"].endswith(f"/tracking/{tracking_no}")
