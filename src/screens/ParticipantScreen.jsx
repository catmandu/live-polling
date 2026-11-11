import { useEffect, useState } from 'react';
import { usePollSocket } from '../usePollSocket.js';
import { captureInviteFromUrl, setInviteCode } from '../socket.js';
import Results from '../components/Results.jsx';

captureInviteFromUrl();

export default function ParticipantScreen() {
  const { socket, state, me, connected } = usePollSocket('participant');
  const [codeDraft, setCodeDraft] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // The server rejected or revoked the stored code: forget it in this browser.
  useEffect(() => {
    if (me.revoked) {
      setInviteCode('');
      setError(me.error || 'Your invite is no longer valid. Ask the host for a new one.');
    }
  }, [me]);

  const redeem = (e) => {
    e.preventDefault();
    socket.emit('redeem', codeDraft, (res) => {
      if (res?.error) return setError(res.error);
      setInviteCode(res.code);
      setCodeDraft('');
      setError('');
    });
  };

  const claimName = (e) => {
    e.preventDefault();
    socket.emit('setName', name, (res) => setError(res?.error ?? ''));
  };

  const signOut = () => {
    if (!window.confirm('Sign out of this browser? You will need your invite code to get back in.')) return;
    setInviteCode('');
    socket.emit('signOut');
  };

  const vote = (candidateId) => {
    if (candidateId === me.vote) socket.emit('unvote');
    else socket.emit('vote', candidateId, (res) => setError(res?.error ?? ''));
  };

  let identity;
  if (!me.hasInvite) {
    identity = (
      <form onSubmit={redeem} className="add-form">
        <input
          autoFocus
          placeholder="Enter your invite code"
          value={codeDraft}
          maxLength={32}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
        />
        <button type="submit" disabled={!codeDraft.trim() || !connected}>
          Join
        </button>
      </form>
    );
  } else if (me.needsName) {
    identity = (
      <form onSubmit={claimName} className="add-form">
        <input
          autoFocus
          placeholder="Your name (shown as a voting option)"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!name.trim() || !connected}>
          Continue
        </button>
      </form>
    );
  } else {
    identity = (
      <div className="joined-bar">
        <span>
          Signed in as <strong>{me.name}</strong>
        </span>
        <button className="link" onClick={signOut}>
          Sign out of this browser
        </button>
      </div>
    );
  }

  return (
    <main className="container">
      <header className="header">
        <span className={`status ${connected ? 'on' : 'off'}`}>
          {connected ? '● Live' : '○ Reconnecting…'}
        </span>
        <h1>{state.question}</h1>
      </header>

      {identity}
      {error && <p className="error">{error}</p>}
      {!me.hasInvite && !error && (
        <p className="hint">Use the invite link or code the host gave you.</p>
      )}

      {me.joined && (
        <p className={`banner ${state.votingOpen ? 'open' : 'closed'}`}>
          {state.votingOpen
            ? me.vote
              ? 'Vote recorded. Pick someone else to change it, or click your choice again to remove it.'
              : 'Pick one other participant to vote for (you can’t vote for yourself).'
            : 'Voting is closed.'}
        </p>
      )}

      {state.options.length === 0 ? (
        <p className="empty">No participants have joined yet.</p>
      ) : (
        <Results
          options={state.options.map((o) => {
            const isMe = o.id === me.id;
            return {
              ...o,
              isMe,
              disabled: isMe,
              disabledReason: isMe ? "You can't vote for yourself" : undefined,
            };
          })}
          totalVotes={state.totalVotes}
          myVote={me.vote}
          onSelect={me.joined ? vote : undefined}
          disabled={!connected || !state.votingOpen}
        />
      )}

      <footer className="footer">
        {state.options.length} participant{state.options.length === 1 ? '' : 's'} ·{' '}
        {state.totalVotes} vote{state.totalVotes === 1 ? '' : 's'}
      </footer>
    </main>
  );
}
