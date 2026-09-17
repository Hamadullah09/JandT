'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OrderDrawer } from '@/components/admin/OrderDrawer';
import {
  QUICK_STATUSES,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_STYLE,
  StatusBadge,
  itemText,
  itemsOf,
  type Status,
} from '@/components/admin/status';
import { ChevronLeftSm, ChevronRightSm, SearchIcon } from '@/components/ui/icons';
import { ApiError, api, type AdminFilter } from '@/lib/api';
import { mytClock, mytDateTime } from '@/lib/myt';
import type { AdminOrderOut, AdminOrderPage } from '@/lib/types.gen';

const PAGE_SIZE = 50;
/** How often the dashboard looks for new orders and status changes. */
const POLL_MS = 10_000;

const PERIODS: { value: NonNullable<AdminFilter['period']>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

function ExternalIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden className="inline-block">
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tile({
  label,
  count,
  active,
  accent,
  note,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  accent: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border bg-white px-4 py-3 text-left transition-colors hover:border-jt-red ${
        active ? 'border-jt-red ring-1 ring-jt-red' : 'border-line'
      }`}
    >
      <span className="flex items-center gap-2 text-base text-text-regular">
        <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: accent }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 block text-[24px] font-bold leading-8 text-text-primary">{count}</span>
      {note && <span className="block text-mini text-[#3f8f1f]">{note}</span>}
    </button>
  );
}

function OrderRow({
  order,
  isNew,
  selected,
  onSelect,
  onOpen,
}: {
  order: AdminOrderOut;
  isNew: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const items = itemsOf(order.items);
  const cod = order.order_payment_type === 'COD';
  const cell = 'border-b border-line-light px-3 py-2.5 align-top';
  return (
    <tr
      className={`cursor-pointer ${isNew ? 'bg-[#fffbe6]' : selected ? 'bg-[#fef0f0]' : 'hover:bg-surface-page'}`}
      onClick={onOpen}
    >
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${order.customer_order_no ?? order.tracking_no}`}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        {mytDateTime(order.created_at)}
        {isNew && (
          <span className="ml-2 rounded bg-jt-red px-1.5 py-[1px] text-[10px] font-bold text-white">NEW</span>
        )}
      </td>
      <td className={`${cell} font-semibold`}>{order.customer_order_no}</td>
      <td className={`${cell} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <a
          href={`/tracking/${order.tracking_no}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-jt-red hover:underline"
          title="Open the tracking page"
        >
          {order.tracking_no} <ExternalIcon />
        </a>
      </td>
      <td className={cell}>
        <span className="block">{order.receiver_name}</span>
        <span className="block text-mini text-text-secondary">{order.receiver_phone}</span>
      </td>
      <td className={cell}>
        <span className="block">
          {order.receiver_postcode} {order.receiver_city}
        </span>
        <span className="block text-mini text-text-secondary">{order.receiver_state}</span>
      </td>
      <td className={`${cell} max-w-[240px]`}>
        {items.slice(0, 2).map((item, index) => (
          <span key={index} className="block truncate" title={itemText(item)}>
            {itemText(item)}
          </span>
        ))}
        {items.length > 2 && (
          <span className="block text-mini text-text-secondary">+{items.length - 2} more</span>
        )}
        {order.supplier_ships && (
          <span className="mt-0.5 inline-block rounded bg-[#fdf6ec] px-1.5 text-mini text-[#b86e00]">
            supplier ships
          </span>
        )}
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        {cod ? (
          <span className="font-semibold text-[#b86e00]">COD RM {order.cod_amount}</span>
        ) : (
          <span className="font-semibold text-[#3f8f1f]">Paid</span>
        )}
      </td>
      <td className={cell}>
        <StatusBadge status={order.tracking_status} />
        {order.last_event && (
          <span className="mt-1 block text-mini text-text-secondary">
            {order.last_event.label} · {mytDateTime(order.last_event.occurred_at)}
            {order.last_event.location && <span className="block truncate">{order.last_event.location}</span>}
          </span>
        )}
      </td>
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="el-btn h-[28px] px-3" onClick={onOpen}>
          Update
        </button>
      </td>
    </tr>
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
        setToast(
          fresh.length > 1 ? `${fresh.length} new orders received` : 'New order received',
        );
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
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  function chooseStatus(status: Status | undefined) {
    setFilter((prev) => ({ ...prev, status }));
    setPage(1);
    setSelected(new Set());
  }

  async function markAs(status: Status, event: string) {
    const trackingNos = [...selected];
    if (trackingNos.length === 0) return;
    const label = STATUS_LABEL[status];
    if (!window.confirm(`Mark ${trackingNos.length} order(s) as ${label}?`)) return;
    setBusy(true);
    try {
      const result = await api.addTrackingEvent({
        tracking_nos: trackingNos,
        event_type: event,
        location: location.trim(),
      });
      setToast(`${result.updated} order(s) marked as ${label}`);
      setSelected(new Set());
      setLocation('');
      await load();
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'The update was not saved.');
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

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-text-primary">Orders</h1>
          <p className="text-base text-text-secondary">
            New orders appear here on their own.
            {updatedAt && (
              <span className="ml-2 inline-flex items-center gap-1 text-[#3f8f1f]">
                <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#3f8f1f]" />
                Live · updated {mytClock(updatedAt)}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <a className="el-btn el-btn-outline" href={api.exportUrl(filter)}>
            Export CSV
          </a>
          <button type="button" className="el-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-[#fbc4c4] bg-[#fef0f0] px-4 py-2.5 text-base text-jt-red">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile
          label="All orders"
          count={all}
          accent="#da251c"
          active={!filter.status}
          note={data && data.today > 0 ? `+${data.today} today` : undefined}
          onClick={() => chooseStatus(undefined)}
        />
        {STATUS_ORDER.map((status) => (
          <Tile
            key={status}
            label={STATUS_LABEL[status]}
            count={counts[status] ?? 0}
            accent={STATUS_STYLE[status].color}
            active={filter.status === status}
            onClick={() => chooseStatus(status)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[360px]">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="el-input pl-9"
            value={search}
            placeholder="Tracking no., order no., name or phone"
            aria-label="Search orders"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex overflow-hidden rounded border border-line bg-white">
          {PERIODS.map((period) => (
            <button
              key={period.value}
              type="button"
              aria-pressed={(filter.period ?? 'all') === period.value}
              onClick={() => {
                setFilter((prev) => ({ ...prev, period: period.value }));
                setPage(1);
              }}
              className={`h-control border-r border-line px-3 text-base last:border-r-0 ${
                (filter.period ?? 'all') === period.value
                  ? 'bg-jt-red text-white'
                  : 'text-text-regular hover:text-jt-red'
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-jt-red bg-[#fef0f0] px-4 py-2.5 text-base">
          <span className="font-semibold text-jt-red">{selected.size} selected</span>
          <span className="text-text-regular">Mark as:</span>
          {QUICK_STATUSES.map(({ status, event }) => (
            <button
              key={status}
              type="button"
              disabled={busy}
              className="el-btn h-[28px] px-3"
              onClick={() => void markAs(status, event)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
          <input
            className="el-input h-[28px] w-[260px]"
            value={location}
            maxLength={128}
            placeholder="Location (optional)"
            aria-label="Location for the update"
            onChange={(e) => setLocation(e.target.value)}
          />
          <button
            type="button"
            className="ml-auto text-text-secondary hover:text-jt-red"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <section className="el-card overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1100px] text-base">
            <thead className="bg-surface-head text-text-regular">
              <tr>
                <th className="w-[36px] border-b border-line-light px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    aria-label="Select all orders on this page"
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
                {['Created', 'Order No.', 'Tracking Number', 'Receiver', 'Destination', 'Items', 'Payment', 'Status', ''].map(
                  (heading) => (
                    <th key={heading} className="border-b border-line-light px-3 py-2 text-left font-normal">
                      {heading}
                    </th>
                  ),
                )}
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
                  <td colSpan={10} className="px-3 py-12 text-center text-text-secondary">
                    No orders match.
                  </td>
                </tr>
              )}
              {!data && !error && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-text-secondary">
                    Loading orders...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line-light px-4 py-2.5 text-base text-text-regular">
          <span>
            {first}-{last} of {data?.total ?? 0}
          </span>
          <button
            type="button"
            className="el-btn h-[28px] px-2"
            disabled={!data || data.page <= 1}
            aria-label="Previous page"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeftSm />
          </button>
          <button
            type="button"
            className="el-btn h-[28px] px-2"
            disabled={!data || data.page >= data.pages}
            aria-label="Next page"
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRightSm />
          </button>
        </div>
      </section>

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded bg-[#303133] px-4 py-2.5 text-base text-white shadow-lg"
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
