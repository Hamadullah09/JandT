import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/tracking/Site';

export const metadata: Metadata = {
  title: 'Track your parcel with J&T | Parcel Delivery Services | J&T Express Malaysia',
  description: 'Track & Trace - follow your parcel from pick up to delivery.',
};

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-white text-[#333]"
      style={{ fontFamily: "Nunito, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}
    >
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
