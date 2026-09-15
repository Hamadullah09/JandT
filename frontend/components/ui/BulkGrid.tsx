'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { BulkRowOut, SenderProfileOut } from '@/lib/types.gen';

export type GridRow = BulkRowOut;

const EMPTY_BODY_HEIGHT = 480;
const ROW_HEIGHT = 38;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Display-only mirror of the server's weight maths (spec 4.6). */
function volumetric(row: GridRow): string {
  const v =
    (num(row.data?.length) * num(row.data?.width) * num(row.data?.height)) / 6000;
  return v ? v.toFixed(2) : '0.00';
}

function chargeable(row: GridRow): string {
  const actual = num(row.data?.actual_weight);
  const vol = Number(volumetric(row));
  const max = Math.max(actual, vol);
  return max ? (Math.ceil(max * 10) / 10).toFixed(1) : '';
}

export function buildColumns(
  sender: SenderProfileOut | null,
  selection: Set<number>,
  toggle: (id: number, on: boolean) => void,
  toggleAll: (on: boolean) => void,
  allSelected: boolean,
): ColumnDef<GridRow>[] {
  const cell = (get: (r: GridRow) => unknown) => ({
    cell: ({ row }: { row: { original: GridRow } }) => (
      <span className="block truncate">{String(get(row.original) ?? '')}</span>
    ),
  });

  return [
    {
      id: 'select',
      size: 44,
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all rows"
          checked={allSelected}
          onChange={(e) => toggleAll(e.target.checked)}
          className="h-[14px] w-[14px]"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select row ${row.original.row_no}`}
          checked={selection.has(row.original.id)}
          onChange={(e) => toggle(row.original.id, e.target.checked)}
          className="h-[14px] w-[14px]"
        />
      ),
    },
    { id: 'no', header: 'No.', size: 64, ...cell((r) => r.row_no) },
    { id: 'interception', header: 'Order Interception', size: 150, ...cell(() => 'No') },
    {
      id: 'actual_weight',
      header: 'Actual Weight',
      size: 120,
      ...cell((r) => r.data?.actual_weight ?? r.raw?.actual_weight),
    },
    { id: 'sender_name', header: 'Sender Name', size: 200, ...cell(() => sender?.company_name) },
    { id: 'sender_phone', header: 'Sender Phone Number', size: 170, ...cell(() => sender?.phone) },
    { id: 'sender_postcode', header: 'Deliverer Postcode', size: 150, ...cell(() => sender?.postcode) },
    { id: 'sender_address', header: 'Sender Address', size: 300, ...cell(() => sender?.address) },
    {
      id: 'receiver_name',
      header: 'Receiver Name',
      size: 180,
      ...cell((r) => r.data?.receiver_name ?? r.raw?.receiver_name),
    },
    {
      id: 'receiver_phone',
      header: 'Receiver Phone Number',
      size: 175,
      ...cell((r) => r.data?.receiver_phone ?? r.raw?.receiver_phone),
    },
    {
      id: 'receiver_postcode',
      header: 'Receiver Postcode',
      size: 150,
      ...cell((r) => r.data?.receiver_postcode ?? r.raw?.receiver_postcode),
    },
    {
      id: 'receiver_state',
      header: 'Receiver State',
      size: 140,
      ...cell((r) => r.data?.receiver_state ?? r.raw?.receiver_state),
    },
    {
      id: 'receiver_address',
      header: 'Receiver Address',
      size: 320,
      ...cell((r) => r.data?.receiver_address ?? r.raw?.receiver_address),
    },
    {
      id: 'address_type',
      header: 'Address Type',
      size: 120,
      ...cell((r) => r.data?.address_type ?? r.raw?.address_type),
    },
    { id: 'goods_type', header: 'Goods Type', size: 110, ...cell(() => 'PARCEL') },
    {
      id: 'goods_name',
      header: 'Goods Name',
      size: 300,
      ...cell((r) => r.data?.goods_name ?? r.raw?.goods_name),
    },
    { id: 'quantity', header: 'Quantity', size: 90, ...cell((r) => r.data?.quantity ?? r.raw?.quantity) },
    { id: 'length', header: 'Length', size: 80, ...cell((r) => r.data?.length ?? r.raw?.length) },
    { id: 'width', header: 'Width', size: 80, ...cell((r) => r.data?.width ?? r.raw?.width) },
    { id: 'height', header: 'Height', size: 80, ...cell((r) => r.data?.height ?? r.raw?.height) },
    { id: 'volumetric', header: 'Volumetric Weight', size: 150, ...cell(volumetric) },
    { id: 'chargeable', header: 'Chargeable Weight', size: 150, ...cell(chargeable) },
    {
      id: 'customer_order_no',
      header: 'Customer Order Number',
      size: 180,
      ...cell((r) => r.data?.order_no ?? r.raw?.order_no),
    },
    { id: 'remark', header: 'Remark', size: 200, ...cell((r) => r.data?.remark ?? r.raw?.remark) },
    {
      id: 'status',
      header: 'Status',
      size: 110,
      cell: ({ row }) => {
        const status = row.original.status;
        const tone =
          status === 'created'
            ? 'text-[#529b2e]'
            : status === 'ok'
              ? 'text-text-regular'
              : 'text-jt-red';
        return <span className={`block truncate ${tone}`}>{status}</span>;
      },
    },
    { id: 'tracking_no', header: 'Tracking Number', size: 150, ...cell((r) => r.tracking_no) },
    {
      id: 'error',
      header: 'Error Message',
      size: 380,
      cell: ({ row }) => (
        <span className="block truncate text-jt-red" title={row.original.error_message ?? ''}>
          {row.original.error_message ?? ''}
        </span>
      ),
    },
  ];
}

export function BulkGrid({
  rows,
  columns,
  onRowClick,
}: {
  rows: GridRow[];
  columns: ColumnDef<GridRow>[];
  onRowClick?: (row: GridRow) => void;
}) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const model = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const totalWidth = useMemo(
    () => table.getVisibleLeafColumns().reduce((sum, c) => sum + c.getSize(), 0),
    [table],
  );

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="thin-scroll overflow-auto border border-line"
      style={{ height: EMPTY_BODY_HEIGHT + 40 }}
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        {/* sticky header */}
        <div className="sticky top-0 z-10 flex bg-surface-head">
          {table.getFlatHeaders().map((header) => (
            <div
              key={header.id}
              style={{ width: header.getSize() }}
              className="shrink-0 border-b border-r border-line-light px-3 py-[10px] text-base font-semibold text-text-primary"
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          ))}
        </div>

        {model.length === 0 ? (
          // matches the reference: a blank body, no illustration, no "no data"
          <div style={{ height: EMPTY_BODY_HEIGHT }} />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((virtualRow) => {
              const row = model[virtualRow.index];
              return (
                <div
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className="absolute left-0 flex cursor-pointer hover:bg-surface-page"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: totalWidth,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="shrink-0 overflow-hidden border-b border-r border-line-light px-3 py-[9px] text-base text-text-primary"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
