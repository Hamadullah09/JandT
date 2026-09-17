'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { MenuIcon } from '@/components/ui/icons';

/**
 * The one off-canvas menu the phone layouts share: the merchant portal hangs
 * its Sidebar on it, the admin chrome its own list of links.  From `lg` up
 * nothing here applies - the sidebar is an ordinary column again and the
 * hamburger is not rendered.
 */

/** What `aria-controls` on the hamburger points at. */
const PANEL_ID = 'mobile-nav';

type MobileNav = {
  open: boolean;
  panelId: string;
  toggle: () => void;
  close: () => void;
  /** Closes the drawer when the click landed on a link inside it. */
  closeOnLink: (event: MouseEvent<HTMLElement>) => void;
  trigger: MutableRefObject<HTMLButtonElement | null>;
};

/** Used when a panel is rendered outside a provider: the menu simply stays shut. */
const CLOSED: MobileNav = {
  open: false,
  panelId: PANEL_ID,
  toggle: () => undefined,
  close: () => undefined,
  closeOnLink: () => undefined,
  trigger: { current: null },
};

const Context = createContext<MobileNav | null>(null);

export function useMobileNav(): MobileNav {
  return useContext(Context) ?? CLOSED;
}

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const closeOnLink = useCallback((event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a[href]')) setOpen(false);
  }, []);

  // a new page means a new menu state: the drawer has done its job
  useEffect(() => setOpen(false), [pathname]);

  // widening past `lg` puts the sidebar back in the page, so the drawer closes
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (wide.matches) setOpen(false);
    };
    sync();
    wide.addEventListener('change', sync);
    return () => wide.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The page behind must not scroll, and must not jump either: whatever width
  // the scrollbar took is given back as padding while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    const overflow = body.style.overflow;
    const padding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (bar > 0) body.style.paddingRight = `${bar}px`;
    return () => {
      body.style.overflow = overflow;
      body.style.paddingRight = padding;
    };
  }, [open]);

  // focus moves into the drawer when it opens, and back to the hamburger after
  useEffect(() => {
    if (open) {
      const panel = document.getElementById(PANEL_ID);
      panel
        ?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
        ?.focus();
    } else if (wasOpen.current) {
      trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <Context.Provider value={{ open, panelId: PANEL_ID, toggle, close, closeOnLink, trigger }}>
      {children}
      <MobileNavBackdrop />
    </Context.Provider>
  );
}

/** The dimmed page behind the drawer; clicking it closes the menu. */
function MobileNavBackdrop() {
  const { open, close } = useMobileNav();
  return (
    <div
      aria-hidden
      onClick={close}
      className={`fixed inset-0 z-40 bg-brand/40 transition-opacity duration-200 lg:hidden ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    />
  );
}

/** The sliding panel: off the left edge until it is opened. */
export const DRAWER_BASE =
  'fixed inset-y-0 left-0 z-50 w-sidebar max-w-[86vw] shadow-xl transition-[transform,visibility] duration-200 ease-out';

/** Added by a panel that is an ordinary column again from `lg` up. */
export const DRAWER_STATIC_LG =
  'lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:visible lg:shadow-none lg:transition-none';

export const drawerState = (open: boolean) =>
  open ? 'visible translate-x-0' : 'invisible -translate-x-full';

/** The hamburger. Only below `lg`, where the sidebar is off canvas. */
export function MobileNavButton({ className = '' }: { className?: string }) {
  const { open, panelId, toggle, trigger } = useMobileNav();
  return (
    <button
      ref={trigger}
      type="button"
      onClick={toggle}
      aria-label="Main menu"
      aria-expanded={open}
      aria-controls={panelId}
      className={`el-btn h-11 w-11 shrink-0 px-0 lg:hidden ${className}`}
    >
      <MenuIcon aria-hidden />
    </button>
  );
}

/**
 * A drawer for chrome that has no sidebar of its own (the admin portal).  The
 * merchant portal instead dresses its own Sidebar with DRAWER_BASE.
 */
export function MobileNavPanel({ label, children }: { label: string; children: ReactNode }) {
  const { open, panelId, closeOnLink } = useMobileNav();
  return (
    <aside
      id={panelId}
      aria-label={label}
      onClick={closeOnLink}
      className={`thin-scroll flex flex-col overflow-y-auto border-r border-line bg-white lg:hidden ${DRAWER_BASE} ${drawerState(open)}`}
    >
      {children}
    </aside>
  );
}
