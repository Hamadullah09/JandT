import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'J&T Express Merchant Portal',
  description: 'Merchant portal - order creation and bulk waybill generation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
