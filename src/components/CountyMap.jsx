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
  fund_charger_now: '#10b981',
  fund_grid_upgrade_first: '#f59e0b',
};
const NOT_FLAGGED_FILL = '#e2e8f0';

function boundaryStyle(feature) {
  const bucket = feature.properties.bucket;
  const isUnderserved = feature.properties.underserved;
  return {
    fillColor: BUCKET_FILL[bucket] ?? NOT_FLAGGED_FILL,
    fillOpacity: isUnderserved ? 0.6 : 0.25,
    color: isUnderserved ? (BUCKET_FILL[bucket] ?? '#94a3b8') : '#cbd5e1',
    weight: isUnderserved ? 2 : 1,
  };
}

function dotIcon({ color, size = 14, ring = false }) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #ffffff;${ring ? 'box-shadow:0 0 0 3px ' + color + '88;' : 'box-shadow:0 1px 4px rgba(0,0,0,0.2);'}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const PASS_ICON = dotIcon({ color: '#10b981' });
const FAIL_ICON = dotIcon({ color: '#f59e0b' });
const ALT_ICON = dotIcon({ color: '#3b82f6', size: 10 });
const CHECK_ICON = dotIcon({ color: '#0f172a', size: 16, ring: true });

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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: 'system-ui, sans-serif', minWidth: 260, color: '#0f172a' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </span>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
          >
            dismiss
          </button>
        </div>

        {!confirmed && (
          <div>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: '#334155' }}>
              Run a live grid-feasibility check at this point? Fetches ~23 cited fields from Mireye (~23 credits).
            </p>
            <button onClick={check} style={popupButtonStyle}>
              Check this point
            </button>
          </div>
        )}

        {confirmed && loading && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Checking live grid data...</p>}
        {confirmed && error && <p style={{ fontSize: '0.85rem', color: '#ef4444' }}>{error}</p>}

        {confirmed && result && (
          <div style={{ fontSize: '0.85rem' }}>
            {result.resolved_county ? (
              <p style={{ margin: '0 0 0.5rem' }}>
                In <strong>{result.resolved_county.county_name}</strong>
                {result.resolved_county.underserved != null && (
                  <> (county bucket: <strong>{formatBucket(result.resolved_county.bucket)}</strong>)</>
                )}
              </p>
            ) : (
              <p style={{ margin: '0 0 0.5rem', color: '#64748b' }}>Not inside a mapped CA county.</p>
            )}

            <p style={{ margin: '0 0 0.4rem' }}>
              <strong>{result.feasibility.passes_gates ? 'Passes' : 'Fails'} grid-feasibility gates</strong> (score {result.feasibility.score}/100)
            </p>
            <p style={{ margin: '0 0 0.4rem', color: '#475569' }}>
              Nearest substation: <strong>{formatDistance(result.feasibility.inputs.substation_distance_m)}</strong>
              {result.feasibility.inputs.substation_voltage_kv != null && `, ${result.feasibility.inputs.substation_voltage_kv}kV`}
              {result.feasibility.inputs.substation_source && ` (${result.feasibility.inputs.substation_source})`}
            </p>
            <GateFailureList failures={result.feasibility.gate_failures} />

            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', color: '#059669', fontWeight: 600 }}>All cited fields ({Object.keys(result.fields).length})</summary>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <Legend />
        <button
          onClick={() => {
            setExploreMode((v) => !v);
            setCheckedPoint(null);
          }}
          style={{
            padding: '0.45rem 0.95rem',
            borderRadius: 7,
            border: exploreMode ? '1px solid var(--accent)' : '1px solid var(--card-border)',
            background: exploreMode ? 'var(--accent-light)' : '#ffffff',
            color: exploreMode ? 'var(--accent-darker)' : 'var(--fg)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.85rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease',
          }}
        >
          {exploreMode ? '● Checking points (click map)' : 'Check a specific point'}
        </button>
      </div>

      {boundariesError && (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
          {boundariesError}. Run <code>npm run ingest:boundaries</code>.
        </p>
      )}

      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--card-border)', height: 560, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <MapContainer center={CA_CENTER} zoom={CA_ZOOM} style={{ width: '100%', height: '100%', background: '#e2e8f0' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
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
                    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
                      <strong>{c.county_name}</strong> ({gf.sampled_at.type === 'demand_centroid' ? 'demand-weighted point' : 'centroid'})
                      <br />
                      {formatBucket(c.bucket)}, score <strong>{gf.score}/100</strong>
                    </div>
                  </Popup>
                </Marker>
                {alt && (
                  <Marker position={[alt.lat, alt.lng]} icon={ALT_ICON}>
                    <Popup>
                      <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
                        <strong>{alt.station_name ?? 'Existing charger'}</strong> (alternative site)
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

      <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginTop: '0.65rem' }}>
        Filled boundaries are VOLT-TERRA's county-level recommendation (green = fund charger now, amber = fund grid
        upgrade first). Dots mark the specific points behind each flagged county's verdict. Blue dots are
        informational alternatives.
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
      <LegendItem color={BUCKET_FILL.fund_charger_now} label="Fund charger now" />
      <LegendItem color={BUCKET_FILL.fund_grid_upgrade_first} label="Fund grid upgrade first" />
      <LegendItem color="#cbd5e1" label="Not flagged" />
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)' }} />
      {label}
    </span>
  );
}

const popupButtonStyle = {
  padding: '0.45rem 0.9rem',
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.82rem',
};
