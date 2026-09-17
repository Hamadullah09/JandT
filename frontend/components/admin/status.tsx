/** Tracking statuses as the admin portal shows them (app/core/trace.py). */

export const STATUS_ORDER = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ON_DELIVERY',
  'DELIVERED',
  'RETURNED',
] as const;

export type Status = (typeof STATUS_ORDER)[number];

export const STATUS_LABEL: Record<Status, string> = {
  CREATED: 'Order Created',
  PICKED_UP: 'Picked Up',
  IN_TRANSIT: 'In Transit',
  ON_DELIVERY: 'On Delivery',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
};

export const STATUS_STYLE: Record<Status, { color: string; background: string }> = {
  CREATED: { color: '#606266', background: '#f4f4f5' },
  PICKED_UP: { color: '#2b6fd6', background: '#ecf5ff' },
  IN_TRANSIT: { color: '#b86e00', background: '#fdf6ec' },
  ON_DELIVERY: { color: '#7c3aad', background: '#f5eefa' },
  DELIVERED: { color: '#3f8f1f', background: '#f0f9eb' },
  RETURNED: { color: '#c62828', background: '#fdecea' },
};

/** The one-click statuses of the bulk bar, and the scan each one records. */
export const QUICK_STATUSES: { status: Status; event: string }[] = [
  { status: 'PICKED_UP', event: 'PICKED_UP' },
  { status: 'IN_TRANSIT', event: 'DEPARTURE' },
  { status: 'ON_DELIVERY', event: 'ON_DELIVERY' },
  { status: 'DELIVERED', event: 'DELIVERED' },
  { status: 'RETURNED', event: 'RETURNED' },
];

/** The update most likely to come next, preselected in the order panel. */
export const NEXT_EVENT: Record<Status, string> = {
  CREATED: 'PICKED_UP',
  PICKED_UP: 'DEPARTURE',
  IN_TRANSIT: 'DP_ARRIVAL',
  ON_DELIVERY: 'DELIVERED',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
};

export function isStatus(value: string): value is Status {
  return (STATUS_ORDER as readonly string[]).includes(value);
}

export function StatusBadge({ status }: { status: string }) {
  const known = isStatus(status) ? status : 'CREATED';
  const style = STATUS_STYLE[known];
  return (
    <span
      className="inline-flex h-[32px] items-center whitespace-nowrap rounded-full px-[14px] text-[15px] font-semibold"
      style={style}
    >
      {isStatus(status) ? STATUS_LABEL[status] : status}
    </span>
  );
}

type Item = { name: string; variant: string; quantity: number; dropship: boolean };

/** The items of an admin order row, typed. */
export function itemsOf(raw: Record<string, unknown>[]): Item[] {
  return raw.map((item) => ({
    name: String(item.name ?? ''),
    variant: String(item.variant ?? ''),
    quantity: Number(item.quantity ?? 1),
    dropship: Boolean(item.dropship),
  }));
}

export function itemText(item: Item): string {
  const variant = item.variant ? ` (${item.variant})` : '';
  const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
  return `${item.name}${variant}${quantity}`;
}

/** What each status means, in plain words, under its name on the dashboard. */
export const STATUS_HINT: Record<Status, string> = {
  CREATED: 'Waiting for the courier to collect',
  PICKED_UP: 'The courier has the parcel',
  IN_TRANSIT: 'On the way',
  ON_DELIVERY: 'Out for delivery',
  DELIVERED: 'Customer received it',
  RETURNED: 'Came back to you',
};

/** A colour for each order source; any other source is grey-blue. */
const SOURCE_COLOURS: Record<string, string> = {
  Website: '#030302',
  WhatsApp: '#1e9e45',
  Facebook: '#1877f2',
  Instagram: '#c13584',
  'TikTok Shop': '#222222',
  Daraz: '#f85606',
  Shopee: '#ee4d2d',
  Lazada: '#1a237e',
  Amazon: '#e08a00',
  eBay: '#0064d2',
  Etsy: '#d5641c',
  Other: '#909399',
};

export function sourceColour(name: string): string {
  return SOURCE_COLOURS[name] ?? '#5f7d8c';
}

export function SourceTag({ name }: { name: string }) {
  const colour = sourceColour(name);
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-[3px] text-[15px] font-semibold"
      style={{ color: colour, borderColor: `${colour}55`, background: `${colour}10` }}
    >
      <span className="h-[9px] w-[9px] rounded-full" style={{ background: colour }} />
      {name}
    </span>
  );
}
