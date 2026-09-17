"""The admin calendar: months and days in Malaysia time."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.errors import Problem
from app.api.v1.admin import day_bounds, month_bounds
from app.core import trace
from app.main import app
from tests.conftest import requires_db


class TestBounds:
    def test_a_month_runs_from_the_first_to_the_first_malaysia_time(self):
        start, end = month_bounds("2026-09")
        assert (start, end) == (
            datetime(2026, 9, 1, tzinfo=trace.MYT),
            datetime(2026, 10, 1, tzinfo=trace.MYT),
        )
        # 1 September in Malaysia starts at 16:00 UTC on 31 August
        assert start.astimezone(timezone.utc) == datetime(2026, 8, 31, 16, tzinfo=timezone.utc)

    def test_december_ends_in_january(self):
        assert month_bounds("2026-12")[1] == datetime(2027, 1, 1, tzinfo=trace.MYT)

    def test_february_in_a_leap_year(self):
        start, end = month_bounds("2028-02")
        assert (end - start) == timedelta(days=29)

    @pytest.mark.parametrize("month", ["2026", "2026-13", "September", ""])
    def test_a_month_that_is_not_one_is_refused(self, month):
        with pytest.raises(Problem):
            month_bounds(month)

    def test_a_day_is_midnight_to_midnight(self):
        start, end = day_bounds(date(2026, 9, 17))
        assert start == datetime(2026, 9, 17, tzinfo=trace.MYT)
        assert end - start == timedelta(days=1)


class TestWhoMaySeeIt:
    async def test_the_calendar_is_for_the_admin(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/admin/calendar")).status_code == 401


@requires_db
@pytest.mark.db
class TestCalendarApi:
    @pytest.fixture
    async def client(self, session, tmp_out, logged_in_admin):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            c.out_dir = str(tmp_out)      # type: ignore[attr-defined]
            yield c

    async def test_every_day_of_the_month_is_listed(self, client):
        response = await client.get("/api/v1/admin/calendar?month=2026-02")
        body = response.json()
        assert response.status_code == 200
        assert [d["day"] for d in body["days"]][:2] == ["2026-02-01", "2026-02-02"]
        assert len(body["days"]) == 28 and body["total_orders"] == 0

    async def test_a_bad_month_is_refused(self, client):
        assert (await client.get("/api/v1/admin/calendar?month=2026-9")).status_code == 422
