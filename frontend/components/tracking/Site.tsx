/** The jtexpress.my frame around the tracking page: red top bar and footer. */
import Link from 'next/link';

const MENU = ['SHIPPING', 'SERVICES', 'JOIN US', 'INFO', 'VIP', 'J&T DISTRIBUTION', 'STAR DISPATCHERS'];

export const SITE_RED = '#e60012';

export function SiteLogo() {
  return (
    <Link href="/tracking" className="flex select-none items-end text-white" aria-label="J&T Express">
      <span
        className="text-[31px] font-black italic leading-none tracking-[-0.05em]"
        style={{ fontFamily: 'Arial Black, Arial, sans-serif' }}
      >
        J&amp;T
      </span>
      <span className="mb-[-2px] ml-[2px] text-[12px] font-bold italic tracking-[0.01em]">
        EXPRESS
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-30 flex h-[66px] items-center gap-6 px-5 text-white md:px-[52px]"
      style={{ background: SITE_RED }}
    >
      <SiteLogo />
      <nav className="hidden flex-1 items-center gap-[26px] text-[14px] font-medium lg:flex">
        {MENU.map((item) => (
          <span key={item} className="cursor-default whitespace-nowrap">
            {item}
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-[26px] text-[14px] font-medium">
        <Link href="/login" className="whitespace-nowrap hover:underline">
          LOGIN
        </Link>
        <span className="hidden cursor-default sm:inline">LANGUAGE</span>
      </div>
    </header>
  );
}

const FOOTER: [string, string[]][] = [
  ['Shipping', ['Domestic Shipping', 'International Shipping']],
  ['Services', ['Track & Trace', 'Shipping Rates']],
  ['Join Us', ['VIP', 'E-Commerce']],
  ['Info', ['About Us', 'FAQ']],
];

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-[#2f2f2f] px-5 py-10 text-white md:px-[52px]">
      <div className="mx-auto grid max-w-[1246px] grid-cols-2 gap-8 md:grid-cols-4">
        {FOOTER.map(([title, links]) => (
          <div key={title}>
            <h3 className="mb-3 text-[17px] font-semibold">{title}</h3>
            <ul className="space-y-2 text-[13px] text-[#cfcfcf]">
              {links.map((link) => (
                <li key={link}>{link}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-10 max-w-[1246px] border-t border-[#474747] pt-5 text-center text-[12px] text-[#9b9b9b]">
        Parcel statuses on this page are recorded in your J&amp;T merchant portal.
      </p>
    </footer>
  );
}
