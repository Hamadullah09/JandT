import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, GarmentName, Loaded, Money, Panel, Stat, Status, Swatch, When, money, useLoader, usePages,
} from '../components.jsx';

/**
 * The first screen of the morning.
 *
 * Ordered by what somebody has to do something about: the work waiting comes
 * first, then what is on the shelves, then what has been happening. A number
 * that nobody would act on does not belong on this page.
 */

/**
 * How many low-stock rows the overview will show.
 *
 * Set a reorder level on forty colour-and-size combinations and forty of them
 * can be low at once, which pushes everything else off the screen and turns a
 * summary into a report. The count is still stated, and the full list is a
 * click away.
 */
const LOW_STOCK_SHOWN = 6;
export default function Overview() {
  const state = useLoader(() => api.overview(), []);
  const rooms = usePages(state.data?.byRoom);
  const recent = usePages(state.data?.recent);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Overview</h1>
          <p>What is waiting, what is in stock, what it is worth, and where the parcels are.</p>
        </div>
        <button onClick={state.reload} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <Loaded state={state}>
        {(d) => (
          <>
            <div className="stats">
              <Stat
                label="Orders to pick"
                value={Number(d.orders.pending ?? 0)}
                note="waiting for garments to be scanned"
                tone={Number(d.orders.pending) > 0 ? 'warn' : undefined}
                onClick={() => go('orders')}
              />

              <Stat
                label="Returns open"
                value={Number(d.counts.open_returns ?? 0)}
                note="at the returns desk"
                tone={Number(d.counts.open_returns) > 0 ? 'warn' : undefined}
                onClick={() => go('returns')}
              />
              <Stat
                label="Being looked for"
                value={Number(d.counts.open_finds ?? 0)}
                note="on every handheld"
                tone={Number(d.counts.open_finds) > 0 ? 'bad' : undefined}
                onClick={() => go('find')}
              />
              <Stat
                label="Intakes open"
                value={Number(d.counts.open_batches ?? 0)}
                note="still being tagged"
                onClick={() => go('intake')}
              />
            </div>

            <div className="stats">
              <Stat
                label="In stock"
                value={Number(d.stock.in_stock ?? 0).toLocaleString()}
                note="garments on the shelves"
                tone="accent"
                onClick={() => go('stock')}
              />
              <Stat
                label="Stock value"
                value={money(d.stock.stock_value)}
                note="at what it cost us"
                tone="accent"
              />
              <Stat
                label="Picked for orders"
                value={Number(d.stock.allocated ?? 0).toLocaleString()}
                note="in the building, already sold"
              />
              <Stat
                label="Revenue billed"
                value={money(d.orders.revenue)}
                note={`less ${money(d.orders.refunded)} refunded`}
                tone="ok"
              />
              <Stat
                label="Damaged or lost"
                value={Number(d.stock.damaged ?? 0) + Number(d.stock.lost ?? 0)}
                note="not sellable"
                tone={Number(d.stock.damaged) + Number(d.stock.lost) > 0 ? 'bad' : undefined}
              />
            </div>

            {d.shipping && (
              <div className="stats">
                <Stat
                  label="Shipped, not booked"
                  value={Number(d.shipping.to_book ?? 0)}
                  note="orders gone out with no J&T parcel"
                  tone={Number(d.shipping.to_book) > 0 ? 'warn' : undefined}
                  onClick={() => go('shipments')}
                />
                <Stat
                  label="With J&T"
                  value={Number(d.shipping.awaiting_pickup ?? 0) + Number(d.shipping.in_transit ?? 0)}
                  note={`${Number(d.shipping.awaiting_pickup ?? 0)} awaiting pickup`}
                  tone="accent"
                  onClick={() => go('shipments')}
                />
                <Stat
                  label="Delivered by J&T"
                  value={Number(d.shipping.delivered ?? 0)}
                  note={`${Number(d.shipping.returned ?? 0)} returned to the shop`}
                  tone="ok"
                  onClick={() => go('shipments')}
                />
                <Stat
                  label="COD to collect"
                  value={money(d.shipping.cod_outstanding)}
                  note="on parcels not yet delivered"
                  tone={Number(d.shipping.cod_outstanding) > 0 ? 'warn' : undefined}
                />
              </div>
            )}

            {d.lowStock.length > 0 && (
              <Panel
                title="Running low"
                hint="fewer than 10 on the shelves, or fewer than the level set on the product"
                tight
                actions={d.lowStockCount > LOW_STOCK_SHOWN && (
                  <span className="hint">
                    showing the {LOW_STOCK_SHOWN} lowest of {d.lowStockCount}
                  </span>
                )}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Garment</th>
                        <th className="num">In stock</th>
                        <th className="num">Alert below</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.lowStock.slice(0, LOW_STOCK_SHOWN).map((v) => (
                        <tr key={v.id}>
                          <td><GarmentName row={v} /></td>
                          <td className="num">
                            {/* Red, not amber. Everything in this table is
                                already at or below its reorder level, so amber
                                said "keep an eye on it" about a line that is
                                one wholesale order away from being unsellable.
                                Nothing gets here that is not worth acting on. */}
                            <span className="pill bad">
                              {Number(v.in_stock) === 0 ? 'None left' : v.in_stock}
                            </span>
                          </td>
                          <td className="num muted">{v.reorder_level}</td>
                          <td className="tight">
                            <button className="link" onClick={() => go('intake', null, { book: v.id })}>
                              Book more in
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.lowStockCount > LOW_STOCK_SHOWN && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
                    <button className="link" onClick={() => go('notifications')}>
                      See all {d.lowStockCount} in Notifications →
                    </button>
                  </div>
                )}
              </Panel>
            )}

            <div className="grid two">
              <Panel title="Where the stock is" tight>
                {d.byRoom.length === 0 ? (
                  <Empty title="No rooms yet">Add rooms under Rooms.</Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Room</th>
                          <th className="num">Garments</th>
                          <th className="num">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.rows.map((r) => {
                          const top = Math.max(...d.byRoom.map((x) => Number(x.in_stock)), 1);
                          return (
                            <tr key={r.id}>
                              <td>
                                <span className="strong">{r.code}</span>
                                <span className="muted small"> · {r.name}</span>
                              </td>
                              <td className="num" style={{ width: '45%' }}>
                                <div className="bar-cell">
                                  <div className="bar">
                                    <div style={{ width: `${(Number(r.in_stock) / top) * 100}%` }} />
                                  </div>
                                  <span className="strong">{r.in_stock}</span>
                                </div>
                              </td>
                              <td className="num muted nowrap"><Money value={r.stock_value} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {rooms.pager}
              </Panel>

              <Panel title="Latest movements" hint="newest first" tight>
                {d.recent.length === 0 ? (
                  <Empty title="Nothing has happened yet">
                    Book some stock in and it will show up here.
                  </Empty>
                ) : (
                  <ul className="timeline" style={{ padding: '0 16px' }}>
                    {recent.rows.map((m) => (
                      <li key={m.id}>
                        <span className="when"><When value={m.occurred_at} /></span>
                        <span className="grow">
                          <Status value={m.to_status} />{' '}
                          <b>{m.product_name}</b>{' '}
                          <span className="muted small">
                            <Swatch hex={m.color_hex} name={m.color_name} /> {m.size_code}
                          </span>
                          {m.to_room && <span className="muted small"> → {m.to_room}</span>}
                          {m.order_no && <span className="muted small"> · {m.order_no}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {recent.pager}
              </Panel>
            </div>
          </>
        )}
      </Loaded>
    </>
  );
}
