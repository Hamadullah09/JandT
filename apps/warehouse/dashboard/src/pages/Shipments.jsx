import React from 'react';
import { api, platform } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Loaded, Money, Panel, Stat, Status, When, money, useLoader, usePages,
} from '../components.jsx';

/**
 * Every parcel booked with J&T from a warehouse order, and where it is now.
 *
 * The statuses are the courier module's own scans, read back into the
 * warehouse every few seconds: nobody types "delivered" here any more.
 */
export default function Shipments() {
  const [status, setStatus] = React.useState('');
  const list = useLoader(() => api.shipments(status), [status]);
  const overview = useLoader(() => api.overview(), []);
  const pages = usePages(list.data?.shipments, status);
  const s = overview.data?.shipping;

  const tabs = [
    ['', 'All'],
    ['CREATED', 'Awaiting pickup'],
    ['IN_TRANSIT', 'In transit'],
    ['ON_DELIVERY', 'Out for delivery'],
    ['DELIVERED', 'Delivered'],
    ['RETURNED', 'Returned'],
  ];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>J&amp;T shipments</h1>
          <p>Parcels booked from warehouse orders, with the courier&apos;s latest scan.</p>
        </div>
        {platform.active && (
          <div className="courier-actions" style={{ marginTop: 0 }}>
            <a className="button" href="/admin">Courier admin ↗</a>
          </div>
        )}
      </div>

      {s && (
        <div className="stats">
          <Stat
            label="Shipped, not booked"
            value={Number(s.to_book ?? 0)}
            note="orders gone out with no J&T parcel"
            tone={Number(s.to_book) > 0 ? 'warn' : undefined}
            onClick={() => go('orders')}
          />
          <Stat label="Awaiting pickup" value={Number(s.awaiting_pickup ?? 0)} note="waybill printed" />
          <Stat label="On the way" value={Number(s.in_transit ?? 0)} note="with J&T" tone="accent" />
          <Stat label="Delivered" value={Number(s.delivered ?? 0)} note="order closed by the scan" tone="ok" />
          <Stat
            label="COD still to collect"
            value={money(s.cod_outstanding)}
            note={`${Number(s.returned ?? 0)} returned to the shop`}
            tone={Number(s.cod_outstanding) > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      <Panel>
        <div className="tabs">
          {tabs.map(([value, label]) => (
            <button key={value} className={status === value ? 'on' : ''} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel tight>
        <Loaded
          state={list}
          empty={(d) => d.shipments.length === 0 && (
            <Empty title="No parcels here">
              Open a shipped order and press <b>Book J&amp;T courier</b>.
            </Empty>
          )}
        >
          {() => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tracking number</th>
                    <th>Order</th>
                    <th>Booked</th>
                    <th className="num">Weight</th>
                    <th className="num">Freight</th>
                    <th className="num">COD</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((row) => (
                    <tr key={row.id} className="pick" onClick={() => go('orders', row.order_id)}>
                      <td>
                        <div className="strong mono">{row.tracking_no}</div>
                        <div className="small faint mono">
                          {row.sortation_code}{row.route_code ? ` · ${row.route_code}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="strong mono">{row.order_no}</div>
                        <div className="small faint">{row.customer_name}{row.city ? ` · ${row.city}` : ''}</div>
                      </td>
                      <td className="muted small">
                        <When value={row.booked_at} />
                        {row.booked_by_name && <div className="faint">by {row.booked_by_name}</div>}
                      </td>
                      <td className="num">{row.weight_kg != null ? `${Number(row.weight_kg).toFixed(1)} kg` : '—'}</td>
                      <td className="num">{row.freight_fee != null ? <Money value={row.freight_fee} /> : '—'}</td>
                      <td className="num">
                        {Number(row.cod_amount) > 0 ? <Money value={row.cod_amount} /> : <span className="faint">paid</span>}
                      </td>
                      <td>
                        <Status value={row.status} />
                        {row.status_at && <div className="small faint"><When value={row.status_at} /></div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        {pages.pager}
      </Panel>
    </>
  );
}
