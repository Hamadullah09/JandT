"""One-time migration of the two legacy systems into the platform database.

    Before                                  After
    ------                                  -----
    Clothing Warehouse  MySQL 8             PostgreSQL 16, one database
      clothing_warehouse.*          --->      warehouse.*    (every table, ids kept)
      users                         --->      core.users     (merged by username)
    J&T courier portal  PostgreSQL
      orders export (CSV)           --->      courier.orders (tracking numbers kept)
                                              warehouse.shipments  (the two linked)

The warehouse comes from a mysqldump file, loaded into a throwaway MySQL
container so that MySQL itself reads its own dump - no hand-written parser, no
guessing at escapes or binary columns.  The courier side comes from the portal's
own order export (jt-export / Admin Portal > Export CSV), which is all that
exists of the live J&T data on this machine; point --courier-database at a J&T
PostgreSQL database instead when one is reachable.

Then the two are joined: an order that exists in both systems - the same
customer, the same phone - gets a warehouse.shipments row naming its J&T parcel,
exactly as if it had been booked from the warehouse.

Usage (the platform must have started once, so the schemas exist):

    python database/tools/migrate_legacy.py \\
        --pg "postgresql://inaaya:<POSTGRES_PASSWORD>@127.0.0.1:5433/inaaya" \\
        --mysql-dump database/legacy/mysql-backups/backup-before-delete-product-20260917.sql \\
        --mysql-timezone Asia/Karachi \\
        --courier-export apps/courier/exports/orders_2026-09-17_1602.csv \\
        --replace

--replace empties the warehouse and courier order tables first.  Without it the
tool refuses to run against a database that already holds orders.

Everything runs in one PostgreSQL transaction: it all lands, or none of it does.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
COURIER_BACKEND = ROOT / "apps" / "courier" / "backend"

# Warehouse tables in foreign-key order. `users` is handled separately (core).
WAREHOUSE_TABLES = [
    "rooms", "room_tags", "categories", "colors", "sizes",
    "products", "product_photos", "variants",
    "batches", "batch_lines", "items",
    "orders", "order_lines", "order_items",
    "returns", "return_lines", "movements", "find_requests",
]

# Columns that point at a user, per table: remapped to core.users ids.
USER_COLUMNS = {
    "batches": ["created_by"],
    "items": ["enrolled_by"],
    "orders": ["created_by"],
    "order_items": ["picked_by"],
    "returns": ["received_by"],
    "movements": ["user_id"],
    "find_requests": ["created_by", "found_by"],
}

COURIER_STATUS = {
    "order created": "CREATED",
    "picked up": "PICKED_UP",
    "in transit": "IN_TRANSIT",
    "on delivery": "ON_DELIVERY",
    "out for delivery": "ON_DELIVERY",
    "delivered": "DELIVERED",
    "returned": "RETURNED",
}

MYT = ZoneInfo("Asia/Kuala_Lumpur")


def say(message: str) -> None:
    print(f"[migrate] {message}", flush=True)


@dataclass
class Report:
    users_merged: int = 0
    users_added: int = 0
    rows: dict[str, int] = field(default_factory=dict)
    courier_orders: int = 0
    links: list[tuple[str, str, str]] = field(default_factory=list)

    def print(self) -> None:
        print()
        print("=" * 64)
        print("Migration complete")
        print("=" * 64)
        print(f"  accounts:           {self.users_merged} merged, {self.users_added} added (core.users)")
        for table, count in self.rows.items():
            print(f"  warehouse.{table:<18} {count:>6} rows")
        if self.courier_orders:
            print(f"  courier.orders             {self.courier_orders:>6} rows")
        if self.links:
            print(f"  linked orders:      {len(self.links)} (warehouse.shipments)")
            for order_no, tracking_no, customer in self.links:
                print(f"      {order_no}  <->  J&T {tracking_no}   {customer}")


# ---------------------------------------------------------------------------
# MySQL: a throwaway container that reads the dump
# ---------------------------------------------------------------------------
class LegacyMySql:
    NAME = "inaaya-legacy-mysql"
    PORT = 3399

    def __init__(self, dump: Path, image: str = "mysql:8.4") -> None:
        self.dump = dump
        self.image = image

    def __enter__(self) -> "LegacyMySql":
        subprocess.run(["docker", "rm", "-f", self.NAME], capture_output=True)
        say(f"starting a temporary MySQL ({self.image}) to read {self.dump.name}")
        subprocess.run(
            [
                "docker", "run", "-d", "--name", self.NAME,
                "-e", "MYSQL_ALLOW_EMPTY_PASSWORD=yes",
                "-e", "MYSQL_DATABASE=clothing_warehouse",
                "-p", f"127.0.0.1:{self.PORT}:3306",
                self.image,
            ],
            check=True, capture_output=True,
        )
        for _ in range(120):
            probe = subprocess.run(
                ["docker", "exec", self.NAME, "mysql", "-uroot", "-e", "SELECT 1", "clothing_warehouse"],
                capture_output=True,
            )
            if probe.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("the temporary MySQL did not start")

        say("loading the dump")
        with self.dump.open("rb") as handle:
            subprocess.run(
                ["docker", "exec", "-i", self.NAME, "mysql", "-uroot", "--default-character-set=utf8mb4",
                 "clothing_warehouse"],
                stdin=handle, check=True, capture_output=True,
            )
        return self

    def __exit__(self, *exc: object) -> None:
        subprocess.run(["docker", "rm", "-f", self.NAME], capture_output=True)
        say("temporary MySQL removed")

    def rows(self, table: str) -> list[dict[str, Any]]:
        import pymysql

        conn = pymysql.connect(
            host="127.0.0.1", port=self.PORT, user="root", password="",
            database="clothing_warehouse", charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
        try:
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT * FROM `{table}` ORDER BY id")
                return list(cursor.fetchall())
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------
def pg_columns(cur, schema: str, table: str) -> list[str]:
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = %s AND table_name = %s AND is_generated = 'NEVER'
         ORDER BY ordinal_position
        """,
        (schema, table),
    )
    return [row[0] for row in cur.fetchall()]


def to_utc(value: Any, zone: ZoneInfo) -> Any:
    """A MySQL DATETIME is the wall clock of the server that wrote it."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=zone)
        return value.astimezone(timezone.utc)
    return value


def preflight(cur, *, replace: bool, courier: bool) -> None:
    cur.execute(
        "SELECT to_regclass('warehouse.orders') IS NOT NULL, to_regclass('courier.orders') IS NOT NULL, "
        "to_regclass('core.users') IS NOT NULL"
    )
    warehouse_ready, courier_ready, core_ready = cur.fetchone()
    if not (warehouse_ready and core_ready):
        raise SystemExit(
            "The platform has not started yet: warehouse or core tables are missing. "
            "Run `docker compose up -d` once, wait until it is healthy, then run this again."
        )
    if courier and not courier_ready:
        raise SystemExit("courier.orders is missing - start the courier API once before importing its orders.")

    cur.execute("SELECT (SELECT COUNT(*) FROM warehouse.orders) + (SELECT COUNT(*) FROM warehouse.items)")
    existing = cur.fetchone()[0]
    if existing and not replace:
        raise SystemExit(
            f"warehouse already holds {existing} orders/garments. Re-run with --replace to empty it first "
            "(this deletes them)."
        )


def empty_targets(cur, *, courier: bool) -> None:
    tables = ", ".join(f"warehouse.{t}" for t in reversed(WAREHOUSE_TABLES + ["shipments"]))
    cur.execute(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
    if courier:
        cur.execute("TRUNCATE courier.tracking_event, courier.orders, courier.import_row, courier.import_batch "
                    "RESTART IDENTITY CASCADE")
    say("emptied the warehouse" + (" and courier order tables" if courier else ""))


def merge_users(cur, legacy: list[dict[str, Any]], zone: ZoneInfo, keep_passwords: bool, report: Report) -> dict[int, int]:
    """Legacy warehouse accounts into core.users, matched by username."""
    mapping: dict[int, int] = {}
    for user in legacy:
        status = "active" if int(user.get("active") or 0) == 1 else "blocked"
        cur.execute("SELECT id FROM core.users WHERE username = %s", (user["username"],))
        found = cur.fetchone()
        if found:
            cur.execute(
                """
                UPDATE core.users
                   SET full_name = %s,
                       role = CASE WHEN role = 'admin' THEN 'admin' ELSE %s END,
                       password_hash = CASE WHEN %s THEN %s ELSE password_hash END,
                       last_login_at = GREATEST(last_login_at, %s)
                 WHERE id = %s
                """,
                (user["full_name"], user["role"], keep_passwords, user["password_hash"],
                 to_utc(user.get("last_login_at"), zone), found[0]),
            )
            mapping[user["id"]] = found[0]
            report.users_merged += 1
        else:
            cur.execute(
                """
                INSERT INTO core.users (username, full_name, password_hash, role, status, last_login_at, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (user["username"], user["full_name"], user["password_hash"], user["role"], status,
                 to_utc(user.get("last_login_at"), zone), to_utc(user.get("created_at"), zone)),
            )
            mapping[user["id"]] = cur.fetchone()[0]
            report.users_added += 1
    return mapping


def copy_warehouse(cur, mysql: LegacyMySql, zone: ZoneInfo, users: dict[int, int], report: Report) -> None:
    for table in WAREHOUSE_TABLES:
        rows = mysql.rows(table)
        columns = pg_columns(cur, "warehouse", table)
        if not rows:
            report.rows[table] = 0
            continue
        usable = [c for c in columns if c in rows[0]]
        placeholders = ", ".join(["%s"] * len(usable))
        sql = (
            f"INSERT INTO warehouse.{table} ({', '.join(usable)}) OVERRIDING SYSTEM VALUE "
            f"VALUES ({placeholders})"
        )
        remap = USER_COLUMNS.get(table, [])
        batch = []
        for row in rows:
            values = []
            for column in usable:
                value = to_utc(row[column], zone)
                if column in remap and value is not None:
                    value = users.get(value)
                values.append(value)
            batch.append(values)
        cur.executemany(sql, batch)
        cur.execute(
            f"SELECT setval(pg_get_serial_sequence('warehouse.{table}', 'id'), "
            f"GREATEST((SELECT MAX(id) FROM warehouse.{table}), 1))"
        )
        report.rows[table] = len(rows)
        say(f"warehouse.{table}: {len(rows)} rows")


# ---------------------------------------------------------------------------
# courier: the portal's order export
# ---------------------------------------------------------------------------
def _cell(value: str | None) -> str:
    """Undo the export's Excel protections: ="12809" -> 12809."""
    text = (value or "").strip()
    match = re.fullmatch(r'=\s*"(.*)"', text)
    return match.group(1) if match else text


def _tracking(row: dict[str, str]) -> str:
    for text in (row.get("Tracking Number", ""), row.get("Tracking Link", "")):
        found = re.findall(r"\d{12}", text or "")
        if found:
            return found[-1]
    raise ValueError("no tracking number")


def _money(value: str | None) -> Decimal:
    try:
        return Decimal((value or "0").replace(",", "").strip() or "0")
    except InvalidOperation:
        return Decimal("0")


def _items(text: str, pieces: int) -> list[dict[str, Any]]:
    items = []
    for part in [p.strip() for p in (text or "").split(";") if p.strip()]:
        quantity = 1
        qty = re.search(r"\s+x(\d+)$", part)
        if qty:
            quantity = int(qty.group(1))
            part = part[: qty.start()].strip()
        name, variant = part, ""
        if " - " in part:
            head, tail = part.rsplit(" - ", 1)
            if len(tail) <= 32 and ("/" in tail or len(tail) <= 12):
                name, variant = head.strip(), tail.strip()
        items.append({"name": name, "variant": variant, "quantity": quantity})
    if len(items) == 1 and pieces > items[0]["quantity"]:
        items[0]["quantity"] = pieces
    return items


def import_courier_export(cur, export: Path, report: Report) -> None:
    sys.path.insert(0, str(COURIER_BACKEND))
    from app.core import sortation as S                     # noqa: E402
    from app.core.items import order_columns                 # noqa: E402
    from app.core.phone import PhoneError, normalise_my_mobile  # noqa: E402

    cur.execute(
        "SELECT company_name, phone, postcode, state, address, payment_type, default_service "
        "FROM courier.sender_profile WHERE is_active LIMIT 1"
    )
    sender = cur.fetchone()
    if sender is None:
        raise SystemExit("courier.sender_profile is empty - start the courier API once so it seeds it.")
    s_name, s_phone, s_postcode, s_state, s_address, s_payment, s_service = sender

    with export.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    highest = 0
    for row in rows:
        tracking_no = _tracking(row)
        highest = max(highest, int(tracking_no[2:]))
        postcode = _cell(row.get("Postcode"))
        cur.execute(
            "SELECT state, hub_code, dp_code, route_code FROM courier.postcode_zone WHERE postcode = %s",
            (postcode,),
        )
        zone = cur.fetchone()
        state = row.get("State") or (zone[0] if zone else "")
        phone_raw = _cell(row.get("Phone"))
        try:
            phone = normalise_my_mobile(phone_raw)
        except PhoneError:
            phone = phone_raw
        pieces = int(_money(row.get("Pieces")) or 1)
        items = _items(row.get("Items", ""), pieces)
        goods = order_columns(items) if items else {"goods_name": "", "item_variant": "", "quantity": pieces}
        weight = _money(row.get("Weight (kg)")) or Decimal("0.5")
        payment = "COD" if (row.get("Payment") or "").strip().upper() == "COD" else "PREPAID"
        placed = datetime.strptime(row["Order Date"].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=MYT)
        status = COURIER_STATUS.get((row.get("Status") or "").strip().lower(), "CREATED")

        cur.execute(
            """
            INSERT INTO courier.orders (
                tracking_no, customer_order_no, sender_name, sender_phone, sender_postcode, sender_state,
                sender_address, receiver_name, receiver_phone, receiver_postcode, receiver_city, receiver_state,
                receiver_address, address_type, goods_type, goods_name, item_variant, quantity, items,
                actual_weight, length_cm, width_cm, height_cm, volumetric_weight, chargeable_weight,
                service_type, service_scope, sortation_code, route_code, payment_type, order_payment_type,
                cod_amount, order_value, freight_fee, remark, order_date, status, created_at,
                tracking_status, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'HOME', 'PARCEL', %s, %s, %s, %s,
                    %s, 0, 0, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'created', %s, %s, 'Website')
            """,
            (
                tracking_no, _cell(row.get("Order No.")) or None, s_name, s_phone, s_postcode, s_state,
                s_address, (row.get("Receiver Name") or "").strip()[:60], phone, postcode,
                (row.get("City") or "").strip() or None, state, (row.get("Address") or "").strip(),
                goods["goods_name"], goods["item_variant"] or None, goods["quantity"], json.dumps(items),
                weight, weight, s_service or "NORMAL", S.service_scope(s_state, state),
                S.build_sortation_code(postcode, zone[1], state, zone[2]) if zone else None,
                zone[3] if zone else None, s_payment or "MONTHLY", payment,
                _money(row.get("COD Amount (RM)")), _money(row.get("Item Value (RM)")),
                _money(row.get("Shipping Fee (RM)")), "Imported from the J&T portal export",
                placed.date(), placed, status,
            ),
        )
        report.courier_orders += 1

    if highest:
        cur.execute("SELECT setval('courier.tracking_seq', GREATEST(%s, (SELECT last_value FROM courier.tracking_seq)))",
                    (highest,))
    say(f"courier.orders: {report.courier_orders} rows (tracking numbers kept; sequence moved past them)")


def link_orders(cur, report: Report) -> None:
    """An order in both systems - same customer, same phone - becomes one shipment."""
    cur.execute(
        """
        WITH wh AS (
            SELECT o.id, o.order_no, o.customer_name, o.payment_type, o.total, o.placed_at,
                   regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') AS digits,
                   lower(btrim(o.customer_name)) AS name
              FROM warehouse.orders o
             WHERE NOT EXISTS (SELECT 1 FROM warehouse.shipments s WHERE s.order_id = o.id)
        ), co AS (
            SELECT c.tracking_no, c.tracking_status, c.tracking_updated_at, c.chargeable_weight,
                   c.freight_fee, c.cod_amount, c.created_at, c.sortation_code, c.route_code,
                   regexp_replace(c.receiver_phone, '\\D', '', 'g') AS digits,
                   lower(btrim(c.receiver_name)) AS name
              FROM courier.orders c
             WHERE c.customer_order_no IS NOT NULL
        )
        SELECT DISTINCT ON (wh.id)
               wh.id, wh.order_no, wh.customer_name, co.tracking_no, co.tracking_status,
               co.tracking_updated_at, co.chargeable_weight, co.freight_fee, co.cod_amount,
               co.created_at, co.sortation_code, co.route_code
          FROM wh
          JOIN co ON co.digits = wh.digits AND co.name = wh.name AND wh.digits <> ''
         WHERE NOT EXISTS (SELECT 1 FROM warehouse.shipments s WHERE s.tracking_no = co.tracking_no)
         ORDER BY wh.id, co.created_at
        """
    )
    matches = cur.fetchall()
    cur.execute("SELECT id FROM core.users WHERE role = 'admin' ORDER BY id LIMIT 1")
    admin = cur.fetchone()
    for (order_id, order_no, customer, tracking_no, status, status_at, weight, freight, cod,
         booked_at, sortation, route) in matches:
        cur.execute(
            """
            INSERT INTO warehouse.shipments (order_id, tracking_no, status, sortation_code, route_code,
                                             weight_kg, freight_fee, cod_amount, booked_by, booked_at,
                                             status_at, synced_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            """,
            (order_id, tracking_no, status, sortation, route, weight, freight, cod,
             admin[0] if admin else None, booked_at, status_at),
        )
        report.links.append((order_no, tracking_no, customer))
    say(f"linked {len(matches)} warehouse orders to their J&T parcels")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg", required=True, help="PostgreSQL URL of the platform database (a superuser/owner)")
    parser.add_argument("--mysql-dump", type=Path, help="mysqldump file of clothing_warehouse")
    parser.add_argument("--mysql-timezone", default="Asia/Karachi",
                        help="the time zone the MySQL server's clock was in (DATETIME has none)")
    parser.add_argument("--courier-export", type=Path, help="the courier portal's orders CSV export")
    parser.add_argument("--replace", action="store_true", help="empty the target tables first")
    parser.add_argument("--keep-legacy-passwords", action="store_true",
                        help="for accounts in both systems, use the warehouse password instead of the platform's")
    parser.add_argument("--no-link", action="store_true", help="do not link orders across the modules")
    args = parser.parse_args()

    if not args.mysql_dump and not args.courier_export:
        parser.error("give --mysql-dump, --courier-export, or both")

    import psycopg

    report = Report()
    zone = ZoneInfo(args.mysql_timezone)

    with psycopg.connect(args.pg, autocommit=False) as pg:
        with pg.cursor() as cur:
            preflight(cur, replace=args.replace, courier=bool(args.courier_export))
            if args.replace:
                empty_targets(cur, courier=bool(args.courier_export))

            if args.mysql_dump:
                with LegacyMySql(args.mysql_dump) as mysql:
                    users = merge_users(cur, mysql.rows("users"), zone, args.keep_legacy_passwords, report)
                    copy_warehouse(cur, mysql, zone, users, report)

            if args.courier_export:
                import_courier_export(cur, args.courier_export, report)

            if not args.no_link:
                link_orders(cur, report)

        pg.commit()

    report.print()


if __name__ == "__main__":
    main()
