'use client';

import { useCallback, useEffect, useState } from 'react';
import { USERS_CHANGED } from '@/components/admin/AdminChrome';
import { useMe } from '@/components/auth/Session';
import { ApiError, api } from '@/lib/api';
import { mytDateTime } from '@/lib/myt';
import type { UserOut, UserUpdateIn } from '@/lib/types.gen';

const STATUS_STYLE: Record<string, { label: string; color: string; background: string }> = {
  pending: { label: 'Waiting for approval', color: '#b86e00', background: '#fdf6ec' },
  active: { label: 'Active', color: '#3f8f1f', background: '#f0f9eb' },
  blocked: { label: 'Blocked', color: '#da251c', background: '#fef0f0' },
};

export default function UsersPage() {
  const me = useMe();
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
  const cell = 'border-b border-line-light px-3 py-2.5 align-top';

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[20px] font-bold text-text-primary">Users</h1>
        <p className="text-base text-text-secondary">
          Approve new sign-ups, block an account, or set a new password.
        </p>
      </div>

      {message && (
        <div
          role={message.kind === 'err' ? 'alert' : 'status'}
          className={`rounded border px-4 py-2.5 text-base ${
            message.kind === 'ok'
              ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
              : 'border-[#fbc4c4] bg-[#fef0f0] text-jt-red'
          }`}
        >
          {message.text}
        </div>
      )}

      {pending > 0 && (
        <div className="rounded border border-[#f5dab1] bg-[#fdf6ec] px-4 py-2.5 text-base text-[#b86e00]">
          {pending} account{pending === 1 ? ' is' : 's are'} waiting for your approval.
        </div>
      )}

      <section className="el-card overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[980px] text-base">
            <thead className="bg-surface-head text-text-regular">
              <tr>
                {['Name', 'Username', 'Phone', 'Email', 'Role', 'Status', 'Created', 'Last login', ''].map((heading) => (
                  <th key={heading} className="border-b border-line-light px-3 py-2 text-left font-normal">
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
                      {self && <span className="ml-1 text-mini text-text-secondary">(you)</span>}
                    </td>
                    <td className={cell}>{user.phone ?? '-'}</td>
                    <td className={cell}>{user.email ?? '-'}</td>
                    <td className={cell}>{user.role === 'admin' ? 'Admin' : 'Merchant'}</td>
                    <td className={cell}>
                      <span
                        className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-[10px] text-[12px] font-semibold"
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
                            className="el-btn el-btn-primary h-[28px] px-3"
                            onClick={() => void update(user, { status: 'active' }, `Approved ${user.username} - they can log in now.`)}
                          >
                            Approve
                          </button>
                        )}
                        {user.status === 'active' && !self && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn h-[28px] px-3"
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
                            className="el-btn h-[28px] px-3"
                            onClick={() => void update(user, { status: 'active' }, `Unblocked ${user.username}.`)}
                          >
                            Unblock
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          className="el-btn h-[28px] px-3"
                          onClick={() => setPassword(user)}
                        >
                          Set password
                        </button>
                        {!self && user.status !== 'active' && (
                          <button
                            type="button"
                            disabled={busy}
                            className="el-btn h-[28px] px-3"
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
                  <td colSpan={9} className="px-3 py-12 text-center text-text-secondary">
                    No accounts.
                  </td>
                </tr>
              )}
              {!users && (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-text-secondary">
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
