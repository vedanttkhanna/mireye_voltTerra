import { useState } from 'react';
import { useApi } from './hooks/useApi.js';
import RankedTable from './components/RankedTable.jsx';
import CountyDrilldown from './components/CountyDrilldown.jsx';
import PipelineControls from './components/PipelineControls.jsx';
import CountyMap from './components/CountyMap.jsx';

// Thin, read-only layer over the agent loop's output: the backend decides
// (join pipeline -> scoring -> bucketing), this just renders the decision
// and lets an analyst inspect it, request a re-run, or generate a memo.
// No join/scoring logic runs here.
export default function App() {
  const { data: health } = useApi('/api/health');
  const { data: statsData, error: statsError, loading: statsLoading, refetch: refetchStats } = useApi('/api/counties/stats');
  const { data: statusData, refetch: refetchStatus } = useApi('/api/pipeline/status');
  const [selectedFips, setSelectedFips] = useState(null);

  const handleRerun = () => {
    refetchStats();
    refetchStatus();
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: 1440, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.75rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.02em' }}>VOLT-TERRA</h1>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, background: 'var(--accent-light)', color: 'var(--accent-darker)', border: '1px solid var(--accent-border)', padding: '0.15rem 0.5rem', borderRadius: 999 }}>
            LIVE PILOT
          </span>
        </div>
        <p style={{ color: 'var(--fg-muted)', margin: 0, fontSize: '0.95rem' }}>
          County charging-gap &amp; grid-feasibility orchestrator | {health ? (health.ok ? `connected, pilot state ${health.pilot_state}` : 'backend unreachable') : 'checking...'}
        </p>
      </header>

      <PipelineControls status={statusData} onRerun={handleRerun} />

      {statsLoading && <p style={{ color: 'var(--fg-muted)' }}>Loading scored counties...</p>}
      {statsError && (
        <p style={{ color: 'var(--danger)' }}>
          {statsError}. Run <code>npm run pipeline:run</code> then <code>npm run pipeline:score</code>, or use the re-run button above.
        </p>
      )}

      {statsData && (
        <>
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--fg)' }}>Recommended counties</h2>
            <CountyMap />
          </section>

          <div className={`main-layout${selectedFips ? ' with-drilldown' : ''}`}>
            <div>
              <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                State median: <strong>{statsData.state_median_driver_to_plug_ratio?.toFixed(1)}</strong> EVs/port · threshold:{' '}
                <strong>{statsData.underserved_threshold_multiplier}x median</strong> · <strong>{statsData.counties_underserved}</strong> of {statsData.counties.length} counties flagged
              </p>
              <RankedTable counties={statsData.counties} selectedFips={selectedFips} onSelect={setSelectedFips} />
            </div>

            {selectedFips && (
              <div style={{ borderLeft: '1px solid var(--card-border)', paddingLeft: '2rem' }}>
                <CountyDrilldown fips={selectedFips} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
