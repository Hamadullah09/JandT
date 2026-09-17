import React from 'react';
import { api, platform } from '../api.js';
import { go } from '../App.jsx';
import {
  Confirm, Empty, Field, GarmentName, Loaded, Money, Notice, Panel, ScanBox, ScanLog, Status, Swatch,
  StatValue, When, money, useAction, useLoader, usePages,
} from '../components.jsx';

/** Orders a parcel can still be booked for: anything not cancelled or come back. */
const BOOKABLE = ['pending', 'allocated', 'packed', 'shipped'];

/** Courier scan codes as the tracking page words them. */
const SCAN_LABELS = {
  PICKED_UP: 'Picked up',
  DEPARTURE: 'On the way',
  DC_ARRIVAL: 'At sorting hub',
  DP_ARRIVAL: 'At local branch',
  ON_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
};

/**
 * The order's parcel with J&T - where the warehouse and the courier module meet.
 *
 * Before the platform, a picked order was typed a second time into the courier
 * portal to get a waybill. Now the order books its own parcel: the customer,
 * the address and every line go across, and the courier's scans come back and
 * move the order along - delivered, or a return opened at the desk.
 */
function CourierPanel({ order, shipment, units, onBooked }) {
  const [form, setForm] = React.useState(() => ({
    weightKg: Math.max(0.5, units * 0.5).toFixed(1),
    phone: order.customer_phone ?? '',
    postcode: order.postal_code ?? '',
    address: order.address ?? '',
  }));
  const act = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (shipment) {
    const events = shipment.events ?? [];
    // The courier's own record when it can be read, so a scan shows here at
    // once; the warehouse's synced copy otherwise.
    const parcelStatus = shipment.courier?.status ?? shipment.status;
    return (
      <Panel
        title="J&T courier"
        hint="booked from this order through the courier module"
        actions={<Status value={parcelStatus} />}
      >
        <div className="grid two">
          <div>
            <div className="small muted">Tracking number</div>
            <div className="courier-number">{shipment.tracking_no}</div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Sortation</dt>
              <dd className="mono">
                {shipment.sortation_code ?? '—'}
                {shipment.route_code && <span className="muted"> · route {shipment.route_code}</span>}
              </dd>
              <dt>Weight</dt>
              <dd>{shipment.weight_kg != null ? `${Number(shipment.weight_kg).toFixed(2)} kg` : '—'}</dd>
              <dt>Freight</dt>
              <dd>{shipment.freight_fee != null ? <Money value={shipment.freight_fee} /> : '—'}</dd>
              {/* Once J&T has handed the parcel over, the cash is theirs to pay
                  in, not the customer's to pay. */}
              <dt>Cash on delivery</dt>
              <dd>
                {Number(shipment.cod_amount) <= 0
                  ? <span className="pill ok">Nothing - paid</span>
                  : parcelStatus === 'DELIVERED'
                    ? <span className="pill ok"><Money value={shipment.cod_amount} /> collected by J&T</span>
                    : parcelStatus === 'RETURNED'
                      ? <span className="pill bad">Not collected - returned</span>
                      : <span className="pill warn"><Money value={shipment.cod_amount} /> to collect</span>}
              </dd>
              <dt>Booked</dt>
              <dd>
                <When value={shipment.booked_at} />
                {shipment.booked_by_name && <span className="muted"> by {shipment.booked_by_name}</span>}
              </dd>
            </dl>
            <div className="courier-actions">
              <a className="button primary" href={shipment.waybill_url} target="_blank" rel="noreferrer">
                Print waybill
              </a>
              <a className="button" href={shipment.tracking_url} target="_blank" rel="noreferrer">
                Tracking page
              </a>
              {platform.active && (
                <a className="button" href={`/admin?q=${encodeURIComponent(shipment.tracking_no)}`}>
                  Open in courier admin
                </a>
              )}
            </div>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>The parcel&apos;s journey</div>
            {events.length === 0 ? (
              <Empty title="No scans yet">J&amp;T has not collected the parcel.</Empty>
            ) : (
              <ul className="timeline">
                {events.map((e, i) => (
                  <li key={`${e.occurred_at}-${i}`}>
                    <span className="when"><When value={e.occurred_at} /></span>
                    <span className="grow">
                      <b>{SCAN_LABELS[e.event_type] ?? e.event_type}</b>
                      <div className="small muted">{e.description}{e.location ? ` · ${e.location}` : ''}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  if (!BOOKABLE.includes(order.status)) return null;

  async function book() {
    const res = await act.run(() => api.bookCourier(order.id, {
      weightKg: Number(form.weightKg) || null,
      phone: form.phone.trim() || null,
      postcode: form.postcode.trim() || null,
      address: form.address.trim() || null,
    }));
    if (res) onBooked();
  }

  const cod = order.payment_type === 'cod';

  return (
    <Panel title="Send with J&T courier" hint="creates the waybill and the tracking number">
      <p className="muted small">
        The customer, the address and every garment on this order go to the courier in one step.
        {cod
          ? <> J&amp;T will collect <b>{money(Number(order.total) - Number(order.refunded_total))}</b> cash on delivery.</>
          : <> The order is paid, so there is nothing to collect.</>}
        {' '}Once J&amp;T scans it delivered, this order is marked delivered by itself.
      </p>
      <div className="form-row">
        <Field label="Weight (kg)">
          <input type="number" step="0.1" min="0.1" max="30" value={form.weightKg} onChange={set('weightKg')} />
        </Field>
        <Field label="Customer mobile">
          <input value={form.phone} onChange={set('phone')} placeholder="012-345 6789" />
        </Field>
        <Field label="Postcode">
          <input value={form.postcode} onChange={set('postcode')} placeholder="47810" maxLength={5} />
        </Field>
      </div>
      <Field label="Delivery address">
        <textarea rows={2} value={form.address} onChange={set('address')} />
      </Field>
      <Notice kind="error">{act.error}</Notice>
      <button className="primary" onClick={book} disabled={act.busy}>
        {act.busy ? 'Booking with J&T…' : 'Book J&T courier'}
      </button>
    </Panel>
  );
}

/**
 * One order: what was asked for, which garments have been put against it, and
 * what happens next.
 *
 * Picking is a scan box rather than a list of checkboxes, because the point of
 * the tags is that the person filling the box never has to decide which navy
 * medium they are holding — they scan it, and the server decides whether it is
 * one this order wants.
 */
export default function OrderDetail({ id }) {
  const state = useLoader(() => api.order(id), [id]);
  const [log, setLog] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(null);
  const act = useAction();

  const o = state.data?.order;
  const linePages = usePages(state.data?.lines, id);
  const pickedPages = usePages(state.data?.picked, id);
  const returnPages = usePages(state.data?.returns, id);
  const canPick = o?.status === 'pending' || o?.status === 'allocated';
  const nothingToScan = !!state.data && !state.data.lines.some((l) => l.route === 'stock');

  async function scan(epc) {
    setBusy(true);
    try {
      const res = await api.pick(id, epc, null);
      setLog((l) => [{
        key: `${epc}-${Date.now()}`,
        epc,
        tone: 'ok',
        message: `${res.product} — ${res.outstanding === 0 ? 'that is everything' : `${res.outstanding} still to scan`}`,
      }, ...l].slice(0, 50));
      state.reload();
    } catch (err) {
      setLog((l) => [{
        key: `${epc}-${Date.now()}`, epc, tone: 'bad', message: err.message,
      }, ...l].slice(0, 50));
    } finally {
      setBusy(false);
    }
  }

  async function unpick(orderItemId) {
    await act.run(() => api.unpick(id, orderItemId));
    state.reload();
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <button className="link" onClick={() => go('orders')}>← All orders</button>
          <h1>{o?.order_no ?? 'Order'}</h1>
          <p>
            {o?.tracking_id != null && <><span className="strong">Tracking {o.tracking_id}</span>{' · '}</>}
            {o?.customer_name}
            {o?.customer_phone && <> · {o.customer_phone}</>}
            {o?.city && <> · {o.city}</>}
            {' · placed '}<When value={o?.placed_at} />
            {o?.shipped_at && <>{' · sent out '}<When value={o.shipped_at} /></>}
          </p>
        </div>
        {o && <Status value={o.status === 'pending' && nothingToScan ? 'to_send' : o.status} />}
      </div>

      <Loaded state={state}>
        {(d) => {
          const need = d.lines
            .filter((l) => l.route === 'stock')
            .reduce((n, l) => n + Number(l.quantity), 0);
          const have = d.picked.filter((p) => p.status !== 'returned').length;
          const outstanding = need - have;

          return (
            <>
              <Notice kind="error">{act.error}</Notice>
              {o.status === 'shipped' && log.length > 0 && (
                <Notice kind="ok">That was the last garment, so the order has gone out.</Notice>
              )}

              <div className="stats">
                <div className="stat accent">
                  <div className="label">Order total</div>
                  <StatValue>{money(o.total)}</StatValue>
                  <div className="note">
                    {money(o.subtotal)} garments
                    {Number(o.shipping_fee) > 0 && <> + {money(o.shipping_fee)} delivery</>}
                    {Number(o.discount) > 0 && <> − {money(o.discount)} discount</>}
                  </div>
                </div>
                {Number(o.refunded_total) > 0 && (
                  <div className="stat bad">
                    <div className="label">Refunded</div>
                    <StatValue>{money(o.refunded_total)}</StatValue>
                    <div className="note">net {money(Number(o.total) - Number(o.refunded_total))}</div>
                  </div>
                )}
                <div className="stat">
                  <div className="label">Garments to scan</div>
                  <div className="value">{have} / {need}</div>
                  <div className="note">
                    {need === 0 ? 'all dropship' : outstanding > 0 ? `${outstanding} to go` : 'all done'}
                  </div>
                </div>
              </div>

              {canPick && need > 0 && (
                <div className="grid two">
                  <Panel title="Scan the garments onto this order">
                    {outstanding === 0 ? (
                      <Notice kind="ok">
                        <span>
                          Everything is scanned. Press <b>Send it out</b> to finish it.
                        </span>
                      </Notice>
                    ) : (
                      <>
                        <p className="muted small">
                          Scan any garment the order wants. You do not have to say which line it
                          is for — it is worked out from the tag, and a garment this order does
                          not want is refused with a reason. The order goes out by itself when
                          the last one is scanned.
                        </p>
                        <ScanBox onScan={scan} busy={busy} label="Add to order" />
                      </>
                    )}
                  </Panel>

                  <Panel title="What just happened" tight>
                    {log.length === 0
                      ? <Empty title="Nothing scanned yet">Scans appear here as you go.</Empty>
                      : <ScanLog entries={log} />}
                  </Panel>
                </div>
              )}

              <Panel
                title="What was ordered"
                actions={
                  <>
                    {/* Only for an order no scan can finish - every line
                        dropship, or one an older build left fully picked. Any
                        other order goes out when its last garment is scanned. */}
                    {canPick && outstanding === 0 && (
                      <button className="go" onClick={() => setConfirm('ship')}>
                        Send it out
                      </button>
                    )}
                    {canPick && (
                      <button className="danger" onClick={() => setConfirm('cancel')}>Cancel</button>
                    )}
                  </>
                }
                tight
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Garment</th>
                        <th>How it is filled</th>
                        <th className="num">Qty</th>
                        <th className="num">Scanned</th>
                        <th className="num">Price</th>
                        <th className="num">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linePages.rows.map((l) => (
                        <tr key={l.id}>
                          <td><GarmentName row={l} /></td>
                          <td>
                            {l.route === 'dropship' ? (
                              <>
                                <span className="pill info">Dropship</span>
                                <div className="small faint">
                                  {l.supplier ? `${l.supplier} ships it` : 'the supplier ships it'}
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="pill brand">From stock</span>
                                <div className="small faint">{l.available} in stock</div>
                              </>
                            )}
                          </td>
                          <td className="num">{l.quantity}</td>
                          <td className="num">
                            {l.route === 'dropship' ? (
                              <span className="faint">n/a</span>
                            ) : (
                              <span className={`pill ${Number(l.outstanding) === 0 ? 'ok' : 'warn'}`}>
                                {l.picked} / {l.quantity}
                              </span>
                            )}
                          </td>
                          <td className="num"><Money value={l.unit_price} /></td>
                          <td className="num strong"><Money value={l.line_total} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {linePages.pager}
              </Panel>

              <CourierPanel
                key={d.shipment?.tracking_no ?? 'unbooked'}
                order={o}
                shipment={d.shipment}
                units={d.lines.reduce((n, l) => n + Number(l.quantity), 0)}
                onBooked={state.reload}
              />

              <Panel
                title="Which garments went out"
                hint="the tags this customer actually received"
                tight
              >
                {d.picked.length === 0 ? (
                  <Empty title="Nothing scanned onto this order yet">
                    {need === 0
                      ? 'This order is entirely dropship, so there is nothing to scan.'
                      : 'Scan the garments above.'}
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tag</th>
                          <th>Garment</th>
                          <th>Room</th>
                          <th>Scanned</th>
                          <th>By</th>
                          <th>State</th>
                          {canPick && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {pickedPages.rows.map((p) => (
                          <tr key={p.id}>
                            <td className="mono">{p.epc}</td>
                            <td>
                              <span className="strong">{p.product_name}</span>{' '}
                              <span className="muted small">
                                <Swatch hex={p.color_hex} name={p.color_name} /> {p.size_code}
                              </span>
                            </td>
                            <td className="muted small">{p.room_code ?? '—'}</td>
                            <td className="muted small"><When value={p.picked_at} /></td>
                            <td className="muted small">{p.picked_by_name ?? '—'}</td>
                            <td><Status value={p.status} /></td>
                            {canPick && (
                              <td className="tight">
                                {p.status === 'allocated' && (
                                  <button className="link bad sm" onClick={() => unpick(p.id)}>
                                    Take off
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {pickedPages.pager}
              </Panel>

              {d.returns.length > 0 && (
                <Panel title="Returns on this order" tight>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Return</th>
                          <th>Reason</th>
                          <th>Opened</th>
                          <th className="num">Refunded</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnPages.rows.map((r) => (
                          <tr key={r.id} className="pick" onClick={() => go('returns', r.id)}>
                            <td className="mono strong">{r.return_no}</td>
                            <td className="muted">{r.reason || '—'}</td>
                            <td className="muted small"><When value={r.requested_at} /></td>
                            <td className="num"><Money value={r.refund_amount} /></td>
                            <td><Status value={r.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {returnPages.pager}
                </Panel>
              )}

              <Panel title="Delivery">
                <dl className="kv">
                  {o.address && (
                    <>
                      <dt>Address</dt>
                      <dd>
                        {/* The city is only added when the address does not
                            already say it. On an imported order the city was
                            read out of the address in the first place, so
                            appending it gives "…, Petaling Jaya, Selangor,
                            Malaysia, Petaling Jaya". */}
                        {o.address}
                        {o.city && !o.address.toLowerCase().includes(o.city.toLowerCase())
                          && <>, {o.city}</>}
                        {o.postal_code && <> {o.postal_code}</>}
                      </dd>
                    </>
                  )}
                  {o.customer_email && (<><dt>Email</dt><dd>{o.customer_email}</dd></>)}
                  <dt>Payment</dt>
                  <dd>
                    {o.payment_type === 'cod'
                      ? <span className="pill warn">Cash on delivery</span>
                      : <span className="pill ok">Paid</span>}
                  </dd>
                  {o.notes && (<><dt>Note</dt><dd>{o.notes}</dd></>)}
                  <dt>Taken by</dt>
                  <dd>{o.created_by_name ?? '—'}</dd>
                </dl>
              </Panel>

              <Confirm
                open={confirm === 'ship'}
                title="Send this order out?"
                confirmLabel="Send it out"
                busy={act.busy}
                body={
                  need === 0 ? (
                    <p>
                      Nothing on this order is picked here — the supplier sends it. This marks
                      the order as sent out, and it can no longer be cancelled afterwards.
                    </p>
                  ) : (
                    <p>
                      All {need} garment{need === 1 ? '' : 's'} are scanned. They will be marked
                      as shipped and will leave the stock count. After this the only way to bring
                      them back is a return.
                    </p>
                  )
                }
                onClose={() => setConfirm(null)}
                onConfirm={async () => {
                  await act.run(() => api.shipOrder(id));
                  setConfirm(null); state.reload();
                }}
              />



              <Confirm
                open={confirm === 'cancel'}
                title="Cancel this order?"
                confirmLabel="Cancel the order"
                danger
                busy={act.busy}
                body={
                  /* An order with nothing scanned onto it is the usual one to
                     cancel, and "The 0 garments scanned onto it go straight
                     back into stock" is a sentence about nothing. Say what is
                     actually true of this order instead. */
                  <p>
                    {have === 0
                      ? 'Nothing has been scanned onto this order, so no stock moves. '
                      : `The ${have} garment${have === 1 ? '' : 's'} scanned onto it ${have === 1 ? 'goes' : 'go'} straight back into stock. `}
                    The order stays on the record as cancelled.
                  </p>
                }
                onClose={() => setConfirm(null)}
                onConfirm={async () => {
                  await act.run(() => api.cancelOrder(id));
                  setConfirm(null); state.reload();
                }}
              />
            </>
          );
        }}
      </Loaded>
    </>
  );
}
