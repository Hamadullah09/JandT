import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, Loaded, Money, Notice, Panel, Status, When, useLoader, usePages,
} from '../components.jsx';

/**
 * What has come back.
 *
 * Returns are taken on the C72, in the returns room: the operator sweeps
 * everything there, grades each garment 1, 2 or 3, and adds them. The tag says
 * which order each came from, so the returns appear here on their own. This
 * page is for reading them - there is deliberately no way to start one here,
 * so there is only ever one place a return can come from.
 */
export default function Returns() {
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoader(() => api.returns({ status, search: debounced }), [status, debounced]);
  const pages = usePages(list.data?.returns, `${status}|${debounced}`);

  const tabs = [
    ['', 'All'],
    ['closed', 'Added to inventory'],
    ['requested', 'Asked for'],
    ['received', 'At the desk'],
    ['rejected', 'Rejected'],
  ];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Returns</h1>
          <p>Everything that has come back, and the grade each garment was given.</p>
        </div>
      </div>

      <Notice kind="info">
        <span>
          Returns are taken on the <b>C72</b>: go to the returns room, open <b>Take returns</b>, press the
          trigger to scan everything, change any grade from 1 to 2 or 3, and add them to inventory.
        </span>
      </Notice>

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
            id="returns-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Return number, order number or customer…"
          />
        </Field>
      </Panel>

      <Panel tight>
        <Loaded
          state={list}
          empty={(d) => d.returns.length === 0 && (
            <Empty title="No returns here">
              {search || status
                ? 'Nothing matches.'
                : 'Nothing has come back yet. Returns scanned on the C72 appear here.'}
            </Empty>
          )}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Return</th>
                    <th>Order</th>
                    <th>Tracking</th>
                    <th>Customer</th>
                    <th>Taken</th>
                    <th>Garments</th>
                    <th className="num">Refunded</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((r) => (
                    <tr key={r.id} className="pick" onClick={() => go('returns', r.id)}>
                      <td>
                        <div className="strong mono">{r.return_no}</div>
                        {r.reason && <div className="small faint">{r.reason}</div>}
                      </td>
                      <td className="mono small">{r.order_no}</td>
                      <td className="mono">{r.tracking_id ?? <span className="faint">—</span>}</td>
                      <td>
                        <div>{r.customer_name}</div>
                        <div className="small faint">{r.customer_phone || ''}</div>
                      </td>
                      <td className="muted small"><When value={r.received_at ?? r.requested_at} /></td>
                      <td>
                        {Number(r.scanned) === 0 ? (
                          <span className="pill grey">None</span>
                        ) : (
                          <>
                            <span className="pill ok">{r.matched} returned</span>
                            {Number(r.failed) > 0 && (
                              <> <span className="pill bad">{r.failed} wrong</span></>
                            )}
                          </>
                        )}
                      </td>
                      <td className="num"><Money value={r.refund_amount} /></td>
                      <td><Status value={r.status} /></td>
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
