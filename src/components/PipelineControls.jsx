import { useState } from 'react';
import { formatTimestamp } from '../utils/format.js';

export default function PipelineControls({ status, onRerun }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const lastJoin = status?.last_join_pipeline_run;
  const lastScore = status?.last_scored_counties_run;

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

  return (
    <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          <div>
            <strong style={{ color: 'var(--fg)' }}>Last sweep:</strong> {formatTimestamp(lastJoin?.generated_at)}
            {lastJoin && ` (${lastJoin.counties_processed} counties, ${lastJoin.credits_spent} credits, ${lastJoin.lookup_mismatches} lookup mismatches)`}
          </div>
          <div>
            <strong style={{ color: 'var(--fg)' }}>Last scored:</strong> {formatTimestamp(lastScore?.scored_at)}
            {lastScore &&
              ` (${lastScore.counties_underserved} underserved: ${lastScore.counties_fund_charger_now} charger now, ${lastScore.counties_fund_grid_upgrade_first} grid upgrade first, ${lastScore.counties_insufficient_data ?? 0} review)`}
          </div>
        </div>
        <button
          onClick={rerun}
          disabled={running}
          style={{
            padding: '0.55rem 1.15rem',
            borderRadius: 7,
            border: '1px solid var(--accent)',
            background: running ? 'var(--accent-light)' : 'var(--accent)',
            color: running ? 'var(--accent-darker)' : '#ffffff',
            fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
            fontSize: '0.875rem',
            whiteSpace: 'nowrap',
            boxShadow: running ? 'none' : '0 2px 6px var(--accent-shadow)',
            transition: 'all 0.15s ease',
          }}
        >
          {running ? 'Running sweep...' : 'Re-run full sweep'}
        </button>
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
