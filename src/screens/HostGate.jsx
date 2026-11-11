import { useState } from 'react';
import HostLogin from './HostLogin.jsx';
import HostScreen from './HostScreen.jsx';

const KEY = 'live-poll-host-token';

export default function HostGate() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY));
  const [notice, setNotice] = useState('');

  const login = (t) => {
    sessionStorage.setItem(KEY, t);
    setNotice('');
    setToken(t);
  };

  const clear = (msg = '') => {
    sessionStorage.removeItem(KEY);
    setNotice(msg);
    setToken(null);
  };

  const logout = () => {
    fetch('/api/host/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => {});
    clear();
  };

  if (!token) return <HostLogin onLogin={login} notice={notice} />;
  return (
    <HostScreen
      key={token}
      token={token}
      onLogout={logout}
      onUnauthorized={() => clear('Your session expired. Please sign in again.')}
    />
  );
}
