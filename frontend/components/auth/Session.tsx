'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, goToLogin } from '@/lib/api';
import type { MeOut } from '@/lib/types.gen';

const MeContext = createContext<MeOut | null>(null);

/** The logged-in account, inside a RequireLogin. */
export function useMe(): MeOut | null {
  return useContext(MeContext);
}

/** Where an account lands after logging in, unless it was sent somewhere. */
export function homeOf(me: MeOut): string {
  return me.role === 'admin' ? '/admin' : '/';
}

/**
 * Shows its children only to a logged-in account - the admin only, with
 * `admin`.  Anyone else goes to the login page; the shop account trying the
 * admin portal goes to its own portal instead.
 */
export function RequireLogin({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const [me, setMe] = useState<MeOut | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((account) => {
        if (cancelled) return;
        if (admin && account.role !== 'admin') {
          window.location.replace('/');
          return;
        }
        setMe(account);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 0) setProblem(error.message);
        else goToLogin();
      });
    return () => {
      cancelled = true;
    };
  }, [admin]);

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-base text-text-secondary">
        {problem ?? 'Checking your login...'}
      </div>
    );
  }
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export async function logOut(): Promise<void> {
  try {
    await api.logout();
  } finally {
    window.location.assign('/login');
  }
}
