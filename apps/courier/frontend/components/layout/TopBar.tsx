'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logOut, useMe } from '@/components/auth/Session';
import { MobileNavButton } from '@/components/layout/MobileNav';
import { LogoutIcon } from '@/components/ui/icons';
import { WAREHOUSE_URL, isStaff, roleLabel } from '@/lib/api';

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
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-line bg-white px-5 lg:gap-0">
      <MobileNavButton />

      {/* the breadcrumb steps aside on a phone; the drawer says where you are */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[17px] md:flex">
        <span className="truncate text-brand">{crumbs[0]}</span>
        {crumbs[1] && (
          <>
            <span className="text-text-secondary">/</span>
            <span className="truncate text-brand">{crumbs[1]}</span>
          </>
        )}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-4">
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
            {/* on a phone the block shrinks to the avatar; the menu has the name */}
            <div className="hidden leading-tight sm:block">
              <div className="max-w-[260px] truncate text-[16px] font-semibold text-text-primary">
                {me?.name}
              </div>
              <div className="text-[14px] text-text-secondary">{me ? roleLabel(me.role) : ''}</div>
            </div>
          </button>
          {open && me && (
            <div
              role="menu"
              className="absolute right-0 top-[50px] z-50 w-[260px] rounded-lg border border-line bg-white py-2 text-[16px] shadow-lg max-sm:fixed max-sm:inset-x-3 max-sm:top-[70px] max-sm:w-auto"
            >
              <div className="border-b border-line-light px-4 pb-2">
                <div className="break-words font-semibold text-text-primary">{me.name}</div>
                <div className="break-words text-[14px] text-text-secondary">
                  {me.username} · {roleLabel(me.role)}
                </div>
              </div>
              {isStaff(me.role) && (
                <a
                  role="menuitem"
                  href={WAREHOUSE_URL}
                  className="block px-4 py-3 hover:bg-surface-page hover:text-brand"
                >
                  Warehouse
                </a>
              )}
              {me.role === 'admin' && (
                <Link
                  role="menuitem"
                  href="/admin"
                  className="block px-4 py-3 hover:bg-surface-page hover:text-brand"
                >
                  Admin Portal
                </Link>
              )}
              {/* The warehouse's account menu offers the same four things in the
                  same order: the other module, this one, the profile, the way out. */}
              <Link
                role="menuitem"
                href="/settings/sender"
                className="block px-4 py-3 hover:bg-surface-page hover:text-brand"
              >
                Sender Profile
              </Link>
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
          className="el-btn h-11 shrink-0 gap-2 px-4 text-[16px]"
        >
          <LogoutIcon className="h-5 w-5" /> Log out
        </button>
      </div>
    </header>
  );
}
