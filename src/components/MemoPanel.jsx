import { useCallback, useEffect, useState } from 'react';
import CitationList from './CitationList.jsx';
import { formatTimestamp } from '../utils/format.js';
import { renderMarkdownLite } from '../utils/markdownLite.jsx';

const STATUS = { LOADING: 'loading', MISSING: 'missing', READY: 'ready', GENERATING: 'generating', ERROR: 'error' };

export default function MemoPanel({ fips, bucket }) {
  const [status, setStatus] = useState(STATUS.LOADING);
  const [memo, setMemo] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus(STATUS.LOADING);
    try {
      const res = await fetch(`/api/counties/${fips}/memo`);
      if (res.status === 404) {
        setStatus(STATUS.MISSING);
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Failed to load memo');
      setMemo(body);
      setStatus(STATUS.READY);
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.ERROR);
    }
  }, [fips]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = useCallback(async () => {
    setStatus(STATUS.GENERATING);
    setError(null);
    try {
      const res = await fetch(`/api/counties/${fips}/memo`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Memo generation failed');
      setMemo(body);
      setStatus(STATUS.READY);
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.ERROR);
    }
  }, [fips]);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Justification memo</h3>

      {status === STATUS.LOADING && <p style={{ color: '#8899aa' }}>Checking for an existing memo...</p>}

      {status === STATUS.MISSING && (
        <div>
          <p style={{ color: '#8899aa' }}>No memo generated yet for this county.</p>
          <button onClick={generate} style={buttonStyle}>
            Generate memo (~10 credits, calls /v1/ask, 10-20s)
          </button>
        </div>
      )}

      {status === STATUS.GENERATING && <p style={{ color: '#8899aa' }}>Calling /v1/ask — this typically takes 10-20 seconds...</p>}

      {status === STATUS.ERROR && (
        <div>
          <p style={{ color: '#ff5252' }}>{error}</p>
          <button onClick={load} style={buttonStyle}>
            Retry
          </button>
        </div>
      )}

      {status === STATUS.READY && memo && (
        <div>
          <div style={{ fontSize: '0.8rem', color: '#8899aa', marginBottom: '0.5rem' }}>
            Answered {formatTimestamp(memo.answered_at)} · confidence: {memo.confidence}
            {memo.bucket && memo.bucket !== bucket && (
              <span style={{ color: '#ffab00' }}> · note: bucket has changed since this memo was generated ({memo.bucket} → {bucket})</span>
            )}
          </div>
          <details style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#8899aa' }}>
            <summary style={{ cursor: 'pointer' }}>Question asked</summary>
            <p style={{ marginTop: '0.5rem' }}>{memo.question}</p>
          </details>
          <div style={{ lineHeight: 1.5 }}>{renderMarkdownLite(memo.answer)}</div>
          {memo.data_gaps && memo.data_gaps.length > 0 && (
            <p style={{ color: '#ffab00', fontSize: '0.85rem' }}>Data gaps: {memo.data_gaps.join(', ')}</p>
          )}
          <h4 style={{ fontSize: '0.85rem', margin: '1rem 0 0.5rem', color: '#8899aa' }}>Sources</h4>
          <CitationList citations={memo.citations} />
          <button onClick={generate} style={{ ...buttonStyle, marginTop: '0.75rem' }}>
            Regenerate memo
          </button>
        </div>
      )}
    </div>
  );
}

const buttonStyle = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: '1px solid #2a3548',
  background: '#1c2536',
  color: '#e6edf3',
  cursor: 'pointer',
  fontSize: '0.85rem',
};
