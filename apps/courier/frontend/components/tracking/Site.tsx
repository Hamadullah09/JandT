/** The inaayastore.com frame around the tracking page: announcement bar, menu and footer. */
import Link from 'next/link';
import { InaayaLogo, STORE_NAME, STORE_URL } from '@/components/brand/Logo';

/** The shop's own menu, so the page feels like part of inaayastore.com. */
const MENU: [string, string][] = [
  ['Home', '/'],
  ['New Arrival', '/collections/new-arrivals'],
  ['Best Sellers', '/collections/best-sellers'],
  ['2PC', '/collections/2-piece-dress/2PC'],
  ['3PC', '/collections/3-piece-dress'],
  ['Gowns', '/collections/gown-and-duppata'],
  ['Cord Sets', '/collections/cord-sets'],
  ['Lehanga', '/collections/lehanga'],
  ['Saree Collection', '/collections/sarees'],
  ['Kids', '/collections/kids'],
];

export function SiteHeader({ announcement = `Track your ${STORE_NAME} order` }: { announcement?: string }) {
  return (
    <header className="sticky top-0 z-30 bg-white">
      <p className="bg-brand px-4 py-2 text-center text-[12px] font-semibold uppercase tracking-[1.5px] text-white">
        {announcement}
      </p>
      <div className="flex h-[84px] items-center gap-4 border-b border-[#e8e6e1] px-4 sm:gap-6 sm:px-5 md:px-[52px]">
        <Link href="/tracking" aria-label={`${STORE_NAME} - track a parcel`}>
          <InaayaLogo size="sm" />
        </Link>
        <nav className="hidden flex-1 flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[14px] text-[rgba(3,3,2,0.8)] xl:flex">
          {MENU.map(([label, path]) => (
            <a key={label} href={`${STORE_URL}${path}`} className="whitespace-nowrap hover:text-brand hover:underline">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-4 text-[13px] font-semibold uppercase tracking-[1px] sm:gap-5">
          <a href={STORE_URL} className="hidden whitespace-nowrap hover:underline sm:inline">
            Shop
          </a>
          <Link href="/login" className="whitespace-nowrap border border-brand px-4 py-2 hover:bg-brand hover:text-white">
            Login
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[#e8e6e1] bg-white px-5 py-10 md:px-[52px]">
      <div className="mx-auto flex max-w-[1246px] flex-col items-center gap-4 text-center">
        <InaayaLogo size="sm" />
        <p className="text-[13px] font-semibold uppercase tracking-[1.5px] text-brand">Find your style with Inaaya</p>
        <a href={STORE_URL} className="text-[14px] text-[rgba(3,3,2,0.75)] underline-offset-4 hover:underline">
          inaayastore.com
        </a>
        <p className="text-[13px] text-[rgba(3,3,2,0.6)]">© {new Date().getFullYear()} {STORE_NAME}</p>
      </div>
    </footer>
  );
}
