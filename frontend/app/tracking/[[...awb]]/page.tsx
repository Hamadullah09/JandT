'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SITE_RED } from '@/components/tracking/Site';
import { TrackingCard } from '@/components/tracking/TrackingCard';
import { ApiError, api } from '@/lib/api';
import type { TrackingOut } from '@/lib/types.gen';

/** jtexpress.my takes up to 10 waybills at once. */
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
      setError('Please enter your waybill number.');
      return;
    }
    if (waybills.length > MAX_WAYBILLS) {
      setError(`Available up to ${MAX_WAYBILLS} waybills.`);
      return;
    }
    setError(null);
    router.push(`/tracking/${waybills.join(',')}`);
  }

  return (
    <main className="mx-auto w-full max-w-[1246px] px-4 pb-4 md:px-0">
      <h1 className="mt-[10px] text-center text-[26px] font-normal leading-[40px] text-[#333]">
        Track &amp; Trace
      </h1>

      <form
        className="mt-[10px] flex h-[76px] overflow-hidden rounded-[20px] border border-[#dcdcdc] bg-white"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="Waybill numbers"
          className="min-w-0 flex-1 bg-transparent pl-6 text-[16px] text-[#333] outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="flex w-[80px] shrink-0 items-center justify-center text-[16px] text-white"
          style={{ background: SITE_RED }}
          disabled={loading}
        >
          {loading ? <Spinner /> : 'GO'}
        </button>
      </form>

      <p className="mt-[25px] text-center text-[14px] text-[#333]">
        Enter your waybill number (separated by comma). Available up to 10 waybills.
      </p>

      {error && (
        <p className="mt-6 text-center text-[15px]" style={{ color: SITE_RED }} role="alert">
          {error}
        </p>
      )}

      {results.map((result) => (
        <TrackingCard key={result.tracking_no} result={result} />
      ))}
    </main>
  );
}
