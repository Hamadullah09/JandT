/**
 * Reading a sales spreadsheet.
 *
 * Hand-written rather than a library, because the whole job is one function and
 * the one thing that actually matters — a comma inside a quoted address — is
 * four lines of it. Every row in a real file looks like this:
 *
 *   Emily Lim,"No. 43-1, Jalan PJU 5/21, Kota Damansara, Selangor, Malaysia",47810,...
 *
 * Split that on commas and the address becomes five columns and everything
 * after it lands in the wrong field, silently.
 */

/**
 * Splits CSV text into rows of cells.
 *
 * Handles quoted fields, commas and newlines inside them, and "" for a literal
 * quote. Accepts CRLF and LF, because a file that has been through Excel on
 * Windows and then e-mail has usually been through both.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  // A byte-order mark survives Excel's "Save as CSV UTF-8" and would otherwise
  // become part of the first header, so the first column never matches.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }

    if (c === '\r') continue;
    if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += c;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Trailing blank lines are what a text editor leaves behind, not data.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** "Postal Code", "postal_code" and "POSTALCODE" are the same column. */
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which column is which.
 *
 * Several spellings each, because the file is written by whoever writes it and
 * asking sales to rename a column before every import is asking for the import
 * to stop being used.
 */
const COLUMNS = {
  customerName: ['name', 'customername', 'customer', 'fullname', 'buyer'],
  phone: ['phonenumber', 'phone', 'mobile', 'contact', 'contactnumber'],
  address: ['address', 'deliveryaddress', 'shippingaddress', 'fulladdress'],
  city: ['city', 'town'],
  postalCode: ['postalcode', 'postcode', 'zip', 'zipcode', 'pincode'],
  total: ['totalamount', 'total', 'amount', 'price', 'ordertotal', 'grandtotal'],
  paymentType: ['ordertype', 'paymenttype', 'payment', 'paymentmethod', 'paymentstatus'],
  dressName: ['dressname', 'dress', 'product', 'productname', 'item', 'itemname', 'garment'],
};

/**
 * Where the city comes from when the file has no city column.
 *
 * A Malaysian address ends "…, Town, State, Malaysia", so the town is three
 * from the end. It is a guess and is shown as one on the preview, where it can
 * be seen before it is committed — and the full address is stored verbatim
 * either way, so a wrong guess costs a search result and never a delivery.
 */
function cityFromAddress(address) {
  const parts = String(address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 3] : '';
}

/** "119.00", "RM 119", "1,190.50" — all the same number. */
function toNumber(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return cleaned === '' || Number.isNaN(n) ? null : n;
}

/**
 * Turns CSV text into rows the import endpoint understands.
 *
 * Returns the rows, which headers were recognised, and which were not — the
 * last of those is what tells an operator that their "Customer Name" column is
 * being read and their "Notes" column is being ignored, before they import
 * four hundred orders.
 */
export function readOrderFile(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { rows: [], mapped: {}, ignored: [], error: 'That file is empty.' };

  const header = rows[0].map(key);

  // Held in locals rather than written back onto COLUMNS, which is a
  // module-level constant: state left on it would leak from one imported file
  // into the next one opened in the same session.
  const indexes = {};
  const mapped = {};

  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const index = header.findIndex((h) => aliases.includes(h));
    indexes[field] = index;
    if (index >= 0) mapped[field] = rows[0][index].trim();
  }

  if (indexes.customerName < 0) {
    return {
      rows: [], mapped, ignored: [],
      error: 'No customer name column. Expected one called Name or Customer.',
    };
  }

  const ignored = rows[0]
    .map((name, i) => ({ name: name.trim(), i }))
    .filter(({ i }) => !Object.values(indexes).includes(i))
    .map(({ name }) => name)
    .filter(Boolean);

  const at = (r, field) => (indexes[field] >= 0 ? (r[indexes[field]] ?? '').trim() : '');

  const out = rows.slice(1).map((r, n) => {
    const address = at(r, 'address');
    return {
      line: n + 2,
      customerName: at(r, 'customerName'),
      phone: at(r, 'phone'),
      address,
      city: at(r, 'city') || cityFromAddress(address),
      cityGuessed: indexes.city < 0 && !!cityFromAddress(address),
      postalCode: at(r, 'postalCode'),
      total: toNumber(at(r, 'total')),
      paymentType: at(r, 'paymentType'),
      dressName: at(r, 'dressName'),
    };
  });

  return { rows: out, mapped, ignored, error: null };
}
