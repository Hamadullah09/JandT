import React from 'react';
import { api } from '../api.js';
import {
  Empty, Field, Loaded, Modal, Money, Notice, Panel, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Rooms, and the tags on their doors.
 *
 * A door tag is worth the two minutes it takes to stick on: with one, the
 * handheld knows where it is standing because the operator scanned a doorframe,
 * rather than because they picked the right room out of a list of forty while
 * holding a trolley.
 */
const KINDS = [
  ['storage', 'Storage — stock is picked from here'],
  ['receiving', 'Goods in — deliveries land here'],
  ['packing', 'Packing bench'],
  ['returns', 'Returns bench'],
  ['quarantine', 'Quarantine — not sellable'],
];

const KIND_LABEL = Object.fromEntries(KINDS.map(([k, v]) => [k, v.split(' — ')[0]]));

export default function Rooms({ isAdmin }) {
  const rooms = useLoader(() => api.rooms(), []);
  const pages = usePages(rooms.data?.rooms);
  const tags = useLoader(() => api.roomTags(), []);
  const [editing, setEditing] = React.useState(null);
  const [tagging, setTagging] = React.useState(null);
  const act = useAction();

  const tagsByRoom = (tags.data?.tags ?? []).reduce((m, t) => {
    (m[t.room_id] ??= []).push(t);
    return m;
  }, {});

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Rooms</h1>
          <p>Where stock lives: A1, B2, the returns bench.</p>
        </div>
        {isAdmin && (
          <button className="primary" onClick={() => setEditing({})}>New room</button>
        )}
      </div>

      <Notice kind="error">{act.error}</Notice>

      <Panel tight>
        <Loaded
          state={rooms}
          empty={(d) => d.rooms.length === 0 && (
            <Empty title="No rooms yet">Add the rooms your warehouse actually has.</Empty>
          )}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Used for</th>
                    <th className="num">In stock</th>
                    <th className="num">Value</th>
                    <th>Door tags</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((r) => {
                    const roomTags = tagsByRoom[r.id] ?? [];
                    const inactive = Number(r.active) === 0;

                    return (
                      <tr key={r.id} className={inactive ? 'muted' : undefined}>
                        <td>
                          <div className="strong">
                            {r.code}
                            {inactive && <span className="pill grey"> Closed</span>}
                          </div>
                          <div className="small muted">{r.name}</div>
                          {r.notes && <div className="small faint">{r.notes}</div>}
                        </td>
                        <td className="muted">{KIND_LABEL[r.kind] ?? r.kind}</td>
                        <td className="num strong">{r.in_stock}</td>
                        <td className="num muted"><Money value={r.stock_value} /></td>
                        <td>
                          {roomTags.length === 0 ? (
                            <span className="faint small">None</span>
                          ) : (
                            <div className="chips">
                              {roomTags.map((t) => (
                                <span className="chip" key={t.id}>
                                  <span className="mono small">{t.epc.slice(-8)}</span>
                                  {isAdmin && (
                                    <button
                                      title="Remove this door tag"
                                      onClick={async () => {
                                        await act.run(() => api.deleteRoomTag(t.id));
                                        tags.reload();
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="tight nowrap">
                            <button className="link sm" onClick={() => setTagging(r)}>Add door tag</button>
                            <button className="link sm" onClick={() => setEditing(r)}>Edit</button>
                            <button
                              className={inactive ? 'link sm' : 'link bad sm'}
                              onClick={async () => {
                                await act.run(() => api.setRoomActive(r.id, inactive ? 1 : 0));
                                rooms.reload();
                              }}
                            >
                              {inactive ? 'Reopen' : 'Close'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        {pages.pager}
      </Panel>

      <EditRoom
        room={editing}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); rooms.reload(); }}
      />

      <AddDoorTag
        room={tagging}
        onClose={() => setTagging(null)}
        onDone={() => { setTagging(null); tags.reload(); }}
      />
    </>
  );
}

function EditRoom({ room, onClose, onDone }) {
  const [form, setForm] = React.useState(null);
  const act = useAction();
  const isNew = room && !room.id;

  React.useEffect(() => {
    if (room) {
      setForm({
        code: room.code ?? '',
        name: room.name ?? '',
        kind: room.kind ?? 'storage',
        capacity: room.capacity ?? '',
        notes: room.notes ?? '',
      });
    }
  }, [room]);

  if (!room || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const body = {
      code: form.code.trim(),
      name: form.name.trim() || `Room ${form.code.trim().toUpperCase()}`,
      kind: form.kind,
      capacity: form.capacity === '' ? null : Number(form.capacity),
      notes: form.notes.trim() || null,
    };
    const res = await act.run(() => (isNew ? api.createRoom(body) : api.updateRoom(room.id, body)));
    if (res) onDone();
  }

  return (
    <Modal
      open={!!room}
      title={isNew ? 'New room' : `Edit ${room.code}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy || !form.code.trim()}>
            {act.busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <div className="row">
        <Field label="Code" help="Short, and what people call it: A1, B2, C3.">
          <input value={form.code} onChange={set('code')} disabled={!isNew}
            placeholder="A1" autoFocus={isNew} />
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={set('name')} placeholder="Room A1" />
        </Field>
      </div>

      <Field label="Used for">
        <select value={form.kind} onChange={set('kind')}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>

      <Field label="Capacity" help="Optional. How many garments it holds comfortably.">
        <input type="number" min="0" value={form.capacity} onChange={set('capacity')} />
      </Field>

      <Field label="Note">
        <input value={form.notes} onChange={set('notes')} placeholder="Back of the building, up the stairs" />
      </Field>
    </Modal>
  );
}

function AddDoorTag({ room, onClose, onDone }) {
  const [epc, setEpc] = React.useState('');
  const [label, setLabel] = React.useState('');
  const act = useAction();

  React.useEffect(() => { if (room) { setEpc(''); setLabel(''); } }, [room]);
  if (!room) return null;

  async function save() {
    const res = await act.run(() => api.createRoomTag({
      roomId: room.id,
      epc: epc.trim(),
      label: label.trim() || null,
    }));
    if (res) onDone();
  }

  return (
    <Modal
      open={!!room}
      title={`Door tag for ${room.code}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy || !epc.trim()}>
            {act.busy ? 'Saving…' : 'Add the tag'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <p className="muted small">
        Stick a spare tag on the doorframe and scan it here. From then on, an operator who
        scans that doorframe has told the handheld which room they are in.
      </p>

      <Field label="Tag code">
        <input
          className="mono"
          value={epc}
          onChange={(e) => setEpc(e.target.value)}
          placeholder="Scan or type the tag…"
          autoFocus
          style={{ fontSize: 17, padding: 12 }}
        />
      </Field>

      <Field label="Label" help="Optional. Which door, if the room has several.">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main door" />
      </Field>
    </Modal>
  );
}
