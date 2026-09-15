'use client';

import { usePathname } from 'next/navigation';
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

/** Account identity, mirroring the seeded sender profile. */
const ACCOUNT = { name: 'LINKED INTERN...', code: 'JTMY027288' };

export function TopBar() {
  const pathname = usePathname();
  const crumbs = CRUMBS[pathname] ?? ['Homepage', ''];

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

        <div className="flex items-center gap-2">
          <div
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3d7c8] text-[15px]"
          >
            {'\u{1F464}'}
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold text-text-primary">{ACCOUNT.name}</div>
            <div className="text-mini text-text-secondary">{ACCOUNT.code}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
