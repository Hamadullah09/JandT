import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, GarmentName, Loaded, Modal, Money, Notice, PAGE_SIZE, Pager, Panel, Status, Swatch, When,
  money, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Every tagged garment, and the same stock counted the ways people ask about it.
 *
 * Two tabs because there are two genuinely different questions. "Where is tag
 * E280…" wants a row per garment. "How many navy mediums have we got" wants a
 * row per colour and size, and answering it by counting a list of two thousand
 * rows is not an answer.
 */
export default function Stock() {
  const [tab, setTab] = React.useState('rollup');

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>All garments</h1>
          <p>Everything with a tag on it, and where it is.</p>
        </div>
        <div className="tabs">
          <button className={tab === 'rollup' ? 'on' : ''} onClick={() => setTab('rollup')}>
            Counted up
          </button>
          <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>
            One row per garment
          </button>
        </div>
      </div>

      {tab === 'rollup' ? <Rollup /> : <Items />}
    </>
  );
}

function Rollup() {
  const [by, setBy] = React.useState('variant');
  const state = useLoader(() => api.stock(by), [by]);
  const pages = usePages(state.data?.rows, by);

  const views = [
    ['variant', 'By colour and size'],
    ['category', 'By category'],
    ['color', 'By colour'],
    ['size', 'By size'],
    ['room', 'By room'],
  ];

  return (
    <>
      <Panel>
        <div className="tabs">
          {views.map(([value, label]) => (
            <button key={value} className={by === value ? 'on' : ''} onClick={() => setBy(value)}>
              {label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel tight>
        <Loaded
          state={state}
          empty={(d) => d.rows.length === 0 && (
            <Empty title="Nothing to count yet">Book some stock in first.</Empty>
          )}
        >
          {(d) => {
            const top = Math.max(...d.rows.map((r) => Number(r.in_stock)), 1);
            const totals = d.rows.reduce((a, r) => ({
              in_stock: a.in_stock + Number(r.in_stock),
              allocated: a.allocated + Number(r.allocated),
              shipped: a.shipped + Number(r.shipped),
              value: a.value + Number(r.stock_value),
            }), { in_stock: 0, allocated: 0, shipped: 0, value: 0 });

            return (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{views.find(([v]) => v === by)?.[1]}</th>
                      <th className="num">In stock</th>
                      <th style={{ width: '22%' }} />
                      <th className="num">Picked</th>
                      <th className="num">Shipped</th>
                      <th className="num">Stock value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.rows.map((r) => (
                      <tr key={`${by}-${r.id}`}>
                        <td>
                          <div className="strong">
                            {r.hex ? <Swatch hex={r.hex} name={r.label} /> : r.label}
                          </div>
                          {r.sub_label && <div className="small mono faint">{r.sub_label}</div>}
                        </td>
                        <td className="num strong">{r.in_stock}</td>
                        <td>
                          <div className="bar">
                            <div style={{ width: `${(Number(r.in_stock) / top) * 100}%` }} />
                          </div>
                        </td>
                        <td className="num muted">{r.allocated}</td>
                        <td className="num muted">{r.shipped}</td>
                        <td className="num"><Money value={r.stock_value} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th className="num">{totals.in_stock}</th>
                      <th />
                      <th className="num">{totals.allocated}</th>
                      <th className="num">{totals.shipped}</th>
                      <th className="num">{money(totals.value)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          }}
        </Loaded>
        {pages.pager}
      </Panel>
    </>
  );
}

function Items() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [roomId, setRoomId] = React.useState('');
  const [moving, setMoving] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const rooms = useLoader(() => api.rooms(), []);

  // Ten garments a page, read from the server a page at a time, because there
  // can be thousands. A new search or filter starts again at the first page.
  const filters = `${debounced}|${status}|${roomId}`;
  const [at, setAt] = React.useState({ page: 0, filters });
  if (at.filters !== filters) setAt({ page: 0, filters });
  const page = at.filters === filters ? at.page : 0;

  const list = useLoader(
    () => api.items({ search: debounced, status, roomId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [debounced, status, roomId, page]);

  // Garments moved away from under the last page leave it empty: step back to
  // the page that is now the last one.
  const total = Number(list.data?.total ?? 0);
  React.useEffect(() => {
    if (list.data && page > 0 && page * PAGE_SIZE >= total) {
      setAt({ page: Math.max(0, Math.ceil(total / PAGE_SIZE) - 1), filters });
    }
  }, [list.data]);

  return (
    <>
      <Panel
        actions={<button onClick={() => setMoving(true)}>Move garments to a room</button>}
      >
        <div className="row filters">
          <Field label="Search" help="Tag code, product name, code or order number.">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E280… or SO-20260914-0007 or 'navy'"
            />
          </Field>
          <Field label="State">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any state</option>
              <option value="in_stock">In stock</option>
              <option value="allocated">Picked for an order</option>
              <option value="shipped">Shipped</option>
              <option value="damaged">Damaged</option>
              <option value="lost">Lost</option>
              <option value="written_off">Written off</option>
            </select>
          </Field>
          <Field label="Room">
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Any room</option>
              {(rooms.data?.rooms ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel
        tight
        title="Garments"
        hint={list.data ? `${total} garment${total === 1 ? '' : 's'}` : undefined}
      >
        <Loaded
          state={list}
          empty={(d) => d.items.length === 0 && (
            <Empty title="Nothing matches">
              {search ? 'Try a different search, or clear the filters.' : 'No garments have been tagged yet.'}
            </Empty>
          )}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Garment</th>
                    <th>Room</th>
                    <th>State</th>
                    <th>On order</th>
                    <th className="num">Cost</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.id} className="pick" onClick={() => go('stock', i.id)}>
                      <td className="mono">{i.epc}</td>
                      <td><GarmentName row={i} /></td>
                      <td>{i.room_code ? <span className="pill grey">{i.room_code}</span> : '—'}</td>
                      <td><Status value={i.status} /></td>
                      <td className="small">
                        {i.order_no
                          ? <span className="mono">{i.order_no}</span>
                          : <span className="faint">—</span>}
                      </td>
                      <td className="num muted"><Money value={i.cost_price} /></td>
                      <td className="muted small">
                        <When value={i.last_seen_at ?? i.enrolled_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        <Pager page={page} total={total} onPage={(p) => setAt({ page: p, filters })} />
      </Panel>

      <MoveItems
        open={moving}
        rooms={(rooms.data?.rooms ?? []).filter((r) => Number(r.active) === 1)}
        onClose={() => setMoving(false)}
        onDone={() => { setMoving(false); list.reload(); }}
      />
    </>
  );
}

/**
 * Moving a shelf at a time.
 *
 * Tags are pasted in rather than scanned one by one, because this is the screen
 * somebody uses after walking a room with a handheld and exporting what it saw.
 * Unknown tags come back listed rather than failing the whole move.
 */
function MoveItems({ open, rooms, onClose, onDone }) {
  const [text, setText] = React.useState('');
  const [roomId, setRoomId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState(null);
  const act = useAction();

  const epcs = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  async function save() {
    const res = await act.run(() => api.moveItems(epcs, Number(roomId), note.trim() || null));
    if (res) {
      setResult(res);
      setText('');
      onDone();
    }
  }

  return (
    <Modal
      open={open}
      title="Move garments to a room"
      onClose={() => { setResult(null); onClose(); }}
      footer={
        <>
          <button onClick={() => { setResult(null); onClose(); }} disabled={act.busy}>Close</button>
          <button className="primary" onClick={save} disabled={act.busy || !roomId || epcs.length === 0}>
            {act.busy ? 'Moving…' : `Move ${epcs.length} tag${epcs.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      {result && (
        <Notice kind={result.skipped.length ? 'warn' : 'ok'}>
          <span>
            <b>{result.moved}</b> moved.
            {result.skipped.length > 0 && (
              <> {result.skipped.length} skipped: {result.skipped.map((s) => `${s.epc} (${s.reason})`).join(', ')}</>
            )}
          </span>
        </Notice>
      )}

      <Field label="Move into">
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Choose a room…</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
        </select>
      </Field>

      <Field
        label="Tag codes"
        help="One per line, or separated by commas. Spaces inside a code are fine."
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minHeight: 150, fontFamily: 'Consolas, monospace' }}
          placeholder={'E28011700000020000000001\nE28011700000020000000002'}
        />
      </Field>

      <Field label="Why" help="Optional. Goes on each garment's history.">
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Moved off the receiving bench" />
      </Field>
    </Modal>
  );
}
