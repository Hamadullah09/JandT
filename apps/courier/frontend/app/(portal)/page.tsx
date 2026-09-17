'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/auth/Session';
import {
  DashboardIcon,
  FileIcon,
  ListIcon,
  SettingsIcon,
  TruckIcon,
  UploadIcon,
  WarehouseIcon,
} from '@/components/ui/icons';
import { WAREHOUSE_URL, api, isStaff, type WarehouseOverview } from '@/lib/api';

type Action = {
  href: string;
  title: string;
  hint: string;
  icon: (p: { className?: string }) => JSX.Element;
  adminOnly?: boolean;
  staffOnly?: boolean;
  newTab?: boolean;
  /** another application on the platform - a full page load */
  external?: boolean;
};

const ACTIONS: Action[] = [
  { href: '/order/normal', title: 'Create one order', hint: 'Normal order', icon: FileIcon },
  { href: '/order/bulk-import', title: 'Upload many orders', hint: 'Bulk Import Orders - from a CSV file', icon: UploadIcon },
  { href: '/order/management', title: 'See my orders', hint: 'Order Management', icon: ListIcon },
  {
    href: WAREHOUSE_URL, title: 'Warehouse', hint: 'Stock, picking, returns - and booking J&T from an order',
    icon: WarehouseIcon, staffOnly: true, external: true,
  },
  { href: '/admin', title: 'Admin portal', hint: 'Order statuses, sources and users', icon: DashboardIcon, adminOnly: true },
  { href: '/tracking', title: 'Track a parcel', hint: 'Track & Trace', icon: TruckIcon, newTab: true },
  { href: '/settings/sender', title: 'My sender details', hint: 'Sender Profile - printed on every waybill', icon: SettingsIcon },
];

const ringgit = (value: number | string | undefined) =>
  `RM ${Number(value ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The warehouse and the courier side by side, for staff: one platform, one glance. */
function PlatformSummary() {
  const [data, setData] = useState<WarehouseOverview | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.warehouseOverview().then((next) => { if (alive) setData(next); });
    void load();
    const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!data) return null;

  const tiles = [
    { label: 'Orders to pick', value: Number(data.orders.pending ?? 0).toLocaleString(), note: 'in the warehouse', href: `${WAREHOUSE_URL}#/orders` },
    { label: 'Shipped, not booked', value: Number(data.shipping.to_book ?? 0).toLocaleString(), note: 'need a J&T parcel', href: `${WAREHOUSE_URL}#/shipments` },
    { label: 'With J&T', value: (Number(data.shipping.awaiting_pickup ?? 0) + Number(data.shipping.in_transit ?? 0)).toLocaleString(), note: 'awaiting pickup or in transit', href: `${WAREHOUSE_URL}#/shipments` },
    { label: 'Delivered', value: Number(data.shipping.delivered ?? 0).toLocaleString(), note: `${Number(data.shipping.returned ?? 0)} returned`, href: `${WAREHOUSE_URL}#/shipments` },
    { label: 'COD to collect', value: ringgit(data.shipping.cod_outstanding), note: 'on parcels on the way', href: `${WAREHOUSE_URL}#/shipments` },
    { label: 'Garments in stock', value: Number(data.stock.in_stock ?? 0).toLocaleString(), note: `${Number(data.lowStockCount ?? 0)} colour/sizes running low`, href: `${WAREHOUSE_URL}#/stock` },
  ];

  return (
    <section className="mt-6">
      <h2 className="text-[20px] font-bold text-text-primary">Across the platform</h2>
      <p className="mt-1 text-[15px] text-text-secondary">Live from the warehouse, updated every minute.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <a
            key={tile.label}
            href={tile.href}
            className="rounded-xl border-2 border-line bg-white px-4 py-4 transition-colors hover:border-brand sm:px-5"
          >
            <span className="block break-words text-[14px] font-semibold uppercase tracking-[1px] text-text-secondary">{tile.label}</span>
            <span className="mt-1 block break-words text-[28px] font-bold leading-tight text-text-primary">{tile.value}</span>
            <span className="block break-words text-[14px] text-text-secondary">{tile.note}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function Homepage() {
  const me = useMe();
  const actions = ACTIONS.filter(
    (action) => (!action.adminOnly || me?.role === 'admin') && (!action.staffOnly || isStaff(me?.role)),
  );

  return (
    <div className="p-4 sm:p-6">
      <h1 className="break-words text-[28px] font-bold leading-tight text-text-primary">
        Hello{me ? `, ${me.name}` : ''}
      </h1>
      <p className="mt-1 text-[18px] text-text-regular">What would you like to do?</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const body = (
            <>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand sm:h-16 sm:w-16">
                <Icon className="h-8 w-8" />
              </span>
              <span className="min-w-0">
                <span className="block break-words text-[21px] font-bold text-text-primary group-hover:text-brand">
                  {action.title}
                </span>
                <span className="mt-1 block break-words text-[16px] text-text-secondary">{action.hint}</span>
              </span>
            </>
          );
          const card =
            'group flex items-center gap-4 rounded-xl border-2 border-line bg-white p-5 transition-colors hover:border-brand hover:bg-brand-tint sm:gap-5 sm:p-6';
          return action.external ? (
            <a key={action.href} href={action.href} className={card}>{body}</a>
          ) : (
            <Link
              key={action.href}
              href={action.href}
              target={action.newTab ? '_blank' : undefined}
              className={card}
            >
              {body}
            </Link>
          );
        })}
      </div>

      {isStaff(me?.role) && <PlatformSummary />}

      <p className="mt-6 text-[15px] text-text-secondary">
        Inaaya Commerce Platform - warehouse and courier on one login
        {me?.company_name ? ` - sending as ${me.company_name}` : ''}.
      </p>
    </div>
  );
}
