/**
 * End-to-end check of the warehouse API.
 *
 * Drives a real server against a real MySQL: intake, picking, shipping, the
 * return cross-check and the find list, in the order the warehouse does them.
 * Every assertion is a sentence about the business rather than about the code,
 * so a failure says which rule broke.
 *
 *   node test/smoke.mjs [baseUrl]
 *
 * It writes to whatever database the server is pointed at, so run it against a
 * development one. Everything it creates is prefixed SMOKE so it can be found.
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5080').replace(/\/$/, '');

let token = null;
let passed = 0;
const failures = [];

// ---------------------------------------------------------------- harness

async function call(method, path, body, { raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* left null for the message */ }

  if (raw) return { status: res.status, json, text };

  if (!res.ok) {
    const message = json?.error?.message ?? text.slice(0, 200);
    throw new Error(`${method} ${path} → ${res.status}: ${message}`);
  }
  return json;
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const del = (p) => call('DELETE', p);

function check(description, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${description}`);
  } else {
    failures.push(description);
    console.log(`  FAIL ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Asserts that a call is refused, and that it is refused for the right reason. */
async function refuses(description, method, path, body, expectedStatus) {
  const { status, json } = await call(method, path, body, { raw: true });
  const right = status === expectedStatus;
  check(description, right, `got ${status} ${json?.error?.message ?? ''}`);
  return json?.error?.message ?? '';
}

function section(title) {
  console.log(`\n${title}`);
}

/** Tags are invented per run, so re-running never collides with itself. */
const stamp = Date.now().toString(16).toUpperCase().padStart(12, '0').slice(-12);
let tagCounter = 0;
const nextTag = () => `E280${stamp}${(tagCounter++).toString(16).toUpperCase().padStart(8, '0')}`;

// ------------------------------------------------------------------- run

try {
  section('Signing in');

  const health = await get('/api/health');
  check('the server answers', health.ok === true);

  const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
  token = login.token;
  check('admin can sign in', !!token);
  check('the signed-in user comes back with the token', login.user.role === 'admin');

  await refuses('a wrong password is refused', 'POST', '/api/auth/login',
    { username: 'admin', password: 'nope' }, 401);

  section('Catalogue');

  const cats = (await get('/api/categories')).rows;
  const colors = (await get('/api/colors')).rows;
  const sizes = (await get('/api/sizes')).rows;
  const rooms = (await get('/api/rooms')).rooms;

  check('the categories are seeded', cats.length >= 6);
  check('the colours are seeded', colors.length >= 6);
  // S, M, L, XL in that order. Alphabetically it would be L, M, S, XL, which
  // is the whole reason sort_order exists.
  //
  // Their positions relative to each other, not an exact list: a warehouse that
  // adds a size of its own - and features.mjs, which adds one between L and XL -
  // must not break a check about ordering.
  const wornOrder = ['S', 'M', 'L', 'XL'].map((c) => sizes.findIndex((s) => s.code === c));
  check('sizes come back in wearing order, not alphabetical',
    wornOrder.every((at, i) => at >= 0 && (i === 0 || at > wornOrder[i - 1])),
    sizes.map((s) => s.code).join(','));
  check('the rooms are seeded', rooms.some((r) => r.code === 'A1'));

  const shalwar = cats.find((c) => c.code === 'SHALWAR');
  const navy = colors.find((c) => c.code === 'NAVY');
  const black = colors.find((c) => c.code === 'BLACK');
  const medium = sizes.find((s) => s.code === 'M');
  const large = sizes.find((s) => s.code === 'L');
  const roomA1 = rooms.find((r) => r.code === 'A1');
  const roomReturns = rooms.find((r) => r.code === 'RETURNS');

  section('A product, in colours and sizes');

  const product = await post('/api/products', {
    name: 'SMOKE Embroidered Shalwar Kameez',
    categoryId: shalwar.id,
    description: 'Cotton, hand-embroidered collar.',
    stockType: 'stock',
    costPrice: 1800,
    salePrice: 4500,
  });
  check('a product can be created', product.ok && product.id > 0);
  check('it is given a readable code', /^SHALWAR-\d{4}$/.test(product.sku), product.sku);

  const grid = await post(`/api/products/${product.id}/variants`, {
    colorIds: [navy.id, black.id],
    sizeIds: [medium.id, large.id],
  });
  check('two colours by two sizes makes four variants', grid.added === 4, JSON.stringify(grid));

  const again = await post(`/api/products/${product.id}/variants`, {
    colorIds: [navy.id, black.id],
    sizeIds: [medium.id, large.id],
  });
  check('asking for the same grid twice adds nothing', again.added === 0 && again.existing === 4);

  const detail = await get(`/api/products/${product.id}`);
  const navyMedium = detail.variants.find(
    (v) => v.color_name === navy.name && v.size_code === 'M');
  check('a variant inherits the product price when it has no override',
    Number(navyMedium.sale_price) === 4500);

  // Dropshipped: no tags, no room, stock is a number the supplier gave us.
  const drop = await post('/api/products', {
    name: 'SMOKE Dropship Kurta',
    categoryId: cats.find((c) => c.code === 'KURTA').id,
    stockType: 'dropship',
    supplier: 'Lahore Textiles',
    costPrice: 900,
    salePrice: 2200,
  });
  await post(`/api/products/${drop.id}/variants`, { colorIds: [black.id], sizeIds: [medium.id] });
  const dropDetail = await get(`/api/products/${drop.id}`);
  const dropVariant = dropDetail.variants[0];
  await patch(`/api/variants/${dropVariant.id}`, { dropshipQty: 25 });
  check('a dropship variant carries a supplier quantity instead of tags',
    (await get(`/api/products/${drop.id}`)).variants[0].dropship_qty === 25);

  section('Booking in 5 shalwar kameez');

  const batch = await post('/api/batches', {
    supplier: 'Faisalabad Mills',
    roomId: roomA1.id,
    notes: 'SMOKE intake',
    lines: [{ variantId: navyMedium.id, quantity: 5 }],
  });
  check('an intake can be created', batch.ok && batch.id > 0);
  check('it is given a readable number', /^BAT-\d{8}-\d{4}$/.test(batch.batchNo), batch.batchNo);

  await refuses('a dropship product cannot be booked into the warehouse', 'POST', '/api/batches',
    { lines: [{ variantId: dropVariant.id, quantity: 3 }] }, 400);

  const batchDetail = await get(`/api/batches/${batch.id}`);
  const line = batchDetail.lines[0];
  check('the line starts with everything outstanding', Number(line.remaining) === 5);

  const tags = [];
  for (let i = 0; i < 5; i++) {
    const epc = nextTag();
    const res = await post(`/api/batches/${batch.id}/assign`, {
      epc,
      batchLineId: line.id,
      roomId: roomA1.id,
    });
    tags.push(epc);
    if (i === 0) check('the first tag reports 4 still to go', res.remaining === 4, JSON.stringify(res));
  }
  check('all five tags were bound one by one', tags.length === 5);

  const sixth = await refuses('the sixth tag is refused once the line is full', 'POST',
    `/api/batches/${batch.id}/assign`,
    { epc: nextTag(), batchLineId: line.id }, 409);
  check('and it says why in plain words', /already tagged|nothing left/i.test(sixth), sixth);

  const dup = await refuses('a tag already on a garment cannot be reused', 'POST',
    `/api/batches/${batch.id}/assign`,
    { epc: tags[0], batchLineId: line.id }, 409);
  check('and the duplicate names the garment it is already on',
    /shalwar/i.test(dup), dup);

  const completed = await post(`/api/batches/${batch.id}/complete`, {});
  check('closing the intake reports what arrived against what was expected',
    Number(completed.expected) === 5 && Number(completed.assigned) === 5, JSON.stringify(completed));

  const afterIntake = await get(`/api/products/${product.id}`);
  const stockedVariant = afterIntake.variants.find((v) => v.id === navyMedium.id);
  check('the variant now shows five in stock', Number(stockedVariant.in_stock) === 5);
  check('and a stock value of five times cost',
    Number(stockedVariant.stock_value) === 9000, String(stockedVariant.stock_value));

  section('Looking a tag up');

  const byEpc = await get(`/api/items/by-epc/${tags[0]}`);
  check('a tag resolves to the garment it is on', byEpc.found && byEpc.kind === 'item');
  check('and says which room it is in', byEpc.item.room_code === 'A1');

  const spaced = await get(`/api/items/by-epc/${tags[0].match(/.{1,4}/g).join(' ')}`);
  check('a tag typed with spaces in it resolves the same way',
    spaced.found && spaced.item.epc === tags[0]);

  const unknown = await get(`/api/items/by-epc/${nextTag()}`);
  check('an unknown tag says so rather than failing', unknown.found === false);

  section('An order');

  const order = await post('/api/orders', {
    customerName: 'SMOKE Ayesha Khan',
    customerPhone: '0300-1234567',
    city: 'Karachi',
    shippingFee: 250,
    lines: [
      { variantId: navyMedium.id, quantity: 2 },
      { variantId: dropVariant.id, quantity: 1 },
    ],
  });
  check('an order can be placed', order.ok && order.id > 0);
  check('it is given a readable number', /^SO-\d{8}-\d{4}$/.test(order.orderNo), order.orderNo);

  const placed = await get(`/api/orders/${order.id}`);
  check('the total is the lines plus shipping',
    Number(placed.order.total) === 4500 * 2 + 2200 + 250, String(placed.order.total));

  const stockLine = placed.lines.find((l) => l.route === 'stock');
  const dropLine = placed.lines.find((l) => l.route === 'dropship');
  check('the dropship line is marked as needing no picking',
    Number(dropLine.outstanding) === 0);
  check('the stock line wants two garments', Number(stockLine.outstanding) === 2);

  const pick1 = await post(`/api/orders/${order.id}/pick`, { epc: tags[0] });
  check('a garment can be picked by tag', pick1.ok);
  check('and the pick counts down the order, ignoring the dropship line',
    pick1.required === 2 && pick1.picked === 1, JSON.stringify(pick1));
  check('and the order waits for the rest', pick1.orderStatus === 'pending', pick1.orderStatus);

  const twice = await refuses('a garment already on this order cannot be picked again', 'POST',
    `/api/orders/${order.id}/pick`, { epc: tags[0] }, 409);
  check('and it names the order it is on', twice.includes(order.orderNo), twice);

  const allocated = await get(`/api/items/by-epc/${tags[0]}`);
  check('a picked garment is no longer in stock', allocated.item.status === 'allocated');
  check('and knows which order it is on', allocated.item.order_no === order.orderNo);

  const pick2 = await post(`/api/orders/${order.id}/pick`, { epc: tags[1] });
  check('picking the last one sends the order out by itself',
    pick2.orderStatus === 'shipped', pick2.orderStatus);

  const shipped = await get(`/api/orders/${order.id}`);
  check('the order ships', shipped.order.status === 'shipped' && !!shipped.order.shipped_at);
  check('and its garments ship with it',
    shipped.picked.every((p) => p.status === 'shipped'));

  const third = await refuses('a third garment is refused once the order has gone', 'POST',
    `/api/orders/${order.id}/pick`, { epc: tags[2] }, 409);
  check('and it says the order has shipped', /shipped/i.test(third), third);

  await refuses('and it cannot be sent out a second time', 'POST',
    `/api/orders/${order.id}/ship`, {}, 409);

  // A line can fill while the order is still waiting for another one: the
  // navy medium is picked, the navy large never is.
  const navyLarge = detail.variants.find((v) => v.color_name === navy.name && v.size_code === 'L');
  const half = await post('/api/orders', {
    customerName: 'SMOKE Half Picked',
    lines: [{ variantId: navyMedium.id, quantity: 1 }, { variantId: navyLarge.id, quantity: 1 }],
  });
  const halfPick = await post(`/api/orders/${half.id}/pick`, { epc: tags[3] });
  check('an order with a line still to pick does not go out', halfPick.orderStatus === 'pending',
    halfPick.orderStatus);
  const lineFull = await refuses('a garment is refused once its line is filled', 'POST',
    `/api/orders/${half.id}/pick`, { epc: tags[4] }, 409);
  check('and it says the line is already picked', /already been picked|not wanted/i.test(lineFull), lineFull);
  await post(`/api/orders/${half.id}/cancel`, {});
  check('cancelling it puts the picked garment back',
    (await get(`/api/items/by-epc/${tags[3]}`)).item.status === 'in_stock');

  section('A second order, so there is a wrong tag to test with');

  const other = await post('/api/orders', {
    customerName: 'SMOKE Bilal Ahmed',
    lines: [{ variantId: navyMedium.id, quantity: 1 }],
  });
  await post(`/api/orders/${other.id}/pick`, { epc: tags[2] });
  check('the second order ships too',
    (await get(`/api/orders/${other.id}`)).order.status === 'shipped');

  section('The return desk');

  const ret = await post('/api/returns', {
    orderId: order.id,
    reason: 'Too large',
  });
  check('a return can be opened against a shipped order', ret.ok && ret.id > 0);
  check('it is given a readable number', /^RET-\d{8}-\d{4}$/.test(ret.returnNo), ret.returnNo);

  const notShipped = await get('/api/orders?status=pending');
  void notShipped;

  const pending = await post('/api/orders', {
    customerName: 'SMOKE Never Shipped',
    lines: [{ variantId: navyMedium.id, quantity: 1 }],
  });
  await refuses('a return cannot be opened against an order that never shipped', 'POST',
    '/api/returns', { orderId: pending.id }, 409);

  const right = await post(`/api/returns/${ret.id}/scan`, { epc: tags[0] });
  check('the correct garment is matched', right.verdict === 'matched', right.verdict);
  check('and the desk is told it is accepted', right.accepted === true);
  check('and the refund is taken from what was actually charged',
    Number(right.refund) === 4500, String(right.refund));

  const wrong = await post(`/api/returns/${ret.id}/scan`, { epc: tags[2] });
  check('a garment from a different order is caught', wrong.verdict === 'wrong_order', wrong.verdict);
  check('and the desk is told which order it really belongs to',
    wrong.message.includes(other.orderNo), wrong.message);
  check('and it is not accepted', wrong.accepted === false);

  const never = await post(`/api/returns/${ret.id}/scan`, { epc: tags[4] });
  check('a garment that never left the warehouse is caught',
    never.verdict === 'not_shipped', never.verdict);

  const foreign = await post(`/api/returns/${ret.id}/scan`, { epc: nextTag() });
  check('a tag that is not ours at all is caught', foreign.verdict === 'unknown_tag', foreign.verdict);

  await refuses('the same tag cannot be scanned onto a return twice', 'POST',
    `/api/returns/${ret.id}/scan`, { epc: tags[0] }, 409);

  const beforeClose = await get(`/api/items/by-epc/${tags[0]}`);
  check('nothing is restocked until the return is closed',
    beforeClose.item.status === 'shipped', beforeClose.item.status);

  const closed = await post(`/api/returns/${ret.id}/close`, { restockRoomId: roomReturns.id });
  check('closing the return restocks only the garment that matched',
    closed.restocked === 1, JSON.stringify(closed));
  check('and refunds only what that garment was charged at',
    Number(closed.refund) === 4500, String(closed.refund));
  check('and says the order is not fully returned', closed.orderFullyReturned === false);

  const restocked = await get(`/api/items/by-epc/${tags[0]}`);
  check('the returned garment is back in stock', restocked.item.status === 'in_stock');
  check('in the room the desk sent it to', restocked.item.room_code === 'RETURNS');

  const afterReturn = await get(`/api/orders/${order.id}`);
  check('the order records the refund', Number(afterReturn.order.refunded_total) === 4500);
  check('and is marked partly returned', afterReturn.order.status === 'partly_returned',
    afterReturn.order.status);

  const wrongOrderItem = await get(`/api/items/by-epc/${tags[2]}`);
  check('the garment from the other order was not touched',
    wrongOrderItem.item.status === 'shipped', wrongOrderItem.item.status);

  section('Stock value, up and down');

  const stock = await get('/api/overview');
  check('the overview counts what is in stock', Number(stock.stock.in_stock) >= 3);
  check('and puts a value on it', Number(stock.stock.stock_value) > 0);
  check('and knows the revenue that has been billed', Number(stock.orders.revenue) > 0);
  // Not an equality: these are warehouse-wide totals, and the test is meant to
  // be runnable against a database that already has history in it.
  check('and the refunds against it', Number(stock.orders.refunded) >= 4500,
    String(stock.orders.refunded));

  const byColor = await get('/api/stock?by=color');
  const navyRow = byColor.rows.find((r) => r.label === navy.name);
  check('stock can be rolled up by colour', Number(navyRow.in_stock) >= 1);

  const bySize = await get('/api/stock?by=size');
  check('and by size', bySize.rows.some((r) => Number(r.in_stock) > 0));

  const byRoom = await get('/api/stock?by=room');
  check('and by room', byRoom.rows.some((r) => r.label === 'A1'));

  section('Finding a garment');

  const find = await post('/api/find', { epc: tags[3], note: 'SMOKE not on the shelf' });
  check('a tag can be put on the find list', find.addedCount === 1, JSON.stringify(find));

  const dupFind = await post('/api/find', { epc: tags[3] });
  check('adding it twice is refused, and says so rather than failing silently',
    dupFind.addedCount === 0 && dupFind.skippedCount === 1,
    JSON.stringify(dupFind));

  const bySku = await post('/api/find', { search: navyMedium.sku });
  check('a whole product code can be put on the list at once', bySku.addedCount >= 1,
    JSON.stringify(bySku));

  const list = await get('/api/find?status=open');
  const mine = list.requests.find((r) => r.epc === tags[3]);
  check('the handheld sees the open list', !!mine);
  check('with enough to tell the operator what to look for',
    mine.product_name?.includes('SMOKE') && mine.color_name === navy.name,
    JSON.stringify({ p: mine.product_name, c: mine.color_name }));
  check('and where it was last seen', !!mine.last_room_code, mine.last_room_code);

  await post(`/api/find/${mine.id}/found`, { roomId: roomA1.id });
  const afterFound = await get('/api/find?status=open');
  check('marking it found takes it off every handheld',
    !afterFound.requests.some((r) => r.id === mine.id));

  section('The rules that protect the ledger');

  await refuses('a room still holding stock cannot be closed', 'PATCH',
    `/api/rooms/${roomA1.id}/active`, { active: 0 }, 409);

  await refuses('a product with tagged garments cannot become dropship', 'PATCH',
    `/api/products/${product.id}`, { name: null, categoryId: 0, stockType: 'dropship' }, 409);

  const history = await get(`/api/items/by-epc/${tags[0]}`);
  const full = await get(`/api/items/${history.item.id}`);
  check('a garment carries its whole history',
    full.history.length >= 4, `${full.history.length} movements`);
  check('and the history starts with the intake',
    full.history.at(-1).type === 'intake', full.history.at(-1).type);
  check('and records the return', full.history.some((h) => h.type === 'restock'));

  const move = await post('/api/items/move', {
    epcs: [tags[3], 'NOT-A-TAG', nextTag()],
    roomId: rooms.find((r) => r.code === 'B2').id,
  });
  check('a bulk move takes the tags it knows', move.moved === 1, JSON.stringify(move));
  check('and reports the ones it does not, rather than failing the lot',
    move.skipped.length === 2, JSON.stringify(move.skipped));

  section('Orders that arrive as a spreadsheet');

  // The file has no order number and no date. Those two are what the import
  // exists to mint, so they are what these checks are really about.
  const dressName = `SMOKE Imported Gown ${stamp}`;
  const importDay = '2026-03-04';

  const preview = await post('/api/orders/import/preview', {
    rows: [{ customerName: 'SMOKE Spreadsheet', dressName }],
  });
  check('a dress the catalogue has never heard of matches nothing',
    preview.dresses[0].matched === 0, JSON.stringify(preview.dresses));

  const refused = await post('/api/orders/import', {
    rows: [{ customerName: 'SMOKE Spreadsheet', dressName, total: 120 }],
    createMissing: false,
  });
  check('and the row is left alone rather than guessed at',
    refused.imported === 0 && refused.skippedCount === 1, JSON.stringify(refused));
  check('with a reason that says what to do',
    /not in the catalogue/i.test(refused.skipped[0].reason), refused.skipped[0].reason);

  const run = await post('/api/orders/import', {
    rows: [
      { customerName: 'SMOKE Spreadsheet One', dressName, total: 120.55,
        phone: '+60 12-000 0001', address: 'A Street, A Town, A State, Malaysia',
        city: 'A Town', postalCode: '47810', paymentType: 'COD' },
      { customerName: 'SMOKE Spreadsheet Two', dressName, total: 90, paymentType: 'Paid' },
      { customerName: '', dressName, total: 10 },
    ],
    placedAt: `${importDay}T12:00:00`,
    createMissing: true,
    categoryId: shalwar.id,
    stockType: 'dropship',
  });

  check('two good rows import and the nameless one does not',
    run.imported === 2 && run.skippedCount === 1, JSON.stringify(run));
  check('a row with no customer says so',
    /customer name/i.test(run.skipped[0].reason), run.skipped[0].reason);
  check('the dress is invented once, not once per row',
    run.productsCreatedCount === 1, JSON.stringify(run.productsCreated));

  const firstNo = run.orders[0].orderNo;
  check('every order gets a number the file did not have',
    /^SO-\d{8}-\d{4}$/.test(firstNo), firstNo);
  check('and the number carries the date it was given, not today',
    firstNo.startsWith('SO-20260304-'), firstNo);

  const importedOrder = (await get(`/api/orders/${run.orders[0].id}`)).order;
  check('the date it was given is the date it was placed',
    importedOrder.placed_at.startsWith(importDay), importedOrder.placed_at);
  check('the total survives to the penny',
    Number(importedOrder.total) === 120.55, importedOrder.total);
  check('the postcode is kept', importedOrder.postal_code === '47810');
  check('COD is recorded as money still owed', importedOrder.payment_type === 'cod');
  check('and Paid on the next row is not',
    (await get(`/api/orders/${run.orders[1].id}`)).order.payment_type === 'paid');
  check('a dropship-only order waits to be sent out by hand, since nothing can be scanned',
    importedOrder.status === 'pending', importedOrder.status);
  const sentByHand = await post(`/api/orders/${run.orders[0].id}/ship`, {});
  check('and Send it out sends it without a scan',
    sentByHand.ok && (await get(`/api/orders/${run.orders[0].id}`)).order.status === 'shipped');

  const second = await post('/api/orders/import', {
    rows: [{ customerName: 'SMOKE Spreadsheet Three', dressName, total: 120 }],
    createMissing: true,
    categoryId: shalwar.id,
  });
  check('importing the same dress again matches it instead of inventing it twice',
    second.imported === 1 && second.productsCreatedCount === 0, JSON.stringify(second));

  section('Permissions');

  // Stamped, so a second run does not collide with the operator the first
  // run created.
  const opName = `smoke_op_${stamp}`.toLowerCase();

  await post('/api/users', {
    username: opName,
    password: 'operator123',
    fullName: 'SMOKE Operator',
    role: 'operator',
  });

  const adminToken = token;
  const opLogin = await post('/api/auth/login', { username: opName, password: 'operator123' });
  token = opLogin.token;

  check('an operator can sign in', !!token);
  const opBatches = await get('/api/batches');
  check('and can see the intakes', Array.isArray(opBatches.batches));

  await refuses('but cannot create a product', 'POST', '/api/products',
    { name: 'SMOKE Nope', categoryId: shalwar.id, costPrice: 1, salePrice: 1 }, 403);

  await refuses('and cannot add a room', 'POST', '/api/rooms',
    { code: 'ZZ', name: 'Nope' }, 403);

  token = adminToken;

  token = null;
  await refuses('signed out, nothing is readable', 'GET', '/api/items', undefined, 401);
  token = adminToken;
} catch (err) {
  console.error(`\nThe run stopped early: ${err.message}`);
  failures.push(`run aborted: ${err.message}`);
}

// --------------------------------------------------------------- verdict

console.log(`\n${'-'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`All ${passed} checks passed.`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
