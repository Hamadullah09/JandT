/**
 * The one place that talks to the server.
 *
 * Every call goes through `request`, so the token, the error shape and the
 * "your session has ended" case are each handled once. A page never sees a
 * Response object and never has to remember to check `res.ok`.
 */

const TOKEN_KEY = 'warehouse.token';
const USER_KEY = 'warehouse.user';

export const auth = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; }
  },
  save(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch { /* a locked-down browser still works for this session */ }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch { /* nothing to clear */ }
  },
};

const ZONE_KEY = 'warehouse.timeZone';

const validZone = (zone) => {
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
};

/**
 * The shop's clock: the time zone the server keeps the business day in.
 *
 * Times are shown on it rather than on the clock of whichever computer is
 * looking, so a parcel booked at 10:05 says 10:05 here, in the courier portal
 * and on the waybill, and "today" is the day the order numbers carry. The
 * server sends it with every sign-in; until it has, the computer's own clock
 * stands in.
 */
let zone = (() => {
  try {
    const stored = localStorage.getItem(ZONE_KEY);
    return validZone(stored) ? stored : undefined;
  } catch { return undefined; }
})();

export const clock = {
  get zone() { return zone; },
  /** Takes the zone from a sign-in answer. True when it changed. */
  remember(value) {
    if (!validZone(value) || value === zone) return false;
    zone = value;
    try { localStorage.setItem(ZONE_KEY, value); } catch { /* kept for this visit */ }
    return true;
  },
};

const withClock = (answer) => {
  clock.remember(answer?.timeZone);
  return answer;
};

/** Fired when the server rejects our token, so the shell can show the login. */
export const sessionEnded = new EventTarget();

/**
 * The platform around the dashboard.
 *
 * Behind the platform gateway the dashboard is served at /warehouse/, next to
 * the J&T courier portal on the same address, and both share one sign-in: the
 * platform cookie. Run on its own (the API on its own port, or Vite) it is
 * served at the root and signs in with its own form, as it always did.
 */
export const platform = {
  get active() {
    return import.meta.env.PROD && window.location.pathname.startsWith('/warehouse');
  },
  /** The platform's sign-in page, returning here afterwards. */
  signIn() {
    const back = `/warehouse/${window.location.hash || ''}`;
    window.location.assign(`/login?next=${encodeURIComponent(back)}`);
  },
};

async function request(method, path, body) {
  // A FormData body is a file upload: the browser writes the multipart
  // boundary into Content-Type itself, so setting it here would break it.
  const isForm = body instanceof FormData;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // A dropped connection is the single most common failure in a warehouse
    // and deserves a sentence, not "TypeError: Failed to fetch".
    throw new Error('Cannot reach the server. Check that it is running.');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* handled below */ }

  if (!res.ok) {
    if (res.status === 401) {
      auth.clear();
      sessionEnded.dispatchEvent(new Event('ended'));
    }
    throw new Error(data?.error?.message ?? `Something went wrong (${res.status}).`);
  }

  return data;
}

// ------------------------------------------------------------ photos

/** As the server allows - see PhotoStore. */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_FILES = 12;

// A server takes about 28 MB in one request unless it is set up otherwise -
// IIS as well as the built-in one - and five phone photos are more than that.
// So photos go up a few at a time, each request well under it.
const PHOTO_REQUEST_BYTES = 25 * 1024 * 1024;

const megabytes = (bytes) => `${Math.ceil(bytes / (1024 * 1024) * 10) / 10} MB`;

/** Whether a file really is a JPEG, PNG or WebP, from its first bytes - the check the server makes. */
async function isPhoto(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (from, to) => String.fromCharCode(...b.slice(from, to));
  return (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x))
    || (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP');
}

/**
 * Refuses a choice of photos the server would refuse, with the same sentence,
 * before anything is sent: a wrong file is said at once rather than after a
 * minute of uploading, and never after half the photos have gone up.
 */
async function checkPhotos(chosen) {
  const files = Array.from(chosen ?? []);
  if (files.length === 0) throw new Error('Choose at least one photo.');
  if (files.length > PHOTO_MAX_FILES) throw new Error(`Up to ${PHOTO_MAX_FILES} photos at a time.`);

  for (const file of files) {
    if (file.size === 0) throw new Error(`${file.name} is empty.`);
    if (file.size > PHOTO_MAX_BYTES) {
      throw new Error(`${file.name} is ${megabytes(file.size)}. Photos can be up to ${megabytes(PHOTO_MAX_BYTES)}.`);
    }
    if (!(await isPhoto(file))) throw new Error(`${file.name} is not a photo. Use a JPEG, PNG or WebP image.`);
  }
  return files;
}

async function uploadPhotos(id, chosen) {
  const files = await checkPhotos(chosen);

  const requests = [];
  let current = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length > 0 && bytes + file.size > PHOTO_REQUEST_BYTES) {
      requests.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  requests.push(current);

  let added = 0;
  let photos = [];
  for (const part of requests) {
    const form = new FormData();
    for (const file of part) form.append('files', file, file.name);
    try {
      const res = await request('POST', `/api/products/${id}/photos`, form);
      added += res.added;
      photos = res.photos;
    } catch (err) {
      // Only a dropped connection or the server failing can stop a later part
      // once every file has passed the check. Say what did go up, so nobody
      // sends the lot again and ends up with every photo twice.
      if (added === 0) throw err;
      throw new Error(`${added} of ${files.length} photos were added; the rest were not. ${err.message}`);
    }
  }

  return { ok: true, added, photos };
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const patch = (p, b) => request('PATCH', p, b);
const del = (p) => request('DELETE', p);

/** Builds a query string, leaving out anything empty so URLs stay readable. */
const q = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== null && v !== undefined && v !== '') s.set(k, v);
  }
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const api = {
  // auth
  login: (username, password) => post('/api/auth/login', { username, password }).then(withClock),
  me: () => get('/api/auth/me').then(withClock),

  // Single sign-on: somebody already signed in on the courier portal has the
  // platform cookie; this swaps it for the token the dashboard keeps. Throws
  // (401) when there is no platform sign-in, without ending anything.
  session: async () => {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!res.ok) {
      const error = new Error('Not signed in.');
      error.status = res.status;
      throw error;
    }
    return withClock(await res.json());
  },

  // Signing out ends the platform session: the courier portal and every other
  // tab are signed out too.
  logout: () => post('/api/auth/logout', {}),
  changePassword: (currentPassword, newPassword) =>
    post('/api/auth/password', { currentPassword, newPassword }),

  // users
  users: () => get('/api/users'),
  createUser: (body) => post('/api/users', body),
  setUserActive: (id, active) => patch(`/api/users/${id}/active`, { active }),
  resetPassword: (id, newPassword) => post(`/api/users/${id}/password`, { newPassword }),

  // rooms
  rooms: () => get('/api/rooms'),
  createRoom: (body) => post('/api/rooms', body),
  updateRoom: (id, body) => patch(`/api/rooms/${id}`, body),
  setRoomActive: (id, active) => patch(`/api/rooms/${id}/active`, { active }),

  roomTags: () => get('/api/room-tags'),
  createRoomTag: (body) => post('/api/room-tags', body),
  deleteRoomTag: (id) => del(`/api/room-tags/${id}`),

  // lookups
  categories: (all) => get(`/api/categories${q({ all: all ? 1 : '' })}`),
  colors: (all) => get(`/api/colors${q({ all: all ? 1 : '' })}`),
  sizes: (all) => get(`/api/sizes${q({ all: all ? 1 : '' })}`),
  createLookup: (kind, body) => post(`/api/${kind}`, body),
  updateLookup: (kind, id, body) => patch(`/api/${kind}/${id}`, body),
  setLookupActive: (kind, id, active) => patch(`/api/${kind}/${id}/active`, { active }),

  // products
  products: (filters) => get(`/api/products${q(filters)}`),
  product: (id) => get(`/api/products/${id}`),
  createProduct: (body) => post('/api/products', body),
  updateProduct: (id, body) => patch(`/api/products/${id}`, body),
  setProductActive: (id, active) => patch(`/api/products/${id}/active`, { active }),
  deleteProduct: (id) => del(`/api/products/${id}`),
  addVariants: (id, colorIds, sizeIds) => post(`/api/products/${id}/variants`, { colorIds, sizeIds }),

  // A new product with how many of each colour and size arrived. For stock this
  // opens the intake the handheld tags against.
  createProductWithStock: (body) => post('/api/products/with-stock', body),

  // The search with photos, colours and sizes - the Products page and the C72.
  searchProducts: (q) => get(`/api/products/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  checkPhotos,
  uploadPhotos,

  // The products that look most like a picture - a screenshot, a photo of a
  // garment - closest first, with how sure it is of the first.
  searchByPhoto: async (file) => {
    const [photo] = await checkPhotos([file]);
    const form = new FormData();
    form.append('photo', photo, photo.name || 'photo.png');
    return request('POST', '/api/products/search-by-photo', form);
  },
  deletePhoto: (id, photoId) => del(`/api/products/${id}/photos/${photoId}`),
  makeCover: (id, photoId) => post(`/api/products/${id}/photos/${photoId}/cover`, {}),

  variants: (filters) => get(`/api/variants${q(filters)}`),
  updateVariant: (id, body) => patch(`/api/variants/${id}`, body),
  deleteVariant: (id) => del(`/api/variants/${id}`),

  // intake
  batches: (status) => get(`/api/batches${q({ status })}`),
  batch: (id) => get(`/api/batches/${id}`),
  createBatch: (body) => post('/api/batches', body),
  assignTag: (id, body) => post(`/api/batches/${id}/assign`, body),
  unassignTag: (id, itemId) => del(`/api/batches/${id}/assign/${itemId}`),
  completeBatch: (id) => post(`/api/batches/${id}/complete`, {}),
  deleteBatch: (id) => del(`/api/batches/${id}`),

  // items
  items: (filters) => get(`/api/items${q(filters)}`),
  item: (id) => get(`/api/items/${id}`),
  itemByEpc: (epc) => get(`/api/items/by-epc/${encodeURIComponent(epc)}`),
  updateItem: (id, body) => patch(`/api/items/${id}`, body),
  moveItems: (epcs, roomId, note) => post('/api/items/move', { epcs, roomId, note }),

  // orders
  orders: (filters) => get(`/api/orders${q(filters)}`),
  order: (id) => get(`/api/orders/${id}`),
  createOrder: (body) => post('/api/orders', body),

  // A sales spreadsheet. Preview first, so nobody finds out what a file was
  // going to do by watching it do it.
  previewImport: (body) => post('/api/orders/import/preview', body),
  importOrders: (body) => post('/api/orders/import', body),
  pick: (id, epc, orderLineId) => post(`/api/orders/${id}/pick`, { epc, orderLineId }),
  unpick: (id, orderItemId) => del(`/api/orders/${id}/pick/${orderItemId}`),
  shipOrder: (id) => post(`/api/orders/${id}/ship`, {}),

  cancelOrder: (id) => post(`/api/orders/${id}/cancel`, {}),

  // courier (J&T): the parcel for an order, booked through the courier module
  bookCourier: (id, body) => post(`/api/orders/${id}/courier`, body ?? {}),
  shipments: (status) => get(`/api/shipments${q({ status })}`),

  // returns
  returns: (filters) => get(`/api/returns${q(filters)}`),
  return: (id) => get(`/api/returns/${id}`),
  createReturn: (body) => post('/api/returns', body),
  scanReturn: (id, body) => post(`/api/returns/${id}/scan`, body),
  updateReturnLine: (id, lineId, body) => patch(`/api/returns/${id}/scan/${lineId}`, body),
  deleteReturnLine: (id, lineId) => del(`/api/returns/${id}/scan/${lineId}`),
  closeReturn: (id, body) => post(`/api/returns/${id}/close`, body),
  rejectReturn: (id, body) => post(`/api/returns/${id}/reject`, body),

  // find
  findRequests: (status) => get(`/api/find${q({ status })}`),
  createFind: (body) => post('/api/find', body),
  markFound: (id, roomId) => post(`/api/find/${id}/found`, { roomId }),
  cancelFind: (id) => del(`/api/find/${id}`),
  // Any one garment of a colour and size. Finding one takes the rest off the list.
  findVariant: (variantId) => post(`/api/find/variant/${variantId}`, {}),

  // reports
  overview: () => get('/api/overview'),
  // Every colour and size with fewer on the shelves than its alert level.
  lowStock: () => get('/api/low-stock'),
  stock: (by) => get(`/api/stock${q({ by })}`),
  money: (days) => get(`/api/money${q({ days })}`),
};
