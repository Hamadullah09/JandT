'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { RequireLogin, logOut, useMe } from '@/components/auth/Session';
import { InaayaLogo } from '@/components/brand/Logo';
import {
  MobileNavButton,
  MobileNavPanel,
  MobileNavProvider,
} from '@/components/layout/MobileNav';
import {
  CalendarIcon,
  DashboardIcon,
  HomeIcon,
  LogoutIcon,
  TruckIcon,
  UsersIcon,
  WarehouseIcon,
} from '@/components/ui/icons';
import { WAREHOUSE_URL, api } from '@/lib/api';

/** Tells the header to recount accounts waiting for approval. */
export const USERS_CHANGED = 'portal-users-changed';

type AdminLink = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => JSX.Element;
  /** another application on the platform: a full page load, not a portal route */
  external?: boolean;
  newTab?: boolean;
  /** shows how many accounts are waiting for approval */
  pending?: boolean;
};

const LINKS: AdminLink[] = [
  { href: '/admin', label: 'Orders', icon: DashboardIcon },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarIcon },
  { href: '/admin/users', label: 'Users', icon: UsersIcon, pending: true },
  { href: '/tracking', label: 'Track & Trace', icon: TruckIcon, newTab: true },
  { href: '/', label: 'Merchant Portal', icon: HomeIcon },
  // The other module of the platform, on the same address and login.
  { href: WAREHOUSE_URL, label: 'Warehouse', icon: WarehouseIcon, external: true },
];

/** How many accounts are waiting for approval; counted once for the whole chrome. */
function usePendingCount(): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const count = () =>
      api
        .users()
        .then((users) => setPending(users.filter((user) => user.status === 'pending').length))
        .catch(() => undefined);
    void count();
    const timer = setInterval(count, 30_000);
    window.addEventListener(USERS_CHANGED, count);
    return () => {
      clearInterval(timer);
      window.removeEventListener(USERS_CHANGED, count);
    };
  }, []);
  return pending;
}

function PendingBadge({ pending }: { pending: number }) {
  if (!pending) return null;
  return (
    <span
      className="ml-1 inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-brand px-1.5 text-[14px] font-bold text-white"
      title={`${pending} waiting for approval`}
    >
      {pending}
    </span>
  );
}

/** One menu entry, as a portal route or as a link to another application. */
function NavLink({ item, className, children }: { item: AdminLink; className: string; children: ReactNode }) {
  if (item.external) {
    return (
      <a href={item.href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={item.href} target={item.newTab ? '_blank' : undefined} className={className}>
      {children}
    </Link>
  );
}

function Header({ pending }: { pending: number }) {
  const pathname = usePathname();
  const me = useMe();
  const link = (href: string) =>
    `inline-flex h-11 items-center gap-2 rounded-lg px-3 ${
      pathname === href ? 'bg-brand-tint font-bold text-brand' : 'text-text-regular hover:bg-surface-page hover:text-brand'
    }`;

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-line bg-white px-4 py-2 lg:gap-x-6 lg:px-6">
      <MobileNavButton />
      <Link href="/admin" className="flex select-none items-center gap-4">
        <InaayaLogo size="sm" />
        <span className="bg-brand px-3 py-[5px] text-[13px] font-bold uppercase tracking-[1.5px] text-white">
          Admin Portal
        </span>
      </Link>
      {/* below `lg` the same entries live in the drawer */}
      <nav className="hidden flex-wrap items-center gap-1 text-[17px] lg:flex" aria-label="Admin menu">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.label} item={item} className={link(item.href)}>
              <Icon className="h-5 w-5" /> {item.label}
              {item.pending && <PendingBadge pending={pending} />}
            </NavLink>
          );
        })}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-3 text-[16px]">
        <span className="hidden break-words text-text-regular md:inline">
          {me?.name} <span className="text-text-secondary">({me?.username})</span>
        </span>
        <button
          type="button"
          className="el-btn h-11 shrink-0 gap-2 px-4 text-[16px]"
          onClick={() => void logOut()}
        >
          <LogoutIcon className="h-5 w-5" /> Log out
        </button>
      </div>
    </header>
  );
}

/** The admin menu as an off-canvas drawer, for phones and small tablets. */
function AdminDrawer({ pending }: { pending: number }) {
  const pathname = usePathname();
  const me = useMe();

  return (
    <MobileNavPanel label="Admin menu">
      <div className="flex flex-col items-start gap-3 border-b border-line-light px-5 pb-4 pt-5">
        <InaayaLogo size="sm" />
        <span className="bg-brand px-3 py-[5px] text-[13px] font-bold uppercase tracking-[1.5px] text-white">
          Admin Portal
        </span>
      </div>

      <nav aria-label="Admin menu" className="flex flex-col py-2">
        {LINKS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <NavLink
              key={item.label}
              item={item}
              className={`flex h-[50px] items-center gap-3 px-5 text-[16px] ${
                active ? 'bg-brand-tint font-semibold text-brand' : 'text-text-primary hover:bg-surface-page'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.pending && <PendingBadge pending={pending} />}
              {item.external && (
                <span aria-hidden className="text-[13px] text-text-secondary">
                  ↗
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line-light px-5 py-4">
        <p className="break-words text-[16px] text-text-regular">
          {me?.name} <span className="text-text-secondary">({me?.username})</span>
        </p>
        <button
          type="button"
          className="el-btn mt-3 h-11 w-full gap-2 text-[16px]"
          onClick={() => void logOut()}
        >
          <LogoutIcon className="h-5 w-5" /> Log out
        </button>
      </div>
    </MobileNavPanel>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const pending = usePendingCount();
  return (
    <>
      <div className="flex min-h-screen flex-col bg-surface-page">
        <Header pending={pending} />
        <main className="flex-1">{children}</main>
      </div>
      <AdminDrawer pending={pending} />
    </>
  );
}

export function AdminChrome({ children }: { children: ReactNode }) {
  return (
    <RequireLogin admin>
      <MobileNavProvider>
        <AdminShell>{children}</AdminShell>
      </MobileNavProvider>
    </RequireLogin>
  );
}
