'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/auth/Session';
import { InaayaLogo } from '@/components/brand/Logo';
import {
  DRAWER_BASE,
  DRAWER_STATIC_LG,
  drawerState,
  useMobileNav,
} from '@/components/layout/MobileNav';
import {
  ChevronDown,
  ChevronUp,
  DashboardIcon,
  HomeIcon,
  OrderIcon,
  SettingsIcon,
  TruckIcon,
  WarehouseIcon,
} from '@/components/ui/icons';
import { WAREHOUSE_URL, isStaff } from '@/lib/api';

type Child = { label: string; href: string };
type Item = {
  label: string;
  href?: string;
  icon: (p: { className?: string }) => JSX.Element;
  children?: Child[];
  adminOnly?: boolean;
  /** admin and operator accounts only */
  staffOnly?: boolean;
  /** another application on the platform: a full page load, not a portal route */
  external?: boolean;
};

/**
 * Only pages that work are listed: menu entries with nothing behind them
 * (Waybill, Address Management, VIP Centre...) only confused.
 */
const MENU: Item[] = [
  { label: 'Homepage', href: '/', icon: HomeIcon },
  {
    label: 'Order',
    icon: OrderIcon,
    children: [
      { label: 'Normal order', href: '/order/normal' },
      { label: 'Bulk Import Orders', href: '/order/bulk-import' },
      { label: 'Quick Order', href: '/order/quick' },
      { label: 'Order Management', href: '/order/management' },
    ],
  },
  { label: 'Warehouse', href: WAREHOUSE_URL, icon: WarehouseIcon, staffOnly: true, external: true },
  { label: 'Admin Portal', href: '/admin', icon: DashboardIcon, adminOnly: true },
  { label: 'Track & Trace', href: '/tracking', icon: TruckIcon },
  {
    label: 'System Settings',
    icon: SettingsIcon,
    children: [{ label: 'Sender Profile', href: '/settings/sender' }],
  },
];

export function BrandLogo() {
  return (
    <Link href="/" className="flex flex-col items-center gap-2 border-b border-line-light px-6 pb-4 pt-5">
      <InaayaLogo size="md" />
      <span className="text-[12px] font-semibold uppercase tracking-[2px] text-text-regular">Commerce platform</span>
    </Link>
  );
}

const inGroup = (item: Item, pathname: string) =>
  (item.children ?? []).some((child) => pathname === child.href);

export function Sidebar() {
  const pathname = usePathname();
  const me = useMe();
  // below `lg` this same panel is the off-canvas drawer
  const { open: drawerOpen, panelId, closeOnLink } = useMobileNav();
  const menu = MENU.filter(
    (item) => (!item.adminOnly || me?.role === 'admin') && (!item.staffOnly || isStaff(me?.role)),
  );

  // "Order" starts open - it is what the portal is for; any group holding the
  // page on screen opens too.  Clicking a group's name opens or closes it.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      MENU.filter((item) => item.children).map((item) => [
        item.label,
        item.label === 'Order' || inGroup(item, pathname),
      ]),
    ),
  );
  useEffect(() => {
    const current = MENU.find((item) => inGroup(item, pathname));
    if (current) setOpen((prev) => (prev[current.label] ? prev : { ...prev, [current.label]: true }));
  }, [pathname]);

  return (
    <aside
      id={panelId}
      onClick={closeOnLink}
      className={`thin-scroll flex h-full shrink-0 flex-col overflow-y-auto border-r border-line bg-white ${DRAWER_BASE} ${DRAWER_STATIC_LG} ${drawerState(drawerOpen)}`}
    >
      <BrandLogo />

      <nav className="pb-6" aria-label="Main menu">
        {menu.map((item) => {
          const Icon = item.icon;
          const row = 'flex h-[50px] w-full items-center px-6 text-[16px] text-text-primary';

          if (item.href && item.external) {
            return (
              <a key={item.label} href={item.href} className={`${row} hover:bg-surface-page`}>
                <Icon className="mr-3 h-5 w-5 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                <span aria-hidden className="text-[13px] text-text-secondary">↗</span>
              </a>
            );
          }

          if (item.href) {
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`${row} ${active ? 'bg-brand-tint font-semibold text-brand' : 'hover:bg-surface-page'}`}
              >
                <Icon className="mr-3 h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          }

          const expanded = Boolean(open[item.label]);
          return (
            <div key={item.label}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((prev) => ({ ...prev, [item.label]: !expanded }))}
                className={`${row} text-left hover:bg-surface-page`}
              >
                <Icon className="mr-3 h-5 w-5 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {expanded ? (
                  <ChevronUp className="text-text-secondary" />
                ) : (
                  <ChevronDown className="text-text-secondary" />
                )}
              </button>

              {expanded && (
                <div className="pb-1">
                  {(item.children ?? []).map((child) => {
                    const active = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        aria-current={active ? 'page' : undefined}
                        className={
                          active
                            ? 'mx-3 flex h-[48px] items-center rounded-lg bg-brand pl-[48px] pr-3 text-[16px] font-bold text-white'
                            : 'mx-3 flex h-[48px] items-center rounded-lg pl-[48px] pr-3 text-[16px] text-text-primary hover:bg-surface-page'
                        }
                      >
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
