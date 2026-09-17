import React from 'react';
import { api } from '../api.js';
import { Field, Notice, Panel, useAction } from '../components.jsx';

export default function Account({ user }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const act = useAction();

  const mismatch = again.length > 0 && next !== again;
  const ready = current && next.length >= 6 && next === again;

  async function submit(e) {
    e.preventDefault();
    const res = await act.run(() => api.changePassword(current, next), 'Password changed.');
    if (res) { setCurrent(''); setNext(''); setAgain(''); }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>My account</h1>
          <p>Signed in as {user.fullName}.</p>
        </div>
      </div>

      <div className="grid two">
        <Panel title="Change my password">
          <form onSubmit={submit}>
            <Field label="Current password">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password" />
            </Field>

            <Field label="New password" help="At least 6 characters.">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password" />
            </Field>

            <Field label="New password again">
              <input type="password" value={again} onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password" />
            </Field>

            {mismatch && <Notice kind="warn">Those two do not match.</Notice>}
            <Notice kind="error">{act.error}</Notice>
            {act.done && <Notice kind="ok">{act.done}</Notice>}

            <button className="primary" type="submit" disabled={act.busy || !ready}>
              {act.busy ? 'Saving…' : 'Change it'}
            </button>
          </form>
        </Panel>

        <Panel title="This account">
          <dl className="kv">
            <dt>Name</dt>
            <dd>{user.fullName}</dd>
            <dt>Username</dt>
            <dd className="mono">{user.username}</dd>
            <dt>Can do</dt>
            <dd>
              {user.role === 'admin'
                ? 'Everything, including the catalogue, rooms and users'
                : 'Day-to-day work: intake, picking, returns and finding'}
            </dd>
          </dl>

          {user.username === 'admin' && (
            <Notice kind="warn">
              <span>
                This is the account the system ships with. If its password is still
                <b> admin123</b>, change it now — it is written in the setup notes and anybody
                who has read them can sign in.
              </span>
            </Notice>
          )}
        </Panel>
      </div>
    </>
  );
}
