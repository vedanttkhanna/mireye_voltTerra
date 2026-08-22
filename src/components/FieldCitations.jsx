/** Renders one /v1/fetch response's {field: {value, source, source_url, confidence, status}} map, cited per-field. */
export default function FieldCitations({ fields }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {Object.entries(fields ?? {}).map(([field, v]) => (
        <div key={field} style={{ borderBottom: '1px solid #1c2536', paddingBottom: '0.4rem' }}>
          <strong>{field}</strong>: {v.status === 'ok' ? String(v.value) : `(${v.status})`}
          {v.source && (
            <span style={{ color: '#8899aa' }}>
              {' '}
              — <a href={v.source_url} target="_blank" rel="noreferrer" style={{ color: '#5fb3ff' }}>{v.source}</a>, confidence: {v.confidence}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
