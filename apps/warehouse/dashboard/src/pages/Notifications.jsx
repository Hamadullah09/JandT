import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, GarmentName, Loaded, Panel, Photo, useLoader, usePages,
} from '../components.jsx';

/**
 * What needs booking in: every colour and size with fewer garments on the
 * shelves than its alert level.
 *
 * The level is 10 unless it was changed on the product, so "fewer than 10" is
 * the everyday rule, and 0 switches it off for a colour and size. The number
 * beside the tab is the same count, so it can be seen from any page.
 */
export default function Notifications() {
  const state = useLoader(() => api.lowStock(), []);
  const pages = usePages(state.data?.variants);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Notifications</h1>
          <p>Colours and sizes running low: fewer than 10 on the shelves, or fewer than the level set on the product.</p>
        </div>
        <button onClick={state.reload} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <Panel
        title="Running low"
        hint={state.data ? `${state.data.variants.length} to book in` : undefined}
        tight
      >
        <Loaded
          state={state}
          empty={(d) => d.variants.length === 0 && (
            <Empty title="Nothing is running low">
              Every colour and size has at least its alert level on the shelves.
            </Empty>
          )}
        >
          {() => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 52 }} />
                    <th>Garment</th>
                    <th>Category</th>
                    <th className="num">On the shelves</th>
                    <th className="num">Alert below</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((v) => (
                    <tr key={v.id} className="pick" onClick={() => go('products', v.product_id)}>
                      <td><Photo url={v.photo_url} alt={v.product_name} style={{ width: 40 }} /></td>
                      <td><GarmentName row={v} /></td>
                      <td className="muted">{v.category_name}</td>
                      <td className="num">
                        <span className="pill bad">
                          {Number(v.in_stock) === 0 ? 'None left' : v.in_stock}
                        </span>
                      </td>
                      <td className="num muted">{v.reorder_level}</td>
                      <td className="tight">
                        <button
                          className="link"
                          onClick={(e) => { e.stopPropagation(); go('intake', null, { book: v.id }); }}
                        >
                          Book more in
                        </button>
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
