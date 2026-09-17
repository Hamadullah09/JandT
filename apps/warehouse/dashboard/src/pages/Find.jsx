import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Empty, Field, Loaded, Notice, Panel, Status, Swatch, When, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Which set a find belongs to - the same sets the C72 shows.
 *
 * "Find" beside a colour and size puts every one of them on the list as one
 * hunt, and finding or stopping any one of them ends it: that is a set. A find
 * with no hunt joins the others of its colour and size in the same state, and a
 * tag nobody knows is a set of its own.
 */
const setKeyOf = (r) => (r.group_key ? `hunt:${r.group_key}` : r.sku ? `code:${r.sku}:${r.status}` : `tag:${r.id}`);

/**
 * Find a garment.
 *
 * Somebody needs one particular thing and the shelf it should be on is empty.
 * Putting it on this list pushes it to every handheld, where the reader becomes
 * a hot-and-cold finder that gets louder as the operator closes in, and the
 * radar screen shows which way to turn for several at once.
 *
 * Either identifier will do — a tag code, a product code, or an order number.
 * Nobody should have to look up a hex string to report something missing.
 */
export default function Find() {
  const [showAll, setShowAll] = React.useState(false);
  const [text, setText] = React.useState('');
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState(null);
  const act = useAction();

  const list = useLoader(() => api.findRequests(showAll ? 'all' : 'open'), [showAll]);
  const rows = list.data?.requests ?? [];
  const open = rows.filter((r) => r.status === 'open');

  // One row per set, as on the C72: six of one colour and size put on the list
  // by "Find" are one thing to go and get, and were six rows - twelve with two
  // of them - that buried everything else on the list.
  const sets = React.useMemo(() => {
    const byKey = new Map();
    for (const r of rows) {
      const key = setKeyOf(r);
      if (!byKey.has(key)) byKey.set(key, { key, pieces: [] });
      byKey.get(key).pieces.push(r);
    }
    return [...byKey.values()];
  }, [rows]);
  const openSets = sets.filter((s) => s.pieces.some((p) => p.status === 'open')).length;
  const pages = usePages(sets, showAll ? 'all' : 'open');

  // The sets whose tags are opened out under their row.
  const [opened, setOpened] = React.useState(() => new Set());
  const toggle = (key) => setOpened((before) => {
    const next = new Set(before);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  async function found(piece) {
    await act.run(() => api.markFound(piece.id, null));
    list.reload();
  }

  // Stopping one piece of a hunt stops the whole hunt on the server; finds that
  // were put on separately are stopped one by one.
  async function stop(set) {
    const openPieces = set.pieces.filter((p) => p.status === 'open');
    const targets = set.pieces[0].group_key ? openPieces.slice(0, 1) : openPieces;
    await act.run(async () => {
      for (const piece of targets) await api.cancelFind(piece.id);
    });
    list.reload();
  }

  async function add(e) {
    e.preventDefault();
    setResult(null);

    // Sent as both: the server tries a tag code first and falls back to
    // searching, so the person typing never has to say which one they have.
    const res = await act.run(() => api.createFind({
      epc: text.trim() || null,
      search: text.trim() || null,
      note: note.trim() || null,
    }));

    if (res) {
      setResult(res);
      setText('');
      setNote('');
      list.reload();
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Find a garment</h1>
          <p>Send it to every handheld and let the reader hunt it down.</p>
        </div>
      </div>

      <div className="grid two">
        <Panel title="Put something on the list">
          <form onSubmit={add}>
            <Field
              label="What are you looking for?"
              help="A tag code, a product code, or an order number. Several at once, separated by commas or new lines."
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'E28011700000020000000001\nSHALWAR-0001-NAVY-M\nSO-20260914-0007'}
                style={{ minHeight: 90, fontFamily: 'Consolas, monospace' }}
              />
            </Field>

            <Field label="Why" help="Optional. The operator sees this on the handheld.">
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Customer says it never arrived" />
            </Field>

            <Notice kind="error">{act.error}</Notice>

            {result && (
              <Notice kind={result.skippedCount > 0 ? 'warn' : 'ok'}>
                <span>
                  Added <b>{result.addedCount}</b>.
                  {result.skippedCount > 0 && (
                    <> Skipped {result.skippedCount}: {result.skipped.map((s) => s.reason).join(' ')}</>
                  )}
                </span>
              </Notice>
            )}

            <button className="primary" type="submit" disabled={act.busy || !text.trim()}>
              {act.busy ? 'Adding…' : 'Send to the handhelds'}
            </button>
          </form>
        </Panel>

        <Panel title="How this works">
          <p className="muted">
            Every handheld picks this list up. On the device, the reader stops counting stock and
            starts hunting: a bar that fills as the operator gets closer, and a beep that quickens.
          </p>
          <p className="muted">
            The radar screen follows up to five at once. It cannot measure direction — no UHF
            reader can — so it remembers which way the reader was pointing when each tag answered
            loudest. That is why the operator has to turn on the spot once to fill it in.
          </p>
          <p className="muted">
            When the operator presses <b>Got it</b>, the garment drops off every other handheld,
            so two people never hunt the same thing.
          </p>
        </Panel>
      </div>

      <Panel
        title={showAll ? 'Everything' : 'Being looked for now'}
        hint={`${openSets} to find · ${open.length} tag${open.length === 1 ? '' : 's'}`}
        actions={
          <div className="tabs">
            <button className={!showAll ? 'on' : ''} onClick={() => setShowAll(false)}>Open</button>
            <button className={showAll ? 'on' : ''} onClick={() => setShowAll(true)}>Everything</button>
          </div>
        }
        tight
      >
        <Loaded
          state={list}
          empty={(d) => d.requests.length === 0 && (
            <Empty title="Nothing is being looked for">
              That is the state you want. Add something above when a garment goes missing.
            </Empty>
          )}
        >
          {() => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Garment</th>
                    <th>Tags</th>
                    <th>Last seen</th>
                    <th>Added</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((set) => {
                    const first = set.pieces[0];
                    const count = set.pieces.length;
                    const hunt = !!first.group_key;
                    const openPieces = set.pieces.filter((p) => p.status === 'open');
                    const foundPiece = set.pieces.find((p) => p.status === 'found');
                    const rooms = [...new Set(set.pieces.map((p) => p.last_room_code).filter(Boolean))];
                    const isOpened = opened.has(set.key);

                    return (
                      <React.Fragment key={set.key}>
                        <tr>
                          <td>
                            {first.product_name ? (
                              <>
                                <div className="strong">{first.product_name}</div>
                                <div className="small muted">
                                  <Swatch hex={first.color_hex} name={first.color_name} /> {first.size_code}
                                  {first.sku && <> · <span className="mono">{first.sku}</span></>}
                                </div>
                                {count > 1 && (
                                  <span
                                    className="pill info"
                                    title={hunt ? 'Finding or stopping any one of these ends the hunt for all of them' : undefined}
                                  >
                                    {count} pieces{hunt ? ' · any one will do' : ''}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="faint">Not a tag we know</span>
                            )}
                          </td>
                          <td>
                            {count === 1 ? (
                              <span className="mono">{first.epc}</span>
                            ) : (
                              <button className="link sm" aria-expanded={isOpened} onClick={() => toggle(set.key)}>
                                {isOpened ? 'Hide the tags' : `Show the ${count} tags`}
                              </button>
                            )}
                          </td>
                          <td>
                            {foundPiece?.found_room_code ? (
                              <span className="pill ok">Found in {foundPiece.found_room_code}</span>
                            ) : rooms.length > 0 ? (
                              rooms.map((room) => <span key={room} className="pill grey">{room}</span>)
                            ) : <span className="faint">—</span>}
                          </td>
                          <td className="muted small">
                            <When value={first.created_at} />
                            {first.created_by_name && <div className="faint">{first.created_by_name}</div>}
                          </td>
                          <td>
                            <Status value={openPieces.length > 0 ? 'open' : foundPiece ? 'found' : first.status} />
                            {openPieces.length === 0 && foundPiece?.found_by_name && (
                              <div className="small faint">by {foundPiece.found_by_name}</div>
                            )}
                          </td>
                          <td className="tight">
                            {openPieces.length > 0 && (
                              <>
                                {count === 1 && first.item_id && (
                                  <button className="link sm" onClick={() => go('stock', first.item_id)}>Open</button>
                                )}
                                {count === 1 && (
                                  <button className="link sm" onClick={() => found(first)}>Found it</button>
                                )}
                                <button className="link bad sm" onClick={() => stop(set)}>Stop looking</button>
                              </>
                            )}
                          </td>
                        </tr>

                        {isOpened && count > 1 && (
                          <tr className="set-pieces">
                            <td colSpan={6}>
                              {hunt && openPieces.length > 0 && (
                                <p className="small muted">
                                  Press <b>Found it</b> on the one that turned up - the rest come off every handheld.
                                </p>
                              )}
                              {set.pieces.map((piece) => (
                                <div className="piece" key={piece.id}>
                                  <span className="mono">{piece.epc}</span>
                                  {piece.last_room_code && <span className="pill grey">{piece.last_room_code}</span>}
                                  {piece.item_status && <Status value={piece.item_status} />}
                                  {/* Only a piece that is no longer being looked for says so: "Open" on
                                      every line beside an "Open" link read as the same word twice. */}
                                  {piece.status !== 'open' && <Status value={piece.status} />}
                                  {piece.status === 'open' && (
                                    <>
                                      {piece.item_id && (
                                        <button className="link sm" onClick={() => go('stock', piece.item_id)}>Garment</button>
                                      )}
                                      <button className="link sm" onClick={() => found(piece)}>Found it</button>
                                    </>
                                  )}
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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
