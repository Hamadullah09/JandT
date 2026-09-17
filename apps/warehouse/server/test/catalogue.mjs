/**
 * The catalogue as the warehouse now uses it.
 *
 * Four things, each a sentence about the business:
 *
 *   - A new product is added with how many of each colour and size arrived,
 *     and that becomes an intake waiting on the handheld to be tagged.
 *   - Products carry photos, and the product search shows them with every
 *     colour and size and how many are on a shelf.
 *   - "Find" beside a colour and size hunts any one of them, and finding one
 *     stops every handheld hunting the rest.
 *   - Returns are taken in the returns room: sweep, grade (1 unless changed),
 *     add - and the tag works out which order each garment came from.
 *
 *   node test/catalogue.mjs [baseUrl]
 *
 * It writes to whatever database the server is pointed at. Everything it
 * creates is prefixed CAT so it can be found.
 */

import http from 'node:http';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5080').replace(/\/$/, '');

let token = null;
let passed = 0;
const failures = [];

async function call(method, path, body, { raw = false, form = null, auth = true } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (!form) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* left null */ }

  if (raw) return { status: res.status, json, text, headers: res.headers };
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
  }
  return json;
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
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

async function refuses(description, method, path, body, status) {
  const r = await call(method, path, body, { raw: true });
  check(description, r.status === status, `expected ${status}, got ${r.status}: ${r.json?.error?.message ?? ''}`);
  return r;
}

function section(title) {
  console.log(`\n${title}`);
}

// Real images, not just the right first bytes, so a browser or the handheld
// could genuinely draw what this uploads.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64');

/**
 * Starts an upload that says it is [bytes] long and sends none of it, and
 * returns what the server answers. A server that reads the length and refuses
 * straight away answers; one that waits for the body never does.
 */
function announceUpload(path, bytes) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`no answer to an upload announced as ${bytes} bytes`));
    }, 10000);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data; boundary=----catalogue',
        'Content-Length': String(bytes),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        req.destroy();
        let json = null;
        try { json = JSON.parse(text); } catch { /* left null */ }
        resolve({ status: res.statusCode, json });
      });
    });
    // The server may close the connection once it has answered, with the body
    // still unsent - expected here, and not a failure of the check.
    req.on('error', () => {});
    req.flushHeaders();
  });
}

function photoForm(files) {
  const form = new FormData();
  for (const [name, bytes, type] of files) form.append('files', new Blob([bytes], { type }), name);
  return form;
}

const stamp = Date.now().toString(16).toUpperCase().slice(-8);
let tagSeq = 0;
const nextTag = () => `CA7${stamp}${String(++tagSeq).padStart(13, '0')}`.slice(0, 24);

async function main() {
  section('Signing in');
  const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
  token = login.token;
  check('admin can sign in', !!token);

  const cats = (await get('/api/categories')).rows;
  const colors = (await get('/api/colors')).rows;
  const sizes = (await get('/api/sizes')).rows;
  const rooms = (await get('/api/rooms')).rooms ?? (await get('/api/rooms')).rows;
  const category = cats[0];
  const [c1, c2] = colors;
  const [s1, s2] = sizes;
  const receiving = rooms.find((r) => r.kind === 'receiving');
  const returnsRoom = rooms.find((r) => r.kind === 'returns');
  check('there is a goods-in room and a returns room to work with', !!receiving && !!returnsRoom);

  // ------------------------------------------------------------------ add product with stock
  section('A new product, with how many arrived');

  const created = await post('/api/products/with-stock', {
    name: `CAT Silk Embroidered 3 Piece Suit ${stamp}`,
    categoryId: category.id,
    description: 'Ready to wear',
    stockType: 'stock',
    supplier: 'CAT Supplier',
    costPrice: 60,
    salePrice: 99,
    lines: [
      { colorId: c1.id, sizeId: s1.id, quantity: 3 },
      { colorId: c1.id, sizeId: s2.id, quantity: 0 },
      { colorId: c2.id, sizeId: s1.id, quantity: 2 },
      { colorId: c2.id, sizeId: s2.id, quantity: 5 },
    ],
  });
  check('it is created in one step', created.ok && created.id > 0, JSON.stringify(created));
  check('with every colour and size, including the one with none', created.variants === 4);
  check('and the total is what was typed', created.total === 10, String(created.total));
  check('and an intake is opened for it', created.batchId > 0 && /^BAT-\d{8}-\d{4}$/.test(created.batchNo ?? ''),
    created.batchNo);

  const product = await get(`/api/products/${created.id}`);
  check('the product has its four colours and sizes', product.variants.length === 4);

  const batch = await get(`/api/batches/${created.batchId}`);
  const batchInfo = batch.batch ?? batch;
  const lines = batch.lines ?? [];
  check('the intake is open, waiting to be tagged', batchInfo.status === 'open', batchInfo.status);
  check('it has a line for each colour and size that has a quantity, and none for the zero',
    lines.length === 3, String(lines.length));
  check('the quantities are the ones typed',
    JSON.stringify(lines.map((l) => Number(l.quantity)).sort()) === JSON.stringify([2, 3, 5]),
    JSON.stringify(lines.map((l) => l.quantity)));
  check('it is booked into the goods-in room', Number(batchInfo.room_id) === Number(receiving.id),
    `${batchInfo.room_id} vs ${receiving.id}`);

  const openBatches = (await get('/api/batches?status=open')).batches;
  check('the handheld\'s "Book stock in" list shows it', openBatches.some((b) => b.id === created.batchId));

  const twoLine = lines.find((l) => Number(l.quantity) === 2);
  const t1 = nextTag();
  const t2 = nextTag();
  const a1 = await post(`/api/batches/${created.batchId}/assign`, { epc: t1, batchLineId: twoLine.id });
  const a2 = await post(`/api/batches/${created.batchId}/assign`, { epc: t2, batchLineId: twoLine.id });
  check('tagging counts the line down', a1.remaining === 1 && a2.remaining === 0,
    `${a1.remaining}, ${a2.remaining}`);
  await refuses('and the tag past the quantity typed is refused', 'POST',
    `/api/batches/${created.batchId}/assign`, { epc: nextTag(), batchLineId: twoLine.id }, 409);

  const dropship = await post('/api/products/with-stock', {
    name: `CAT Dropship Dupatta ${stamp}`, categoryId: category.id, stockType: 'dropship',
    costPrice: 10, salePrice: 25,
    lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 7 }],
  });
  const dropshipDetail = await get(`/api/products/${dropship.id}`);
  check('a dropship product opens no intake - it is never tagged', dropship.batchId === null);
  check('its quantity becomes what the supplier can send', Number(dropshipDetail.variants[0].dropship_qty) === 7,
    String(dropshipDetail.variants[0].dropship_qty));

  const empty = await post('/api/products/with-stock', {
    name: `CAT Coming Soon ${stamp}`, categoryId: category.id, stockType: 'stock', costPrice: 1, salePrice: 2,
    lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 0 }],
  });
  check('a product with nothing arrived yet is created without an empty intake',
    empty.id > 0 && empty.batchId === null && empty.total === 0);

  const merged = await post('/api/products/with-stock', {
    name: `CAT Merged ${stamp}`, categoryId: category.id, stockType: 'stock', costPrice: 1, salePrice: 2,
    lines: [
      { colorId: c1.id, sizeId: s1.id, quantity: 2 },
      { colorId: c1.id, sizeId: s1.id, quantity: 3 },
    ],
  });
  check('the same colour and size sent twice is one line with the two added together',
    merged.variants === 1 && merged.total === 5);

  await refuses('a product needs a name', 'POST', '/api/products/with-stock',
    { name: ' ', categoryId: category.id, costPrice: 0, salePrice: 0, lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 1 }] }, 400);
  await refuses('and at least one colour and size', 'POST', '/api/products/with-stock',
    { name: 'CAT x', categoryId: category.id, costPrice: 0, salePrice: 0, lines: [] }, 400);
  await refuses('and no negative quantity', 'POST', '/api/products/with-stock',
    { name: 'CAT x', categoryId: category.id, costPrice: 0, salePrice: 0, lines: [{ colorId: c1.id, sizeId: s1.id, quantity: -1 }] }, 400);
  await refuses('and a colour that exists', 'POST', '/api/products/with-stock',
    { name: 'CAT x', categoryId: category.id, costPrice: 0, salePrice: 0, lines: [{ colorId: 999999, sizeId: s1.id, quantity: 1 }] }, 400);
  await refuses('and a category that exists', 'POST', '/api/products/with-stock',
    { name: 'CAT x', categoryId: 999999, costPrice: 0, salePrice: 0, lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 1 }] }, 404);

  // ------------------------------------------------------------------ photos
  section('Photos');

  const up = await call('POST', `/api/products/${created.id}/photos`, undefined, {
    form: photoForm([['front.jpg', JPEG_1PX, 'image/jpeg'], ['back.png', PNG_1PX, 'image/png']]),
  });
  check('two photos upload at once', up.ok && up.added === 2 && up.photos.length === 2, JSON.stringify(up));

  const [front, back] = up.photos;
  const served = await fetch(BASE + front.url);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check('a photo is served back at its address', served.status === 200, String(served.status));
  check('as exactly the bytes that were uploaded', servedBytes.equals(JPEG_1PX));
  check('without needing a sign-in, so an image tag and the handheld can draw it', served.status === 200);

  const withPhotos = await get(`/api/products/${created.id}`);
  check('the product page lists its photos, in order', withPhotos.photos.length === 2
    && withPhotos.photos[0].id === front.id);

  const listed = (await get(`/api/products?search=${encodeURIComponent(stamp)}`)).products
    .find((p) => p.id === created.id);
  check('the product list carries the cover photo', listed?.photo_url === front.url, listed?.photo_url);

  const covered = await post(`/api/products/${created.id}/photos/${back.id}/cover`, {});
  check('another photo can be made the cover', covered.photos[0].id === back.id,
    JSON.stringify(covered.photos.map((p) => p.id)));

  const relisted = (await get(`/api/products?search=${encodeURIComponent(stamp)}`)).products
    .find((p) => p.id === created.id);
  check('and the list follows it', relisted?.photo_url === back.url);

  const notImage = await call('POST', `/api/products/${created.id}/photos`, undefined, {
    raw: true, form: photoForm([['virus.jpg', Buffer.from('this is not a picture at all'), 'image/jpeg']]),
  });
  check('a file that is not really a photo is refused, whatever it is called', notImage.status === 400,
    `${notImage.status}: ${notImage.json?.error?.message}`);

  const mixed = await call('POST', `/api/products/${created.id}/photos`, undefined, {
    raw: true,
    form: photoForm([['good.png', PNG_1PX, 'image/png'], ['bad.jpg', Buffer.from('nope nope nope'), 'image/jpeg']]),
  });
  const afterMixed = await get(`/api/products/${created.id}`);
  check('one bad file refuses the whole upload', mixed.status === 400, String(mixed.status));
  check('and keeps none of it - not even the good one', afterMixed.photos.length === 2,
    String(afterMixed.photos.length));

  // Four phone photos of 8 MB: 32 MB in one request, over the 28 MB or so a
  // server takes by default. Put on the dropship product, so the photo checks
  // on the main one are not disturbed, and removed again afterwards.
  const phonePhoto = Buffer.concat([JPEG_1PX, Buffer.alloc(8 * 1024 * 1024 - JPEG_1PX.length)]);
  const big = await call('POST', `/api/products/${dropship.id}/photos`, undefined, {
    raw: true,
    form: photoForm([1, 2, 3, 4].map((n) => [`phone-${n}.jpg`, phonePhoto, 'image/jpeg'])),
  });
  check('four 8 MB phone photos go up in one upload (32 MB)', big.status === 201 && big.json?.added === 4,
    `${big.status}: ${big.json?.error?.message ?? big.json?.added}`);
  const bigServed = big.json?.photos?.[0] ? await fetch(BASE + big.json.photos[0].url) : null;
  const bigBytes = bigServed ? Buffer.from(await bigServed.arrayBuffer()) : Buffer.alloc(0);
  check('and each is stored whole', bigBytes.length === phonePhoto.length, String(bigBytes.length));
  for (const ph of big.json?.photos ?? []) await del(`/api/products/${dropship.id}/photos/${ph.id}`);

  const overTen = await call('POST', `/api/products/${dropship.id}/photos`, undefined, {
    raw: true,
    form: photoForm([['huge.jpg', Buffer.concat([JPEG_1PX, Buffer.alloc(10 * 1024 * 1024 + 1 - JPEG_1PX.length)]), 'image/jpeg']]),
  });
  check('a photo just over 10 MB is refused', overTen.status === 400, String(overTen.status));
  check('saying how big it is without claiming 10 MB is over 10 MB',
    overTen.json?.error?.message === 'huge.jpg is 10.1 MB. Photos can be up to 10 MB.', overTen.json?.error?.message);

  const tooMuch = await announceUpload(`/api/products/${dropship.id}/photos`, 200 * 1024 * 1024);
  check('an upload bigger than twelve photos can be is refused at once, before it is sent', tooMuch.status === 413,
    String(tooMuch.status));
  check('with a sentence saying what is allowed',
    /up to 12 photos, up to 10 MB each/.test(tooMuch.json?.error?.message ?? ''), tooMuch.json?.error?.message);
  const afterRefusals = await get(`/api/products/${dropship.id}`);
  check('and none of those refusals left a photo behind', afterRefusals.photos.length === 0,
    String(afterRefusals.photos.length));

  const removed = await del(`/api/products/${created.id}/photos/${front.id}`);
  check('a photo can be removed', removed.photos.length === 1 && removed.photos[0].id === back.id);
  const gone = await fetch(BASE + front.url);
  check('and its address then answers 404, not the dashboard page', gone.status === 404, String(gone.status));

  // ------------------------------------------------------------------ search
  section('Product search with photos');

  const byName = (await get(`/api/products/search?q=${encodeURIComponent(`Silk Embroidered 3 Piece Suit ${stamp}`)}`)).products;
  const hit = byName.find((p) => p.id === created.id);
  check('searching the name finds it', !!hit);
  check('with its photo', hit?.photo_url === back.url, hit?.photo_url);
  check('and every colour and size under it', hit?.variants.length === 4, String(hit?.variants.length));
  const taggedVariant = hit?.variants.find((v) => v.id === twoLine.variant_id);
  check('with how many of each are on a shelf', Number(taggedVariant?.in_stock) === 2,
    String(taggedVariant?.in_stock));
  check('and the product total', Number(hit?.in_stock) === 2, String(hit?.in_stock));

  const byColour = (await get(`/api/products/search?q=${encodeURIComponent(c2.name)}`)).products;
  check('searching a colour finds products that come in it', byColour.some((p) => p.id === created.id));

  const newest = (await get('/api/products/search')).products;
  check('an empty search still shows products, so the handheld opens on something', newest.length > 0);

  // ------------------------------------------------------------------ tap to find
  section('Find any one of a colour and size');

  // Five garments of one colour and size, tagged the way the handheld tags them.
  const fiveLine = lines.find((l) => Number(l.quantity) === 5);
  const five = [];
  for (let i = 0; i < 5; i++) {
    const epc = nextTag();
    await post(`/api/batches/${created.batchId}/assign`, { epc, batchLineId: fiveLine.id });
    five.push(epc);
  }

  const find = await post(`/api/find/variant/${fiveLine.variant_id}`, {});
  check('every one on a shelf goes on the list', find.addedCount === 5, JSON.stringify(find));
  check('as one hunt', typeof find.groupKey === 'string' && find.groupKey.length > 0);

  const openFinds = (await get('/api/find?status=open')).requests.filter((r) => r.group_key === find.groupKey);
  check('the handhelds can see which requests belong to that hunt', openFinds.length === 5);

  const again = await post(`/api/find/variant/${fiveLine.variant_id}`, {});
  check('asking again does not put the same garments on twice', again.addedCount === 0 && again.alreadyCount === 5,
    JSON.stringify(again));

  const found = await post(`/api/find/${openFinds[0].id}/found`, { roomId: receiving.id });
  check('finding one of them stops the hunt for the other four', found.siblingsCleared === 4,
    JSON.stringify(found));
  const stillOpen = (await get('/api/find?status=open')).requests.filter((r) => r.group_key === find.groupKey);
  check('so none of them is left on any handheld', stillOpen.length === 0, String(stillOpen.length));

  // Stopping a hunt is the same: it is one hunt, whichever row it is stopped on.
  const hunt2 = await post(`/api/find/variant/${fiveLine.variant_id}`, {});
  check('the same colour and size can be hunted again', hunt2.addedCount === 5 && !!hunt2.groupKey,
    JSON.stringify(hunt2));
  const hunt2Rows = (await get('/api/find?status=open')).requests.filter((r) => r.group_key === hunt2.groupKey);
  const stopped = await del(`/api/find/${hunt2Rows[2].id}`);
  check('stopping it on one row stops the other four', stopped.siblingsCleared === 4, JSON.stringify(stopped));
  const hunt2Open = (await get('/api/find?status=open')).requests.filter((r) => r.group_key === hunt2.groupKey);
  check('so nothing of that hunt is left open', hunt2Open.length === 0, String(hunt2Open.length));
  const hunt2All = (await get('/api/find?status=all')).requests.filter((r) => r.group_key === hunt2.groupKey);
  check('all five are kept, as cancelled', hunt2All.length === 5 && hunt2All.every((r) => r.status === 'cancelled'),
    JSON.stringify(hunt2All.map((r) => r.status)));

  const single = await post('/api/find', { epc: five[0], note: 'CAT single' });
  check('one garment can still be put on the list on its own', single.addedCount === 1, JSON.stringify(single));
  const singleRow = (await get('/api/find?status=open')).requests.find((r) => r.epc === five[0] && !r.group_key);
  const singleStop = await del(`/api/find/${singleRow?.id}`);
  check('and stopping it stops only that one', singleStop.ok && singleStop.siblingsCleared === 0,
    JSON.stringify(singleStop));
  await refuses('stopping it a second time says it is already closed', 'DELETE', `/api/find/${singleRow?.id}`,
    undefined, 404);

  const noneLine = product.variants.find((v) => !lines.some((l) => l.variant_id === v.id));
  await refuses('a colour and size with none on a shelf has nothing to find', 'POST',
    `/api/find/variant/${noneLine.id}`, {}, 409);
  await refuses('and a dropship one is never here to find', 'POST',
    `/api/find/variant/${dropshipDetail.variants[0].id}`, {}, 409);

  // ------------------------------------------------------------------ returns room
  section('Returns, taken in the returns room');

  // Two orders go out: one with three garments, one with one.
  const threeLine = lines.find((l) => Number(l.quantity) === 3);
  const three = [];
  for (let i = 0; i < 3; i++) {
    const epc = nextTag();
    await post(`/api/batches/${created.batchId}/assign`, { epc, batchLineId: threeLine.id });
    three.push(epc);
  }

  const orderA = await post('/api/orders', {
    customerName: `CAT Emily ${stamp}`, lines: [{ variantId: threeLine.variant_id, quantity: 3 }],
  });
  for (const epc of three) await post(`/api/orders/${orderA.id}/pick`, { epc });

  const orderB = await post('/api/orders', {
    customerName: `CAT Menaga ${stamp}`, lines: [{ variantId: fiveLine.variant_id, quantity: 2 }],
  });
  await post(`/api/orders/${orderB.id}/pick`, { epc: five[1] });
  await post(`/api/orders/${orderB.id}/pick`, { epc: five[2] });

  const orderADetail = await get(`/api/orders/${orderA.id}`);
  const unitA = Number(orderADetail.lines[0].unit_price);

  const checked = (await post('/api/returns/check', {
    epcs: [three[0], three[1], five[3], 'E2000000000000000000DEAD', three[0]],
  })).results;
  const stateOf = (epc) => checked.find((r) => r.epc === epc)?.state;
  check('a garment that went out on an order is a return', stateOf(three[0]) === 'returnable');
  check('a garment still on a shelf is not', stateOf(five[3]) === 'not_shipped', stateOf(five[3]));
  check('a tag that is not ours is not', stateOf('E2000000000000000000DEAD') === 'not_ours');
  check('the same tag read twice in a sweep is reported once', checked.length === 4, String(checked.length));
  const r0 = checked.find((r) => r.epc === three[0]);
  check('a return says which order, tracking number and customer it came from',
    r0.order_no === orderA.orderNo && r0.tracking_id > 0 && r0.customer_name === `CAT Emily ${stamp}`,
    JSON.stringify(r0));

  await refuses('a grade outside 1 to 3 is refused', 'POST', '/api/returns/intake',
    { items: [{ epc: three[0], reusability: 4 }] }, 400);
  await refuses('and so is adding nothing', 'POST', '/api/returns/intake', { items: [] }, 400);

  const intake = await post('/api/returns/intake', {
    items: [
      { epc: three[0] },                    // left at the default
      { epc: three[1], reusability: 3 },
      { epc: three[2], reusability: 2 },
      { epc: five[1], reusability: 1 },
      { epc: five[3] },                     // on a shelf - not a return
    ],
  });
  check('every real return is added', intake.added === 4, JSON.stringify(intake));
  check('grade 1 - the default - goes back into stock', intake.restocked === 2, String(intake.restocked));
  check('grade 2 is kept as damaged', intake.damaged === 1, String(intake.damaged));
  check('grade 3 is written off', intake.writtenOff === 1, String(intake.writtenOff));
  check('what is not a return is left out and says why', intake.skipped.length === 1
    && intake.skipped[0].state === 'not_shipped');
  check('into the returns room', intake.room === returnsRoom.code, intake.room);
  check('one return per order, worked out from the tags', intake.returns.length === 2,
    JSON.stringify(intake.returns));

  const item = async (epc) => (await get(`/api/items/by-epc/${epc}`)).item;
  const i0 = await item(three[0]);
  const i1 = await item(three[1]);
  const i2 = await item(three[2]);
  check('the default garment is in stock', i0.status === 'in_stock', i0.status);
  check('in the returns room', Number(i0.room_id) === Number(returnsRoom.id));
  check('the grade 3 garment is written off', i1.status === 'written_off', i1.status);
  check('the grade 2 garment is damaged, in the returns room',
    i2.status === 'damaged' && Number(i2.room_id) === Number(returnsRoom.id), `${i2.status} ${i2.room_id}`);

  const retA = intake.returns.find((r) => r.order_id === orderA.id);
  const retADetail = await get(`/api/returns/${retA.id}`);
  check('the return is closed and carries the tracking number', retADetail.ret.status === 'closed'
    && retADetail.ret.tracking_id === r0.tracking_id);
  const gradeOf = (epc) => retADetail.lines.find((l) => l.epc === epc)?.reusability;
  check('each line keeps the grade it was given',
    gradeOf(three[0]) === 1 && gradeOf(three[1]) === 3 && gradeOf(three[2]) === 2,
    JSON.stringify(retADetail.lines.map((l) => [l.epc.slice(-3), l.reusability])));

  const orderAAfter = (await get(`/api/orders/${orderA.id}`)).order;
  check('the order with everything back is returned', orderAAfter.status === 'returned', orderAAfter.status);
  check('and refunded what the three garments sold for', Math.abs(Number(orderAAfter.refunded_total) - unitA * 3) < 0.01,
    `${orderAAfter.refunded_total} vs ${unitA * 3}`);

  const orderBAfter = (await get(`/api/orders/${orderB.id}`)).order;
  check('the order with one of two back is part returned', orderBAfter.status === 'partly_returned',
    orderBAfter.status);

  const rechecked = (await post('/api/returns/check', { epcs: [three[0], five[2]] })).results;
  check('a garment already added now says so', rechecked.find((r) => r.epc === three[0])?.state === 'already_returned',
    JSON.stringify(rechecked[0]));
  check('while the one still out is still a return', rechecked.find((r) => r.epc === five[2])?.state === 'returnable');

  await refuses('adding the same garments again changes nothing', 'POST', '/api/returns/intake',
    { items: [{ epc: three[0] }, { epc: three[1] }] }, 409);

  const listedReturns = (await get('/api/returns?status=closed')).returns;
  check('the returns list shows them, with tracking numbers',
    listedReturns.some((r) => r.id === retA.id && r.tracking_id === r0.tracking_id));

  // ------------------------------------------------------------------ permissions
  section('Who can do what');

  const opName = `cat_op_${stamp.toLowerCase()}`;
  await post('/api/users', { username: opName, fullName: 'CAT Operator', password: 'catpass123', role: 'operator' });
  const adminToken = token;
  token = (await post('/api/auth/login', { username: opName, password: 'catpass123' })).token;

  await refuses('an operator cannot add a product', 'POST', '/api/products/with-stock',
    { name: 'CAT nope', categoryId: category.id, costPrice: 0, salePrice: 0, lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 1 }] }, 403);
  const opUpload = await call('POST', `/api/products/${created.id}/photos`, undefined, {
    raw: true, form: photoForm([['x.png', PNG_1PX, 'image/png']]),
  });
  check('or upload photos', opUpload.status === 403, String(opUpload.status));
  const opSearch = await call('GET', '/api/products/search?q=CAT', undefined, { raw: true });
  check('but can search products', opSearch.status === 200);
  const opFind = await call('POST', `/api/find/variant/${fiveLine.variant_id}`, {}, { raw: true });
  check('and send a reader to find one', opFind.status === 201, String(opFind.status));
  const opCheck = await call('POST', '/api/returns/check', { epcs: [five[2]] }, { raw: true });
  check('and take returns in the returns room', opCheck.status === 200);

  token = null;
  const anon = await call('GET', '/api/products/search', undefined, { raw: true, auth: false });
  check('signed out, the search is not readable', anon.status === 401, String(anon.status));
  token = adminToken;

  console.log(`\n${'-'.repeat(60)}`);
  if (failures.length) {
    console.log(`${passed} passed, ${failures.length} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`All ${passed} checks passed.`);
}

main().catch((e) => {
  console.error(`\nStopped: ${e.message}`);
  process.exit(1);
});
