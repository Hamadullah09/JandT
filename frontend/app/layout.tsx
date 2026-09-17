import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inaaya Store | Order Portal',
  description: 'Inaaya Store order portal - create orders, print labels and track parcels',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inaaya Store's typeface, plus a serif for the wordmark */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
