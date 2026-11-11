import { useState } from 'react';

const inviteLink = (code) => `${window.location.origin}/?invite=${code}`;

export default function InvitesPanel({ socket, invites, connected }) {
  const [names, setNames] = useState('');
  const [blank, setBlank] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);

  const create = (e) => {
    e.preventDefault();
    const list = names.split('\n').map((n) => n.trim()).filter(Boolean);
    socket.emit('createInvites', { names: list, blank: Number(blank) || 0 }, (res) => {
      if (res?.error) return setError(res.error);
      setError('');
      setNames('');
      setBlank('');
    });
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  };

  const revoke = (inv) => {
    const label = inv.name || inv.code;
    if (window.confirm(`Revoke the invite for ${label}? Their votes are removed too.`)) {
      socket.emit('revokeInvite', inv.id);
    }
  };

  const pending = invites.filter((i) => !i.joined);

  return (
    <section className="invites">
      <h2>Invites</h2>
      <form onSubmit={create} className="invite-form">
        <textarea
          rows={3}
          placeholder={'One name per line (optional)\nAlice\nBob'}
          value={names}
          onChange={(e) => setNames(e.target.value)}
        />
        <div className="invite-form-row">
          <label>
            Open invites (participant picks a name)
            <input
              type="number"
              min="0"
              max="200"
              value={blank}
              onChange={(e) => setBlank(e.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={!connected || (!names.trim() && !Number(blank))}>
            Create invites
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}

      {invites.length > 0 && (
        <>
          {pending.length > 0 && (
            <button
              className="link"
              onClick={() =>
                copy(
                  pending.map((i) => `${i.name || 'Open invite'}: ${inviteLink(i.code)}`).join('\n'),
                  'all'
                )
              }
            >
              {copied === 'all' ? 'Copied!' : `Copy all ${pending.length} pending links`}
            </button>
          )}
          <table className="invite-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Status</th>
                <th>Last IP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.name || <em>open</em>}</td>
                  <td><code>{inv.code}</code></td>
                  <td>
                    <span className={`pill ${inv.joined ? 'joined' : 'pending'}`}>
                      {inv.joined ? (inv.voted ? 'voted' : 'joined') : inv.lastIp ? 'choosing name' : 'pending'}
                    </span>
                  </td>
                  <td className="meta">{inv.lastIp || '—'}</td>
                  <td className="row-actions">
                    <button onClick={() => copy(inviteLink(inv.code), inv.id)}>
                      {copied === inv.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button className="remove" title="Revoke invite" onClick={() => revoke(inv)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
