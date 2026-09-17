import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Loaded, Money, Notice, Panel, StatValue, Status, Swatch, When, money, useLoader, usePages,
} from '../components.jsx';

/**
 * One return, read back.
 *
 * Returns are taken on the C72 in the returns room, so nothing here changes
 * one: no scanning, no regrading, no closing. What this page is for is the
 * question the office gets asked afterwards - what came back from this
 * customer, what state was it in, and what were they refunded.
 */
export default function ReturnDetail({ id }) {
  const state = useLoader(() => api.return(id), [id]);
  const r = state.data?.ret;
  const lines = state.data?.lines ?? [];
  const matchedPages = usePages(lines.filter((l) => l.verdict === 'matched'), id);
  const otherPages = usePages(lines.filter((l) => l.verdict !== 'matched'), id);
  const shippedPages = usePages(state.data?.shipped, id);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <button className="link" onClick={() => go('returns')}>← All returns</button>
          <h1>{r?.return_no ?? 'Return'}</h1>
          <p>
            {r && (
              <>
                against{' '}
                <button className="link" onClick={() => go('orders', r.order_id)}>{r.order_no}</button>
                {r.tracking_id != null && <> · tracking <span className="mono strong">{r.tracking_id}</span></>}
                {' · '}{r.customer_name}
                {r.customer_phone && <> · {r.customer_phone}</>}
              </>
            )}
          </p>
        </div>
        {r && <Status value={r.status} />}
      </div>

      <Loaded state={state}>
        {(d) => {
          const matched = d.lines.filter((l) => l.verdict === 'matched');
          const other = d.lines.filter((l) => l.verdict !== 'matched');
          const count = (grade) => matched.filter((l) => gradeOf(l) === grade).length;
          const stillOut = d.shipped.filter((s) => s.status !== 'returned');

          return (
            <>
              {d.ret.status === 'closed' ? (
                <Notice kind="ok">
                  <span>
                    <b>{matched.length}</b> garment{matched.length === 1 ? '' : 's'} came back
                    {d.ret.received_at && <> on <When value={d.ret.received_at} /></>}
                    {d.ret.received_by_name && <>, taken by {d.ret.received_by_name}</>},
                    and <b>{money(d.ret.refund_amount)}</b> was refunded.
                  </span>
                </Notice>
              ) : (
                <Notice kind="warn">
                  <span>
                    This return is <b>{d.ret.status}</b>. Returns are finished on the C72 in the returns room.
                  </span>
                </Notice>
              )}

              <div className="stats">
                <div className="stat ok">
                  <div className="label">1 · Good</div>
                  <div className="value">{count(1)}</div>
                  <div className="note">back in stock</div>
                </div>
                <div className={`stat${count(2) ? ' warn' : ''}`}>
                  <div className="label">2 · Defective</div>
                  <div className="value">{count(2)}</div>
                  <div className="note">kept, marked damaged</div>
                </div>
                <div className={`stat${count(3) ? ' bad' : ''}`}>
                  <div className="label">3 · Discard</div>
                  <div className="value">{count(3)}</div>
                  <div className="note">written off</div>
                </div>
                <div className="stat accent">
                  <div className="label">Refunded</div>
                  <StatValue>{money(d.ret.refund_amount)}</StatValue>
                  <div className="note">order was {money(d.ret.order_total)}</div>
                </div>
              </div>

              <Panel title="What came back" hint={`${matched.length} garment${matched.length === 1 ? '' : 's'}`} tight>
                {matched.length === 0 ? (
                  <Empty title="Nothing came back on this return" />
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tag</th>
                          <th>Garment</th>
                          <th>Reusability</th>
                          <th>Room</th>
                          <th className="num">Refund</th>
                          <th>Scanned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchedPages.rows.map((l) => {
                          const g = GRADES.find((x) => x.value === gradeOf(l)) ?? GRADES[0];
                          return (
                            <tr key={l.id}>
                              <td className="mono">{l.epc}</td>
                              <td>
                                <span className="strong">{l.product_name}</span>{' '}
                                <span className="muted small">
                                  <Swatch hex={l.color_hex} name={l.color_name} /> {l.size_code}
                                </span>
                              </td>
                              <td><span className={`pill ${g.pill}`} title={g.hint}>{g.value} · {g.label}</span></td>
                              <td className="mono small">{l.restock_room_code ?? <span className="faint">—</span>}</td>
                              <td className="num"><Money value={l.refund_amount} /></td>
                              <td className="muted small"><When value={l.received_at} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {matchedPages.pager}
              </Panel>

              {/* Only older returns, taken at the desk before the returns room,
                  can have scans that did not match - kept on the record because
                  a wrong garment is evidence. */}
              {other.length > 0 && (
                <Panel title="Scans that did not match this order" tight>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Tag</th><th>Verdict</th><th>Garment</th><th>Scanned</th></tr>
                      </thead>
                      <tbody>
                        {otherPages.rows.map((l) => (
                          <tr key={l.id}>
                            <td className="mono">{l.epc}</td>
                            <td>
                              <Status value={l.verdict} />
                              {l.verdict === 'wrong_order' && l.belongs_to_order && (
                                <div className="small faint">on {l.belongs_to_order}</div>
                              )}
                            </td>
                            <td>{l.product_name ?? <span className="faint">Unknown tag</span>}</td>
                            <td className="muted small"><When value={l.received_at} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {otherPages.pager}
                </Panel>
              )}

              <Panel
                title="What went out on this order"
                hint={stillOut.length > 0 ? `${stillOut.length} still with the customer` : 'all back'}
                tight
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tag</th>
                        <th>Garment</th>
                        <th className="num">Charged</th>
                        <th>Where it is</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shippedPages.rows.map((s) => (
                        <tr key={s.id}>
                          <td className="mono">{s.epc}</td>
                          <td>
                            <span className="strong">{s.product_name}</span>{' '}
                            <span className="muted small">{s.color_name} {s.size_code}</span>
                          </td>
                          <td className="num"><Money value={s.unit_price} /></td>
                          <td>
                            {Number(s.returned_here) === 1
                              ? <span className="pill ok">Came back on this return</span>
                              : s.status === 'returned'
                                ? <span className="pill grey">Returned on another</span>
                                : <span className="pill warn">Still with the customer</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shippedPages.pager}
              </Panel>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

/**
 * How much use is left in a returned garment, as the C72 grades it.
 *
 * Three grades rather than two, because "damaged" was answering two different
 * questions at once: whether the garment can be sold again, and whether it is
 * worth keeping at all.
 */
export const GRADES = [
  { value: 1, label: 'Good', hint: 'No defects. Went straight back into stock.', pill: 'ok' },
  { value: 2, label: 'Defective', hint: 'Defective but still usable. Kept, and marked damaged.', pill: 'warn' },
  { value: 3, label: 'Discard', hint: 'Defective beyond use. Written off.', pill: 'bad' },
];

/** The grade of a line, for older rows written before grading existed. */
export function gradeOf(line) {
  return Number(line.reusability) || (line.item_condition === 'damaged' ? 2 : 1);
}
