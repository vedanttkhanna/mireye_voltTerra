import { useEffect, useRef, useState } from 'react';
import { usePostJson } from '../hooks/useApi.js';
import { formatRatio } from '../utils/format.js';

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

export default function RiderTypeView({
  activeState,
  onSelectState,
  selectedFips,
  onSelectCounty,
  facilityData,
  onPickPoint,
  onRunSweep,
  quoteData,
  loading,
  initialPoint,
}) {
  const [addressInput, setAddressInput] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [error, setError] = useState(null);

  const { run: runRiderCheck, loading: riderLoading, error: riderError } = usePostJson('/api/rider/check-point');
  const [riderResult, setRiderResult] = useState(null);
  const lastAutoSubmittedPoint = useRef(null);

  // Populate fields when a map click sends an initialPoint
  useEffect(() => {
    if (!initialPoint) return;
    setLatInput(String(initialPoint.lat));
    setLngInput(String(initialPoint.lng));
    setAddressInput('');
    setError(null);
    setRiderResult(null);
  }, [initialPoint]);

  // Auto-submit the rider check when initialPoint arrives from a map click
  useEffect(() => {
    if (!initialPoint) return;
    const key = `${initialPoint.lat},${initialPoint.lng}`;
    if (lastAutoSubmittedPoint.current === key) return;
    lastAutoSubmittedPoint.current = key;
    (async () => {
      try {
        const res = await runRiderCheck({ lat: initialPoint.lat, lng: initialPoint.lng, state: activeState });
        setRiderResult(res);
        onPickPoint?.({ lat: initialPoint.lat, lng: initialPoint.lng });
      } catch {
        // error surfaced through riderError
      }
    })();
  }, [initialPoint, activeState, runRiderCheck, onPickPoint]);

  const counties = facilityData?.counties ?? [];
  const selectedCounty = counties.find((c) => c.county_fips === selectedFips) ?? counties[0];

  const handleRiderCheckSubmit = async (e) => {
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
          return setError('Could not find location. Please enter exact latitude and longitude.');
        }
      } catch {
        return setError('Geocoding service unavailable. Please enter exact coordinates.');
      }
    }

    if (!Number.isFinite(la) || la < -90 || la > 90) {
      if (!selectedCounty) return setError('Please select a county or enter valid latitude & longitude.');
      la = selectedCounty.lat ?? selectedCounty.grid_feasibility?.sampled_at?.lat;
      ln = selectedCounty.lng ?? selectedCounty.grid_feasibility?.sampled_at?.lng;
    }

    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      return setError('Coordinates unavailable for check.');
    }

    setError(null);
    try {
      const res = await runRiderCheck({ lat: la, lng: ln, state: activeState });
      setRiderResult(res);
      onPickPoint?.({ lat: la, lng: ln });
    } catch {
      // captured by riderError
    }
  };

  return (
    <div className="type-view-container">
      <header className="type-view-header">
        <div>
          <h2>EV Rider Intelligence & Plain Text Dashboard</h2>
          <p className="type-view-subtitle">
            Check county EV feasibility, search nearby public chargers, and evaluate physical location conditions using DOE & Mireye data.
          </p>
        </div>

        <div className="type-state-picker" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div>
            <label htmlFor="rider-state-select">Active State: </label>
            <select
              id="rider-state-select"
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

      <div className="type-grid-layout">
        {/* Left Pane: County EV Ownership Feasibility Overview */}
        <div className="type-main-pane">
          <div className="type-section card" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.85rem' }}>1. Select Your County</h3>
            <div className="type-form-group">
              <select
                className="landing-select"
                style={{ width: '100%' }}
                value={selectedFips || ''}
                onChange={(e) => onSelectCounty(e.target.value)}
              >
                {counties.map((c) => (
                  <option key={c.county_fips} value={c.county_fips}>
                    {c.county_name} ({c.charger_count} public ports)
                  </option>
                ))}
              </select>
            </div>

            {selectedCounty && (
              <div className="type-rider-county-card card" style={{ marginTop: '1rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{selectedCounty.county_name} EV Feasibility</h4>
                  <span
                    className={`rider-verdict ${
                      selectedCounty.underserved ? 'hard' : 'easy'
                    }`}
                  >
                    {selectedCounty.underserved ? 'Challenging (High Gap)' : 'Feasible to Own an EV'}
                  </span>
                </div>

                <div className="type-county-metrics" style={{ marginTop: '0.85rem' }}>
                  <div>
                    <span>Driver-to-Plug / People Ratio:</span>{' '}
                    <strong>
                      {formatRatio(selectedCounty.driver_to_plug_ratio)}{' '}
                      {selectedCounty.people_per_port != null ? 'people/port' : 'EVs/port'}
                    </strong>
                  </div>
                  <div>
                    <span>Total Public Ports:</span> <strong>{selectedCounty.charger_count?.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>County Population:</span> <strong>{selectedCounty.population?.toLocaleString()}</strong>
                  </div>
                </div>

                <p style={{ margin: '0.85rem 0 0', fontSize: '0.82rem', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  {selectedCounty.underserved
                    ? 'Note: This county has a high driver/people-to-plug ratio relative to state peers, meaning public charging availability is tighter during peak hours.'
                    : 'This county meets public charging accessibility thresholds for EV owners.'}
                </p>
              </div>
            )}
          </div>

          {/* Location / Point Check Form */}
          <div className="type-section card" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>2. Precise Location Check (Optional)</h3>
            <p className="type-tool-desc" style={{ marginBottom: '1rem' }}>
              Enter an address, city, or precise latitude & longitude coordinates to query nearby charging stations and Mireye physical conditions.
            </p>

            <form onSubmit={handleRiderCheckSubmit}>
              <div className="type-form-group">
                <label htmlFor="rider-address">Address, City, or ZIP Code:</label>
                <input
                  id="rider-address"
                  className="manual-input"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="e.g. 100 N 1st St, Phoenix, AZ or Las Vegas, NV"
                />
              </div>

              <div className="type-form-row">
                <div>
                  <label htmlFor="rider-lat">Latitude (Optional):</label>
                  <input
                    id="rider-lat"
                    className="manual-input"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder="e.g. 36.1699"
                  />
                </div>
                <div>
                  <label htmlFor="rider-lng">Longitude (Optional):</label>
                  <input
                    id="rider-lng"
                    className="manual-input"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder="e.g. -115.1398"
                  />
                </div>
              </div>

              <button type="submit" className="manual-go type-submit-btn" disabled={riderLoading}>
                {riderLoading ? 'Checking Nearby Chargers…' : 'Check EV Charger Proximity'}
              </button>
            </form>

            {error && <p className="manual-hint error">{error}</p>}
            {riderError && <p className="manual-hint error">{riderError}</p>}
          </div>
        </div>

        {/* Right Pane: Plain Text Location Check Results & Nearby Stations */}
        <div className="type-side-pane">
          {riderResult ? (
            <div className="type-tool-card card" style={{ padding: '1.1rem' }}>
              <div className={`rider-verdict ${riderResult.feasibility?.verdict}`}>
                {riderResult.feasibility?.verdict_label}
              </div>

              <div className="rider-stats" style={{ marginTop: '0.85rem' }}>
                <div className="rider-stat">
                  <strong>{riderResult.feasibility?.nearest_public_miles ?? '—'} mi</strong>
                  <span>nearest public charger</span>
                </div>
                <div className="rider-stat">
                  <strong>{riderResult.feasibility?.nearest_dc_fast_miles ?? '—'} mi</strong>
                  <span>nearest DC fast</span>
                </div>
                <div className="rider-stat">
                  <strong>{riderResult.feasibility?.public_stations_within_10mi ?? 0}</strong>
                  <span>stations within 10 mi</span>
                </div>
              </div>

              {riderResult.physical && !riderResult.physical.error && (
                <div className="rider-physical" style={{ marginTop: '1rem', paddingTop: '0.85rem' }}>
                  <div className="rider-stations-head">Physical Location Conditions (Mireye API)</div>
                  <ul>
                    {riderResult.physical.road_class && (
                      <li>
                        Road access: <strong>{riderResult.physical.road_class}</strong> road
                        {riderResult.physical.road_distance_m != null ? ` (${Math.round(riderResult.physical.road_distance_m)}m away)` : ''}
                      </li>
                    )}
                    {riderResult.physical.electricity_price_usd_per_kwh != null && (
                      <li>
                        Electricity price: <strong>${riderResult.physical.electricity_price_usd_per_kwh.toFixed(3)}/kWh</strong>
                        {riderResult.physical.utility ? ` · ${riderResult.physical.utility}` : ''}
                      </li>
                    )}
                    {riderResult.physical.housing_units_within_1km != null && (
                      <li>
                        Housing density: <strong>{riderResult.physical.housing_units_within_1km.toLocaleString()}</strong> units within 1 km
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="rider-stations" style={{ marginTop: '1rem', paddingTop: '0.85rem' }}>
                <div className="rider-stations-head">Nearby Charging Stations (DOE AFDC Data)</div>
                {riderResult.stations?.length === 0 && (
                  <p className="rider-hint">No public charging stations found within 30 miles.</p>
                )}
                {riderResult.stations?.slice(0, 10).map((s) => (
                  <div key={s.id} className="rider-station" style={{ cursor: 'default' }}>
                    <span className="rider-station-name">{s.name}</span>
                    <span className="rider-station-meta">
                      {s.distance_miles} mi away · {s.network}
                      {s.dc_fast_ports > 0 ? ` · ${s.dc_fast_ports} DC Fast` : ''}
                      {s.level2_ports > 0 ? ` · ${s.level2_ports} L2` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="type-tool-card card" style={{ padding: '1.25rem' }}>
              <h3>Nearby Charger & Proximity Plain Text Summary</h3>
              <p className="type-tool-desc">
                Select your county on the left or run a location check to list nearest public chargers, station networks, port types, and Mireye physical conditions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
