"""The Normal Order page's Chargeable Information: fee breakdown and COD rules."""
from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import NormalOrderIn
from app.core import pricing
from app.core.pricing import fee_breakdown, freight_fee

D = Decimal


@pytest.fixture
def portal_rates(monkeypatch):
    """A rate card set to what the user's J&T portal screenshot shows."""
    rates = {
        "zones": {"WEST": {"first_kg": 5.00, "extra_kg": 2.00}},
        "default_zone": "WEST",
        "surcharges": {"cod_percent": 2.0, "cod_min": 4.00, "sst_percent": 6.0},
    }
    monkeypatch.setattr(pricing, "get_rates", lambda: rates)
    return rates


class TestFeeBreakdown:
    def test_reproduces_the_j_and_t_portal_screenshot(self, portal_rates):
        # screenshot: COD 77.40 -> Base 5 / Base Price Tax 0.3 / COD Fee 4.00 /
        # COD Tax 0.24 / COD Total Handling Fee 4.24 / Total Shipping Fee 5.00
        b = fee_breakdown("WEST", D("1.0"), cod_amount=D("77.40"))
        assert (b.base_shipping_fee, b.base_price_tax) == (D("5.00"), D("0.30"))
        assert (b.cod_fee, b.cod_tax, b.cod_handling_fee) == (D("4.00"), D("0.24"), D("4.24"))
        assert b.total_shipping_fee == D("5.00")
        assert (b.discounted_shipping_fee, b.discounted_tax) == (D("0.00"), D("0.00"))

    def test_total_sst_is_every_tax_together(self, portal_rates):
        b = fee_breakdown("WEST", D("1.0"), cod_amount=D("77.40"))
        assert b.total_sst == D("0.54")

    def test_no_cod_means_no_cod_charges(self, portal_rates):
        b = fee_breakdown("WEST", D("1.0"))
        assert (b.cod_fee, b.cod_tax, b.cod_handling_fee) == (D("0.00"), D("0.00"), D("0.00"))
        assert b.total_sst == D("0.30")

    def test_insurance_stays_blank_unless_offered(self, portal_rates):
        assert fee_breakdown("WEST", D("1.0"), item_value=D("500")).insurance_fee is None

    def test_insurance_when_offered_is_taxed_too(self, portal_rates):
        portal_rates["surcharges"].update(insurance_percent=1.0, insurance_min=2.00)
        b = fee_breakdown("WEST", D("1.0"), item_value=D("500"))
        assert b.insurance_fee == D("5.00")
        assert b.total_sst == D("0.30") + D("0.30")
        assert fee_breakdown("WEST", D("1.0"), item_value=D("50")).insurance_fee == D("2.00")

    def test_the_stored_freight_fee_is_unchanged(self, portal_rates):
        # orders.freight_fee keeps meaning shipping + COD fee, before tax
        assert freight_fee("WEST", D("1.0"), cod_amount=D("77.40")) == D("9.00")

    def test_the_real_rate_card_matches_the_j_and_t_portal(self):
        # config/rates.yml, not a test rate card: the user asked for the same
        # prices as their J&T portal, whose screenshot shows exactly these
        b = fee_breakdown("SAME CITY", D("1.0"), cod_amount=D("77.40"))
        assert (b.base_shipping_fee, b.base_price_tax) == (D("5.00"), D("0.30"))
        assert (b.cod_fee, b.cod_tax, b.cod_handling_fee) == (D("4.00"), D("0.24"), D("4.24"))
        assert (b.total_shipping_fee, b.total_sst) == (D("5.00"), D("0.54"))


class TestCodOnTheNormalOrderPage:
    BASE = dict(
        receiver_name="Tan Mei Ling", receiver_phone="0123456789", receiver_postcode="47810",
        receiver_address="No. 1, Jalan Contoh 1", goods_name="Maxi Chic", actual_weight="1.2",
        customer_order_no="12820",
    )

    def test_cod_yes_needs_an_amount(self):
        with pytest.raises(ValidationError, match="COD Amount must be more than 0"):
            NormalOrderIn(**self.BASE, order_payment_type="COD", cod_amount="0")

    def test_cod_yes_keeps_the_amount(self):
        order = NormalOrderIn(**self.BASE, order_payment_type="COD", cod_amount="77.40")
        assert order.cod_amount == D("77.40")

    def test_cod_no_collects_nothing_even_if_an_amount_slipped_through(self):
        order = NormalOrderIn(**self.BASE, order_payment_type="PREPAID", cod_amount="77.40")
        assert order.cod_amount == D("0")

    def test_service_type_defaults_to_pick_up_and_is_checked(self):
        assert NormalOrderIn(**self.BASE).service_mode == "PICK_UP"
        with pytest.raises(ValidationError):
            NormalOrderIn(**self.BASE, service_mode="TELEPORT")


class TestCustomerOrderNumberIsRequired:
    BASE = TestCodOnTheNormalOrderPage.BASE

    def test_an_order_without_a_number_is_refused(self):
        with pytest.raises(ValidationError):
            NormalOrderIn(**{k: v for k, v in self.BASE.items() if k != "customer_order_no"})

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_a_blank_number_is_refused(self, blank):
        with pytest.raises(ValidationError, match="Customer Order Number is required"):
            NormalOrderIn(**{**self.BASE, "customer_order_no": blank})

    def test_the_number_is_trimmed(self):
        assert NormalOrderIn(**{**self.BASE, "customer_order_no": " 12820 "}).customer_order_no == "12820"

    def test_longer_than_the_database_column_is_refused_not_a_crash(self):
        with pytest.raises(ValidationError):
            NormalOrderIn(**{**self.BASE, "customer_order_no": "X" * 65})
        assert NormalOrderIn(**{**self.BASE, "customer_order_no": "X" * 64})
