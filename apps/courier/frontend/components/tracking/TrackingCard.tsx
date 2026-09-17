'use client';

import { useState } from 'react';
import type { TrackingOut } from '@/lib/types.gen';
import { STAGE_ICONS } from './icons';

/** Events shown before "See More", so a long history stays short. */
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
      <div
        className="mx-auto grid max-w-[632px]"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step) => {
          const Icon = STAGE_ICONS[step.key] ?? STAGE_ICONS.picked_up;
          return (
            <div key={step.key} className="flex min-w-0 flex-col items-center">
              <Icon className="max-w-full" />
              <span className="mt-[6px] break-words text-center text-[14px] font-semibold text-brand sm:text-[15px]">{step.label}</span>
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
      <p className="mt-4 break-words text-center text-[22px] font-bold uppercase leading-tight tracking-[1.5px] text-brand sm:text-[26px]">
        {result.status_label}
      </p>
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
                    <span className="text-[16px] font-bold text-brand">
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
          className="mx-auto mb-4 block border border-brand px-5 py-2 text-[14px] font-bold uppercase tracking-[1px] text-brand hover:bg-brand hover:text-white"
        >
          {open ? 'See Less' : 'See More'}
        </button>
      )}
    </div>
  );
}

export function TrackingCard({ result }: { result: TrackingOut }) {
  return (
    <article className="mx-auto mt-9 max-w-[1000px] overflow-hidden border border-[#e8e6e1] bg-white">
      <header className="bg-brand px-5 py-4 text-white">
        <p className="break-words text-[17px] font-bold tracking-[1px]">{result.tracking_no}</p>
        {/* the route is hidden on the public page; say nothing rather than "*** -> ***" */}
        {!(result.origin === '***' && result.destination === '***') && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] font-semibold uppercase tracking-[1px]">
            {result.origin} <ArrowRightWhite /> {result.destination}
          </p>
        )}
      </header>
      {result.found ? (
        <>
          <Stages result={result} />
          <Timeline result={result} />
        </>
      ) : (
        <div className="px-4 py-12 text-center">
          <p className="text-[22px] font-bold uppercase tracking-[1.5px] text-brand">No record found</p>
          <p className="mt-2 text-[17px] text-[#55544f]">
            Please check the tracking number and try again.
          </p>
        </div>
      )}
    </article>
  );
}
