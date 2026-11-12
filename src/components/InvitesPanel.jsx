import { useState } from 'react';
import QrCode from './QrCode.jsx';

const isLocalHost = (url) => /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);

const STATUS_LABEL = { open: 'waiting for scan', claimed: 'choosing name', joined: 'joined' };

export default function InvitesPanel({ socket, registry, connected }) {
  const { invites, nextId, limit, publicUrl } = registry;
  const base = publicUrl || window.location.origin;
  const linkFor = (code) => `${base}/?invite=${code}`;

  // null, 'next' (follows the live registration QR) or the id of a reassigned spot.
  const [presenting, setPresenting] = useState(null);

  const next = invites.find((i) => i.id === nextId);
  const shown = presenting === 'next' ? next : invites.find((i) => i.id === presenting);
  const registered = invites.filter((i) => i.status !== 'open').length;
  const spotsLeft = limit - invites.length + (next ? 1 : 0);
  const countText = `${registered} registered · ${spotsLeft} new spot${spotsLeft === 1 ? '' : 's'} left`;

  const revoke = (inv) => {
    const label = inv.name || `spot ${invites.indexOf(inv) + 1}`;
    if (window.confirm(`Revoke ${label}? Their spot and votes are removed and the spot is freed.`)) {
      socket.emit('revokeInvite', inv.id);
    }
  };

  const reassign = (inv) => {
    const label = inv.name || `spot ${invites.indexOf(inv) + 1}`;
    const msg =
      inv.status === 'open'
        ? `Replace the code for ${label}? The current code stops working.`
        : `Reassign ${label}? The current owner is signed out, their votes are removed, and a new QR code is created for this spot.`;
    if (!window.confirm(msg)) return;
    socket.emit('reassignInvite', inv.id, (res) => res?.ok && setPresenting(res.id));
  };

  return (
    <section className="invites">
      <h2>Registration</h2>
      <div className="qr-card">
        {next ? (
          <>
            <QrCode value={linkFor(next.code)} size={200} />
            <div className="qr-info">
              <p>Scan to register. Each code works once — a new one appears after every scan.</p>
              <p className="qr-code-text">{next.code}</p>
              <p className="hint">{countText}</p>
              <button className="primary" onClick={() => setPresenting('next')}>
                Show full screen
              </button>
            </div>
          </>
        ) : (
          <p className="empty">
            All {limit} spots are taken. Revoke a spot to free it, or start a new run.
          </p>
        )}
      </div>
      {isLocalHost(base) && (
        <p className="warning">
          The QR points to {base}, which phones can't open. Open the host page using this computer's
          network address or your public site, or set <code>PUBLIC_URL</code> on the server.
        </p>
      )}

      {invites.length > 0 && (
        <table className="invite-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name / topic</th>
              <th>Code</th>
              <th>Status</th>
              <th>Last IP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv, n) => (
              <tr key={inv.id} className={inv.id === nextId ? 'is-next' : undefined}>
                <td className="meta">{n + 1}</td>
                <td>
                  {inv.name || <em>—</em>}
                  {inv.topic && <div className="meta">{inv.topic}</div>}
                </td>
                <td>{inv.code ? <code>{inv.code}</code> : <span className="meta">used</span>}</td>
                <td>
                  <span className={`pill ${inv.status === 'joined' ? 'joined' : 'pending'}`}>
                    {inv.status === 'joined' && inv.voted ? 'voted' : STATUS_LABEL[inv.status]}
                  </span>
                  {inv.id === nextId && <span className="meta"> (current QR)</span>}
                </td>
                <td className="meta">{inv.lastIp || '—'}</td>
                <td className="row-actions">
                  {inv.status === 'open' && inv.id !== nextId && (
                    <button disabled={!connected} onClick={() => setPresenting(inv.id)}>
                      Show QR
                    </button>
                  )}
                  {inv.id !== nextId && (
                    <button disabled={!connected} onClick={() => reassign(inv)}>
                      Reassign
                    </button>
                  )}
                  {inv.id !== nextId && (
                    <button className="remove" title="Revoke" disabled={!connected} onClick={() => revoke(inv)}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {presenting && (
        <div className="qr-overlay" role="dialog" aria-modal="true" onClick={() => setPresenting(null)}>
          <div className="qr-overlay-body" onClick={(e) => e.stopPropagation()}>
            {shown?.code ? (
              <>
                <h2>{presenting === 'next' ? 'Scan to register' : `Reassigned spot #${invites.indexOf(shown) + 1}`}</h2>
                <QrCode value={linkFor(shown.code)} size={Math.min(480, window.innerHeight - 220)} />
                <p className="qr-code-text">{shown.code}</p>
                {presenting === 'next' && <p className="hint">{countText}</p>}
              </>
            ) : (
              <h2>
                {presenting === 'next'
                  ? `All ${limit} spots are taken.`
                  : !shown
                    ? 'This spot was removed.'
                    : `Registered${shown.name ? ` as ${shown.name}` : ''} ✓`}
              </h2>
            )}
            <button onClick={() => setPresenting(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
