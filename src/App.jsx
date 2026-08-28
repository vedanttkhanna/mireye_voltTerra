import { useEffect, useRef, useState } from 'react';
import { useApi } from './hooks/useApi.js';
import RankedTable from './components/RankedTable.jsx';
import CountyDrilldown from './components/CountyDrilldown.jsx';
import CountyMap from './components/CountyMap.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import LandingPage from './components/LandingPage.jsx';
import RiderPanel from './components/RiderPanel.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import FacilityTypeView from './components/FacilityTypeView.jsx';
import RiderTypeView from './components/RiderTypeView.jsx';
import BucketBadge from './components/BucketBadge.jsx';
import ComparisonPanel from './components/ComparisonPanel.jsx';
import { usePostJson } from './hooks/useApi.js';

const STATE_NAMES = {
  CA: 'California', NV: 'Nevada', AZ: 'Arizona', OR: 'Oregon', WA: 'Washington',
  TX: 'Texas', UT: 'Utah', ID: 'Idaho', AL: 'Alabama', AK: 'Alaska', AR: 'Arkansas',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  VT: 'Vermont', VA: 'Virginia', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const NEIGHBORING_STATES = [
  { code: 'CA', name: 'California (Pilot)' },
  { code: 'NV', name: 'Nevada' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'OR', name: 'Oregon' },
  { code: 'WA', name: 'Washington' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'ID', name: 'Idaho' },
];

export default function App() {

  const [role, setRole] = useState('select'); // 'select' | 'facility' | 'rider'
  const [activeState, setActiveState] = useState('CA');
  const [agentFindings, setAgentFindings] = useState(null);
  const [liveResult, setLiveResult] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [quoteData, setQuoteData] = useState(null);
  const [inputMode, setInputMode] = useState('map'); // 'map' | 'type'
  const [typedPoint, setTypedPoint] = useState(null);
  const [riderResult, setRiderResult] = useState(null);
  const [riderFocusStation, setRiderFocusStation] = useState(null);
  const { run: runRiderCheck, loading: riderLoading, error: riderError } = usePostJson('/api/rider/check-point');
  const [selectedFips, setSelectedFips] = useState(null);
  const [activePanel, setActivePanel] = useState(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Fetch quote whenever activeState changes
  useEffect(() => {
    if (!activeState) return;
    fetch(`/api/live/quote/${activeState}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setQuoteData(data))
      .catch(() => setQuoteData(null));
  }, [activeState]);

  // Facility results only exist after the user launches a live sweep. This
  // deliberately does not fall back to the old California pipeline cache.
  const facilityData = (liveResult && liveResult.state === activeState) ? liveResult : null;
  const selectedCounty = facilityData?.counties?.find((c) => c.county_fips === selectedFips) ?? null;

  const closePanel = () => {
    if (!activePanel || panelClosing) return;
    setPanelClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setActivePanel(null);
      setPanelClosing(false);
      setChatExpanded(false);
    }, 220);
  };

  // Explicit, on-demand live sweep execution triggered ONLY when user presses the button
  const runLiveSweepForState = async (stateToSweep) => {
    const targetState = stateToSweep || activeState;
    if (!targetState) return;

    setLiveStatus({
      running: true,
      message: `Running live Mireye API sweep for ${STATE_NAMES[targetState] ?? targetState} counties…`,
    });

    try {
      const res = await fetch(`/api/live/sweep/${targetState}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Live sweep failed');
      setLiveResult(data);
      setLiveStatus({ running: false, message: `Live sweep complete for ${STATE_NAMES[targetState] ?? targetState}!` });
    } catch (err) {
      setLiveStatus({ running: false, error: err.message });
    }
  };

  const pickRiderPoint = async ({ lat, lng }) => {
    setRiderFocusStation(null);
    try {
      setRiderResult(await runRiderCheck({ lat, lng, state: activeState }));
    } catch {
      // surfaced through riderError
    }
  };

  // A map selection should use exactly the same point-check screen as a typed
  // location.  The check remains user-triggered from that screen, so a stray
  // map click never spends Mireye credits.
  const openTypedPointCheck = ({ lat, lng }) => {
    setTypedPoint({ lat, lng });
    setInputMode('type');
  };

  const handleStateChange = (state) => {
    setActiveState(state);
    setSelectedFips(null);
    setLiveResult(null);
  };

  const handleSelectRole = (chosenRole) => {
    setRole(chosenRole);
    setInputMode('map');
    setActivePanel(chosenRole === 'rider' ? 'rider' : 'demand');
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

  // FIRST PAGE: Role Selection Screen
  if (role === 'select') {
    return <LandingPage onSelectRole={handleSelectRole} />;
  }

  return (
    <main className="map-first-app">
      {/* Top Header Bar */}
      <header className="map-top-bar">
        <div className="brand-pill">
          <h1>VOLT-TERRA</h1>
          <div className="role-tag-badge">
            <span>{role === 'facility' ? '⚡ EV Facility' : '🚗 EV Rider'}</span>
            <button className="role-switch-btn" onClick={() => setRole('select')} title="Switch Access Role">
              Switch Role
            </button>
          </div>
        </div>

        <div className="mode-switch" role="tablist" aria-label="Dashboard mode">
          <button
            role="tab"
            aria-selected={inputMode === 'map'}
            className={inputMode === 'map' ? 'active' : ''}
            onClick={() => setInputMode('map')}
          >
            Map Mode
          </button>
          <button
            role="tab"
            aria-selected={inputMode === 'type'}
            className={inputMode === 'type' ? 'active' : ''}
            onClick={() => setInputMode('type')}
          >
            Type Mode
          </button>
        </div>

        <div className="brand-state-selector">
          <label htmlFor="top-state-select">State:</label>
          <select
            id="top-state-select"
            className="top-state-dropdown"
            value={activeState}
            onChange={(e) => handleStateChange(e.target.value)}
          >
            <optgroup label="Neighboring & Western States">
              {NEIGHBORING_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </optgroup>
            <optgroup label="All Other US States">
              {Object.entries(STATE_NAMES)
                .filter(([code]) => !NEIGHBORING_STATES.some((n) => n.code === code))
                .map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
            </optgroup>
          </select>
        </div>

        {/* ON-DEMAND LIVE SWEEP BUTTON */}
        <button
          className="run-sweep-btn"
          disabled={liveStatus?.running}
          onClick={() => runLiveSweepForState(activeState)}
        >
          {liveStatus?.running
            ? 'Sweeping Mireye API…'
            : `⚡ Run Live Sweep for ${STATE_NAMES[activeState] ?? activeState}`}
        </button>

        {selectedCounty && inputMode === 'map' && (
          <div className="brand-selected-county-pill">
            <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>Selected:</span>
            <strong style={{ color: 'var(--accent-darker)' }}>{selectedCounty.county_name}</strong>
            {selectedCounty.bucket && <BucketBadge bucket={selectedCounty.bucket} />}
            <button onClick={() => setSelectedFips(null)} title="Clear selection">✕</button>
          </div>
        )}
      </header>

      {/* DEDICATED TYPE SCREENS */}
      {inputMode === 'type' ? (
        role === 'facility' ? (
          <FacilityTypeView
            activeState={activeState}
            onSelectState={handleStateChange}
            facilityData={facilityData}
            loading={liveStatus?.running}
            error={liveStatus?.error}
            onRunSweep={() => runLiveSweepForState(activeState)}
            quoteData={quoteData}
            initialPoint={typedPoint}
          />
        ) : (
          <RiderTypeView
            activeState={activeState}
            onSelectState={handleStateChange}
            selectedFips={selectedFips}
            onSelectCounty={setSelectedFips}
            facilityData={facilityData}
            onPickPoint={pickRiderPoint}
            onRunSweep={() => runLiveSweepForState(activeState)}
            quoteData={quoteData}
            loading={liveStatus?.running}
            initialPoint={typedPoint}
          />
        )
      ) : (
        /* MAP MODE SCREEN */
        <>
          <div className="map-background-layer">
            <CountyMap
              activeState={activeState}
              selectedFips={selectedFips}
              onSelectCounty={setSelectedFips}
              agentFindings={agentFindings}
              liveCounties={facilityData?.counties}
              riderMode={role === 'rider'}
              riderResult={riderResult}
              riderFocusStation={riderFocusStation}
              onCheckPoint={openTypedPointCheck}
              backgroundMode
            />
          </div>

          <nav className="map-panel-nav" aria-label="Workspace panels">
            {role === 'facility' && (
              <button
                className={activePanel === 'demand' ? 'active' : ''}
                onClick={() => togglePanel('demand')}
              >
                County Demand
              </button>
            )}
            {role === 'rider' && (
              <button
                className={activePanel === 'rider' ? 'active' : ''}
                onClick={() => togglePanel('rider')}
              >
                Rider Check
              </button>
            )}
            <button
              className={activePanel === 'chat' ? 'active' : ''}
              onClick={() => togglePanel('chat')}
            >
              AI Chat
            </button>
            {role === 'facility' && (
              <button
                className={activePanel === 'comparison' ? 'active' : ''}
                onClick={() => togglePanel('comparison')}
              >
                Comparison Mode
              </button>
            )}
          </nav>

          {liveStatus?.running && (
            <div className="map-status-overlay">
              <span className="live-dot" /> {liveStatus.message}
            </div>
          )}
          {liveStatus?.error && <div className="map-status-overlay error">{liveStatus.error}</div>}

          {activePanel && (
            <aside
              key={activePanel}
              className={`map-side-panel ${activePanel === 'rider' ? 'rider-panel' : activePanel === 'demand' ? 'demand-panel' : activePanel === 'comparison' ? 'comparison-panel' : `chat-panel ${chatExpanded ? 'expanded' : 'compact'}`}${panelClosing ? ' closing' : ''}`}
            >
              {activePanel !== 'chat' && (
                <div className="map-side-panel-heading">
                  <strong>{activePanel === 'rider' ? 'Can I own an EV here?' : activePanel === 'comparison' ? 'Comparison Mode' : 'County Demand'}</strong>
                  <div className="map-side-panel-actions">
                    <button onClick={closePanel} aria-label="Close panel" title="Close">✕</button>
                  </div>
                </div>
              )}

              {activePanel === 'rider' ? (
                <div className="map-side-panel-body">
                  <ManualEntry mode="rider" onPickPoint={pickRiderPoint} busy={riderLoading} />
                  <RiderPanel
                    result={riderResult}
                    loading={riderLoading}
                    error={riderError}
                    onSelectStation={setRiderFocusStation}
                  />
                </div>
              ) : activePanel === 'chat' ? (
                <div className="map-side-panel-body chat-body">
                  <ChatPanel
                    selectedCounty={selectedCounty}
                    onSelectCounty={setSelectedFips}
                    chatExpanded={chatExpanded}
                    onToggleExpand={() => setChatExpanded((value) => !value)}
                    onClose={closePanel}
                    onAgentFindings={setAgentFindings}
                  />
                </div>
              ) : !facilityData ? (
                <div className="map-side-panel-body">
                  <div className="no-sweep-card card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                    <h4 style={{ margin: '0 0 0.5rem' }}>No Live Sweep Loaded for {STATE_NAMES[activeState] ?? activeState}</h4>
                    <p style={{ fontSize: '0.84rem', color: 'var(--fg-muted)', marginBottom: '1rem' }}>
                      Press the button below to run a live Mireye API sweep across all {quoteData?.counties ?? ''} counties in {STATE_NAMES[activeState] ?? activeState}.
                    </p>
                    <button
                      className="manual-go"
                      style={{ width: '100%' }}
                      disabled={liveStatus?.running}
                      onClick={() => runLiveSweepForState(activeState)}
                    >
                      {liveStatus?.running ? 'Sweeping Mireye API…' : `⚡ Run Live Sweep for ${STATE_NAMES[activeState] ?? activeState}`}
                    </button>
                  </div>
                </div>
              ) : activePanel === 'comparison' ? (
                <div className="map-side-panel-body comparison-body">
                  <ComparisonPanel
                    counties={facilityData.counties}
                    demandMetric={facilityData.demand_metric}
                    dataSources={facilityData.data_sources}
                    selectedFips={selectedFips}
                    onSelectCounty={setSelectedFips}
                  />
                </div>
              ) : (
                <div className="map-side-panel-body demand-body">
                  <p className="demand-summary">
                    Median <strong>{facilityData.state_median_driver_to_plug_ratio?.toFixed(1)}</strong>{' '}
                    {facilityData.demand_metric === 'people_per_public_port' ? 'people/port' : 'EVs/port'} ·{' '}
                    <strong>{facilityData.counties_underserved}</strong> of {facilityData.counties.length} counties flagged
                    {facilityData.live && (
                      <> · <strong>{facilityData.credits_spent?.toLocaleString()}</strong> Mireye credits spent live</>
                    )}
                  </p>
                  <ManualEntry
                    mode="facility"
                    counties={facilityData.counties}
                    onSelectCounty={setSelectedFips}
                    onPickPoint={pickRiderPoint}
                    busy={riderLoading}
                  />
                  <RankedTable
                    counties={facilityData.counties}
                    selectedFips={selectedFips}
                    onSelect={setSelectedFips}
                    demandMetric={facilityData.demand_metric}
                  />
                  {selectedFips && (
                    <div className="overlay-drilldown">
                      <CountyDrilldown fips={selectedFips} countyData={selectedCounty} />
                    </div>
                  )}
                </div>
              )}
            </aside>
          )}
        </>
      )}
    </main>
  );
}
