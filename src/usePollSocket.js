import { useEffect, useState } from 'react';
import { createSocket } from './socket.js';

export function usePollSocket(role, { token, onUnauthorized } = {}) {
  const [socket] = useState(() => createSocket(role, token));
  const [state, setState] = useState({
    question: '',
    votingOpen: true,
    options: [],
    totalVotes: 0,
    votersCount: 0,
  });
  const [me, setMe] = useState({ hasInvite: false, joined: false, needsName: false, id: null, name: null, vote: null });
  const [invites, setInvites] = useState([]);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const handlers = {
      state: setState,
      me: setMe,
      invites: setInvites,
      connect: () => setConnected(true),
      disconnect: () => setConnected(false),
      connect_error: (err) => {
        if (err?.message === 'unauthorized') onUnauthorized?.();
      },
    };
    Object.entries(handlers).forEach(([e, h]) => socket.on(e, h));
    if (socket.disconnected) socket.connect();
    return () => {
      Object.entries(handlers).forEach(([e, h]) => socket.off(e, h));
      socket.disconnect();
    };
  }, [socket]);

  return { socket, state, me, invites, connected };
}
