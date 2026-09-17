'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: 'Homepage', href: '/' },
  { label: 'Bulk Import Orders', href: '/order/bulk-import' },
  { label: 'Normal order', href: '/order/normal' },
];

export function TabStrip() {
  const pathname = usePathname();

  return (
    <div className="flex h-[42px] shrink-0 items-stretch gap-7 border-b border-line bg-white px-5">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative flex items-center text-base"
          >
            <span className={active ? 'font-semibold text-brand' : 'text-text-primary'}>
              {tab.label}
            </span>
            {active && (
              <span className="absolute bottom-0 left-1/2 h-[2px] w-[26px] -translate-x-1/2 bg-brand" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
