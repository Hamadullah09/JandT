/**
 * Fills an empty warehouse with a plausible day's worth of work.
 *
 * This is for looking at, not for testing: it exists so the dashboard can be
 * judged with real-looking numbers on it instead of an empty state. It only
 * uses the public API, so anything it produces is something a person could have
 * produced by hand.
 *
 *   node test/demo-data.mjs [baseUrl]
 *
 * Safe to run more than once — it makes new products each time rather than
 * trying to reconcile with what is there.
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5080').replace(/\/$/, '');
let token = null;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? text}`);
  return json;
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Tags are stamped with the run, so two runs never fight over a code.
const stamp = Date.now().toString(16).toUpperCase().slice(-8);
let n = 0;
const tag = () => `E280${stamp}${(n++).toString(16).toUpperCase().padStart(12, '0')}`;

const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
token = login.token;
console.log('Signed in.');

const cats = (await get('/api/categories')).rows;
const colors = (await get('/api/colors')).rows;
const sizes = (await get('/api/sizes')).rows;
const rooms = (await get('/api/rooms')).rooms;

const byCode = (list, code) => list.find((x) => x.code === code);
const room = (code) => byCode(rooms, code);

// ------------------------------------------------------------------ catalogue

const CATALOGUE = [
  {
    name: 'Embroidered Shalwar Kameez', cat: 'SHALWAR', cost: 1800, sale: 4500,
    colors: ['NAVY', 'BLACK', 'MAROON'], sizes: ['S', 'M', 'L', 'XL'],
    description: 'Cotton, hand-embroidered collar and cuffs. Unstitched trouser included.',
  },
  {
    name: 'Cotton Lawn Kurta', cat: 'KURTA', cost: 950, sale: 2400,
    colors: ['WHITE', 'BEIGE', 'GREEN'], sizes: ['S', 'M', 'L'],
    description: 'Lightweight summer lawn, side slits, mandarin collar.',
  },
  {
    name: 'Oxford Formal Shirt', cat: 'SHIRT', cost: 1200, sale: 3200,
    colors: ['WHITE', 'NAVY'], sizes: ['M', 'L', 'XL'],
    description: 'Long-sleeve Oxford cotton, button-down collar.',
  },
  {
    name: 'Wool Blend Waistcoat', cat: 'WAISTCOAT', cost: 2200, sale: 5800,
    colors: ['BLACK', 'MAROON'], sizes: ['M', 'L'],
    description: 'Five-button, satin back with adjustable strap.',
  },
  {
    name: 'Chiffon Dupatta', cat: 'DUPATTA', cost: 400, sale: 1200, dropship: true,
    supplier: 'Lahore Textiles', colors: ['MAROON', 'GREEN', 'BEIGE'], sizes: ['M'],
    description: 'Two and a half metres, hand-rolled edge. Shipped by the supplier.',
  },
];

const variantsByProduct = {};

for (const spec of CATALOGUE) {
  const product = await post('/api/products', {
    name: spec.name,
    categoryId: byCode(cats, spec.cat).id,
    description: spec.description,
    stockType: spec.dropship ? 'dropship' : 'stock',
    supplier: spec.supplier ?? null,
    costPrice: spec.cost,
    salePrice: spec.sale,
  });

  await post(`/api/products/${product.id}/variants`, {
    colorIds: spec.colors.map((c) => byCode(colors, c).id),
    sizeIds: spec.sizes.map((s) => byCode(sizes, s).id),
  });

  const detail = await get(`/api/products/${product.id}`);
  variantsByProduct[product.id] = detail.variants;

  // Dropship stock is a number the supplier gave us, not tags.
  if (spec.dropship) {
    for (const v of detail.variants) {
      await patch(`/api/variants/${v.id}`, { dropshipQty: 15 + Math.floor(Math.random() * 30) });
    }
  }

  console.log(`Product: ${spec.name} (${detail.variants.length} colours and sizes)`);
}

// Read back as one flat list: it carries stock_type per row, which is the only
// reliable way to tell which variants can be tagged and which cannot.
const allVariants = (await get('/api/variants')).variants;
const sellableFromStock = allVariants.filter((v) => v.stock_type === 'stock');
const dropshipVariants = allVariants.filter((v) => v.stock_type === 'dropship');

// ------------------------------------------------------------------- intake

const ROOMS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const tagsInStock = [];

for (const [i, roomCode] of ROOMS.entries()) {
  // Four or five colour-and-size combinations per delivery, which is what a
  // real intake looks like.
  //
  // Quantities are wholesale: this warehouse supplies stores, and a delivery is
  // measured in boxes rather than in garments. Forty to ninety of one colour
  // and size is an ordinary line; four would be a sample.
  const lines = [];
  const chosen = new Set();
  while (chosen.size < 4) chosen.add(pick(sellableFromStock));

  for (const v of chosen) {
    lines.push({ variantId: v.id, quantity: 40 + Math.floor(Math.random() * 50) });
  }

  const batch = await post('/api/batches', {
    supplier: pick(['Faisalabad Mills', 'Lahore Textiles', 'Sialkot Apparel']),
    roomId: room(roomCode).id,
    notes: `Delivery ${i + 1}`,
    lines,
  });

  const detail = await get(`/api/batches/${batch.id}`);

  for (const line of detail.lines) {
    // The last intake is left part-done on purpose, so the dashboard has an
    // open job on it the way a real Tuesday afternoon would.
    const target = i === ROOMS.length - 1
      ? Math.ceil(Number(line.quantity) / 2)
      : Number(line.quantity);

    for (let k = 0; k < target; k++) {
      const epc = tag();
      await post(`/api/batches/${batch.id}/assign`, { epc, batchLineId: line.id });
      tagsInStock.push({ epc, variantId: line.variant_id, room: roomCode });
    }
  }

  if (i !== ROOMS.length - 1) await post(`/api/batches/${batch.id}/complete`, {});
  console.log(`Intake ${batch.batchNo} into ${roomCode}: ${detail.lines.length} lines`);
}

// One delivery that came up short, so the dashboard has something genuinely
// worth acting on.
//
// Everything above arrives by the box and sits far above any sensible reorder
// level, which makes for a tidy screen and a useless one: "Running low" with
// nothing in it teaches an operator to stop looking at it. These three lines
// land under ten and show red on the overview from the first minute.
const shortLines = [];
const shortChosen = new Set();
while (shortChosen.size < 3) shortChosen.add(pick(sellableFromStock));
for (const v of shortChosen) shortLines.push({ variantId: v.id, quantity: 3 + Math.floor(Math.random() * 7) });

const shortBatch = await post('/api/batches', {
  supplier: 'Faisalabad Mills',
  roomId: room('B2').id,
  notes: 'Part shipment - rest to follow',
  lines: shortLines,
});

for (const line of (await get(`/api/batches/${shortBatch.id}`)).lines) {
  for (let k = 0; k < Number(line.quantity); k++) {
    const epc = tag();
    await post(`/api/batches/${shortBatch.id}/assign`, { epc, batchLineId: line.id });
    tagsInStock.push({ epc, variantId: line.variant_id, room: 'B2' });
  }
}
await post(`/api/batches/${shortBatch.id}/complete`, {});
console.log(`Short delivery ${shortBatch.batchNo}: ${shortLines.length} lines under ten.`);

console.log(`${tagsInStock.length} garments tagged.`);

// Reorder levels go on afterwards, and only where stock actually arrived.
//
// Setting one on every colour and size a product could theoretically exist in
// is what a real warehouse does not do: it would report forty things as
// "running low" that were never stocked in the first place, and an alert that
// is always on is an alert nobody reads.
const stockedVariantIds = new Set(tagsInStock.map((t) => t.variantId));
// Ten, the same figure the database defaults to: the warehouse wants to hear
// when a colour and size is down to fewer than ten.
for (const id of stockedVariantIds) {
  await patch(`/api/variants/${id}`, { reorderLevel: 10 });
}
console.log(`Reorder levels set on the ${stockedVariantIds.size} that are actually stocked.`);

// ------------------------------------------------------------------- orders

// Shops, not shoppers. Nobody buys one kurta from this warehouse: the orders
// come from retailers and online stores buying a size run at a time, which is
// why every order below is for several of the same colour and size.
const CUSTOMERS = [
  ['Gul Ahmed Retail — Dolmen Mall', '021-3529-0100', 'Karachi', 'Shop 214, Dolmen Mall, Clifton'],
  ['Khaadi Wholesale', '042-3577-8800', 'Lahore', 'Warehouse 4, Gulberg III'],
  ['Sapphire Online Store', '051-2654-3000', 'Islamabad', 'F-11 Markaz distribution unit'],
  ['Bareeze Outlet — Saddar', '051-5512-7700', 'Rawalpindi', '7 Bank Road, Saddar'],
  ['Limelight DHA', '021-3584-9000', 'Karachi', '88 Khayaban-e-Bukhari, DHA Phase 6'],
  ['Cross Stitch Multan', '061-4512-3300', 'Multan', '5 Gulgasht Commercial'],
  ['Alkaram Studio — Lyallpur', '041-2640-9900', 'Faisalabad', '31 Peoples Colony, Block B'],
];

const shipped = [];
const free = [...tagsInStock];

for (const [i, [name, phone, city, address]] of CUSTOMERS.entries()) {
  // A garment we actually hold, so the order can genuinely be picked.
  const wanted = [];
  const used = new Set();
  // A store orders a run, not a garment: six to eighteen units an order.
  const count = 6 + Math.floor(Math.random() * 13);

  for (let k = 0; k < count; k++) {
    const held = free.find((t) => !used.has(t.epc));
    if (!held) break;
    used.add(held.epc);
    wanted.push(held);
  }
  if (wanted.length === 0) break;

  const lines = [];
  for (const w of wanted) {
    const existing = lines.find((l) => l.variantId === w.variantId);
    if (existing) existing.quantity++;
    else lines.push({ variantId: w.variantId, quantity: 1 });
  }

  // Every third order also carries a dropship line, so mixed orders exist.
  if (i % 3 === 0 && dropshipVariants.length) {
    lines.push({ variantId: pick(dropshipVariants).id, quantity: 1 });
  }

  const order = await post('/api/orders', {
    customerName: name,
    customerPhone: phone,
    city,
    address,
    shippingFee: 250,
    discount: i === 1 ? 500 : 0,
    lines,
  });

  // The last two are left unpicked, so the "to pick" queue is not empty. The
  // rest go out as their last garment is scanned; there is no separate send.
  if (i < CUSTOMERS.length - 2) {
    for (const w of wanted) {
      await post(`/api/orders/${order.id}/pick`, { epc: w.epc });
      const at = free.findIndex((t) => t.epc === w.epc);
      if (at >= 0) free.splice(at, 1);
    }
    shipped.push({ orderId: order.id, orderNo: order.orderNo, tags: wanted });
  }

  console.log(`Order ${order.orderNo} for ${name}`);
}

// ------------------------------------------------------------------ returns

if (shipped.length >= 2) {
  // One finished return, so the money numbers have a refund in them.
  const first = shipped[0];
  const ret = await post('/api/returns', { orderId: first.orderId, reason: 'Too large' });
  await post(`/api/returns/${ret.id}/scan`, { epc: first.tags[0].epc });
  await post(`/api/returns/${ret.id}/close`, { restockRoomId: room('RETURNS').id });
  console.log(`Return ${ret.returnNo} closed against ${first.orderNo}`);

  // One still at the desk, with a wrong garment already scanned onto it so the
  // cross-check has something to show.
  const second = shipped[1];
  const open = await post('/api/returns', { orderId: second.orderId, reason: 'Colour not as pictured' });
  await post(`/api/returns/${open.id}/scan`, { epc: second.tags[0].epc });
  if (first.tags[1]) {
    await post(`/api/returns/${open.id}/scan`, { epc: first.tags[1].epc });
  }
  console.log(`Return ${open.returnNo} left open against ${second.orderNo}`);
}

// --------------------------------------------------------------------- find

for (const t of free.slice(0, 2)) {
  await post('/api/find', { epc: t.epc, note: 'Not on the shelf it should be on' });
}
console.log('Two garments put on the find list.');

console.log('\nDone. Sign in at ' + BASE + ' as admin / admin123');
