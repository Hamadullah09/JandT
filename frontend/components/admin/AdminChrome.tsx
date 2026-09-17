'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { RequireLogin, logOut, useMe } from '@/components/auth/Session';
import { InaayaLogo } from '@/components/brand/Logo';
import { CalendarIcon, DashboardIcon, HomeIcon, LogoutIcon, TruckIcon, UsersIcon } from '@/components/ui/icons';
import { api } from '@/lib/api';

/** Tells the header to recount accounts waiting for approval. */
export const USERS_CHANGED = 'portal-users-changed';

function PendingBadge() {
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

function Header() {
  const pathname = usePathname();
  const me = useMe();
  const link = (href: string) =>
    `inline-flex h-11 items-center gap-2 rounded-lg px-3 ${
      pathname === href ? 'bg-brand-tint font-bold text-brand' : 'text-text-regular hover:bg-surface-page hover:text-brand'
    }`;

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] flex-wrap items-center gap-x-6 gap-y-2 border-b-2 border-line bg-white px-6 py-2">
      <Link href="/admin" className="flex select-none items-center gap-4">
        <InaayaLogo size="sm" />
        <span className="bg-brand px-3 py-[5px] text-[13px] font-bold uppercase tracking-[1.5px] text-white">
          Admin Portal
        </span>
      </Link>
      <nav className="flex flex-wrap items-center gap-1 text-[17px]" aria-label="Admin menu">
        <Link href="/admin" className={link('/admin')}>
          <DashboardIcon className="h-5 w-5" /> Orders
        </Link>
        <Link href="/admin/calendar" className={link('/admin/calendar')}>
          <CalendarIcon className="h-5 w-5" /> Calendar
        </Link>
        <Link href="/admin/users" className={link('/admin/users')}>
          <UsersIcon className="h-5 w-5" /> Users
          <PendingBadge />
        </Link>
        <Link href="/tracking" target="_blank" className={link('/tracking')}>
          <TruckIcon className="h-5 w-5" /> Track &amp; Trace
        </Link>
        <Link href="/" className={link('/')}>
          <HomeIcon className="h-5 w-5" /> Merchant Portal
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-3 text-[16px]">
        <span className="text-text-regular">
          {me?.name} <span className="text-text-secondary">({me?.username})</span>
        </span>
        <button type="button" className="el-btn h-11 gap-2 px-4 text-[16px]" onClick={() => void logOut()}>
          <LogoutIcon className="h-5 w-5" /> Log out
        </button>
      </div>
    </header>
  );
}

export function AdminChrome({ children }: { children: ReactNode }) {
  return (
    <RequireLogin admin>
      <div className="flex min-h-screen flex-col bg-surface-page">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </RequireLogin>
  );
}
