import React from 'react';
import { api, auth, clock, platform, sessionEnded } from './api.js';
import { Wordmark } from './components.jsx';
import { Icon } from './icons.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Products from './pages/Products.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Intake from './pages/Intake.jsx';
import IntakeDetail from './pages/IntakeDetail.jsx';
import Stock from './pages/Stock.jsx';
import ItemDetail from './pages/ItemDetail.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Shipments from './pages/Shipments.jsx';
import Returns from './pages/Returns.jsx';
import ReturnDetail from './pages/ReturnDetail.jsx';
import Find from './pages/Find.jsx';
import Notifications from './pages/Notifications.jsx';
import Rooms from './pages/Rooms.jsx';
import Setup from './pages/Setup.jsx';
import Users from './pages/Users.jsx';
import Account from './pages/Account.jsx';

/**
 * The shell: who is signed in, where they are, and what needs attention.
 *
 * Routing is the URL hash rather than a router library. The app has fifteen
 * screens and two levels of nesting, which a twenty-line parser handles, and
 * the hash means a deep link survives a browser reload without the server
 * needing to know any of these paths.
 */

function useHashRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    // "#/intake?book=12": what comes after the ? is for the page, not the route.
    const [path, search = ''] = raw.split('?');
    const [page = 'overview', id] = path.split('/');
    return { page, id: id ? Number(id) : null, query: Object.fromEntries(new URLSearchParams(search)) };
  };

  const [route, setRoute] = React.useState(read);

  React.useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export const go = (page, id, query) => {
  const path = id ? `#/${page}/${id}` : `#/${page}`;
  window.location.hash = query ? `${path}?${new URLSearchParams(query)}` : path;
};

const NAV = [
  { group: 'Every day' },
  { page: 'overview', label: 'Overview', icon: 'overview' },
  { page: 'orders', label: 'Orders', icon: 'orders', badge: 'orders' },
  { page: 'shipments', label: 'J&T shipments', icon: 'truck', badge: 'toBook' },
  { page: 'returns', label: 'Returns', icon: 'returns', badge: 'returns' },
  { page: 'find', label: 'Find a garment', icon: 'find', badge: 'finds' },
  { page: 'notifications', label: 'Notifications', icon: 'bell', badge: 'lowStock' },

  { group: 'Stock' },
  { page: 'stock', label: 'All garments', icon: 'garments' },
  { page: 'intake', label: 'Book in stock', icon: 'intake', badge: 'batches' },
  { page: 'rooms', label: 'Rooms', icon: 'rooms' },

  { group: 'Catalogue' },
  { page: 'products', label: 'Products', icon: 'products' },
  { page: 'setup', label: 'Categories & sizes', icon: 'settings', admin: true },

  // The other half of the platform. Full page links: the courier portal is its
  // own application on the same address, and shares this sign-in.
  { group: 'Courier (J&T)', platform: true },
  { href: '/', label: 'Shipping portal', icon: 'portal', platform: true },
  { href: '/order/bulk-import', label: 'Bulk import orders', icon: 'upload', platform: true },
  { href: '/admin', label: 'Courier admin', icon: 'overview', admin: true, platform: true },
  { href: '/tracking', label: 'Track a parcel', icon: 'tracking', platform: true, newTab: true },

  { group: 'Admin' },
  { page: 'users', label: 'Users', icon: 'users', admin: true },
  { page: 'account', label: 'My account', icon: 'account' },
];

/** What the top bar calls the screen you are on. */
const PAGE_TITLES = Object.fromEntries(NAV.filter((entry) => entry.page).map((entry) => [entry.page, entry.label]));

/** Roles, worded as the courier portal words them. */
const ROLE_LABEL = { admin: 'Admin', operator: 'Operator', merchant: 'Shop user' };

/**
 * Who is signed in, and where else they can go.
 *
 * The same menu as the courier portal's top bar: the account, the platform's
 * other module, this one, your own account, and the way out. It is the one
 * place both modules put "take me to the other half", so nobody has to learn
 * two answers to the same question.
 */
function AccountMenu({ user, onSignOut, drawerOpen }) {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef(null);

  // Two things covering the page at once is one too many: opening the menu
  // beside it closes this.
  React.useEffect(() => { if (drawerOpen) setOpen(false); }, [drawerOpen]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goTo = (page) => () => { setOpen(false); go(page); };

  return (
    <div className="account" ref={box}>
      <button
        className="account-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="avatar" aria-hidden="true">👤</span>
        <span className="name">
          <b>{user.fullName}</b>
          <small>{ROLE_LABEL[user.role] ?? user.role}</small>
        </span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <b>{user.fullName}</b>
            <small>{user.username} · {ROLE_LABEL[user.role] ?? user.role}</small>
          </div>

          {/* The other half of the platform, when it is next door. */}
          {platform.active && (
            <a role="menuitem" href="/" onClick={() => setOpen(false)}>
              Courier portal <span className="ext" aria-hidden="true">↗</span>
            </a>
          )}
          <button role="menuitem" onClick={goTo('overview')}>Warehouse</button>
          <button role="menuitem" onClick={goTo('account')}>My profile</button>
          <button role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = React.useState(auth.user);
  // Until we know whether a platform sign-in exists, show nothing rather than
  // flashing the login form at somebody who is already signed in.
  const [checking, setChecking] = React.useState(!auth.token);
  // Signed in to the platform, but with an account the warehouse does not take.
  const [wrongModule, setWrongModule] = React.useState(false);
  // The menu, on a screen too narrow to keep it open beside the page.
  const [menuOpen, setMenuOpen] = React.useState(false);
  // The shop's clock, which every time on screen is shown on. It normally comes
  // with the sign-in; a sign-in kept from before it did brings it with the
  // check below, and times already on screen are redrawn on it.
  const [, setTimeZone] = React.useState(clock.zone);
  const route = useHashRoute();

  // A token that has expired is discovered on the next call, not on a timer.
  React.useEffect(() => {
    const onEnded = () => {
      setUser(null);
      if (platform.active) platform.signIn();
    };
    sessionEnded.addEventListener('ended', onEnded);
    return () => sessionEnded.removeEventListener('ended', onEnded);
  }, []);

  // Confirms the stored token is still good before showing anything behind it,
  // so a stale sign-in fails at the door rather than on the first screen. With
  // no token of our own, a platform sign-in (the courier portal's cookie) is
  // taken up instead - that is single sign-on.
  React.useEffect(() => {
    if (auth.token) {
      api.me()
        .then(() => setTimeZone(clock.zone))
        .catch(() => { auth.clear(); setUser(null); });
      return;
    }
    api.session()
      .then((s) => { auth.save(s.token, s.user); setUser(s.user); })
      .catch((err) => {
        // 403: signed in, as a merchant. Sending them to the login page would
        // only send them straight back here.
        if (err.status === 403) setWrongModule(true);
        else if (platform.active) platform.signIn();
      })
      .finally(() => setChecking(false));
  }, []);

  // The drawer closes behind you: going somewhere is the end of using the menu,
  // and Escape is what a person presses when something is covering the page.
  React.useEffect(() => { setMenuOpen(false); }, [route.page, route.id]);
  React.useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Counts for the nav badges. Refreshed on a slow timer and whenever the page
  // changes, which covers the cases that matter without polling hard.
  const [badges, setBadges] = React.useState({});
  React.useEffect(() => {
    if (!user) return;
    let alive = true;

    const load = () => api.overview()
      .then((d) => {
        if (!alive) return;
        setBadges({
          orders: Number(d.orders?.pending ?? 0),
          returns: Number(d.counts?.open_returns ?? 0),
          finds: Number(d.counts?.open_finds ?? 0),
          batches: Number(d.counts?.open_batches ?? 0),
          lowStock: Number(d.lowStockCount ?? 0),
          toBook: Number(d.shipping?.to_book ?? 0),
        });
      })
      .catch(() => { /* a badge is not worth an error message */ });

    load();
    const timer = setInterval(load, 45_000);
    return () => { alive = false; clearInterval(timer); };
  }, [user, route.page]);

  async function signOut() {
    try { await api.logout(); } catch { /* signed out already */ }
    auth.clear();
    setUser(null);
    if (platform.active) window.location.assign('/login');
  }

  if (checking && !user) return <div className="loading">Signing in…</div>;

  if (wrongModule && !user) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="mark"><Wordmark /></div>
          <h1>Warehouse</h1>
          <p className="sub">
            You are signed in with a courier portal account. The warehouse needs a staff account
            (admin or operator).
          </p>
          <button className="primary block" onClick={() => window.location.assign('/')}>
            Go to the courier portal
          </button>
          <button className="link" style={{ marginTop: 12 }} onClick={signOut}>
            Sign in as somebody else
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onSignedIn={(u) => { setUser(u); go('overview'); }} />;
  }

  const isAdmin = user.role === 'admin';

  const pages = {
    overview: <Overview />,
    orders: route.id ? <OrderDetail id={route.id} /> : <Orders />,
    shipments: <Shipments />,
    returns: route.id ? <ReturnDetail id={route.id} /> : <Returns />,
    find: <Find />,
    notifications: <Notifications />,
    stock: route.id ? <ItemDetail id={route.id} /> : <Stock />,
    intake: route.id ? <IntakeDetail id={route.id} /> : <Intake book={route.query.book} isAdmin={isAdmin} />,
    rooms: <Rooms isAdmin={isAdmin} />,
    products: route.id ? <ProductDetail id={route.id} isAdmin={isAdmin} /> : <Products isAdmin={isAdmin} />,
    setup: <Setup isAdmin={isAdmin} />,
    users: <Users />,
    account: <Account user={user} />,
  };

  const title = PAGE_TITLES[route.page] ?? 'Warehouse';

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <aside className="sidebar" id="warehouse-menu" aria-label="Warehouse menu">
        <button className="brand" onClick={() => go('overview')} aria-label="Inaaya Fabrics - Warehouse">
          <Wordmark />
          <span className="brand-sub">Warehouse</span>
        </button>

        <nav className="nav">
          {NAV.map((entry, i) => {
            if (entry.platform && !platform.active) return null;
            if (entry.group) return <div className="nav-group" key={`g${i}`}>{entry.group}</div>;
            if (entry.admin && !isAdmin) return null;

            if (entry.href) {
              return (
                <a
                  key={entry.href}
                  className="nav-link"
                  href={entry.href}
                  target={entry.newTab ? '_blank' : undefined}
                  rel={entry.newTab ? 'noreferrer' : undefined}
                >
                  <Icon name={entry.icon} />
                  {entry.label}
                  <span className="ext" aria-hidden="true">↗</span>
                </a>
              );
            }

            const count = badges[entry.badge] ?? 0;
            return (
              <button
                key={entry.page}
                className={route.page === entry.page ? 'on' : ''}
                onClick={() => go(entry.page)}
              >
                <Icon name={entry.icon} />
                {entry.label}
                {count > 0 && <span className="pip">{count}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Closes the drawer when the page behind it is tapped. */}
      <button className="scrim" tabIndex={-1} aria-hidden="true" onClick={() => setMenuOpen(false)} />

      <div className="content">
        <header className="topbar">
          <button
            className="burger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-controls="warehouse-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>

          <h2 className="topbar-title">{title}</h2>

          <AccountMenu user={user} onSignOut={signOut} drawerOpen={menuOpen} />
        </header>

        <main className="main">
          {pages[route.page] ?? <Overview />}
        </main>
      </div>
    </div>
  );
}
