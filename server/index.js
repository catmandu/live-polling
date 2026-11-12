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
const MAX_TOPIC = 80;

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


// A run has up to INVITES_PER_RUN spots. Each spot has a one-time code (shown as a QR on the
// host screen). The first browser to redeem it receives a private key and owns the spot; the
// code is then retired and a fresh QR is generated for the next spot.
const INVITES_PER_RUN = 30;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

const poll = {
  question: '¿Quién tuvo la mejor presentación?',
  votingOpen: true,
  invites: [], // { id, code, key, name, topic, lastIp, createdAt, claimedAt }
  votes: {}, // voter invite id -> candidate invite id
  nextInviteId: null, // spot whose QR is shown for new registrations
  usedCodes: new Set(),
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;
function newCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (poll.invites.some((i) => i.code === code) || poll.usedCodes.has(code));
  return code;
}
const normalizeCode = (code) =>
  typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32) : '';

const clean = (text, max = MAX_TEXT) =>
  typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const isHost = (s) => s.data.isHost === true;
const findInvite = (id) => poll.invites.find((i) => i.id === id);
const findByCode = (code) => (code ? poll.invites.find((i) => i.code === code) : undefined);
const findByKey = (key) =>
  typeof key === 'string' && key ? poll.invites.find((i) => i.key === key) : undefined;
const isOption = (i) => !!(i?.key && i.name);
const labelOf = (i) => (i.topic ? `${i.name} — ${i.topic}` : i.name);
const statusOf = (i) => (!i.key ? 'open' : !i.name ? 'claimed' : 'joined');
const nameTaken = (name, except) =>
  poll.invites.some((i) => i !== except && i.name && i.name.toLowerCase() === name.toLowerCase());

function ensureNextInvite() {
  const current = findInvite(poll.nextInviteId);
  if (current && !current.key) return;
  if (poll.invites.length >= INVITES_PER_RUN) {
    poll.nextInviteId = null;
    return;
  }
  const invite = {
    id: randomUUID(),
    code: newCode(),
    key: null,
    name: null,
    topic: null,
    lastIp: null,
    createdAt: Date.now(),
    claimedAt: null,
  };
  poll.invites.push(invite);
  poll.nextInviteId = invite.id;
}
ensureNextInvite();

function publicState() {
  const options = poll.invites.filter(isOption);
  const counts = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const candidateId of Object.values(poll.votes)) {
    if (candidateId in counts) counts[candidateId] += 1;
  }
  return {
    question: poll.question,
    votingOpen: poll.votingOpen,
    options: options.map((o) => ({ id: o.id, name: o.name, topic: o.topic, label: labelOf(o), votes: counts[o.id] })),
    totalVotes: Object.values(counts).reduce((a, b) => a + b, 0),
    votersCount: Object.keys(poll.votes).length,
  };
}

// Codes and IPs are only ever sent to the host; keys never leave the owner's browser.
function hostRegistry() {
  return {
    limit: INVITES_PER_RUN,
    nextId: poll.nextInviteId,
    publicUrl: PUBLIC_URL,
    invites: poll.invites.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      topic: i.topic,
      status: statusOf(i),
      lastIp: i.lastIp,
      createdAt: i.createdAt,
      claimedAt: i.claimedAt,
      voted: i.id in poll.votes,
    })),
  };
}

function meFor(socket) {
  const invite = findByKey(socket.data.key);
  if (!invite) return { hasInvite: false, joined: false, needsName: false, id: null, name: null, vote: null };
  return {
    hasInvite: true,
    joined: isOption(invite),
    needsName: !invite.name,
    id: invite.id,
    name: invite.name,
    topic: invite.topic,
    vote: poll.votes[invite.id] ?? null,
  };
}

const participantSockets = () => [...io.sockets.sockets.values()].filter((s) => !isHost(s));

// One registration may be open in several tabs; keep them in sync.
function syncInvites(ids) {
  const set = new Set(ids);
  for (const s of participantSockets()) {
    const invite = findByKey(s.data.key);
    if (invite && set.has(invite.id)) s.emit('me', meFor(s));
  }
}

function broadcast() {
  io.emit('state', publicState());
  io.to('hosts').emit('registry', hostRegistry());
}

function kickKeys(keys, message) {
  const set = new Set(keys.filter(Boolean));
  for (const s of participantSockets()) {
    if (set.has(s.data.key)) {
      s.data.key = null;
      s.emit('me', { ...meFor(s), revoked: true, error: message });
    }
  }
}

// Removes votes cast by and for `id`; returns the voters whose vote was dropped.
function dropVotesInvolving(id) {
  delete poll.votes[id];
  const affected = [];
  for (const [voterId, candidateId] of Object.entries(poll.votes)) {
    if (candidateId === id) {
      delete poll.votes[voterId];
      affected.push(voterId);
    }
  }
  return affected;
}

function revokeInvite(id) {
  const invite = findInvite(id);
  if (!invite) return;
  const affected = dropVotesInvolving(id);
  poll.invites = poll.invites.filter((i) => i.id !== id);
  poll.usedCodes.add(invite.code);
  kickKeys([invite.key], 'The host removed your registration.');
  ensureNextInvite();
  syncInvites(affected);
  broadcast();
}

// Frees a spot for someone else (or the same person on another device): new code, no owner.
function reassignInvite(id) {
  const invite = findInvite(id);
  if (!invite) return null;
  const affected = dropVotesInvolving(id);
  const oldKey = invite.key;
  if (invite.code) poll.usedCodes.add(invite.code);
  Object.assign(invite, { code: newCode(), key: null, name: null, topic: null, lastIp: null, claimedAt: null });
  kickKeys([oldKey], 'The host reset your registration. Scan the QR code you are shown to register again.');
  syncInvites(affected);
  broadcast();
  return invite.code;
}

io.use((socket, next) => {
  socket.data.ip = clientIp(socket);
  if (socket.handshake.auth?.role !== 'host') return next();
  if (!hostTokens.has(socket.handshake.auth?.token)) return next(new Error('unauthorized'));
  socket.data.isHost = true;
  next();
});

const redeemLimiter = createLimiter(20, 60_000);

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  if (isHost(socket)) {
    socket.join('hosts');
    socket.emit('registry', hostRegistry());

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

    socket.on('revokeInvite', (id) => revokeInvite(id));

    socket.on('reassignInvite', (id, ack) => {
      const code = reassignInvite(id);
      ack?.(code ? { ok: true, id } : { error: 'That spot no longer exists.' });
    });

    socket.on('resetVotes', () => {
      const ids = Object.keys(poll.votes);
      poll.votes = {};
      syncInvites(ids);
      broadcast();
    });

    // Starts a new run: every registration is revoked and a fresh set of spots is available.
    socket.on('resetAll', () => {
      const keys = poll.invites.map((i) => i.key);
      poll.invites = [];
      poll.votes = {};
      poll.usedCodes.clear();
      poll.nextInviteId = null;
      kickKeys(keys, 'El anfitrión inició una nueva encuesta. Escanea el nuevo código QR para registrarte.');
      ensureNextInvite();
      broadcast();
    });
    return;
  }

  const { ip } = socket.data;
  const myInvite = () => findByKey(socket.data.key);

  const authKey = socket.handshake.auth?.key;
  const existing = findByKey(authKey);
  if (existing) {
    socket.data.key = authKey;
    existing.lastIp = ip;
    socket.emit('me', meFor(socket));
    io.to('hosts').emit('registry', hostRegistry());
  } else if (authKey) {
    socket.emit('me', {
      ...meFor(socket),
      revoked: true,
      error: 'Your registration is no longer valid. Scan the QR code on the host screen to register.',
    });
  } else {
    socket.emit('me', meFor(socket));
  }

  socket.on('redeem', (rawCode, ack) => {
    if (myInvite()) return ack?.({ error: 'You are already registered in this browser.', alreadyRegistered: true });
    if (redeemLimiter.blocked(ip)) return ack?.({ error: 'Too many invalid codes. Try again in a minute.' });
    const code = normalizeCode(rawCode);
    if (poll.usedCodes.has(code)) {
      return ack?.({ error: 'This code has already been used. Scan the current QR code on the host screen.' });
    }
    const invite = findByCode(code);
    if (!invite) {
      redeemLimiter.fail(ip);
      return ack?.({ error: 'That invite code is not valid.' });
    }

    const key = randomBytes(24).toString('base64url');
    poll.usedCodes.add(code);
    Object.assign(invite, { code: null, key, lastIp: ip, claimedAt: Date.now() });
    socket.data.key = key;
    if (invite.id === poll.nextInviteId) ensureNextInvite();
    broadcast();
    ack?.({ ok: true, key });
    syncInvites([invite.id]);
  });

  socket.on('setName', (payload, ack) => {
    const invite = myInvite();
    if (!invite) return ack?.({ error: 'Scan the QR code to register first.' });
    if (invite.name) return ack?.({ error: 'Your name is already set.' });
    const n = clean(payload?.name, MAX_NAME);
    const t = clean(payload?.topic, MAX_TOPIC);
    if (!n) return ack?.({ error: 'Please enter your name.' });
    if (!t) return ack?.({ error: 'Please enter the topic you presented.' });
    if (nameTaken(n, invite)) return ack?.({ error: 'That name is already taken.' });
    invite.name = n;
    invite.topic = t;
    syncInvites([invite.id]);
    broadcast();
    ack?.({ ok: true });
  });

  socket.on('vote', (candidateId, ack) => {
    const voter = myInvite();
    if (!isOption(voter)) return ack?.({ error: 'Register before voting.' });
    if (!poll.votingOpen) return ack?.({ error: 'Voting is closed.' });
    if (!isOption(findInvite(candidateId))) return ack?.({ error: 'That option no longer exists.' });
    if (candidateId === voter.id) return ack?.({ error: "You can't vote for yourself." });
    poll.votes[voter.id] = candidateId;
    syncInvites([voter.id]);
    broadcast();
    ack?.({ ok: true });
  });

  socket.on('unvote', () => {
    const voter = myInvite();
    if (!voter || !poll.votingOpen) return;
    delete poll.votes[voter.id];
    syncInvites([voter.id]);
    broadcast();
  });

  // Forgets the registration in this browser only (e.g. a shared phone); the spot stays taken.
  socket.on('signOut', () => {
    socket.data.key = null;
    socket.emit('me', meFor(socket));
  });
});

httpServer.listen(PORT, () => console.log(`Poll server listening on http://localhost:${PORT}`));
