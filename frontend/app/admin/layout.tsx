import type { Metadata } from 'next';
import { AdminChrome } from '@/components/admin/AdminChrome';

export const metadata: Metadata = {
  title: 'Admin Portal | J&T Express',
  description: 'Every order with its tracking status, and the accounts that can log in.',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminChrome>{children}</AdminChrome>;
}
