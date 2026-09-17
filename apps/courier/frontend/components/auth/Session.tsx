'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, WAREHOUSE_URL, api, goToLogin, isStaff } from '@/lib/api';
import type { MeOut } from '@/lib/types.gen';

const MeContext = createContext<MeOut | null>(null);

/** The logged-in account, inside a RequireLogin. */
export function useMe(): MeOut | null {
  return useContext(MeContext);
}

/**
 * Where an account lands after logging in, unless it was sent somewhere.
 *
 * Staff work in the warehouse all day - picking, packing and booking parcels -
 * and step into the portal for a parcel or an account, so that is where they
 * start. A merchant has no warehouse to go to and starts in the portal.
 */
export function homeOf(me: MeOut): string {
  return isStaff(me.role) ? WAREHOUSE_URL : '/';
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
          window.location.replace(homeOf(account));
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
