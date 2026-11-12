import { useEffect, useRef, useState } from 'react';
import { usePollSocket } from '../usePollSocket.js';
import { captureInviteFromUrl, getPendingCode, setKey, setPendingCode } from '../socket.js';
import Results from '../components/Results.jsx';

captureInviteFromUrl();

export default function ParticipantScreen() {
  const { socket, state, me, connected } = usePollSocket('participant');
  const [codeDraft, setCodeDraft] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState('');
  const redeeming = useRef(false);

  const handleRedeem = (res) => {
    if (res?.error) return setError(res.error);
    setKey(res.key);
    setCodeDraft('');
    setError('');
  };

  // Runs on every update from the server. The stored key is cleared first if it was rejected,
  // then a code from a scanned QR is redeemed, so the new key is never overwritten.
  useEffect(() => {
    if (me.revoked) {
      setKey('');
      setError(me.error || 'Tu registro ya no es válido.');
    }
    const pending = getPendingCode();
    if (!pending || !socket.connected || redeeming.current) return;
    redeeming.current = true;
    socket.emit('redeem', pending, (res) => {
      redeeming.current = false;
      setPendingCode('');
      handleRedeem(res);
    });
  }, [me]);

  const redeem = (e) => {
    e.preventDefault();
    socket.emit('redeem', codeDraft, handleRedeem);
  };

  const claimName = (e) => {
    e.preventDefault();
    socket.emit('setName', { name, topic }, (res) => setError(res?.error ?? ''));
  };

  const signOut = () => {
    const msg =
      'Sign out of this browser? Your spot stays in the poll, but you can only get back in if the host reassigns it to you.';
    if (!window.confirm(msg)) return;
    setKey('');
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
          placeholder="El código se muestra debajo del QR"
          value={codeDraft}
          maxLength={32}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
        />
        <button type="submit" disabled={!codeDraft.trim() || !connected}>
          Unirme
        </button>
      </form>
    );
  } else if (me.needsName) {
    identity = (
      <form onSubmit={claimName} className="register-form">
        <label>
          Tu nombre
          <input
            autoFocus
            placeholder="e.g. Alice"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Tema que presentaste
          <input
            placeholder="e.g. Por qué la tierra es plana"
            value={topic}
            maxLength={80}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        {name.trim() && topic.trim() && (
          <p className="hint">
            Conectado como: <strong>{name.trim()} — {topic.trim()}</strong>
          </p>
        )}
        <button type="submit" disabled={!name.trim() || !topic.trim() || !connected}>
          Continuar
        </button>
      </form>
    );
  } else {
    identity = (
      <div className="joined-bar">
        <span>
          Conectado como <strong>{me.topic ? `${me.name} — ${me.topic}` : me.name}</strong>
        </span>
        {/* <button className="link" onClick={signOut}>
          Cerrar sesión en este navegador
        </button> */}
      </div>
    );
  }

  return (
    <main className="container">
      <header className="header">
        <span className={`status ${connected ? 'on' : 'off'}`}>
          {connected ? '● En línea' : '○ Reconectando…'}
        </span>
        <h1>{state.question}</h1>
      </header>

      {identity}
      {error && <p className="error">{error}</p>}
      {!me.hasInvite && !error && (
        <p className="hint">Escanea el código QR en la pantalla del anfitrión para registrarte, o escribe el código que se muestra debajo.</p>
      )}

      {me.joined && (
        <p className={`banner ${state.votingOpen ? 'open' : 'closed'}`}>
          {state.votingOpen
            ? me.vote
              ? 'Voto registrado. Elige a otra persona para cambiarlo, o haz clic de nuevo en tu elección para eliminarlo.'
              : 'Elige a otro participante para votar (no puedes votarte a ti mismo).'
            : 'La votación está cerrada.'}
        </p>
      )}

      {state.options.length === 0 ? (
        <p className="empty">No hay participantes aún.</p>
      ) : (
        <Results
          options={state.options.map((o) => {
            const isMe = o.id === me.id;
            return {
              ...o,
              isMe,
              disabled: isMe,
              disabledReason: isMe ? "No puedes votar por ti" : undefined,
            };
          })}
          totalVotes={state.totalVotes}
          myVote={me.vote}
          onSelect={me.joined ? vote : undefined}
          disabled={!connected || !state.votingOpen}
        />
      )}

      <footer className="footer">
        {state.options.length} participante{state.options.length === 1 ? '' : 's'} ·{' '}
        {state.totalVotes} voto{state.totalVotes === 1 ? '' : 's'}
      </footer>
    </main>
  );
}
