'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logOut, useMe } from '@/components/auth/Session';
import { BellIcon, GearRedIcon, MenuIcon, SearchIcon } from '@/components/ui/icons';

const CRUMBS: Record<string, [string, string]> = {
  '/order/normal': ['Order', 'Normal order'],
  '/order/bulk-import': ['Order', 'Bulk Import Orders'],
  '/order/management': ['Order', 'Order Management'],
  '/order/quick': ['Order', 'Quick Order'],
  '/order/multiple-pieces': ['Order', 'Multiple-Pieces Shipment Order'],
  '/order/international': ['Order', 'International Orders'],
  '/settings/sender': ['System Settings', 'Sender Profile'],
};

export function TopBar() {
  const pathname = usePathname();
  const crumbs = CRUMBS[pathname] ?? ['Homepage', ''];
  // the logged-in account; the code is the shop's J&T account, e.g. JTMY027288
  const me = useMe();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <header className="flex h-topbar shrink-0 items-center border-b border-line bg-white px-5">
      <button
        type="button"
        aria-label="Toggle menu"
        className="mr-4 text-text-primary hover:text-jt-red"
      >
        <MenuIcon />
      </button>

      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-base">
        <span className="text-jt-red">{crumbs[0]}</span>
        {crumbs[1] && (
          <>
            <span className="text-text-secondary">/</span>
            <span className="text-jt-red">{crumbs[1]}</span>
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="h-[30px] w-[160px] rounded-2xl border border-line pl-8 pr-3 text-base text-text-primary outline-none placeholder:text-text-secondary focus:border-jt-red"
            placeholder="Please enter menu name"
          />
        </div>

        <button type="button" aria-label="Settings" className="text-jt-red">
          <GearRedIcon />
        </button>
        <button type="button" aria-label="Notifications" className="text-text-primary">
          <BellIcon />
        </button>

        <div className="relative" ref={menu}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex items-center gap-2 text-left"
          >
            <div
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3d7c8] text-[15px]"
            >
              {'\u{1F464}'}
            </div>
            <div className="leading-tight">
              <div className="max-w-[120px] truncate text-base font-semibold text-text-primary">
                {me?.name}
              </div>
              <div className="text-mini text-text-secondary">{me?.account_code ?? me?.username}</div>
            </div>
          </button>
          {open && me && (
            <div
              role="menu"
              className="absolute right-0 top-[42px] z-50 w-[230px] rounded border border-line bg-white py-2 text-base shadow-lg"
            >
              <div className="border-b border-line-light px-4 pb-2">
                <div className="font-semibold text-text-primary">{me.name}</div>
                <div className="text-mini text-text-secondary">
                  {me.username} · {me.role === 'admin' ? 'Admin' : 'Merchant'}
                </div>
              </div>
              {me.role === 'admin' && (
                <Link
                  role="menuitem"
                  href="/admin"
                  className="block px-4 py-2 hover:bg-surface-page hover:text-jt-red"
                >
                  Admin Portal
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => void logOut()}
                className="block w-full px-4 py-2 text-left hover:bg-surface-page hover:text-jt-red"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
