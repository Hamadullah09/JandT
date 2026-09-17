/**
 * Search by photo.
 *
 * A picture of a garment - a customer's screenshot, a photo taken on the
 * handheld - finds the product it shows, closest first, with every colour and
 * size and a Find button, like the ordinary search.
 *
 *   node test/photosearch.mjs [baseUrl]
 *
 * Needs the recognition model on the server (models/dinov2-small.onnx). The
 * pictures are drawn here rather than kept as files: three plainly different
 * patterns are enough to prove the whole path - upload, recognition, search,
 * and every refusal - without relying on how well any one dress photographs.
 *
 * It writes to whatever database the server is pointed at. Everything it
 * creates is named PHOTOSEARCH so it can be found.
 */

import http from 'node:http';
import zlib from 'node:zlib';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5080').replace(/\/$/, '');

let token = null;
let passed = 0;
const failures = [];

async function call(method, path, body, { raw = false, form = null, auth = true } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (!form && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* left null */ }
  if (raw) return { status: res.status, json };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
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

// ------------------------------------------------------------------ pictures, drawn

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG from a function giving the colour of each pixel. */
function png(width, height, colour) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colour(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bits per channel
  header[9] = 2;   // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Three patterns nobody could mistake for one another, each as a function of
// position scaled to the picture, so a smaller copy is the same picture.
const PATTERNS = {
  stripes: (u, v) => (Math.floor(u * 12) % 2 ? [180, 20, 60] : [250, 220, 90]),
  checks: (u, v) => ((Math.floor(u * 8) + Math.floor(v * 10)) % 2 ? [20, 60, 140] : [230, 240, 250]),
  rings: (u, v) => {
    const d = Math.hypot(u - 0.5, (v - 0.5) * 1.33);
    return Math.floor(d * 18) % 2 ? [20, 120, 60] : [240, 200, 230];
  },
};
const draw = (pattern, w, h) => png(w, h, (x, y) => PATTERNS[pattern](x / w, y / h));

/** The pattern as a chat screenshot: flat bars above and below, the picture in the middle. */
const screenshot = (pattern) => png(360, 760, (x, y) => {
  if (y < 70) return [7, 94, 84];
  if (y > 700) return [255, 255, 255];
  if (x >= 40 && x < 320 && y >= 140 && y < 513) return PATTERNS[pattern]((x - 40) / 280, (y - 140) / 373);
  return [236, 229, 221];
});

const photoForm = (name, bytes, type = 'image/png', field = 'photo') => {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), name);
  return form;
};

const searchWith = (name, bytes, type) =>
  call('POST', '/api/products/search-by-photo', undefined, { raw: true, form: photoForm(name, bytes, type) });

/** An upload that says it is [bytes] long and sends none of it; what does the server answer. */
function announce(path, bytes) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('no answer')); }, 10000);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data; boundary=----photosearch',
        'Content-Length': String(bytes),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        clearTimeout(timer);
        req.destroy();
        let json = null;
        try { json = JSON.parse(text); } catch { /* left null */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', () => {});
    req.flushHeaders();
  });
}

const stamp = Date.now().toString(16).toUpperCase().slice(-8);

async function main() {
  console.log('Signing in');
  token = (await post('/api/auth/login', { username: 'admin', password: 'admin123' })).token;
  check('admin can sign in', !!token);

  const category = (await get('/api/categories')).rows[0];
  const [c1] = (await get('/api/colors')).rows;
  const [s1, s2] = (await get('/api/sizes')).rows;

  // ------------------------------------------------------------------ setup
  // Products left by an earlier run carry the very same pictures, and two
  // identical photos rightly tie - so they are switched off first, which takes
  // them out of search by photo, and this run's are switched off at the end.
  const leftovers = (await get('/api/products?search=PHOTOSEARCH')).products
    .filter((p) => p.name.startsWith('PHOTOSEARCH ') && Number(p.active) === 1);
  for (const p of leftovers) await patch(`/api/products/${p.id}/active`, { active: 0 });

  console.log('\nThree products, each photographed');
  const made = {};
  for (const pattern of Object.keys(PATTERNS)) {
    const product = await post('/api/products/with-stock', {
      name: `PHOTOSEARCH ${pattern} ${stamp}`, categoryId: category.id, stockType: 'stock',
      costPrice: 10, salePrice: 25,
      lines: [{ colorId: c1.id, sizeId: s1.id, quantity: 0 }, { colorId: c1.id, sizeId: s2.id, quantity: 0 }],
    });
    const up = await call('POST', `/api/products/${product.id}/photos`, undefined, {
      form: photoForm(`${pattern}.png`, draw(pattern, 300, 400), 'image/png', 'files'),
    });
    made[pattern] = { id: product.id, photoId: up.photos[0].id };
  }
  check('three products with a photo each', Object.keys(made).length === 3);

  // ------------------------------------------------------------------ finding
  console.log('\nFinding a product from a picture of it');

  const exact = await searchWith('stripes.png', draw('stripes', 300, 400));
  check('its own photo finds it first', exact.status === 200 && exact.json.products[0]?.id === made.stripes.id,
    `${exact.status} ${JSON.stringify(exact.json?.products?.map((p) => [p.name, p.match]))}`);
  check('as a clear match', exact.json?.clearMatch === true);
  check('and says how close, out of 1', exact.json?.products[0]?.match >= 0.99, String(exact.json?.products[0]?.match));

  const card = exact.json?.products[0] ?? {};
  check('the result is a whole product card - photo, stock, colours and sizes',
    card.name?.startsWith('PHOTOSEARCH stripes') && typeof card.photo_url === 'string'
    && Array.isArray(card.variants) && card.variants.length === 2 && 'in_stock' in card && 'sku' in card,
    JSON.stringify(Object.keys(card)));
  check('each colour and size with the id the Find button needs',
    card.variants?.every((v) => v.id > 0 && 'in_stock' in v && 'size_code' in v));

  const smaller = await searchWith('checks-small.png', draw('checks', 120, 160));
  check('a smaller copy of a photo still finds it first', smaller.json?.products[0]?.id === made.checks.id,
    JSON.stringify(smaller.json?.products?.map((p) => [p.name, p.match])));

  const shot = await searchWith('Screenshot_2026.png', screenshot('rings'));
  check('a chat screenshot with the photo in it finds it first', shot.json?.products[0]?.id === made.rings.id,
    JSON.stringify(shot.json?.products?.map((p) => [p.name, p.match])));

  check('products without a photo are counted, so the screen can say why they are missing',
    Number.isInteger(exact.json?.productsWithoutPhotos) && exact.json.productsWithoutPhotos >= 0);
  check('every photo has been read by the time it is searched', exact.json?.photosNotReadYet === 0,
    String(exact.json?.photosNotReadYet));

  // ------------------------------------------------------------------ what is searched
  console.log('\nOnly what can be sold is searched');

  await patch(`/api/products/${made.stripes.id}/active`, { active: 0 });
  const off = await searchWith('stripes.png', draw('stripes', 300, 400));
  check('a product that is switched off is not offered', !off.json?.products.some((p) => p.id === made.stripes.id),
    JSON.stringify(off.json?.products?.map((p) => p.name)));
  await patch(`/api/products/${made.stripes.id}/active`, { active: 1 });
  const on = await searchWith('stripes.png', draw('stripes', 300, 400));
  check('and is found again once it is switched back on', on.json?.products[0]?.id === made.stripes.id);

  await del(`/api/products/${made.checks.id}/photos/${made.checks.photoId}`);
  const noPhoto = await searchWith('checks.png', draw('checks', 300, 400));
  check('a photo that was removed no longer finds its product', !noPhoto.json?.products.some((p) => p.id === made.checks.id),
    JSON.stringify(noPhoto.json?.products?.map((p) => [p.name, p.match])));

  // ------------------------------------------------------------------ refusals
  console.log('\nRefusals, each with a sentence');

  const text = await searchWith('dress.jpg', Buffer.from('this is not a picture of anything'), 'image/jpeg');
  check('a file that is not a photo is refused', text.status === 400 && /not a photo/.test(text.json?.error?.message),
    `${text.status} ${text.json?.error?.message}`);

  const broken = await searchWith('broken.png', Buffer.concat([draw('rings', 60, 80).subarray(0, 16), Buffer.alloc(200, 7)]));
  check('a picture too damaged to read is refused', broken.status === 400 && /could not be read/.test(broken.json?.error?.message),
    `${broken.status} ${broken.json?.error?.message}`);

  const empty = await searchWith('empty.png', Buffer.alloc(0));
  check('an empty file is refused', empty.status === 400, `${empty.status} ${empty.json?.error?.message}`);

  const none = await call('POST', '/api/products/search-by-photo', undefined, { raw: true, form: new FormData() });
  check('no photo at all is refused', none.status === 400, `${none.status} ${none.json?.error?.message}`);

  const json = await call('POST', '/api/products/search-by-photo', { photo: 'x' }, { raw: true });
  check('a photo sent as anything but an upload is refused', json.status === 400, String(json.status));

  // Not about photos, but found by this suite: a body in the wrong shape is the
  // caller's mistake, and must not be reported as the server failing.
  const wrongShape = await call('PATCH', `/api/products/${made.rings.id}/active`, { active: 'yes please' }, { raw: true });
  check('a request body in the wrong shape is a 400 with a sentence, not a server error',
    wrongShape.status === 400 && typeof wrongShape.json?.error?.message === 'string',
    `${wrongShape.status} ${JSON.stringify(wrongShape.json)}`);

  const big = await searchWith('huge.png', Buffer.concat([draw('rings', 60, 80), Buffer.alloc(10 * 1024 * 1024)]));
  check('a photo over 10 MB is refused', big.status === 400 && /10 MB/.test(big.json?.error?.message),
    `${big.status} ${big.json?.error?.message}`);

  const announced = await announce('/api/products/search-by-photo', 200 * 1024 * 1024);
  check('an upload far too big is refused before it is sent', announced.status === 413, String(announced.status));

  // The upload of product photos now reads each one as a picture too.
  const before = (await get(`/api/products/${made.rings.id}`)).photos.length;
  const damaged = await call('POST', `/api/products/${made.rings.id}/photos`, undefined, {
    raw: true, form: photoForm('damaged.png', Buffer.concat([draw('rings', 60, 80).subarray(0, 16), Buffer.alloc(200, 7)]), 'image/png', 'files'),
  });
  const after = (await get(`/api/products/${made.rings.id}`)).photos.length;
  check('a product photo too damaged to show is refused on upload', damaged.status === 400
    && /could not be read as a picture/.test(damaged.json?.error?.message), `${damaged.status} ${damaged.json?.error?.message}`);
  check('and nothing of it is kept', after === before, `${before} → ${after}`);

  // ------------------------------------------------------------------ who
  console.log('\nWho can search by photo');

  const opName = `photosearch_${stamp.toLowerCase()}`;
  await post('/api/users', { username: opName, fullName: 'PHOTOSEARCH Operator', password: 'photopass123', role: 'operator' });
  const adminToken = token;
  token = (await post('/api/auth/login', { username: opName, password: 'photopass123' })).token;
  const asOperator = await searchWith('rings.png', draw('rings', 300, 400));
  check('an operator on the floor can', asOperator.status === 200 && asOperator.json.products[0]?.id === made.rings.id,
    String(asOperator.status));
  token = null;
  const signedOut = await searchWith('rings.png', draw('rings', 300, 400));
  check('somebody signed out cannot', signedOut.status === 401, String(signedOut.status));
  token = adminToken;

  for (const { id } of Object.values(made)) await patch(`/api/products/${id}/active`, { active: 0 });

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
