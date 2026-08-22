import { formatTimestamp } from '../utils/format.js';

/** Renders Mireye's per-field citation objects: source, source_url, confidence, fetched_at. */
export default function CitationList({ citations }) {
  if (!citations || citations.length === 0) return null;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.8rem', color: '#8899aa' }}>
      {citations.map((c, i) => (
        <li key={i} style={{ marginBottom: '0.35rem' }}>
          <a href={c.source_url} target="_blank" rel="noreferrer" style={{ color: '#5fb3ff' }}>
            {c.source}
          </a>
          {c.confidence && <span> · confidence: {c.confidence}</span>}
          {c.fetched_at && <span> · fetched {formatTimestamp(c.fetched_at)}</span>}
          {c.fields && c.fields.length > 0 && <div style={{ marginTop: '0.1rem' }}>fields: {c.fields.join(', ')}</div>}
        </li>
      ))}
    </ul>
  );
}
