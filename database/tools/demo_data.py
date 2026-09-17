#!/usr/bin/env python3
"""Demo data for the platform: invented customers, orders and J&T parcels.

The shop's own orders carry real people's names, phone numbers and addresses.
This puts invented ones in their place, so the platform can be demonstrated,
tested and passed round a meeting room without a customer's details on screen.

What it replaces: every warehouse order, return and parcel, and every courier
order and scan. What it leaves alone: the catalogue, the garments on the
shelves, the rooms, the intakes and the accounts - the shop's own things, with
nobody's personal data in them, and what makes the screens look like a real
day's work rather than a fixture.

    python database/tools/demo_data.py --pg postgresql://... --url http://localhost:5080 --yes

Run it again whenever a demonstration needs resetting: it clears first, so
running it twice leaves the same amount of data, not twice as much.
`scripts\\platform.ps1 import-legacy` puts the shop's real data back.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import psycopg

# The shop's clock. Dates on the screen are Malaysian dates, so the demo's
# "three days ago" is three days ago in Kuala Lumpur.
MYT = timezone(timedelta(hours=8))

# --------------------------------------------------------------- the cast

# Invented people, in the shape J&T Malaysia books: a Malaysian mobile number,
# a five-digit postcode its network knows, and an address that reads like one.
# None of these are real customers; the numbers are not in use.
CUSTOMERS = [
    ("Nur Aisyah Rahman", "012-345 6789", "Petaling Jaya", "Selangor", "47810",
     "12, Jalan PJU 5/1, Kota Damansara"),
    ("Tan Wei Ling", "016-228 4471", "Bayan Lepas", "Pulau Pinang", "11950",
     "3A, Lorong Sungai Nibong 2"),
    ("Muhammad Firdaus Idris", "013-770 2214", "Shah Alam", "Selangor", "40150",
     "88, Jalan Setia Prima, Setia Alam"),
    ("Priya Devi Manickam", "017-664 9820", "Klang", "Selangor", "41100",
     "21, Jalan Mangga, Taman Sentosa"),
    ("Chong Mei Yee", "011-2765 4410", "Kuala Lumpur", "Kuala Lumpur", "50450",
     "Unit 7-2, Menara Bukit Bintang, Jalan Bukit Bintang"),
    ("Zulkifli Hassan", "019-338 5502", "Skudai", "Johor", "81300",
     "5, Jalan Pendidikan 2, Taman Universiti"),
    ("Hannah Yusof", "014-909 1123", "Ipoh", "Perak", "31400",
     "77, Jalan Raja Dr Nazrin Shah"),
    ("Ragavi Suresh", "018-221 7780", "Seri Kembangan", "Selangor", "43300",
     "16, Jalan BS 2/3, Taman Bukit Serdang"),
    ("Siti Khadijah Omar", "012-807 3390", "Kuantan", "Pahang", "26060",
     "9, Jalan Air Putih 4"),
    ("Lim Chee Keong", "016-553 0071", "Kuching", "Sarawak", "93350",
     "42, Jalan Tun Jugah"),
    ("Farah Nadia Zulkarnain", "010-442 6658", "Kota Kinabalu", "Sabah", "88450",
     "Lot 12, Taman Indah Jaya"),
    ("Arun Kumar Raj", "017-115 2284", "Melaka", "Melaka", "75350",
     "23, Jalan Merdeka, Taman Melaka Raya"),
]


@dataclass
class Order:
    """One planned order: what it is for, and how far along it is."""

    customer: int
    days_ago: int
    #: 'stock' needs garments scanned onto it, 'dropship' is sent by the supplier
    route: str = "stock"
    units: int = 1
    payment: str = "cod"
    #: how much of it has been picked: all, some, or none of the garments
    picked: str = "all"
    #: the parcel's journey, as (event, days after the order) - empty: not booked
    journey: list[tuple[str, int]] = field(default_factory=list)
    source: str = "Website"


# A fortnight of trading, ending today. The mix is deliberate: every screen in
# both modules has something on it, and nothing is at the same stage twice.
PLAN = [
    # delivered and paid for - the money screens need finished orders
    Order(0, 13, units=2, payment="paid",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 0), ("DC_ARRIVAL", 1), ("DELIVERED", 2)]),
    Order(1, 12, units=1, payment="cod",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 1), ("ON_DELIVERY", 2), ("DELIVERED", 2)]),
    Order(4, 10, units=3, payment="paid",
          journey=[("PICKED_UP", 0), ("DC_ARRIVAL", 1), ("DP_ARRIVAL", 2), ("DELIVERED", 3)]),
    Order(7, 9, route="dropship", units=1, payment="cod",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 1), ("DELIVERED", 2)]),
    # one that came back: the warehouse opens a return for it by itself
    Order(5, 8, units=1, payment="cod",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 1), ("ON_DELIVERY", 3), ("RETURNED", 4)]),
    # on the way now
    Order(2, 4, units=2, payment="cod",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 1), ("DC_ARRIVAL", 1)]),
    Order(9, 3, units=1, payment="paid",
          journey=[("PICKED_UP", 0), ("DEPARTURE", 1), ("DP_ARRIVAL", 2)]),
    Order(10, 2, route="dropship", units=2, payment="cod",
          journey=[("PICKED_UP", 0), ("ON_DELIVERY", 1)]),
    # booked yesterday and today, waiting for the van
    Order(3, 1, units=1, payment="cod", journey=[]),
    Order(8, 1, route="dropship", units=1, payment="paid", journey=[]),
    Order(11, 0, units=2, payment="cod", journey=[]),
    # still on the picking list, which is what the warehouse opens on
    Order(6, 1, units=2, picked="some"),
    Order(0, 0, units=1, picked="none"),
    Order(3, 0, units=3, picked="none"),
    Order(9, 0, units=1, picked="none", payment="paid"),
    Order(2, 0, route="dropship", units=1, picked="none", payment="paid"),
]

# --------------------------------------------- the courier's own customers

# People the shop sells to directly and posts from the portal, with no warehouse
# order behind the parcel: a WhatsApp sale, a marketplace order packed the same
# afternoon. Invented, like the rest - the postcodes are real ones J&T's network
# knows, so every one of these books and prints a genuine waybill.
COURIER_CUSTOMERS = [
    ("Wong Li Hua", "012-664 2201", "50480", "Kuala Lumpur", "Kuala Lumpur", "Unit 3-8, Jalan Sultan Ismail"),
    ("Nabila Idris", "013-228 7741", "40460", "Shah Alam", "Selangor", "14, Jalan Setia Indah, Setia Alam"),
    ("Kavitha Ramasamy", "018-770 3390", "30000", "Ipoh", "Perak", "6, Lorong Cempaka 3"),
    ("Amirah Zainal", "017-990 4412", "80100", "Johor Bahru", "Johor", "18, Jalan Kebudayaan 5"),
    ("Sharifah Nadzirah", "011-3980 2255", "46150", "Petaling Jaya", "Selangor", "7-12, Blok B, Pangsapuri Sri Melur"),
    ("Goh Wei Sheng", "016-447 9013", "47500", "Subang Jaya", "Selangor", "25, Jalan USJ 9/5Q"),
    ("Intan Marlina", "019-772 6640", "53100", "Kuala Lumpur", "Kuala Lumpur", "Blok 4-3-7, Danau Kota, Setapak"),
    ("Devi Anandan", "012-338 1197", "43200", "Cheras", "Selangor", "9, Jalan Suakasih 2, Bandar Tun Hussein Onn"),
    ("Nur Hidayah Zakaria", "014-226 8830", "10250", "George Town", "Pulau Pinang", "88-C, Jalan Burma"),
    ("Tan Sook Yee", "017-604 3321", "14000", "Bukit Mertajam", "Pulau Pinang", "12, Lorong Kenanga 4, Taman Desa"),
    ("Rosnah Abdul Karim", "013-559 7702", "70000", "Seremban", "Negeri Sembilan", "31, Jalan Dato Bandar Tunggal"),
    ("Yusra Kamaruddin", "018-119 4408", "75000", "Melaka", "Melaka", "5, Jalan Hang Jebat"),
    ("Lee Ming Hui", "016-802 5514", "57000", "Kuala Lumpur", "Kuala Lumpur", "A-15-2, Residensi Bukit Jalil"),
    ("Siti Rohana Musa", "012-771 0098", "25200", "Kuantan", "Pahang", "40, Jalan Teluk Sisek"),
    ("Aina Batrisyia", "011-2840 7761", "05100", "Alor Setar", "Kedah", "22, Jalan Tunku Ibrahim"),
    ("Hafiz Mansor", "019-445 3308", "15000", "Kota Bharu", "Kelantan", "8, Jalan Sultan Yahya Petra"),
    ("Norliza Hamid", "017-223 9945", "21100", "Kuala Terengganu", "Terengganu", "17, Jalan Sultan Zainal Abidin"),
    ("Chandrika Nair", "014-887 2216", "34000", "Taiping", "Perak", "3, Jalan Kota, Taman Tasik"),
    ("Michelle Lau", "012-909 6674", "88300", "Kota Kinabalu", "Sabah", "Lot 9, Jalan Penampang"),
    ("Sylvester Anak Jugah", "016-338 4471", "96000", "Sibu", "Sarawak", "44, Jalan Tuanku Osman"),
    ("Grace Anne Mathew", "018-660 1129", "98000", "Miri", "Sarawak", "6, Jalan Bendahara"),
    ("Fauziah Sulaiman", "013-802 7735", "68000", "Ampang", "Selangor", "19, Jalan Wawasan 4, Bandar Baru Ampang"),
    ("Khairul Anwar", "011-5533 8842", "42000", "Port Klang", "Selangor", "77, Jalan Batu Unjur 7, Bayu Perdana"),
    ("Puteri Sarah", "017-449 2260", "86000", "Kluang", "Johor", "2, Jalan Md Lazim Saim"),
    ("Low Kar Mun", "012-556 3318", "84000", "Muar", "Johor", "58, Jalan Abdullah"),
    ("Rania Iskandar", "019-227 6653", "71000", "Port Dickson", "Negeri Sembilan", "10, Jalan Pantai"),
]

# The places a scan happens, as J&T's own sheets name them.
HUBS = [
    "Shah Alam DC", "Bukit Jalil Hub", "Puchong DP", "Klang DP", "Seberang Perai Hub",
    "Ipoh DP", "Skudai DP", "Kuantan DP", "Kota Kinabalu Hub", "Kuching Hub",
]

# Where a parcel is by now, as scans: (event, days after it was booked).
JOURNEYS = {
    "created": [],
    "collected": [("PICKED_UP", 0)],
    "in_transit": [("PICKED_UP", 0), ("DEPARTURE", 1), ("DC_ARRIVAL", 1)],
    "near_home": [("PICKED_UP", 0), ("DEPARTURE", 1), ("DP_ARRIVAL", 2)],
    "out_today": [("PICKED_UP", 0), ("DEPARTURE", 1), ("ON_DELIVERY", 2)],
    "delivered": [("PICKED_UP", 0), ("DEPARTURE", 1), ("DC_ARRIVAL", 1), ("DELIVERED", 2)],
    "delivered_quick": [("PICKED_UP", 0), ("DEPARTURE", 0), ("DELIVERED", 1)],
    "delivered_slow": [("PICKED_UP", 0), ("DEPARTURE", 1), ("DC_ARRIVAL", 2), ("DP_ARRIVAL", 3), ("DELIVERED", 4)],
    "returned": [("PICKED_UP", 0), ("DEPARTURE", 1), ("ON_DELIVERY", 3), ("RETURNED", 4)],
}

# The marketplaces number their own orders; the shop's own channels share a
# sequence. It is what the "Order No." column carries.
ORDER_PREFIX = {"Shopee": "SP", "Lazada": "LZD", "TikTok Shop": "TTS", "Daraz": "DRZ"}


@dataclass
class Parcel:
    """One parcel booked in the portal, and how far along it is."""

    who: int
    days_ago: int
    source: str
    goods: str
    payment: str = "cod"
    cod: float = 0.0
    quantity: int = 1
    weight: float = 0.8
    journey: str = "created"


# Three weeks of posting, across every channel the portal counts. The oldest are
# finished, this week's are on the road, today's are waiting for the van.
PORTAL_PARCELS = [
    Parcel(0, 20, "WhatsApp", "Kurti set - navy, M", cod=118, journey="delivered"),
    Parcel(4, 19, "Website", "Anarkali gown - teal, L", payment="paid", weight=1.1, journey="delivered"),
    Parcel(9, 18, "Shopee", "Abaya - black, M", payment="paid", journey="delivered_quick"),
    Parcel(2, 17, "Instagram", "Palazzo suit - maroon", cod=144, quantity=2, weight=1.3, journey="delivered"),
    Parcel(13, 16, "Lazada", "Chiffon dupatta set", payment="paid", weight=0.6, journey="delivered_slow"),
    Parcel(6, 15, "WhatsApp", "Kaftan - sand, free size", cod=89, journey="delivered"),
    Parcel(18, 14, "Website", "Baju kurung pahang - dusty pink", payment="paid", weight=1.2, journey="delivered_slow"),
    Parcel(11, 13, "Facebook", "Kids lehenga - red, 6y", cod=132, journey="returned"),
    Parcel(3, 12, "TikTok Shop", "Satin shawl - ivory", payment="paid", weight=0.5, journey="delivered"),
    Parcel(21, 11, "Shopee", "Shalwar kameez - olive, L", cod=156, quantity=2, weight=1.5, journey="delivered"),
    Parcel(7, 10, "Website", "Embroidered kurti - cream", payment="paid", journey="delivered"),
    Parcel(16, 9, "WhatsApp", "Maxi dress - emerald", cod=175, weight=1.0, journey="delivered_slow"),
    Parcel(24, 8, "Daraz", "Cotton co-ord set - stripe", cod=98, journey="returned"),
    Parcel(1, 7, "Shopee", "Abaya - charcoal, S", payment="paid", journey="delivered"),
    Parcel(19, 6, "Website", "Sharara set - wine", cod=245, quantity=2, weight=1.6, journey="delivered_quick"),
    Parcel(12, 5, "Instagram", "Kurti palazzo 2pc - black", cod=126, journey="out_today"),
    Parcel(22, 5, "Lazada", "Jubah - navy, XL", payment="paid", weight=1.2, journey="near_home"),
    Parcel(5, 4, "WhatsApp", "Silk scarf - two pack", cod=64, weight=0.4, journey="out_today"),
    Parcel(15, 4, "Website", "Anarkali gown - blush, M", payment="paid", weight=1.1, journey="in_transit"),
    Parcel(25, 3, "Shopee", "Baju melayu set - black", cod=189, quantity=2, weight=1.4, journey="in_transit"),
    Parcel(8, 3, "TikTok Shop", "Kids kurta - blue, 4y", cod=72, weight=0.5, journey="in_transit"),
    Parcel(20, 2, "Website", "Chiffon suit with plazo", payment="paid", weight=1.0, journey="collected"),
    Parcel(10, 2, "WhatsApp", "Kaftan - olive, free size", cod=95, journey="collected"),
    Parcel(17, 1, "Facebook", "Kurti set - mustard, S", cod=112, journey="created"),
    Parcel(23, 1, "Shopee", "Abaya - taupe, L", payment="paid", weight=0.9, journey="created"),
    Parcel(14, 1, "Website", "Dupatta - hand embroidered", cod=78, weight=0.5, journey="created"),
    Parcel(2, 0, "Instagram", "Palazzo suit - sage", cod=144, journey="created"),
    Parcel(6, 0, "WhatsApp", "Maxi dress - plum", cod=168, weight=1.0, journey="created"),
    Parcel(9, 0, "Website", "Kurti - powder blue, M", payment="paid", journey="created"),
]


# ------------------------------------------------------------------- http


class Api:
    """The platform, through its own gateway, as a person's browser sees it."""

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body=None, token: str | None = None, with_headers: bool = False):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                text = response.read().decode()
                answer = json.loads(text) if text else None
                return (answer, response.headers) if with_headers else answer
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:400]
            raise SystemExit(f"{method} {path} -> {error.code}: {detail}") from None
        except urllib.error.URLError as error:
            raise SystemExit(
                f"Cannot reach {self.base}: {error.reason}. Is the platform running (START.cmd)?"
            ) from None

    def portal_login(self, login: str, password: str) -> tuple[dict, str | None]:
        """Sign in on the courier portal. Its way in is the cookie, which is the token."""
        me, headers = self.call("POST", "/api/v1/auth/login", {"login": login, "password": password},
                                with_headers=True)
        for cookie in headers.get_all("Set-Cookie") or []:
            if cookie.startswith("inaaya_session="):
                return me, cookie.split("=", 1)[1].split(";", 1)[0]
        return me, None


def say(text: str) -> None:
    print(f"  {text}", flush=True)


# ------------------------------------------------------------------ clear


def clear(db: psycopg.Connection) -> None:
    """Take out every order, parcel and customer, and put the stock back."""
    with db.cursor() as cur:
        # Movements that belong to an order or a return go with them; the
        # intakes and the moves between rooms are the stock's own history and
        # stay, so the garments on the shelves still know where they came from.
        cur.execute("DELETE FROM warehouse.movements WHERE order_id IS NOT NULL OR return_id IS NOT NULL")
        cur.execute("DELETE FROM warehouse.returns")           # return_lines cascade
        cur.execute("DELETE FROM warehouse.orders")            # lines, items, shipments cascade
        # Anything that was picked or sent out is on the shelves again.
        cur.execute("""
            UPDATE warehouse.items
               SET status  = 'in_stock',
                   room_id = COALESCE(room_id, (SELECT id FROM warehouse.rooms ORDER BY code LIMIT 1))
             WHERE status IN ('allocated', 'shipped', 'returned')
        """)
        cur.execute("""
            TRUNCATE courier.tracking_event, courier.orders, courier.import_row, courier.import_batch
            RESTART IDENTITY CASCADE
        """)
    db.commit()
    say("cleared the orders, the parcels and the customers")


# ------------------------------------------------------------------ dates


def at(days_ago: int, hour: int, minute: int = 0) -> datetime:
    """A moment on the shop's clock, so many days back, as UTC."""
    day = datetime.now(MYT) - timedelta(days=days_ago)
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(timezone.utc)


# -------------------------------------------------------------- the build


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg", required=True, help="postgresql://... for the platform database")
    parser.add_argument("--url", default="http://localhost:5080", help="the platform's address")
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--admin-password", default="admin123")
    parser.add_argument("--merchant-user", default="linked")
    parser.add_argument("--merchant-password", default="linked123")
    parser.add_argument("--yes", action="store_true", help="do not ask before replacing what is there")
    args = parser.parse_args()

    if not args.yes:
        print("This REPLACES every order, parcel and customer in the platform with invented ones.")
        if input("Type DEMO to continue: ").strip() != "DEMO":
            print("Cancelled.")
            return 1

    random.seed(20260918)
    api = Api(args.url)

    signed_in = api.call("POST", "/api/auth/login",
                         {"username": args.admin_user, "password": args.admin_password})
    token = signed_in["token"]
    say(f"signed in as {signed_in['user']['fullName']}")

    db = psycopg.connect(args.pg)
    try:
        clear(db)

        # What there is to sell. Placeholder rows from the old sales-file import
        # have no price on them; an order made of those would total nothing.
        variants = api.call("GET", "/api/variants?limit=500", token=token)["variants"]
        stock = [v for v in variants
                 if v["stock_type"] == "stock" and float(v["sale_price"]) > 0 and int(v["sellable"]) > 0]
        dropship = [v for v in variants if v["stock_type"] == "dropship" and float(v["sale_price"]) > 0]
        if not stock or not dropship:
            raise SystemExit("The catalogue has nothing priced to sell - import the shop's data first.")

        items = api.call("GET", "/api/items?status=in_stock&limit=1000", token=token)["items"]
        on_shelf: dict[int, list[str]] = {}
        for item in items:
            on_shelf.setdefault(item["variant_id"], []).append(item["epc"])

        # Order numbers carry the day the order was placed, so they are handed
        # out per day here rather than by the API's "today".
        per_day: dict[str, int] = {}

        def placed_on(days_ago: int) -> tuple[str, datetime]:
            """The next order number for that day, and the hour it was taken.

            The number carries the day, so the hour follows the number: the
            fourth order of a day is later in the day than the first.
            """
            day = (datetime.now(MYT) - timedelta(days=days_ago)).strftime("%Y%m%d")
            per_day[day] = per_day.get(day, 0) + 1
            return f"SO-{day}-{per_day[day]:04d}", at(days_ago, 9 + per_day[day])

        made = booked = delivered_count = 0
        shipments: list[tuple[str, list[tuple[str, int]], int]] = []
        first_delivered: tuple[int, str] | None = None
        last_shipped: tuple[int, str] | None = None

        for plan in sorted(PLAN, key=lambda p: -p.days_ago):
            name, phone, city, state, postcode, address = CUSTOMERS[plan.customer]
            pool = stock if plan.route == "stock" else dropship

            # A garment the warehouse can actually pick this many of.
            choices = [v for v in pool
                       if plan.route == "dropship" or len(on_shelf.get(v["id"], [])) >= plan.units]
            if not choices:
                continue
            variant = random.choice(choices)
            price = float(variant["sale_price"])

            number, placed = placed_on(plan.days_ago)
            created = api.call("POST", "/api/orders", {
                "customerName": name,
                "customerPhone": phone,
                "city": city,
                "postalCode": postcode,
                "address": f"{address}, {city}, {state}",
                "paymentType": plan.payment,
                "shippingFee": 0,
                "discount": 0,
                "lines": [{"variantId": variant["id"], "quantity": plan.units}],
            }, token=token)
            order_id = created["id"]
            with db.cursor() as cur:
                cur.execute("UPDATE warehouse.orders SET order_no = %s, placed_at = %s WHERE id = %s",
                            (number, placed, order_id))
            db.commit()
            made += 1

            # Scan the garments onto it. The order goes out by itself as the
            # last one is scanned, exactly as it does at the packing bench.
            wanted = 0 if plan.picked == "none" else (
                max(1, plan.units // 2) if plan.picked == "some" else plan.units)
            if plan.route == "stock" and wanted:
                tags = on_shelf.get(variant["id"], [])
                for epc in tags[:wanted]:
                    api.call("POST", f"/api/orders/{order_id}/pick", {"epc": epc}, token=token)
                on_shelf[variant["id"]] = tags[wanted:]

            if plan.picked != "all":
                continue

            # A stock order goes out by itself as the last garment is scanned;
            # one with nothing to scan is sent out by hand, as the desk does it.
            status = api.call("GET", f"/api/orders/{order_id}", token=token)["order"]["status"]
            if status != "shipped":
                api.call("POST", f"/api/orders/{order_id}/ship", {}, token=token)

            shipped_at = placed + timedelta(hours=5)
            with db.cursor() as cur:
                cur.execute("UPDATE warehouse.orders SET shipped_at = %s WHERE id = %s", (shipped_at, order_id))
                cur.execute("UPDATE warehouse.movements SET occurred_at = %s WHERE order_id = %s",
                            (shipped_at, order_id))
            db.commit()
            last_shipped = (order_id, number)

            # Off to J&T, the same one click the warehouse uses.
            parcel = api.call("POST", f"/api/orders/{order_id}/courier", {
                "weightKg": round(0.5 + 0.3 * plan.units, 1),
                "phone": phone,
                "postcode": postcode,
                "address": address,
                "city": city,
                "state": state,
            }, token=token)
            tracking_no = parcel["shipment"]["tracking_no"]
            booked += 1

            booked_at = shipped_at + timedelta(minutes=20)
            with db.cursor() as cur:
                cur.execute("UPDATE warehouse.shipments SET booked_at = %s WHERE order_id = %s",
                            (booked_at, order_id))
                cur.execute("UPDATE courier.orders SET created_at = %s WHERE tracking_no = %s",
                            (booked_at, tracking_no))
            db.commit()

            if plan.journey:
                shipments.append((tracking_no, plan.journey, plan.days_ago))
                if plan.journey[-1][0] == "DELIVERED":
                    delivered_count += 1
                    if first_delivered is None:
                        first_delivered = (order_id, number)

        say(f"{made} warehouse orders, {booked} of them with a J&T parcel")

        # The parcels' journeys, stamped with the day each scan happened.
        for tracking_no, journey, days_ago in shipments:
            for code, after in journey:
                api.call("POST", "/api/v1/tracking/events", {
                    "tracking_nos": [tracking_no],
                    "event_type": code,
                    "location": random.choice(HUBS),
                    "occurred_at": at(max(0, days_ago - after), 9 + (after % 8)).isoformat(),
                }, token=token)
        say(f"{sum(len(j) for _, j, _ in shipments)} courier scans, {delivered_count} parcels delivered")

        # Parcels booked in the portal itself, with no warehouse order behind them.
        merchant, portal_token = api.portal_login(args.merchant_user, args.merchant_password)
        shop_order_no = 1040
        portal_delivered = 0

        for parcel in PORTAL_PARCELS:
            name, phone, postcode, city, state, address = COURIER_CUSTOMERS[parcel.who]
            placed = at(parcel.days_ago, 11 + (shop_order_no % 7))

            prefix = ORDER_PREFIX.get(parcel.source)
            if prefix:
                number = f"{prefix}-{random.randint(10_000_000, 99_999_999)}"
            else:
                shop_order_no += 1
                number = f"WEB-{shop_order_no}"

            created = api.call("POST", "/api/v1/orders", {
                "receiver_name": name,
                "receiver_phone": phone,
                "receiver_postcode": postcode,
                "receiver_city": city,
                "receiver_state": state,
                "receiver_address": address,
                "goods_name": parcel.goods,
                "quantity": parcel.quantity,
                "actual_weight": parcel.weight,
                "customer_order_no": number,
                "order_payment_type": "COD" if parcel.payment == "cod" else "PREPAID",
                "cod_amount": parcel.cod,
                "order_value": parcel.cod or 0,
                "source": parcel.source,
            }, token=portal_token or token)
            tracking_no = created["tracking_no"]

            with db.cursor() as cur:
                cur.execute("UPDATE courier.orders SET created_at = %s WHERE tracking_no = %s",
                            (placed, tracking_no))
            db.commit()

            journey = JOURNEYS[parcel.journey]
            for code, after in journey:
                api.call("POST", "/api/v1/tracking/events", {
                    "tracking_nos": [tracking_no],
                    "event_type": code,
                    "location": random.choice(HUBS),
                    "occurred_at": at(max(0, parcel.days_ago - after), 9 + (after % 9)).isoformat(),
                }, token=token)
            if journey and journey[-1][0] == "DELIVERED":
                portal_delivered += 1

        say(f"{len(PORTAL_PARCELS)} parcels booked in the portal by {merchant.get('name', args.merchant_user)}"
            f" - {portal_delivered} of them delivered")

        # The returns desk: one finished, one still on the counter.
        if first_delivered:
            order_id, number = first_delivered
            detail = api.call("GET", f"/api/orders/{order_id}", token=token)
            scanned = [row["epc"] for row in detail.get("picked", []) if row.get("epc")]
            done = api.call("POST", "/api/returns", {"orderId": order_id, "reason": "Too large - customer sent it back"},
                            token=token)
            for epc in scanned[:1]:
                api.call("POST", f"/api/returns/{done['id']}/scan", {"epc": epc}, token=token)
            rooms = api.call("GET", "/api/rooms", token=token)["rooms"]
            desk = next((r for r in rooms if r["code"] == "RETURNS"), rooms[0])
            if scanned:
                api.call("POST", f"/api/returns/{done['id']}/close", {"restockRoomId": desk["id"]}, token=token)
                say(f"return {done['returnNo']} closed against {number}")

        if last_shipped:
            order_id, number = last_shipped
            open_return = api.call("POST", "/api/returns",
                                   {"orderId": order_id, "reason": "Colour not as pictured"}, token=token)
            say(f"return {open_return['returnNo']} left open against {number}")

        # The warehouse reads the courier's scans on its own timer. Waiting for
        # it here means the demo opens on finished orders rather than on orders
        # that finish themselves a few seconds later.
        if delivered_count:
            say("waiting for the warehouse to read the courier's scans...")
            for _ in range(20):
                counted = api.call("GET", "/api/overview", token=token)["shipping"]["delivered"]
                if int(counted) >= delivered_count:
                    say(f"{counted} orders closed by a courier scan")
                    break
                time.sleep(3)

        print()
        say("Demo data is in. Sign in at " + args.url + " as " + args.admin_user)
        say("The shop's real data goes back with: scripts\\platform.ps1 import-legacy")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
