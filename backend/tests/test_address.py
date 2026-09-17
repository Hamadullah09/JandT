"""Smart address filling and the zip code check (app/core/address.py).

Addresses are made up; the postcodes, towns and states are real, because the
check is only as good as the post-office list behind it.
"""
from __future__ import annotations

import pytest

from app.api.schemas import NormalOrderIn
from app.api.v1.orders import _payload
from app.core.address import canonical_state, check, parse, town_name


class TestThePostOfficeList:
    @pytest.mark.parametrize(
        ("postcode", "city", "state"),
        [
            ("47100", "Puchong", "Selangor"),      # postcode_zone says SUNGAI BULOH
            ("47810", "Petaling Jaya", "Selangor"),
            ("43300", "Seri Kembangan", "Selangor"),
            ("11950", "Bayan Lepas", "Pulau Pinang"),
            ("50450", "Kuala Lumpur", "Kuala Lumpur"),
            ("88000", "Kota Kinabalu", "Sabah"),
        ],
    )
    def test_a_postcode_knows_its_town_and_state(self, postcode, city, state):
        result = check(postcode)
        assert (result.known, result.city, result.state, result.ok) == (True, city, state, True)

    def test_an_unknown_postcode_is_not_a_mismatch(self):
        result = check("99999", "Johor", "Kajang")
        assert (result.known, result.ok) == (False, True)

    @pytest.mark.parametrize(
        ("written", "state"),
        [
            ("Penang", "Pulau Pinang"),
            ("P. Pinang", "Pulau Pinang"),
            ("W.P. Kuala Lumpur", "Kuala Lumpur"),
            ("Wilayah Persekutuan", "Kuala Lumpur"),
            ("KL", "Kuala Lumpur"),
            ("Malacca", "Melaka"),
            ("N. Sembilan", "Negeri Sembilan"),
            ("SELANGOR/PETALING/SERI KEMBANGAN", "Selangor"),   # J&T's state picker
            ("Selangr", None),
        ],
    )
    def test_states_are_recognised_however_they_are_written(self, written, state):
        assert canonical_state(written) == state

    def test_towns_are_matched_without_regard_to_case(self):
        assert town_name("petaling jaya") == "Petaling Jaya"
        assert town_name("Kota Damansara") is None      # a locality, not a post office


class TestZipCodeDoesNotMatch:
    def test_a_state_that_is_not_the_postcodes(self):
        result = check("47100", "Johor", "")
        assert result.field == "receiver_state"
        assert result.message == "Zip code does not match the state: 47100 is in Selangor, not Johor."

    def test_a_post_office_town_that_is_not_the_postcodes(self):
        result = check("47100", "Selangor", "Kajang")
        assert result.field == "receiver_city"
        assert result.message == "Zip code does not match the city: 47100 belongs to Puchong, not Kajang."

    def test_the_state_is_reported_before_the_city(self):
        assert check("47100", "Johor", "Kajang").field == "receiver_state"

    @pytest.mark.parametrize("city", ["", "Puchong", "PUCHONG", "Bandar Puteri", "Kota Damansara"])
    def test_a_matching_town_or_an_unknown_locality_is_fine(self, city):
        # people write the neighbourhood instead of the post office all the time
        assert check("47100", "Selangor", city).ok

    def test_a_postcode_with_two_towns_accepts_either(self):
        assert check("86400", "Johor", "Parit Raja").ok
        assert check("86400", "Johor", "Batu Pahat").ok


class TestTheRightPostcodeIsSuggested:
    def test_a_postcode_from_another_town_offers_the_towns_own_postcodes(self):
        # the merchant's case: Bayan Lepas FIZ written with a George Town postcode
        result = check("10470", "Pulau Pinang", "Bayan Lepas")
        assert result.message == (
            "Zip code does not match the city: 10470 belongs to Pulau Pinang, not Bayan Lepas."
        )
        assert result.suggestions == ["11900", "11910", "11920", "11950"]
        assert (result.suggestions_total, result.suggestions_for) == (4, "Bayan Lepas, Pulau Pinang")

    def test_a_typo_puts_the_intended_postcode_first(self):
        assert check("11090", "Penang", "Bayan Lepas").suggestions[0] == "11900"
        assert check("47800", "Selangor", "Puchong").suggestions[0] == "47100"   # one digit off

    def test_the_suggestions_are_for_the_state_entered(self):
        # Serdang is a post office in both Selangor and Kedah
        selangor = check("81100", "Selangor", "Serdang")
        assert selangor.suggestions and all(code.startswith("43") for code in selangor.suggestions)
        assert selangor.suggestions_for == "Serdang, Selangor"

    def test_a_wrong_state_still_offers_the_citys_postcodes(self):
        result = check("81100", "Selangor", "Petaling Jaya")
        assert result.field == "receiver_state"
        assert len(result.suggestions) == 8 and result.suggestions_total == 93

    def test_nothing_is_offered_without_a_known_town(self):
        assert check("81100", "Selangor", "").suggestions == []
        assert check("81100", "Selangor", "Kota Damansara").suggestions == []
        # a town that is not in the state entered has no postcodes to offer there
        assert check("47100", "Selangor", "Johor Bahru").suggestions == []

    def test_a_postcode_that_does_not_exist_gets_a_notice_not_an_error(self):
        result = check("11999", "Pulau Pinang", "Bayan Lepas")
        assert (result.known, result.ok) == (False, True)
        assert result.notice == "11999 is not a postcode on the post-office list."
        assert "11950" in result.suggestions

    def test_a_correct_postcode_offers_nothing(self):
        result = check("11900", "Pulau Pinang", "Bayan Lepas")
        assert (result.ok, result.notice, result.suggestions) == (True, None, [])

    def test_a_town_named_like_its_state_is_not_repeated(self):
        assert check("50999", "", "Kuala Lumpur").suggestions_for == "Kuala Lumpur"


class TestPastedAddresses:
    def test_one_line_with_name_and_phone_first(self):
        parsed = parse(
            "Ramli Roslan 0123456789 No. 2, Jalan Subang Jaya, Damansara Utama, "
            "47400 Petaling Jaya, Selangor"
        )
        assert (parsed.name, parsed.phone, parsed.postcode) == ("Ramli Roslan", "0123456789", "47400")
        assert (parsed.city, parsed.state) == ("Petaling Jaya", "Selangor")
        assert parsed.address == "No. 2, Jalan Subang Jaya, Damansara Utama"
        assert parsed.check is not None and parsed.check.ok

    def test_whatsapp_style_lines_with_the_phone_last(self):
        parsed = parse(
            "Nur Aisyah Rahman\n12 Jalan Contoh 3, Taman Contoh\n47100 Puchong\n"
            "Selangor\nMalaysia\n+60 17-123 4567"
        )
        assert (parsed.name, parsed.phone) == ("Nur Aisyah Rahman", "0171234567")
        assert (parsed.postcode, parsed.city, parsed.state) == ("47100", "Puchong", "Selangor")
        assert parsed.address == "12 Jalan Contoh 3, Taman Contoh"

    def test_labels_are_ignored(self):
        parsed = parse(
            "Name: Siti Binti Ali\nPhone: 011-2345 6789\n"
            "Address: Lot 5, Jalan Johor, Taman Johor Jaya, 81100 Johor Bahru, Johor"
        )
        assert (parsed.name, parsed.phone) == ("Siti Binti Ali", "01123456789")
        assert (parsed.city, parsed.state) == ("Johor Bahru", "Johor")
        # "Johor" in the street is not taken for the state
        assert parsed.address == "Lot 5, Jalan Johor, Taman Johor Jaya"

    def test_address_only_fills_city_and_state(self):
        parsed = parse("F-08-07, Residensi Idaman Abadi, 43000 Kajang Selangor Malaysia")
        assert (parsed.name, parsed.phone) == ("", "")
        assert (parsed.postcode, parsed.city, parsed.state) == ("43000", "Kajang", "Selangor")
        assert parsed.address == "F-08-07, Residensi Idaman Abadi"

    def test_missing_city_and_state_come_from_the_postcode(self):
        parsed = parse("12 Jalan Contoh 3, 47100")
        assert (parsed.city, parsed.state) == ("Puchong", "Selangor")

    def test_a_locality_stays_in_the_address_and_the_city_is_the_post_office(self):
        parsed = parse("No 3 Jalan Contoh, 47810 Kota Damansara, Selangor")
        assert parsed.city == "Petaling Jaya"
        assert parsed.address == "No 3 Jalan Contoh, Kota Damansara"
        assert parsed.check is not None and parsed.check.ok

    def test_a_wrong_town_is_kept_as_written_and_reported(self):
        parsed = parse("Tan Mei Ling, 012-345 6789, No. 1, Jalan Contoh 1, 47100 Kajang, Selangor")
        assert parsed.city == "Kajang"
        assert parsed.check is not None
        assert parsed.check.message == "Zip code does not match the city: 47100 belongs to Puchong, not Kajang."

    def test_a_wrong_state_is_kept_as_written_and_reported(self):
        parsed = parse("Lee Siew Lan 0123456780 7, Jalan Contoh 2, 47100 Puchong, Johor")
        assert parsed.state == "Johor"
        assert parsed.check is not None and parsed.check.field == "receiver_state"

    def test_a_house_number_after_the_phone_is_not_part_of_it(self):
        parsed = parse("Anne Tan 0167654321 5-15-16 The Promenade, 11950 Bayan Lepas, Penang")
        assert parsed.phone == "0167654321"
        assert parsed.address == "5-15-16 The Promenade"
        assert parsed.state == "Pulau Pinang"

    def test_nothing_pasted(self):
        parsed = parse("   ")
        assert (parsed.name, parsed.postcode, parsed.address, parsed.check) == ("", "", "", None)


class TestNormalOrder:
    BASE = dict(
        receiver_name="Nur Aisyah Rahman", receiver_phone="0171234567",
        receiver_postcode="47100", receiver_address="12 Jalan Contoh 3, Taman Contoh",
        goods_name="Kurti", actual_weight="0.8", customer_order_no="12820",
    )

    def test_a_blank_city_and_state_are_filled_from_the_post_office_list(self):
        payload = _payload(NormalOrderIn(**self.BASE))
        assert (payload["receiver_city"], payload["receiver_state"]) == ("Puchong", "Selangor")

    def test_what_the_merchant_typed_is_kept(self):
        payload = _payload(NormalOrderIn(**self.BASE, receiver_city="Bandar Puteri", receiver_state="SELANGOR"))
        assert (payload["receiver_city"], payload["receiver_state"]) == ("Bandar Puteri", "SELANGOR")
