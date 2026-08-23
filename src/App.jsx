import { useEffect, useRef, useState } from 'react';
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
  const [panelClosing, setPanelClosing] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const handleRerun = () => {
    refetchStats();
    refetchStatus();
  };

  const selectedCounty = statsData?.counties?.find((c) => c.county_fips === selectedFips) ?? null;
  const closePanel = () => {
    if (!activePanel || panelClosing) return;
    setPanelClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setActivePanel(null);
      setPanelClosing(false);
      setChatExpanded(false);
    }, 220);
  };
  const togglePanel = (panel) => {
    window.clearTimeout(closeTimer.current);
    if (activePanel === panel) {
      closePanel();
      return;
    }
    setPanelClosing(false);
    if (panel !== 'chat') setChatExpanded(false);
    setActivePanel(panel);
  };

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
        <aside
          key={activePanel}
          className={`map-side-panel ${activePanel === 'demand' ? 'demand-panel' : `chat-panel ${chatExpanded ? 'expanded' : 'compact'}`}${panelClosing ? ' closing' : ''}`}
        >
          {activePanel === 'demand' && (
            <div className="map-side-panel-heading">
              <strong>County Demand</strong>
              <div className="map-side-panel-actions">
                <button onClick={closePanel} aria-label="Close panel" title="Close">✕</button>
              </div>
            </div>
          )}

          {activePanel === 'chat' ? (
            <div className="map-side-panel-body chat-body">
              <ChatPanel
                selectedCounty={selectedCounty}
                onSelectCounty={setSelectedFips}
                chatExpanded={chatExpanded}
                onToggleExpand={() => setChatExpanded((value) => !value)}
                onClose={closePanel}
              />
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
