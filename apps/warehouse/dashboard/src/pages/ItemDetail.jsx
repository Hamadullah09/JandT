import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Field, Loaded, Modal, Money, Notice, Panel, Status, Swatch, When, statusLabel,
  useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * One garment, and everything that has happened to it.
 *
 * The history is the part that matters. It is read from the append-only ledger,
 * so it is the same record that settles an argument about whether something was
 * ever actually sent — which is why nothing on this page edits it.
 */
export default function ItemDetail({ id }) {
  const state = useLoader(() => api.item(id), [id]);
  const history = usePages(state.data?.history, id);
  const [editing, setEditing] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const act = useAction();

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <button className="link" onClick={() => go('stock')}>← All garments</button>
          <h1>{state.data?.item?.product_name ?? 'Garment'}</h1>
          <p className="mono">{state.data?.item?.epc}</p>
        </div>
        {state.data && (
          <>
            <button onClick={() => setFinding(true)}>Send to the handhelds</button>
            <button onClick={() => setEditing(true)}>Move or mark</button>
          </>
        )}
      </div>

      <Loaded state={state}>
        {(d) => (
          <>
            <div className="grid two">
              <Panel title="What it is">
                <dl className="kv">
                  <dt>Product</dt>
                  <dd>
                    <button className="link" onClick={() => go('products', d.item.product_id)}>
                      {d.item.product_name}
                    </button>
                  </dd>
                  <dt>Colour</dt>
                  <dd><Swatch hex={d.item.color_hex} name={d.item.color_name} /></dd>
                  <dt>Size</dt>
                  <dd>{d.item.size_name} ({d.item.size_code})</dd>
                  <dt>Category</dt>
                  <dd>{d.item.category_name}</dd>
                  <dt>Code</dt>
                  <dd className="mono">{d.item.sku}</dd>
                  <dt>Description</dt>
                  <dd>{d.item.description || <span className="faint">Not set</span>}</dd>
                  {d.item.notes && (<><dt>Note</dt><dd>{d.item.notes}</dd></>)}
                </dl>
              </Panel>

              <Panel title="Where it is">
                <dl className="kv">
                  <dt>State</dt>
                  <dd><Status value={d.item.status} /></dd>
                  <dt>Room</dt>
                  <dd>
                    {d.item.room_code
                      ? <><span className="pill grey">{d.item.room_code}</span> {d.item.room_name}</>
                      : <span className="faint">Not in a room</span>}
                  </dd>
                  <dt>On order</dt>
                  <dd>
                    {d.item.order_no ? (
                      <button className="link" onClick={() => go('orders', d.item.order_id)}>
                        {d.item.order_no} — {d.item.customer_name}
                      </button>
                    ) : <span className="faint">Not on an order</span>}
                  </dd>
                  <dt>Cost</dt>
                  <dd><Money value={d.item.cost_price} /></dd>
                  <dt>Sells for</dt>
                  <dd><Money value={d.item.sale_price} /></dd>
                  <dt>Booked in</dt>
                  <dd>
                    <When value={d.item.enrolled_at} />
                    {d.item.batch_no && <span className="muted small"> on {d.item.batch_no}</span>}
                    {d.item.enrolled_by_name && <span className="muted small"> by {d.item.enrolled_by_name}</span>}
                  </dd>
                  <dt>Last seen</dt>
                  <dd><When value={d.item.last_seen_at} /></dd>
                </dl>
              </Panel>
            </div>

            <Panel title="History" hint="newest first, and never edited">
              <ul className="timeline">
                {history.rows.map((h) => (
                  <li key={h.id}>
                    <span className="when"><When value={h.occurred_at} /></span>
                    <span className="grow">
                      <b>{MOVEMENT[h.type] ?? h.type}</b>
                      {h.from_status !== h.to_status && (
                        <span className="muted">
                          {' '}— {statusLabel(h.from_status)} → {statusLabel(h.to_status)}
                        </span>
                      )}
                      {h.to_room && h.to_room !== h.from_room && (
                        <span className="muted"> · into {h.to_room}</span>
                      )}
                      {h.order_no && <span className="muted"> · {h.order_no}</span>}
                      {h.return_no && <span className="muted"> · {h.return_no}</span>}
                      {h.note && <div className="small faint">{h.note}</div>}
                    </span>
                    <span className="faint small nowrap">{h.user_name ?? ''}</span>
                  </li>
                ))}
              </ul>
              {history.pager}
            </Panel>

            <MoveOrMark
              open={editing}
              item={d.item}
              onClose={() => setEditing(false)}
              onDone={() => { setEditing(false); state.reload(); }}
            />

            <Modal
              open={finding}
              title="Send this to the handhelds"
              onClose={() => setFinding(false)}
              footer={
                <>
                  <button onClick={() => setFinding(false)} disabled={act.busy}>Cancel</button>
                  <button
                    className="primary"
                    disabled={act.busy}
                    onClick={async () => {
                      const res = await act.run(() => api.createFind({
                        epc: d.item.epc,
                        note: `${d.item.product_name}, ${d.item.color_name} ${d.item.size_code}`,
                      }));
                      if (res) { setFinding(false); go('find'); }
                    }}
                  >
                    {act.busy ? 'Sending…' : 'Put it on the find list'}
                  </button>
                </>
              }
            >
              <Notice kind="error">{act.error}</Notice>
              <p>
                Every handheld will pick this up. The reader turns into a finder that gets
                louder as the operator gets closer, and the radar screen shows which way to turn.
              </p>
              <p className="muted small">
                It was last seen {d.item.room_code ? `in ${d.item.room_code}` : 'nowhere in particular'}.
              </p>
            </Modal>
          </>
        )}
      </Loaded>
    </>
  );
}

const MOVEMENT = {
  intake: 'Booked in',
  move: 'Moved',
  allocate: 'Picked for an order',
  ship: 'Shipped',
  return: 'Came back',
  restock: 'Back into stock',
  adjust: 'Changed by hand',
  write_off: 'Written off',
};

function MoveOrMark({ open, item, onClose, onDone }) {
  const rooms = useLoader(() => api.rooms(), []);
  const [roomId, setRoomId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const act = useAction();

  React.useEffect(() => {
    if (open && item) {
      setRoomId(item.room_id ? String(item.room_id) : '');
      setStatus('');
      setNotes(item.notes ?? '');
    }
  }, [open, item]);

  // Only the states a person is allowed to set. Picked and shipped follow
  // orders, and letting somebody set them here would put the ledger and the
  // order out of step with each other.
  const settable = [
    ['', 'Leave as it is'],
    ['in_stock', 'In stock'],
    ['damaged', 'Damaged'],
    ['lost', 'Lost'],
    ['written_off', 'Written off'],
  ];

  const onOrder = item?.status === 'allocated' || item?.status === 'shipped';

  async function save() {
    const res = await act.run(() => api.updateItem(item.id, {
      roomId: roomId ? Number(roomId) : null,
      status: status || null,
      notes: notes.trim() || null,
    }));
    if (res) onDone();
  }

  return (
    <Modal
      open={open}
      title="Move or mark this garment"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy}>
            {act.busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      {onOrder && (
        <Notice kind="warn">
          This garment is on order {item.order_no}. Its state cannot be changed here — cancel
          or return the order instead. You can still move it to a different room.
        </Notice>
      )}

      <Field label="Room">
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Not in a room</option>
          {(rooms.data?.rooms ?? []).filter((r) => Number(r.active) === 1).map((r) => (
            <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
          ))}
        </select>
      </Field>

      <Field label="State">
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={onOrder}>
          {settable.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>

      <Field label="Note" help="Anything worth knowing about this one garment.">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Small mark on the left cuff" />
      </Field>
    </Modal>
  );
}
