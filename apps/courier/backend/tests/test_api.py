"""HTTP-level tests for the API contract (spec section 12).

Driven in-process through ASGI, so no server needs to be running - but they do
need PostgreSQL and skip themselves without it.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import requires_db

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
TEMPLATE = SAMPLES / "bulk_orders_template.csv"

pytestmark = [requires_db, pytest.mark.db]

ORDER = {
    "receiver_name": "Nalini Sinnasamy",
    "receiver_phone": "0123456794",
    "receiver_postcode": "43000",
    "receiver_city": "Kajang",
    "receiver_state": "Selangor",
    "receiver_address": "F-08-07, Residensi Idaman Abadi, Persiaran Tropicana Heights",
    "goods_name": "Chiffon Georgette Party Set with Farshi Palazzo",
    "item_variant": "M",
    "actual_weight": "0.6",
    "customer_order_no": "API-0001",
}


@pytest.fixture
async def client(session, tmp_out, logged_in_admin):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        c.out_dir = str(tmp_out)          # type: ignore[attr-defined]
        yield c


class TestMeta:
    async def test_health(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    async def test_openapi_documents_every_contract_path(self, client):
        paths = (await client.get("/openapi.json")).json()["paths"]
        for expected in [
            "/api/v1/settings/sender",
            "/api/v1/orders",
            "/api/v1/orders/{tracking_no}",
            "/api/v1/bulk/upload",
            "/api/v1/bulk/{batch_id}/commit",
            "/api/v1/bulk/{batch_id}/progress",
            "/api/v1/bulk/{batch_id}/manifest.csv",
            "/api/v1/bulk/{batch_id}/rows",
            "/api/v1/waybills/{tracking_no}.pdf",
            "/api/v1/waybills/batch/{batch_id}.zip",
            "/api/v1/templates/bulk.csv",
        ]:
            assert expected in paths, f"{expected} missing from the API"


class TestSenderProfile:
    async def test_returns_the_seeded_profile(self, client):
        body = (await client.get("/api/v1/settings/sender")).json()
        assert body["account_code"] == "JTMY027288"
        assert body["company_name"] == "LINKED INTERNATIONAL SDN BHD"
        assert body["postcode"] == "43300"

    async def test_update_round_trips(self, client):
        original = (await client.get("/api/v1/settings/sender")).json()
        response = await client.put(
            "/api/v1/settings/sender",
            json={**original, "address": "NEW ADDRESS, 43300"},
        )
        assert response.status_code == 200
        assert response.json()["address"] == "NEW ADDRESS, 43300"
        await client.put("/api/v1/settings/sender", json=original)


class TestNormalOrder:
    async def test_create_returns_carrier_identifiers(self, client):
        response = await client.post(
            "/api/v1/orders", json={**ORDER, "output_dir": client.out_dir}
        )
        assert response.status_code == 201
        body = response.json()
        assert body["tracking_no"].startswith("63")
        assert len(body["tracking_no"]) == 12
        assert body["sortation_code"] == "300-K41-SG496"
        assert body["route_code"] == "E03"
        assert body["waybill_url"].endswith(".pdf")
        assert float(body["freight_fee"]) > 0

    async def test_writes_the_waybill(self, client, tmp_out):
        await client.post("/api/v1/orders", json={**ORDER, "output_dir": client.out_dir})
        assert (tmp_out / "OrderNo_API-0001.pdf").exists()

    async def test_order_has_no_batch(self, client):
        body = (
            await client.post(
                "/api/v1/orders", json={**ORDER, "output_dir": client.out_dir}
            )
        ).json()
        assert body["order"]["batch_id"] is None

    async def test_duplicate_returns_problem_json(self, client):
        payload = {**ORDER, "output_dir": client.out_dir}
        await client.post("/api/v1/orders", json=payload)
        response = await client.post("/api/v1/orders", json=payload)
        assert response.status_code == 409
        assert response.headers["content-type"].startswith("application/problem+json")
        body = response.json()
        assert body["type"] == "urn:jt:duplicate-order"
        assert body["status"] == 409
        assert "already exists" in body["detail"]

    async def test_validation_error_is_problem_json_with_row_errors(self, client):
        response = await client.post(
            "/api/v1/orders", json={**ORDER, "receiver_postcode": "abc"}
        )
        assert response.status_code == 422
        body = response.json()
        assert body["title"] == "Validation failed"
        assert body["row_errors"]

    async def test_unknown_postcode_is_rejected(self, client):
        response = await client.post(
            "/api/v1/orders",
            json={**ORDER, "receiver_postcode": "04000", "output_dir": client.out_dir},
        )
        assert response.status_code == 422
        assert "not a recognised" in response.json()["detail"]

    async def test_get_by_tracking_number(self, client):
        created = (
            await client.post(
                "/api/v1/orders", json={**ORDER, "output_dir": client.out_dir}
            )
        ).json()
        response = await client.get(f"/api/v1/orders/{created['tracking_no']}")
        assert response.status_code == 200
        assert response.json()["customer_order_no"] == "API-0001"

    async def test_missing_order_is_404_problem(self, client):
        response = await client.get("/api/v1/orders/639999999999")
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/problem+json")

    async def test_listing_paginates(self, client):
        for index in range(3):
            await client.post(
                "/api/v1/orders",
                json={
                    **ORDER,
                    "customer_order_no": f"LIST-{index}",
                    "output_dir": client.out_dir,
                },
            )
        body = (await client.get("/api/v1/orders?page=1&size=2")).json()
        assert body["total"] == 3
        assert body["pages"] == 2
        assert len(body["items"]) == 2

    async def test_search_filters(self, client):
        await client.post(
            "/api/v1/orders",
            json={**ORDER, "customer_order_no": "FINDME", "output_dir": client.out_dir},
        )
        body = (await client.get("/api/v1/orders?q=FINDME")).json()
        assert body["total"] == 1


class TestQuote:
    async def test_prices_a_draft_without_creating_anything(self, client):
        response = await client.post(
            "/api/v1/orders/quote",
            json={
                "receiver_postcode": "43000",
                "actual_weight": "0.6",
                "length_cm": "40",
                "width_cm": "30",
                "height_cm": "20",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["volumetric_weight"] == "4.00"
        assert body["chargeable_weight"] == "4.0"
        assert body["service_scope"] == "SAME CITY"

        listing = (await client.get("/api/v1/orders")).json()
        assert listing["total"] == 0


class TestWaybillDelivery:
    async def test_streams_the_pdf(self, client):
        created = (
            await client.post(
                "/api/v1/orders", json={**ORDER, "output_dir": client.out_dir}
            )
        ).json()
        response = await client.get(f"/api/v1/waybills/{created['tracking_no']}.pdf")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")

    async def test_regenerates_a_deleted_file_identically(self, client, tmp_out):
        created = (
            await client.post(
                "/api/v1/orders", json={**ORDER, "output_dir": client.out_dir}
            )
        ).json()
        pdf = tmp_out / "OrderNo_API-0001.pdf"
        original = pdf.read_bytes()
        pdf.unlink()

        response = await client.get(f"/api/v1/waybills/{created['tracking_no']}.pdf")
        assert response.status_code == 200
        assert response.content == original


class TestBulk:
    async def test_output_dir_validation_rejects_relative_paths(self, client):
        body = (
            await client.post(
                "/api/v1/bulk/check-output-dir", json={"output_dir": "relative/nope"}
            )
        ).json()
        assert body["ok"] is False
        assert "absolute" in body["message"]

    async def test_output_dir_validation_accepts_a_real_folder(self, client, tmp_out):
        body = (
            await client.post(
                "/api/v1/bulk/check-output-dir", json={"output_dir": str(tmp_out)}
            )
        ).json()
        assert body["ok"] is True
        assert body["resolved"]

    async def _upload(self, client):
        with TEMPLATE.open("rb") as fh:
            return await client.post(
                "/api/v1/bulk/upload",
                files={"file": (TEMPLATE.name, fh, "text/csv")},
            )

    async def test_upload_stages_rows_without_creating_orders(self, client):
        response = await self._upload(client)
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 3
        assert body["ok"] == 3
        assert body["errors"] == 0
        assert len(body["rows"]) == 3
        assert body["rows"][0]["status"] == "ok"

        listing = (await client.get("/api/v1/orders")).json()
        assert listing["total"] == 0

    async def test_commit_creates_orders_and_waybills(self, client, tmp_out):
        batch_id = (await self._upload(client)).json()["batch_id"]
        response = await client.post(
            f"/api/v1/bulk/{batch_id}/commit", json={"output_dir": str(tmp_out)}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["created"] == 3
        assert body["failed"] == 0
        assert len(list(tmp_out.glob("OrderNo_*.pdf"))) == 3

    async def test_recommit_reports_duplicates(self, client, tmp_out):
        batch_id = (await self._upload(client)).json()["batch_id"]
        await client.post(
            f"/api/v1/bulk/{batch_id}/commit", json={"output_dir": str(tmp_out)}
        )
        second = (await self._upload(client)).json()["batch_id"]
        body = (
            await client.post(
                f"/api/v1/bulk/{second}/commit", json={"output_dir": str(tmp_out)}
            )
        ).json()
        assert body["created"] == 0
        assert body["duplicates"] == 3

    async def test_manifest_and_zip_are_served(self, client, tmp_out):
        batch_id = (await self._upload(client)).json()["batch_id"]
        await client.post(
            f"/api/v1/bulk/{batch_id}/commit", json={"output_dir": str(tmp_out)}
        )

        manifest = await client.get(f"/api/v1/bulk/{batch_id}/manifest.csv")
        assert manifest.status_code == 200
        assert b"order_no,tracking_no" in manifest.content

        archive = await client.get(f"/api/v1/waybills/batch/{batch_id}.zip")
        assert archive.status_code == 200
        assert archive.content.startswith(b"PK")

    async def test_delete_staged_rows(self, client):
        body = (await self._upload(client)).json()
        batch_id = body["batch_id"]
        ids = [row["id"] for row in body["rows"][:2]]
        response = await client.request(
            "DELETE", f"/api/v1/bulk/{batch_id}/rows", json={"row_ids": ids}
        )
        assert response.status_code == 200
        assert response.json()["deleted"] == 2

        remaining = (await client.get(f"/api/v1/bulk/{batch_id}/rows")).json()
        assert len(remaining) == 1

    async def test_commit_only_selected_rows(self, client, tmp_out):
        body = (await self._upload(client)).json()
        batch_id = body["batch_id"]
        chosen = [body["rows"][0]["id"]]
        result = (
            await client.post(
                f"/api/v1/bulk/{batch_id}/commit",
                json={"output_dir": str(tmp_out), "row_ids": chosen},
            )
        ).json()
        assert result["created"] == 1
        assert len(list(tmp_out.glob("OrderNo_*.pdf"))) == 1

    async def test_bad_output_dir_blocks_the_run(self, client):
        batch_id = (await self._upload(client)).json()["batch_id"]
        response = await client.post(
            f"/api/v1/bulk/{batch_id}/commit", json={"output_dir": "not/absolute"}
        )
        assert response.status_code == 400
        assert response.json()["type"] == "urn:jt:output-dir"

        listing = (await client.get("/api/v1/orders")).json()
        assert listing["total"] == 0

    async def test_progress_snapshot(self, client, tmp_out):
        batch_id = (await self._upload(client)).json()["batch_id"]
        await client.post(
            f"/api/v1/bulk/{batch_id}/commit", json={"output_dir": str(tmp_out)}
        )
        response = await client.get(f"/api/v1/bulk/{batch_id}/progress?stream=false")
        assert response.status_code == 200
        assert "data:" in response.text
        assert '"status": "done"' in response.text

    async def test_a_csv_missing_required_columns_is_rejected(self, client):
        bad = b"foo,bar\n1,2\n"
        response = await client.post(
            "/api/v1/bulk/upload", files={"file": ("bad.csv", bad, "text/csv")}
        )
        assert response.status_code == 422
        assert response.json()["type"] == "urn:jt:bad-csv"


class TestTemplate:
    async def test_template_download(self, client):
        response = await client.get("/api/v1/templates/bulk.csv")
        assert response.status_code == 200
        assert response.content.splitlines()[0].decode().startswith("order_no,")
