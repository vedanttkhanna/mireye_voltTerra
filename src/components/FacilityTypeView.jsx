import { useEffect, useState } from 'react';
import BucketBadge from './BucketBadge.jsx';
import FieldCitations from './FieldCitations.jsx';
import GateFailureList from './GateFailureList.jsx';
import MemoPanel from './MemoPanel.jsx';
import { usePostJson } from '../hooks/useApi.js';
import { formatDistance, formatNumber, formatRatio } from '../utils/format.js';

const ALL_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

export default function FacilityTypeView({
  activeState,
  onSelectState,
  facilityData,
  loading,
  error,
  onRunSweep,
  quoteData,
  initialPoint,
}) {
  const [selectedCountyFips, setSelectedCountyFips] = useState(null);
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [pointError, setPointError] = useState(null);
  const { run: checkPoint, loading: checkingPoint, error: checkError } = usePostJson('/api/explore/check-point');
  const [pointResult, setPointResult] = useState(null);

  useEffect(() => {
    if (!initialPoint) return;
    setLatInput(String(initialPoint.lat));
    setLngInput(String(initialPoint.lng));
    setAddressInput('');
    setPointError(null);
    setPointResult(null);
  }, [initialPoint]);

  const counties = facilityData?.counties ?? [];
  const chargerCounties = counties.filter((c) => c.bucket === 'fund_charger_now');
  const gridCounties = counties.filter((c) => c.bucket === 'fund_grid_upgrade_first');

  const selectedCounty = counties.find((c) => c.county_fips === selectedCountyFips);

  const handlePointCheckSubmit = async (e) => {
    e.preventDefault();
    let la = Number(latInput);
    let ln = Number(lngInput);

    if (addressInput.trim() && (isNaN(la) || isNaN(ln))) {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressInput)}&countrycodes=us&limit=1`
        );
        const data = await res.json();
        if (data && data[0]) {
          la = parseFloat(data[0].lat);
          ln = parseFloat(data[0].lon);
          setLatInput(String(la));
          setLngInput(String(ln));
        } else {
          return setPointError('Could not locate address. Please enter numeric coordinates.');
        }
      } catch {
        return setPointError('Geocoding service unavailable. Please enter numeric coordinates.');
      }
    }

    if (!Number.isFinite(la) || la < -90 || la > 90) return setPointError('Latitude must be between -90 and 90');
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) return setPointError('Longitude must be between -180 and 180');

    setPointError(null);
    try {
      const res = await checkPoint({ lat: la, lng: ln, state: activeState });
      setPointResult(res);
    } catch {
      // captured by checkError
    }
  };

  return (
    <div className="type-view-container">
      <header className="type-view-header">
        <div>
          <h2>EV Facility Intelligence & Plain Text Dashboard</h2>
          <p className="type-view-subtitle">
            County-level funding bucket classifications & Mireye grid feasibility analysis for infrastructure planners.
          </p>
        </div>

        <div className="type-state-picker" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div>
            <label htmlFor="facility-state-select">Active State: </label>
            <select
              id="facility-state-select"
              value={activeState || ''}
              onChange={(e) => onSelectState(e.target.value)}
            >
              {ALL_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <button className="run-sweep-btn" disabled={loading} onClick={onRunSweep}>
            {loading ? 'Sweeping Mireye API…' : `⚡ Run Live Sweep for ${activeState}`}
          </button>
        </div>
      </header>

      {loading && <p className="type-status-msg">Running live Mireye API sweep for {activeState} counties…</p>}
      {error && <p className="type-status-msg error">{error}</p>}

      {!facilityData && !loading && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', margin: '2rem 0' }}>
          <h3>No Live Sweep Loaded for {activeState}</h3>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.9rem', margin: '0.5rem 0 1.25rem' }}>
            Press the button below to run a live Mireye API sweep across all {quoteData?.counties ?? ''} counties in {activeState}.
          </p>
          <button className="manual-go" disabled={loading} onClick={onRunSweep}>
            ⚡ Run Live Mireye Sweep for {activeState}
          </button>
        </div>
      )}

      {facilityData && (
        <div className="type-grid-layout">
          {/* Main Plain Text Section: Categorized Counties */}
          <div className="type-main-pane">
            <div className="type-summary-bar card">
              <span>
                State Median:{' '}
                <strong>{facilityData.state_median_driver_to_plug_ratio?.toFixed(1)}</strong>{' '}
                {facilityData.demand_metric === 'people_per_public_port' ? 'people/port' : 'EVs/port'}
              </span>
              <span>
                Counties Flagged: <strong>{facilityData.counties_underserved}</strong> of {counties.length}
              </span>
              <span>
                Charger Required: <strong style={{ color: 'var(--accent-darker)' }}>{chargerCounties.length}</strong>
              </span>
              <span>
                Grid Upgrade Required: <strong style={{ color: 'var(--danger)' }}>{gridCounties.length}</strong>
              </span>
            </div>

            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
              <strong style={{ color: 'var(--fg)' }}>This run:</strong>{' '}
              AFDC station inventory and Mireye grid evidence were fetched live at{' '}
              {facilityData.ran_at ? new Date(facilityData.ran_at).toLocaleString() : 'this session'}.
              {facilityData.charger_join_coverage && (
                <> {facilityData.charger_join_coverage.resolved_percent}% of AFDC stations resolved to a county ({facilityData.charger_join_coverage.unresolved} unresolved).</>
              )}
              {facilityData.data_sources?.county_population?.freshness !== 'live' && (
                <> County population is the bundled Census reference. Add <code>CENSUS_API_KEY</code> to make that input live too.</>
              )}
              {facilityData.data_sources?.ev_registrations?.freshness === 'live' && (
                <> Demand ranking uses fresh EV registrations from {facilityData.data_sources.ev_registrations.source}.</>
              )}
              {facilityData.data_sources?.ev_registrations?.freshness === 'unavailable' && (
                <> This state has no public county-level DMV feed, so demand is labeled and ranked as people per port.</>
              )}
            </div>

            {/* Section 1: Counties Requiring Immediate Charger */}
            <section className="type-section card">
              <div className="type-section-head green">
                <span className="type-dot green" />
                <h3>Counties Requiring Immediate Charger Installation ({chargerCounties.length})</h3>
              </div>

              {chargerCounties.length === 0 ? (
                <p className="type-empty-hint">No counties in {activeState} currently require immediate charger installation.</p>
              ) : (
                <div className="type-county-list">
                  {chargerCounties.map((c) => (
                    <div
                      key={c.county_fips}
                      className={`type-county-card ${selectedCountyFips === c.county_fips ? 'selected' : ''}`}
                      onClick={() => setSelectedCountyFips(c.county_fips)}
                    >
                      <div className="type-county-row-main">
                        <div>
                          <span className="type-county-name">{c.county_name}</span>
                          <span className="type-county-fips">FIPS: {c.county_fips}</span>
                        </div>
                        <BucketBadge bucket={c.bucket} />
                      </div>
                      <div className="type-county-metrics">
                        <div>
                          <span>Ratio:</span>{' '}
                          <strong>
                            {formatRatio(c.driver_to_plug_ratio)}{' '}
                            {c.people_per_port != null ? 'people/port' : 'EVs/port'}
                          </strong>
                        </div>
                        <div>
                          <span>Population:</span> <strong>{formatNumber(c.population)}</strong>
                        </div>
                        <div>
                          <span>Ports:</span> <strong>{formatNumber(c.charger_count)}</strong>
                        </div>
                        <div>
                          <span>Feasibility Score:</span>{' '}
                          <strong>{c.grid_feasibility?.score ?? '—'}/100</strong>
                        </div>
                      </div>
                      <button className="type-view-detail-btn">View Detailed Cited Grid Evidence →</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 2: Counties Requiring Grid Upgrade First */}
            <section className="type-section card">
              <div className="type-section-head red">
                <span className="type-dot red" />
                <h3>Counties Requiring Grid Upgrade First ({gridCounties.length})</h3>
              </div>

              {gridCounties.length === 0 ? (
                <p className="type-empty-hint">No counties in {activeState} currently fail grid feasibility gates.</p>
              ) : (
                <div className="type-county-list">
                  {gridCounties.map((c) => (
                    <div
                      key={c.county_fips}
                      className={`type-county-card ${selectedCountyFips === c.county_fips ? 'selected' : ''}`}
                      onClick={() => setSelectedCountyFips(c.county_fips)}
                    >
                      <div className="type-county-row-main">
                        <div>
                          <span className="type-county-name">{c.county_name}</span>
                          <span className="type-county-fips">FIPS: {c.county_fips}</span>
                        </div>
                        <BucketBadge bucket={c.bucket} />
                      </div>
                      <div className="type-county-metrics">
                        <div>
                          <span>Ratio:</span>{' '}
                          <strong>
                            {formatRatio(c.driver_to_plug_ratio)}{' '}
                            {c.people_per_port != null ? 'people/port' : 'EVs/port'}
                          </strong>
                        </div>
                        <div>
                          <span>Population:</span> <strong>{formatNumber(c.population)}</strong>
                        </div>
                        <div>
                          <span>Ports:</span> <strong>{formatNumber(c.charger_count)}</strong>
                        </div>
                        <div>
                          <span>Feasibility Score:</span>{' '}
                          <strong style={{ color: 'var(--danger)' }}>
                            {c.grid_feasibility?.score ?? '—'}/100
                          </strong>
                        </div>
                      </div>
                      <button className="type-view-detail-btn">View Detailed Cited Grid Evidence →</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Side Pane: Plain Text Point Check Tool & Selected County Drilldown */}
          <div className="type-side-pane">
            {/* Live Point Check Form */}
            <div className="type-tool-card card">
              <h3>Live Point Grid Check (Mireye API)</h3>
              <p className="type-tool-desc">
                Query ~23 cited Mireye grid fields live at any coordinate or address to evaluate substation distance, max voltage, and interconnection feasibility.
              </p>

              <form onSubmit={handlePointCheckSubmit}>
                <div className="type-form-group">
                  <label htmlFor="point-address">Search Address / City / ZIP:</label>
                  <input
                    id="point-address"
                    className="manual-input"
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    placeholder="e.g. 123 Main St, Las Vegas, NV or 90210"
                  />
                </div>

                <div className="type-form-row">
                  <div>
                    <label htmlFor="point-lat">Latitude:</label>
                    <input
                      id="point-lat"
                      className="manual-input"
                      value={latInput}
                      onChange={(e) => setLatInput(e.target.value)}
                      placeholder="e.g. 36.1699"
                    />
                  </div>
                  <div>
                    <label htmlFor="point-lng">Longitude:</label>
                    <input
                      id="point-lng"
                      className="manual-input"
                      value={lngInput}
                      onChange={(e) => setLngInput(e.target.value)}
                      placeholder="e.g. -115.1398"
                    />
                  </div>
                </div>

                <button type="submit" className="manual-go type-submit-btn" disabled={checkingPoint}>
                  {checkingPoint ? 'Checking Mireye API…' : 'Run Live Grid Check'}
                </button>
              </form>

              {pointError && <p className="manual-hint error">{pointError}</p>}
              {checkError && <p className="manual-hint error">{checkError}</p>}

              {pointResult && (
                <div className="type-point-result card" style={{ marginTop: '1rem', padding: '0.85rem' }}>
                  <h4>Point Check Verdict</h4>
                  <p style={{ margin: '0 0 0.4rem', fontSize: '0.88rem' }}>
                    <strong>{pointResult.feasibility?.passes_gates ? 'Passes' : 'Fails'} grid feasibility gates</strong>{' '}
                    (Score {pointResult.feasibility?.score}/100)
                  </p>
                  <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'var(--fg-muted)' }}>
                    Substation distance: <strong>{formatDistance(pointResult.feasibility?.inputs?.substation_distance_m)}</strong>
                    {pointResult.feasibility?.inputs?.substation_voltage_kv != null && `, ${pointResult.feasibility.inputs.substation_voltage_kv} kV`}
                  </p>
                  <GateFailureList failures={pointResult.feasibility?.gate_failures} />

                  <details style={{ marginTop: '0.6rem' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--accent-darker)', fontWeight: 600, fontSize: '0.8rem' }}>
                      View All Cited Fields ({Object.keys(pointResult.fields || {}).length})
                    </summary>
                    <div style={{ marginTop: '0.4rem', maxHeight: 200, overflowY: 'auto' }}>
                      <FieldCitations fields={pointResult.fields} />
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* Selected County Drilldown */}
            {selectedCounty && (
              <div className="type-drilldown-card card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>{selectedCounty.county_name} Grid Analysis</h3>
                  <button onClick={() => setSelectedCountyFips(null)} className="type-close-btn">✕</button>
                </div>

                <div className="type-county-grid-stats">
                  <div>
                    <span>Ratio:</span> <strong>{formatRatio(selectedCounty.driver_to_plug_ratio)}</strong>
                  </div>
                  <div>
                    <span>Bucket:</span> <BucketBadge bucket={selectedCounty.bucket} />
                  </div>
                  {selectedCounty.grid_feasibility && (
                    <>
                      <div>
                        <span>Nearest Substation:</span>{' '}
                        <strong>{formatDistance(selectedCounty.grid_feasibility.inputs.substation_distance_m)}</strong>
                      </div>
                      <div>
                        <span>Substation Voltage:</span>{' '}
                        <strong>{selectedCounty.grid_feasibility.inputs.substation_voltage_kv ?? '—'} kV</strong>
                      </div>
                      <div>
                        <span>Feasibility Score:</span>{' '}
                        <strong>{selectedCounty.grid_feasibility.score}/100</strong>
                      </div>
                    </>
                  )}
                </div>

                {selectedCounty.grid_feasibility?.gate_failures?.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <GateFailureList failures={selectedCounty.grid_feasibility.gate_failures} />
                  </div>
                )}

                {selectedCounty.underserved && (
                  <div style={{ marginTop: '1rem' }}>
                    <MemoPanel fips={selectedCounty.county_fips} bucket={selectedCounty.bucket} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
