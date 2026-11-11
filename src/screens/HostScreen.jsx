import { useEffect, useState } from 'react';
import { usePollSocket } from '../usePollSocket.js';
import Results from '../components/Results.jsx';
import InvitesPanel from '../components/InvitesPanel.jsx';

export default function HostScreen({ token, onLogout, onUnauthorized }) {
  const { socket, state, invites, connected } = usePollSocket('host', { token, onUnauthorized });
  const [questionDraft, setQuestionDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setQuestionDraft(state.question);
  }, [state.question, editing]);

  const joinUrl = `${window.location.origin}${window.location.pathname}`;

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
            {connected ? '● Host · Live' : '○ Reconnecting…'}
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
          Participants need an invite link or code from the list below. Code entry page:{' '}
          <a href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a>
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
          onClick={confirmThen('Revoke all invites and remove all votes?', () => socket.emit('resetAll'))}
          disabled={!connected || invites.length === 0}
        >
          Clear everything
        </button>
      </div>

      <div className="stats">
        <div><strong>{invites.length}</strong><span>invites</span></div>
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
                  onClick={confirmThen(`Remove ${o.name} and revoke their invite?`, () =>
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

      <InvitesPanel socket={socket} invites={invites} connected={connected} />
    </main>
  );
}
