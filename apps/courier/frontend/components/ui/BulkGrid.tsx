'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import { sourceColour } from '@/components/admin/status';
import type { BulkRowOut } from '@/lib/types.gen';

export type GridRow = BulkRowOut;

const EMPTY_BODY_HEIGHT = 240;
const BODY_HEIGHT = 520;
const ROW_HEIGHT = 64;

type Item = { name?: unknown; variant?: unknown; quantity?: unknown };

/** A value from the checked row, or from the file as typed when the row has a problem. */
function field(row: GridRow, name: string): unknown {
  return row.data?.[name] ?? row.raw?.[name];
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function itemsOf(row: GridRow): string[] {
  const items = row.data?.items;
  const list: Item[] = Array.isArray(items)
    ? (items as Item[])
    : [{ name: field(row, 'goods_name'), variant: field(row, 'item_variant'), quantity: field(row, 'quantity') }];
  return list.map((item) => {
    const variant = text(item.variant) ? ` - ${text(item.variant)}` : '';
    const quantity = Number(item.quantity) > 1 ? ` x${text(item.quantity)}` : '';
    return `${text(item.name)}${variant}${quantity}`;
  });
}

function isDropship(value: unknown): boolean {
  return value === true || ['yes', 'y', 'true', '1', 'dropship'].includes(text(value).trim().toLowerCase());
}

const STATUS: Record<string, { label: string; className: string }> = {
  ok: { label: 'Ready', className: 'bg-[#f4f4f5] text-text-regular' },
  created: { label: 'Created', className: 'bg-[#f0f9eb] text-[#3f8f1f]' },
  duplicate: { label: 'Already created', className: 'bg-[#fdf6ec] text-[#b86e00]' },
  error: { label: 'Problem', className: 'bg-danger-tint text-danger' },
};

function TwoLines({ top, bottom, title }: { top: string; bottom?: string; title?: string }) {
  return (
    <span className="block min-w-0" title={title ?? [top, bottom].filter(Boolean).join('\n')}>
      <span className="block truncate font-semibold text-text-primary">{top}</span>
      {bottom && <span className="block truncate text-[14px] text-text-secondary">{bottom}</span>}
    </span>
  );
}

/** The columns a shop needs to check before creating the orders. */
export function buildColumns(
  selection: Set<number>,
  toggle: (id: number, on: boolean) => void,
  toggleAll: (on: boolean) => void,
  allSelected: boolean,
): ColumnDef<GridRow>[] {
  return [
    {
      id: 'select',
      size: 56,
      header: () => (
        <input
          type="checkbox"
          aria-label="Tick all rows"
          checked={allSelected}
          onChange={(e) => toggleAll(e.target.checked)}
          className="h-5 w-5"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Tick row ${row.original.row_no}`}
          checked={selection.has(row.original.id)}
          onChange={(e) => toggle(row.original.id, e.target.checked)}
          className="h-5 w-5"
        />
      ),
    },
    {
      id: 'no',
      header: 'Row',
      size: 64,
      cell: ({ row }) => <span className="text-text-secondary">{row.original.row_no}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      size: 160,
      cell: ({ row }) => {
        const status = STATUS[row.original.status] ?? STATUS.ok;
        return (
          <span className={`inline-flex rounded-full px-3 py-[3px] text-[15px] font-semibold ${status.className}`}>
            {status.label}
          </span>
        );
      },
    },
    {
      id: 'order_no',
      header: 'Order No.',
      size: 120,
      cell: ({ row }) => <span className="font-bold text-text-primary">{text(field(row.original, 'order_no'))}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      size: 230,
      cell: ({ row }) => (
        <TwoLines top={text(field(row.original, 'receiver_name'))} bottom={text(field(row.original, 'receiver_phone'))} />
      ),
    },
    {
      id: 'address',
      header: 'Address',
      size: 340,
      cell: ({ row }) => {
        const place = [field(row.original, 'receiver_postcode'), field(row.original, 'receiver_city'), field(row.original, 'receiver_state')]
          .map(text)
          .filter(Boolean)
          .join(' ');
        return <TwoLines top={text(field(row.original, 'receiver_address'))} bottom={place} />;
      },
    },
    {
      id: 'items',
      header: 'Items',
      size: 320,
      cell: ({ row }) => {
        const items = itemsOf(row.original);
        return (
          <TwoLines
            top={items[0] ?? ''}
            bottom={items.length > 1 ? `+ ${items.length - 1} more item${items.length > 2 ? 's' : ''}` : undefined}
            title={items.join('\n')}
          />
        );
      },
    },
    {
      id: 'source',
      header: 'Source',
      size: 150,
      cell: ({ row }) => {
        const source = text(field(row.original, 'source')) || 'Website';
        return (
          <span className="inline-flex items-center gap-2 font-semibold text-text-primary">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: sourceColour(source) }} />
            <span className="truncate">{source}</span>
          </span>
        );
      },
    },
    {
      id: 'dropship',
      header: 'Drop-ship',
      size: 110,
      cell: ({ row }) => (isDropship(field(row.original, 'dropship')) ? <b>Yes</b> : <span>No</span>),
    },
    {
      id: 'payment',
      header: 'Payment',
      size: 150,
      cell: ({ row }) =>
        text(field(row.original, 'payment_type')).toUpperCase() === 'COD' ? (
          <span className="font-semibold text-[#b86e00]">COD RM {text(field(row.original, 'cod_amount'))}</span>
        ) : (
          <span className="font-semibold text-[#3f8f1f]">Paid</span>
        ),
    },
    {
      id: 'tracking_no',
      header: 'Tracking No.',
      size: 170,
      cell: ({ row }) => <span className="font-semibold">{row.original.tracking_no ?? ''}</span>,
    },
    {
      id: 'error',
      header: 'Problem',
      size: 380,
      cell: ({ row }) => (
        <span className="block whitespace-normal text-[15px] leading-5 text-danger" title={row.original.error_message ?? ''}>
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
  const bodyHeight = model.length === 0 ? EMPTY_BODY_HEIGHT : Math.min(BODY_HEIGHT, model.length * ROW_HEIGHT);

  return (
    <div className="relative">
      <div
        ref={parentRef}
        className="thin-scroll overflow-auto rounded-xl border-2 border-line bg-white"
        style={{ height: bodyHeight + 52 }}
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          {/* sticky header */}
          <div className="sticky top-0 z-10 flex bg-surface-head">
            {table.getFlatHeaders().map((header) => (
              <div
                key={header.id}
                style={{ width: header.getSize() }}
                className="flex h-[52px] shrink-0 items-center border-b-2 border-line px-3 text-[15px] font-semibold text-text-regular"
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>

          {model.length === 0 ? (
            <div style={{ height: EMPTY_BODY_HEIGHT }} />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {items.map((virtualRow) => {
                const row = model[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    onClick={() => onRowClick?.(row.original)}
                    className={`absolute left-0 flex ${row.original.status === 'error' ? 'bg-[#fffafa]' : 'hover:bg-surface-page'}`}
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
                        className="flex shrink-0 items-center overflow-hidden border-b border-line-light px-3 text-[16px] text-text-primary"
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
      {model.length === 0 && (
        // outside the scrolling table, so it stays in the middle of what is visible
        <p
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center text-[18px] text-text-secondary"
          style={{ height: EMPTY_BODY_HEIGHT }}
        >
          Your orders will show here after you choose a CSV file.
        </p>
      )}
    </div>
  );
}
