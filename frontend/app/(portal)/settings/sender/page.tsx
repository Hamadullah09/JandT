'use client';

import { useEffect, useState } from 'react';
import { Field, TextInput } from '@/components/ui/controls';
import { ApiError, api } from '@/lib/api';
import type { SenderProfileOut } from '@/lib/types.gen';

export default function SenderProfilePage() {
  const [profile, setProfile] = useState<SenderProfileOut | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSender()
      .then(setProfile)
      .catch((e: unknown) =>
        setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'Load failed.' }),
      );
  }, []);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setBanner(null);
    try {
      const saved = await api.updateSender({
        company_name: profile.company_name,
        phone: profile.phone,
        postcode: profile.postcode,
        state: profile.state,
        address: profile.address,
        account_code: profile.account_code,
        payment_type: profile.payment_type,
        default_service: profile.default_service,
      });
      setProfile(saved);
      setBanner({
        kind: 'ok',
        text: 'Saved. Orders already created keep the sender they were created with.',
      });
    } catch (error) {
      setBanner({
        kind: 'err',
        text: error instanceof ApiError ? error.message : 'Save failed.',
      });
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<SenderProfileOut>) =>
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <div className="p-5">
      {banner && (
        <div
          className={`mb-3 rounded border px-4 py-2.5 text-base ${
            banner.kind === 'ok'
              ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
              : 'border-[#fbc4c4] bg-[#fef0f0] text-jt-red'
          }`}
        >
          {banner.text}
        </div>
      )}

      <section className="el-card">
        <div className="el-card-head">
          <h2 className="el-card-title">Sender Profile</h2>
          <span className="text-base text-text-secondary">
            Used as the sender on every order. Never read from the CSV.
          </span>
        </div>
        <div className="grid grid-cols-5 gap-x-5 gap-y-4 p-5">
          <Field label="Account Code">
            <TextInput
              value={profile?.account_code ?? ''}
              onChange={(e) => set({ account_code: e.target.value })}
            />
          </Field>
          <Field label="Company Name" required span={2}>
            <TextInput
              value={profile?.company_name ?? ''}
              onChange={(e) => set({ company_name: e.target.value })}
            />
          </Field>
          <Field label="Phone Number" required>
            <TextInput
              value={profile?.phone ?? ''}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field label="Deliverer Postcode" required>
            <TextInput
              value={profile?.postcode ?? ''}
              maxLength={5}
              onChange={(e) => set({ postcode: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="State" required span={2}>
            <TextInput
              value={profile?.state ?? ''}
              onChange={(e) => set({ state: e.target.value })}
            />
          </Field>
          <Field label="Address" required span={3}>
            <TextInput
              value={profile?.address ?? ''}
              onChange={(e) => set({ address: e.target.value })}
            />
          </Field>
          <Field label="Payment Type">
            <TextInput
              value={profile?.payment_type ?? ''}
              onChange={(e) => set({ payment_type: e.target.value })}
            />
          </Field>
          <Field label="Default Service">
            <TextInput
              value={profile?.default_service ?? ''}
              onChange={(e) => set({ default_service: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <button
            type="button"
            className="el-btn el-btn-primary px-6"
            onClick={() => void save()}
            disabled={saving || !profile}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
