'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown } from '@/components/ui/icons';

/* ------------------------------------------------------------------ field */
export function Field({
  label,
  required,
  span = 1,
  suffix,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  /** Columns occupied in the 5-column form grid. */
  span?: 1 | 2 | 3;
  suffix?: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  const spanClass =
    span === 3 ? 'col-span-3' : span === 2 ? 'col-span-2' : 'col-span-1';
  return (
    <div className={spanClass}>
      <label className={`el-label ${required ? 'req' : ''}`}>{label}:</label>
      <div className="relative">
        {children}
        {suffix && (
          <span className="absolute right-[10px] top-1/2 -translate-y-1/2 text-text-secondary">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-mini text-jt-red">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ input */
export function TextInput({
  invalid,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={`el-input ${invalid ? 'border-jt-red' : ''} ${className}`}
    />
  );
}

/** Phone control with the fixed `+ 60` country chip from the screenshots. */
export function PhoneInput({
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <div className="flex">
      <span
        className={`flex h-control w-[52px] shrink-0 items-center justify-center rounded-l border border-r-0 border-line text-base ${
          rest.disabled ? 'bg-[#f5f7fa] text-text-secondary' : 'bg-[#f5f7fa] text-text-regular'
        }`}
      >
        + 60
      </span>
      <input
        {...rest}
        className={`el-input rounded-l-none ${invalid ? 'border-jt-red' : ''}`}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- select */
export function SelectInput({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className="el-input appearance-none pr-8">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 text-text-secondary" />
    </div>
  );
}

/* ---------------------------------------------------------------- stepper */
export function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
}) {
  const step = (delta: number) => onChange(Math.max(min, value + delta));
  return (
    <div className="flex h-control w-full overflow-hidden rounded border border-line">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => step(-1)}
        className="w-9 shrink-0 border-r border-line bg-[#f5f7fa] text-base text-text-regular hover:text-jt-red"
      >
        &minus;
      </button>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full min-w-0 text-center text-base text-text-primary outline-none"
      />
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => step(1)}
        className="w-9 shrink-0 border-l border-line bg-[#f5f7fa] text-base text-text-regular hover:text-jt-red"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- segmented */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`h-control flex-1 rounded border text-base transition-colors ${
              active
                ? 'border-jt-red bg-white font-medium text-jt-red'
                : 'border-line bg-white text-text-primary hover:border-jt-red hover:text-jt-red'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- checkbox */
export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-base text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[14px] w-[14px] rounded-sm border border-line"
      />
      {label}
    </label>
  );
}

/** Small grey text-button used in the card headers. */
export function HeaderAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-base text-text-regular hover:text-jt-red"
    >
      {icon}
      {label}
    </button>
  );
}
