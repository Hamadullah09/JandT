import React from 'react';
import { api, clock } from './api.js';

/**
 * Shared furniture.
 *
 * The rule for everything here: a screen should never have to decide how to
 * word a status, format money or render an empty list, because when it does
 * the same idea ends up with three different names across the app.
 */

/**
 * The shop's sign: "Inaaya" in a fine serif over small spaced capitals.
 *
 * The same mark, in the same proportions, as the courier portal's masthead
 * (components/brand/Logo.tsx over there) - one platform, one name on it.
 */
export function Wordmark({ caption = 'Fabrics' }) {
  return (
    <span aria-hidden="true">
      <span className="wordmark">Inaaya</span>
      <span className="wordmark-caption">{caption}</span>
    </span>
  );
}

// ------------------------------------------------------------------ loading

/**
 * Runs a fetch, and hands back what happened.
 *
 * `deps` is what the loader depends on, exactly like useEffect. `reload` is for
 * after a write. A request that finishes after a newer one started is thrown
 * away rather than allowed to overwrite it: typing in a search box fires
 * several, and the slowest is not the answer.
 */
export function useLoader(loader, deps = []) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null });
  const [nonce, setNonce] = React.useState(0);
  const latest = React.useRef(0);

  React.useEffect(() => {
    const mine = ++latest.current;
    let alive = true;

    setState((s) => ({ ...s, loading: true }));

    loader()
      .then((data) => { if (alive && mine === latest.current) setState({ loading: false, data, error: null }); })
      .catch((error) => {
        if (alive && mine === latest.current) setState({ loading: false, data: null, error: error.message });
      });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Wraps a write: one busy flag, one error, one success message. */
export function useAction(onDone) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [done, setDone] = React.useState(null);

  const run = React.useCallback(async (fn, message) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await fn();
      setDone(typeof message === 'function' ? message(result) : message ?? null);
      onDone?.(result);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [onDone]);

  return { busy, error, done, run, setError, setDone };
}

// ------------------------------------------------------------------ layout

export function Panel({ title, hint, actions, children, tight }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <header>
          {title && <h3>{title}</h3>}
          {hint && <span className="hint">{hint}</span>}
          {actions}
        </header>
      )}
      <div className={tight ? 'body tight' : 'body'}>{children}</div>
    </section>
  );
}

export function Field({ label, help, children }) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      {children}
      {help && <p className="help">{help}</p>}
    </label>
  );
}

export function Notice({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`notice ${kind}`}>{children}</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

/**
 * The three states a list can be in, in one place.
 *
 * Every table in the app had the same `if (loading) … if (error) … if (empty)`
 * preamble, which is how one of them ends up silently rendering nothing.
 */
export function Loaded({ state, empty, children }) {
  if (state.loading && !state.data) return <div className="loading">Loading…</div>;
  if (state.error) return <Notice kind="error">{state.error}</Notice>;
  if (!state.data) return null;
  const rows = typeof empty === 'function' ? empty(state.data) : null;
  if (rows) return rows;
  return children(state.data);
}

/** How many rows a long list shows at a time. */
export const PAGE_SIZE = 10;

/**
 * A long list, ten rows at a time.
 *
 * `rows` is the whole list. `resetOn` is whatever makes it a different list -
 * a search, a tab - and changing it goes back to the first page, because page
 * four of some other list is nowhere anybody asked to be. A list that gets
 * shorter under somebody on its last page (a find marked found) shows the new
 * last page rather than an empty one.
 */
export function usePages(rows, resetOn = '') {
  const [at, setAt] = React.useState({ page: 0, resetOn });
  if (at.resetOn !== resetOn) setAt({ page: 0, resetOn });

  const list = rows ?? [];
  const last = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
  const page = at.resetOn === resetOn ? Math.min(at.page, last) : 0;

  return {
    rows: list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    pager: <Pager page={page} total={list.length} onPage={(p) => setAt({ page: p, resetOn })} />,
  };
}

/**
 * Where you are in a long list, and the way round it: « first, ‹ previous, the
 * page numbers, › next, » last - the layout the owner asked for. Up to five
 * numbers, centred on the page you are on. Nothing at all for a list that fits
 * on one page, so a short list looks just as it did.
 */
export function Pager({ page, total, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  const shown = Math.min(5, pages);
  const first = Math.max(0, Math.min(page - Math.floor(shown / 2), pages - shown));
  const numbers = Array.from({ length: shown }, (_, i) => first + i);
  const atStart = page === 0;
  const atEnd = page >= pages - 1;

  return (
    <div className="pager">
      <span className="small muted">
        {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
      </span>
      <nav className="pages" aria-label="Pages">
        <button onClick={() => onPage(0)} disabled={atStart} title="First page" aria-label="First page">«</button>
        <button onClick={() => onPage(page - 1)} disabled={atStart} title="Previous page" aria-label="Previous page">‹</button>
        {numbers.map((n) => (
          <button
            key={n}
            className={n === page ? 'on' : undefined}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
          >
            {n + 1}
          </button>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={atEnd} title="Next page" aria-label="Next page">›</button>
        <button onClick={() => onPage(pages - 1)} disabled={atEnd} title="Last page" aria-label="Last page">»</button>
      </nav>
    </div>
  );
}

export function Stat({ label, value, note, tone, onClick }) {
  return (
    <div
      className={`stat${tone ? ` ${tone}` : ''}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="label">{label}</div>
      <StatValue>{value}</StatValue>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

/**
 * A stat card's figure. Amounts in ringgit and sen are long - RM 302,200.00 -
 * and at the full size would break onto two lines in a narrow card, so a long
 * figure drops a size instead.
 */
export function StatValue({ children }) {
  const length = typeof children === 'string' || typeof children === 'number' ? String(children).length : 0;
  return <div className={`value${length > 15 ? ' longer' : length > 10 ? ' long' : ''}`}>{children}</div>;
}

export function Modal({ open, title, children, footer, onClose }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog className="modal" ref={ref} onCancel={(e) => { e.preventDefault(); onClose?.(); }}>
      <header>
        <h3>{title}</h3>
        <button className="link" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}

// ------------------------------------------------------------------ values

/**
 * Status words, and the colour that goes with each.
 *
 * Centralised because the same status appears on five screens, and a garment
 * described as "allocated" on one and "reserved" on another reads as two
 * different things to somebody who does not know the schema.
 */
const STATUS = {
  // items
  in_stock: ['ok', 'In stock'],
  allocated: ['info', 'Picked'],
  shipped: ['brand', 'Shipped'],
  returned: ['warn', 'Returned'],
  damaged: ['bad', 'Damaged'],
  lost: ['bad', 'Lost'],
  written_off: ['grey', 'Written off'],

  // orders
  pending: ['warn', 'To pick'],
  // An order with nothing to scan (every line dropship) waits for Send it out.
  to_send: ['warn', 'To send'],
  packed: ['info', 'Packed'],
  delivered: ['ok', 'Delivered'],
  cancelled: ['grey', 'Cancelled'],
  partly_returned: ['warn', 'Part returned'],

  // batches and returns
  open: ['warn', 'Open'],
  complete: ['ok', 'Complete'],
  requested: ['warn', 'Requested'],
  received: ['info', 'At the desk'],
  closed: ['ok', 'Closed'],
  rejected: ['bad', 'Rejected'],
  found: ['ok', 'Found'],

  // return verdicts
  matched: ['ok', 'Correct garment'],
  wrong_order: ['bad', 'Another order'],
  not_shipped: ['bad', 'Never sent out'],
  unknown_tag: ['bad', 'Not our tag'],

  // routes
  stock: ['brand', 'From stock'],
  dropship: ['info', 'Dropship'],

  // Courier (J&T) parcel statuses, as the courier module records them. The
  // colours are the courier portal's own, so a parcel that is out for delivery
  // is the same colour on both sides of the platform.
  CREATED: ['grey', 'Booked, awaiting pickup'],
  PICKED_UP: ['info', 'Picked up by J&T'],
  IN_TRANSIT: ['warn', 'In transit'],
  ON_DELIVERY: ['via', 'Out for delivery'],
  DELIVERED: ['ok', 'Delivered'],
  RETURNED: ['bad', 'Returned to shop'],
};

export function Status({ value }) {
  if (!value) return <span className="faint">—</span>;
  const [tone, label] = STATUS[value] ?? ['grey', String(value).replace(/_/g, ' ')];
  return <span className={`pill ${tone}`}>{label}</span>;
}

export const statusLabel = (value) => STATUS[value]?.[1] ?? String(value ?? '').replace(/_/g, ' ');

export function Swatch({ hex, name }) {
  return (
    <>
      <span className="swatch" style={{ background: hex || '#ccc' }} title={name} />
      {name}
    </>
  );
}

/**
 * A garment photo in a 3:4 frame, or a plain placeholder when there is none.
 *
 * A photo that fails to load - removed since the page was drawn, or the server
 * briefly unreachable - falls back to the placeholder rather than showing the
 * browser's broken-image icon, which reads as the page being broken.
 */
export function Photo({ url, alt, onClick, style }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);

  return (
    <div className="photo" onClick={onClick} style={style}>
      {url && !failed
        ? <img src={url} alt={alt ?? ''} loading="lazy" onError={() => setFailed(true)} />
        : <span>No photo</span>}
    </div>
  );
}

/**
 * "Find" beside a colour and size: puts every one of them that is on a shelf
 * on the list and opens Find a garment, where they now head the list. Finding
 * any one of them takes the rest off every handheld.
 *
 * Disabled with nothing in stock rather than hidden, so a row with none says
 * why the button cannot be pressed instead of looking different to its
 * neighbours.
 */
export function FindButton({ variant, className = '' }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const inStock = Number(variant.in_stock ?? 0);

  async function find(e) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await api.findVariant(variant.id);
      window.location.hash = '#/find';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={find}
        disabled={busy || inStock === 0}
        title={inStock === 0 ? 'None on a shelf to find' : 'Send the handhelds to find one'}
      >
        {busy ? '…' : 'Find'}
      </button>
      {error && <span className="small" style={{ color: 'var(--bad)' }}>{error}</span>}
    </>
  );
}

/**
 * Ringgit and sen, the way inaayastore.com prices them: RM 56.35. The space is
 * a non-breaking one, so a narrow column never puts RM and the number on two lines.
 */
const ringgit = (n) => n.toLocaleString(['en-MY', 'en'], { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Money({ value, sign }) {
  const n = Number(value ?? 0);
  const text = `RM\u00a0${ringgit(Math.abs(n))}`;
  if (sign && n > 0) return <span>+{text}</span>;
  return <span>{n < 0 ? `−${text}` : text}</span>;
}

export const money = (value) => `RM\u00a0${ringgit(Number(value ?? 0))}`;

/**
 * Dates as a person would say them. "Today, 14:05" beats a timestamp for
 * anything that happened this week, which is nearly everything on these screens.
 */
export function When({ value, time = true }) {
  if (!value) return <span className="faint">—</span>;
  // The server sends instants in UTC ("2026-09-16T07:17:51Z") and they are
  // shown on the shop's clock - the zone the server named at sign-in - so a
  // time reads the same here as in the courier portal, on any computer. A value
  // with no offset ("2026-09-16", a date typed into an import) is already on
  // the shop's clock and is shown as written.
  const bare = typeof value === 'string' && BARE_DATE_TIME.test(value);
  const d = new Date(bare ? `${value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(d.getTime())) return <span className="faint">—</span>;

  const timeZone = bare ? 'UTC' : clock.zone;
  const now = Date.now();
  const day = dayOf(d, timeZone);
  const sameDay = day === dayOf(new Date(now), clock.zone);
  const yesterday = day === dayOf(new Date(now - 864e5), clock.zone);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone });
  const full = d.toLocaleString([], { timeZone });

  if (sameDay) return <span title={full}>{time ? `Today, ${hm}` : 'Today'}</span>;
  if (yesterday) return <span title={full}>{time ? `Yesterday, ${hm}` : 'Yesterday'}</span>;

  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  return <span title={full}>{time ? `${date}, ${hm}` : date}</span>;
}

const BARE_DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/** The calendar day an instant falls on in a zone, as 2026-09-16. */
function dayOf(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A garment named the way the warehouse names it. */
export function GarmentName({ row }) {
  return (
    <>
      <div className="strong">{row.product_name ?? '—'}</div>
      <div className="small muted">
        <Swatch hex={row.color_hex} name={row.color_name} /> · {row.size_code ?? row.size_name}
        {row.sku && <> · <span className="mono">{row.sku}</span></>}
      </div>
    </>
  );
}

// ----------------------------------------------------------------- pickers

/**
 * Choose a garment.
 *
 * Search-as-you-type over every colour and size, rather than three chained
 * dropdowns, because the person doing this already knows what they want and
 * would rather type "navy m" than pick a product, then a colour, then a size.
 */
export function VariantPicker({ onPick, inStockOnly, placeholder }) {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoader(
    () => api.variants({ search: debounced, inStock: inStockOnly ? 1 : '' }),
    [debounced, inStockOnly]);

  const rows = list.data?.variants ?? [];

  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder ?? 'Search by product, colour, size or code…'}
        autoFocus
      />

      {list.error && <Notice kind="error">{list.error}</Notice>}

      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 12 }}>
        <table>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="pick" onClick={() => onPick(v)}>
                <td>
                  <GarmentName row={v} />
                </td>
                <td className="tight small muted">{v.category_name}</td>
                <td className="tight num">{money(v.sale_price)}</td>
                <td className="tight num">
                  {v.stock_type === 'dropship'
                    ? <span className="pill info">{v.dropship_qty} dropship</span>
                    : <span className={`pill ${Number(v.sellable) > 0 ? 'ok' : 'grey'}`}>
                        {v.sellable} in stock
                      </span>}
                </td>
              </tr>
            ))}
            {!list.loading && rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <Empty title="Nothing matches">
                    {inStockOnly
                      ? 'Try again without limiting to what is in stock.'
                      : 'Add the product first, under Products.'}
                  </Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The tag box.
 *
 * A USB reader behaves exactly like a keyboard that types very fast and then
 * presses Enter, so this is a form that submits on Enter and immediately clears
 * and refocuses itself. Anything else means the operator has to click back into
 * the box between every garment.
 */
export function ScanBox({ onScan, busy, label = 'Add', placeholder = 'Scan or type a tag code…', hint }) {
  const [value, setValue] = React.useState('');
  const input = React.useRef(null);

  React.useEffect(() => { input.current?.focus(); }, []);

  async function submit(e) {
    e?.preventDefault();
    const epc = value.trim();
    if (!epc || busy) return;
    setValue('');
    await onScan(epc);
    input.current?.focus();
  }

  /**
   * Enter, handled here rather than left to the form.
   *
   * Implicit form submission is not something to rely on with a reader: some
   * send Tab rather than Enter, and some send a key event that never triggers
   * the browser's default. A reader that types a code and then appears to do
   * nothing is indistinguishable from a broken reader, so both keys are taken
   * explicitly.
   */
  function onKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    if (!value.trim()) return;
    e.preventDefault();
    submit();
  }

  return (
    <form onSubmit={submit}>
      <div className="scanbox">
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck="false"
        />
        <button className="primary" type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Working…' : label}
        </button>
      </div>
      {hint && <p className="help faint small" style={{ marginTop: 6 }}>{hint}</p>}
    </form>
  );
}

/** A running list of what the reader has just done, newest first. */
export function ScanLog({ entries, onUndo }) {
  if (entries.length === 0) return null;
  return (
    <div className="scanlog">
      {entries.map((e) => (
        <div key={e.key} className={`line ${e.tone}`}>
          <span className="mono">{e.epc}</span>
          <span className="grow">{e.message}</span>
          {onUndo && e.undo && (
            <button className="link bad sm" onClick={() => onUndo(e)}>Undo</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** A yes/no that says what it is about to do, rather than "Are you sure?". */
export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onClose, busy }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
