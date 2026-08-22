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
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 1400, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>VOLT-TERRA</h1>
        <p style={{ color: '#8899aa', margin: 0 }}>
          County charging-gap &amp; grid-feasibility orchestrator — {health ? (health.ok ? `connected, pilot state ${health.pilot_state}` : 'backend unreachable') : 'checking...'}
        </p>
      </header>

      <PipelineControls status={statusData} onRerun={handleRerun} />

      {statsLoading && <p style={{ color: '#8899aa' }}>Loading scored counties...</p>}
      {statsError && (
        <p style={{ color: '#ff5252' }}>
          {statsError} — run <code>npm run pipeline:run</code> then <code>npm run pipeline:score</code>, or use the re-run button above.
        </p>
      )}

      {statsData && (
        <>
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Recommended counties</h2>
            <CountyMap />
          </section>

          <div className={`main-layout${selectedFips ? ' with-drilldown' : ''}`}>
            <div>
              <p style={{ color: '#8899aa', fontSize: '0.85rem' }}>
                State median: {statsData.state_median_driver_to_plug_ratio?.toFixed(1)} EVs/port · threshold:{' '}
                {statsData.underserved_threshold_multiplier}x median · {statsData.counties_underserved} of {statsData.counties.length} counties flagged
              </p>
              <RankedTable counties={statsData.counties} selectedFips={selectedFips} onSelect={setSelectedFips} />
            </div>

            {selectedFips && (
              <div style={{ borderLeft: '1px solid #1c2536', paddingLeft: '2rem' }}>
                <CountyDrilldown fips={selectedFips} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
