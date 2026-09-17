/** Inline stroke icons, sized to the 18px sidebar/top-bar glyphs. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const HomeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </svg>
);

export const OrderIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 9h8M8 13h5" />
  </svg>
);

export const WaybillIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3.5h8a2 2 0 0 1 2 2V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5.5a2 2 0 0 1 2-2Z" />
    <path d="M9.5 3.5V6h5V3.5M9.5 10.5h5M9.5 14h3" />
  </svg>
);

export const AddressIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </svg>
);

export const SupportIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <rect x="2.5" y="13" width="4" height="6" rx="1.6" />
    <rect x="17.5" y="13" width="4" height="6" rx="1.6" />
    <path d="M19.5 19v.6a2.4 2.4 0 0 1-2.4 2.4H13" />
  </svg>
);

export const VipIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.8 20 6v6c0 5-3.6 8.2-8 9.2C7.6 20.2 4 17 4 12V6l8-3.2Z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </svg>
);

export const ChevronDown = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

export const ChevronUp = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m6 14.5 6-6 6 6" />
  </svg>
);

export const ChevronLeftSm = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

export const ChevronRightSm = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

export const MenuIcon = (p: P) => (
  <svg {...base({ width: 20, height: 20, ...p })}>
    <path d="M3.5 6.5h17M3.5 12h11M3.5 17.5h17" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const BellIcon = (p: P) => (
  <svg {...base({ width: 19, height: 19, ...p })}>
    <path d="M18 16.5H6v-5a6 6 0 1 1 12 0v5Z" />
    <path d="M10 19.5a2 2 0 0 0 4 0" />
  </svg>
);

export const GearRedIcon = (p: P) => (
  <svg {...base({ width: 19, height: 19, ...p })}>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.4 5.6 16.2 7.8M7.8 16.2l-2.2 2.2M18.4 18.4l-2.2-2.2M7.8 7.8 5.6 5.6" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
  </svg>
);

export const CopyIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" />
  </svg>
);

export const PasteIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4v1.1" />
    <path d="M8.5 11h7M8.5 15h4" />
  </svg>
);

export const ContactIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <circle cx="12" cy="10" r="2.4" />
    <path d="M8.2 17c.5-1.8 2-2.8 3.8-2.8s3.3 1 3.8 2.8" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })} fill="currentColor" stroke="none">
    <path d="M12 2a6 6 0 0 0-6 6c0 4.2 6 13 6 13s6-8.8 6-13a6 6 0 0 0-6-6Z" />
  </svg>
);

export const RulesIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M6 3.5h8.5L19 8v12.5H6z" />
    <path d="M14 3.5V8h5M9 12h6M9 15.5h4" />
  </svg>
);

export const FolderIcon = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M3.5 6.8a2 2 0 0 1 2-2h3.4l2 2.2h7.6a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const ArrowRight = (p: P) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
  </svg>
);

export const DashboardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
    <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
  </svg>
);

export const TruckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </svg>
);

export const PencilIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4.2h-4.2" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const LogoutIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5" />
  </svg>
);

export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
    <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.6 2.8 2.2 3 4.7" />
  </svg>
);

export const ListIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.8" cy="6.5" r="1" />
    <circle cx="4.8" cy="12" r="1" />
    <circle cx="4.8" cy="17.5" r="1" />
  </svg>
);

export const FileIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
    <path d="M13.5 3.5V9H19M12 12v5M9.5 14.5h5" />
  </svg>
);

export const BoxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9Z" />
    <path d="M4 7.5 12 11.5l8-4M12 11.5v9" />
  </svg>
);

export const ScooterIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="17" r="2.5" />
    <circle cx="18" cy="17" r="2.5" />
    <path d="M8.5 17h6.5l2-7h-3M14 5.5h2.5L19 14.5" />
  </svg>
);

export const CheckCircleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8 12.2 2.8 2.8L16.2 9.5" />
  </svg>
);

export const ReturnIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 7.5 4.5 12 9 16.5" />
    <path d="M4.5 12h10a5 5 0 0 1 0 10h-2" />
  </svg>
);

export const UploadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 16V5M7 9.5l5-5 5 5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
  </svg>
);
