'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthButton, AuthInput, AuthMessage } from '@/components/auth/AuthShell';
import { homeOf } from '@/components/auth/Session';
import { ApiError, api } from '@/lib/api';
import type { MeOut } from '@/lib/types.gen';

/** The page to open after logging in: where the account was sent from, if it may go there. */
function destination(me: MeOut): string {
  const next = new URLSearchParams(window.location.search).get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login');
  if (!safe) return homeOf(me);
  if (me.role !== 'admin' && next.startsWith('/admin')) return homeOf(me);
  // the warehouse takes staff accounts only; a merchant sent there would be sent back
  if (me.role === 'merchant' && next.startsWith('/warehouse')) return homeOf(me);
  return next;
}

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // already logged in: straight to the portal
  useEffect(() => {
    api
      .me()
      .then((me) => window.location.replace(destination(me)))
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!login.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await api.login({ login: login.trim(), password });
      window.location.assign(destination(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-center text-[30px] font-bold uppercase leading-tight tracking-[1.5px] text-brand">Login</h1>
      <AuthInput
        label="Username / Phone Number / Email"
        value={login}
        onChange={setLogin}
        autoComplete="username"
        autoFocus
      />
      <AuthInput
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <AuthButton busy={busy}>{busy ? 'Logging in...' : 'Login'}</AuthButton>
      <p className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[16px] text-[#55544f]">
        <Link href="/signup" className="underline underline-offset-4 hover:text-brand">
          Create an account
        </Link>
        <Link href="/forgot-password" className="underline underline-offset-4 hover:text-brand">
          Forgot password
        </Link>
      </p>
    </form>
  );
}
