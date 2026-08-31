import { useCallback, useEffect, useState } from 'react';
import CitationList from './CitationList.jsx';
import { formatTimestamp } from '../utils/format.js';
import { renderMarkdownLite } from '../utils/markdownLite.jsx';
import { readJsonResponse } from '../utils/http.js';

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
      const body = await readJsonResponse(res, `GET /api/counties/${fips}/memo`);
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
      const body = await readJsonResponse(res, `POST /api/counties/${fips}/memo`);
      setMemo(body);
      setStatus(STATUS.READY);
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.ERROR);
    }
  }, [fips]);

  return (
    <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: 'var(--fg)' }}>Justification memo</h3>

      {status === STATUS.LOADING && <p style={{ color: 'var(--fg-muted)' }}>Checking for an existing memo...</p>}

      {status === STATUS.MISSING && (
        <div>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.9rem', marginBottom: '0.85rem' }}>No memo generated yet for this county.</p>
          <button onClick={generate} style={buttonStyle}>
            Generate memo (~10 credits, calls /v1/ask, 10-20s)
          </button>
        </div>
      )}

      {status === STATUS.GENERATING && (
        <p style={{ color: 'var(--accent-darker)', fontWeight: 500, fontSize: '0.9rem' }}>
          Calling Mireye /v1/ask (typically takes 10-20 seconds)...
        </p>
      )}

      {status === STATUS.ERROR && (
        <div>
          <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</p>
          <button onClick={load} style={buttonStyle}>
            Retry
          </button>
        </div>
      )}

      {status === STATUS.READY && memo && (
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
            Answered {formatTimestamp(memo.answered_at)} · confidence: <strong style={{ color: 'var(--accent-darker)' }}>{memo.confidence}</strong>
            {memo.bucket && memo.bucket !== bucket && (
              <span style={{ color: 'var(--warn-dark)' }}> · note: bucket has changed ({memo.bucket} → {bucket})</span>
            )}
          </div>
          <details style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--fg-muted)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent-darker)' }}>Question asked</summary>
            <p style={{ marginTop: '0.5rem', padding: '0.6rem', background: 'var(--bg)', borderRadius: 6, color: 'var(--fg)' }}>
              {memo.question}
            </p>
          </details>
          <div style={{ lineHeight: 1.6, color: 'var(--fg)', fontSize: '0.92rem' }}>
            {renderMarkdownLite(memo.answer)}
          </div>
          {memo.data_gaps && memo.data_gaps.length > 0 && (
            <p style={{ color: 'var(--warn-dark)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
              <strong>Data gaps:</strong> {memo.data_gaps.join(', ')}
            </p>
          )}
          <h4 style={{ fontSize: '0.9rem', margin: '1.25rem 0 0.5rem', color: 'var(--fg)' }}>Sources</h4>
          <CitationList citations={memo.citations} />
          <button onClick={generate} style={{ ...buttonStyle, marginTop: '1rem' }}>
            Regenerate memo
          </button>
        </div>
      )}
    </div>
  );
}

const buttonStyle = {
  padding: '0.5rem 1rem',
  borderRadius: 7,
  border: '1px solid var(--accent)',
  background: 'var(--accent-light)',
  color: 'var(--accent-darker)',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.85rem',
  transition: 'all 0.15s ease',
};
