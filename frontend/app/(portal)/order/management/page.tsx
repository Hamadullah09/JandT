'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeftSm, ChevronRightSm, SearchIcon } from '@/components/ui/icons';
import { ApiError, api } from '@/lib/api';
import type { OrderPage } from '@/lib/types.gen';

const SIZE = 20;

const COLUMNS = [
  'No.',
  'Tracking Number',
  'Customer Order Number',
  'Receiver Name',
  'Postcode',
  'State',
  'Sortation Code',
  'Route',
  'Chargeable Weight',
  'Fee',
  'Status',
  'Waybill',
];

export default function OrderManagementPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<OrderPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextPage: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listOrders({ page: nextPage, size: SIZE, q: q || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function search() {
    setPage(1);
    void load(1, query);
  }

  const items = data?.items ?? [];

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="el-input w-[320px] pl-8"
            placeholder="Tracking number, order number or receiver name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
        <button type="button" className="el-btn el-btn-primary" onClick={search}>
          Search
        </button>
        <button
          type="button"
          className="el-btn"
          onClick={() => {
            setQuery('');
            setPage(1);
            void load(1, '');
          }}
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-[#fbc4c4] bg-[#fef0f0] px-4 py-2.5 text-base text-jt-red">
          {error}
        </div>
      )}

      <div className="thin-scroll overflow-auto border border-line">
        <table className="w-full min-w-[1400px] border-collapse text-base">
          <thead className="bg-surface-head">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap border-b border-r border-line-light px-3 py-[10px] text-left font-semibold text-text-primary"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="h-[320px]" />
              </tr>
            ) : (
              items.map((order, index) => (
                <tr key={order.tracking_no} className="hover:bg-surface-page">
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {(page - 1) * SIZE + index + 1}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.tracking_no}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.customer_order_no ?? ''}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.receiver_name}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.receiver_postcode}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.receiver_state}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.sortation_code ?? ''}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.route_code ?? ''}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.chargeable_weight}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.freight_fee ?? ''}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    {order.status}
                  </td>
                  <td className="border-b border-r border-line-light px-3 py-2">
                    <a
                      className="text-jt-red hover:underline"
                      href={api.waybillUrl(order.tracking_no)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center py-2.5 text-base">
        <span className="text-text-regular">
          Data on this page:&nbsp; {items.length} Unit
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="text-text-secondary disabled:opacity-40"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeftSm />
          </button>
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-sm bg-jt-red px-1.5 text-mini font-semibold text-white">
            {page}
          </span>
          <button
            type="button"
            className="text-text-secondary disabled:opacity-40"
            disabled={loading || page >= (data?.pages ?? 1)}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRightSm />
          </button>
          <span className="ml-3 text-text-regular">Total {data?.total ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
