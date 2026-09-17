'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { InaayaLogo, STORE_NAME } from '@/components/brand/Logo';
import { SiteHeader } from '@/components/tracking/Site';
import { FileIcon, TruckIcon, UploadIcon } from '@/components/ui/icons';

const PROMISES = [
  { icon: FileIcon, text: 'Create an order in a minute' },
  { icon: UploadIcon, text: 'Upload many orders from one CSV file' },
  { icon: TruckIcon, text: 'Follow every parcel until it is delivered' },
];

/** The login and sign-up frame: the shop on the left, the form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-brand">
      <SiteHeader announcement={`${STORE_NAME} order portal`} />
      <div className="grid flex-1 md:grid-cols-2">
        <section className="hidden flex-col items-center justify-center border-r border-[#e8e6e1] bg-brand-tint px-8 py-14 md:flex">
          <InaayaLogo size="lg" />
          <p className="mt-6 text-[15px] font-semibold uppercase tracking-[2px]">Find your style with Inaaya</p>
          <div className="mt-12 w-full max-w-[420px] border-t border-[#dcd8d0] pt-8">
            <h2 className="text-[20px] font-bold uppercase tracking-[1.5px]">Order portal</h2>
            <ul className="mt-5 space-y-4">
              {PROMISES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-4 text-[18px]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
                    <Icon className="h-6 w-6" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-[400px]">{children}</div>
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
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
      {!open && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

/** A tall input whose placeholder doubles as its label; required ones get a red asterisk. */
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
        className={`h-[58px] w-full border border-[#d6d3cc] bg-white px-4 text-[17px] text-brand outline-none transition-colors focus:border-brand focus:shadow-[0_0_0_1px_#030302] ${
          password ? 'pr-12' : ''
        }`}
      />
      {!value && (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[17px] text-[#6b6a66]">
          {required && <span className="mr-[2px] text-danger">*</span>}
          {label}
        </span>
      )}
      {password && (
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-brand"
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
      className="block h-[56px] w-full bg-brand text-[16px] font-bold uppercase tracking-[1.5px] text-white transition-colors hover:bg-[#2e2d2a] disabled:opacity-70"
    >
      {children}
    </button>
  );
}

/** A black button-style link, e.g. "Back to Login". */
export const AUTH_LINK_BUTTON =
  'inline-flex h-[52px] items-center bg-brand px-6 text-[15px] font-bold uppercase tracking-[1.5px] text-white hover:bg-[#2e2d2a]';

export function AuthMessage({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`border px-4 py-3 text-[16px] leading-6 ${
        kind === 'error'
          ? 'border-[#f3c1bd] bg-danger-tint text-danger'
          : 'border-[#c2e7b0] bg-[#f0f9eb] text-[#2f6f14]'
      }`}
    >
      {children}
    </p>
  );
}
