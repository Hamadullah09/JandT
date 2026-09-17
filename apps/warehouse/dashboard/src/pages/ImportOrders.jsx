import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import { readOrderFile } from '../csv.js';
import { Empty, Field, Notice, Panel, money, useAction, useLoader } from '../components.jsx';

/**
 * Orders that arrive as a spreadsheet.
 *
 * The file has a customer, an address, a total and the name of a dress, and no
 * order number and no date — nothing outside this system issues either. This
 * screen mints both, which is the difference between an order that can be
 * picked, shipped and returned against and a line in a spreadsheet.
 *
 * Nothing is written until the preview has been looked at. A file is read on
 * this machine, matched against the catalogue by the server, and shown row by
 * row with what will happen to each — because the failure worth preventing is
 * not a bad import, it is four hundred orders created against the wrong
 * garment and noticed a week later.
 */
export default function ImportOrders({ isAdmin }) {
  const [file, setFile] = React.useState(null);
  const [parsed, setParsed] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);

  const [placedAt, setPlacedAt] = React.useState('');
  const [createMissing, setCreateMissing] = React.useState(true);
  const [categoryId, setCategoryId] = React.useState('');
  const [stockType, setStockType] = React.useState('dropship');

  const categories = useLoader(() => api.categories(), []);
  const act = useAction();

  React.useEffect(() => {
    // The lookup endpoints all answer with `rows`, whatever the lookup is.
    const list = categories.data?.rows;
    if (list?.length && !categoryId) setCategoryId(String(list[0].id));
  }, [categories.data]);

  async function choose(chosen) {
    setFile(chosen);
    setParsed(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (!chosen) return;

    const read = readOrderFile(await chosen.text());
    if (read.error) { setError(read.error); return; }
    if (read.rows.length === 0) { setError('That file has a header but no orders under it.'); return; }

    setParsed(read);

    try {
      const p = await api.previewImport({ rows: read.rows.map(toRow) });
      setPreview(p);
    } catch (e) {
      setError(e.message);
    }
  }

  // What the server will find for each distinct dress name, by name.
  const byDress = React.useMemo(() => {
    const map = new Map();
    for (const d of preview?.dresses ?? []) map.set(d.dressName.toLowerCase(), d);
    return map;
  }, [preview]);

  function verdict(row) {
    if (!row.customerName) return { tone: 'bad', text: 'No customer name — will be skipped' };
    if (!row.dressName) return { tone: 'bad', text: 'No dress named — will be skipped' };

    const d = byDress.get(row.dressName.toLowerCase());
    if (!d) return { tone: 'muted', text: 'Checking…' };
    if (d.matched === 1) return { tone: 'ok', text: `Matched ${d.variants[0].sku}` };
    if (d.matched > 1) {
      return { tone: 'bad', text: `Matches ${d.matched} garments — will be skipped` };
    }
    return createMissing
      ? { tone: 'warn', text: 'New product will be created' }
      : { tone: 'bad', text: 'Not in the catalogue — will be skipped' };
  }

  const rows = parsed?.rows ?? [];
  const willImport = rows.filter((r) => ['ok', 'warn'].includes(verdict(r).tone)).length;
  const newDresses = [...byDress.values()].filter((d) => d.matched === 0).length;

  async function run() {
    setError(null);
    const body = {
      rows: rows.map(toRow),
      placedAt: placedAt ? `${placedAt}T12:00:00` : null,
      createMissing,
      categoryId: createMissing ? Number(categoryId) : null,
      stockType,
    };
    const res = await act.run(() => api.importOrders(body));
    if (res) setResult(res);
  }

  if (!isAdmin) {
    return (
      <Empty title="Only an administrator can import orders">
        Importing writes to the catalogue as well as to orders.
      </Empty>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Import orders</h1>
          <p>Take a sales spreadsheet and turn each row into an order with its own number.</p>
        </div>
        <button onClick={() => go('orders')}>All orders</button>
      </div>

      <Notice kind="error">{error ?? act.error}</Notice>

      {result ? (
        <Result result={result} onAgain={() => choose(null)} />
      ) : (
        <>
          <Panel
            title="The file"
            hint="A .csv with a row per order. Columns are matched by name, so the order they are in does not matter."
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />

            {parsed && (
              <>
                <p className="muted small" style={{ marginTop: 10 }}>
                  <b>{rows.length}</b> row{rows.length === 1 ? '' : 's'} in <b>{file?.name}</b>.
                  Reading: {Object.values(parsed.mapped).join(', ')}.
                </p>
                {parsed.ignored.length > 0 && (
                  <Notice kind="warn">
                    <span>
                      These columns are not used: {parsed.ignored.join(', ')}. Nothing in them
                      will be imported.
                    </span>
                  </Notice>
                )}
                {!parsed.mapped.city && rows.some((r) => r.cityGuessed) && (
                  <Notice kind="info">
                    <span>
                      There is no city column, so the city is guessed from the address and shown
                      below. The full address is stored exactly as written either way.
                    </span>
                  </Notice>
                )}
              </>
            )}
          </Panel>

          {parsed && (
            <Panel title="What to do about dresses the catalogue does not know">
              <Field label="A dress name the catalogue has never heard of">
                <div className="tabs inline">
                  <button className={createMissing ? 'on' : ''} onClick={() => setCreateMissing(true)}>
                    Create the product
                  </button>
                  <button className={createMissing ? '' : 'on'} onClick={() => setCreateMissing(false)}>
                    Skip the row
                  </button>
                </div>
              </Field>

              {createMissing && (
                <div className="row" style={{ marginTop: 10 }}>
                  <Field label="Put them in">
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                      {(categories.data?.rows ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Kind"
                    help="Dropship is the honest default for a sales file: the garment has no tag and never entered a room."
                  >
                    <select value={stockType} onChange={(e) => setStockType(e.target.value)}>
                      <option value="dropship">Dropship — supplier ships it</option>
                      <option value="stock">Stock — we hold and tag it</option>
                    </select>
                  </Field>
                </div>
              )}

              <Field
                label="Date for these orders"
                help="The file has none. Left empty, every order is placed now."
              >
                <input type="date" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} />
              </Field>
            </Panel>
          )}

          {parsed && (
            <Panel
              title="What will happen"
              hint={`${willImport} of ${rows.length} will be imported${newDresses ? `, and ${newDresses} new product${newDresses === 1 ? '' : 's'} created` : ''}.`}
              actions={
                <button
                  className="primary"
                  disabled={act.busy || willImport === 0 || !preview}
                  onClick={run}
                >
                  {act.busy ? 'Importing…' : `Import ${willImport} order${willImport === 1 ? '' : 's'}`}
                </button>
              }
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Customer</th>
                      <th>Where</th>
                      <th>Dress</th>
                      <th className="num">Total</th>
                      <th>Payment</th>
                      <th>What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const v = verdict(r);
                      return (
                        <tr key={r.line}>
                          <td className="muted small">{r.line}</td>
                          <td>
                            <span className="strong">{r.customerName || '—'}</span>
                            {r.phone && <div className="muted small">{r.phone}</div>}
                          </td>
                          <td>
                            {r.city || '—'}
                            {r.cityGuessed && <span className="muted small"> (guessed)</span>}
                            {r.postalCode && <div className="muted small">{r.postalCode}</div>}
                          </td>
                          <td>{r.dressName || '—'}</td>
                          <td className="num">{r.total === null ? '—' : money(r.total)}</td>
                          <td>
                            <span className={`pill ${/paid|prepaid/i.test(r.paymentType) ? 'ok' : 'warn'}`}>
                              {/paid|prepaid/i.test(r.paymentType) ? 'Paid' : 'COD'}
                            </span>
                          </td>
                          <td>
                            <span className={`pill ${PILL[v.tone]}`}>{v.text}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}

const PILL = { ok: 'ok', warn: 'warn', bad: 'bad', muted: 'grey' };

/** The shape the server wants. `line` and `cityGuessed` are ours, not its. */
const toRow = (r) => ({
  customerName: r.customerName,
  phone: r.phone,
  address: r.address,
  city: r.city,
  postalCode: r.postalCode,
  total: r.total,
  paymentType: r.paymentType,
  dressName: r.dressName,
});

function Result({ result, onAgain }) {
  return (
    <>
      <Notice kind={result.skippedCount > 0 ? 'warn' : 'ok'}>
        <span>
          <b>{result.imported}</b> order{result.imported === 1 ? '' : 's'} imported
          {result.productsCreatedCount > 0 && <>, and <b>{result.productsCreatedCount}</b> new
            product{result.productsCreatedCount === 1 ? '' : 's'} created</>}
          {result.skippedCount > 0 && <>. <b>{result.skippedCount}</b> row
            {result.skippedCount === 1 ? '' : 's'} could not be imported and
            {result.skippedCount === 1 ? ' is' : ' are'} listed below</>}.
        </span>
      </Notice>

      {result.skipped.length > 0 && (
        <Panel
          title="Not imported"
          hint="Everything else went in. Put just these rows in a file of their own and import that — importing the whole file again would order everything on it a second time."
        >
          <div className="table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Customer</th><th>Why</th></tr></thead>
              <tbody>
                {result.skipped.map((s) => (
                  <tr key={s.line}>
                    <td className="muted small">{s.line}</td>
                    <td>{s.name || '—'}</td>
                    <td><span className="pill bad">{s.reason}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="Imported"
        actions={<button onClick={onAgain}>Import another file</button>}
      >
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Garment</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {result.orders.map((o) => (
                <tr key={o.id}>
                  <td><span className="mono">{o.orderNo}</span></td>
                  <td>{o.name}</td>
                  <td className="muted small">{o.sku}</td>
                  <td className="num">{money(o.total)}</td>
                  <td className="num">
                    <button className="link" onClick={() => go('orders', o.id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
