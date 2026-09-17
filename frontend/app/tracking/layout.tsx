import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/tracking/Site';

export const metadata: Metadata = {
  title: 'Track your order | Inaaya Store',
  description: 'Follow your Inaaya Store parcel from pick up to delivery.',
};

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-brand">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
