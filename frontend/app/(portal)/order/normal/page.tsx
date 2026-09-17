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
import type {
  AddressCheckOut,
  NormalOrderIn,
  OrderCreatedOut,
  SenderProfileOut,
} from '@/lib/types.gen';

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

/** The parcel as a whole; what is inside it is the list of ItemLines. */
type Item = {
  goodsType: 'PARCEL' | 'DOCUMENT';
  actualWeight: string;
  length: string;
  width: string;
  height: string;
  chargeableOverride: string;
  customerOrderNo: string;
  remark: string;
  /** where the order came from: Website, Daraz, Amazon... */
  source: string;
};

/** The Chargeable Information section. Values are the labels on screen. */
type Charge = {
  parcelType: 'Standard';
  itemValue: string;
  cod: 'Yes' | 'No';
  codAmount: string;
  service: 'PICK UP' | 'DROP OFF';
};

const EMPTY_CHARGE: Charge = {
  parcelType: 'Standard',
  itemValue: '',
  cod: 'No',
  codAmount: '',
  service: 'PICK UP',
};

/** Figures priced by the server (POST /orders/quote); blank until priced. */
type Quote = {
  volumetric: string;
  chargeable: string;
  totalShipping: string;
  totalSst: string;
  insurance: string;
  baseShipping: string;
  baseTax: string;
  discountedShipping: string;
  discountedTax: string;
  codFee: string;
  codTax: string;
  codHandling: string;
};

const EMPTY_QUOTE: Quote = {
  volumetric: '0.00',
  chargeable: '0.00',
  totalShipping: '',
  totalSst: '',
  insurance: '',
  baseShipping: '',
  baseTax: '',
  discountedShipping: '',
  discountedTax: '',
  codFee: '',
  codTax: '',
  codHandling: '',
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

/** One product in the parcel. A parcel can hold several. */
type ItemLine = {
  goodsName: string;
  variant: string;
  quantity: number;
  /** not in stock: the supplier sends it */
  dropship: boolean;
};

const EMPTY_LINE: ItemLine = { goodsName: '', variant: '', quantity: 1, dropship: false };

/**
 * Where a drop-ship order's WhatsApp messages go, or null when no item is
 * ticked. Mirrors supplier_ships() in backend/app/core/items.py: only a PAID
 * order whose items are ALL drop-shipped goes to the supplier.
 */
function dropshipNote(lines: ItemLine[], cod: boolean): string | null {
  const named = lines.filter((line) => line.goodsName.trim() !== '');
  if (!named.some((line) => line.dropship)) return null;
  if (!named.every((line) => line.dropship)) {
    return 'Some items are in stock: this order stays in your main WhatsApp group and packing PDFs.';
  }
  if (cod) {
    return 'Cash on delivery: this order stays in your main WhatsApp group and packing PDFs.';
  }
  return 'Paid drop-ship order: it goes to the drop-ship WhatsApp group and is left out of the packing PDFs.';
}

/** orders.item_variant is VARCHAR(32); the API rejects anything longer. */
const MAX_VARIANT = 32;
/** orders.customer_order_no is VARCHAR(64); required on every order. */
const MAX_ORDER_NO = 64;

/**
 * What the label's Parcel Information will say, e.g. "Maxi Chic x2, Gown".
 * Mirrors describe() in backend/app/core/items.py: sizes are not printed
 * there, so the same product in two sizes counts together as "x2".
 */
function describeLines(lines: ItemLine[]): string {
  const merged = new Map<string, ItemLine>();
  for (const line of lines) {
    const name = line.goodsName.trim();
    if (!name) continue;
    const key = name.replace(/\s+/g, ' ').toLowerCase();
    const known = merged.get(key);
    if (known) known.quantity += line.quantity;
    else merged.set(key, { ...line, goodsName: name, variant: '' });
  }
  return [...merged.values()]
    .map((l) => (l.quantity > 1 ? `${l.goodsName} x${l.quantity}` : l.goodsName))
    .join(', ');
}

const EMPTY_ITEM: Item = {
  goodsType: 'PARCEL',
  actualWeight: '',
  length: '0',
  width: '0',
  height: '0',
  chargeableOverride: '',
  customerOrderNo: '',
  remark: '',
  source: 'Website',
};

export default function NormalOrderPage() {
  const [sender, setSender] = useState<SenderProfileOut | null>(null);
  const [senderAddress, setSenderAddress] = useState('');
  const [saveSender, setSaveSender] = useState(false);
  const [saveReceiver, setSaveReceiver] = useState(false);
  const [retain, setRetain] = useState(false);

  const [receiver, setReceiver] = useState<Receiver>(EMPTY_RECEIVER);
  // the postcode against the state and city: fills blanks, catches a mismatch
  const [addressCheck, setAddressCheck] = useState<AddressCheckOut | null>(null);
  const [item, setItem] = useState<Item>(EMPTY_ITEM);
  const [lines, setLines] = useState<ItemLine[]>([{ ...EMPTY_LINE }]);

  /* ------------------------------ smart address filling (read by the API) */
  useEffect(() => {
    const text = receiver.smart.trim();
    if (!text) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .parseAddress(text, controller.signal)
        .then((parsed) =>
          setReceiver((prev) => {
            if (prev.smart.trim() !== text) return prev;
            // a pasted address replaces the whole address, even parts it lacks
            const hasAddress = Boolean(parsed.postcode || parsed.address);
            return {
              ...prev,
              name: parsed.name || prev.name,
              phone: parsed.phone || prev.phone,
              postcode: hasAddress ? parsed.postcode : prev.postcode,
              city: hasAddress ? parsed.city : prev.city,
              state: hasAddress ? parsed.state : prev.state,
              address: hasAddress ? parsed.address : prev.address,
            };
          }),
        )
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [receiver.smart]);

  /* ------------------------- postcode check: fill state/city, or flag them */
  useEffect(() => {
    const postcode = receiver.postcode.trim();
    if (!/^\d{5}$/.test(postcode)) {
      setAddressCheck(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .checkAddress({ postcode, state: receiver.state, city: receiver.city }, controller.signal)
        .then((result) => {
          setAddressCheck(result);
          if (!result.known) return;
          setReceiver((prev) =>
            prev.postcode.trim() !== postcode
              ? prev
              : {
                  ...prev,
                  state: prev.state.trim() ? prev.state : (result.state ?? ''),
                  city: prev.city.trim() ? prev.city : (result.city ?? ''),
                },
          );
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [receiver.postcode, receiver.state, receiver.city]);

  // only the check of the postcode on screen counts, not one still on its way
  const currentCheck =
    addressCheck && addressCheck.postcode === receiver.postcode.trim() ? addressCheck : null;
  const addressMismatch =
    currentCheck && currentCheck.ok === false
      ? (currentCheck.message ?? 'Zip code does not match.')
      : null;
  // a postcode that is not on the post-office list: shown, but not blocking
  const addressNotice = currentCheck?.notice ?? null;
  const postcodeSuggestions = currentCheck?.suggestions ?? [];

  function applyPostcode(code: string) {
    setReceiver((prev) => ({ ...prev, postcode: code }));
  }

  function fixAddress() {
    if (!addressCheck) return;
    if (addressCheck.field === 'receiver_state') {
      setReceiver((prev) => ({ ...prev, state: addressCheck.state ?? prev.state }));
    } else if (addressCheck.field === 'receiver_city') {
      setReceiver((prev) => ({ ...prev, city: addressCheck.city ?? prev.city }));
    }
  }

  const updateLine = (index: number, patch: Partial<ItemLine>) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (index: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const labelText = describeLines(lines);

  const [charge, setCharge] = useState<Charge>(EMPTY_CHARGE);
  // Website, WhatsApp, Daraz, Amazon... for the Order Source list
  const [sources, setSources] = useState<string[]>([]);
  useEffect(() => {
    api
      .sources()
      .then((list) => setSources(list.map((source) => source.name)))
      .catch(() => setSources([]));
  }, []);
  const routeNote = dropshipNote(lines, charge.cod === 'Yes');
  const [quote, setQuote] = useState<Quote>(EMPTY_QUOTE);
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
  const codAmount = charge.cod === 'Yes' ? charge.codAmount.trim() || '0' : '0';
  const quoteKey = `${receiver.postcode}|${receiver.state}|${item.goodsType}|${item.actualWeight}|${item.length}|${item.width}|${item.height}|${item.chargeableOverride}|${codAmount}|${charge.itemValue}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const weight = Number(item.actualWeight);
      if (!Number.isFinite(weight) || weight <= 0) {
        setQuote(EMPTY_QUOTE);
        return;
      }
      void fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000'}/api/v1/orders/quote`, {
        method: 'POST',
        credentials: 'include',
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
          cod_amount: codAmount,
          item_value: charge.itemValue.trim() || '0',
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setQuote({
            volumetric: data.volumetric_weight,
            chargeable: data.chargeable_weight,
            totalShipping: data.total_shipping_fee,
            totalSst: data.total_sst,
            insurance: data.insurance_fee ?? '',
            baseShipping: data.base_shipping_fee,
            baseTax: data.base_price_tax,
            discountedShipping: data.discounted_shipping_fee,
            discountedTax: data.discounted_tax,
            codFee: data.cod_fee,
            codTax: data.cod_tax,
            codHandling: data.cod_handling_fee,
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
    const items = lines
      .map((line) => ({
        goods_name: line.goodsName.trim(),
        item_variant: line.variant.trim(),
        quantity: line.quantity,
        dropship: line.dropship,
      }))
      .filter((line) => line.goods_name !== '');
    const first = items[0] ?? { goods_name: '', item_variant: '', quantity: 1 };
    return {
      receiver_name: receiver.name.trim(),
      receiver_phone: receiver.phone.trim(),
      receiver_postcode: receiver.postcode.trim(),
      receiver_address: receiver.address.trim(),
      receiver_city: receiver.city.trim(),
      receiver_state: receiver.state.trim(),
      address_type: receiver.addressType,
      goods_type: item.goodsType,
      // the single-item fields describe the first line; `items` carries them all
      goods_name: first.goods_name,
      item_variant: items.length === 1 ? first.item_variant : '',
      quantity: items.reduce((total, line) => total + line.quantity, 0) || 1,
      items,
      actual_weight: item.actualWeight,
      length_cm: item.length || '0',
      width_cm: item.width || '0',
      height_cm: item.height || '0',
      chargeable_weight: item.chargeableOverride || null,
      customer_order_no: item.customerOrderNo.trim(),
      cod_amount: codAmount,
      order_value: charge.itemValue.trim() || '0',
      order_payment_type: charge.cod === 'Yes' ? 'COD' : 'PREPAID',
      service_mode: charge.service === 'DROP OFF' ? 'DROP_OFF' : 'PICK_UP',
      source: item.source,
      remark: item.remark.trim(),
    };
  }, [receiver, item, lines, charge, codAmount]);

  const receiverFilled =
    receiver.name.trim() !== '' &&
    receiver.phone.trim() !== '' &&
    /^\d{5}$/.test(receiver.postcode.trim()) &&
    receiver.address.trim().length >= 5;
  const linesFilled = lines.every(
    (line) => line.goodsName.trim() !== '' && line.variant.trim().length <= MAX_VARIANT,
  );
  // "Yes" with no amount would create a COD parcel that collects nothing
  const codFilled = charge.cod === 'No' || Number(charge.codAmount) > 0;
  const itemValueOk = charge.itemValue.trim() === '' || Number(charge.itemValue) >= 0;

  // The first thing still missing, top to bottom as the form reads - so the
  // message always names the field to fix.  null: ready to order.
  const problem = !receiverFilled
    ? 'Fill in the receiver details first.'
    : addressMismatch
      ? addressMismatch
      : !linesFilled
        ? 'Every item line needs a Goods Name - fill it in, or remove the empty line.'
        : !(Number(item.actualWeight) > 0)
          ? 'Enter the Actual Weight.'
          : item.customerOrderNo.trim() === ''
            ? 'Enter the Customer Order Number - every order needs one.'
            : !codFilled
              ? 'COD Value is Yes - enter the COD Amount to collect, or choose No.'
              : !itemValueOk
                ? 'Item Value must be a number.'
                : null;
  const formFilled = problem === null;
  const incompleteMessage = problem ?? '';

  // shown under "Payment Method" - the sender account's billing, e.g. PAYMONTHLY
  const paymentMethod = `PAY${(sender?.payment_type ?? 'MONTHLY').toUpperCase()}`;

  const totals = useMemo(() => {
    const draftWeight = formFilled ? Number(quote.chargeable) || 0 : 0;
    const draftFee = formFilled ? Number(quote.totalShipping) || 0 : 0;
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
    setAddressCheck(null);
  }
  function resetItem() {
    setItem(EMPTY_ITEM);
    setLines([{ ...EMPTY_LINE }]);
  }
  function resetCharge() {
    setCharge(EMPTY_CHARGE);
  }

  function applySmart(text: string) {
    setReceiver((prev) => ({ ...prev, smart: text }));
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
      setBanner({ kind: 'err', text: incompleteMessage });
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
      resetCharge();
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
      setBanner({ kind: 'err', text: incompleteMessage });
      return;
    }
    setList((prev) => [
      ...prev,
      {
        payload: toPayload(),
        chargeable: Number(quote.chargeable) || 0,
        fee: Number(quote.totalShipping) || 0,
      },
    ]);
    setBanner({ kind: 'ok', text: 'Parcel added to the list.' });
    resetItem();
    resetCharge();
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
                : 'border-[#fbc4c4] bg-danger-tint text-danger'
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
            <Field
              label="Receiver Postcode"
              required
              hint={addressMismatch ? 'Zip code does not match' : undefined}
            >
              <TextInput
                value={receiver.postcode}
                placeholder="Please Enter Receiver Postcode"
                maxLength={5}
                invalid={Boolean(addressMismatch)}
                onChange={(e) =>
                  setReceiver({ ...receiver, postcode: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label="State" required>
              <TextInput
                value={receiver.state}
                placeholder="Filled in from the postcode"
                invalid={Boolean(addressMismatch) && addressCheck?.field === 'receiver_state'}
                onChange={(e) => setReceiver({ ...receiver, state: e.target.value })}
              />
            </Field>
            <Field label="City">
              <TextInput
                value={receiver.city}
                placeholder="Filled in from the postcode"
                invalid={Boolean(addressMismatch) && addressCheck?.field === 'receiver_city'}
                onChange={(e) => setReceiver({ ...receiver, city: e.target.value })}
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
          {currentCheck && (addressMismatch || addressNotice) && (
            <div
              role={addressMismatch ? 'alert' : 'status'}
              className={`mx-5 mb-5 space-y-2 rounded border px-4 py-2.5 text-base ${
                addressMismatch
                  ? 'border-[#fbc4c4] bg-danger-tint text-danger'
                  : 'border-[#f5dab1] bg-[#fdf6ec] text-[#b86e00]'
              }`}
            >
              <p>{addressMismatch ?? addressNotice}</p>
              {postcodeSuggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-text-regular">
                    Correct postcode for {currentCheck.suggestions_for}:
                  </span>
                  {postcodeSuggestions.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => applyPostcode(code)}
                      title={`Use postcode ${code}`}
                      className="rounded border border-brand bg-white px-2.5 py-[1px] font-semibold text-brand hover:bg-brand-tint"
                    >
                      {code}
                    </button>
                  ))}
                  {(currentCheck.suggestions_total ?? 0) > postcodeSuggestions.length && (
                    <span className="text-mini text-text-secondary">
                      +{(currentCheck.suggestions_total ?? 0) - postcodeSuggestions.length} more
                    </span>
                  )}
                </div>
              )}
              {addressMismatch && (
                <button
                  type="button"
                  onClick={fixAddress}
                  className="text-mini text-text-regular underline hover:text-brand"
                >
                  {postcodeSuggestions.length > 0 ? 'Or keep' : 'Keep'} {currentCheck.postcode} and change
                  the {currentCheck.field === 'receiver_state' ? 'state' : 'city'} to{' '}
                  {currentCheck.field === 'receiver_state' ? currentCheck.state : currentCheck.city}
                </button>
              )}
            </div>
          )}
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
            {/* every product in this parcel, one line each */}
            <div className="col-span-4">
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_170px_124px_40px] gap-x-3">
                <label className="el-label req">Goods Name:</label>
                <label className="el-label">Size / Colour:</label>
                <label className="el-label req">Quantity:</label>
                <span />
                <span />
              </div>
              <div className="space-y-2">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_170px_124px_40px] items-center gap-x-3"
                  >
                    <TextInput
                      value={line.goodsName}
                      placeholder={
                        index === 0 ? 'Please Enter Item Name' : 'Another item in the same parcel'
                      }
                      aria-label={`Goods name, item ${index + 1}`}
                      onChange={(e) => updateLine(index, { goodsName: e.target.value })}
                    />
                    <TextInput
                      value={line.variant}
                      placeholder="e.g. Purple / L"
                      maxLength={MAX_VARIANT}
                      aria-label={`Size or colour, item ${index + 1}`}
                      onChange={(e) => updateLine(index, { variant: e.target.value })}
                    />
                    <Stepper
                      value={line.quantity}
                      onChange={(quantity) => updateLine(index, { quantity })}
                    />
                    <label
                      className="flex h-control cursor-pointer select-none items-center gap-2 whitespace-nowrap text-base text-text-primary"
                      title="Not in stock - your supplier sends it"
                    >
                      <input
                        type="checkbox"
                        checked={line.dropship}
                        aria-label={`Drop-ship, item ${index + 1}`}
                        onChange={(e) => updateLine(index, { dropship: e.target.checked })}
                        className="h-[14px] w-[14px] rounded-sm border border-line"
                      />
                      Drop-ship
                    </label>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove item ${index + 1}`}
                        title="Remove this item"
                        onClick={() => removeLine(index)}
                        className="flex h-control items-center justify-center text-text-secondary hover:text-brand"
                      >
                        <TrashIcon />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={addLine}
                  className="shrink-0 text-base text-brand hover:underline"
                >
                  + Add another item
                </button>
                {labelText && (
                  <span className="min-w-0 truncate text-base text-text-secondary" title={labelText}>
                    On the label: <span className="text-text-primary">{labelText}</span>
                  </span>
                )}
              </div>
              {routeNote && (
                <p className="mt-1 text-right text-base text-text-secondary" role="status">
                  {routeNote}
                </p>
              )}
            </div>
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
            <Field label="Customer Order Number" required>
              <TextInput
                value={item.customerOrderNo}
                placeholder="Please Enter"
                maxLength={MAX_ORDER_NO}
                onChange={(e) => setItem({ ...item, customerOrderNo: e.target.value })}
              />
            </Field>
            <Field label="Order Source" required>
              <SelectInput
                value={item.source}
                aria-label="Where the order came from"
                onChange={(e) => setItem({ ...item, source: e.target.value })}
              >
                {(sources.length ? sources : ['Website']).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Remarks information" span={2}>
              <TextInput
                value={item.remark}
                placeholder="Please Enter Remarks Information"
                onChange={(e) => setItem({ ...item, remark: e.target.value })}
              />
            </Field>
          </div>
        </section>

        {/* ------------------------------------------- chargeable ------- */}
        <section className="el-card">
          <div className="el-card-head">
            <h2 className="el-card-title">Chargeable Information</h2>
            <HeaderAction
              icon={<TrashIcon />}
              label="Clear the filled information"
              onClick={resetCharge}
            />
          </div>
          <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
            <Field label="Parcel Type" required>
              <SelectInput value={charge.parcelType} onChange={() => undefined}>
                <option value="Standard">Standard</option>
              </SelectInput>
            </Field>
            <Field label="Item Value">
              <TextInput
                value={charge.itemValue}
                placeholder="Please Enter The Value Of The Item"
                inputMode="decimal"
                invalid={!itemValueOk}
                onChange={(e) => setCharge({ ...charge, itemValue: e.target.value })}
              />
            </Field>
            <Field label="Insurance Fee">
              <TextInput disabled readOnly value={quote.insurance} />
            </Field>
            <Field label="Total SST">
              <TextInput disabled readOnly value={quote.totalSst} />
            </Field>
            <Field label="Total Shipping Fee">
              <TextInput disabled readOnly value={quote.totalShipping} />
            </Field>

            <Field label="COD Value">
              <Segmented
                options={['Yes', 'No'] as const}
                value={charge.cod}
                onChange={(cod) =>
                  setCharge({ ...charge, cod, codAmount: cod === 'No' ? '' : charge.codAmount })
                }
              />
            </Field>
            <Field label="COD Amount" required={charge.cod === 'Yes'}>
              <TextInput
                value={charge.codAmount}
                disabled={charge.cod === 'No'}
                placeholder={charge.cod === 'Yes' ? 'Please Enter The COD Amount' : ''}
                inputMode="decimal"
                invalid={charge.cod === 'Yes' && charge.codAmount !== '' && !codFilled}
                onChange={(e) => setCharge({ ...charge, codAmount: e.target.value })}
              />
            </Field>
            <Field label="COD Fee">
              <TextInput disabled readOnly value={charge.cod === 'Yes' ? quote.codFee : ''} />
            </Field>
            <Field label="COD Tax">
              <TextInput disabled readOnly value={charge.cod === 'Yes' ? quote.codTax : ''} />
            </Field>
            <Field label="COD Total Handling Fee">
              <TextInput disabled readOnly value={charge.cod === 'Yes' ? quote.codHandling : ''} />
            </Field>

            <Field label="Payment Method" required>
              <Segmented options={[paymentMethod]} value={paymentMethod} onChange={() => undefined} />
            </Field>
            <Field label="Service Type" required>
              <Segmented
                options={['PICK UP', 'DROP OFF'] as const}
                value={charge.service}
                onChange={(service) => setCharge({ ...charge, service })}
              />
            </Field>
            <Field label="Base Shipping Fee">
              <TextInput disabled readOnly value={quote.baseShipping} />
            </Field>
            <Field label="Base Price Tax">
              <TextInput disabled readOnly value={quote.baseTax} />
            </Field>
            <Field label="Discounted Shipping Fee">
              <TextInput disabled readOnly value={quote.discountedShipping} />
            </Field>

            <Field label="Discounted Tax">
              <TextInput disabled readOnly value={quote.discountedTax} />
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
                        className="text-brand hover:underline"
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
          <span className="absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
            {list.length}
          </span>
        </div>
      </div>
    </div>
  );
}
