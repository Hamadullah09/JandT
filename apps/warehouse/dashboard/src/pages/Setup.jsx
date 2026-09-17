import React from 'react';
import { api } from '../api.js';
import {
  Empty, Field, Loaded, Modal, Notice, Panel, Swatch, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Categories, colours and sizes.
 *
 * The three lists every product is described in terms of. They are the same
 * shape as each other, so they are one component used three times rather than
 * three screens that will drift apart.
 *
 * Nothing here is ever deleted — a colour that has been discontinued still has
 * to be nameable on last year's orders — so the only action is switching it off.
 */
export default function Setup({ isAdmin }) {
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Categories &amp; sizes</h1>
          <p>The words your products are described in.</p>
        </div>
      </div>

      {!isAdmin && (
        <Notice kind="info">Only an admin can change these.</Notice>
      )}

      <div className="grid three">
        <Lookup
          kind="categories"
          title="Categories"
          hint="Shalwar kameez, kurta, shirt"
          isAdmin={isAdmin}
        />
        <Lookup
          kind="colors"
          title="Colours"
          hint="With a swatch, so pickers show the colour"
          isAdmin={isAdmin}
          hasHex
        />
        <Lookup
          kind="sizes"
          title="Sizes"
          hint="Ordered the way they are worn, not alphabetically"
          isAdmin={isAdmin}
          hasOrder
        />
      </div>
    </>
  );
}

function Lookup({ kind, title, hint, isAdmin, hasHex, hasOrder }) {
  const load = { categories: api.categories, colors: api.colors, sizes: api.sizes }[kind];
  const state = useLoader(() => load(true), []);
  const pages = usePages(state.data?.rows);
  const [editing, setEditing] = React.useState(null);
  const act = useAction();

  return (
    <>
      <Panel
        title={title}
        hint={hint}
        actions={isAdmin && (
          <button className="sm" onClick={() => setEditing({})}>Add</button>
        )}
        tight
      >
        <Notice kind="error">{act.error}</Notice>

        <Loaded
          state={state}
          empty={(d) => d.rows.length === 0 && <Empty title={`No ${title.toLowerCase()} yet`} />}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <tbody>
                  {pages.rows.map((row) => {
                    const off = Number(row.active) === 0;
                    return (
                      <tr key={row.id} className={off ? 'muted' : undefined}>
                        <td>
                          <div className="strong">
                            {hasHex ? <Swatch hex={row.hex} name={row.name} /> : row.name}
                            {off && <span className="pill grey"> Off</span>}
                          </div>
                          <div className="small mono faint">
                            {row.code}
                            {hasOrder && <> · sorts at {row.sort_order}</>}
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="tight nowrap">
                            <button className="link sm" onClick={() => setEditing(row)}>Edit</button>
                            <button
                              className={off ? 'link sm' : 'link bad sm'}
                              onClick={async () => {
                                await act.run(() => api.setLookupActive(kind, row.id, off ? 1 : 0));
                                state.reload();
                              }}
                            >
                              {off ? 'On' : 'Off'}
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

      <EditLookup
        kind={kind}
        row={editing}
        title={title}
        hasHex={hasHex}
        hasOrder={hasOrder}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); state.reload(); }}
      />
    </>
  );
}

function EditLookup({ kind, row, title, hasHex, hasOrder, onClose, onDone }) {
  const [form, setForm] = React.useState(null);
  const act = useAction();
  const isNew = row && !row.id;

  React.useEffect(() => {
    if (row) {
      setForm({
        code: row.code ?? '',
        name: row.name ?? '',
        hex: row.hex ?? '#888888',
        sortOrder: row.sort_order ?? '',
      });
    }
  }, [row]);

  if (!row || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const body = {
      code: form.code.trim(),
      name: form.name.trim() || form.code.trim(),
      hex: hasHex ? form.hex : null,
      sortOrder: hasOrder ? Number(form.sortOrder || 0) : null,
    };
    const res = await act.run(() => (isNew
      ? api.createLookup(kind, body)
      : api.updateLookup(kind, row.id, body)));
    if (res) onDone();
  }

  return (
    <Modal
      open={!!row}
      title={isNew ? `New ${title.toLowerCase().replace(/s$/, '')}` : `Edit ${row.name}`}
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
        <Field label="Code" help="Short, and used in product codes.">
          <input value={form.code} onChange={set('code')} disabled={!isNew}
            placeholder={kind === 'sizes' ? 'XL' : 'NAVY'} autoFocus={isNew} />
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={set('name')}
            placeholder={kind === 'sizes' ? 'Extra large' : 'Navy'} />
        </Field>
      </div>

      {hasHex && (
        <Field label="Swatch" help="Shown wherever this colour is picked or listed.">
          <div className="row gap-sm">
            <input
              type="color"
              value={form.hex}
              onChange={set('hex')}
              style={{ width: 58, height: 40, padding: 3 }}
            />
            <input className="mono" value={form.hex} onChange={set('hex')} style={{ flex: 1 }} />
          </div>
        </Field>
      )}

      {hasOrder && (
        <Field
          label="Sorts at"
          help="Lower comes first. Leave gaps — 10, 20, 30 — so a size can be slotted between two later."
        >
          <input type="number" value={form.sortOrder} onChange={set('sortOrder')} placeholder="30" />
        </Field>
      )}
    </Modal>
  );
}
