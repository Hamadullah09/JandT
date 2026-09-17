import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, FindButton, Loaded, Modal, Money, Notice, Panel, Photo, StatValue, Swatch, useAction, useLoader,
  usePages, money,
} from '../components.jsx';

/**
 * One product, and the grid of colours and sizes it exists in.
 *
 * The grid is the point of this screen: it is the only place that answers "have
 * we got that in navy, in a medium" without three clicks, and it is where the
 * count of real tagged garments per colour and size lives.
 */
export default function ProductDetail({ id, isAdmin }) {
  const state = useLoader(() => api.product(id), [id]);
  const variantPages = usePages(state.data?.variants, id);
  const [addingVariants, setAddingVariants] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [pricing, setPricing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const switching = useAction();
  const switchedOff = state.data && Number(state.data.product.active) === 0;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <button className="link" onClick={() => go('products')}>← All products</button>
          <h1>{state.data?.product?.name ?? 'Product'}</h1>
          <p>
            <span className="mono">{state.data?.product?.sku}</span>
            {state.data?.product && <> · {state.data.product.category_name}</>}
          </p>
        </div>
        {switchedOff && <span className="pill grey">Switched off</span>}
        {isAdmin && state.data && (
          <>
            {switchedOff && (
              <button
                disabled={switching.busy}
                onClick={async () => {
                  if (await switching.run(() => api.setProductActive(id, 1))) state.reload();
                }}
              >
                Switch back on
              </button>
            )}
            <button onClick={() => setEditing(true)}>Edit details</button>
            <button className="primary" onClick={() => setAddingVariants(true)}>
              Add colours &amp; sizes
            </button>
            <button className="danger" onClick={() => setDeleting(true)}>Delete product</button>
          </>
        )}
      </div>

      <Loaded state={state}>
        {(d) => {
          const dropship = d.product.stock_type === 'dropship';
          const totalStock = d.variants.reduce((n, v) => n + Number(v.in_stock), 0);
          const totalValue = d.variants.reduce((n, v) => n + Number(v.stock_value), 0);

          return (
            <>
              <Notice kind="error">{switching.error}</Notice>
              <div className="grid two">
                <Panel title="Details">
                  <dl className="kv">
                    <dt>Kind</dt>
                    <dd>
                      {dropship
                        ? <span className="pill info">Supplier ships it directly</span>
                        : <span className="pill brand">Held in the warehouse</span>}
                    </dd>
                    <dt>Cost</dt>
                    <dd><Money value={d.product.cost_price} /></dd>
                    <dt>Sells for</dt>
                    <dd><Money value={d.product.sale_price} /></dd>
                    {d.product.supplier && (<><dt>Supplier</dt><dd>{d.product.supplier}</dd></>)}
                    <dt>Description</dt>
                    <dd>{d.product.description || <span className="faint">Not set</span>}</dd>
                  </dl>
                </Panel>

                <Panel title="Stock across every colour and size">
                  <div className="stats" style={{ margin: 0 }}>
                    {dropship ? (
                      <>
                        <div className="stat">
                          <div className="label">At the supplier</div>
                          <div className="value">
                            {d.variants.reduce((n, v) => n + Number(v.dropship_qty), 0)}
                          </div>
                          <div className="note">across {d.variants.length} colour and size combinations</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="stat">
                          <div className="label">In stock</div>
                          <div className="value">{totalStock}</div>
                          <div className="note">tagged and on a shelf</div>
                        </div>
                        <div className="stat">
                          <div className="label">Stock value</div>
                          <StatValue>{money(totalValue)}</StatValue>
                          <div className="note">at what it cost</div>
                        </div>
                      </>
                    )}
                  </div>
                </Panel>
              </div>

              <PhotoGallery productId={id} photos={d.photos ?? []} isAdmin={isAdmin} onChanged={state.reload} />

              <Panel
                title="Colours and sizes"
                hint={`${d.variants.length} combination${d.variants.length === 1 ? '' : 's'}`}
                tight
              >
                {d.variants.length === 0 ? (
                  <Empty title="No colours or sizes yet">
                    This product cannot be ordered or booked in until it has at least one.
                    {isAdmin && (
                      <div style={{ marginTop: 12 }}>
                        <button className="primary" onClick={() => setAddingVariants(true)}>
                          Add colours &amp; sizes
                        </button>
                      </div>
                    )}
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Colour</th>
                          <th>Size</th>
                          <th>Code</th>
                          <th className="num">{dropship ? 'At supplier' : 'In stock'}</th>
                          {!dropship && <th className="num">Picked</th>}
                          {!dropship && <th className="num">Shipped</th>}
                          <th className="num">Cost</th>
                          <th className="num">Sells for</th>
                          {!dropship && <th className="num">Alert below</th>}
                          {!dropship && <th />}
                          {isAdmin && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {variantPages.rows.map((v) => (
                          <tr key={v.id} className={Number(v.active) === 0 ? 'muted' : undefined}>
                            <td><Swatch hex={v.color_hex} name={v.color_name} /></td>
                            <td className="strong">{v.size_code}</td>
                            <td className="mono faint small">{v.sku}</td>
                            <td className="num">
                              {dropship ? (
                                <span className="pill info">{v.dropship_qty}</span>
                              ) : (
                                <span className={`pill ${Number(v.in_stock) > 0 ? 'ok' : 'grey'}`}>
                                  {v.in_stock}
                                </span>
                              )}
                            </td>
                            {!dropship && <td className="num muted">{v.allocated}</td>}
                            {!dropship && <td className="num muted">{v.shipped}</td>}
                            <td className="num">
                              <Money value={v.cost_price} />
                              {v.cost_override !== null && <span className="faint small"> ·set</span>}
                            </td>
                            <td className="num">
                              <Money value={v.sale_price} />
                              {v.sale_override !== null && <span className="faint small"> ·set</span>}
                            </td>
                            {!dropship && (
                              <td className="num muted">
                                {Number(v.reorder_level) > 0 ? v.reorder_level : '—'}
                              </td>
                            )}
                            {!dropship && (
                              <td className="tight"><FindButton variant={v} /></td>
                            )}
                            {isAdmin && (
                              <td className="tight">
                                <button className="link sm" onClick={() => setPricing(v)}>Edit</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {variantPages.pager}
              </Panel>

              <AddVariants
                open={addingVariants}
                productId={id}
                onClose={() => setAddingVariants(false)}
                onDone={() => { setAddingVariants(false); state.reload(); }}
              />

              <EditProduct
                open={editing}
                product={d.product}
                onClose={() => setEditing(false)}
                onDone={() => { setEditing(false); state.reload(); }}
              />

              <EditVariant
                variant={pricing}
                dropship={dropship}
                onClose={() => setPricing(null)}
                onDone={() => { setPricing(null); state.reload(); }}
              />

              <DeleteProduct
                open={deleting}
                product={d.product}
                usage={d.usage}
                onClose={() => setDeleting(false)}
                onDone={(what) => {
                  setDeleting(false);
                  if (what === 'deleted') go('products'); else state.reload();
                }}
              />
            </>
          );
        }}
      </Loaded>
    </>
  );
}

/**
 * Deleting a product, or saying plainly why it cannot be.
 *
 * One that has been on an order stays - the orders still need it - and is
 * offered switching off instead, which hides it from search, new orders and
 * booking in. Anything else goes with everything booked against it, and the
 * dialog says exactly what that is before anybody presses the button.
 */
function DeleteProduct({ open, product, usage, onClose, onDone }) {
  const act = useAction();

  const garments = Number(usage?.garments ?? 0);
  const intakes = Number(usage?.intakes ?? 0);
  const orders = Number(usage?.orders ?? 0);
  const active = Number(product.active) === 1;
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (orders > 0) {
    return (
      <Modal
        open={open}
        title={`${product.sku} cannot be deleted`}
        onClose={onClose}
        footer={
          <>
            <button onClick={onClose} disabled={act.busy}>Close</button>
            {active && (
              <button
                className="primary"
                disabled={act.busy}
                onClick={async () => {
                  if (await act.run(() => api.setProductActive(product.id, 0))) onDone('switched off');
                }}
              >
                {act.busy ? 'Working…' : 'Switch it off'}
              </button>
            )}
          </>
        }
      >
        <Notice kind="error">{act.error}</Notice>
        <p>
          It is on <b>{count(orders, 'order')}</b>, and those orders — and any return against
          them — still need to know what was sold.
        </p>
        <p className="muted">
          {active
            ? 'Switching it off hides it from search, new orders and booking in. Everything already recorded stays as it is, and it can be switched back on.'
            : 'It is already switched off, so it is hidden from search, new orders and booking in.'}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={`Delete ${product.sku}?`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button
            className="danger"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => api.deleteProduct(product.id))) onDone('deleted');
            }}
          >
            {act.busy
              ? 'Working…'
              : garments > 0 ? `Delete it and its ${count(garments, 'garment')}` : 'Delete it'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>
      <p>
        <b>{product.name}</b> will be removed for good, with its colours, sizes and photos.
      </p>
      {garments > 0 && (
        <Notice kind="warn">
          <span>
            <b>{count(garments, 'tagged garment')}</b> {garments === 1 ? 'is' : 'are'} booked in
            as this product. {garments === 1 ? 'Its record goes' : 'Their records go'} too, and
            the tags become free to book in again as something else.
            {intakes > 0 && ' An intake left with nothing else on it is removed as well.'}
          </span>
        </Notice>
      )}
      <p className="muted">This cannot be undone.</p>
    </Modal>
  );
}

/**
 * The product's photos. The first is the cover - the one on the search and on
 * the handheld - and any other can be made the cover instead.
 */
function PhotoGallery({ productId, photos, isAdmin, onChanged }) {
  const act = useAction();
  const input = React.useRef(null);

  async function upload(e) {
    const files = Array.from(e.target.files ?? []);
    // Cleared straight away so choosing the same file again still fires.
    e.target.value = '';
    if (files.length === 0) return;
    await act.run(() => api.uploadPhotos(productId, files),
      (r) => `Added ${r.added} photo${r.added === 1 ? '' : 's'}.`);
    // Whatever the outcome: if a later part of a large upload failed, the
    // photos that did go up must show, or they get sent a second time.
    onChanged();
  }

  return (
    <Panel
      title="Photos"
      hint={photos.length === 0 ? 'none yet' : `${photos.length} · the first is the cover`}
      actions={isAdmin && (
        <>
          <input
            id="product-photo-upload"
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={upload}
          />
          <button className="primary" onClick={() => input.current?.click()} disabled={act.busy}>
            {act.busy ? 'Uploading…' : 'Add photos'}
          </button>
        </>
      )}
    >
      <Notice kind="error">{act.error}</Notice>
      {act.done && <Notice kind="ok">{act.done}</Notice>}

      {photos.length === 0 ? (
        <Empty title="No photos yet">
          {isAdmin
            ? 'Add a photo so this product can be recognised in the search and on the handheld.'
            : 'An admin can add photos.'}
        </Empty>
      ) : (
        <div className="gallery">
          {photos.map((ph, i) => (
            <div className="tile" key={ph.id}>
              <div style={{ position: 'relative' }}>
                <Photo url={ph.url} alt={`Photo ${i + 1}`}
                  onClick={() => window.open(ph.url, '_blank', 'noopener')} />
                {i === 0 && <span className="pill brand cover-tag">Cover</span>}
              </div>
              {isAdmin && (
                <div className="actions">
                  {i > 0 && (
                    <button className="link sm" disabled={act.busy}
                      onClick={async () => { if (await act.run(() => api.makeCover(productId, ph.id))) onChanged(); }}>
                      Make cover
                    </button>
                  )}
                  <button className="link bad sm" disabled={act.busy}
                    onClick={async () => { if (await act.run(() => api.deletePhoto(productId, ph.id))) onChanged(); }}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Colours across, sizes down. Tick what this product comes in and the grid is
 * filled in one go — six colours in five sizes is thirty rows nobody should
 * have to create one at a time.
 */
function AddVariants({ open, productId, onClose, onDone }) {
  const colors = useLoader(() => api.colors(), []);
  const sizes = useLoader(() => api.sizes(), []);
  const [pickedColors, setPickedColors] = React.useState([]);
  const [pickedSizes, setPickedSizes] = React.useState([]);
  const act = useAction();

  // From the latest selection - see NewProduct. Two quick taps otherwise lose one.
  const toggle = (set) => (id) =>
    set((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  async function save() {
    const res = await act.run(() => api.addVariants(productId, pickedColors, pickedSizes));
    if (res) {
      setPickedColors([]);
      setPickedSizes([]);
      onDone();
    }
  }

  const count = pickedColors.length * pickedSizes.length;

  return (
    <Modal
      open={open}
      title="Add colours and sizes"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy || count === 0}>
            {act.busy ? 'Adding…' : `Add ${count} combination${count === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>
      <p className="muted small">
        Every colour is paired with every size. Anything that already exists is left alone,
        so you can come back later to add one more colour.
      </p>

      <Field label="Colours">
        <div className="toggles">
          {(colors.data?.rows ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className={pickedColors.includes(c.id) ? 'on' : ''}
              onClick={() => toggle(setPickedColors)(c.id)}
            >
              <Swatch hex={c.hex} name={c.name} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Sizes">
        <div className="toggles">
          {(sizes.data?.rows ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              className={pickedSizes.includes(s.id) ? 'on' : ''}
              onClick={() => toggle(setPickedSizes)(s.id)}
            >
              {s.code}
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function EditProduct({ open, product, onClose, onDone }) {
  const [form, setForm] = React.useState(null);
  const act = useAction();

  React.useEffect(() => {
    if (open && product) {
      setForm({
        name: product.name,
        description: product.description ?? '',
        supplier: product.supplier ?? '',
        stockType: product.stock_type,
        costPrice: String(product.cost_price ?? 0),
        salePrice: String(product.sale_price ?? 0),
      });
    }
  }, [open, product]);

  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const res = await act.run(() => api.updateProduct(product.id, {
      name: form.name.trim(),
      categoryId: 0,
      description: form.description.trim() || null,
      supplier: form.supplier.trim() || null,
      stockType: form.stockType,
      costPrice: Number(form.costPrice || 0),
      salePrice: Number(form.salePrice || 0),
    }));
    if (res) onDone();
  }

  return (
    <Modal
      open={open}
      title="Edit product"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy}>
            {act.busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <Field label="Name">
        <input value={form.name} onChange={set('name')} />
      </Field>

      <Field label="Where it comes from">
        <select value={form.stockType} onChange={set('stockType')}>
          <option value="stock">We hold it in the warehouse</option>
          <option value="dropship">The supplier ships it directly</option>
        </select>
      </Field>

      <Field label="Supplier">
        <input value={form.supplier} onChange={set('supplier')} />
      </Field>

      <div className="row">
        <Field label="Cost price">
          <input type="number" min="0" step="0.01" value={form.costPrice} onChange={set('costPrice')} />
        </Field>
        <Field label="Sale price">
          <input type="number" min="0" step="0.01" value={form.salePrice} onChange={set('salePrice')} />
        </Field>
      </div>
      <p className="help faint small">
        Changing a price here does not restate what stock already on the shelves cost.
      </p>

      <Field label="Description">
        <textarea value={form.description} onChange={set('description')} />
      </Field>
    </Modal>
  );
}

function EditVariant({ variant, dropship, onClose, onDone }) {
  const [form, setForm] = React.useState(null);
  const act = useAction();

  React.useEffect(() => {
    if (variant) {
      setForm({
        costPrice: variant.cost_override ?? '',
        salePrice: variant.sale_override ?? '',
        dropshipQty: String(variant.dropship_qty ?? 0),
        reorderLevel: String(variant.reorder_level ?? 0),
        active: Number(variant.active),
      });
    }
  }, [variant]);

  if (!variant || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const res = await act.run(() => api.updateVariant(variant.id, {
      costPrice: form.costPrice === '' ? null : Number(form.costPrice),
      salePrice: form.salePrice === '' ? null : Number(form.salePrice),
      dropshipQty: Number(form.dropshipQty || 0),
      reorderLevel: Number(form.reorderLevel || 0),
      active: Number(form.active),
    }));
    if (res) onDone();
  }

  return (
    <Modal
      open={!!variant}
      title={`${variant.color_name} · ${variant.size_code}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy}>
            {act.busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <p className="muted small">
        Leave a price blank to use the product price. Fill it in only where this colour or
        size costs something different.
      </p>

      <div className="row">
        <Field label="Cost price" help="Blank = use the product's">
          <input type="number" min="0" step="0.01" value={form.costPrice} onChange={set('costPrice')}
            placeholder={String(variant.cost_price)} />
        </Field>
        <Field label="Sale price" help="Blank = use the product's">
          <input type="number" min="0" step="0.01" value={form.salePrice} onChange={set('salePrice')}
            placeholder={String(variant.sale_price)} />
        </Field>
      </div>

      {dropship ? (
        <Field label="How many the supplier can send" help="Dropship stock is a number, not tags.">
          <input type="number" min="0" value={form.dropshipQty} onChange={set('dropshipQty')} />
        </Field>
      ) : (
        <Field
          label="Warn me when fewer than this are on the shelves"
          help="It then shows under Notifications. 0 turns the warning off."
        >
          <input type="number" min="0" value={form.reorderLevel} onChange={set('reorderLevel')} />
        </Field>
      )}

      <Field label="Still sold?">
        <select value={form.active} onChange={set('active')}>
          <option value={1}>Yes</option>
          <option value={0}>No, discontinued</option>
        </select>
      </Field>
    </Modal>
  );
}
