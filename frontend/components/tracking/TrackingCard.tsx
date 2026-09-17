'use client';

import { useState } from 'react';
import type { TrackingOut } from '@/lib/types.gen';
import { CashIcon, DuitNowIcon, EWalletIcon, STAGE_ICONS } from './icons';
import { SITE_RED } from './Site';

/** Events shown before "See More", as jtexpress.my folds a long history. */
const FOLDED = 4;
const GREEN = '#27c93f';

function ArrowRightWhite() {
  return (
    <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden>
      <path d="M1 5h11M8 1l4 4-4 4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Stages({ result }: { result: TrackingOut }) {
  const steps = result.steps ?? [];
  return (
    <div className="px-4 pb-6 pt-7">
      <div className="mx-auto grid max-w-[632px]" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((step) => {
          const Icon = STAGE_ICONS[step.key] ?? STAGE_ICONS.picked_up;
          return (
            <div key={step.key} className="flex flex-col items-center">
              <Icon />
              <span className="mt-[6px] text-[15px] text-[#333]">{step.label}</span>
            </div>
          );
        })}
        {/* the dots and the line joining them */}
        {steps.map((step, index) => (
          <div key={`${step.key}-dot`} className="relative mt-[22px] flex h-[14px] items-center justify-center">
            {index > 0 && (
              <span className="absolute left-0 right-1/2 top-1/2 h-px -translate-y-1/2 bg-[#8a8a8a]" />
            )}
            {index < steps.length - 1 && (
              <span className="absolute left-1/2 right-0 top-1/2 h-px -translate-y-1/2 bg-[#8a8a8a]" />
            )}
            <span
              className="relative h-[12px] w-[12px] rounded-full"
              style={{ background: step.reached ? GREEN : '#cfcfcf' }}
            />
          </div>
        ))}
      </div>
      <p className="mt-[10px] text-center text-[26px] leading-tight text-[#333]">
        {result.status_label}
      </p>
    </div>
  );
}

function Payment() {
  return (
    <div className="bg-[#f2f2f2] px-4 py-5 text-center">
      <h3 className="text-[26px] leading-tight text-[#333]">Payment Method</h3>
      <div className="mt-6 flex items-end justify-center gap-[70px] md:gap-[96px]">
        <DuitNowIcon />
        <EWalletIcon />
        <CashIcon />
      </div>
    </div>
  );
}

function Timeline({ result }: { result: TrackingOut }) {
  const [open, setOpen] = useState(false);
  const days = result.days ?? [];
  const total = days.reduce((n, day) => n + day.events.length, 0);
  let budget = open ? Number.POSITIVE_INFINITY : FOLDED;

  return (
    <div className="px-2 pb-2 pt-8 md:px-4">
      {days.map((day) => {
        if (budget <= 0) return null;
        const events = day.events.slice(0, budget);
        budget -= events.length;
        return (
          <section key={day.date_label} className="mb-6">
            <div className="grid grid-cols-[38%_1fr] md:grid-cols-[34%_1fr]">
              <p className="pb-5 pr-3 text-right text-[14px] text-[#9b9b9b] md:text-[18px]">{day.date_label}</p>
              <span />
            </div>
            {events.map((event) => (
              <div key={`${event.id ?? 'created'}-${event.occurred_at}`} className="grid grid-cols-[38%_1fr] md:grid-cols-[34%_1fr]">
                <p className="pr-3 pt-[3px] text-right text-[13px] text-[#333] md:text-[15px]">{event.time_label}</p>
                <div className="border-l border-[#8a8a8a] pb-[26px] pl-3">
                  <p className="leading-6">
                    <span className="text-[15px] font-medium" style={{ color: SITE_RED }}>
                      {event.label}
                    </span>
                    {event.location && (
                      <span className="ml-[15px] text-[12px] text-[#666]">({event.location})</span>
                    )}
                  </p>
                  <p className="text-[15px] leading-6 text-[#333]">{event.description}</p>
                </div>
              </div>
            ))}
          </section>
        );
      })}
      {total > FOLDED && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mx-auto mb-4 block text-[15px] font-medium hover:underline"
          style={{ color: SITE_RED }}
        >
          {open ? 'See Less' : 'See More'}
        </button>
      )}
    </div>
  );
}

export function TrackingCard({ result }: { result: TrackingOut }) {
  return (
    <article className="mt-9 overflow-hidden rounded-[20px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.14)]">
      <header className="px-[15px] py-[17px] text-white" style={{ background: SITE_RED }}>
        <p className="text-[15px] font-bold">{result.tracking_no}</p>
        <p className="mt-1 flex items-center gap-2 text-[13px] font-bold">
          {result.origin} <ArrowRightWhite /> {result.destination}
        </p>
      </header>
      {result.found ? (
        <>
          <Stages result={result} />
          <Payment />
          <Timeline result={result} />
        </>
      ) : (
        <div className="px-4 py-12 text-center">
          <p className="text-[22px] text-[#333]">No record found</p>
          <p className="mt-2 text-[15px] text-[#777]">
            Please check the waybill number and try again.
          </p>
        </div>
      )}
    </article>
  );
}
