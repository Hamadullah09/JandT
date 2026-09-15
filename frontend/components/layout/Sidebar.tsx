'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AddressIcon,
  ChevronDown,
  ChevronUp,
  HomeIcon,
  OrderIcon,
  SettingsIcon,
  SupportIcon,
  VipIcon,
  WaybillIcon,
} from '@/components/ui/icons';

type Child = { label: string; href: string };
type Item = {
  label: string;
  href?: string;
  icon: (p: { className?: string }) => JSX.Element;
  children?: Child[];
};

const MENU: Item[] = [
  { label: 'Homepage', href: '/', icon: HomeIcon },
  {
    label: 'Order',
    icon: OrderIcon,
    children: [
      { label: 'Normal order', href: '/order/normal' },
      { label: 'Multiple-Pieces Shipment Order', href: '/order/multiple-pieces' },
      { label: 'International Orders', href: '/order/international' },
      { label: 'Order Management', href: '/order/management' },
      { label: 'Quick Order', href: '/order/quick' },
      { label: 'Bulk Import Orders', href: '/order/bulk-import' },
    ],
  },
  { label: 'Waybill', icon: WaybillIcon, children: [] },
  { label: 'Address Management', icon: AddressIcon, children: [] },
  { label: 'System Settings', icon: SettingsIcon, children: [{ label: 'Sender Profile', href: '/settings/sender' }] },
  { label: 'Complaint and Feedback', icon: SupportIcon, children: [] },
  { label: 'VIP Centre', icon: VipIcon, children: [] },
];

export function JtLogo() {
  return (
    <div className="flex select-none items-end px-6 py-[18px]">
      <span
        className="text-[36px] font-black italic leading-none tracking-[-0.04em] text-jt-red"
        style={{ fontFamily: 'Arial Black, Arial, sans-serif' }}
      >
        J&amp;T
      </span>
      <span className="ml-[3px] pb-[3px] text-[13px] font-bold tracking-[0.02em] text-jt-red">
        EXPRESS
      </span>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const orderOpen = pathname.startsWith('/order');

  return (
    <aside className="flex h-full w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line bg-white thin-scroll">
      <JtLogo />

      <nav className="pb-6">
        {MENU.map((item) => {
          const expandable = Array.isArray(item.children);
          const expanded = item.label === 'Order' && orderOpen;
          const Icon = item.icon;

          const head = (
            <div className="flex h-[44px] items-center px-6 text-base text-text-primary">
              <Icon className="mr-3 shrink-0 text-text-primary" />
              <span className="flex-1 truncate">{item.label}</span>
              {expandable &&
                (expanded ? (
                  <ChevronUp className="text-text-secondary" />
                ) : (
                  <ChevronDown className="text-text-secondary" />
                ))}
            </div>
          );

          return (
            <div key={item.label}>
              {item.href ? (
                <Link href={item.href} className="block hover:bg-surface-page">
                  {head}
                </Link>
              ) : (
                <div className="cursor-default hover:bg-surface-page">{head}</div>
              )}

              {expanded && item.children && (
                <div className="pb-1">
                  {item.children.map((child) => {
                    const active = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={
                          active
                            ? 'mx-3 flex h-[44px] items-center rounded-lg bg-jt-red pl-[48px] pr-3 text-base font-bold text-white'
                            : 'mx-3 flex h-[44px] items-center rounded-lg pl-[48px] pr-3 text-base text-text-primary hover:bg-surface-page'
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
