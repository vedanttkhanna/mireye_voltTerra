import { useState } from 'react';
import { useApi } from './hooks/useApi.js';
import RankedTable from './components/RankedTable.jsx';
import CountyDrilldown from './components/CountyDrilldown.jsx';
import PipelineControls from './components/PipelineControls.jsx';
import CountyMap from './components/CountyMap.jsx';
import ChatPanel from './components/ChatPanel.jsx';

export default function App() {
  const { data: health } = useApi('/api/health');
  const { data: statsData, error: statsError, loading: statsLoading, refetch: refetchStats } = useApi('/api/counties/stats');
  const { data: statusData, refetch: refetchStatus } = useApi('/api/pipeline/status');
  const [selectedFips, setSelectedFips] = useState(null);

  const handleRerun = () => {
    refetchStats();
    refetchStatus();
  };

  const selectedCounty = statsData?.counties?.find((c) => c.county_fips === selectedFips) ?? null;

  return (
    <div style={{ padding: '1.75rem 2rem', maxWidth: 1560, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
          <div style={{ width: 13, height: 13, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
          <h1 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.02em' }}>VOLT-TERRA</h1>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, background: 'var(--accent-light)', color: 'var(--accent-darker)', border: '1px solid var(--accent-border)', padding: '0.15rem 0.5rem', borderRadius: 999 }}>
            LIVE PILOT: CALIFORNIA
          </span>
        </div>
        <p style={{ color: 'var(--fg-muted)', margin: 0, fontSize: '0.9rem' }}>
          County charging-gap &amp; grid-feasibility agentic orchestrator | {health ? (health.ok ? `connected, pilot state ${health.pilot_state}` : 'backend unreachable') : 'checking...'}
        </p>
      </header>

      {statsLoading && <p style={{ color: 'var(--fg-muted)' }}>Loading scored counties...</p>}
      {statsError && (
        <p style={{ color: 'var(--danger)' }}>
          {statsError}. Run <code>npm run pipeline:run</code> then <code>npm run pipeline:score</code>, or use the re-run button below.
        </p>
      )}

      {statsData && (
        <>
          {/* Main Dual-Pane Workspace: Map on Left, AI Chat on Right */}
          <section className="workspace-grid" style={{ marginBottom: '2rem' }}>
            <div className="workspace-map-pane">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: 'var(--fg)' }}>
                  Statewide Feasibility Map
                </h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
                  {statsData.counties_underserved} flagged counties
                </span>
              </div>
              <CountyMap selectedFips={selectedFips} onSelectCounty={setSelectedFips} />
            </div>

            <div className="workspace-chat-pane">
              <ChatPanel selectedCounty={selectedCounty} onSelectCounty={setSelectedFips} />
            </div>
          </section>

          <PipelineControls status={statusData} onRerun={handleRerun} />

          {/* Lower Analytics Section: Ranked Table & Drilldown */}
          <section style={{ marginTop: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: 'var(--fg)' }}>
                County Demand &amp; Infrastructure Rankings
              </h2>
              <p style={{ color: 'var(--fg-muted)', fontSize: '0.85rem', margin: 0 }}>
                State median: <strong>{statsData.state_median_driver_to_plug_ratio?.toFixed(1)}</strong> EVs/port · threshold:{' '}
                <strong>{statsData.underserved_threshold_multiplier}x median</strong> · <strong>{statsData.counties_underserved}</strong> of {statsData.counties.length} counties flagged
              </p>
            </div>

            <div className={`main-layout${selectedFips ? ' with-drilldown' : ''}`}>
              <div>
                <RankedTable counties={statsData.counties} selectedFips={selectedFips} onSelect={setSelectedFips} />
              </div>

              {selectedFips && (
                <div style={{ borderLeft: '1px solid var(--card-border)', paddingLeft: '1.75rem' }}>
                  <CountyDrilldown fips={selectedFips} />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
