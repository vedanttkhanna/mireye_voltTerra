import { Fragment, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi, usePostJson } from '../hooks/useApi.js';
import GateFailureList from './GateFailureList.jsx';
import FieldCitations from './FieldCitations.jsx';
import { formatBucket, formatDistance, formatRatio } from '../utils/format.js';

const CA_CENTER = [37.2, -119.4];
const CA_ZOOM = 6;

const BUCKET_FILL = {
  fund_charger_now: '#00e676',
  fund_grid_upgrade_first: '#ffab00',
  insufficient_data: '#5fb3ff',
};
const NOT_FLAGGED_FILL = '#2a3548';

function boundaryStyle(feature) {
  const bucket = feature.properties.bucket;
  return {
    fillColor: BUCKET_FILL[bucket] ?? NOT_FLAGGED_FILL,
    fillOpacity: feature.properties.underserved ? 0.45 : 0.15,
    color: BUCKET_FILL[bucket] ?? '#3a4658',
    weight: feature.properties.underserved ? 1.5 : 0.75,
  };
}

function dotIcon({ color, size = 14, ring = false }) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #0a0f1a;${ring ? 'box-shadow:0 0 0 3px ' + color + '55;' : ''}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const PASS_ICON = dotIcon({ color: '#00e676' });
const FAIL_ICON = dotIcon({ color: '#ffab00' });
const ALT_ICON = dotIcon({ color: '#5fb3ff', size: 10 });
const CHECK_ICON = dotIcon({ color: '#e6edf3', size: 16, ring: true });

function ClickCapture({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function CheckPointPopup({ point, onClose }) {
  const { run, loading, error } = usePostJson('/api/explore/check-point');
  const [result, setResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  const check = async () => {
    setConfirmed(true);
    try {
      setResult(await run({ lat: point.lat, lng: point.lng }));
    } catch {
      // error is already captured by usePostJson
    }
  };

  return (
    <Popup position={[point.lat, point.lng]} maxWidth={320}>
      {/* Leaflet's own click-propagation guard applies to the popup's
          Leaflet-created wrapper, not to this React-rendered subtree —
          without stopping propagation here, clicking a button inside (e.g.
          "Check this point") also bubbles up to the map's own click
          handler and fires a second, unwanted point-check at the click's
          screen position. Confirmed by reproducing it in a real browser:
          clicking the button opened a second popup at a different
          coordinate instead of confirming the first. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: 'system-ui, sans-serif', minWidth: 260 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </span>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'none', color: '#666', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
          >
            dismiss
          </button>
        </div>

        {!confirmed && (
          <div>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
              Run a live grid-feasibility check at this exact point? Fetches ~23 cited fields from Mireye (~23 credits).
            </p>
            <button onClick={check} style={popupButtonStyle}>
              Check this point
            </button>
          </div>
        )}

        {confirmed && loading && <p style={{ fontSize: '0.85rem' }}>Checking live grid data...</p>}
        {confirmed && error && <p style={{ fontSize: '0.85rem', color: '#c62828' }}>{error}</p>}

        {confirmed && result && (
          <div style={{ fontSize: '0.85rem' }}>
            {result.resolved_county ? (
              <p style={{ margin: '0 0 0.5rem' }}>
                In <strong>{result.resolved_county.county_name}</strong>
                {result.resolved_county.underserved != null && (
                  <> — county bucket: {formatBucket(result.resolved_county.bucket)}</>
                )}
              </p>
            ) : (
              <p style={{ margin: '0 0 0.5rem', color: '#666' }}>Not inside a mapped CA county.</p>
            )}

            <p style={{ margin: '0 0 0.4rem' }}>
              <strong>{result.feasibility.passes_gates ? 'Passes' : 'Fails'} grid-feasibility gates</strong> — score {result.feasibility.score}/100
            </p>
            <p style={{ margin: '0 0 0.4rem' }}>
              Nearest substation: {formatDistance(result.feasibility.inputs.substation_distance_m)}
              {result.feasibility.inputs.substation_voltage_kv != null && `, ${result.feasibility.inputs.substation_voltage_kv}kV`}
              {result.feasibility.inputs.substation_source && ` (${result.feasibility.inputs.substation_source})`}
            </p>
            <GateFailureList failures={result.feasibility.gate_failures} />

            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', color: '#666' }}>All cited fields ({Object.keys(result.fields).length})</summary>
              <div style={{ marginTop: '0.4rem', maxHeight: 220, overflowY: 'auto' }}>
                <FieldCitations fields={result.fields} />
              </div>
            </details>
          </div>
        )}
      </div>
    </Popup>
  );
}

export default function CountyMap() {
  const { data: boundaries, error: boundariesError } = useApi('/api/counties/boundaries');
  const { data: stats } = useApi('/api/counties/stats');
  const [exploreMode, setExploreMode] = useState(false);
  const [checkedPoint, setCheckedPoint] = useState(null);

  const flaggedCounties = useMemo(() => (stats?.counties ?? []).filter((c) => c.underserved && c.grid_feasibility), [stats]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <Legend />
        <button
          onClick={() => {
            setExploreMode((v) => !v);
            setCheckedPoint(null);
          }}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: 6,
            border: '1px solid #2a3548',
            background: exploreMode ? '#00e67622' : '#1c2536',
            color: exploreMode ? '#00e676' : '#e6edf3',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          {exploreMode ? '● Checking points — click the map' : 'Check a specific point'}
        </button>
      </div>

      {boundariesError && (
        <p style={{ color: '#ff5252', fontSize: '0.85rem' }}>
          {boundariesError} — run <code>npm run ingest:boundaries</code>.
        </p>
      )}

      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #1c2536', height: 560 }}>
        <MapContainer center={CA_CENTER} zoom={CA_ZOOM} style={{ width: '100%', height: '100%', background: '#0a0f1a' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />

          {boundaries && (
            <GeoJSON
              data={boundaries}
              style={boundaryStyle}
              onEachFeature={(feature, layer) => {
                const p = feature.properties;
                layer.bindTooltip(
                  `<strong>${p.county_name}</strong><br/>${p.driver_to_plug_ratio != null ? formatRatio(p.driver_to_plug_ratio) + ' EVs/port' : 'not flagged'}${
                    p.bucket ? '<br/>' + formatBucket(p.bucket) : ''
                  }`,
                  { sticky: true }
                );
              }}
            />
          )}

          {flaggedCounties.map((c) => {
            const gf = c.grid_feasibility;
            const alt = gf.grid_context?.best_alternative_site;
            return (
              <Fragment key={c.county_fips}>
                <Marker position={[gf.sampled_at.lat, gf.sampled_at.lng]} icon={gf.passes_gates ? PASS_ICON : FAIL_ICON}>
                  <Popup>
                    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem' }}>
                      <strong>{c.county_name}</strong> — {gf.sampled_at.type === 'population_center' ? 'population center' : 'county internal point'}
                      <br />
                      {formatBucket(c.bucket)}, score {gf.score}/100
                    </div>
                  </Popup>
                </Marker>
                {alt && (
                  <Marker position={[alt.lat, alt.lng]} icon={ALT_ICON}>
                    <Popup>
                      <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem' }}>
                        <strong>{alt.station_name ?? 'Existing charger'}</strong> — best alternative site (context only, not used for the bucket)
                        <br />
                        score {alt.score}/100, {alt.passes_gates ? 'passes gates' : 'fails gates'}
                      </div>
                    </Popup>
                  </Marker>
                )}
              </Fragment>
            );
          })}

          {exploreMode && <ClickCapture active={exploreMode} onPick={setCheckedPoint} />}
          {checkedPoint && (
            <Fragment key={`${checkedPoint.lat},${checkedPoint.lng}`}>
              <Marker position={[checkedPoint.lat, checkedPoint.lng]} icon={CHECK_ICON} />
              <CheckPointPopup point={checkedPoint} onClose={() => setCheckedPoint(null)} />
            </Fragment>
          )}
        </MapContainer>
      </div>

      <p style={{ fontSize: '0.78rem', color: '#8899aa', marginTop: '0.5rem' }}>
        Filled boundaries are VOLT-TERRA's county-level recommendation (green = fund charger now, amber = fund grid
        upgrade first, blue = insufficient data). Dots mark the specific points behind each flagged county's verdict — pale blue dots are
        informational alternatives, not part of the decision. This map answers "does a point clear the same physical
        screen a flagged county did," not "where is the best site" — VOLT-TERRA ranks counties, not addresses.
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', color: '#8899aa' }}>
      <LegendItem color={BUCKET_FILL.fund_charger_now} label="Fund charger now" />
      <LegendItem color={BUCKET_FILL.fund_grid_upgrade_first} label="Fund grid upgrade first" />
      <LegendItem color={BUCKET_FILL.insufficient_data} label="Needs data review" />
      <LegendItem color={NOT_FLAGGED_FILL} label="Not flagged" />
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

const popupButtonStyle = {
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: '1px solid #ccc',
  background: '#16202c',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.82rem',
};
