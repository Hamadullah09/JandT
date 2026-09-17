/**
 * The rest of the API.
 *
 * `smoke.mjs` drives the warehouse's main day: intake, picking, shipping, the
 * return cross-check, the find list. This covers everything either side of
 * that — the endpoints the office uses once a week and the ones that only run
 * when something has gone wrong. Between them the two files touch every route.
 *
 *   node test/features.mjs [baseUrl]
 *
 * Same rules as smoke: it writes to whatever database the server is pointed at,
 * and everything it creates is prefixed FEAT so it can be found afterwards.
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5080').replace(/\/$/, '');

let token = null;
let passed = 0;
const failures = [];

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
  try { json = text ? JSON.parse(text) : null; } catch { /* left null */ }

  if (raw) return { status: res.status, json, text };

  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
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

async function refuses(description, method, path, body, expectedStatus) {
  const { status, json } = await call(method, path, body, { raw: true });
  check(description, status === expectedStatus, `got ${status} ${json?.error?.message ?? ''}`);
  return json?.error?.message ?? '';
}

function section(title) {
  console.log(`\n${title}`);
}

const stamp = Date.now().toString(16).toUpperCase().slice(-10);
let tagCounter = 0;
const nextTag = () => `E2FE${stamp}${(tagCounter++).toString(16).toUpperCase().padStart(10, '0')}`;

/** Books one garment in and hands back its tag, so a test has stock to use. */
async function tagOne(variantId, roomId, cost = 100) {
  const batch = await post('/api/batches', {
    supplier: 'FEAT supplier',
    roomId,
    lines: [{ variantId, quantity: 1, unitCost: cost }],
  });
  const line = (await get(`/api/batches/${batch.id}`)).lines[0];
  const epc = nextTag();
  const res = await post(`/api/batches/${batch.id}/assign`, { epc, batchLineId: line.id });
  await post(`/api/batches/${batch.id}/complete`);
  return { epc, itemId: res.itemId, batchId: batch.id };
}

try {
  section('Signing in');
  const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
  token = login.token;
  const adminToken = token;
  check('admin can sign in', !!token);

  const me = await get('/api/auth/me');
  check('the token names who is holding it', me.username === 'admin', JSON.stringify(me));

  // ------------------------------------------------------------ catalogue

  section('The words the catalogue is described in');

  const catCode = `FEATCAT${stamp}`.slice(0, 30);
  const cat = await post('/api/categories', { code: catCode, name: 'FEAT Category' });
  check('a category can be added', cat.ok && cat.id > 0, JSON.stringify(cat));

  await patch(`/api/categories/${cat.id}`, { code: catCode, name: 'FEAT Category renamed' });
  const cats = (await get('/api/categories')).rows;
  check('and renamed', cats.find((c) => c.id === cat.id)?.name === 'FEAT Category renamed');

  await patch(`/api/categories/${cat.id}/active`, { active: 0 });
  const activeCats = (await get('/api/categories')).rows;
  check('switching it off takes it off the list you can pick from',
    !activeCats.some((c) => c.id === cat.id));

  const allCats = (await get('/api/categories?all=1')).rows;
  check('but it is still there when you ask for everything',
    allCats.some((c) => c.id === cat.id));

  await patch(`/api/categories/${cat.id}/active`, { active: 1 });

  const colour = await post('/api/colors', {
    code: `FEATCOL${stamp}`.slice(0, 30), name: 'FEAT Teal', hex: '#0FA3A3',
  });
  check('a colour can be added with its swatch', colour.ok && colour.id > 0);

  const size = await post('/api/sizes', {
    code: `FEATSZ${stamp}`.slice(0, 30), name: 'FEAT Tall', sortOrder: 45,
  });
  check('a size can be added at a chosen place in the order', size.ok && size.id > 0);

  const sizes = (await get('/api/sizes')).rows;
  const tallAt = sizes.findIndex((s) => s.id === size.id);
  const largeAt = sizes.findIndex((s) => s.code === 'L');
  const xlAt = sizes.findIndex((s) => s.code === 'XL');
  check('and it lands between the two it sorts between',
    tallAt > largeAt && tallAt < xlAt, `L=${largeAt} tall=${tallAt} XL=${xlAt}`);

  await refuses('a duplicate code is refused rather than silently ignored',
    'POST', '/api/colors', { code: `FEATCOL${stamp}`.slice(0, 30), name: 'FEAT Again' }, 409);

  // -------------------------------------------------------------- product

  section('A product, and the colours and sizes of it');

  const product = await post('/api/products', {
    name: 'FEAT Test Kurta',
    categoryId: cat.id,
    description: 'Made by features.mjs',
    stockType: 'stock',
    costPrice: 100,
    salePrice: 250,
  });
  check('a product can be created', product.ok && product.id > 0);

  await patch(`/api/products/${product.id}`, {
    name: 'FEAT Test Kurta renamed',
    categoryId: cat.id,
    stockType: 'stock',
    costPrice: 120,
    salePrice: 300,
  });
  const detail = await get(`/api/products/${product.id}`);
  check('its name and price can be changed',
    detail.product.name === 'FEAT Test Kurta renamed' && Number(detail.product.sale_price) === 300,
    `${detail.product.name} ${detail.product.sale_price}`);

  const grid = await post(`/api/products/${product.id}/variants`, {
    colorIds: [colour.id], sizeIds: [size.id],
  });
  check('a colour and a size make one variant', grid.added === 1, JSON.stringify(grid));

  const variant = (await get(`/api/products/${product.id}`)).variants[0];

  await patch(`/api/variants/${variant.id}`, { salePrice: 275, reorderLevel: 3 });
  const repriced = (await get(`/api/products/${product.id}`)).variants[0];
  check('a variant can override the product price',
    Number(repriced.sale_price) === 275, repriced.sale_price);
  check('and carry its own reorder level', Number(repriced.reorder_level) === 3);

  // ----------------------------------------------------------------- room

  section('Rooms and the tags on their doors');

  const room = await post('/api/rooms', {
    code: `FEATR${stamp}`.slice(0, 30), name: 'FEAT Room', kind: 'storage', capacity: 50,
  });
  check('a room can be added', room.ok && room.id > 0);

  await patch(`/api/rooms/${room.id}`, {
    code: `FEATR${stamp}`.slice(0, 30), name: 'FEAT Room renamed', kind: 'storage',
  });
  const rooms = (await get('/api/rooms')).rooms;
  check('and renamed', rooms.find((r) => r.id === room.id)?.name === 'FEAT Room renamed');

  const doorEpc = nextTag();
  const doorTag = await post('/api/room-tags', { roomId: room.id, epc: doorEpc, label: 'FEAT door' });
  check('a tag can be stuck on its door', doorTag.ok && doorTag.id > 0);

  const resolved = await get(`/api/room-tags/resolve/${doorEpc}`);
  check('and scanning that tag says which room you are standing in',
    resolved.found === true && resolved.room.id === room.id, JSON.stringify(resolved));

  const asItem = await get(`/api/items/by-epc/${doorEpc}`);
  check('a door tag is reported as a door, not as an unknown tag',
    asItem.kind === 'room', JSON.stringify(asItem));

  await refuses('the same door tag cannot be used twice',
    'POST', '/api/room-tags', { roomId: room.id, epc: doorEpc }, 409);

  // --------------------------------------------------------------- orders

  section('An order goes out when its last garment is scanned');

  const stock = await tagOne(variant.id, room.id, 120);
  const stock2 = await tagOne(variant.id, room.id, 120);

  const order = await post('/api/orders', {
    customerName: 'FEAT Shipped Customer',
    customerPhone: '0300-0000001',
    address: '1 Test Street',
    city: 'Lahore',
    postalCode: '54000',
    paymentType: 'paid',
    shippingFee: 100,
    discount: 50,
    lines: [{ variantId: variant.id, quantity: 2 }],
  });
  check('an order can be taken', order.ok && order.id > 0);

  const placed = (await get(`/api/orders/${order.id}`)).order;
  check('the postcode is kept', placed.postal_code === '54000');
  check('and whether it is already paid', placed.payment_type === 'paid');
  check('delivery and discount reach the total',
    Number(placed.total) === 275 * 2 + 100 - 50, `total=${placed.total}`);

  const picked = await post(`/api/orders/${order.id}/pick`, { epc: stock.epc });
  check('a garment can be scanned onto it', picked.outstanding === 1, JSON.stringify(picked));
  check('and the order waits for the other one', picked.orderStatus === 'pending', picked.orderStatus);

  const pickedRow = (await get(`/api/orders/${order.id}`)).picked[0];
  await del(`/api/orders/${order.id}/pick/${pickedRow.id}`);
  const afterTakeOff = await get(`/api/orders/${order.id}`);
  check('and taken off again before it ships',
    afterTakeOff.picked.length === 0 && afterTakeOff.order.status === 'pending',
    afterTakeOff.order.status);

  const backInStock = await get(`/api/items/by-epc/${stock.epc}`);
  check('taking it off puts the garment back in stock',
    backInStock.item.status === 'in_stock', backInStock.item.status);

  await post(`/api/orders/${order.id}/pick`, { epc: stock.epc });
  const last = await post(`/api/orders/${order.id}/pick`, { epc: stock2.epc });
  check('scanning the last garment sends the order out by itself',
    last.orderStatus === 'shipped' && last.outstanding === 0, JSON.stringify(last));

  const shippedOrder = await get(`/api/orders/${order.id}`);
  check('and the time it went is recorded', !!shippedOrder.order.shipped_at);
  check('with both garments shipped on it',
    shippedOrder.picked.length === 2 && shippedOrder.picked.every((p) => p.status === 'shipped'));

  const lastGarment = await get(`/api/items/by-epc/${stock2.epc}`);
  check('and off the stock count', lastGarment.item.status === 'shipped', lastGarment.item.status);

  await refuses('a garment cannot be taken off once it has gone',
    'DELETE', `/api/orders/${order.id}/pick/${shippedOrder.picked[0].id}`, undefined, 409);

  await refuses('a shipped order cannot be cancelled',
    'POST', `/api/orders/${order.id}/cancel`, {}, 409);

  section('An order that is cancelled instead');

  const spare = await tagOne(variant.id, room.id, 120);
  // Two wanted and one scanned, so it has not gone out yet.
  const doomed = await post('/api/orders', {
    customerName: 'FEAT Cancelled Customer',
    lines: [{ variantId: variant.id, quantity: 2 }],
  });
  await post(`/api/orders/${doomed.id}/pick`, { epc: spare.epc });
  const cancelled = await post(`/api/orders/${doomed.id}/cancel`, { reason: 'FEAT changed their mind' });
  check('an unshipped order can be cancelled', cancelled.ok === true, JSON.stringify(cancelled));

  const freed = await get(`/api/items/by-epc/${spare.epc}`);
  check('and the garment it was holding goes back into stock',
    freed.item.status === 'in_stock', freed.item.status);

  // -------------------------------------------------------------- returns

  section('A return that is rejected, and one that is edited');

  const r1 = await tagOne(variant.id, room.id, 120);
  const o1 = await post('/api/orders', {
    customerName: 'FEAT Rejected Return',
    lines: [{ variantId: variant.id, quantity: 1 }],
  });
  await post(`/api/orders/${o1.id}/pick`, { epc: r1.epc });

  const ret1 = await post('/api/returns', { orderId: o1.id, reason: 'FEAT not as described' });
  await post(`/api/returns/${ret1.id}/scan`, { epc: r1.epc, condition: 'resellable' });

  const line1 = (await get(`/api/returns/${ret1.id}`)).lines[0];
  await patch(`/api/returns/${ret1.id}/scan/${line1.id}`, { epc: r1.epc, condition: 'damaged' });
  const edited = (await get(`/api/returns/${ret1.id}`)).lines[0];
  check('a garment can be re-marked as damaged at the counter',
    edited.item_condition === 'damaged', edited.item_condition);

  await del(`/api/returns/${ret1.id}/scan/${line1.id}`);
  const emptied = await get(`/api/returns/${ret1.id}`);
  check('and a scan can be removed entirely before anything is committed',
    emptied.lines.length === 0, JSON.stringify(emptied.lines));

  const stillShipped = await get(`/api/items/by-epc/${r1.epc}`);
  check('removing it restocks nothing, because nothing had moved',
    stillShipped.item.status === 'shipped', stillShipped.item.status);

  const rejected = await post(`/api/returns/${ret1.id}/reject`, { notes: 'FEAT outside the window' });
  check('a return can be rejected outright', rejected.ok === true, JSON.stringify(rejected));

  const rejectedRet = (await get(`/api/returns/${ret1.id}`)).ret;
  check('and is recorded as rejected', rejectedRet.status === 'rejected', rejectedRet.status);

  await refuses('a rejected return cannot then be closed',
    'POST', `/api/returns/${ret1.id}/close`, {}, 409);

  section('A damaged garment does not go back on the shelf');

  const r2 = await tagOne(variant.id, room.id, 120);
  const o2 = await post('/api/orders', {
    customerName: 'FEAT Damaged Return',
    lines: [{ variantId: variant.id, quantity: 1 }],
  });
  await post(`/api/orders/${o2.id}/pick`, { epc: r2.epc });

  const ret2 = await post('/api/returns', { orderId: o2.id });
  await post(`/api/returns/${ret2.id}/scan`, { epc: r2.epc, condition: 'damaged' });
  const closed2 = await post(`/api/returns/${ret2.id}/close`, { restockRoomId: room.id });
  check('the return closes', closed2.ok === true, JSON.stringify(closed2));

  const damagedItem = await get(`/api/items/by-epc/${r2.epc}`);
  check('but a damaged garment is marked damaged, not in stock',
    damagedItem.item.status === 'damaged', damagedItem.item.status);

  // ----------------------------------------------------------------- find

  section('Taking something off the find list');

  const f1 = await post('/api/find', { epc: r2.epc, note: 'FEAT looking for this' });
  const fid = f1.added[0].id;
  check('a garment can be put on the list', fid > 0, JSON.stringify(f1));

  await del(`/api/find/${fid}`);
  const openFinds = (await get('/api/find?status=open')).requests;
  check('and taken off again without ever being found',
    !openFinds.some((r) => r.id === fid));

  // ---------------------------------------------------------------- items

  section('Correcting a garment by hand');

  const note = `FEAT moved by hand ${stamp}`;
  await patch(`/api/items/${r2.itemId}`, { status: 'in_stock', roomId: room.id, notes: note });
  const corrected = await get(`/api/items/${r2.itemId}`);
  check('a garment can be put right by the office',
    corrected.item.status === 'in_stock' && corrected.item.notes === note,
    `${corrected.item.status} / ${corrected.item.notes}`);

  check('and the correction is on its history, not just on the row',
    corrected.history.some((h) => h.type === 'adjust'),
    corrected.history.map((h) => h.type).join(','));

  // ------------------------------------------------- new garments on intake

  section('A delivery with garments that are not in the catalogue yet');

  const newName = `FEAT New Kurti ${stamp}`;
  const typedColourName = `FEAT Coral ${stamp}`;
  const typedSizeName = `FEAT Size ${stamp}`;
  const newLine = (extra) => ({
    variantId: 0,
    quantity: 1,
    newGarment: { name: newName, categoryId: cat.id, costPrice: 45.5, salePrice: 99.9, ...extra },
  });

  const delivery = await post('/api/batches', {
    supplier: 'FEAT supplier',
    roomId: room.id,
    lines: [
      { ...newLine({ colorId: colour.id, sizeId: size.id }), quantity: 3, unitCost: 45.5 },
      { ...newLine({ colorName: typedColourName, sizeName: typedSizeName }), quantity: 2 },
    ],
  });
  check('an intake can bring in garments that are not in the catalogue yet',
    delivery.ok && delivery.productsAdded === 1 && delivery.variantsAdded === 2, JSON.stringify(delivery));

  const made = (await get(`/api/products?search=${encodeURIComponent(newName)}`)).products;
  check('both lines made one product, not two', made.length === 1, made.map((p) => p.sku).join(','));

  const madeDetail = await get(`/api/products/${made[0].id}`);
  check('with its own code, its prices, and both colours and sizes',
    madeDetail.product.sku.startsWith(`${catCode}-`) && Number(madeDetail.product.sale_price) === 99.9
      && madeDetail.variants.length === 2,
    `${madeDetail.product.sku} ${madeDetail.product.sale_price} ${madeDetail.variants.length}`);

  const typedColour = (await get('/api/colors')).rows.find((c) => c.name === typedColourName);
  const typedSize = (await get('/api/sizes')).rows.find((s) => s.name === typedSizeName);
  check('a colour and a size typed on the form join the lists', !!typedColour && !!typedSize);

  const deliveryDetail = await get(`/api/batches/${delivery.id}`);
  check('and the intake waits to be tagged, at the cost typed',
    deliveryDetail.lines.length === 2
      && deliveryDetail.lines.reduce((n, l) => n + Number(l.quantity), 0) === 5
      && deliveryDetail.lines.every((l) => Number(l.unit_cost) === 45.5),
    JSON.stringify(deliveryDetail.lines.map((l) => [l.sku, l.quantity, l.unit_cost])));

  const again = await post('/api/batches', {
    roomId: room.id,
    lines: [{
      variantId: 0,
      quantity: 1,
      newGarment: { name: newName.toLowerCase(), colorName: typedColourName.toUpperCase(), sizeName: typedSizeName },
    }],
  });
  check('the same name again is the same product, and nothing is added twice',
    again.ok && again.productsAdded === 0 && again.variantsAdded === 0, JSON.stringify(again));

  const byId = (await get(`/api/variants?id=${madeDetail.variants[0].id}`)).variants;
  check('one colour and size can be fetched by its id, for "Book more in"',
    byId.length === 1 && byId[0].id === madeDetail.variants[0].id, JSON.stringify(byId.map((v) => v.id)));

  await refuses('a new garment needs a category',
    'POST', '/api/batches',
    { lines: [{ variantId: 0, quantity: 1, newGarment: { name: `FEAT No Category ${stamp}`, colorId: colour.id, sizeId: size.id } }] },
    400);

  const ghost = `FEAT Ghost ${stamp}`;
  await refuses('a delivery that fails part way is not saved at all',
    'POST', '/api/batches',
    { lines: [
      { variantId: 0, quantity: 1, newGarment: { name: ghost, categoryId: cat.id, colorId: colour.id, sizeId: size.id } },
      { variantId: 999999999, quantity: 1 },
    ] },
    404);
  check('and leaves no half-made product behind',
    (await get(`/api/products?search=${encodeURIComponent(ghost)}`)).products.length === 0);

  // --------------------------------------------------------------- money

  section('What the office is shown');

  const overview = await get('/api/overview');
  check('the overview counts stock', Number(overview.stock.in_stock) > 0, JSON.stringify(overview.stock));
  check('and lists where it is', Array.isArray(overview.byRoom) && overview.byRoom.length > 0);
  check('and what moved recently', Array.isArray(overview.recent) && overview.recent.length > 0);
  check('and what is running low', Array.isArray(overview.lowStock));
  check('and how many orders are waiting', overview.orders !== undefined);

  // Notifications: running low is fewer on the shelves than the level, so a
  // level of 10 warns at 9 and exactly 10 is fine.
  const low = await get('/api/low-stock');
  check('Notifications lists what is running low, and the overview counts the same',
    Array.isArray(low.variants) && Number(overview.lowStockCount) === low.variants.length,
    `counted ${overview.lowStockCount}, listed ${low.variants?.length}`);

  let onShelf = Number((await get(`/api/products/${product.id}`)).variants
    .find((v) => v.id === variant.id).in_stock);
  if (onShelf === 0) {
    await tagOne(variant.id, room.id, 120);
    onShelf = 1;
  }
  const isLow = async () => (await get('/api/low-stock')).variants.some((v) => v.id === variant.id);
  await patch(`/api/variants/${variant.id}`, { salePrice: 275, reorderLevel: onShelf + 1 });
  check('fewer on the shelves than the level is running low', await isLow(), `on the shelves ${onShelf}`);
  await patch(`/api/variants/${variant.id}`, { salePrice: 275, reorderLevel: onShelf });
  check('exactly the level is not', !(await isLow()), `on the shelves ${onShelf}`);
  await patch(`/api/variants/${variant.id}`, { salePrice: 275, reorderLevel: 0 });
  check('and 0 switches the warning off', !(await isLow()));
  await patch(`/api/variants/${variant.id}`, { salePrice: 275, reorderLevel: 3 });

  // All garments, a page at a time: two pages never share a garment.
  const page1 = await get('/api/items?limit=2&offset=0');
  const page2 = await get('/api/items?limit=2&offset=2');
  check('garments can be read a page at a time',
    page1.items.length === 2 && page2.items.length > 0 && page1.total === page2.total
      && !page2.items.some((i) => page1.items.some((f) => f.id === i.id)),
    `${page1.items.map((i) => i.id)} | ${page2.items.map((i) => i.id)} of ${page1.total}`);

  const money = await get('/api/money');
  check('the money report totals revenue', money.totals !== undefined, JSON.stringify(money).slice(0, 120));

  for (const by of ['variant', 'category', 'color', 'size', 'room']) {
    const rollup = await get(`/api/stock?by=${by}`);
    check(`stock can be rolled up by ${by}`, Array.isArray(rollup.rows), JSON.stringify(rollup).slice(0, 90));
  }

  // --------------------------------------------------------------- users

  section('Accounts');

  const username = `feat_op_${stamp}`.toLowerCase().slice(0, 30);
  const created = await post('/api/users', {
    username, password: 'feature123', fullName: 'FEAT Operator', role: 'operator',
  });
  check('an operator account can be created', created.ok && created.id > 0);

  await refuses('a username cannot be taken twice',
    'POST', '/api/users', { username, password: 'feature123', fullName: 'FEAT Again', role: 'operator' }, 409);

  await post(`/api/users/${created.id}/password`, { newPassword: 'feature456' });
  const asOperator = await post('/api/auth/login', { username, password: 'feature456' });
  check('an admin can reset somebody password and the new one works', !!asOperator.token);

  token = asOperator.token;
  await post('/api/auth/password', { currentPassword: 'feature456', newPassword: 'feature789' });
  const relogin = await post('/api/auth/login', { username, password: 'feature789' });
  check('and they can change it themselves', !!relogin.token);

  token = relogin.token;
  await refuses('an operator books stock in, but cannot add a new garment to the catalogue',
    'POST', '/api/batches',
    { roomId: room.id, lines: [{ variantId: 0, quantity: 1, newGarment: { name: `FEAT Operator ${stamp}`, categoryId: cat.id, colorId: colour.id, sizeId: size.id } }] },
    403);
  await refuses('nor delete a product', 'DELETE', `/api/products/${product.id}`, undefined, 403);

  await refuses('the old password stops working',
    'POST', '/api/auth/login', { username, password: 'feature456' }, 401);

  token = adminToken;
  await patch(`/api/users/${created.id}/active`, { active: 0 });
  await refuses('a switched-off account cannot sign in',
    'POST', '/api/auth/login', { username, password: 'feature789' }, 401);

  // ---------------------------------------------------- tidying up safely

  section('What the ledger will not let you do');

  await refuses('a room with stock in it cannot be closed',
    'PATCH', `/api/rooms/${room.id}/active`, { active: 0 }, 409);

  const emptyBatch = await post('/api/batches', {
    supplier: 'FEAT empty', roomId: room.id,
    lines: [{ variantId: variant.id, quantity: 2, unitCost: 10 }],
  });
  const gone = await del(`/api/batches/${emptyBatch.id}`);
  check('an intake nothing was tagged on can be deleted', gone.ok === true, JSON.stringify(gone));

  await refuses('but one that has garments on it cannot',
    'DELETE', `/api/batches/${stock.batchId}`, undefined, 409);

  await refuses('a variant that garments exist for cannot be deleted',
    'DELETE', `/api/variants/${variant.id}`, undefined, 409);

  section('Deleting a product');

  // One made by mistake, with a garment already booked onto it.
  const mistake = await post('/api/products', {
    name: `FEAT Mistake ${stamp}`, categoryId: cat.id, stockType: 'stock', costPrice: 10, salePrice: 20,
  });
  await post(`/api/products/${mistake.id}/variants`, { colorIds: [colour.id], sizeIds: [size.id] });
  const mistakeVariant = (await get(`/api/products/${mistake.id}`)).variants[0];
  const mistakeTag = await tagOne(mistakeVariant.id, room.id, 10);

  const usage = (await get(`/api/products/${mistake.id}`)).usage;
  check('the product page is told what deleting it would take',
    Number(usage.garments) === 1 && Number(usage.intakes) === 1 && Number(usage.orders) === 0,
    JSON.stringify(usage));

  const deleted = await del(`/api/products/${mistake.id}`);
  check('a product that was never on an order can be deleted',
    deleted.ok === true && deleted.garments === 1 && deleted.intakes === 1, JSON.stringify(deleted));
  await refuses('and it is gone', 'GET', `/api/products/${mistake.id}`, undefined, 404);
  await refuses('with the intake that had nothing else on it',
    'GET', `/api/batches/${mistakeTag.batchId}`, undefined, 404);

  const freedTag = await get(`/api/items/by-epc/${mistakeTag.epc}`);
  check('its garment went too, so the tag is unknown again', freedTag.found === false, JSON.stringify(freedTag));

  const rebooked = await post('/api/batches', {
    supplier: 'FEAT supplier', roomId: room.id, lines: [{ variantId: variant.id, quantity: 1, unitCost: 10 }],
  });
  const rebookLine = (await get(`/api/batches/${rebooked.id}`)).lines[0];
  const reassigned = await post(`/api/batches/${rebooked.id}/assign`, { epc: mistakeTag.epc, batchLineId: rebookLine.id });
  check('and it can be booked in again as something else', reassigned.ok === true, JSON.stringify(reassigned));
  await post(`/api/batches/${rebooked.id}/complete`);

  const kept = await refuses('a product that has been on an order cannot be deleted',
    'DELETE', `/api/products/${product.id}`, undefined, 409);
  check('and it says to switch it off instead', /switch it off/i.test(kept), kept);
  check('and it is still there', (await get(`/api/products/${product.id}`)).product.id === product.id);
} catch (err) {
  console.error(`\nThe run stopped early: ${err.message}`);
  failures.push(`run aborted: ${err.message}`);
}

console.log(`\n${'-'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`All ${passed} checks passed.`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
