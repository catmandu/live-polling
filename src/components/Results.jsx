export default function Results({ options, totalVotes, myVote, onSelect, disabled, highlightLeader = true }) {
  const leader = Math.max(0, ...options.map((o) => o.votes));
  const interactive = typeof onSelect === 'function';

  return (
    <ul className="options" role={interactive ? 'radiogroup' : 'list'}>
      {options.map((o) => {
        const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
        const selected = myVote === o.id;
        const content = (
          <>
            <span className="bar" style={{ width: `${pct}%` }} />
            {interactive && <span className="radio">{selected ? '◉' : '○'}</span>}
            <span className="text">
              {o.name}
              {o.isMe && <span className="you"> (you)</span>}
              {highlightLeader && o.votes > 0 && o.votes === leader && ' 🏆'}
              {o.meta && <span className="meta">{o.meta}</span>}
            </span>
            <span className="count">
              {o.votes} · {pct}%
            </span>
          </>
        );
        return (
          <li key={o.id} className={selected ? 'selected' : ''}>
            {interactive ? (
              <button
                className="option"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(o.id)}
                disabled={disabled || o.disabled}
                title={o.disabledReason}
              >
                {content}
              </button>
            ) : (
              <div className="option static">{content}</div>
            )}
            {o.action}
          </li>
        );
      })}
    </ul>
  );
}
