/** Renders one /v1/fetch response's {field: {value, source, source_url, confidence, status}} map, cited per-field. */
export default function FieldCitations({ fields }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.82rem' }}>
      {Object.entries(fields ?? {}).map(([field, v]) => (
        <div key={field} style={{ borderBottom: '1px solid var(--card-border, #e2e8f0)', paddingBottom: '0.35rem' }}>
          <strong style={{ color: 'var(--fg, #0f172a)' }}>{field}</strong>: {v.status === 'ok' ? String(v.value) : `(${v.status})`}
          {v.source && (
            <span style={{ color: 'var(--fg-muted, #64748b)' }}>
              {' '}
              — <a href={v.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-darker, #047857)', fontWeight: 600 }}>{v.source}</a>
              {v.confidence && <span>, confidence: {v.confidence}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
