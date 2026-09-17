/**
 * Typed API client.
 *
 * Every request/response shape comes from `types.gen.ts`, which is generated
 * from the FastAPI OpenAPI schema by `scripts/gen_types.py`.  No `any`.
 */
import type {
  AddressCheckIn,
  AddressCheckOut,
  AddressParseOut,
  AdminOrderDetailOut,
  AdminOrderPage,
  BulkCommitIn,
  BulkCommitOut,
  BulkProgressOut,
  BulkRowOut,
  BulkUploadOut,
  DeleteRowsOut,
  EventTypeOut,
  LoginIn,
  MeOut,
  NormalOrderIn,
  OrderCreatedOut,
  OrderPage,
  OutputDirCheckOut,
  Problem,
  SenderProfileIn,
  SenderProfileOut,
  SignupIn,
  SignupOut,
  TrackingOut,
  TrackingUpdateIn,
  TrackingUpdateOut,
  UserOut,
  UserUpdateIn,
} from './types.gen';

/** The admin dashboard's filters; also what the CSV export uses. */
export type AdminFilter = {
  status?: string;
  q?: string;
  period?: 'today' | '7d' | '30d' | 'all';
};

function adminQuery(filter: AdminFilter, extra: Record<string, string> = {}): string {
  const search = new URLSearchParams(extra);
  if (filter.status) search.set('status', filter.status);
  if (filter.q?.trim()) search.set('q', filter.q.trim());
  if (filter.period && filter.period !== 'all') search.set('period', filter.period);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') ?? 'http://localhost:8000';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;

  constructor(status: number, problem: Problem | null, fallback: string) {
    super(problem?.detail || problem?.title || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

/** Pages anyone may open; a 401 there is shown, not sent to the login page. */
const PUBLIC_PAGES = ['/login', '/signup', '/forgot-password', '/tracking'];

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Back to the login page, returning here afterwards. */
export function goToLogin(): void {
  if (typeof window === 'undefined' || isPublicPage(window.location.pathname)) return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function request<T>(
  path: string,
  init?: RequestInit,
  { loginOn401 = true }: { loginOn401?: boolean } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      // the login cookie: the API is on another port of the same host
      credentials: 'include',
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, null, `Cannot reach the API at ${API_BASE}.`);
  }

  if (response.status === 401 && loginOn401) goToLogin();

  if (!response.ok) {
    let problem: Problem | null = null;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      problem = null;
    }
    throw new ApiError(response.status, problem, `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  /* ------------------------------------------------------ login */
  login: (body: LoginIn) =>
    request<MeOut>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }, { loginOn401: false }),

  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }, { loginOn401: false }),

  me: () => request<MeOut>('/api/v1/auth/me', undefined, { loginOn401: false }),

  signup: (body: SignupIn) =>
    request<SignupOut>('/api/v1/auth/signup', { method: 'POST', body: JSON.stringify(body) }, { loginOn401: false }),

  users: () => request<UserOut[]>('/api/v1/admin/users'),

  updateUser: (userId: number, body: UserUpdateIn) =>
    request<UserOut>(`/api/v1/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteUser: (userId: number) =>
    request<void>(`/api/v1/admin/users/${userId}`, { method: 'DELETE' }),

  /* ---------------------------------------------------- portal */
  getSender: () => request<SenderProfileOut>('/api/v1/settings/sender'),

  updateSender: (body: SenderProfileIn) =>
    request<SenderProfileOut>('/api/v1/settings/sender', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  createOrder: (body: NormalOrderIn) =>
    request<OrderCreatedOut>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listOrders: (params: { page?: number; size?: number; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.size) search.set('size', String(params.size));
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return request<OrderPage>(`/api/v1/orders${qs ? `?${qs}` : ''}`);
  },

  checkOutputDir: (outputDir: string) =>
    request<OutputDirCheckOut>('/api/v1/bulk/check-output-dir', {
      method: 'POST',
      body: JSON.stringify({ output_dir: outputDir }),
    }),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<BulkUploadOut>('/api/v1/bulk/upload', {
      method: 'POST',
      body: form,
    });
  },

  commitBatch: (batchId: number, body: BulkCommitIn, asAsync = false) =>
    request<BulkCommitOut>(
      `/api/v1/bulk/${batchId}/commit${asAsync ? '?async=true' : ''}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listRows: (batchId: number) =>
    request<BulkRowOut[]>(`/api/v1/bulk/${batchId}/rows`),

  deleteRows: (batchId: number, rowIds: number[]) =>
    request<DeleteRowsOut>(`/api/v1/bulk/${batchId}/rows`, {
      method: 'DELETE',
      body: JSON.stringify({ row_ids: rowIds }),
    }),

  manifestUrl: (batchId: number) => `${API_BASE}/api/v1/bulk/${batchId}/manifest.csv`,
  errorsUrl: (batchId: number) => `${API_BASE}/api/v1/bulk/${batchId}/errors.csv`,
  zipUrl: (batchId: number) => `${API_BASE}/api/v1/waybills/batch/${batchId}.zip`,
  waybillUrl: (trackingNo: string) => `${API_BASE}/api/v1/waybills/${trackingNo}.pdf`,
  templateUrl: () => `${API_BASE}/api/v1/templates/bulk.csv`,

  /* ---------------------------------------------------- address */
  parseAddress: (text: string, signal?: AbortSignal) =>
    request<AddressParseOut>('/api/v1/address/parse', {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal,
    }),

  checkAddress: (body: AddressCheckIn, signal?: AbortSignal) =>
    request<AddressCheckOut>('/api/v1/address/check', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  /* --------------------------------------------- track & trace */
  track: (waybills: string[]) =>
    request<TrackingOut[]>(
      `/api/v1/tracking?awb=${encodeURIComponent(waybills.join(','))}`,
      undefined,
      { loginOn401: false },
    ),

  eventTypes: () => request<EventTypeOut[]>('/api/v1/tracking/event-types'),

  addTrackingEvent: (body: TrackingUpdateIn) =>
    request<TrackingUpdateOut>('/api/v1/tracking/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteTrackingEvent: (eventId: number) =>
    request<void>(`/api/v1/tracking/events/${eventId}`, { method: 'DELETE' }),

  /* ----------------------------------------------------- admin */
  adminOrders: (filter: AdminFilter, page = 1, size = 50) =>
    request<AdminOrderPage>(
      `/api/v1/admin/orders${adminQuery(filter, { page: String(page), size: String(size) })}`,
    ),

  adminOrder: (trackingNo: string) =>
    request<AdminOrderDetailOut>(`/api/v1/admin/orders/${encodeURIComponent(trackingNo)}`),

  exportUrl: (filter: AdminFilter) => `${API_BASE}/api/v1/admin/orders/export.csv${adminQuery(filter)}`,
};

/**
 * Follow a batch's SSE progress stream.  Returns an unsubscribe function.
 */
export function watchProgress(
  batchId: number,
  onTick: (p: BulkProgressOut) => void,
  onDone: () => void,
): () => void {
  const source = new EventSource(`${API_BASE}/api/v1/bulk/${batchId}/progress`, {
    withCredentials: true,
  });

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as BulkProgressOut;
      onTick(payload);
      if (payload.status === 'done' || payload.status === 'failed') {
        source.close();
        onDone();
      }
    } catch {
      /* a malformed frame must not kill the stream */
    }
  };

  source.onerror = () => {
    source.close();
    onDone();
  };

  return () => source.close();
}
