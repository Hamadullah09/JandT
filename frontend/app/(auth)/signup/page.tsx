'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AUTH_LINK_BUTTON, AuthButton, AuthInput, AuthMessage } from '@/components/auth/AuthShell';
import { ApiError, api } from '@/lib/api';

const EMPTY = { name: '', username: '', phone: '', email: '', password: '', confirm: '' };

export default function SignupPage() {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (field: keyof typeof EMPTY) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.signup({
        name: form.name,
        username: form.username,
        phone: form.phone,
        email: form.email,
        password: form.password,
        confirm_password: form.confirm,
      });
      setDone(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[1.5px] text-brand">Account created</h1>
        <AuthMessage kind="ok">{done}</AuthMessage>
        <p className="text-[16px] text-[#55544f]">
          Your username is <strong className="text-brand">{form.username.trim().toLowerCase()}</strong>.
        </p>
        <Link href="/login" className={AUTH_LINK_BUTTON}>
          Back to Login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <h1 className="mb-2 text-center text-[28px] font-bold uppercase leading-tight tracking-[1.5px] text-brand">Create an account</h1>
      <AuthInput label="Name" value={form.name} onChange={set('name')} autoComplete="name" autoFocus />
      <AuthInput label="Username" value={form.username} onChange={set('username')} autoComplete="username" />
      <AuthInput label="Phone Number" value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" />
      <AuthInput label="Email" required={false} value={form.email} onChange={set('email')} autoComplete="email" type="email" />
      <AuthInput label="Password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
      <AuthInput label="Confirm Password" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <p className="text-center text-[15px] text-[#55544f]">
        New accounts can log in after the admin approves them.
      </p>
      <AuthButton busy={busy}>{busy ? 'Signing up...' : 'Sign up'}</AuthButton>
      <p className="text-center text-[16px] text-[#55544f]">
        Already have an account?{' '}
        <Link href="/login" className="underline underline-offset-4 hover:text-brand">
          Login
        </Link>
      </p>
    </form>
  );
}
