'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { SITE_RED, SiteHeader } from '@/components/tracking/Site';
import { Trucks } from './Trucks';

/** jtexpress.my/login: the brand on the left, the form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col bg-white text-[#333]"
      style={{ fontFamily: "Nunito, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}
    >
      <SiteHeader />
      <div className="grid flex-1 md:grid-cols-2">
        <section className="hidden flex-col items-center border-r border-[#e6e6e6] bg-[#fafafb] px-8 pb-10 pt-16 md:flex">
          <div className="flex select-none flex-col items-center" style={{ color: SITE_RED }}>
            <div className="flex items-end">
              <span
                className="text-[88px] font-black italic leading-none tracking-[-0.06em]"
                style={{ fontFamily: 'Arial Black, Arial, sans-serif' }}
              >
                J&amp;T
              </span>
              <span className="mb-[6px] ml-1 text-[34px] font-extrabold italic leading-none">EXPRESS</span>
            </div>
            <p className="mt-3 text-[26px] font-bold italic">
              <span className="mr-2">—</span>Express Your Online Business<span className="ml-2">—</span>
            </p>
          </div>
          <Trucks className="mt-12 w-full max-w-[560px]" />
        </section>
        <section className="flex items-center justify-center bg-[#f8f9fa] px-5 py-12">
          <div className="w-full max-w-[300px]">{children}</div>
        </section>
      </div>
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
        stroke="#333"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="12" cy="12" r="3.2" stroke="#333" strokeWidth="1.6" fill="none" />
      {!open && <path d="M4 20 20 4" stroke="#333" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

/** A tall input whose placeholder carries J&T's red asterisk. */
export function AuthInput({
  label,
  required = true,
  type = 'text',
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const password = type === 'password';
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input
        {...rest}
        type={password && shown ? 'text' : type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-[58px] w-full rounded-[2px] border border-[#dcdfe6] bg-white px-3 text-[15px] text-[#333] outline-none transition-colors focus:border-[#e60012] ${
          password ? 'pr-12' : ''
        }`}
      />
      {!value && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[#333]">
          {required && <span style={{ color: SITE_RED }}>*</span>}
          {label}
        </span>
      )}
      {password && (
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2"
        >
          <EyeIcon open={shown} />
        </button>
      )}
    </label>
  );
}

export function AuthButton({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mx-auto block min-w-[62px] rounded-[3px] px-3 py-[8px] text-[15px] text-white disabled:opacity-70"
      style={{ background: SITE_RED }}
    >
      {children}
    </button>
  );
}

export function AuthMessage({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-[2px] border px-3 py-2 text-[13px] ${
        kind === 'error'
          ? 'border-[#fbc4c4] bg-[#fef0f0] text-[#e60012]'
          : 'border-[#c2e7b0] bg-[#f0f9eb] text-[#3f8f1f]'
      }`}
    >
      {children}
    </p>
  );
}
