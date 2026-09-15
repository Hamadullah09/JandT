'use client';

import { useState } from 'react';
import { Field, PhoneInput, TextInput } from '@/components/ui/controls';
import { ApiError, api } from '@/lib/api';
import type { OrderCreatedOut } from '@/lib/types.gen';

const EMPTY = {
  name: '',
  phone: '',
  postcode: '',
  address: '',
  goods: '',
  weight: '',
  orderNo: '',
};

/** A pared-down single-order form: the fields an order actually needs. */
export default function QuickOrderPage() {
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderCreatedOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.createOrder({
          receiver_name: form.name.trim(),
          receiver_phone: form.phone.trim(),
          receiver_postcode: form.postcode.trim(),
          receiver_address: form.address.trim(),
          goods_name: form.goods.trim(),
          actual_weight: form.weight,
          customer_order_no: form.orderNo.trim(),
        }),
      );
      setForm({ ...EMPTY });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The order could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      {error && (
        <div className="mb-3 rounded border border-[#fbc4c4] bg-[#fef0f0] px-4 py-2.5 text-base text-jt-red">
          {error}
        </div>
      )}
      {result && (
        <div className="mb-3 rounded border border-[#c2e7b0] bg-[#f0f9eb] px-4 py-2.5 text-base text-[#529b2e]">
          Created {result.tracking_no} ({result.sortation_code} / {result.route_code}).{' '}
          <a
            className="text-jt-red hover:underline"
            href={api.waybillUrl(result.tracking_no)}
            target="_blank"
            rel="noreferrer"
          >
            Open the waybill
          </a>
        </div>
      )}

      <section className="el-card">
        <div className="el-card-head">
          <h2 className="el-card-title">Quick Order</h2>
          <span className="text-base text-text-secondary">
            Sender, sortation and pricing are filled in automatically.
          </span>
        </div>
        <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
          <Field label="Name" required>
            <TextInput
              value={form.name}
              placeholder="Please Enter Receiver Name"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Phone Number" required>
            <PhoneInput
              value={form.phone}
              placeholder="Please Enter Phone Number"
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field label="Receiver Postcode" required>
            <TextInput
              value={form.postcode}
              maxLength={5}
              placeholder="Please Enter Receiver Postcode"
              onChange={(e) => set({ postcode: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="Address Details" required span={2}>
            <TextInput
              value={form.address}
              placeholder="Please Enter The Detailed Address"
              onChange={(e) => set({ address: e.target.value })}
            />
          </Field>
          <Field label="Goods Name" required span={2}>
            <TextInput
              value={form.goods}
              placeholder="Please Enter Item Name"
              onChange={(e) => set({ goods: e.target.value })}
            />
          </Field>
          <Field label="Actual Weight" required>
            <TextInput
              value={form.weight}
              inputMode="decimal"
              placeholder="kg"
              onChange={(e) => set({ weight: e.target.value })}
            />
          </Field>
          <Field label="Customer Order Number">
            <TextInput
              value={form.orderNo}
              placeholder="Please Enter"
              onChange={(e) => set({ orderNo: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <button
            type="button"
            className="el-btn el-btn-primary px-6"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Ordering...' : 'Order'}
          </button>
        </div>
      </section>
    </div>
  );
}
