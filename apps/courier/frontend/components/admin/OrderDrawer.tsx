'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrashIcon } from '@/components/ui/icons';
import { ApiError, API_BASE, WAREHOUSE_URL, api } from '@/lib/api';
import { mytDateTime, mytInputNow } from '@/lib/myt';
import type { AdminOrderDetailOut, EventTypeOut } from '@/lib/types.gen';
import { NEXT_EVENT, StatusBadge, isStatus, itemText, itemsOf } from './status';

type Form = { code: string; location: string; description: string; when: string };

function CloseIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-[7px] sm:grid-cols-[130px_minmax(0,1fr)]">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </div>
  );
}

/** One order: its details, its tracking history, and a form to add a status update. */
export function OrderDrawer({
  trackingNo,
  onClose,
  onChanged,
}: {
  trackingNo: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminOrderDetailOut | null>(null);
  const [types, setTypes] = useState<EventTypeOut[]>([]);
  const [form, setForm] = useState<Form>({ code: '', location: '', description: '', when: mytInputNow() });
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.adminOrder(trackingNo);
      setDetail(next);
      return next;
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not load the order.' });
      return null;
    }
  }, [trackingNo]);

  useEffect(() => {
    setDetail(null);
    setMessage(null);
    void load().then((next) => {
      const status = next?.order.tracking_status ?? 'CREATED';
      setForm({
        code: NEXT_EVENT[isStatus(status) ? status : 'CREATED'],
        location: '',
        description: '',
        when: mytInputNow(),
      });
      setDescriptionEdited(false);
    });
  }, [load]);

  useEffect(() => {
    api.eventTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const type = types.find((t) => t.code === form.code);
  const autoDescription = type
    ? form.location.trim()
      ? type.template.replace('{location}', form.location.trim())
      : type.without_location
    : '';
  const description = descriptionEdited ? form.description : autoDescription;

  async function save() {
    if (!form.code) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.addTrackingEvent({
        tracking_nos: [trackingNo],
        event_type: form.code,
        location: form.location.trim(),
        description: descriptionEdited ? form.description.trim() : '',
        occurred_at: form.when || null,
      });
      const next = await load();
      const status = next?.order.tracking_status ?? 'CREATED';
      setForm({
        code: NEXT_EVENT[isStatus(status) ? status : 'CREATED'],
        location: '',
        description: '',
        when: mytInputNow(),
      });
      setDescriptionEdited(false);
      setMessage({ kind: 'ok', text: `Saved: ${type?.label ?? form.code}.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'The update was not saved.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(eventId: number, label: string) {
    if (!window.confirm(`Delete the "${label}" update?`)) return;
    setBusy(true);
    try {
      await api.deleteTrackingEvent(eventId);
      await load();
      setMessage({ kind: 'ok', text: `Deleted: ${label}.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not delete it.' });
    } finally {
      setBusy(false);
    }
  }

  const order = detail?.order;
  const items = order ? itemsOf(order.items) : [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Order">
      <button type="button" aria-label="Close" className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[640px] flex-col bg-white shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b-2 border-line px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] text-text-secondary">Order</p>
            <h2 className="truncate text-[21px] font-bold text-text-primary sm:text-[24px]">
              {order?.customer_order_no || trackingNo}
            </h2>
          </div>
          {order && <StatusBadge status={order.tracking_status} />}
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-line text-text-secondary hover:border-brand hover:text-brand"
            aria-label="Close"
            title="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 text-[16px] sm:px-6">
          {message && (
            <div
              className={`rounded border px-3 py-2 ${
                message.kind === 'ok'
                  ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
                  : 'border-[#fbc4c4] bg-danger-tint text-danger'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              className="el-btn el-btn-outline h-12 text-[16px]"
              href={`/tracking/${trackingNo}`}
              target="_blank"
              rel="noreferrer"
            >
              Open tracking page
            </a>
            {order && (
              <a className="el-btn h-12 text-[16px]" href={`${API_BASE}${order.waybill_url}`} target="_blank" rel="noreferrer">
                Waybill PDF
              </a>
            )}
          </div>

          {/* Booked from a warehouse order: the same order, one click away in
              the other module, with where it stands there. */}
          {order?.warehouse_order_id != null && (
            <a
              href={`${WAREHOUSE_URL}#/orders/${order.warehouse_order_id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border-2 border-brand bg-brand-tint px-4 py-3 text-brand hover:bg-white"
            >
              <span className="text-[15px] font-semibold uppercase tracking-[1px]">Warehouse order</span>
              <span className="font-mono text-[18px] font-bold">{order.warehouse_order_no}</span>
              {order.warehouse_status && (
                <span className="rounded-full bg-white px-3 py-[2px] text-[14px] font-semibold text-text-regular">
                  {order.warehouse_status.replace(/_/g, ' ')}
                </span>
              )}
              <span className="text-[15px] sm:ml-auto">Open in warehouse ↗</span>
            </a>
          )}

          {/* ------------------------------------------------ update */}
          <section className="rounded border border-line">
            <h3 className="border-b border-line bg-surface-card px-4 py-3 text-[18px] font-bold">Change the status</h3>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="el-label req">Status</span>
                <select
                  className="el-input h-12 text-[16px]"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                >
                  {types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                      {t.status === 'IN_TRANSIT' ? ' (In Transit)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="el-label">Location</span>
                <input
                  className="el-input h-12 text-[16px]"
                  value={form.location}
                  maxLength={128}
                  placeholder="e.g. Transit Center SHAHALAM GATEWAY"
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="el-label">Description</span>
                <input
                  className="el-input h-12 text-[16px]"
                  value={description}
                  maxLength={500}
                  onChange={(e) => {
                    setDescriptionEdited(true);
                    setForm({ ...form, description: e.target.value });
                  }}
                />
                {descriptionEdited && (
                  <button
                    type="button"
                    className="mt-1 text-[14px] text-brand hover:underline"
                    onClick={() => setDescriptionEdited(false)}
                  >
                    Use the standard wording again
                  </button>
                )}
              </label>
              <label className="block">
                <span className="el-label">Date &amp; time (Malaysia)</span>
                <input
                  type="datetime-local"
                  className="el-input h-12 text-[16px]"
                  value={form.when}
                  onChange={(e) => setForm({ ...form, when: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="el-btn el-btn-primary h-12 w-full text-[17px] font-semibold"
                disabled={busy || !form.code || !detail}
                onClick={save}
              >
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </section>

          {/* ----------------------------------------------- history */}
          <section>
            <h3 className="mb-3 text-[18px] font-bold">Tracking history</h3>
            {!detail ? (
              <p className="text-text-secondary">Loading...</p>
            ) : (
              <ol className="space-y-0">
                {detail.events.map((event) => (
                  <li
                    key={`${event.id ?? 'created'}`}
                    className="relative border-l border-line pb-4 pl-4 last:pb-0"
                  >
                    <span className="absolute -left-[5px] top-[6px] h-[9px] w-[9px] rounded-full bg-brand" />
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-semibold text-brand">{event.label}</span>
                          {event.location && (
                            <span className="ml-2 text-[14px] text-text-secondary">({event.location})</span>
                          )}
                        </p>
                        <p className="text-text-primary">{event.description}</p>
                        <p className="text-[14px] text-text-secondary">{mytDateTime(event.occurred_at)}</p>
                      </div>
                      {event.id !== null && (
                        <button
                          type="button"
                          className="mt-[2px] text-text-secondary hover:text-brand"
                          title="Delete this update"
                          aria-label={`Delete ${event.label}`}
                          disabled={busy}
                          onClick={() => remove(event.id as number, event.label)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ------------------------------------------------ details */}
          {order && (
            <section>
              <h3 className="mb-2 text-[18px] font-bold">Order details</h3>
              <dl>
                <Row label="Tracking No.">{order.tracking_no}</Row>
                <Row label="Created">{mytDateTime(order.created_at)}</Row>
                <Row label="Receiver">
                  {order.receiver_name}
                  <br />
                  <span className="text-text-regular">{order.receiver_phone}</span>
                </Row>
                <Row label="Address">
                  {order.receiver_address}, {order.receiver_postcode} {order.receiver_city ?? ''},{' '}
                  {order.receiver_state}
                </Row>
                <Row label="Items">
                  {items.map((item, index) => (
                    <span key={index} className="block">
                      {itemText(item)}
                      {item.dropship && (
                        <span className="ml-2 rounded bg-[#fdf6ec] px-1.5 text-[14px] text-[#b86e00]">
                          drop-ship
                        </span>
                      )}
                    </span>
                  ))}
                </Row>
                <Row label="Payment">
                  {order.order_payment_type === 'COD' ? `COD - collect RM ${order.cod_amount}` : 'Paid'}
                  {order.supplier_ships && (
                    <span className="ml-2 text-[14px] text-[#b86e00]">your supplier ships it</span>
                  )}
                </Row>
                <Row label="Shipping fee">{order.freight_fee ? `RM ${order.freight_fee}` : '-'}</Row>
                <Row label="Weight">{order.chargeable_weight} kg</Row>
              </dl>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
