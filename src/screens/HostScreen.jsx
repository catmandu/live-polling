import { useEffect, useState } from 'react';
import { usePollSocket } from '../usePollSocket.js';
import Results from '../components/Results.jsx';
import InvitesPanel from '../components/InvitesPanel.jsx';

export default function HostScreen({ token, onLogout, onUnauthorized }) {
  const { socket, state, registry, connected } = usePollSocket('host', { token, onUnauthorized });
  const { invites, limit } = registry;
  const [questionDraft, setQuestionDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setQuestionDraft(state.question);
  }, [state.question, editing]);

  const saveQuestion = (e) => {
    e.preventDefault();
    if (questionDraft.trim()) socket.emit('setQuestion', questionDraft);
    setEditing(false);
  };

  const confirmThen = (msg, fn) => () => window.confirm(msg) && fn();

  return (
    <main className="container wide">
      <header className="header">
        <div className="host-topbar">
          <span className={`status ${connected ? 'on' : 'off'}`}>
            {connected ? '● Anfitrión · Online' : '○ Reconectando…'}
          </span>
          <button className="link" onClick={onLogout}>
            Log out
          </button>
        </div>
        <form onSubmit={saveQuestion} className="title-form">
          <input
            aria-label="Poll question"
            value={questionDraft}
            maxLength={200}
            onFocus={() => setEditing(true)}
            onChange={(e) => setQuestionDraft(e.target.value)}
            onBlur={saveQuestion}
          />
        </form>
        <p className="subtitle">
          Participants register by scanning the QR code below — one code per person.
        </p>
      </header>

      <div className="host-controls">
        <button
          className={state.votingOpen ? 'danger' : 'primary'}
          onClick={() => socket.emit('setVotingOpen', !state.votingOpen)}
          disabled={!connected}
        >
          {state.votingOpen ? 'Close voting' : 'Open voting'}
        </button>
        <button
          onClick={confirmThen('Clear all votes?', () => socket.emit('resetVotes'))}
          disabled={!connected || state.totalVotes === 0}
        >
          Reset votes
        </button>
        <button
          onClick={confirmThen(
            `Start a new run? All registrations and votes are removed and ${limit} new spots are created.`,
            () => socket.emit('resetAll')
          )}
          disabled={!connected}
        >
          New run
        </button>
      </div>

      <div className="stats">
        <div><strong>{invites.filter((i) => i.status !== 'open').length}/{limit}</strong><span>registered</span></div>
        <div><strong>{state.options.length}</strong><span>joined</span></div>
        <div><strong>{state.votersCount}</strong><span>voted</span></div>
        <div><strong>{state.votingOpen ? 'Open' : 'Closed'}</strong><span>voting</span></div>
      </div>

      {state.options.length === 0 ? (
        <p className="empty">Waiting for participants to join…</p>
      ) : (
        <Results
          options={[...state.options]
            .sort((a, b) => b.votes - a.votes)
            .map((o) => ({
              ...o,
              meta: invites.find((i) => i.id === o.id)?.lastIp,
              action: (
                <button
                  className="remove"
                  title={`Remove ${o.name}`}
                  onClick={confirmThen(`Remove ${o.name} and free their spot?`, () =>
                    socket.emit('revokeInvite', o.id)
                  )}
                >
                  ✕
                </button>
              ),
            }))}
          totalVotes={state.totalVotes}
        />
      )}

      <InvitesPanel socket={socket} registry={registry} connected={connected} />
    </main>
  );
}
