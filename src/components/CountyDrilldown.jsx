import { useApi } from '../hooks/useApi.js';
import BucketBadge from './BucketBadge.jsx';
import MemoPanel from './MemoPanel.jsx';
import GateFailureList from './GateFailureList.jsx';
import FieldCitations from './FieldCitations.jsx';
import { formatDistance, formatNumber, formatRatio } from '../utils/format.js';

export default function CountyDrilldown({ fips, countyData }) {
  const { data: fetchedCounty, error, loading } = useApi(`/api/counties/${fips}`);
  const county = fetchedCounty || countyData;

  if (loading && !countyData) return <p style={{ color: 'var(--fg-muted)' }}>Loading county detail...</p>;
  if (error && !countyData) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!county) return null;

  const gf = county.grid_feasibility;
  const primaryPoint = gf ? county.sample_points?.find((p) => p.type === gf.sampled_at.type) : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--fg)' }}>{county.county_name}</h2>
        <BucketBadge bucket={county.bucket} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.65rem', marginBottom: '1.25rem' }}>
        <Stat label="EVs / port" value={formatRatio(county.driver_to_plug_ratio)} highlight />
        <Stat label="Registrations" value={formatNumber(county.registrations?.latest_registrations)} />
        <Stat label="L2 + DC Fast Ports" value={formatNumber((county.chargers?.level2_ports ?? 0) + (county.chargers?.dc_fast_ports ?? 0))} />
        <Stat label="Underserved" value={county.underserved ? 'Yes' : 'No'} />
        {county.nevi_stations_awarded != null && (
          <Stat label="NEVI Stations" value={formatNumber(county.nevi_stations_awarded)} />
        )}
      </div>

      {county.underserved && county.nevi_stations_awarded === 0 && (
        <div style={{ background: 'var(--warn-light)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--warn-dark)', fontSize: '0.85rem', margin: 0, lineHeight: 1.4 }}>
            <strong>Note:</strong> Flagged as underserved by our ratio signal, but has not (yet) received real NEVI corridor funding (NEVI funds highway corridors rather than county-wide registration stress).
          </p>
        </div>
      )}

      {gf && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', color: 'var(--fg)' }}>
            Grid feasibility ({gf.sampled_at.type === 'demand_centroid' ? 'demand-weighted point' : 'county centroid'})
          </h3>
          {gf.used_demand_centroid && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--warn-dark)', background: 'var(--warn-light)', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
              This county's geographic centroid diverges from charger concentrations, so a demand-weighted centroid decides the bucket.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem', fontSize: '0.875rem', color: 'var(--fg)' }}>
            <div><span style={{ color: 'var(--fg-muted)' }}>Distance:</span> <strong>{formatDistance(gf.inputs.substation_distance_m)}</strong></div>
            <div><span style={{ color: 'var(--fg-muted)' }}>Voltage:</span> <strong>{gf.inputs.substation_voltage_kv != null ? `${gf.inputs.substation_voltage_kv} kV` : '-'}</strong></div>
            <div><span style={{ color: 'var(--fg-muted)' }}>Status:</span> <strong>{gf.inputs.substation_status ?? '-'}</strong></div>
            <div><span style={{ color: 'var(--fg-muted)' }}>Source:</span> <strong>{gf.inputs.substation_source ?? '-'}</strong></div>
            <div><span style={{ color: 'var(--fg-muted)' }}>Feasibility Score:</span> <strong style={{ color: 'var(--accent-darker)' }}>{gf.score}/100</strong></div>
          </div>

          <GateFailureList failures={gf.gate_failures} />

          {gf.grid_context?.best_alternative_site && (
            <p style={{ marginTop: '0.85rem', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
              <strong>{gf.grid_context.best_alternative_site.station_name ?? 'Existing charger'}</strong> (score{' '}
              {gf.grid_context.best_alternative_site.score}/100), nearby existing station, stronger grid access,
              expandable, but not sufficient for the county.
            </p>
          )}

          {gf.grid_context?.interconnection_queue_active_capacity_caiso_mw != null && (
            <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
              County CAISO interconnection queue: {gf.grid_context.interconnection_queue_active_capacity_caiso_mw.toLocaleString()} MW active.
            </p>
          )}
        </div>
      )}

      {primaryPoint && (
        <details style={{ marginBottom: '1.25rem', fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--accent-darker)', fontWeight: 600 }}>
            Raw cited fields at {primaryPoint.type === 'demand_centroid' ? 'demand-weighted point' : 'centroid'} ({primaryPoint.lat}, {primaryPoint.lng})
          </summary>
          <div className="card" style={{ marginTop: '0.65rem', padding: '0.85rem' }}>
            <FieldCitations fields={primaryPoint.grid_fields} />
          </div>
        </details>
      )}

      {county.underserved && <MemoPanel fips={county.county_fips} bucket={county.bucket} />}
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div
      style={{
        background: highlight ? 'var(--accent-light)' : '#ffffff',
        border: highlight ? '1px solid var(--accent-border)' : '1px solid var(--card-border)',
        borderRadius: 8,
        padding: '0.6rem 0.8rem',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: highlight ? 'var(--accent-darker)' : 'var(--fg-muted)' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: highlight ? 'var(--accent-darker)' : 'var(--fg)' }}>{value}</div>
    </div>
  );
}
