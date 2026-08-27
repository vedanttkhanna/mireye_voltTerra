import { Fragment, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi } from '../hooks/useApi.js';
import { formatBucket, formatRatio } from '../utils/format.js';

const CA_CENTER = [37.2, -119.4];
const CA_ZOOM = 6;

const BUCKET_FILL = {
  fund_charger_now: '#10b981',
  fund_grid_upgrade_first: '#ef4444',
  insufficient_data: '#64748b',
};
const NOT_FLAGGED_FILL = '#cbd5e1';

function getBoundaryStyle(feature, selectedFips) {
  const bucket = feature.properties.bucket;
  const isUnderserved = feature.properties.underserved;
  const isSelected = selectedFips === feature.properties.county_fips;

  if (isSelected) {
    return {
      fillColor: BUCKET_FILL[bucket] ?? '#38bdf8',
      fillOpacity: 0.85,
      color: '#0f172a',
      weight: 5,
      opacity: 1,
    };
  }

  return {
    fillColor: BUCKET_FILL[bucket] ?? NOT_FLAGGED_FILL,
    fillOpacity: isUnderserved ? 0.65 : 0.35,
    color: isUnderserved ? (BUCKET_FILL[bucket] ?? '#1e293b') : '#1e293b',
    weight: isUnderserved ? 2.5 : 2,
    opacity: 0.95,
  };
}

function getStateOutlineStyle() {
  return {
    fill: false,
    color: '#0f172a',
    weight: 4.5,
    opacity: 1,
    lineJoin: 'round',
  };
}

// Substations the agent looked up live. Square rather than round so they read
// as infrastructure, not as one of the pipeline's own sample points.
function substationIcon(isStrongest) {
  const size = isStrongest ? 26 : 20;
  const color = isStrongest ? '#ca8a04' : '#facc15';
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid #ffffff;box-shadow:0 0 0 3px ${color}66, 0 2px 8px rgba(0,0,0,0.35);transform:rotate(45deg)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Public charging stations shown in rider mode. Blue circles, visually distinct
// from the yellow substation diamonds (grid infrastructure) and the green/red
// county sample dots (funding decisions).
function stationIcon(hasDcFast) {
  const size = hasDcFast ? 16 : 11;
  const color = hasDcFast ? '#1d4ed8' : '#60a5fa';
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #ffffff;box-shadow:0 1px 5px rgba(0,0,0,0.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * County-level results for a state we have no boundary polygons for. Only
 * California ships cartographic boundaries; every other state comes from the
 * live sweep with a population-center coordinate, so its counties render as
 * proportional bubbles rather than a choropleth.
 */
const STATE_CENTERS = {
  AL: { center: [32.806671, -86.79113], zoom: 7 },
  AK: { center: [61.370716, -152.404419], zoom: 4 },
  AZ: { center: [34.0489, -111.0937], zoom: 6.5 },
  AR: { center: [34.969704, -92.373123], zoom: 7 },
  CA: { center: [37.1664, -119.4494], zoom: 6 },
  CO: { center: [39.059811, -105.311104], zoom: 7 },
  CT: { center: [41.597782, -72.755371], zoom: 9 },
  DE: { center: [39.318523, -75.507141], zoom: 9 },
  FL: { center: [27.766279, -81.686783], zoom: 6.5 },
  GA: { center: [33.040619, -83.643074], zoom: 7 },
  HI: { center: [21.094318, -157.498337], zoom: 7 },
  ID: { center: [44.240459, -114.478828], zoom: 6 },
  IL: { center: [40.349457, -88.986137], zoom: 7 },
  IN: { center: [39.849426, -86.258278], zoom: 7 },
  IA: { center: [42.011539, -93.210526], zoom: 7 },
  KS: { center: [38.5266, -96.726486], zoom: 7 },
  KY: { center: [37.66814, -84.670067], zoom: 7 },
  LA: { center: [31.169546, -91.867805], zoom: 7 },
  ME: { center: [44.693947, -69.381927], zoom: 7 },
  MD: { center: [39.063946, -76.802101], zoom: 8 },
  MA: { center: [42.230171, -71.530106], zoom: 8 },
  MI: { center: [43.326618, -84.536095], zoom: 7 },
  MN: { center: [45.694454, -93.900192], zoom: 6.5 },
  MS: { center: [32.741646, -89.678696], zoom: 7 },
  MO: { center: [38.456085, -92.288368], zoom: 7 },
  MT: { center: [46.921925, -110.454353], zoom: 6 },
  NE: { center: [41.12537, -98.268082], zoom: 7 },
  NV: { center: [38.8026, -116.4194], zoom: 6.5 },
  NH: { center: [43.452492, -71.563896], zoom: 8 },
  NJ: { center: [40.29896, -74.521011], zoom: 8 },
  NM: { center: [34.840515, -106.248482], zoom: 6.5 },
  NY: { center: [42.165726, -74.948051], zoom: 7 },
  NC: { center: [35.630066, -79.806419], zoom: 7 },
  ND: { center: [47.528912, -99.784012], zoom: 7 },
  OH: { center: [40.388783, -82.764915], zoom: 7 },
  OK: { center: [35.565342, -96.928917], zoom: 7 },
  OR: { center: [43.8041, -120.5542], zoom: 6.5 },
  PA: { center: [40.590752, -77.209755], zoom: 7 },
  RI: { center: [41.680893, -71.51178], zoom: 9 },
  SC: { center: [33.856892, -80.945007], zoom: 7.5 },
  SD: { center: [44.299782, -99.438828], zoom: 7 },
  TN: { center: [35.747845, -86.692345], zoom: 7 },
  TX: { center: [31.9686, -99.9018], zoom: 6 },
  UT: { center: [39.32098, -111.093731], zoom: 6.5 },
  VT: { center: [44.045876, -72.710686], zoom: 8 },
  VA: { center: [37.769337, -78.169968], zoom: 7 },
  WA: { center: [47.7511, -120.7401], zoom: 7 },
  WV: { center: [38.491226, -80.954453], zoom: 7.5 },
  WI: { center: [44.268543, -89.616508], zoom: 7 },
  WY: { center: [42.755966, -107.30249], zoom: 6.5 },
};

/**
 * County-level results for a state we have no boundary polygons for. Only
 * California ships cartographic boundaries; every other state comes from the
 * live sweep with a population-center coordinate, so its counties render as
 * proportional bubbles rather than a choropleth.
 */
function countyBubbleIcon(bucket, underserved, isSelected = false) {
  const color = underserved ? (BUCKET_FILL[bucket] ?? '#64748b') : '#cbd5e1';
  const size = isSelected ? 26 : underserved ? 20 : 12;
  const borderWidth = isSelected ? 3 : 2;
  const shadow = isSelected
    ? 'box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.45), 0 4px 14px rgba(0,0,0,0.5);'
    : 'box-shadow: 0 1px 5px rgba(0,0,0,0.3);';

  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:${isSelected ? 1 : 0.85};border:${borderWidth}px solid ${isSelected ? '#0f172a' : '#ffffff'};${shadow}transition:all 0.2s ease;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function LiveCountyLayer({ counties, selectedFips, onSelectCounty, riderMode = false }) {
  const map = useMap();
  const displayCounties = useMemo(() => {
    return (counties ?? []).filter((c) => {
      if (!c.grid_feasibility?.sampled_at) return false;
      if (riderMode) return true;
      return c.bucket === 'fund_charger_now' || c.bucket === 'fund_grid_upgrade_first';
    });
  }, [counties, riderMode]);

  useEffect(() => {
    const pts = displayCounties.map((c) => [c.grid_feasibility.sampled_at.lat, c.grid_feasibility.sampled_at.lng]);
    if (pts.length && !selectedFips) {
      map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 8, animate: true });
    }
  }, [displayCounties, selectedFips, map]);

  if (!displayCounties.length) return null;
  return (
    <Fragment>
      {displayCounties.map((c) => {
          const isSelected = c.county_fips === selectedFips;
          return (
            <Marker
              key={c.county_fips}
              position={[c.grid_feasibility.sampled_at.lat, c.grid_feasibility.sampled_at.lng]}
              icon={countyBubbleIcon(c.bucket, c.underserved, isSelected)}
              eventHandlers={{ click: () => onSelectCounty?.(c.county_fips) }}
            >
              <Popup>
                <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
                  {isSelected && (
                    <div style={{ background: 'var(--accent)', color: '#fff', fontSize: '0.7rem', fontWeight: 800, padding: '0.15rem 0.4rem', borderRadius: 4, marginBottom: '0.35rem', display: 'inline-block' }}>
                      SELECTED COUNTY
                    </div>
                  )}
                  <strong>{c.county_name}</strong>
                  <br />
                  {c.people_per_port != null ? `${c.people_per_port.toLocaleString()} people per port` : 'no public ports'}
                  <br />
                  {c.charger_count} ports · pop {c.population?.toLocaleString()}
                  {c.bucket && <><br />{formatBucket(c.bucket)}</>}
                </div>
              </Popup>
            </Marker>
          );
        })}
    </Fragment>
  );
}

const RIDER_PIN = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#0f172a;border:3px solid #ffffff;box-shadow:0 0 0 4px rgba(15,23,42,0.25)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/** The clicked point plus the public stations found around it, in rider mode. */
function RiderLayer({ result, focusStation }) {
  const map = useMap();

  useEffect(() => {
    if (focusStation) {
      map.flyTo([focusStation.lat, focusStation.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
      return;
    }
    if (!result) return;
    const pts = [[result.lat, result.lng], ...result.stations.slice(0, 8).map((s) => [s.lat, s.lng])]
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 13, animate: true });
  }, [result, focusStation, map]);

  if (!result) return null;

  return (
    <Fragment>
      <Marker position={[result.lat, result.lng]} icon={RIDER_PIN}>
        <Popup>
          <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
            <strong>{result.feasibility.verdict_label}</strong>
            <br />
            Nearest public charger {result.feasibility.nearest_public_miles ?? '—'} mi
          </div>
        </Popup>
      </Marker>

      {result.stations.slice(0, 12).map((s) => (
        <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon(s.dc_fast_ports > 0)}>
          <Popup>
            <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
              <strong>{s.name}</strong>
              <br />
              {s.distance_miles} mi away · {s.network}
              <br />
              {s.dc_fast_ports > 0 ? `${s.dc_fast_ports} DC fast` : ''}
              {s.dc_fast_ports > 0 && s.level2_ports > 0 ? ', ' : ''}
              {s.level2_ports > 0 ? `${s.level2_ports} Level 2` : ''}
            </div>
          </Popup>
        </Marker>
      ))}
    </Fragment>
  );
}

const LABOR_ICON = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#0284c7;border:3px solid #ffffff;box-shadow:0 0 0 4px rgba(2,132,199,0.25)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Renders whatever the chat agent last fetched live: named substations from
 * find_nearest_substations, and the origin of a get_labor_shed run. Deliberately
 * no shaded catchment polygon for the shed — a driving-time shed is not a
 * circle, and drawing one would imply a boundary the API never returned.
 */
function AgentFindingsLayer({ findings }) {
  const map = useMap();
  const substations = findings?.substations ?? [];
  const laborShed = findings?.laborShed ?? null;

  // Markers land wherever the agent looked, which at statewide zoom is often a
  // few pixels in one county. Fit the view to them so a live lookup is visibly
  // a result rather than something the user has to go hunting for.
  useEffect(() => {
    const points = [
      ...substations.map((sub) => [sub.lat, sub.lng]),
      ...(laborShed ? [[laborShed.lat, laborShed.lng]] : []),
    ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.45), { maxZoom: 11, animate: true });
  }, [findings, map]);

  if (!findings) return null;

  return (
    <Fragment>
      {substations.map((sub, i) => (
        <Marker key={`sub-${i}`} position={[sub.lat, sub.lng]} icon={substationIcon(sub.isStrongest)}>
          <Popup>
            <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
              <strong>{sub.name}</strong> substation
              <br />
              {sub.max_voltage_kv != null ? `${sub.max_voltage_kv} kV` : 'voltage unknown'}
              {sub.distance_miles != null ? `, ${sub.distance_miles} mi away` : ''}
              {sub.isStrongest && (
                <>
                  <br />
                  <span style={{ color: '#a16207', fontWeight: 600 }}>Highest voltage nearby</span>
                </>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {laborShed && (
        <Marker position={[laborShed.lat, laborShed.lng]} icon={LABOR_ICON}>
          <Popup>
            <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.85rem', color: '#0f172a' }}>
              <strong>{laborShed.population?.toLocaleString() ?? '0'}</strong> people within{' '}
              {laborShed.minutes} min drive
              <br />
              {laborShed.labor_force?.toLocaleString() ?? '0'} in the labour force
              {laborShed.population === 0 && (
                <>
                  <br />
                  <span style={{ color: '#b45309', fontWeight: 600 }}>Nobody can reach this point</span>
                </>
              )}
            </div>
          </Popup>
        </Marker>
      )}
    </Fragment>
  );
}

function ClickCapture({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function ResizeMap({ expanded }) {
  const map = useMap();
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(timer);
  }, [expanded, map]);
  return null;
}

// Captures the Leaflet map instance so zoom buttons rendered in the
// toolbar (outside MapContainer) can drive it directly.
function MapRefSetter({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

// The default Leaflet zoom control sits at (10px, 10px) — directly under
// the VOLT-TERRA title overlay in map-first mode, so it was never visible.
// These render inline in the toolbar row instead.
function ZoomButtons({ map }) {
  if (!map) return null;
  return (
    <div style={{ display: 'flex', gap: '0.35rem' }}>
      <button onClick={() => map.zoomIn()} aria-label="Zoom in" title="Zoom in" className="map-zoom-button">
        +
      </button>
      <button onClick={() => map.zoomOut()} aria-label="Zoom out" title="Zoom out" className="map-zoom-button">
        −
      </button>
    </div>
  );
}

function MapViewController({ activeState, selectedFips, liveCounties, statsCounties }) {
  const map = useMap();

  useEffect(() => {
    if (activeState && STATE_CENTERS[activeState]) {
      const { center, zoom } = STATE_CENTERS[activeState];
      map.flyTo(center, zoom, { duration: 0.8 });
    }
  }, [activeState, map]);

  useEffect(() => {
    if (!selectedFips) return;
    const allCounties = [...(liveCounties ?? []), ...(statsCounties ?? [])];
    const target = allCounties.find((c) => c.county_fips === selectedFips);
    if (target) {
      const lat = target.lat ?? target.grid_feasibility?.sampled_at?.lat;
      const lng = target.lng ?? target.grid_feasibility?.sampled_at?.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        map.flyTo([lat, lng], 9, { duration: 0.8 });
      }
    }
  }, [selectedFips, liveCounties, statsCounties, map]);

  return null;
}

export default function CountyMap({ activeState, selectedFips, onSelectCounty, toolbarAction, agentFindings, liveCounties, riderMode = false, riderResult, riderFocusStation, onCheckPoint, backgroundMode = false }) {
  const currentState = activeState || 'CA';
  const { data: boundaries, error: boundariesError } = useApi(`/api/counties/boundaries/${currentState}`);
  const [exploreMode, setExploreMode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);

  const filteredBoundaries = useMemo(() => {
    if (!boundaries) return null;
    if (riderMode) return boundaries;
    return {
      ...boundaries,
      features: boundaries.features.filter((f) => {
        const b = f.properties.bucket;
        return b === 'fund_charger_now' || b === 'fund_grid_upgrade_first';
      }),
    };
  }, [boundaries, riderMode]);

  return (
    <div style={expanded ? {
      position: 'fixed',
      inset: 0,
      zIndex: 2000,
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      padding: '1rem',
      background: '#ffffff',
    } : { height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={backgroundMode ? {
        position: 'absolute',
        top: '4.8rem',
        right: '1rem',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.65rem',
        padding: '0.45rem 0.75rem',
        border: '1px solid var(--card-border)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.95)',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.14)',
        backdropFilter: 'blur(8px)',
      } : { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <Legend />
        {backgroundMode && <ZoomButtons map={mapInstance} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {toolbarAction}
          {!backgroundMode && (
            <button
              onClick={() => setExpanded((value) => !value)}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: 7,
                border: '1px solid var(--card-border)',
                background: '#ffffff',
                color: 'var(--fg)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              {expanded ? 'Exit expanded view' : 'Expand map'}
            </button>
          )}
          <button
            onClick={() => {
              setExploreMode((v) => !v);
            }}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: 7,
              border: exploreMode ? '1px solid var(--accent)' : '1px solid var(--card-border)',
              background: exploreMode ? 'var(--accent-light)' : '#ffffff',
              color: exploreMode ? 'var(--accent-darker)' : 'var(--fg)',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.8rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              transition: 'all 0.15s ease',
            }}
          >
            {exploreMode ? '● Checking points (click map)' : 'Check a point'}
          </button>
        </div>
      </div>

      {boundariesError && (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
          {boundariesError}. Run <code>npm run ingest:boundaries</code>.
        </p>
      )}

      <div style={backgroundMode ? { position: 'absolute', inset: 0, overflow: 'hidden' } : { borderRadius: 10, overflow: 'hidden', border: '1px solid var(--card-border)', flex: 1, minHeight: 520, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <MapContainer center={CA_CENTER} zoom={CA_ZOOM} zoomControl={!backgroundMode} style={{ width: '100%', height: '100%', minHeight: backgroundMode ? 0 : 520, background: '#e2e8f0' }}>
          <MapViewController activeState={activeState} selectedFips={selectedFips} liveCounties={liveCounties} statsCounties={[]} />
          <ResizeMap expanded={expanded} />
          {backgroundMode && <MapRefSetter onReady={setMapInstance} />}
          <TileLayer
            // CARTO's anonymous basemap started serving "API KEY REQUIRED"
            // watermarked tiles, so this uses OSM's standard tiles instead:
            // free, keyless, and adequate for a county-scale choropleth.
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          {filteredBoundaries && (
            <GeoJSON
              key={`${currentState}-${selectedFips ?? 'all'}`}
              data={filteredBoundaries}
              style={(feature) => getBoundaryStyle(feature, selectedFips)}
              onEachFeature={(feature, layer) => {
                const p = feature.properties;
                layer.bindTooltip(
                  `<strong>${p.county_name}</strong><br/>${p.driver_to_plug_ratio != null ? formatRatio(p.driver_to_plug_ratio) + ' EVs/port' : 'not flagged'}${
                    p.bucket ? '<br/>' + formatBucket(p.bucket) : ''
                  }<br/><span style="color:#059669;font-weight:600">Click to select for AI chat</span>`,
                  { sticky: true }
                );

                layer.on('click', () => {
                  if (!exploreMode && onSelectCounty) {
                    onSelectCounty(p.county_fips);
                  }
                });
              }}
            />
          )}

          <AgentFindingsLayer findings={agentFindings} />

          {!riderMode && <LiveCountyLayer counties={liveCounties} selectedFips={selectedFips} onSelectCounty={onSelectCounty} riderMode={riderMode} />}

          {riderMode && <RiderLayer result={riderResult} focusStation={riderFocusStation} />}
          {exploreMode && (
            <ClickCapture
              active={exploreMode}
              onPick={(point) => {
                setExploreMode(false);
                onCheckPoint?.(point);
              }}
            />
          )}
        </MapContainer>
      </div>

    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--fg-muted)' }}>
      <LegendItem color={BUCKET_FILL.fund_charger_now} label="Fund charger now" />
      <LegendItem color={BUCKET_FILL.fund_grid_upgrade_first} label="Fund grid upgrade first" />
      <LegendItem color={BUCKET_FILL.insufficient_data} label="Needs data review" />
      <LegendItem color="#cbd5e1" label="Not flagged" />
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color, display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)' }} />
      {label}
    </span>
  );
}
