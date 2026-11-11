import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import proxyaddr from 'proxy-addr';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomInt, randomUUID, timingSafeEqual, createHash } from 'crypto';

dotenv.config();

const PORT = process.env.PORT || 3001;
const MAX_TEXT = 200;
const MAX_NAME = 40;
const MAX_INVITES = 1000;
const MAX_INVITES_PER_BATCH = 200;

const HOST_PASSWORD = process.env.HOST_PASSWORD || randomBytes(6).toString('base64url');
if (!process.env.HOST_PASSWORD) {
  console.log(`No HOST_PASSWORD set. Generated host password: ${HOST_PASSWORD}`);
}
const hostTokens = new Set();

const sha = (s) => createHash('sha256').update(String(s)).digest();
const passwordMatches = (input) => timingSafeEqual(sha(input), sha(HOST_PASSWORD));

// TRUST_PROXY follows Express' "trust proxy" setting: "loopback" (default, e.g. the Vite
// dev proxy or a reverse proxy on this machine), "true" (trust every hop — only when the
// app is unreachable except through the proxy), a hop count such as "1", or a
// comma-separated list of proxy IPs/subnets.
function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const app = express();
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
const trustProxy = app.get('trust proxy fn');
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());

const normalizeIp = (ip = '') => {
  const v = ip.replace(/^::ffff:/, '');
  return v === '::1' ? '127.0.0.1' : v;
};
const clientIp = (socket) => normalizeIp(proxyaddr(socket.request, trustProxy));

// After `max` failures, block the key for `blockMs`.
function createLimiter(max, blockMs) {
  const entries = new Map();
  return {
    blocked: (key) => (entries.get(key)?.until ?? 0) > Date.now(),
    fail(key) {
      const count = (entries.get(key)?.count ?? 0) + 1;
      entries.set(key, { count, until: count >= max ? Date.now() + blockMs : 0 });
      if (count >= max) setTimeout(() => entries.delete(key), blockMs).unref();
    },
    reset: (key) => entries.delete(key),
  };
}

const loginLimiter = createLimiter(5, 60_000);
app.post('/api/host/login', (req, res) => {
  const ip = req.ip;
  if (loginLimiter.blocked(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }
  if (!passwordMatches(req.body?.password ?? '')) {
    loginLimiter.fail(ip);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  loginLimiter.reset(ip);
  const token = randomBytes(24).toString('hex');
  hostTokens.add(token);
  res.json({ token });
});

app.post('/api/host/logout', (req, res) => {
  const token = req.body?.token;
  hostTokens.delete(token);
  for (const s of io.sockets.sockets.values()) {
    if (s.data.isHost && s.handshake.auth?.token === token) s.disconnect(true);
  }
  res.json({ ok: true });
});

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res, next) =>
  res.sendFile(path.join(distDir, 'index.html'), (err) => err && next())
);

// Each invite is one person. It becomes a voting option once it is redeemed and has a name.
const poll = {
  question: 'Who should win?',
  votingOpen: true,
  invites: [], // { id, code, name, joined, lastIp, createdAt }
  votes: {}, // voter invite id -> candidate invite id
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;
function newCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (poll.invites.some((i) => i.code === code));
  return code;
}
const normalizeCode = (code) =>
  typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32) : '';

const clean = (text, max = MAX_TEXT) =>
  typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const isHost = (s) => s.data.isHost === true;
const findInvite = (id) => poll.invites.find((i) => i.id === id);
const findByCode = (code) => (code ? poll.invites.find((i) => i.code === code) : undefined);
const isOption = (i) => !!(i?.joined && i.name);
const nameTaken = (name, except) =>
  poll.invites.some((i) => i !== except && i.name && i.name.toLowerCase() === name.toLowerCase());

function publicState() {
  const options = poll.invites.filter(isOption);
  const counts = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const candidateId of Object.values(poll.votes)) {
    if (candidateId in counts) counts[candidateId] += 1;
  }
  return {
    question: poll.question,
    votingOpen: poll.votingOpen,
    options: options.map((o) => ({ id: o.id, name: o.name, votes: counts[o.id] })),
    totalVotes: Object.values(counts).reduce((a, b) => a + b, 0),
    votersCount: Object.keys(poll.votes).length,
  };
}

// Invite codes and IPs are only ever sent to the host.
function hostInvites() {
  return poll.invites.map(({ id, code, name, joined, lastIp, createdAt }) => ({
    id,
    code,
    name,
    joined,
    lastIp,
    createdAt,
    voted: id in poll.votes,
  }));
}

function meFor(socket) {
  const invite = findByCode(socket.data.code);
  if (!invite) return { hasInvite: false, joined: false, needsName: false, id: null, name: null, vote: null };
  return {
    hasInvite: true,
    joined: isOption(invite),
    needsName: !invite.name,
    id: invite.id,
    name: invite.name,
    vote: poll.votes[invite.id] ?? null,
  };
}

// The same invite may be open in several tabs, browsers or devices; keep them in sync.
function syncInvites(codes) {
  const set = new Set(codes);
  for (const s of io.sockets.sockets.values()) {
    if (!isHost(s) && set.has(s.data.code)) s.emit('me', meFor(s));
  }
}

function broadcast() {
  io.emit('state', publicState());
  io.to('hosts').emit('invites', hostInvites());
}

// Detach a revoked code from every socket using it.
function kickCodes(codes) {
  const set = new Set(codes);
  for (const s of io.sockets.sockets.values()) {
    if (!isHost(s) && set.has(s.data.code)) {
      s.data.code = null;
      s.emit('me', { ...meFor(s), revoked: true });
    }
  }
}

function removeInvite(id) {
  const invite = findInvite(id);
  if (!invite) return;
  const affected = Object.entries(poll.votes)
    .filter(([, candidateId]) => candidateId === id)
    .map(([voterId]) => findInvite(voterId)?.code)
    .filter(Boolean);

  poll.invites = poll.invites.filter((i) => i.id !== id);
  delete poll.votes[id];
  for (const [voterId, candidateId] of Object.entries(poll.votes)) {
    if (candidateId === id) delete poll.votes[voterId];
  }
  kickCodes([invite.code]);
  syncInvites(affected);
  broadcast();
}

io.use((socket, next) => {
  socket.data.ip = clientIp(socket);
  if (socket.handshake.auth?.role !== 'host') return next();
  if (!hostTokens.has(socket.handshake.auth?.token)) return next(new Error('unauthorized'));
  socket.data.isHost = true;
  next();
});

const redeemLimiter = createLimiter(10, 60_000);

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  if (isHost(socket)) {
    socket.join('hosts');
    socket.emit('invites', hostInvites());

    socket.on('setQuestion', (q) => {
      const t = clean(q);
      if (!t) return;
      poll.question = t;
      broadcast();
    });

    socket.on('setVotingOpen', (open) => {
      poll.votingOpen = !!open;
      broadcast();
    });

    socket.on('createInvites', (payload, ack) => {
      const names = Array.isArray(payload?.names)
        ? payload.names.map((n) => clean(n, MAX_NAME)).filter(Boolean)
        : [];
      const blank = Math.max(0, Math.min(Number.parseInt(payload?.blank, 10) || 0, MAX_INVITES_PER_BATCH));
      const total = names.length + blank;
      if (total === 0) return ack?.({ error: 'Enter at least one name or a number of open invites.' });
      if (total > MAX_INVITES_PER_BATCH) return ack?.({ error: `At most ${MAX_INVITES_PER_BATCH} invites at a time.` });
      if (poll.invites.length + total > MAX_INVITES) {
        return ack?.({ error: `The poll is limited to ${MAX_INVITES} invites.` });
      }

      const seen = new Set();
      for (const n of names) {
        const key = n.toLowerCase();
        if (seen.has(key) || nameTaken(n)) return ack?.({ error: `The name "${n}" is already used.` });
        seen.add(key);
      }

      const make = (name) => ({
        id: randomUUID(),
        code: newCode(),
        name,
        joined: false,
        lastIp: null,
        createdAt: Date.now(),
      });
      for (const n of names) poll.invites.push(make(n));
      for (let i = 0; i < blank; i++) poll.invites.push(make(null));
      broadcast();
      ack?.({ ok: true, created: total });
    });

    socket.on('revokeInvite', (id) => removeInvite(id));

    socket.on('resetVotes', () => {
      const codes = Object.keys(poll.votes).map((id) => findInvite(id)?.code).filter(Boolean);
      poll.votes = {};
      syncInvites(codes);
      broadcast();
    });

    socket.on('resetAll', () => {
      const codes = poll.invites.map((i) => i.code);
      poll.invites = [];
      poll.votes = {};
      kickCodes(codes);
      broadcast();
    });
    return;
  }

  const { ip } = socket.data;
  const myInvite = () => findByCode(socket.data.code);

  function redeem(rawCode) {
    if (redeemLimiter.blocked(ip)) return { error: 'Too many invalid codes. Try again in a minute.' };
    const invite = findByCode(normalizeCode(rawCode));
    if (!invite) {
      redeemLimiter.fail(ip);
      return { error: 'That invite code is not valid.' };
    }
    socket.data.code = invite.code;
    invite.lastIp = ip;
    if (invite.name) invite.joined = true;
    syncInvites([invite.code]);
    broadcast();
    return { ok: true, code: invite.code };
  }

  const handshakeCode = socket.handshake.auth?.code;
  if (handshakeCode) {
    const res = redeem(handshakeCode);
    if (res.error) socket.emit('me', { ...meFor(socket), revoked: true, error: res.error });
  } else {
    socket.emit('me', meFor(socket));
  }

  socket.on('redeem', (code, ack) => ack?.(redeem(code)));

  socket.on('setName', (name, ack) => {
    const invite = myInvite();
    if (!invite) return ack?.({ error: 'Enter your invite code first.' });
    if (invite.name) return ack?.({ error: 'Your name is already set.' });
    const n = clean(name, MAX_NAME);
    if (!n) return ack?.({ error: 'Please enter your name.' });
    if (nameTaken(n, invite)) return ack?.({ error: 'That name is already taken.' });
    invite.name = n;
    invite.joined = true;
    syncInvites([invite.code]);
    broadcast();
    ack?.({ ok: true });
  });

  socket.on('vote', (candidateId, ack) => {
    const voter = myInvite();
    if (!isOption(voter)) return ack?.({ error: 'Join with your invite before voting.' });
    if (!poll.votingOpen) return ack?.({ error: 'Voting is closed.' });
    if (!isOption(findInvite(candidateId))) return ack?.({ error: 'That option no longer exists.' });
    if (candidateId === voter.id) return ack?.({ error: "You can't vote for yourself." });
    poll.votes[voter.id] = candidateId;
    syncInvites([voter.code]);
    broadcast();
    ack?.({ ok: true });
  });

  socket.on('unvote', () => {
    const voter = myInvite();
    if (!voter || !poll.votingOpen) return;
    delete poll.votes[voter.id];
    syncInvites([voter.code]);
    broadcast();
  });

  // Only forgets the invite in this browser; the person stays in the poll.
  socket.on('signOut', () => {
    socket.data.code = null;
    socket.emit('me', meFor(socket));
  });
});

httpServer.listen(PORT, () => console.log(`Poll server listening on http://localhost:${PORT}`));
