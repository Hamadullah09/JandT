import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, FindButton, Loaded, Modal, Money, Notice, Panel, Photo, Swatch, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * The catalogue.
 *
 * Two ways to look at it. **Photos** is the search the floor uses: each product
 * as its picture, with every colour and size under it, how many are on a shelf,
 * and a Find button that sends the handhelds after one. **Table** is the office
 * view with stock value and the products that have been switched off.
 *
 * And a third way to search: **by photo**. A customer sends a screenshot of a
 * dress and nobody knows its name - choose the picture, paste it, or drop it on
 * the page, and the products that look most like it come up as the same cards.
 */
export default function Products({ isAdmin }) {
  const [view, setView] = React.useState('photos');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [stockType, setStockType] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  // Bumped when a product is added, so the list shows it straight away - the
  // dialog can be closed or used again without opening the new product.
  const [added, setAdded] = React.useState(0);

  // Search by photo: the picture searched with (shown back as it was sent) and
  // what came back. Replaced whole on each search, so an answer that arrives
  // after a newer search started is recognised by its picture and dropped.
  const [photoQuery, setPhotoQuery] = React.useState(null);
  const photoPicker = React.useRef(null);

  const clearPhoto = React.useCallback(() => {
    setPhotoQuery((q) => {
      if (q) URL.revokeObjectURL(q.url);
      return null;
    });
  }, []);

  const searchByPhoto = React.useCallback(async (file) => {
    const url = URL.createObjectURL(file);
    setView('photos');
    setPhotoQuery((q) => {
      if (q) URL.revokeObjectURL(q.url);
      return { url, loading: true, data: null, error: null };
    });

    let result;
    try {
      result = { data: await api.searchByPhoto(file), error: null };
    } catch (err) {
      result = { data: null, error: err.message };
    }
    setPhotoQuery((q) => (q?.url === url ? { ...q, loading: false, ...result } : q));
  }, []);

  // The picture's address is only freed when the page is left with it showing.
  const shownPhoto = React.useRef(null);
  shownPhoto.current = photoQuery?.url ?? null;
  React.useEffect(() => () => {
    if (shownPhoto.current) URL.revokeObjectURL(shownPhoto.current);
  }, []);

  // A screenshot pasted anywhere on the page searches by it - the quickest way
  // from a customer's chat to the dress. Not while a dialog is open, where a
  // paste belongs to the dialog.
  React.useEffect(() => {
    function onPaste(e) {
      if (document.querySelector('dialog[open]')) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      searchByPhoto(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [searchByPhoto]);

  // Dropped on the page. A file that is not a picture is still taken from the
  // browser, which would otherwise open it in place of the dashboard.
  const carriesFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  function onDragOver(e) {
    if (e.target.closest?.('dialog') || !carriesFiles(e)) return;
    e.preventDefault();
  }
  function onDrop(e) {
    if (e.target.closest?.('dialog') || !carriesFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) searchByPhoto(file);
  }

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const cats = useLoader(() => api.categories(), []);

  return (
    <div onDragOver={onDragOver} onDrop={onDrop}>
      <div className="page-head">
        <div className="grow">
          <h1>Products</h1>
          <p>Search by name, code, colour or photo, see the picture, and find one on the shelf.</p>
        </div>
        {isAdmin && <button className="primary" onClick={() => setAdding(true)}>New product</button>}
      </div>

      <Panel>
        <div className="row filters">
          <Field label="Search">
            <input
              id="product-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                clearPhoto();
              }}
              placeholder="Name, code, category or colour…"
              autoFocus
            />
          </Field>
          <Field label="Or by photo">
            <button id="photo-search" type="button" className="photo-search-button"
              onClick={() => photoPicker.current?.click()}
              title="Choose a picture - or paste a screenshot, or drop a photo on this page">
              Search by photo
            </button>
            <input
              ref={photoPicker}
              id="photo-search-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Emptied so choosing the same picture again searches again.
                e.target.value = '';
                if (file) searchByPhoto(file);
              }}
            />
          </Field>
          <Field label="Category">
            <select id="product-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {(cats.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Kind">
            <select id="product-kind" value={stockType} onChange={(e) => setStockType(e.target.value)}>
              <option value="">Stock and dropship</option>
              <option value="stock">In the warehouse</option>
              <option value="dropship">Dropship only</option>
            </select>
          </Field>
        </div>
        <div className="tabs" style={{ marginTop: 4 }}>
          <button className={view === 'photos' ? 'on' : ''} onClick={() => setView('photos')}>Photos</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => { clearPhoto(); setView('table'); }}>Table</button>
        </div>
      </Panel>

      {photoQuery ? (
        <PhotoMatches query={photoQuery} onAnother={() => photoPicker.current?.click()} onClear={clearPhoto} />
      ) : view === 'photos' ? (
        <PhotoResults search={debounced} categoryId={categoryId} stockType={stockType} isAdmin={isAdmin} added={added} />
      ) : (
        <TableResults search={debounced} categoryId={categoryId} stockType={stockType} isAdmin={isAdmin} added={added} />
      )}

      <NewProduct
        open={adding}
        categories={cats.data?.rows ?? []}
        onClose={() => setAdding(false)}
        onCreated={() => setAdded((n) => n + 1)}
        onOpen={(id) => { setAdding(false); go('products', id); }}
      />
    </div>
  );
}

/**
 * What search by photo found: the picture searched with, then the closest
 * products as the same cards the ordinary search shows, Find buttons and all.
 *
 * It says plainly how sure it is. When the first product is well ahead of the
 * rest it is the match; when several are close it says so, because two suits
 * cut and embroidered alike can photograph alike.
 */
function PhotoMatches({ query, onAnother, onClear }) {
  const d = query.data;
  const products = d?.products ?? [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  let summary;
  if (query.loading) summary = <p className="muted">Looking for this garment…</p>;
  else if (query.error) summary = <Notice kind="error">{query.error}</Notice>;
  else if (products.length === 0) summary = <p>Nothing in the catalogue looks like this photo.</p>;
  else if (d.clearMatch) {
    summary = (
      <p>
        This looks like <b>{products[0].name}</b>.
        {products.length > 1 && ' Other products that look a little like it are after it.'}
      </p>
    );
  } else {
    summary = <p>No sure match. These look closest - check the pictures.</p>;
  }

  return (
    <>
      <Panel>
        <div className="photo-query">
          <Photo url={query.url} alt="The photo searched with" />
          <div className="grow">
            <h3>Search by photo</h3>
            {summary}
            {d?.productsWithoutPhotos > 0 && (
              <p className="small faint">
                {plural(d.productsWithoutPhotos, 'product has', 'products have')} no photo yet, so a photo
                cannot find {d.productsWithoutPhotos === 1 ? 'it' : 'them'}. Add photos on the product page.
              </p>
            )}
            {d?.photosNotReadYet > 0 && (
              <p className="small faint">
                {plural(d.photosNotReadYet, 'photo is', 'photos are')} still being prepared for search by photo.
              </p>
            )}
          </div>
          <div className="photo-query-actions">
            <button type="button" onClick={onAnother} disabled={query.loading}>Another photo</button>
            <button type="button" className="link" onClick={onClear}>Clear</button>
          </div>
        </div>
      </Panel>

      {products.length > 0 && (
        <div className="product-cards">
          {products.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              badge={i > 0
                ? { kind: 'grey', text: 'Also similar' }
                : d.clearMatch ? { kind: 'ok', text: 'Best match' } : { kind: 'info', text: 'Closest' }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The search with photos. Filtered by category and kind here rather than by
 * the server, because the search already carries both and a second request per
 * dropdown change would make the photos flicker.
 */
function PhotoResults({ search, categoryId, stockType, isAdmin, added }) {
  const state = useLoader(() => api.searchProducts(search), [search, added]);

  const shown = (state.data?.products ?? []).filter((p) =>
    (!categoryId || Number(p.category_id) === Number(categoryId))
    && (!stockType || p.stock_type === stockType));
  const pages = usePages(shown, `${search}|${categoryId}|${stockType}`);

  return (
    <Loaded
      state={state}
      empty={() => shown.length === 0 && (
        <Panel>
          <Empty title="No products here">
            {search || categoryId || stockType
              ? 'Nothing matches that search.'
              : isAdmin ? 'Add your first product to get started.' : 'An admin needs to add products first.'}
          </Empty>
        </Panel>
      )}
    >
      {() => (
        <>
          <div className="product-cards">
            {pages.rows.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          {pages.pager}
        </>
      )}
    </Loaded>
  );
}

function ProductCard({ product: p, badge }) {
  const dropship = p.stock_type === 'dropship';
  const open = () => go('products', p.id);

  return (
    <article className="product-card">
      <Photo url={p.photo_url} alt={p.name} onClick={open} />

      <div>
        <h3 onClick={open}>{p.name}</h3>
        <div className="small mono faint">{p.sku}</div>
        <div className="meta">
          {badge && <span className={`pill ${badge.kind}`}>{badge.text}</span>}
          <span className="small muted">{p.category_name}</span>
          {dropship
            ? <span className="pill info">Dropship</span>
            : <span className={`pill ${Number(p.in_stock) > 0 ? 'ok' : 'grey'}`}>{p.in_stock} in stock</span>}
          <span className="small strong"><Money value={p.sale_price} /></span>
        </div>

        {p.variants.length === 0 ? (
          <p className="small faint" style={{ marginTop: 8 }}>No colours or sizes yet.</p>
        ) : (
          <ul className="variant-rows">
            {p.variants.map((v) => (
              <li key={v.id}>
                <span className="grow" title={v.color_name}><Swatch hex={v.color_hex} name={v.color_name} /></span>
                <span className="strong size" title={v.size_code}>{v.size_code}</span>
                {dropship ? (
                  <span className="count muted" title="The supplier can send this many">{v.sellable}</span>
                ) : (
                  <>
                    <span className={`count ${Number(v.in_stock) > 0 ? 'strong' : 'faint'}`}
                      title="On a shelf">{v.in_stock}</span>
                    <FindButton variant={v} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** The office table, as it always was, with a thumbnail. Shows switched-off products too. */
function TableResults({ search, categoryId, stockType, isAdmin, added }) {
  const list = useLoader(
    () => api.products({ search, categoryId, stockType }),
    [search, categoryId, stockType, added]);
  const pages = usePages(list.data?.products, `${search}|${categoryId}|${stockType}`);

  return (
    <Panel tight>
      <Loaded
        state={list}
        empty={(d) => d.products.length === 0 && (
          <Empty title="No products here">
            {search || categoryId || stockType
              ? 'Nothing matches those filters.'
              : isAdmin
                ? 'Add your first product to get started.'
                : 'An admin needs to add products first.'}
          </Empty>
        )}
      >
        {(d) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 52 }} />
                  <th>Product</th>
                  <th>Category</th>
                  <th>Kind</th>
                  <th className="num">Colours &amp; sizes</th>
                  <th className="num">In stock</th>
                  <th className="num">Sells for</th>
                  <th className="num">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {pages.rows.map((p) => (
                  <tr key={p.id} className="pick" onClick={() => go('products', p.id)}>
                    <td><Photo url={p.photo_url} alt={p.name} style={{ width: 40 }} /></td>
                    <td>
                      <div className="strong">{p.name}</div>
                      <div className="small mono faint">{p.sku}</div>
                    </td>
                    <td className="muted">{p.category_name}</td>
                    <td>
                      {p.stock_type === 'dropship'
                        ? <span className="pill info">Dropship</span>
                        : <span className="pill brand">In warehouse</span>}
                      {Number(p.active) === 0 && <span className="pill grey"> Switched off</span>}
                    </td>
                    <td className="num">{p.variant_count}</td>
                    <td className="num">
                      {p.stock_type === 'dropship' ? (
                        <span className="muted">{p.dropship_qty} at supplier</span>
                      ) : (
                        <span className={`pill ${Number(p.in_stock) > 0 ? 'ok' : 'grey'}`}>
                          {p.in_stock}
                        </span>
                      )}
                    </td>
                    <td className="num"><Money value={p.sale_price} /></td>
                    <td className="num muted"><Money value={p.stock_value} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      {pages.pager}
    </Panel>
  );
}

const EMPTY_FORM = {
  name: '', categoryId: '', description: '', stockType: 'stock',
  supplier: '', costPrice: '', salePrice: '',
};

/**
 * A new product and what arrived of it, in one form.
 *
 * Pick the colours and sizes, type how many of each came in, and it is created
 * with an intake already open - so the garments are waiting on the C72 under
 * "Book stock in" the moment this is saved. Photos can go on in the same step.
 */
function NewProduct({ open, categories, onClose, onCreated, onOpen }) {
  const colors = useLoader(() => api.colors(), []);
  const sizes = useLoader(() => api.sizes(), []);

  const [form, setForm] = React.useState(EMPTY_FORM);
  const [pickedColors, setPickedColors] = React.useState([]);
  const [pickedSizes, setPickedSizes] = React.useState([]);
  const [qty, setQty] = React.useState({});
  const [files, setFiles] = React.useState([]);
  const [created, setCreated] = React.useState(null);
  const [photoError, setPhotoError] = React.useState(null);
  const [fileError, setFileError] = React.useState(null);
  // The dialog stays in the page when it is closed, and a file box cannot be
  // emptied from code - so it is replaced instead, or a cancelled choice would
  // still show its files the next time the dialog opens.
  const [picker, setPicker] = React.useState(0);
  const act = useAction();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, categoryId: f.categoryId || categories[0]?.id || '' }));
    }
  }, [open, categories]);

  function reset() {
    setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id ?? '' });
    setPickedColors([]);
    setPickedSizes([]);
    setQty({});
    setFiles([]);
    setFileError(null);
    setPicker((n) => n + 1);
    setCreated(null);
    setPhotoError(null);
    act.setError(null);
  }

  // Checked the moment they are chosen, so a file that is not a photo is said
  // before the product is saved rather than after.
  async function choosePhotos(input) {
    const chosen = Array.from(input.files ?? []);
    setFileError(null);
    if (chosen.length === 0) {
      setFiles([]);
      return;
    }
    try {
      setFiles(await api.checkPhotos(chosen));
    } catch (err) {
      setFiles([]);
      setFileError(err.message);
      setPicker((n) => n + 1);
    }
  }

  function close() {
    reset();
    onClose();
  }

  // From the latest selection, not the one this render saw: two quick taps
  // land before a redraw, and reading the old list made the second tap undo
  // the first - S then M left only M ticked.
  const toggle = (setList, id) =>
    setList((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  // Kept in the order the lookup lists them, not the order they were ticked,
  // so the grid reads the same way every time.
  const colorRows = (colors.data?.rows ?? []).filter((c) => pickedColors.includes(c.id));
  const sizeCols = (sizes.data?.rows ?? []).filter((s) => pickedSizes.includes(s.id));

  const key = (colorId, sizeId) => `${colorId}:${sizeId}`;
  const quantityOf = (colorId, sizeId) => {
    const n = parseInt(qty[key(colorId, sizeId)] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const total = colorRows.reduce((sum, c) =>
    sum + sizeCols.reduce((row, s) => row + quantityOf(c.id, s.id), 0), 0);
  const combinations = colorRows.length * sizeCols.length;
  const dropship = form.stockType === 'dropship';

  const ready = form.name.trim() && form.categoryId && combinations > 0;

  async function save() {
    setPhotoError(null);
    const lines = [];
    for (const c of colorRows) {
      for (const s of sizeCols) lines.push({ colorId: c.id, sizeId: s.id, quantity: quantityOf(c.id, s.id) });
    }

    const res = await act.run(() => api.createProductWithStock({
      name: form.name.trim(),
      categoryId: Number(form.categoryId),
      description: form.description.trim() || null,
      stockType: form.stockType,
      supplier: form.supplier.trim() || null,
      costPrice: Number(form.costPrice || 0),
      salePrice: Number(form.salePrice || 0),
      lines,
      roomId: null,
    }));
    if (!res) return;

    // The product exists whatever happens to the photos. If they fail, say so
    // plainly - they can be added again from the product page - rather than
    // making it look as if the product was not created.
    if (files.length > 0) {
      try {
        await api.uploadPhotos(res.id, files);
      } catch (err) {
        setPhotoError(err.message);
      }
    }

    setCreated(res);
    onCreated?.(res);
  }

  if (created) {
    return (
      <Modal
        open={open}
        title="Product added"
        onClose={close}
        footer={
          <>
            <button onClick={() => { reset(); }}>Add another</button>
            <button className="primary" onClick={() => { const id = created.id; reset(); onOpen(id); }}>
              Open the product
            </button>
          </>
        }
      >
        <Notice kind="ok">
          <span><b>{form.name.trim()}</b> is saved as <span className="mono">{created.sku}</span>, in {created.variants} colour
            and size combination{created.variants === 1 ? '' : 's'}.</span>
        </Notice>

        {created.batchNo ? (
          <Notice kind="info">
            <span>
              <b>{created.total}</b> piece{created.total === 1 ? ' is' : 's are'} waiting to be tagged on intake{' '}
              <span className="mono strong">{created.batchNo}</span>. On the C72, open <b>Book stock in</b> and
              press the trigger.
            </span>
          </Notice>
        ) : dropship ? (
          <Notice kind="info">
            <span>Dropship — nothing to tag. The supplier can send <b>{created.total}</b>.</span>
          </Notice>
        ) : (
          <Notice kind="warn">
            <span>No quantity was entered, so nothing is waiting to be tagged. Book stock in when it arrives.</span>
          </Notice>
        )}

        {photoError && (
          <Notice kind="error">
            <span>The product was saved but the photos were not: {photoError} Add them from the product page.</span>
          </Notice>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="New product"
      onClose={close}
      footer={
        <>
          <button onClick={close} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy || !ready}>
            {act.busy
              ? 'Saving…'
              : dropship || total === 0
                ? 'Save product'
                : `Save and send ${total} to the C72`}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <Field label="Name" help="What the customer sees on the order.">
        <input id="np-name" value={form.name} onChange={set('name')}
          placeholder="Silk Embroidered 3 Piece Suit" autoFocus />
      </Field>

      <div className="row">
        <Field label="Category">
          <select id="np-category" value={form.categoryId} onChange={set('categoryId')}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Where it comes from">
          <select id="np-kind" value={form.stockType} onChange={set('stockType')}>
            <option value="stock">We hold it in the warehouse</option>
            <option value="dropship">The supplier ships it directly</option>
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="Cost price" help="What you pay for one.">
          <input id="np-cost" type="number" min="0" step="0.01" value={form.costPrice} onChange={set('costPrice')} placeholder="60" />
        </Field>
        <Field label="Sale price" help="What the customer pays.">
          <input id="np-sale" type="number" min="0" step="0.01" value={form.salePrice} onChange={set('salePrice')} placeholder="99" />
        </Field>
      </div>

      <Field label="Colours">
        <div className="toggles">
          {(colors.data?.rows ?? []).map((c) => (
            <button key={c.id} type="button" className={pickedColors.includes(c.id) ? 'on' : ''}
              onClick={() => toggle(setPickedColors, c.id)}>
              <Swatch hex={c.hex} name={c.name} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Sizes">
        <div className="toggles">
          {(sizes.data?.rows ?? []).map((s) => (
            <button key={s.id} type="button" className={pickedSizes.includes(s.id) ? 'on' : ''}
              onClick={() => toggle(setPickedSizes, s.id)}>
              {s.code}
            </button>
          ))}
        </div>
      </Field>

      {combinations > 0 && (
        <Field
          label={dropship ? 'How many the supplier can send' : 'How many arrived'}
          help={dropship
            ? 'Dropship is never tagged: this is the number you can sell.'
            : 'Each piece is tagged on the C72. Leave a box empty for a colour and size that did not come.'}
        >
          <div className="table-wrap qty-grid">
            <table>
              <thead>
                <tr>
                  <th>Colour</th>
                  {sizeCols.map((s) => <th key={s.id} className="num">{s.code}</th>)}
                </tr>
              </thead>
              <tbody>
                {colorRows.map((c) => (
                  <tr key={c.id}>
                    <td><Swatch hex={c.hex} name={c.name} /></td>
                    {sizeCols.map((s) => (
                      <td key={s.id} className="num">
                        <input
                          id={`np-qty-${c.id}-${s.id}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={qty[key(c.id, s.id)] ?? ''}
                          placeholder="0"
                          onChange={(e) => setQty((q) => ({ ...q, [key(c.id, s.id)]: e.target.value }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qty-total">
            <span className="muted">Total</span>
            <b>{total}</b>
          </div>
        </Field>
      )}

      <Field label="Photos" help="Optional. JPEG, PNG or WebP, up to 10 MB each. More can be added later.">
        <div className="file-pick">
          <input
            key={picker}
            id="np-photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => choosePhotos(e.target)}
          />
          {files.length > 0 && <span className="names">{files.length} chosen</span>}
        </div>
        {fileError && <Notice kind="error">{fileError}</Notice>}
      </Field>

      <Field label="Supplier" help="Optional.">
        <input id="np-supplier" value={form.supplier} onChange={set('supplier')} />
      </Field>

      <Field label="Description" help="Shown on the handheld when a tag is scanned.">
        <textarea id="np-description" value={form.description} onChange={set('description')}
          placeholder="Ready to wear, 3 piece." />
      </Field>
    </Modal>
  );
}
