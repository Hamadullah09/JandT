'use client';

import Link from 'next/link';
import { useMe } from '@/components/auth/Session';
import {
  DashboardIcon,
  FileIcon,
  ListIcon,
  SettingsIcon,
  TruckIcon,
  UploadIcon,
} from '@/components/ui/icons';

type Action = {
  href: string;
  title: string;
  hint: string;
  icon: (p: { className?: string }) => JSX.Element;
  adminOnly?: boolean;
  newTab?: boolean;
};

const ACTIONS: Action[] = [
  { href: '/order/normal', title: 'Create one order', hint: 'Normal order', icon: FileIcon },
  { href: '/order/bulk-import', title: 'Upload many orders', hint: 'Bulk Import Orders - from a CSV file', icon: UploadIcon },
  { href: '/order/management', title: 'See my orders', hint: 'Order Management', icon: ListIcon },
  { href: '/admin', title: 'Admin portal', hint: 'Order statuses, sources and users', icon: DashboardIcon, adminOnly: true },
  { href: '/tracking', title: 'Track a parcel', hint: 'Track & Trace', icon: TruckIcon, newTab: true },
  { href: '/settings/sender', title: 'My sender details', hint: 'Sender Profile - printed on every waybill', icon: SettingsIcon },
];

export default function Homepage() {
  const me = useMe();
  const actions = ACTIONS.filter((action) => !action.adminOnly || me?.role === 'admin');

  return (
    <div className="p-6">
      <h1 className="text-[28px] font-bold leading-tight text-text-primary">
        Hello{me ? `, ${me.name}` : ''}
      </h1>
      <p className="mt-1 text-[18px] text-text-regular">What would you like to do?</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              target={action.newTab ? '_blank' : undefined}
              className="group flex items-center gap-5 rounded-xl border-2 border-line bg-white p-6 transition-colors hover:border-brand hover:bg-brand-tint"
            >
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
                <Icon className="h-8 w-8" />
              </span>
              <span className="min-w-0">
                <span className="block text-[21px] font-bold text-text-primary group-hover:text-brand">
                  {action.title}
                </span>
                <span className="mt-1 block text-[16px] text-text-secondary">{action.hint}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-6 text-[15px] text-text-secondary">
        Inaaya Store order portal{me?.company_name ? ` - sending as ${me.company_name}` : ''}.
      </p>
    </div>
  );
}
