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
    <div style={{ background: '#0f1522', border: '1px solid #1c2536', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ fontSize: '0.85rem', color: '#8899aa' }}>
          <div>
            Last sweep: {formatTimestamp(lastJoin?.generated_at)}
            {lastJoin && ` (${lastJoin.counties_processed} counties, ${lastJoin.credits_spent} credits, ${lastJoin.lookup_mismatches} lookup mismatches)`}
          </div>
          <div>
            Last scored: {formatTimestamp(lastScore?.scored_at)}
            {lastScore &&
              ` (${lastScore.counties_underserved} underserved — ${lastScore.counties_fund_charger_now} charger now, ${lastScore.counties_fund_grid_upgrade_first} grid upgrade first, ${lastScore.counties_insufficient_data ?? 0} need review)`}
          </div>
        </div>
        <button
          onClick={rerun}
          disabled={running}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 6,
            border: '1px solid #2a3548',
            background: running ? '#1c2536aa' : '#1c2536',
            color: '#e6edf3',
            cursor: running ? 'default' : 'pointer',
            fontSize: '0.85rem',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Running sweep...' : 'Re-run full sweep'}
        </button>
      </div>
      {error && <p style={{ color: '#ff5252', marginTop: '0.5rem', marginBottom: 0 }}>{error}</p>}
      {result && (
        <p style={{ color: '#00e676', marginTop: '0.5rem', marginBottom: 0, fontSize: '0.85rem' }}>
          Done — {result.sweep?.counties_processed} counties, {result.scoring?.counties_underserved} underserved.
        </p>
      )}
    </div>
  );
}
