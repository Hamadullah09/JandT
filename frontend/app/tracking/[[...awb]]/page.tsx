'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TrackingCard } from '@/components/tracking/TrackingCard';
import { ApiError, api } from '@/lib/api';
import type { TrackingOut } from '@/lib/types.gen';

/** Up to 10 tracking numbers at once. */
const MAX_WAYBILLS = 10;

function splitWaybills(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,]+/)) {
    const value = part.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.35)" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function TrackingPage() {
  const router = useRouter();
  const params = useParams<{ awb?: string[] }>();
  const fromUrl = splitWaybills(
    (params.awb ?? []).map((segment) => decodeURIComponent(segment)).join(','),
  );
  const key = fromUrl.join(',');

  const [input, setInput] = useState(key);
  const [results, setResults] = useState<TrackingOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(key.split(',').join(','));
    if (!key) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .track(key.split(','))
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResults([]);
          setError(err instanceof ApiError ? err.message : 'Tracking is not available right now.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  function go() {
    const waybills = splitWaybills(input);
    if (waybills.length === 0) {
      setError('Please enter your tracking number.');
      return;
    }
    if (waybills.length > MAX_WAYBILLS) {
      setError(`You can track up to ${MAX_WAYBILLS} parcels at once.`);
      return;
    }
    setError(null);
    router.push(`/tracking/${waybills.join(',')}`);
  }

  return (
    <main className="mx-auto w-full max-w-[1246px] px-4 pb-4 md:px-0">
      <h1 className="mt-10 text-center text-[30px] font-bold uppercase leading-[40px] tracking-[1.5px] text-brand">
        Track your order
      </h1>

      <form
        className="mx-auto mt-6 flex h-[68px] max-w-[860px] overflow-hidden border border-brand bg-white"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="Tracking numbers"
          placeholder="Enter your tracking number"
          className="min-w-0 flex-1 bg-transparent pl-6 text-[18px] text-brand outline-none placeholder:text-[#8a8984]"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="flex w-[120px] shrink-0 items-center justify-center bg-brand text-[16px] font-bold uppercase tracking-[1.5px] text-white hover:bg-[#2e2d2a]"
          disabled={loading}
        >
          {loading ? <Spinner /> : 'Track'}
        </button>
      </form>

      <p className="mt-5 text-center text-[16px] text-[#55544f]">
        You can track up to 10 parcels at once - put a comma between the numbers.
      </p>

      {error && (
        <p className="mt-6 text-center text-[17px] text-danger" role="alert">
          {error}
        </p>
      )}

      {results.map((result) => (
        <TrackingCard key={result.tracking_no} result={result} />
      ))}
    </main>
  );
}
