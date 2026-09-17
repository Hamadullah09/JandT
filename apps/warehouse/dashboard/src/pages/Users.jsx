import React from 'react';
import { api } from '../api.js';
import {
  Empty, Field, Loaded, Modal, Notice, Panel, When, useAction, useLoader, usePages,
} from '../components.jsx';

/**
 * Who can sign in - here, on the handhelds and on the courier portal.
 *
 * These are the platform's accounts: the courier portal's Users page lists the
 * same people, and a change on either is a change on both. An operator does
 * the work - intake, picking, returns, finding, booking parcels. An admin also
 * changes the catalogue, the rooms and the people. A merchant account is for
 * the courier portal only and cannot open the warehouse.
 */
const ROLES = {
  admin: ['brand', 'Everything'],
  operator: ['grey', 'Day-to-day work'],
  merchant: ['info', 'Courier portal only'],
};
export default function Users() {
  const state = useLoader(() => api.users(), []);
  const pages = usePages(state.data?.users);
  const [adding, setAdding] = React.useState(false);
  const [resetting, setResetting] = React.useState(null);
  const act = useAction();

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Users</h1>
          <p>Accounts for the office, the handhelds and the courier portal - one sign-in for all three.</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>New user</button>
      </div>

      <Notice kind="error">{act.error}</Notice>

      <Panel tight>
        <Loaded
          state={state}
          empty={(d) => d.users.length === 0 && <Empty title="No users" />}
        >
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Can do</th>
                    <th>Last signed in</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pages.rows.map((u) => {
                    const off = Number(u.active) === 0;
                    const [tone, can] = ROLES[u.role] ?? ['grey', u.role];
                    return (
                      <tr key={u.id} className={off ? 'muted' : undefined}>
                        <td className="strong">{u.full_name}</td>
                        <td className="mono">{u.username}</td>
                        <td><span className={`pill ${tone}`}>{can}</span></td>
                        <td className="muted small">
                          {u.last_login_at ? <When value={u.last_login_at} /> : <span className="faint">Never</span>}
                        </td>
                        <td>
                          {u.status === 'pending'
                            ? <span className="pill warn">Waiting for approval</span>
                            : off
                              ? <span className="pill bad">Switched off</span>
                              : <span className="pill ok">Active</span>}
                        </td>
                        <td className="tight nowrap">
                          <button className="link sm" onClick={() => setResetting(u)}>
                            Set password
                          </button>
                          <button
                            className={off ? 'link sm' : 'link bad sm'}
                            onClick={async () => {
                              await act.run(() => api.setUserActive(u.id, off ? 1 : 0));
                              state.reload();
                            }}
                          >
                            {off ? 'Switch on' : 'Switch off'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        {pages.pager}
      </Panel>

      <NewUser
        open={adding}
        onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); state.reload(); }}
      />

      <ResetPassword
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={() => setResetting(null)}
      />
    </>
  );
}

function NewUser({ open, onClose, onDone }) {
  const blank = { username: '', fullName: '', password: '', role: 'operator' };
  const [form, setForm] = React.useState(blank);
  const act = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const res = await act.run(() => api.createUser({
      username: form.username.trim(),
      fullName: form.fullName.trim() || form.username.trim(),
      password: form.password,
      role: form.role,
    }));
    if (res) { setForm(blank); onDone(); }
  }

  const ready = form.username.trim().length >= 3 && form.password.length >= 6;

  return (
    <Modal
      open={open}
      title="New user"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={act.busy || !ready}>
            {act.busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>

      <Field label="Full name">
        <input value={form.fullName} onChange={set('fullName')} placeholder="Bilal Ahmed" autoFocus />
      </Field>

      <Field label="Username" help="What they type to sign in. Lower case, no spaces.">
        <input value={form.username} onChange={set('username')} placeholder="bilal" />
      </Field>

      <Field label="Password" help="At least 6 characters. They can change it themselves later.">
        <input type="text" value={form.password} onChange={set('password')} />
      </Field>

      <Field label="Can do">
        <select value={form.role} onChange={set('role')}>
          <option value="operator">
            Day-to-day work — intake, picking, returns, finding, booking parcels
          </option>
          <option value="admin">
            Everything — also the catalogue, rooms and users
          </option>
          <option value="merchant">
            Courier portal only — creating and tracking parcels
          </option>
        </select>
      </Field>
    </Modal>
  );
}

function ResetPassword({ user, onClose, onDone }) {
  const [password, setPassword] = React.useState('');
  const act = useAction();

  React.useEffect(() => { if (user) setPassword(''); }, [user]);
  if (!user) return null;

  return (
    <Modal
      open={!!user}
      title={`Set a password for ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={act.busy}>Cancel</button>
          <button
            className="primary"
            disabled={act.busy || password.length < 6}
            onClick={async () => {
              const res = await act.run(() => api.resetPassword(user.id, password));
              if (res) onDone();
            }}
          >
            {act.busy ? 'Saving…' : 'Set it'}
          </button>
        </>
      }
    >
      <Notice kind="error">{act.error}</Notice>
      {act.done && <Notice kind="ok">Password changed.</Notice>}

      <p className="muted small">
        They will be signed out of any handheld they are using, and will need the new password
        to sign back in.
      </p>

      <Field label="New password" help="At least 6 characters.">
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
