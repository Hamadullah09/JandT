import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, GarmentName, Loaded, Modal, Money, Notice, Panel, Status, VariantPicker, When,
  money, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Orders.
 *
 * There is no public website yet, so every order is typed in here. That is
 * deliberately the only difference: an order placed by a customer later will be
 * the same row with `channel` set to web, and none of these screens will need
 * to change.
 */
export default function Orders() {
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoader(() => api.orders({ status, search: debounced }), [status, debounced]);
  const pages = usePages(list.data?.orders, `${status}|${debounced}`);

  // No "Ready to ship": scanning an order's last garment sends it out.
  // "Delivered" is back since the courier module reports it - an order booked
  // with J&T is marked delivered when the parcel is scanned delivered.
  const tabs = [
    ['', 'All'],
    ['pending', 'To pick'],
    ['shipped', 'Shipped'],
    ['delivered', 'Delivered'],
    ['partly_returned', 'Part returned'],
    ['returned', 'Returned'],
    ['cancelled', 'Cancelled'],
  ];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Orders</h1>
          <p>Take an order and scan the garments onto it. It goes out when the last one is scanned.</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>New order</button>
      </div>

      <Panel>
        <div className="tabs" style={{ marginBottom: 12 }}>
          {tabs.map(([value, label]) => (
            <button key={value} className={status === value ? 'on' : ''} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
        <Field label="Search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number, customer name, phone or J&T tracking number…"
          />
        </Field>
      </Panel>

      <Panel tight>
        <Loaded
          state={list}
          empty={(d) => d.orders.length === 0 && (
            <Empty title="No orders here">
              {search || status ? 'Nothing matches.' : 'Take your first order to get started.'}
            </Empty>
          )}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Placed</th>
                    <th className="num">Items</th>
                    <th>Picking</th>
                    <th className="num">Total</th>
                    <th>J&amp;T parcel</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((o) => {
                    const need = Number(o.stock_units);
                    const have = Number(o.picked);
                    const short = need - have;

                    return (
                      <tr key={o.id} className="pick" onClick={() => go('orders', o.id)}>
                        <td>
                          <div className="strong mono">{o.order_no}</div>
                          {/* What the customer quotes and the courier's sheet
                              carries. Shown beside the order number because the
                              desk is given one and has to find the other. */}
                          {o.tracking_id != null && (
                            <div className="small faint mono">tracking {o.tracking_id}</div>
                          )}
                          {Number(o.return_count) > 0 && (
                            <span className="pill warn">
                              {o.return_count} return{Number(o.return_count) === 1 ? '' : 's'}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="strong">{o.customer_name}</div>
                          <div className="small faint">{o.customer_phone || o.city || ''}</div>
                        </td>
                        <td className="muted small"><When value={o.placed_at} /></td>
                        <td className="num">{o.units}</td>
                        <td>
                          {need === 0
                            ? <span className="pill info">All dropship</span>
                            : short > 0
                              ? <span className="pill warn">{short} still to scan</span>
                              : <span className="pill ok">All {need} scanned</span>}
                        </td>
                        <td className="num">
                          <Money value={o.total} />
                          {/* Cash on delivery is money not yet in, which is a
                              different thing from a total, so it is said next
                              to the total rather than in a column of its own. */}
                          {o.payment_type === 'cod'
                            ? <div><span className="pill warn">COD</span></div>
                            : <div><span className="pill ok">Paid</span></div>}
                          {Number(o.refunded_total) > 0 && (
                            <div className="small" style={{ color: 'var(--bad)' }}>
                              −<Money value={o.refunded_total} />
                            </div>
                          )}
                        </td>
                        <td>
                          {o.courier_tracking_no ? (
                            <>
                              <Status value={o.courier_status} />
                              <div className="small faint mono">{o.courier_tracking_no}</div>
                            </>
                          ) : ['shipped', 'delivered'].includes(o.status) ? (
                            <span className="pill warn">To book</span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td><Status value={o.status === 'pending' && need === 0 ? 'to_send' : o.status} /></td>
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

      <NewOrder
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); go('orders', id); }}
      />
    </>
  );
}

function NewOrder({ open, onClose, onCreated }) {
  const blank = {
    customerName: '', customerPhone: '', customerEmail: '',
    address: '', city: '', postalCode: '', paymentType: 'cod',
    shippingFee: '', discount: '', notes: '',
  };
  const [form, setForm] = React.useState(blank);
  const [lines, setLines] = React.useState([]);
  const [picking, setPicking] = React.useState(false);
  const act = useAction();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  function addLine(variant) {
    setPicking(false);
    setLines((ls) => ls.some((l) => l.variantId === variant.id)
      ? ls.map((l) => (l.variantId === variant.id
          ? { ...l, quantity: String(Number(l.quantity || 0) + 1) }
          : l))
      : [...ls, {
          variantId: variant.id,
          label: variant,
          quantity: '1',
          unitPrice: String(Number(variant.sale_price ?? 0)),
          sellable: Number(variant.sellable),
          dropship: variant.stock_type === 'dropship',
        }]);
  }

  const subtotal = lines.reduce(
    (n, l) => n + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (Number(form.shippingFee) || 0) - (Number(form.discount) || 0);

  // Warned about, not blocked. Stock arrives, and an order taken today for
  // something landing tomorrow is a normal thing to want to record.
  const shortLines = lines.filter((l) => !l.dropship && Number(l.quantity) > l.sellable);
  const ready = form.customerName.trim() && lines.length > 0
    && lines.every((l) => Number(l.quantity) > 0);

  async function save() {
    const res = await act.run(() => api.createOrder({
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim() || null,
      customerEmail: form.customerEmail.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      postalCode: form.postalCode.trim() || null,
      paymentType: form.paymentType,
      shippingFee: Number(form.shippingFee || 0),
      discount: Number(form.discount || 0),
      notes: form.notes.trim() || null,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice || 0),
      })),
    }));
    if (res) { setForm(blank); setLines([]); onCreated(res.id); }
  }

  return (
    <>
      <Modal
        open={open && !picking}
        title="New order"
        onClose={onClose}
        footer={
          <>
            <button onClick={onClose} disabled={act.busy}>Cancel</button>
            <button className="primary" onClick={save} disabled={act.busy || !ready}>
              {act.busy ? 'Saving…' : `Place order — ${money(total)}`}
            </button>
          </>
        }
      >
        <Notice kind="error">{act.error}</Notice>

        <Field label="Customer name">
          <input value={form.customerName} onChange={set('customerName')} autoFocus
            placeholder="Nur Aisyah" />
        </Field>

        {/* Examples in the shape J&T Malaysia books: a Malaysian mobile number
            and a five-digit postcode. */}
        <div className="row">
          <Field label="Phone">
            <input value={form.customerPhone} onChange={set('customerPhone')} placeholder="012-345 6789" />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={set('city')} placeholder="Petaling Jaya" />
          </Field>
          <Field label="Postcode">
            <input value={form.postalCode} onChange={set('postalCode')} placeholder="47810" />
          </Field>
        </div>

        <Field label="Address">
          <textarea value={form.address} onChange={set('address')} style={{ minHeight: 56 }} />
        </Field>

        <Field
          label="Payment"
          help="Cash on delivery is the default, because it is the one that still owes something."
        >
          <div className="tabs inline">
            <button
              type="button"
              className={form.paymentType === 'cod' ? 'on' : ''}
              onClick={() => setForm((f) => ({ ...f, paymentType: 'cod' }))}
            >
              Cash on delivery
            </button>
            <button
              type="button"
              className={form.paymentType === 'paid' ? 'on' : ''}
              onClick={() => setForm((f) => ({ ...f, paymentType: 'paid' }))}
            >
              Already paid
            </button>
          </div>
        </Field>

        <Field label="What they ordered">
          {lines.length === 0 ? (
            <div className="notice info" style={{ margin: 0 }}>Nothing added yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Garment</th>
                    <th className="num" style={{ width: 90 }}>Qty</th>
                    <th className="num" style={{ width: 110 }}>Price</th>
                    <th className="num">Line</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const short = !l.dropship && Number(l.quantity) > l.sellable;
                    return (
                      <tr key={l.variantId}>
                        <td>
                          <GarmentName row={l.label} />
                          {l.dropship
                            ? <span className="pill info">Dropship — nothing to scan</span>
                            : <span className={`pill ${short ? 'bad' : 'grey'}`}>
                                {l.sellable} in stock
                              </span>}
                        </td>
                        <td>
                          <input type="number" min="1" value={l.quantity}
                            onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={l.unitPrice}
                            onChange={(e) => setLine(i, 'unitPrice', e.target.value)} />
                        </td>
                        <td className="num">
                          {money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}
                        </td>
                        <td className="tight">
                          <button className="link bad sm"
                            onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setPicking(true)}>+ Add a garment</button>
          </div>
        </Field>

        {shortLines.length > 0 && (
          <Notice kind="warn">
            <span>
              There is not enough in stock for {shortLines.length} line
              {shortLines.length === 1 ? '' : 's'}. The order can still be taken — you just will
              not be able to ship it until the garments are booked in.
            </span>
          </Notice>
        )}

        <div className="row">
          <Field label="Delivery charge">
            <input type="number" min="0" step="0.01" value={form.shippingFee} onChange={set('shippingFee')}
              placeholder="10" />
          </Field>
          <Field label="Discount">
            <input type="number" min="0" step="0.01" value={form.discount} onChange={set('discount')}
              placeholder="0" />
          </Field>
        </div>

        {lines.length > 0 && (
          <Notice kind="info">
            <span>
              Garments {money(subtotal)}
              {Number(form.shippingFee) > 0 && <> · delivery {money(form.shippingFee)}</>}
              {Number(form.discount) > 0 && <> · less {money(form.discount)}</>}
              {' '}= <b>{money(total)}</b>
            </span>
          </Notice>
        )}

        <Field label="Note">
          <input value={form.notes} onChange={set('notes')} placeholder="Gift wrap, deliver after 5pm" />
        </Field>
      </Modal>

      <Modal open={picking} title="Add a garment" onClose={() => setPicking(false)}>
        <VariantPicker onPick={addLine} />
      </Modal>
    </>
  );
}
