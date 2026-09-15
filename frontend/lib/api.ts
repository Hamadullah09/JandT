/**
 * Typed API client.
 *
 * Every request/response shape comes from `types.gen.ts`, which is generated
 * from the FastAPI OpenAPI schema by `scripts/gen_types.py`.  No `any`.
 */
import type {
  BulkCommitIn,
  BulkCommitOut,
  BulkProgressOut,
  BulkRowOut,
  BulkUploadOut,
  DeleteRowsOut,
  NormalOrderIn,
  OrderCreatedOut,
  OrderPage,
  OutputDirCheckOut,
  Problem,
  SenderProfileIn,
  SenderProfileOut,
} from './types.gen';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
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
};

/**
 * Follow a batch's SSE progress stream.  Returns an unsubscribe function.
 */
export function watchProgress(
  batchId: number,
  onTick: (p: BulkProgressOut) => void,
  onDone: () => void,
): () => void {
  const source = new EventSource(`${API_BASE}/api/v1/bulk/${batchId}/progress`);

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
