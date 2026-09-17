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
    // narrow screens scroll the strip itself rather than the page
    <div className="thin-scroll flex h-[42px] shrink-0 items-stretch gap-5 overflow-x-auto border-b border-line bg-white px-5 sm:gap-7">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative flex shrink-0 items-center whitespace-nowrap text-base"
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
