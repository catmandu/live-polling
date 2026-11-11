import { useState } from 'react';

export default function HostLogin({ onLogin, notice }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/host/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || 'Login failed.');
      onLogin(data.token);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="container narrow">
      <header className="header">
        <h1>Host login</h1>
        <p className="subtitle">Enter the host password to manage the poll.</p>
      </header>
      {notice && <p className="banner closed">{notice}</p>}
      <form onSubmit={submit} className="login-form">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Host password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={!password || busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="footer left">
        <a href="#/">← Back to participant screen</a>
      </p>
    </main>
  );
}
