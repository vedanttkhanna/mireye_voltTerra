import { formatTimestamp } from '../utils/format.js';

/** Renders Mireye's per-field citation objects: source, source_url, confidence, fetched_at. */
export default function CitationList({ citations }) {
  if (!citations || citations.length === 0) return null;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.82rem', color: 'var(--fg-muted, #64748b)' }}>
      {citations.map((c, i) => (
        <li key={i} style={{ marginBottom: '0.4rem', lineHeight: 1.4 }}>
          <a href={c.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-darker, #047857)', fontWeight: 600 }}>
            {c.source}
          </a>
          {c.confidence && <span> · confidence: {c.confidence}</span>}
          {c.fetched_at && <span> · fetched {formatTimestamp(c.fetched_at)}</span>}
          {c.fields && c.fields.length > 0 && <div style={{ marginTop: '0.1rem', fontSize: '0.78rem' }}>fields: {c.fields.join(', ')}</div>}
        </li>
      ))}
    </ul>
  );
}
