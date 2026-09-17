/**
 * Illustrations for the tracking page, drawn to resemble jtexpress.my's stage
 * and payment icons.  Hand-made SVG: nothing is copied from J&T's site.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const RED = '#e60012';
const ORANGE = '#f5a524';
const YELLOW = '#ffc629';
const INK = '#3a3a3a';

export const PickedUpIcon = (p: P) => (
  <svg width={52} height={52} viewBox="0 0 52 52" {...p}>
    <path
      d="M26 3C16.1 3 8.5 10.6 8.5 20.2 8.5 32.4 26 49 26 49s17.5-16.6 17.5-28.8C43.5 10.6 35.9 3 26 3Z"
      fill="#e8431e"
    />
    <path
      d="M26 3C16.1 3 8.5 10.6 8.5 20.2c0 2.4.7 5 1.8 7.5C12 16.4 20 9.2 30.7 9.2c4.4 0 8.4 1.3 11.7 3.4C39.6 7 33.3 3 26 3Z"
      fill="#f06a3c"
    />
    <rect x="17" y="12" width="18" height="16" rx="1.5" fill={YELLOW} />
    <path d="M17 17.5h18" stroke="#e39a00" strokeWidth="1.4" />
    <rect x="23.5" y="12" width="5" height="7" fill="#fff3c4" />
  </svg>
);

export const InTransitIcon = (p: P) => (
  <svg width={52} height={52} viewBox="0 0 52 52" {...p}>
    <path d="M2 18h9M4 23h7M1 28h10" stroke={RED} strokeWidth="2.2" strokeLinecap="round" />
    <rect x="13" y="12" width="23" height="21" rx="1.5" fill={ORANGE} />
    <path d="M13 17h23" stroke="#d98a0b" strokeWidth="1.2" />
    <path d="M36 18h7.5l6 8.5V33H36Z" fill={RED} />
    <path d="M38.5 20.5h4.2l3.8 5.3h-8Z" fill="#ffd9d9" />
    <rect x="12" y="32" width="38" height="3.5" rx="1" fill="#b3000e" />
    <circle cx="20" cy="37" r="4.6" fill={INK} />
    <circle cx="20" cy="37" r="1.9" fill="#fff" />
    <circle cx="42" cy="37" r="4.6" fill={INK} />
    <circle cx="42" cy="37" r="1.9" fill="#fff" />
  </svg>
);

export const DeliveryIcon = (p: P) => (
  <svg width={52} height={52} viewBox="0 0 52 52" {...p}>
    <rect x="6" y="17" width="16" height="12" rx="2" fill={ORANGE} />
    <path d="M6 22h16" stroke="#d98a0b" strokeWidth="1.2" />
    <path
      d="M8 31h20l5-9h6l2.5 9.5H45a4 4 0 0 1 4 4V37H7.5a3 3 0 0 1-3-3v-.5A2.5 2.5 0 0 1 8 31Z"
      fill="#ef5b6a"
    />
    <path d="M33 22l4-10h4.5" stroke={RED} strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <path d="M30 31h11" stroke="#fbd0d5" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="13" cy="39" r="5" fill={INK} />
    <circle cx="13" cy="39" r="2" fill="#fff" />
    <circle cx="42" cy="39" r="5" fill={INK} />
    <circle cx="42" cy="39" r="2" fill="#fff" />
  </svg>
);

export const DeliveredIcon = (p: P) => (
  <svg width={52} height={52} viewBox="0 0 52 52" {...p}>
    <rect x="21" y="4" width="22" height="20" rx="1.5" fill={ORANGE} />
    <path d="M21 10.5h22" stroke="#d98a0b" strokeWidth="1.3" />
    <rect x="29" y="4" width="6" height="8" fill="#fff0c9" />
    <path
      d="M4 31h7.5c3.5 0 6.2-1.6 9.5-1.6h8.5a3.2 3.2 0 0 1 0 6.4H22l9.2.2 11-6.4a3.3 3.3 0 0 1 3.6 5.4L33.5 44.3a7 7 0 0 1-3.9 1.2H4Z"
      fill="#ffe1d6"
      stroke={RED}
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <rect x="1.5" y="28.5" width="7" height="19" rx="1.5" fill={RED} />
  </svg>
);

export const ReturnedIcon = (p: P) => (
  <svg width={52} height={52} viewBox="0 0 52 52" {...p}>
    <rect x="15" y="17" width="26" height="24" rx="2" fill={ORANGE} />
    <path d="M15 24.5h26" stroke="#d98a0b" strokeWidth="1.3" />
    <rect x="25" y="17" width="6" height="9" fill="#fff0c9" />
    <path
      d="M12 13.5A17 17 0 0 1 42.5 10"
      stroke={RED}
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    <path d="M6.5 8.5 12 14.5l6.5-5" stroke={RED} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export const STAGE_ICONS: Record<string, (p: P) => JSX.Element> = {
  picked_up: PickedUpIcon,
  in_transit: InTransitIcon,
  delivery: DeliveryIcon,
  delivered: DeliveredIcon,
  returned: ReturnedIcon,
};

/* ------------------------------------------------------------ payment */
export const DuitNowIcon = () => (
  <div className="flex flex-col items-center leading-none">
    <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="17" fill="#ed2d6f" />
      <path
        d="M12 9.5h6.3c5.3 0 9 3.6 9 8.5s-3.7 8.5-9 8.5H12Zm5 4.3v8.4h1.2c2.6 0 4.2-1.7 4.2-4.2s-1.6-4.2-4.2-4.2Z"
        fill="#fff"
      />
    </svg>
    <span className="mt-[3px] text-[12px] font-extrabold tracking-tight text-[#1d1d1b]">
      Duit<span className="text-[#ed2d6f]">Now</span>
    </span>
    <span className="text-[9px] font-bold text-[#1d1d1b]">QR</span>
  </div>
);

export const EWalletIcon = () => (
  <div className="flex flex-col items-center leading-none">
    <svg width={40} height={36} viewBox="0 0 40 36" aria-hidden>
      <rect x="8" y="2" width="22" height="12" rx="2" transform="rotate(-12 19 8)" fill="#f59e0b" />
      <rect x="3" y="8" width="34" height="26" rx="3" fill="#2f7fd8" />
      <rect x="3" y="8" width="34" height="7" rx="3" fill="#5ea3ec" />
      <rect x="26" y="18" width="11" height="9" rx="2" fill="#1f5fae" />
      <circle cx="30.5" cy="22.5" r="1.8" fill="#ffd166" />
    </svg>
    <span className="mt-[5px] text-center text-[11px] font-bold leading-[12px] text-[#1d1d1b]">
      J&amp;T App M&apos;sia
      <br />
      E-wallet
    </span>
  </div>
);

export const CashIcon = () => (
  <div className="flex flex-col items-center leading-none">
    <svg width={40} height={36} viewBox="0 0 40 36" aria-hidden>
      <rect x="2" y="7" width="36" height="24" rx="2" fill="#4caf50" />
      <rect x="2" y="7" width="36" height="24" rx="2" fill="none" stroke="#2e7d32" strokeWidth="1.2" />
      <rect x="17" y="7" width="6" height="24" fill="#f4c542" />
      <circle cx="20" cy="19" r="5" fill="#81c784" stroke="#2e7d32" strokeWidth="1" />
      <path d="M6 11h5M29 27h5" stroke="#c8e6c9" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <span className="mt-[5px] text-[12px] font-bold text-[#1d1d1b]">Cash</span>
  </div>
);

export const ImageGlyph = (p: P) => (
  <svg width={14} height={12} viewBox="0 0 14 12" aria-hidden {...p}>
    <rect x="0.5" y="0.5" width="13" height="11" rx="1.5" fill="currentColor" />
    <path d="M2.5 9.5 5.5 6l2 2.2L9.5 6l2.5 3.5Z" fill={RED} />
    <circle cx="4" cy="3.5" r="1.2" fill={RED} />
  </svg>
);
