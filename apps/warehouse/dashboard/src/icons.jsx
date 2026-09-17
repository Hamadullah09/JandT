import React from 'react';

/**
 * The menu's icons: inline strokes, no icon font, no download.
 *
 * Drawn to the courier portal's set (its components/ui/icons.tsx) - same box,
 * same 1.7 stroke, same rounded ends - so the two halves of the platform have
 * one hand behind them. The ones both modules share (the truck, the admin
 * squares, the home) are that file's, unchanged.
 */

const Svg = ({ children, size = 19, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

/** name -> icon, so the menu can name what it wants rather than draw it. */
export const ICONS = {
  // everyday
  overview: (p) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </Svg>
  ),
  orders: (p) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 9h8M8 13h5" />
    </Svg>
  ),
  truck: (p) => (
    <Svg {...p}>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </Svg>
  ),
  returns: (p) => (
    <Svg {...p}>
      <path d="M8.5 7.5 4.5 11.5l4 4" />
      <path d="M4.5 11.5h10a5 5 0 0 1 0 10h-3" />
    </Svg>
  ),
  find: (p) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Svg>
  ),
  bell: (p) => (
    <Svg {...p}>
      <path d="M18 16.5H6v-5a6 6 0 1 1 12 0v5Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </Svg>
  ),

  // stock
  garments: (p) => (
    <Svg {...p}>
      <path d="M9 3.5 5 5.5l-1.5 4 2.5 1V20.5h11V10.5l2.5-1L18 5.5l-4-2" />
      <path d="M9 3.5a3 3 0 0 0 6 0" />
    </Svg>
  ),
  intake: (p) => (
    <Svg {...p}>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
      <path d="M12 12v6M8.5 9.8 12 11.4l3.5-1.6" />
      <path d="M9.5 15h5" />
    </Svg>
  ),
  rooms: (p) => (
    <Svg {...p}>
      <path d="M3 9.5 12 4l9 5.5V20H3Z" />
      <path d="M7 20v-7h10v7M7 16h10" />
    </Svg>
  ),

  // catalogue
  products: (p) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 20.5v-11" />
    </Svg>
  ),
  settings: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </Svg>
  ),

  // the courier module
  portal: (p) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.8 6.5 8.2 6 8.2-6" />
    </Svg>
  ),
  upload: (p) => (
    <Svg {...p}>
      <path d="M12 16V4.5M8 8l4-3.5L16 8" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </Svg>
  ),
  tracking: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3" />
    </Svg>
  ),

  // admin
  users: (p) => (
    <Svg {...p}>
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3.5 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.9c2 .7 3.3 2.4 3.7 5.1" />
    </Svg>
  ),
  account: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 18.6c1-2.2 3-3.4 5.5-3.4s4.5 1.2 5.5 3.4" />
    </Svg>
  ),
};

/** One icon by name, sized for the menu. */
export function Icon({ name, size }) {
  const draw = ICONS[name];
  return draw ? draw({ size }) : null;
}
