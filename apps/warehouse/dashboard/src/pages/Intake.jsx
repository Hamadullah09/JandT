import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, GarmentName, Loaded, Modal, Notice, Panel, Status, Swatch, VariantPicker, When,
  money, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Booking stock in.
 *
 * You say what arrived — 50 shalwar kameez, in these colours and sizes — and
 * that becomes an intake with a line per colour and size. The tags then go on
 * one at a time, here or on the handheld, and each line counts down.
 */
export default function Intake({ book, isAdmin }) {
  const [status, setStatus] = React.useState('open');
  const [creating, setCreating] = React.useState(false);
  // The colour and size "Book more in" sent, put on the form as it opens.
  const [preset, setPreset] = React.useState(null);
  const [presetError, setPresetError] = React.useState(null);
  const list = useLoader(() => api.batches(status), [status]);
  const pages = usePages(list.data?.batches, status);

  // "Book more in" on Notifications arrives as #/intake?book=<id>. The address
  // goes straight back to plain #/intake, so a reload does not open the form a
  // second time.
  React.useEffect(() => {
    if (!book) return undefined;
    let alive = true;
    window.history.replaceState(null, '', '#/intake');
    setPresetError(null);
    api.variants({ id: book })
      .then((d) => {
        if (!alive) return;
        const variant = d.variants?.[0];
        if (!variant) {
          setPresetError('That garment is no longer sold, so it cannot be booked in from here.');
          return;
        }
        setPreset(variant);
        setCreating(true);
      })
      .catch((err) => { if (alive) setPresetError(err.message); });
    return () => { alive = false; };
  }, [book]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Book in stock</h1>
          <p>Say what arrived, then put a tag on each garment.</p>
        </div>
        <button className="primary" onClick={() => { setPreset(null); setCreating(true); }}>New intake</button>
      </div>

      <Notice kind="error">{presetError}</Notice>

      <Panel>
        <div className="tabs">
          {[['open', 'Still being tagged'], ['complete', 'Finished'], ['', 'Everything']].map(
            ([value, label]) => (
              <button
                key={value}
                className={status === value ? 'on' : ''}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
        </div>
      </Panel>

      <Panel tight>
        <Loaded
          state={list}
          empty={(d) => d.batches.length === 0 && (
            <Empty title={status === 'open' ? 'Nothing being tagged' : 'No intakes yet'}>
              When a delivery arrives, start an intake and scan a tag onto each garment.
            </Empty>
          )}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Intake</th>
                    <th>Supplier</th>
                    <th>Into</th>
                    <th>Started</th>
                    <th className="num">Tagged</th>
                    <th>Progress</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((b) => {
                    const expected = Number(b.expected);
                    const assigned = Number(b.assigned);
                    const pct = expected > 0 ? Math.min(100, (assigned / expected) * 100) : 0;
                    const done = expected > 0 && assigned >= expected;

                    return (
                      <tr key={b.id} className="pick" onClick={() => go('intake', b.id)}>
                        <td>
                          <div className="strong mono">{b.batch_no}</div>
                          {b.notes && <div className="small faint">{b.notes}</div>}
                        </td>
                        <td className="muted">{b.supplier || '—'}</td>
                        <td>{b.room_code ? <span className="pill grey">{b.room_code}</span> : '—'}</td>
                        <td className="muted small"><When value={b.created_at} /></td>
                        <td className="num strong">{assigned} / {expected}</td>
                        <td style={{ width: '20%', minWidth: 110 }}>
                          <div className={`progress${done ? ' done' : ''}`}>
                            <div style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td><Status value={b.status} /></td>
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

      <NewIntake
        open={creating}
        preset={preset}
        isAdmin={isAdmin}
        onClose={() => { setCreating(false); setPreset(null); }}
        onCreated={(id) => { setCreating(false); setPreset(null); go('intake', id); }}
      />
    </>
  );
}

function NewIntake({ open, preset, isAdmin, onClose, onCreated }) {
  const rooms = useLoader(() => api.rooms(), []);
  const [supplier, setSupplier] = React.useState('');
  const [roomId, setRoomId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState([]);
  const [picking, setPicking] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const act = useAction();

  const roomList = (rooms.data?.rooms ?? []).filter((r) => Number(r.active) === 1);

  React.useEffect(() => {
    if (open && !roomId && roomList.length) {
      // Goods in, if there is one: a delivery lands there before it is put away.
      const goodsIn = roomList.find((r) => r.kind === 'receiving') ?? roomList[0];
      setRoomId(String(goodsIn.id));
    }
  }, [open, roomList, roomId]);

  // Lines are told apart by a key rather than by the variant: a new garment has
  // no variant until the intake is saved.
  const lineFor = (variant) => ({
    key: `v${variant.id}`,
    variantId: variant.id,
    label: variant,
    quantity: '',
    unitCost: String(Number(variant.cost_price ?? 0)),
  });

  function addLine(variant) {
    setPicking(false);
    const line = lineFor(variant);
    setLines((ls) => (ls.some((l) => l.key === line.key) ? ls : [...ls, line]));
  }

  // "Book more in" opens the form with just that garment on it, ready for a quantity.
  React.useEffect(() => {
    if (open && preset) setLines([lineFor(preset)]);
  }, [open, preset]);

  function addNew(newLines) {
    setAdding(false);
    setLines((ls) => [...ls, ...newLines.filter((n) => !ls.some((l) => l.key === n.key))]);
  }

  const setLine = (i, k, v) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  const total = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  const value = lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const ready = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  async function save() {
    const res = await act.run(() => api.createBatch({
      supplier: supplier.trim() || null,
      roomId: roomId ? Number(roomId) : null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        variantId: l.variantId ?? 0,
        quantity: Number(l.quantity),
        unitCost: l.unitCost === '' ? null : Number(l.unitCost),
        newGarment: l.newGarment ?? null,
      })),
    }));
    if (res) {
      setSupplier(''); setNotes(''); setLines([]);
      onCreated(res.id);
    }
  }

  return (
    <>
      <Modal
        open={open && !picking && !adding}
        title="What arrived?"
        onClose={onClose}
        footer={
          <>
            <button onClick={onClose} disabled={act.busy}>Cancel</button>
            <button className="primary" onClick={save} disabled={act.busy || !ready}>
              {act.busy ? 'Creating…' : `Start tagging ${total} garment${total === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        <Notice kind="error">{act.error}</Notice>

        <div className="row">
          <Field label="Supplier" help="Optional.">
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
              placeholder="Faisalabad Mills" />
          </Field>
          <Field label="Goes into" help="Each tag lands here unless you say otherwise.">
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Decide later</option>
              {roomList.map((r) => (
                <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="What is in the delivery">
          {lines.length === 0 ? (
            <div className="notice info" style={{ margin: 0 }}>
              Nothing added yet. Add a colour and size{isAdmin ? ', or a garment that is new to the catalogue,' : ''} then
              say how many arrived.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Garment</th>
                    <th className="num" style={{ width: 110 }}>How many</th>
                    <th className="num" style={{ width: 120 }}>Cost each</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td>
                        <GarmentName row={l.label} />
                        {l.newGarment && (
                          <span className="pill info">{l.addsTo ? `Adds to ${l.addsTo}` : 'New to the catalogue'}</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number" min="1" value={l.quantity}
                          onChange={(e) => setLine(i, 'quantity', e.target.value)}
                          placeholder="50"
                        />
                      </td>
                      <td>
                        <input
                          type="number" min="0" step="0.01" value={l.unitCost}
                          onChange={(e) => setLine(i, 'unitCost', e.target.value)}
                        />
                      </td>
                      <td className="tight">
                        <button className="link bad sm"
                          onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row gap-sm" style={{ marginTop: 10 }}>
            <button onClick={() => setPicking(true)}>+ Add a colour and size</button>
            {isAdmin && <button onClick={() => setAdding(true)}>+ New garment</button>}
          </div>
        </Field>

        {lines.length > 0 && (
          <Notice kind="info">
            <span>
              <b>{total}</b> garment{total === 1 ? '' : 's'} to tag, worth <b>{money(value)}</b> at cost.
            </span>
          </Notice>
        )}

        <Field label="Note" help="Optional. Shown on the intake.">
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Autumn delivery, invoice 2291" />
        </Field>
      </Modal>

      <Modal open={picking} title="Which garment?" onClose={() => setPicking(false)}>
        <p className="muted small">
          Dropship products are not shown: they never arrive here, so they cannot be booked in.
        </p>
        <VariantPicker onPick={addLine} />
      </Modal>

      <NewGarment open={adding} onClose={() => setAdding(false)} onAdd={addNew} />
    </>
  );
}

/**
 * A garment that is not in the catalogue yet, added while booking it in.
 *
 * Type its name, choose - or type - its colours and sizes, and each colour and
 * size goes on the delivery as a line. Nothing is saved until the intake is:
 * the product, and any colour or size typed here, are created along with it.
 *
 * A name that is already in the catalogue is that product, so a suit that
 * arrives in a new size gains the size instead of becoming a second suit.
 */
function NewGarment({ open, onClose, onAdd }) {
  const categories = useLoader(() => api.categories(), []);
  const colors = useLoader(() => api.colors(), []);
  const sizes = useLoader(() => api.sizes(), []);
  // Read each time it opens, so a product added a moment ago is recognised.
  const products = useLoader(() => (open ? api.products({}) : Promise.resolve(null)), [open]);

  const blank = { name: '', categoryId: '', costPrice: '', salePrice: '' };
  const [form, setForm] = React.useState(blank);
  const [pickedColors, setPickedColors] = React.useState([]);
  const [pickedSizes, setPickedSizes] = React.useState([]);
  const [typedColors, setTypedColors] = React.useState([]);
  const [typedSizes, setTypedSizes] = React.useState([]);
  const [colorText, setColorText] = React.useState('');
  const [sizeText, setSizeText] = React.useState('');

  const categoryRows = categories.data?.rows ?? [];
  const colorRows = colors.data?.rows ?? [];
  const sizeRows = sizes.data?.rows ?? [];

  React.useEffect(() => {
    if (open && !form.categoryId && categoryRows.length) {
      setForm((f) => ({ ...f, categoryId: String(categoryRows[0].id) }));
    }
  }, [open, categoryRows.length]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // From the latest list, so two quick taps do not undo each other.
  const toggle = (setList, id) =>
    setList((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const name = form.name.trim();
  const existing = name
    ? (products.data?.products ?? []).find((p) =>
      Number(p.active) === 1 && p.name.trim().toLowerCase() === name.toLowerCase())
    : null;
  const dropship = existing?.stock_type === 'dropship';

  // A colour or size typed that is already on the list is simply chosen.
  function typed(text, rows, setPicked, setTyped, setText) {
    const value = text.trim();
    if (!value) return;
    const known = rows.find((r) =>
      r.name.toLowerCase() === value.toLowerCase() || r.code.toLowerCase() === value.toLowerCase());
    if (known) setPicked((list) => (list.includes(known.id) ? list : [...list, known.id]));
    else setTyped((list) => (list.some((x) => x.toLowerCase() === value.toLowerCase()) ? list : [...list, value]));
    setText('');
  }

  const colorChoices = [
    ...colorRows.filter((c) => pickedColors.includes(c.id)).map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    ...typedColors.map((t) => ({ id: null, name: t, hex: null })),
  ];
  const sizeChoices = [
    ...sizeRows.filter((s) => pickedSizes.includes(s.id)).map((s) => ({ id: s.id, name: s.name, code: s.code })),
    ...typedSizes.map((t) => ({ id: null, name: t, code: t.toUpperCase() })),
  ];
  const combinations = colorChoices.length * sizeChoices.length;
  const ready = !!name && (existing ? !dropship : !!form.categoryId) && combinations > 0;

  function reset() {
    setForm((f) => ({ ...blank, categoryId: f.categoryId }));
    setPickedColors([]);
    setPickedSizes([]);
    setTypedColors([]);
    setTypedSizes([]);
    setColorText('');
    setSizeText('');
  }

  function close() {
    reset();
    onClose();
  }

  function add() {
    const cost = existing ? String(Number(existing.cost_price ?? 0)) : form.costPrice;
    // A product already in the catalogue keeps its own spelling of its name.
    const garment = existing?.name ?? name;
    const lines = [];
    for (const c of colorChoices) {
      for (const s of sizeChoices) {
        lines.push({
          key: `new:${garment.toLowerCase()}|${c.id ?? `+${c.name.toLowerCase()}`}|${s.id ?? `+${s.name.toLowerCase()}`}`,
          variantId: null,
          newGarment: {
            name: garment,
            categoryId: existing ? null : Number(form.categoryId),
            costPrice: existing || form.costPrice === '' ? null : Number(form.costPrice),
            salePrice: existing || form.salePrice === '' ? null : Number(form.salePrice),
            colorId: c.id,
            colorName: c.id ? null : c.name,
            sizeId: s.id,
            sizeName: s.id ? null : s.name,
          },
          addsTo: existing?.sku ?? null,
          label: { product_name: garment, color_name: c.name, color_hex: c.hex, size_code: s.code },
          quantity: '',
          unitCost: cost,
        });
      }
    }
    onAdd(lines);
    reset();
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <Modal
      open={open}
      title="A garment new to the catalogue"
      onClose={close}
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={add} disabled={!ready}>
            {combinations > 1 ? `Add ${combinations} colours and sizes` : 'Add to the delivery'}
          </button>
        </>
      }
    >
      <p className="muted small">
        Saved with the intake: the garment, and any colour or size typed here, join the catalogue when
        you press Start tagging. Photos can be added on its product page afterwards.
      </p>

      <Field label="Name" help="What the customer sees on the order.">
        <input id="ng-name" value={form.name} onChange={set('name')}
          placeholder="Silk Embroidered 3 Piece Suit" autoFocus />
      </Field>

      {existing ? (
        dropship ? (
          <Notice kind="error">
            <span>
              <b>{existing.name}</b> is a dropship product. It never comes into the warehouse, so it cannot
              be booked in.
            </span>
          </Notice>
        ) : (
          <Notice kind="info">
            <span>
              Already in the catalogue as <span className="mono strong">{existing.sku}</span>
              {existing.category_name && <> ({existing.category_name})</>}. The colours and sizes you choose
              are added to it.
            </span>
          </Notice>
        )
      ) : (
        <>
          <Field label="Category">
            <select id="ng-category" value={form.categoryId} onChange={set('categoryId')}>
              {categoryRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="row">
            <Field label="Cost each" help="What you pay for one.">
              <input id="ng-cost" type="number" min="0" step="0.01" value={form.costPrice}
                onChange={set('costPrice')} placeholder="45.00" />
            </Field>
            <Field label="Sells for" help="What the customer pays.">
              <input id="ng-sale" type="number" min="0" step="0.01" value={form.salePrice}
                onChange={set('salePrice')} placeholder="99.00" />
            </Field>
          </div>
        </>
      )}

      <Field label="Colours" help="Choose one or more. A colour that is not listed: type it and press Add.">
        <div className="toggles">
          {colorRows.map((c) => (
            <button key={c.id} type="button" className={pickedColors.includes(c.id) ? 'on' : ''}
              onClick={() => toggle(setPickedColors, c.id)}>
              <Swatch hex={c.hex} name={c.name} />
            </button>
          ))}
          {typedColors.map((t) => (
            <button key={`+${t}`} type="button" className="on" title="New colour - click to take it off"
              onClick={() => setTypedColors((list) => list.filter((x) => x !== t))}>
              {t} <span className="small">· new</span>
            </button>
          ))}
        </div>
        <div className="row gap-sm" style={{ marginTop: 8 }}>
          <input id="ng-color-text" value={colorText} style={{ flex: 1 }}
            onChange={(e) => setColorText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              typed(colorText, colorRows, setPickedColors, setTypedColors, setColorText);
            }}
            placeholder="Another colour, e.g. Mustard" />
          <button type="button" disabled={!colorText.trim()}
            onClick={() => typed(colorText, colorRows, setPickedColors, setTypedColors, setColorText)}>
            Add
          </button>
        </div>
      </Field>

      <Field label="Sizes" help="Choose one or more. A size that is not listed: type it and press Add.">
        <div className="toggles">
          {sizeRows.map((s) => (
            <button key={s.id} type="button" className={pickedSizes.includes(s.id) ? 'on' : ''}
              onClick={() => toggle(setPickedSizes, s.id)}>
              {s.code}
            </button>
          ))}
          {typedSizes.map((t) => (
            <button key={`+${t}`} type="button" className="on" title="New size - click to take it off"
              onClick={() => setTypedSizes((list) => list.filter((x) => x !== t))}>
              {t} <span className="small">· new</span>
            </button>
          ))}
        </div>
        <div className="row gap-sm" style={{ marginTop: 8 }}>
          <input id="ng-size-text" value={sizeText} style={{ flex: 1 }}
            onChange={(e) => setSizeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              typed(sizeText, sizeRows, setPickedSizes, setTypedSizes, setSizeText);
            }}
            placeholder="Another size, e.g. 2XL" />
          <button type="button" disabled={!sizeText.trim()}
            onClick={() => typed(sizeText, sizeRows, setPickedSizes, setTypedSizes, setSizeText)}>
            Add
          </button>
        </div>
      </Field>

      {combinations > 0 && (
        <p className="small muted">
          {plural(colorChoices.length, 'colour')} × {plural(sizeChoices.length, 'size')} ={' '}
          <b>{plural(combinations, 'line')}</b> on the delivery. Say how many of each arrived there.
        </p>
      )}
    </Modal>
  );
}
