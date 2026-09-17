'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logOut, useMe } from '@/components/auth/Session';
import { LogoutIcon } from '@/components/ui/icons';

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
  // the logged-in account
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
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[17px]">
        <span className="text-brand">{crumbs[0]}</span>
        {crumbs[1] && (
          <>
            <span className="text-text-secondary">/</span>
            <span className="text-brand">{crumbs[1]}</span>
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-4">
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
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3d7c8] text-[18px]"
            >
              {'\u{1F464}'}
            </div>
            <div className="leading-tight">
              <div className="max-w-[260px] truncate text-[16px] font-semibold text-text-primary">
                {me?.name}
              </div>
              <div className="text-[14px] text-text-secondary">{me ? (me.role === 'admin' ? 'Admin' : 'Shop user') : ''}</div>
            </div>
          </button>
          {open && me && (
            <div
              role="menu"
              className="absolute right-0 top-[50px] z-50 w-[260px] rounded-lg border border-line bg-white py-2 text-[16px] shadow-lg"
            >
              <div className="border-b border-line-light px-4 pb-2">
                <div className="font-semibold text-text-primary">{me.name}</div>
                <div className="text-[14px] text-text-secondary">
                  {me.username} · {me.role === 'admin' ? 'Admin' : 'Shop user'}
                </div>
              </div>
              {me.role === 'admin' && (
                <Link
                  role="menuitem"
                  href="/admin"
                  className="block px-4 py-3 hover:bg-surface-page hover:text-brand"
                >
                  Admin Portal
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => void logOut()}
                className="block w-full px-4 py-3 text-left hover:bg-surface-page hover:text-brand"
              >
                Log out
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void logOut()}
          className="el-btn h-11 gap-2 px-4 text-[16px]"
        >
          <LogoutIcon className="h-5 w-5" /> Log out
        </button>
      </div>
    </header>
  );
}
