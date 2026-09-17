'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { RequireLogin, logOut, useMe } from '@/components/auth/Session';
import { api } from '@/lib/api';

/** Tells the header to recount accounts waiting for approval. */
export const USERS_CHANGED = 'jt-users-changed';

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
      className="ml-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-jt-red px-1 text-[10px] font-semibold text-white"
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
    pathname === href ? 'font-semibold text-jt-red' : 'text-text-regular hover:text-jt-red';

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-6 border-b border-line bg-white px-5">
      <Link href="/admin" className="flex select-none items-end gap-3">
        <span className="flex items-end">
          <span
            className="text-[30px] font-black italic leading-none tracking-[-0.04em] text-jt-red"
            style={{ fontFamily: 'Arial Black, Arial, sans-serif' }}
          >
            J&amp;T
          </span>
          <span className="ml-[3px] pb-[2px] text-[11px] font-bold tracking-[0.02em] text-jt-red">
            EXPRESS
          </span>
        </span>
        <span className="mb-[3px] rounded bg-jt-red px-2 py-[1px] text-[12px] font-bold text-white">
          Admin Portal
        </span>
      </Link>
      <nav className="flex items-center gap-5 text-base">
        <Link href="/admin" className={link('/admin')}>
          Orders Dashboard
        </Link>
        <Link href="/admin/users" className={`inline-flex items-center ${link('/admin/users')}`}>
          Users
          <PendingBadge />
        </Link>
        <Link href="/tracking" target="_blank" className="text-text-regular hover:text-jt-red">
          Track &amp; Trace
        </Link>
        <Link href="/" className="text-text-regular hover:text-jt-red">
          Merchant Portal
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-3 text-base">
        <span className="text-text-regular">
          {me?.name} <span className="text-text-secondary">({me?.username})</span>
        </span>
        <button type="button" className="el-btn h-[28px] px-3" onClick={() => void logOut()}>
          Log out
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
