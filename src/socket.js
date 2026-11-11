import { io } from 'socket.io-client';

const KEY = 'live-poll-invite-code';

export const getInviteCode = () => localStorage.getItem(KEY) || '';
export const setInviteCode = (code) =>
  code ? localStorage.setItem(KEY, code) : localStorage.removeItem(KEY);

// Turns a ?invite=CODE link into a stored code and removes it from the address bar.
export function captureInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code) return;
  setInviteCode(code.trim().toUpperCase());
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function createSocket(role, token) {
  if (role === 'host') return io({ auth: { role, token } });
  // A function so reconnects always send the latest stored code.
  return io({ auth: (cb) => cb({ role, code: getInviteCode() }) });
}
