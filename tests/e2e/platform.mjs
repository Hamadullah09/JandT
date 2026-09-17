/**
 * End-to-end check of the integrated platform: the warehouse and the J&T
 * courier module working as one system on one database.
 *
 *   node tests/e2e/platform.mjs                         # through the gateway, http://localhost:5080
 *   node tests/e2e/platform.mjs http://localhost:5080
 *   WAREHOUSE_URL=http://127.0.0.1:5081 COURIER_URL=http://127.0.0.1:8001 node tests/e2e/platform.mjs
 *
 * Each module has its own suite for its own rules (apps/warehouse/server/test,
 * apps/courier/backend/tests). This one covers only what lives between them:
 *
 *   one login for both modules, one logout, and who may use which
 *   a warehouse order books its own J&T parcel, with the order's lines on it
 *   the courier's tracking moves the warehouse order: delivered, or a return
 *
 * It writes to whatever platform it is pointed at, so run it against a
 * development or staging one. Everything it creates is named E2E.
 */

const GATEWAY = (process.argv[2] ?? process.env.PLATFORM_URL ?? 'http://localhost:5080').replace(/\/$/, '');
const WAREHOUSE = (process.env.WAREHOUSE_URL ?? GATEWAY).replace(/\/$/, '');
const COURIER = (process.env.COURIER_URL ?? GATEWAY).replace(/\/$/, '');
const ADMIN = { username: process.env.ADMIN_USER ?? 'admin', password: process.env.ADMIN_PASSWORD ?? 'admin123' };
const MERCHANT = { username: process.env.MERCHANT_USER ?? 'linked', password: process.env.MERCHANT_PASSWORD ?? 'linked123' };

let passed = 0;
const failures = [];

// ---------------------------------------------------------------- harness

async function call(base, method, path, { body, token, cookie, headers = {}, raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: `inaaya_session=${cookie}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  const text = type.includes('pdf') ? '' : await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* left null */ }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const session = setCookie.map((c) => /^inaaya_session=([^;]*)/.exec(c)?.[1]).find(Boolean) ?? null;
  const result = { status: res.status, json, type, session };
  if (raw) return result;
  if (!res.ok) {
    const message = json?.error?.message ?? json?.detail ?? json?.title ?? text.slice(0, 200);
    throw new Error(`${method} ${base}${path} -> ${res.status}: ${message}`);
  }
  return result;
}

const warehouse = (method, path, options) => call(WAREHOUSE, method, path, options);
const courier = (method, path, options) => call(COURIER, method, path, options);

function check(description, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${description}`);
  } else {
    failures.push(description);
    console.log(`  FAIL ${description}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

const section = (title) => console.log(`\n${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function eventually(probe, { timeoutMs = 90_000, everyMs = 2_000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > until) return null;
    await sleep(everyMs);
  }
}

const stamp = Date.now().toString(36).toUpperCase();

// ------------------------------------------------------------------- run

try {
  section('The platform answers');

  const wh = await warehouse('GET', '/api/health', { raw: true });
  check('the warehouse answers where the handhelds look for it', wh.status === 200 && wh.json?.ok === true, wh.status);

  const track = await courier('GET', '/api/v1/tracking?awb=', { raw: true });
  check('the public tracking page answers without a login', track.status === 200, track.status);

  if (WAREHOUSE === COURIER) {
    // The gateway listens on 80 inside its container; a redirect naming that
    // port would send the browser nowhere.
    const bare = await fetch(`${WAREHOUSE}/warehouse`, { redirect: 'manual' });
    const location = bare.headers.get('location') ?? '';
    check('the gateway sends /warehouse on to /warehouse/ at the address it was reached on',
      bare.status === 301 && new URL(location, WAREHOUSE).href === `${WAREHOUSE}/warehouse/`, location);
  }

  section('One login for both modules');

  const courierLogin = await courier('POST', '/api/v1/auth/login', {
    body: { login: ADMIN.username, password: ADMIN.password },
  });
  const adminCookie = courierLogin.session;
  check('logging in on the courier portal sets the platform session cookie', Boolean(adminCookie));

  const handoff = await warehouse('GET', '/api/auth/session', { cookie: adminCookie, raw: true });
  check('the warehouse dashboard accepts that cookie with no second login', handoff.status === 200, handoff.status);
  check('and hands the dashboard the same account', handoff.json?.user?.username === ADMIN.username);
  const adminToken = handoff.json?.token;
  check('and the token it keeps', typeof adminToken === 'string' && adminToken.split('.').length === 3);

  const whLogin = await warehouse('POST', '/api/auth/login', { body: ADMIN });
  check('logging in on the warehouse (as a handheld does) gives a token', Boolean(whLogin.json?.token));
  check('and the platform cookie too', Boolean(whLogin.session));
  const zone = whLogin.json?.timeZone;
  const knownZone = (() => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return Boolean(zone); } catch { return false; } })();
  check('and the shop clock the dashboard shows every time on', knownZone, zone);

  const meOnCourier = await courier('GET', '/api/v1/auth/me', { token: whLogin.json.token, raw: true });
  check('the courier API accepts the warehouse token', meOnCourier.status === 200, meOnCourier.status);
  check('as the same platform account', meOnCourier.json?.id === whLogin.json.user.id, meOnCourier.json);

  section('Who may use which');

  const shop = await courier('POST', '/api/v1/auth/login', { body: { login: MERCHANT.username, password: MERCHANT.password } });
  check('the merchant account logs in to the courier portal', shop.status === 200 && shop.json?.role === 'merchant', shop.json);
  const shopOnPortal = await courier('GET', '/api/v1/orders', { cookie: shop.session, raw: true });
  check('and can use it', shopOnPortal.status === 200, shopOnPortal.status);
  const shopOnWarehouse = await warehouse('GET', '/api/products', { cookie: shop.session, raw: true });
  check('but the warehouse refuses a merchant account', shopOnWarehouse.status === 403, shopOnWarehouse.status);
  const shopOnAdmin = await courier('GET', '/api/v1/admin/orders', { cookie: shop.session, raw: true });
  check('and so does the courier admin portal', shopOnAdmin.status === 403, shopOnAdmin.status);

  const forgedOnWarehouse = await warehouse('POST', '/api/rooms', {
    cookie: adminCookie, body: { code: `E2E${stamp}`, name: 'forged' },
    headers: { 'Sec-Fetch-Site': 'cross-site' }, raw: true,
  });
  check('a change posted from another site with the cookie is refused by the warehouse', forgedOnWarehouse.status === 403, forgedOnWarehouse.status);
  const forgedOnCourier = await courier('PUT', '/api/v1/settings/sender', {
    cookie: adminCookie, body: { company_name: 'forged', phone: '0123456789', postcode: '43300', state: 'X', address: 'forged address' },
    headers: { 'Sec-Fetch-Site': 'cross-site' }, raw: true,
  });
  check('and by the courier portal', forgedOnCourier.status === 403, forgedOnCourier.status);

  section('A warehouse order books its own J&T parcel');

  const token = whLogin.json.token;
  const cats = (await warehouse('GET', '/api/categories', { token })).json.rows;
  const colors = (await warehouse('GET', '/api/colors', { token })).json.rows;
  const sizes = (await warehouse('GET', '/api/sizes', { token })).json.rows;

  const product = await warehouse('POST', '/api/products/with-stock', {
    token,
    body: {
      name: `E2E Chiffon Gown ${stamp}`, categoryId: cats[0].id, stockType: 'dropship',
      costPrice: 60, salePrice: 149.9,
      lines: [{ colorId: colors[0].id, sizeId: sizes[0].id, quantity: 20 }],
    },
  });
  const variant = (await warehouse('GET', `/api/variants?search=${encodeURIComponent(`E2E Chiffon Gown ${stamp}`)}`, { token })).json.variants[0];
  check('a dropship product is in the catalogue to sell', product.status === 201 && Boolean(variant), product.json);

  async function newShippedOrder(customer) {
    const order = await warehouse('POST', '/api/orders', {
      token,
      body: {
        customerName: customer, customerPhone: '+60 12-345 6789', postalCode: '47810',
        address: 'No. 12, Jalan PJU 5/1, Kota Damansara', city: 'Petaling Jaya', paymentType: 'COD',
        lines: [{ variantId: variant.id, quantity: 2 }],
      },
    });
    await warehouse('POST', `/api/orders/${order.json.id}/ship`, { token });
    return order.json;
  }

  const first = await newShippedOrder(`E2E Delivered ${stamp}`);
  const firstDetail = (await warehouse('GET', `/api/orders/${first.id}`, { token })).json;
  check('the order has gone out of the warehouse', firstDetail.order.status === 'shipped', firstDetail.order.status);
  check('and has no parcel yet', firstDetail.shipment === null);

  const booked = await warehouse('POST', `/api/orders/${first.id}/courier`, { token, body: { weightKg: 0.8 }, raw: true });
  const shipment = booked.json?.shipment;
  check('booking J&T from the order creates the parcel', booked.status === 201, booked.json);
  check('with a 12-digit J&T tracking number', /^\d{12}$/.test(shipment?.tracking_no ?? ''), shipment?.tracking_no);
  check('a sortation code for the label', Boolean(shipment?.sortation_code), shipment);
  check('and the cash to collect on delivery', Number(shipment?.cod_amount) === Number(firstDetail.order.total), shipment?.cod_amount);

  const again = await warehouse('POST', `/api/orders/${first.id}/courier`, { token, body: {}, raw: true });
  check('booking the same order twice is refused, naming the parcel', again.status === 409 && again.json?.error?.message?.includes(shipment?.tracking_no), again.json);

  const parcel = await courier('GET', `/api/v1/orders/${shipment.tracking_no}`, { token, raw: true });
  check('the courier portal has the parcel', parcel.status === 200, parcel.status);
  check('under the warehouse order number', parcel.json?.customer_order_no === first.orderNo, parcel.json?.customer_order_no);
  check('marked as coming from the warehouse', parcel.json?.source === 'Warehouse', parcel.json?.source);
  check('with the order\'s garments on it', (parcel.json?.items ?? []).some((i) => String(i.name).startsWith('E2E Chiffon Gown')), parcel.json?.items);
  check('as cash on delivery for the order total', parcel.json?.order_payment_type === 'COD'
    && Number(parcel.json?.cod_amount) === Number(firstDetail.order.total), parcel.json?.cod_amount);

  const adminView = await courier('GET', `/api/v1/admin/orders/${shipment.tracking_no}`, { token, raw: true });
  check('the courier admin portal shows which warehouse order it came from',
    adminView.json?.order?.warehouse_order_no === first.orderNo, adminView.json?.order);

  const pdf = await courier('GET', `/api/v1/waybills/${shipment.tracking_no}.pdf`, { token, raw: true });
  check('the waybill prints as a PDF', pdf.status === 200 && pdf.type.includes('pdf'), `${pdf.status} ${pdf.type}`);

  const publicTrack = await courier('GET', `/api/v1/tracking?awb=${shipment.tracking_no}`, { raw: true });
  check('the customer can track it without logging in', publicTrack.json?.[0]?.found === true, publicTrack.json);

  section("The courier's tracking moves the warehouse order");

  await courier('POST', '/api/v1/tracking/events', {
    token, body: { tracking_nos: [shipment.tracking_no], event_type: 'PICKED_UP', location: 'Seri Kembangan' },
  });
  await courier('POST', '/api/v1/tracking/events', {
    token, body: { tracking_nos: [shipment.tracking_no], event_type: 'DELIVERED', location: 'Petaling Jaya' },
  });

  const delivered = await eventually(async () => {
    const detail = (await warehouse('GET', `/api/orders/${first.id}`, { token })).json;
    return detail.order.status === 'delivered' ? detail : null;
  });
  check('J&T marking the parcel delivered delivers the warehouse order', Boolean(delivered), 'still not delivered after 90s');
  check('the parcel status is on the order', delivered?.shipment?.status === 'DELIVERED', delivered?.shipment?.status);
  check('with the scans the courier recorded', (delivered?.shipment?.events ?? []).length >= 2, delivered?.shipment?.events);
  check('and the delivery time', Boolean(delivered?.order?.delivered_at));

  const second = await newShippedOrder(`E2E Returned ${stamp}`);
  const secondBooking = (await warehouse('POST', `/api/orders/${second.id}/courier`, { token, body: {} })).json.shipment;
  await courier('POST', '/api/v1/tracking/events', {
    token, body: { tracking_nos: [secondBooking.tracking_no], event_type: 'RETURNED' },
  });

  const opened = await eventually(async () => {
    const detail = (await warehouse('GET', `/api/orders/${second.id}`, { token })).json;
    return detail.returns.length > 0 ? detail : null;
  });
  check('J&T returning a parcel opens a return at the warehouse desk', Boolean(opened), 'no return after 90s');
  check('waiting for the garments to be scanned', opened?.returns?.[0]?.status === 'requested', opened?.returns?.[0]);
  check('naming the parcel', String(opened?.returns?.[0]?.reason ?? '').includes(secondBooking.tracking_no), opened?.returns?.[0]?.reason);

  const overview = (await warehouse('GET', '/api/overview', { token })).json;
  check('the warehouse overview counts parcels by courier status',
    Number(overview.shipping?.delivered) >= 1 && Number(overview.shipping?.returned) >= 1, overview.shipping);

  section('One logout for both modules');

  const temp = await courier('POST', '/api/v1/auth/login', { body: { login: ADMIN.username, password: ADMIN.password } });
  const inUse = await warehouse('GET', '/api/auth/me', { token: temp.session, raw: true });
  check('a sign-in in use on the warehouse', inUse.status === 200, inUse.status);
  // Only an Origin header, as a browser without Sec-Fetch-Site sends it: the
  // same-site check has to see the address the browser used, port included.
  const out = await courier('POST', '/api/v1/auth/logout', {
    cookie: temp.session, headers: { Origin: new URL(COURIER).origin }, raw: true,
  });
  check('logging out on the courier portal works', out.status === 204, out.status);
  // The warehouse remembers a live session for 15 s; the database announces
  // the logout, so it has to stop well before that.
  const after = await eventually(async () => {
    const res = await warehouse('GET', '/api/auth/me', { token: temp.session, raw: true });
    return res.status === 401 ? res : null;
  }, { timeoutMs: 5_000, everyMs: 250 });
  check('and that session stops working on the warehouse at once', Boolean(after), 'still accepted 5 s later');

  const temp2 = await warehouse('POST', '/api/auth/login', { body: ADMIN });
  const out2 = await warehouse('POST', '/api/auth/logout', {
    cookie: temp2.session, headers: { Origin: new URL(WAREHOUSE).origin }, raw: true,
  });
  check('logging out on the warehouse works', out2.status === 200, out2.status);
  const after2 = await courier('GET', '/api/v1/auth/me', { cookie: temp2.session, raw: true });
  check('and that session no longer works on the courier portal', after2.status === 401, after2.status);

  const staffName = `e2e${stamp.toLowerCase()}`.slice(0, 30);
  await warehouse('POST', '/api/users', { token, body: { username: staffName, password: 'secret123', fullName: 'E2E Staff', role: 'operator' } });
  const staff = await courier('POST', '/api/v1/auth/login', { body: { login: staffName, password: 'secret123' }, raw: true });
  check('an account made on the warehouse logs in to the courier portal', staff.status === 200 && staff.json?.role === 'operator', staff.json);
  const users = (await courier('GET', '/api/v1/admin/users', { token })).json;
  const staffRow = users.find((u) => u.username === staffName);
  await courier('PATCH', `/api/v1/admin/users/${staffRow.id}`, { token, body: { status: 'blocked' } });
  const blocked = await warehouse('POST', '/api/auth/login', { body: { username: staffName, password: 'secret123' }, raw: true });
  check('and blocking it on the courier portal stops it signing in to the warehouse', blocked.status === 401, blocked.status);
} catch (error) {
  failures.push(`stopped: ${error.message}`);
  console.log(`\n  STOPPED ${error.message}`);
}

console.log(`\n${'-'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`All ${passed} platform checks passed.`);
} else {
  console.log(`${passed} passed, ${failures.length} failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
