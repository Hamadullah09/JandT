'use client';

/** Pieces shared by the Orders dashboard and the Calendar: the source filter and order rows. */
import { SourceTag, StatusBadge, sourceColour } from '@/components/admin/status';
import { PencilIcon } from '@/components/ui/icons';
import { mytDateTime } from '@/lib/myt';
import type { AdminOrderOut, SourceCountOut } from '@/lib/types.gen';

export function ExternalIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden className="inline-block">
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

/* --------------------------------------------------------------- source */
export function SourceBar({
  sources,
  selected,
  onSelect,
}: {
  sources: SourceCountOut[];
  selected: string | undefined;
  onSelect: (source: string | undefined) => void;
}) {
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  const pill = (active: boolean) =>
    `inline-flex h-[46px] items-center gap-2 rounded-full border-2 px-4 text-[16px] font-semibold transition-colors ${
      active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-text-primary hover:border-brand'
    }`;
  const count = (value: number, active: boolean) => (
    <span
      className={`min-w-[28px] rounded-full px-2 text-center text-[15px] ${
        active ? 'bg-white/25 text-white' : 'bg-surface-page text-text-regular'
      }`}
    >
      {value}
    </span>
  );

  return (
    <section aria-label="Where the orders came from">
      <h2 className="mb-2 text-[18px] font-bold text-text-primary">Where did the orders come from?</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!selected} onClick={() => onSelect(undefined)} className={pill(!selected)}>
          All sources {count(total, !selected)}
        </button>
        {sources.map((source) => {
          const active = selected === source.name;
          return (
            <button
              key={source.name}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? undefined : source.name)}
              className={`${pill(active)} ${source.count === 0 && !active ? 'opacity-60' : ''}`}
            >
              <span
                className="h-[12px] w-[12px] rounded-full"
                style={{ background: active ? '#ffffff' : sourceColour(source.name) }}
              />
              {source.name} {count(source.count, active)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- table */
export const ORDER_COLUMNS = ['Date', 'Order No.', 'Tracking No.', 'Customer', 'Source', 'Payment', 'Status'];

/** One order.  Without `onSelect` there is no tick box. */
export function OrderRow({
  order,
  isNew = false,
  selected = false,
  onSelect,
  onOpen,
}: {
  order: AdminOrderOut;
  isNew?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const cod = order.order_payment_type === 'COD';
  const [date, time] = mytDateTime(order.created_at).split(', ');
  const cell = 'border-b border-line-light px-4 py-4 align-middle';
  const label = order.customer_order_no || order.tracking_no;

  return (
    <tr
      className={`cursor-pointer text-[16px] ${isNew ? 'bg-[#fffbe6]' : selected ? 'bg-brand-tint' : 'hover:bg-surface-page'}`}
      onClick={onOpen}
    >
      {onSelect && (
        <td className={cell} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select order ${label}`}
            onChange={(e) => onSelect(e.target.checked)}
            className="h-5 w-5"
          />
        </td>
      )}
      <td className={`${cell} whitespace-nowrap`}>
        <span className="block font-semibold text-text-primary">{date}</span>
        <span className="block text-[15px] text-text-secondary">
          {time}
          {isNew && (
            <span className="ml-2 rounded bg-brand px-2 py-[1px] text-[12px] font-bold text-white">NEW</span>
          )}
        </span>
      </td>
      <td className={`${cell} text-[17px] font-bold`}>{order.customer_order_no || '—'}</td>
      <td className={`${cell} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <a
          href={`/tracking/${order.tracking_no}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-brand underline-offset-4 hover:underline"
          title="Open the tracking page"
        >
          {order.tracking_no} <ExternalIcon />
        </a>
      </td>
      <td className={cell}>
        <span className="block font-semibold text-text-primary">{order.receiver_name}</span>
        <span className="block text-[15px] text-text-secondary">{order.receiver_phone}</span>
      </td>
      <td className={cell}>
        <SourceTag name={order.source} />
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        {cod ? (
          <span className="rounded-full bg-[#fdf6ec] px-3 py-[3px] text-[15px] font-bold text-[#b86e00]">
            COD RM {order.cod_amount}
          </span>
        ) : (
          <span className="rounded-full bg-[#f0f9eb] px-3 py-[3px] text-[15px] font-bold text-[#3f8f1f]">
            Paid
          </span>
        )}
        {order.supplier_ships && (
          <span className="mt-1 block text-[13px] text-[#b86e00]">supplier ships</span>
        )}
      </td>
      <td className={cell}>
        <StatusBadge status={order.tracking_status} />
        {order.last_event && (
          <span className="mt-1 block text-[14px] leading-5 text-text-secondary">
            {mytDateTime(order.last_event.occurred_at)}
            {order.last_event.location && <span className="block">{order.last_event.location}</span>}
          </span>
        )}
      </td>
      <td className={`${cell} text-right`} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onOpen}
          title="Change status"
          aria-label={`Change status of order ${label}`}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-line bg-white text-text-regular transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand"
        >
          <PencilIcon className="h-6 w-6" />
        </button>
      </td>
    </tr>
  );
}
