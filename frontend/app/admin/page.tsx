'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OrderDrawer } from '@/components/admin/OrderDrawer';
import { ORDER_COLUMNS, OrderRow, SourceBar } from '@/components/admin/OrderTable';
import {
  QUICK_STATUSES,
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_STYLE,
  type Status,
} from '@/components/admin/status';
import {
  BoxIcon,
  CheckCircleIcon,
  ChevronLeftSm,
  ChevronRightSm,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  ListIcon,
  PencilIcon,
  RefreshIcon,
  ReturnIcon,
  ScooterIcon,
  SearchIcon,
  TruckIcon,
} from '@/components/ui/icons';
import { ApiError, api, type AdminFilter } from '@/lib/api';
import { mytClock } from '@/lib/myt';
import type { AdminOrderPage } from '@/lib/types.gen';

const PAGE_SIZE = 50;
/** How often the dashboard looks for new orders and status changes. */
const POLL_MS = 10_000;

const PERIODS: { value: NonNullable<AdminFilter['period']>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const STATUS_ICON: Record<Status | 'ALL', (p: { className?: string }) => JSX.Element> = {
  ALL: ListIcon,
  CREATED: FileIcon,
  PICKED_UP: BoxIcon,
  IN_TRANSIT: TruckIcon,
  ON_DELIVERY: ScooterIcon,
  DELIVERED: CheckCircleIcon,
  RETURNED: ReturnIcon,
};

/* --------------------------------------------------------------- status */
function StatusTile({
  status,
  count,
  active,
  note,
  onClick,
}: {
  status: Status | 'ALL';
  count: number;
  active: boolean;
  note?: string;
  onClick: () => void;
}) {
  const Icon = STATUS_ICON[status];
  const colour = status === 'ALL' ? '#030302' : STATUS_STYLE[status].color;
  const background = status === 'ALL' ? '#f4f2ee' : STATUS_STYLE[status].background;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col rounded-xl border-2 bg-white p-4 text-left transition-colors hover:border-brand ${
        active ? 'border-brand shadow-[0_0_0_3px_rgba(3,3,2,0.14)]' : 'border-line'
      }`}
    >
      <span className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background, color: colour }}
        >
          <Icon className="h-6 w-6" />
        </span>
        <span className="text-[34px] font-bold leading-none text-text-primary">{count}</span>
      </span>
      <span className="mt-3 text-[17px] font-semibold leading-6 text-text-primary">
        {status === 'ALL' ? 'All orders' : STATUS_LABEL[status]}
      </span>
      <span className="text-[14px] leading-5 text-text-secondary">
        {status === 'ALL' ? 'Every order' : STATUS_HINT[status]}
      </span>
      {note && <span className="mt-1 text-[14px] font-semibold text-[#3f8f1f]">{note}</span>}
    </button>
  );
}

export default function AdminDashboardPage() {
  const [filter, setFilter] = useState<AdminFilter>({ period: 'all' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminOrderPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  /** the newest order id already seen; orders above it are new */
  const seen = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.adminOrders(filter, page, PAGE_SIZE);
      setData(next);
      setError(null);
      setUpdatedAt(new Date());
      if (seen.current === null) {
        seen.current = next.newest_id;
      } else if (next.newest_id > seen.current) {
        const since = seen.current;
        const fresh = next.items.filter((order) => order.id > since).map((order) => order.id);
        setNewIds((prev) => new Set([...prev, ...fresh]));
        setToast(fresh.length > 1 ? `${fresh.length} new orders received` : 'A new order was received');
        seen.current = next.newest_id;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the orders.');
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // search as you type, without a request per key
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((prev) => (prev.q === search ? prev : { ...prev, q: search }));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  function change(patch: Partial<AdminFilter>) {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
    setSelected(new Set());
  }

  async function markAs(status: Status, event: string) {
    const trackingNos = [...selected];
    if (trackingNos.length === 0) return;
    const label = STATUS_LABEL[status];
    if (!window.confirm(`Change ${trackingNos.length} order(s) to "${label}"?`)) return;
    setBusy(true);
    try {
      const result = await api.addTrackingEvent({
        tracking_nos: trackingNos,
        event_type: event,
        location: location.trim(),
      });
      setToast(`${result.updated} order(s) changed to "${label}"`);
      setSelected(new Set());
      setLocation('');
      await load();
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};
  const all = STATUS_ORDER.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  const pageTrackingNos = items.map((order) => order.tracking_no);
  const allOnPageSelected = items.length > 0 && pageTrackingNos.every((no) => selected.has(no));
  const first = data && data.total > 0 ? (data.page - 1) * data.size + 1 : 0;
  const last = data ? Math.min(data.page * data.size, data.total) : 0;
  const filtered = Boolean(filter.status || filter.source || filter.q || (filter.period && filter.period !== 'all'));

  return (
    <div className="space-y-6 px-6 py-6">
      {/* ------------------------------------------------------- title */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-text-primary">Orders</h1>
          <p className="mt-1 text-[17px] text-text-regular">
            New orders appear here by themselves.
            {updatedAt && (
              <span className="ml-3 inline-flex items-center gap-2 text-[16px] text-[#3f8f1f]">
                <span className="h-[9px] w-[9px] animate-pulse rounded-full bg-[#3f8f1f]" />
                Live · updated {mytClock(updatedAt)}
              </span>
            )}
          </p>
          <p className="mt-1 text-[15px] text-text-secondary">
            Tip: click the <PencilIcon className="inline h-4 w-4" /> pencil to change an order&apos;s status, or tick
            several orders to change them together.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a className="el-btn el-btn-outline h-12 gap-2 px-5 text-[16px]" href={api.exportUrl(filter)}>
            <DownloadIcon className="h-5 w-5" /> Download Excel file
          </a>
          <button type="button" className="el-btn h-12 gap-2 px-5 text-[16px]" onClick={() => void load()}>
            <RefreshIcon className="h-5 w-5" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[#fbc4c4] bg-danger-tint px-5 py-3 text-[17px] text-danger" role="alert">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------ source */}
      <SourceBar
        sources={data?.sources ?? []}
        selected={filter.source}
        onSelect={(source) => change({ source })}
      />

      {/* ------------------------------------------------------ status */}
      <section aria-label="Order status">
        <h2 className="mb-2 text-[18px] font-bold text-text-primary">Order status</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatusTile
            status="ALL"
            count={all}
            active={!filter.status}
            note={data && data.today > 0 ? `+${data.today} today` : undefined}
            onClick={() => change({ status: undefined })}
          />
          {STATUS_ORDER.map((status) => (
            <StatusTile
              key={status}
              status={status}
              count={counts[status] ?? 0}
              active={filter.status === status}
              onClick={() => change({ status: filter.status === status ? undefined : status })}
            />
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[480px]">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-secondary" />
          <input
            className="el-input h-12 pl-12 pr-12 text-[17px]"
            value={search}
            placeholder="Search by name, phone, order no. or tracking no."
            aria-label="Search orders"
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-secondary hover:text-brand"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg border-2 border-line bg-white">
          {PERIODS.map((period) => {
            const active = (filter.period ?? 'all') === period.value;
            return (
              <button
                key={period.value}
                type="button"
                aria-pressed={active}
                onClick={() => change({ period: period.value })}
                className={`h-11 border-r-2 border-line px-4 text-[16px] last:border-r-0 ${
                  active ? 'bg-brand font-semibold text-white' : 'text-text-regular hover:text-brand'
                }`}
              >
                {period.label}
              </button>
            );
          })}
        </div>
        {filtered && (
          <button
            type="button"
            className="text-[16px] text-brand underline underline-offset-4"
            onClick={() => {
              setSearch('');
              change({ status: undefined, source: undefined, q: '', period: 'all' });
            }}
          >
            Show all orders again
          </button>
        )}
      </div>

      {/* ---------------------------------------------------- bulk bar */}
      {selected.size > 0 && (
        <div className="space-y-3 rounded-xl border-2 border-brand bg-brand-tint px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[18px] font-bold text-brand">
              {selected.size} order{selected.size === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              className="text-[16px] text-text-regular underline underline-offset-4 hover:text-brand"
              onClick={() => setSelected(new Set())}
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[17px] text-text-primary">Change their status to:</span>
            {QUICK_STATUSES.map(({ status, event }) => (
              <button
                key={status}
                type="button"
                disabled={busy}
                className="el-btn h-12 gap-2 border-2 px-4 text-[16px] font-semibold"
                onClick={() => void markAs(status, event)}
              >
                <span className="h-[11px] w-[11px] rounded-full" style={{ background: STATUS_STYLE[status].color }} />
                {STATUS_LABEL[status]}
              </button>
            ))}
          </div>
          <input
            className="el-input h-12 max-w-[420px] text-[16px]"
            value={location}
            maxLength={128}
            placeholder="Place (optional), e.g. Transit Center SHAHALAM GATEWAY"
            aria-label="Place for the status change"
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      )}

      {/* ------------------------------------------------------- table */}
      <section className="overflow-hidden rounded-xl border-2 border-line bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead className="bg-surface-head text-[15px] text-text-regular">
              <tr>
                <th className="w-[52px] border-b-2 border-line px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allOnPageSelected}
                    aria-label="Select every order on this page"
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const no of pageTrackingNos) {
                          if (e.target.checked) next.add(no);
                          else next.delete(no);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                {ORDER_COLUMNS.map((heading) => (
                  <th key={heading} className="border-b-2 border-line px-4 py-3 text-left font-semibold">
                    {heading}
                  </th>
                ))}
                <th className="border-b-2 border-line px-4 py-3 text-right font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  isNew={newIds.has(order.id)}
                  selected={selected.has(order.tracking_no)}
                  onSelect={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(order.tracking_no);
                      else next.delete(order.tracking_no);
                      return next;
                    })
                  }
                  onOpen={() => {
                    setOpenOrder(order.tracking_no);
                    setNewIds((prev) => {
                      const next = new Set(prev);
                      next.delete(order.id);
                      return next;
                    });
                  }}
                />
              ))}
              {data && items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[18px] text-text-secondary">
                    No orders here.
                    {filtered && ' Try "Show all orders again".'}
                  </td>
                </tr>
              )}
              {!data && !error && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[18px] text-text-secondary">
                    Loading orders...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t-2 border-line px-5 py-3 text-[16px] text-text-regular">
          <span>
            Showing {first}-{last} of {data?.total ?? 0}
          </span>
          <button
            type="button"
            className="el-btn h-11 gap-1 px-4 text-[16px]"
            disabled={!data || data.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeftSm /> Previous
          </button>
          <button
            type="button"
            className="el-btn h-11 gap-1 px-4 text-[16px]"
            disabled={!data || data.page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRightSm />
          </button>
        </div>
      </section>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#303133] px-6 py-4 text-[17px] text-white shadow-xl"
        >
          {toast}
        </div>
      )}

      {openOrder && (
        <OrderDrawer
          trackingNo={openOrder}
          onClose={() => setOpenOrder(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
