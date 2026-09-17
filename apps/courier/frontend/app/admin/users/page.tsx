'use client';

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { USERS_CHANGED } from '@/components/admin/AdminChrome';
import { useMe } from '@/components/auth/Session';
import { ApiError, api, roleLabel } from '@/lib/api';
import { mytDateTime } from '@/lib/myt';
import type { UserCreateIn, UserOut, UserUpdateIn } from '@/lib/types.gen';

const STATUS_STYLE: Record<string, { label: string; color: string; background: string }> = {
  pending: { label: 'Waiting for approval', color: '#b86e00', background: '#fdf6ec' },
  active: { label: 'Active', color: '#3f8f1f', background: '#f0f9eb' },
  blocked: { label: 'Blocked', color: '#c62828', background: '#fdecea' },
};

const NEW_USER: Required<UserCreateIn> = { name: '', username: '', phone: '', email: '', password: '', role: 'merchant' };

/**
 * Platform accounts: the warehouse's Users page lists the same people, and one
 * login works on both modules.
 */
const ROLES: { value: 'merchant' | 'operator' | 'admin'; title: string; hint: string }[] = [
  { value: 'merchant', title: 'Shop user', hint: 'Creates orders and tracks parcels - this portal only' },
  { value: 'operator', title: 'Operator', hint: 'Warehouse staff: picking, returns, booking parcels, and this portal' },
  { value: 'admin', title: 'Admin', hint: 'Everything, in both the warehouse and this portal' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[17px] font-semibold text-text-primary">
        {label}
        {hint && <span className="ml-2 text-[15px] font-normal text-text-secondary">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** The admin makes an account that can log in straight away. */
function AddUserForm({ onAdded, onCancel }: { onAdded: (user: UserOut) => void; onCancel: () => void }) {
  const [form, setForm] = useState(NEW_USER);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof NEW_USER) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  const input = 'el-input h-[52px] min-w-0 text-[17px]';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.createUser(form));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The account was not added. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border-2 border-brand bg-white p-4 sm:p-6" noValidate>
      <h2 className="text-[24px] font-bold text-text-primary">Add a user</h2>
      <p className="mt-1 text-[16px] text-text-regular">
        The account works at once - no approval needed. Tell the person their username and password.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Field label="Name">
          <input className={input} value={form.name} onChange={set('name')} autoComplete="off" autoFocus />
        </Field>
        <Field label="Username" hint="used to log in">
          <input
            className={input}
            value={form.username}
            onChange={set('username')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Password" hint="at least 6 characters">
          <span className="flex gap-2">
            <input
              className={input}
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="el-btn h-[52px] shrink-0 px-4 text-[16px]"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </Field>
        <Field label="Phone number" hint="optional">
          <input className={input} value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="Email" hint="optional">
          <input className={input} type="email" value={form.email} onChange={set('email')} autoComplete="off" />
        </Field>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-[17px] font-semibold text-text-primary">What can they do?</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {ROLES.map((role) => {
            const chosen = form.role === role.value;
            return (
              <label
                key={role.value}
                className={`flex cursor-pointer items-center gap-4 rounded-xl border-2 px-4 py-4 transition-colors sm:px-5 ${
                  chosen ? 'border-brand bg-brand-tint' : 'border-line bg-white hover:border-brand'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={role.value}
                  checked={chosen}
                  onChange={() => setForm((prev) => ({ ...prev, role: role.value }))}
                  className="h-6 w-6"
                />
                <span>
                  <span className="block text-[18px] font-bold text-text-primary">{role.title}</span>
                  <span className="block text-[15px] text-text-regular">{role.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-[#fbc4c4] bg-danger-tint px-5 py-3 text-[17px] text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="el-btn el-btn-primary h-[52px] px-8 text-[17px] font-bold">
          {busy ? 'Adding...' : 'Add user'}
        </button>
        <button type="button" disabled={busy} className="el-btn h-[52px] px-6 text-[17px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const me = useMe();
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not load the accounts.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'ok', text: done });
      await load();
      window.dispatchEvent(new Event(USERS_CHANGED));
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  }

  const update = (user: UserOut, body: UserUpdateIn, done: string) =>
    run(() => api.updateUser(user.id, body), done);

  function setPassword(user: UserOut) {
    const password = window.prompt(`New password for ${user.username} (at least 6 characters):`);
    if (password === null) return;
    void update(user, { password }, `New password saved for ${user.username}.`);
  }

  function remove(user: UserOut) {
    if (!window.confirm(`Delete the account "${user.username}"? Orders are not affected.`)) return;
    void run(() => api.deleteUser(user.id), `Deleted ${user.username}.`);
  }

  const pending = users?.filter((user) => user.status === 'pending').length ?? 0;
  const cell = 'border-b border-line-light px-4 py-4 align-middle';

  return (
    <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-text-primary">Users</h1>
          <p className="mt-1 text-[17px] text-text-regular">
            Add a user, approve new sign-ups, block an account, or set a new password.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            className="el-btn el-btn-primary h-[52px] gap-2 px-6 text-[17px] font-bold"
            onClick={() => {
              setMessage(null);
              setAdding(true);
            }}
          >
            <span aria-hidden className="text-[24px] leading-none">+</span> Add user
          </button>
        )}
      </div>

      {adding && (
        <AddUserForm
          onCancel={() => setAdding(false)}
          onAdded={(user) => {
            setAdding(false);
            setMessage({ kind: 'ok', text: `Added ${user.name} (username: ${user.username}). They can log in now.` });
            void load();
          }}
        />
      )}

      {message && (
        <div
          role={message.kind === 'err' ? 'alert' : 'status'}
          className={`rounded-lg border px-5 py-3 text-[17px] ${
            message.kind === 'ok'
              ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
              : 'border-[#fbc4c4] bg-danger-tint text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {pending > 0 && (
        <div className="rounded-lg border border-[#f5dab1] bg-[#fdf6ec] px-5 py-3 text-[17px] font-semibold text-[#b86e00]">
          {pending} account{pending === 1 ? ' is' : 's are'} waiting for your approval.
        </div>
      )}

      <section className="overflow-hidden rounded-xl border-2 border-line bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1180px] text-[16px]">
            <thead className="bg-surface-head text-[15px] text-text-regular">
              <tr>
                {['Name', 'Username', 'Phone', 'Email', 'Role', 'Status', 'Created', 'Last login', ''].map((heading) => (
                  <th key={heading} className="border-b-2 border-line px-4 py-3 text-left font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((user) => {
                const style = STATUS_STYLE[user.status] ?? STATUS_STYLE.active;
                const self = me?.username === user.username;
                return (
                  <tr key={user.id} className={user.status === 'pending' ? 'bg-[#fffbe6]' : ''}>
                    <td className={`${cell} font-semibold`}>{user.name}</td>
                    <td className={cell}>
                      {user.username}
                      {self && <span className="ml-1 text-[14px] text-text-secondary">(you)</span>}
                    </td>
                    <td className={cell}>{user.phone ?? '-'}</td>
                    <td className={cell}>{user.email ?? '-'}</td>
                    <td className={cell}>{roleLabel(user.role)}</td>
                    <td className={cell}>
                      <span
                        className="inline-flex h-[32px] items-center whitespace-nowrap rounded-full px-[14px] text-[15px] font-semibold"
                        style={{ color: style.color, background: style.background }}
                      >
                        {style.label}
                      </span>
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>{mytDateTime(user.created_at)}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {user.last_login_at ? mytDateTime(user.last_login_at) : 'Never'}
                    </td>
                    <td className={`${cell} whitespace-nowrap text-right`}>
                      <div className="inline-flex gap-2">
                        {user.status === 'pending' && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn el-btn-primary h-11 px-4 text-[16px]"
                            onClick={() => void update(user, { status: 'active' }, `Approved ${user.username} - they can log in now.`)}
                          >
                            Approve
                          </button>
                        )}
                        {user.status === 'active' && !self && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn h-11 px-4 text-[16px]"
                            onClick={() =>
                              window.confirm(`Block ${user.username}? They are logged out and cannot log in.`) &&
                              void update(user, { status: 'blocked' }, `Blocked ${user.username}.`)
                            }
                          >
                            Block
                          </button>
                        )}
                        {user.status === 'blocked' && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn h-11 px-4 text-[16px]"
                            onClick={() => void update(user, { status: 'active' }, `Unblocked ${user.username}.`)}
                          >
                            Unblock
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          className="el-btn h-11 px-4 text-[16px]"
                          onClick={() => setPassword(user)}
                        >
                          Set password
                        </button>
                        {!self && user.status !== 'active' && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn h-11 px-4 text-[16px]"
                            onClick={() => remove(user)}
                          >
                            {user.status === 'pending' ? 'Reject' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users && users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[18px] text-text-secondary">
                    No accounts.
                  </td>
                </tr>
              )}
              {!users && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[18px] text-text-secondary">
                    Loading accounts...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
