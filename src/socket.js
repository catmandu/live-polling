import { io } from 'socket.io-client';

const KEY = 'live-poll-key';
const PENDING = 'live-poll-pending-code';

const store = (name, value) => (value ? localStorage.setItem(name, value) : localStorage.removeItem(name));

// Private key received when this browser claimed a spot.
export const getKey = () => localStorage.getItem(KEY) || '';
export const setKey = (key) => store(KEY, key);

// Code from a scanned QR (?invite=CODE), waiting to be redeemed.
export const getPendingCode = () => localStorage.getItem(PENDING) || '';
export const setPendingCode = (code) => store(PENDING, code);

export function captureInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code) return;
  setPendingCode(code.trim().toUpperCase());
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function createSocket(role, token) {
  if (role === 'host') return io({ auth: { role, token } });
  // A function so reconnects always send the latest stored key.
  return io({ auth: (cb) => cb({ role, key: getKey() }) });
}
