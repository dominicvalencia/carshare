'use client';

import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL } from './admin-environment';

export function StaffInvitationActivation() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || password !== confirmation) {
      setStatus('error');
      setMessage(!token ? 'This invitation link is incomplete.' : 'Passwords do not match.');
      return;
    }
    setStatus('pending');
    setMessage('');
    const response = await fetch(`${API_URL}/admin/auth/activate`, {
      body: JSON.stringify({ password, token }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { error?: { message: string } };
    if (!response.ok) {
      setStatus('error');
      setMessage(body.error?.message ?? 'Invitation activation failed.');
      return;
    }
    setStatus('success');
    setMessage('Your staff account is active. You may now sign in.');
  };
  return (
    <main className="admin-login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span className="eyebrow">CARSHARE STAFF INVITATION</span>
        <h1>Create your password</h1>
        <p>
          This single-use invitation expires after 24 hours. Your inviter cannot see your password.
        </p>
        <label>
          Password
          <input
            autoComplete="new-password"
            type="password"
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            autoComplete="new-password"
            type="password"
            minLength={12}
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <button disabled={status === 'pending' || status === 'success'} type="submit">
          {status === 'pending' ? 'Activating…' : 'Activate account'}
        </button>
        {message && <p className={status === 'error' ? 'error-text' : ''}>{message}</p>}
      </form>
    </main>
  );
}
