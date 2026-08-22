import { useApi } from '../hooks/useApi.js';
import BucketBadge from './BucketBadge.jsx';
import MemoPanel from './MemoPanel.jsx';
import GateFailureList from './GateFailureList.jsx';
import FieldCitations from './FieldCitations.jsx';
import { formatDistance, formatNumber, formatRatio } from '../utils/format.js';

export default function CountyDrilldown({ fips }) {
  const { data: county, error, loading } = useApi(`/api/counties/${fips}`);

  if (loading) return <p style={{ color: '#8899aa' }}>Loading county detail...</p>;
  if (error) return <p style={{ color: '#ff5252' }}>{error}</p>;
  if (!county) return null;

  const gf = county.grid_feasibility;
  const primaryPoint = gf ? county.sample_points?.find((p) => p.type === gf.sampled_at.type) : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>{county.county_name}</h2>
        <BucketBadge bucket={county.bucket} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <Stat label="EVs / port" value={county.zero_charging_ports ? 'No ports' : formatRatio(county.driver_to_plug_ratio)} />
        <Stat label="Latest registrations" value={formatNumber(county.registrations?.latest_registrations)} />
        <Stat label="L2 + DC fast ports" value={formatNumber((county.chargers?.level2_ports ?? 0) + (county.chargers?.dc_fast_ports ?? 0))} />
        <Stat label="Underserved" value={county.underserved ? 'Yes' : 'No'} />
        {county.nevi_stations_awarded != null && (
          <Stat label="Real NEVI stations awarded" value={formatNumber(county.nevi_stations_awarded)} />
        )}
      </div>

      {county.underserved && county.nevi_stations_awarded === 0 && (
        <p style={{ color: '#ffab00', fontSize: '0.85rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
          Flagged as underserved by our ratio signal, but has not (yet) received real NEVI corridor funding — see
          README "Day 12 backtest" for why that can happen (NEVI funds highway-corridor coverage gaps, not
          registration-per-charger stress).
        </p>
      )}

      {gf && (
        <div style={{ background: '#0f1522', border: '1px solid #1c2536', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Grid feasibility (at {gf.sampled_at.type === 'population_center' ? 'population center' : 'county internal point'})
          </h3>
          {gf.used_population_center && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#ffab00' }}>
              The Census mean center of population decides this county's bucket, avoiding bias toward places where
              chargers already happen to exist.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', fontSize: '0.9rem' }}>
            <div>Substation distance: {formatDistance(gf.inputs.substation_distance_m)}</div>
            <div>Substation voltage: {gf.inputs.substation_voltage_kv != null ? `${gf.inputs.substation_voltage_kv} kV` : '—'}</div>
            <div>Status: {gf.inputs.substation_status ?? '—'}</div>
            <div>Source: {gf.inputs.substation_source ?? '—'}</div>
            <div>Score: {gf.score}/100</div>
          </div>

          <GateFailureList failures={gf.gate_failures} />

          {gf.grid_context?.best_alternative_site && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#8899aa' }}>
              Best alternative site nearby (not used to decide the bucket — see README):{' '}
              {gf.grid_context.best_alternative_site.station_name ?? 'existing charger'}, score{' '}
              {gf.grid_context.best_alternative_site.score}/100,{' '}
              {gf.grid_context.best_alternative_site.passes_gates ? 'passes gates' : 'fails gates'}.
            </p>
          )}

          {gf.grid_context?.interconnection_queue_active_capacity_caiso_mw != null && (
            <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#8899aa' }}>
              County CAISO interconnection queue (context only, not a gate):{' '}
              {gf.grid_context.interconnection_queue_active_capacity_caiso_mw.toLocaleString()} MW active.
            </p>
          )}
        </div>
      )}

      {primaryPoint && (
        <details style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer', color: '#8899aa' }}>
            Raw cited fields at {primaryPoint.type === 'population_center' ? 'population center' : 'county internal point'} ({primaryPoint.lat}, {primaryPoint.lng})
          </summary>
          <div style={{ marginTop: '0.5rem' }}>
            <FieldCitations fields={primaryPoint.grid_fields} />
          </div>
        </details>
      )}

      {county.underserved && <MemoPanel fips={county.county_fips} bucket={county.bucket} />}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: '#0f1522', border: '1px solid #1c2536', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#8899aa' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
