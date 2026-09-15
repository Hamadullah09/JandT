'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Checkbox,
  Field,
  HeaderAction,
  PhoneInput,
  Segmented,
  SelectInput,
  Stepper,
  TextInput,
} from '@/components/ui/controls';
import {
  ArrowRight,
  ContactIcon,
  CopyIcon,
  PasteIcon,
  TrashIcon,
} from '@/components/ui/icons';
import { ApiError, api } from '@/lib/api';
import type { NormalOrderIn, OrderCreatedOut, SenderProfileOut } from '@/lib/types.gen';

const SMART_PLACEHOLDER =
  'Example: Ramli Roslan 0123456789 No. 2, Jalan Subang Jaya, Damansara Utama, 47400 Petaling J...';
const RECEIVER_SMART_EXAMPLE =
  'F-08-07, Residensi Idaman Abadi, Persiaran Tropicana Heights, 43000 Kajang Selangor Malaysia';

type Receiver = {
  smart: string;
  name: string;
  phone: string;
  postcode: string;
  state: string;
  city: string;
  addressType: 'HOME' | 'OFFICE';
  address: string;
};

/** A parcel added to the List, with the quote it was priced at. */
type SavedParcel = { payload: NormalOrderIn; chargeable: number; fee: number };

type Item = {
  goodsType: 'PARCEL' | 'DOCUMENT';
  goodsName: string;
  variant: string;
  quantity: number;
  actualWeight: string;
  length: string;
  width: string;
  height: string;
  chargeableOverride: string;
  customerOrderNo: string;
};

const EMPTY_RECEIVER: Receiver = {
  smart: '',
  name: '',
  phone: '',
  postcode: '',
  state: '',
  city: '',
  addressType: 'HOME',
  address: '',
};

const EMPTY_ITEM: Item = {
  goodsType: 'PARCEL',
  goodsName: '',
  variant: '',
  quantity: 1,
  actualWeight: '',
  length: '0',
  width: '0',
  height: '0',
  chargeableOverride: '',
  customerOrderNo: '',
};

/** Parse a pasted "name phone address, postcode city state" blob. */
function parseSmart(text: string): Partial<Receiver> {
  const out: Partial<Receiver> = {};
  const trimmed = text.trim();
  if (!trimmed) return out;

  const phone = trimmed.match(/(?:\+?6?0)1\d[\d\s-]{6,12}/);
  if (phone) out.phone = phone[0].replace(/[\s-]/g, '');

  const postcode = trimmed.match(/\b\d{5}\b/);
  if (postcode) out.postcode = postcode[0];

  let head = trimmed;
  if (phone) head = trimmed.slice(0, phone.index ?? 0);
  const name = head.split(/[,\n]/)[0]?.trim();
  if (name && name.length <= 60 && /^[A-Za-z][A-Za-z .'-]*$/.test(name)) {
    out.name = name;
  }

  let rest = phone ? trimmed.slice((phone.index ?? 0) + phone[0].length) : trimmed;
  rest = rest.replace(/^[\s,]+/, '');
  if (postcode) {
    const tail = rest.slice((rest.indexOf(postcode[0]) ?? 0) + 5).trim();
    const words = tail.replace(/malaysia/i, '').trim().split(/\s+/).filter(Boolean);
    if (words.length) {
      out.city = words[0];
      if (words.length > 1) out.state = words.slice(1).join(' ');
    }
    const before = rest.slice(0, rest.indexOf(postcode[0])).replace(/[\s,]+$/, '');
    if (before) out.address = before;
  } else if (rest) {
    out.address = rest;
  }
  return out;
}

export default function NormalOrderPage() {
  const [sender, setSender] = useState<SenderProfileOut | null>(null);
  const [senderAddress, setSenderAddress] = useState('');
  const [saveSender, setSaveSender] = useState(false);
  const [saveReceiver, setSaveReceiver] = useState(false);
  const [retain, setRetain] = useState(false);

  const [receiver, setReceiver] = useState<Receiver>(EMPTY_RECEIVER);
  const [item, setItem] = useState<Item>(EMPTY_ITEM);

  const [quote, setQuote] = useState({ volumetric: '0.00', chargeable: '0.00', fee: '0.00' });
  const [list, setList] = useState<SavedParcel[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [created, setCreated] = useState<OrderCreatedOut[]>([]);

  useEffect(() => {
    api
      .getSender()
      .then((profile) => {
        setSender(profile);
        setSenderAddress(profile.address);
      })
      .catch((error: unknown) =>
        setBanner({
          kind: 'err',
          text: error instanceof Error ? error.message : 'Could not load the sender profile.',
        }),
      );
  }, []);

  /* ------------------------------------------------ live totals (server) */
  const quoteKey = `${receiver.postcode}|${receiver.state}|${item.goodsType}|${item.actualWeight}|${item.length}|${item.width}|${item.height}|${item.chargeableOverride}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const weight = Number(item.actualWeight);
      if (!Number.isFinite(weight) || weight <= 0) {
        setQuote({ volumetric: '0.00', chargeable: '0.00', fee: '0.00' });
        return;
      }
      void fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000'}/api/v1/orders/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiver_postcode: receiver.postcode,
          receiver_state: receiver.state,
          goods_type: item.goodsType,
          actual_weight: item.actualWeight || '0',
          length_cm: item.length || '0',
          width_cm: item.width || '0',
          height_cm: item.height || '0',
          chargeable_weight: item.chargeableOverride || null,
          cod_amount: '0',
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setQuote({
            volumetric: data.volumetric_weight,
            chargeable: data.chargeable_weight,
            fee: data.freight_fee,
          });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const toPayload = useCallback((): NormalOrderIn => {
    return {
      receiver_name: receiver.name.trim(),
      receiver_phone: receiver.phone.trim(),
      receiver_postcode: receiver.postcode.trim(),
      receiver_address: receiver.address.trim(),
      receiver_city: receiver.city.trim(),
      receiver_state: receiver.state.trim(),
      address_type: receiver.addressType,
      goods_type: item.goodsType,
      goods_name: item.goodsName.trim(),
      item_variant: item.variant.trim(),
      quantity: item.quantity,
      actual_weight: item.actualWeight,
      length_cm: item.length || '0',
      width_cm: item.width || '0',
      height_cm: item.height || '0',
      chargeable_weight: item.chargeableOverride || null,
      customer_order_no: item.customerOrderNo.trim(),
      cod_amount: '0',
      order_value: '0',
      order_payment_type: 'PREPAID',
      remark: '',
    };
  }, [receiver, item]);

  const formFilled =
    receiver.name.trim() !== '' &&
    receiver.phone.trim() !== '' &&
    /^\d{5}$/.test(receiver.postcode.trim()) &&
    receiver.address.trim().length >= 5 &&
    item.goodsName.trim() !== '' &&
    Number(item.actualWeight) > 0;

  const totals = useMemo(() => {
    const draftWeight = formFilled ? Number(quote.chargeable) || 0 : 0;
    const draftFee = formFilled ? Number(quote.fee) || 0 : 0;
    const saved = list.reduce(
      (acc, parcel) => ({
        weight: acc.weight + parcel.chargeable,
        fee: acc.fee + parcel.fee,
      }),
      { weight: 0, fee: 0 },
    );
    return {
      parcels: list.length + (formFilled ? 1 : 0),
      weight: (saved.weight + draftWeight).toFixed(2),
      fee: (saved.fee + draftFee).toFixed(2),
    };
  }, [list, formFilled, quote]);

  function resetReceiver() {
    setReceiver(EMPTY_RECEIVER);
  }
  function resetItem() {
    setItem(EMPTY_ITEM);
  }

  function applySmart(text: string) {
    setReceiver((prev) => ({ ...prev, smart: text, ...parseSmart(text) }));
  }

  async function submitOne(payload: NormalOrderIn): Promise<OrderCreatedOut> {
    return api.createOrder(payload);
  }

  async function handleOrder() {
    setBusy(true);
    setBanner(null);
    const queue = list.map((parcel) => parcel.payload);
    if (formFilled) queue.push(toPayload());
    if (queue.length === 0) {
      setBanner({ kind: 'err', text: 'Fill in the receiver and item details first.' });
      setBusy(false);
      return;
    }
    const done: OrderCreatedOut[] = [];
    try {
      for (const payload of queue) {
        done.push(await submitOne(payload));
      }
      setCreated((prev) => [...done, ...prev]);
      setBanner({
        kind: 'ok',
        text:
          done.length === 1
            ? `Order created. Tracking number ${done[0].tracking_no}.`
            : `${done.length} orders created.`,
      });
      setList([]);
      if (!retain) resetReceiver();
      resetItem();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'The order could not be created.';
      setBanner({ kind: 'err', text: message });
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    if (!formFilled) {
      setBanner({ kind: 'err', text: 'Fill in the receiver and item details first.' });
      return;
    }
    setList((prev) => [
      ...prev,
      {
        payload: toPayload(),
        chargeable: Number(quote.chargeable) || 0,
        fee: Number(quote.fee) || 0,
      },
    ]);
    setBanner({ kind: 'ok', text: 'Parcel added to the list.' });
    resetItem();
    if (!retain) resetReceiver();
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4 p-5 pb-3">
        {banner && (
          <div
            className={`rounded border px-4 py-2.5 text-base ${
              banner.kind === 'ok'
                ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
                : 'border-[#fbc4c4] bg-[#fef0f0] text-jt-red'
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* ------------------------------------------------ sender ------- */}
        <section className="el-card">
          <div className="el-card-head">
            <h2 className="el-card-title">Sender Information</h2>
            <Checkbox label="Save to address book" checked={saveSender} onChange={setSaveSender} />
          </div>
          <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
            <Field label="Smart Address Filling" span={2} suffix={<PasteIcon />}>
              <TextInput disabled placeholder={SMART_PLACEHOLDER} className="pr-8" />
            </Field>
            <Field label="Name" required>
              <TextInput disabled value={sender?.company_name ?? ''} readOnly />
            </Field>
            <Field label="Phone Number" required>
              <PhoneInput
                disabled
                value={(sender?.phone ?? '').replace(/^\+60\s*/, '')}
                readOnly
              />
            </Field>
            <Field label="Deliverer Postcode" required>
              <TextInput disabled value={sender?.postcode ?? ''} readOnly />
            </Field>
            <Field label="State" required>
              <TextInput disabled value={sender?.state ?? ''} readOnly />
            </Field>
            <Field label="Address Details" span={2}>
              <TextInput
                value={senderAddress}
                onChange={(e) => setSenderAddress(e.target.value)}
              />
            </Field>
          </div>
        </section>

        {/* ---------------------------------------------- receiver ------- */}
        <section className="el-card">
          <div className="el-card-head">
            <h2 className="el-card-title">Receiver Information</h2>
            <div className="flex items-center gap-5">
              <Checkbox
                label="Save to address book"
                checked={saveReceiver}
                onChange={setSaveReceiver}
              />
              <HeaderAction
                icon={<TrashIcon />}
                label="Clear the filled information"
                onClick={resetReceiver}
              />
              <HeaderAction
                icon={<CopyIcon />}
                label={retain ? 'Retained' : 'Not Retained'}
                onClick={() => setRetain((v) => !v)}
              />
            </div>
          </div>
          <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
            <Field label="Smart Address Filling" span={2} suffix={<PasteIcon />}>
              <TextInput
                value={receiver.smart}
                placeholder={RECEIVER_SMART_EXAMPLE}
                onChange={(e) => applySmart(e.target.value)}
                className="pr-8"
              />
            </Field>
            <Field label="Name" required suffix={<ContactIcon />}>
              <TextInput
                value={receiver.name}
                placeholder="Please Enter Receiver Name"
                onChange={(e) => setReceiver({ ...receiver, name: e.target.value })}
                className="pr-8"
              />
            </Field>
            <Field label="Phone Number" required>
              <PhoneInput
                value={receiver.phone}
                placeholder="Please Enter Phone Number"
                onChange={(e) => setReceiver({ ...receiver, phone: e.target.value })}
              />
            </Field>
            <Field label="Receiver Postcode" required>
              <TextInput
                value={receiver.postcode}
                placeholder="Please Enter Receiver Postcode"
                maxLength={5}
                onChange={(e) =>
                  setReceiver({ ...receiver, postcode: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label="State" required>
              <TextInput
                value={receiver.state}
                placeholder="Please Enter"
                onChange={(e) => setReceiver({ ...receiver, state: e.target.value })}
              />
            </Field>
            <Field label="Address type" required>
              <SelectInput
                value={receiver.addressType}
                onChange={(e) =>
                  setReceiver({ ...receiver, addressType: e.target.value as 'HOME' | 'OFFICE' })
                }
              >
                <option value="HOME">HOME</option>
                <option value="OFFICE">OFFICE</option>
              </SelectInput>
            </Field>
            <Field label="Address Details" required span={2}>
              <TextInput
                value={receiver.address}
                placeholder="Please Enter The Detailed Address"
                onChange={(e) => setReceiver({ ...receiver, address: e.target.value })}
              />
            </Field>
          </div>
        </section>

        {/* -------------------------------------------------- item ------- */}
        <section className="el-card">
          <div className="el-card-head">
            <h2 className="el-card-title">Item Information</h2>
            <HeaderAction
              icon={<TrashIcon />}
              label="Clear the filled information"
              onClick={resetItem}
            />
          </div>
          <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
            <Field label="Goods Type" required>
              <Segmented
                options={['PARCEL', 'DOCUMENT'] as const}
                value={item.goodsType}
                onChange={(goodsType) => setItem({ ...item, goodsType })}
              />
            </Field>
            <Field label="Goods Name" required>
              <TextInput
                value={item.goodsName}
                placeholder="Please Enter Item Name"
                onChange={(e) => setItem({ ...item, goodsName: e.target.value })}
              />
            </Field>
            <Field label="Quantity" required>
              <Stepper
                value={item.quantity}
                onChange={(quantity) => setItem({ ...item, quantity })}
              />
            </Field>
            <Field label="Actual Weight" required>
              <TextInput
                value={item.actualWeight}
                placeholder="Please enter the actual weight"
                inputMode="decimal"
                onChange={(e) => setItem({ ...item, actualWeight: e.target.value })}
              />
            </Field>
            <Field label="Length (cm)">
              <TextInput
                value={item.length}
                inputMode="decimal"
                onChange={(e) => setItem({ ...item, length: e.target.value })}
              />
            </Field>
            <Field label="Width (cm)">
              <TextInput
                value={item.width}
                inputMode="decimal"
                onChange={(e) => setItem({ ...item, width: e.target.value })}
              />
            </Field>
            <Field label="Height (cm)">
              <TextInput
                value={item.height}
                inputMode="decimal"
                onChange={(e) => setItem({ ...item, height: e.target.value })}
              />
            </Field>
            <Field label="Volumetric Weight（kg）">
              <TextInput disabled readOnly value={quote.volumetric} placeholder="Please Enter" />
            </Field>
            <Field label="Chargeable Weight（kg）" required>
              <TextInput
                value={item.chargeableOverride || quote.chargeable}
                placeholder="Please Enter"
                inputMode="decimal"
                onChange={(e) => setItem({ ...item, chargeableOverride: e.target.value })}
              />
            </Field>
            <Field label="Customer Order Number">
              <TextInput
                value={item.customerOrderNo}
                placeholder="Please Enter"
                onChange={(e) => setItem({ ...item, customerOrderNo: e.target.value })}
              />
            </Field>
          </div>
        </section>

        {created.length > 0 && (
          <section className="el-card">
            <div className="el-card-head">
              <h2 className="el-card-title">Created in this session</h2>
            </div>
            <table className="w-full text-base">
              <thead className="bg-surface-head text-text-regular">
                <tr>
                  {['Tracking Number', 'Sortation Code', 'Route', 'Fee', 'Waybill'].map((h) => (
                    <th key={h} className="border-b border-line-light px-3 py-2 text-left font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {created.map((row) => (
                  <tr key={row.tracking_no}>
                    <td className="border-b border-line-light px-3 py-2">{row.tracking_no}</td>
                    <td className="border-b border-line-light px-3 py-2">{row.sortation_code}</td>
                    <td className="border-b border-line-light px-3 py-2">{row.route_code}</td>
                    <td className="border-b border-line-light px-3 py-2">{row.freight_fee}</td>
                    <td className="border-b border-line-light px-3 py-2">
                      <a
                        className="text-jt-red hover:underline"
                        href={api.waybillUrl(row.tracking_no)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* --------------------------------------------- sticky footer ---- */}
      <div className="sticky bottom-0 z-10 mx-5 mb-5 flex h-[66px] items-center justify-end gap-6 rounded border border-line bg-white px-5">
        {[
          ['Total Parcel:', String(totals.parcels)],
          ['Total Weight:', totals.weight],
          ['Total Shipping Fee:', totals.fee],
        ].map(([label, value]) => (
          <div key={label} className="text-center leading-tight">
            <div className="text-base text-text-secondary">{label}</div>
            <div className="text-title font-bold text-text-primary">{value}</div>
          </div>
        ))}

        <button
          type="button"
          className="el-btn el-btn-primary px-6"
          onClick={handleOrder}
          disabled={busy}
        >
          {busy ? 'Ordering...' : 'Order'}
        </button>
        <button type="button" className="el-btn el-btn-outline px-6" onClick={handleSave}>
          Save
        </button>
        <div className="relative">
          <button type="button" className="el-btn px-5">
            List <ArrowRight />
          </button>
          <span className="absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-jt-red px-1 text-[10px] font-semibold text-white">
            {list.length}
          </span>
        </div>
      </div>
    </div>
  );
}
