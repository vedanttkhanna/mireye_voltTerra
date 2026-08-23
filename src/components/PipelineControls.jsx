import { useState } from 'react';

export default function PipelineControls({ status, onRerun, compact = false }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const lastJoin = status?.last_join_pipeline_run;

  const rerun = async () => {
    const confirmed = window.confirm(
      'Re-run the full sweep? This re-fetches grid data for every county from the Mireye API ' +
        `(last run: ~${lastJoin?.credits_spent ?? 5000} credits, ${lastJoin?.sample_points_total ?? 232} sample points) ` +
        'and typically takes a few minutes.'
    );
    if (!confirmed) return;

    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/pipeline/run', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Sweep failed');
      setResult(body);
      onRerun?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const button = (
    <button
      onClick={rerun}
      disabled={running}
      style={{
        padding: compact ? '0.4rem 0.85rem' : '0.55rem 1.15rem',
        borderRadius: 7,
        border: '1px solid var(--accent)',
        background: running ? 'var(--accent-light)' : 'var(--accent)',
        color: running ? 'var(--accent-darker)' : '#ffffff',
        fontWeight: 600,
        cursor: running ? 'default' : 'pointer',
        fontSize: compact ? '0.8rem' : '0.875rem',
        whiteSpace: 'nowrap',
        boxShadow: running ? 'none' : '0 2px 6px var(--accent-shadow)',
        transition: 'all 0.15s ease',
      }}
    >
      {running ? 'Running sweep...' : 'Re-run full sweep'}
    </button>
  );

  if (compact) {
    return (
      <div title={error || (result ? 'Sweep completed successfully' : undefined)}>
        {button}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {button}
      </div>
      {error && <p style={{ color: 'var(--danger)', marginTop: '0.75rem', marginBottom: 0, fontSize: '0.85rem' }}>{error}</p>}
      {result && (
        <p style={{ color: 'var(--accent-darker)', marginTop: '0.75rem', marginBottom: 0, fontSize: '0.85rem', fontWeight: 600 }}>
          ✓ Done: {result.sweep?.counties_processed} counties processed, {result.scoring?.counties_underserved} underserved.
        </p>
      )}
    </div>
  );
}
