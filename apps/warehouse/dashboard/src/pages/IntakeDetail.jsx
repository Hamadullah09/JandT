import React from 'react';
import { api } from '../api.js';
import { go } from '../App.jsx';
import {
  Confirm, Empty, GarmentName, Loaded, Notice, Panel, ScanBox, ScanLog, Status, Swatch, When,
  useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Tagging a delivery.
 *
 * One line is selected and every tag scanned goes onto it, counting down, until
 * the line is full. That is the whole interaction, and it is built around a
 * person holding a reader in one hand: the tag box keeps the focus, the count
 * is the biggest thing on the screen, and the last scan is echoed back so they
 * can see it took without looking away.
 *
 * A full line stops there. The next line is a different pile - Beige Large
 * after Beige Small - so scanning goes on only when somebody presses Start for
 * it, the same as the trigger does on the C72. Carrying straight on put
 * whatever was read next onto a colour and size it was not.
 */
export default function IntakeDetail({ id }) {
  const state = useLoader(() => api.batch(id), [id]);
  const [lineId, setLineId] = React.useState(null);
  const [log, setLog] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [finishing, setFinishing] = React.useState(false);
  const act = useAction();

  const data = state.data;
  const lines = data?.lines ?? [];
  const linePages = usePages(lines, id);
  const itemPages = usePages(data?.items, id);
  const open = data?.batch?.status === 'open';

  // Land on whichever line still needs tags, so the common case — one line —
  // needs no choosing at all.
  React.useEffect(() => {
    if (lineId || lines.length === 0) return;
    const next = lines.find((l) => Number(l.remaining) > 0) ?? lines[0];
    setLineId(next.id);
  }, [lines, lineId]);

  const line = lines.find((l) => l.id === lineId);

  // The next line down with garments left, wrapping round to one skipped
  // earlier, and what to call it: the colour and size, and the garment too
  // when the delivery has more than one.
  const at = lines.findIndex((l) => l.id === lineId);
  const next = [...lines.slice(at + 1), ...lines.slice(0, at + 1)].find((l) => Number(l.remaining) > 0);
  const manyGarments = new Set(lines.map((l) => l.product_name)).size > 1;
  const nameOf = (l) => `${manyGarments ? `${l.product_name}, ` : ''}${l.color_name} ${l.size_code}`;

  async function scan(epc) {
    setBusy(true);
    try {
      const res = await api.assignTag(id, { epc, batchLineId: lineId });
      setLog((l) => [{
        key: `${epc}-${Date.now()}`,
        epc,
        tone: 'ok',
        message: res.remaining === 0
          ? 'Tagged. That line is done.'
          : `Tagged. ${res.remaining} of ${res.quantity} still to go.`,
        undo: res.itemId,
      }, ...l].slice(0, 60));
      state.reload();
    } catch (err) {
      setLog((l) => [{
        key: `${epc}-${Date.now()}`,
        epc,
        tone: 'bad',
        message: err.message,
      }, ...l].slice(0, 60));
    } finally {
      setBusy(false);
    }
  }

  async function undo(entry) {
    try {
      await api.unassignTag(id, entry.undo);
      setLog((l) => l.map((e) => e.key === entry.key
        ? { ...e, tone: 'warn', message: 'Undone — that tag is free again.', undo: null }
        : e));
      state.reload();
    } catch (err) {
      setLog((l) => [{
        key: `undo-${Date.now()}`, epc: entry.epc, tone: 'bad', message: err.message,
      }, ...l]);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <button className="link" onClick={() => go('intake')}>← All intakes</button>
          <h1>{data?.batch?.batch_no ?? 'Intake'}</h1>
          <p>
            {data?.batch?.supplier && <>{data.batch.supplier} · </>}
            {data?.batch?.room_code && <>into {data.batch.room_code} · </>}
            started <When value={data?.batch?.created_at} />
          </p>
        </div>
        {data && <Status value={data.batch.status} />}
        {open && (
          <button className="go" onClick={() => setFinishing(true)}>Finish this intake</button>
        )}
      </div>

      <Loaded state={state}>
        {(d) => {
          const expected = d.lines.reduce((n, l) => n + Number(l.quantity), 0);
          const assigned = d.lines.reduce((n, l) => n + Number(l.assigned), 0);

          return (
            <>
              {!open && (
                <Notice kind="info">
                  This intake is finished. {assigned} of {expected} garments were tagged.
                </Notice>
              )}

              {open && (
                <div className="grid two">
                  <Panel title="Scan a tag onto the selected line">
                    {!line ? (
                      <Empty title="Nothing to tag">This intake has no lines.</Empty>
                    ) : Number(line.remaining) <= 0 ? (
                      <>
                        <Notice kind="ok">
                          <span>
                            <b>{nameOf(line)}</b> is done — all {line.quantity} tagged.
                            {next
                              ? ' Put them aside and bring the next garments.'
                              : ' Every line is tagged, so the intake can be finished.'}
                          </span>
                        </Notice>
                        {next && (
                          <button className="primary" onClick={() => setLineId(next.id)}>
                            Start {nameOf(next)} — {next.remaining} to tag
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                          <div>
                            <div className={`countdown${Number(line.remaining) === 0 ? ' done' : ''}`}>
                              {line.remaining}
                            </div>
                            <div className="small muted">still to tag</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <GarmentName row={line} />
                            <div className="progress">
                              <div style={{ width: `${(Number(line.assigned) / Number(line.quantity)) * 100}%` }} />
                            </div>
                            <div className="small faint" style={{ marginTop: 4 }}>
                              {line.assigned} of {line.quantity} done
                            </div>
                          </div>
                        </div>

                        <ScanBox
                          onScan={scan}
                          busy={busy}
                          label="Tag it"
                          hint="A USB reader types the code and presses Enter for you. The box stays focused, so you can keep scanning."
                        />
                      </>
                    )}
                  </Panel>

                  <Panel title="What just happened" tight hint={log.length ? `${log.length} scans` : undefined}>
                    {log.length === 0
                      ? <Empty title="Nothing scanned yet">Scans appear here as you go.</Empty>
                      : <ScanLog entries={log} onUndo={undo} />}
                  </Panel>
                </div>
              )}

              <Panel
                title="What is in this delivery"
                hint={`${assigned} of ${expected} tagged`}
                tight
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Garment</th>
                        <th className="num">Expected</th>
                        <th className="num">Tagged</th>
                        <th className="num">Left</th>
                        <th>Progress</th>
                        {open && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {linePages.rows.map((l) => {
                        const pct = (Number(l.assigned) / Number(l.quantity)) * 100;
                        const done = Number(l.remaining) <= 0;
                        return (
                          <tr
                            key={l.id}
                            className={open ? 'pick' : undefined}
                            onClick={open ? () => setLineId(l.id) : undefined}
                            style={l.id === lineId && open
                              ? { background: 'var(--brand-tint)' }
                              : undefined}
                          >
                            <td><GarmentName row={l} /></td>
                            <td className="num">{l.quantity}</td>
                            <td className="num strong">{l.assigned}</td>
                            <td className="num">
                              <span className={`pill ${done ? 'ok' : 'warn'}`}>{l.remaining}</span>
                            </td>
                            <td style={{ width: '22%', minWidth: 100 }}>
                              <div className={`progress${done ? ' done' : ''}`}>
                                <div style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                            {open && (
                              <td className="tight">
                                {l.id === lineId
                                  ? <span className="pill brand">Scanning this</span>
                                  : <button className="link sm">Scan this</button>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {linePages.pager}
              </Panel>

              <Panel title="Garments tagged on this intake" hint={`${d.items.length}`} tight>
                {d.items.length === 0 ? (
                  <Empty title="No tags yet">Scan the first garment above.</Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tag</th>
                          <th>Garment</th>
                          <th>Tagged</th>
                          <th>By</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemPages.rows.map((i) => (
                          <tr key={i.id}>
                            <td className="mono">{i.epc}</td>
                            <td>
                              <span className="strong">{i.product_name}</span>{' '}
                              <span className="muted small">
                                <Swatch hex={i.color_hex} name={i.color_name} /> {i.size_code}
                              </span>
                            </td>
                            <td className="muted small"><When value={i.enrolled_at} /></td>
                            <td className="muted small">{i.enrolled_by_name ?? '—'}</td>
                            <td><Status value={i.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {itemPages.pager}
              </Panel>

              <Confirm
                open={finishing}
                title="Finish this intake?"
                busy={act.busy}
                confirmLabel="Finish it"
                body={
                  assigned < expected ? (
                    <>
                      <Notice kind="warn">
                        <span>
                          <b>{expected - assigned}</b> garment{expected - assigned === 1 ? '' : 's'} never
                          got a tag.
                        </span>
                      </Notice>
                      <p className="muted">
                        Finishing anyway is fine — a delivery that arrives short is a real thing,
                        and the shortfall stays on the record. You will not be able to add more
                        tags to this intake afterwards.
                      </p>
                    </>
                  ) : (
                    <p>All {expected} garments are tagged and on the shelves. Nothing more to do.</p>
                  )
                }
                onClose={() => setFinishing(false)}
                onConfirm={async () => {
                  const res = await act.run(() => api.completeBatch(id));
                  if (res) { setFinishing(false); state.reload(); }
                }}
              />
            </>
          );
        }}
      </Loaded>
    </>
  );
}
