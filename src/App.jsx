import { useState } from 'react';
import { useApi } from './hooks/useApi.js';
import RankedTable from './components/RankedTable.jsx';
import CountyDrilldown from './components/CountyDrilldown.jsx';
import PipelineControls from './components/PipelineControls.jsx';
import CountyMap from './components/CountyMap.jsx';
import ChatPanel from './components/ChatPanel.jsx';

export default function App() {
  const { data: statsData, error: statsError, loading: statsLoading, refetch: refetchStats } = useApi('/api/counties/stats');
  const { data: statusData, refetch: refetchStatus } = useApi('/api/pipeline/status');
  const [selectedFips, setSelectedFips] = useState(null);
  const [activePanel, setActivePanel] = useState(null);

  const handleRerun = () => {
    refetchStats();
    refetchStatus();
  };

  const selectedCounty = statsData?.counties?.find((c) => c.county_fips === selectedFips) ?? null;
  const togglePanel = (panel) => setActivePanel((current) => current === panel ? null : panel);

  return (
    <main className="map-first-app">
      <div className="map-background-layer">
        <CountyMap
          selectedFips={selectedFips}
          onSelectCounty={setSelectedFips}
          toolbarAction={<PipelineControls status={statusData} onRerun={handleRerun} compact />}
          backgroundMode
        />
      </div>

      <header className="map-brand-overlay">
        <h1>VOLT-TERRA</h1>
      </header>

      <nav className="map-panel-nav" aria-label="Workspace panels">
        <button
          className={activePanel === 'demand' ? 'active' : ''}
          onClick={() => togglePanel('demand')}
        >
          County Demand
        </button>
        <button
          className={activePanel === 'chat' ? 'active' : ''}
          onClick={() => togglePanel('chat')}
        >
          AI Chat
        </button>
      </nav>

      {statsLoading && <div className="map-status-overlay">Loading scored counties...</div>}
      {statsError && (
        <div className="map-status-overlay error">
          {statsError}. Run <code>npm run pipeline:run</code> then <code>npm run pipeline:score</code>, or use the re-run button below.
        </div>
      )}

      {statsData && activePanel && (
        <aside className={`map-side-panel ${activePanel === 'demand' ? 'demand-panel' : 'chat-panel'}`}>
          <div className="map-side-panel-heading">
            <strong>{activePanel === 'demand' ? 'County Demand' : 'Autonomous Agent'}</strong>
            <button onClick={() => setActivePanel(null)} aria-label="Close panel">✕</button>
          </div>

          {activePanel === 'chat' ? (
            <div className="map-side-panel-body chat-body">
              <ChatPanel selectedCounty={selectedCounty} onSelectCounty={setSelectedFips} />
            </div>
          ) : (
            <div className="map-side-panel-body demand-body">
              <p className="demand-summary">
                Median <strong>{statsData.state_median_driver_to_plug_ratio?.toFixed(1)}</strong> EVs/port ·{' '}
                <strong>{statsData.counties_underserved}</strong> of {statsData.counties.length} counties flagged
              </p>
              <RankedTable counties={statsData.counties} selectedFips={selectedFips} onSelect={setSelectedFips} />
              {selectedFips && (
                <div className="overlay-drilldown">
                  <CountyDrilldown fips={selectedFips} />
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </main>
  );
}
