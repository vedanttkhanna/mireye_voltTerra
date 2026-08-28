import { formatRatio } from '../utils/format.js';
import EvStationIcon from './EvStationIcon.jsx';

const VERDICT_CLASS = {
  easy: 'rider-verdict easy',
  workable: 'rider-verdict workable',
  hard: 'rider-verdict hard',
};

function miles(value) {
  return value == null ? '—' : `${value} mi`;
}

export default function RiderPanel({ result, loading, error, onSelectStation }) {
  if (loading) {
    return <p className="rider-hint">Checking charging access at this point…</p>;
  }
  if (error) {
    return <p className="rider-hint error">{error}</p>;
  }
  if (!result) {
    return (
      <p className="rider-hint">
        Click anywhere on the map to check whether owning an EV there is practical. Uses live DOE
        charging data and costs no Mireye credits.
      </p>
    );
  }

  const { feasibility: f, county, stations, physical, credits_spent: credits } = result;
  const byDrive = f.ranked_by === 'mireye_drive_time';

  return (
    <div className="rider-result">
      <div className={VERDICT_CLASS[f.verdict] ?? 'rider-verdict'}>{f.verdict_label}</div>

      <div className="rider-stats">
        <div className="rider-stat">
          <strong>
            {byDrive && f.nearest_public_drive_minutes != null
              ? `${f.nearest_public_drive_minutes} min`
              : miles(f.nearest_public_miles)}
          </strong>
          <span>{byDrive ? 'drive to nearest charger' : 'nearest public charger'}</span>
        </div>
        <div className="rider-stat">
          <strong>{miles(f.nearest_dc_fast_miles)}</strong>
          <span>nearest DC fast</span>
        </div>
        <div className="rider-stat">
          <strong>{f.public_stations_within_10mi}</strong>
          <span>public stations within 10 mi</span>
        </div>
      </div>

      {county && (
        <p className="rider-county">
          In <strong>{county.county_name}</strong>
          {county.driver_to_plug_ratio != null && (
            <> · {formatRatio(county.driver_to_plug_ratio)} EVs per port countywide</>
          )}
        </p>
      )}

      {f.reasons.length > 0 && (
        <ul className="rider-reasons">
          {f.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {physical && !physical.error && (
        <div className="rider-physical">
          <div className="rider-stations-head">Conditions at this point (Mireye)</div>
          <ul>
            {physical.road_class && (
              <li>
                Road access: <strong>{physical.road_class}</strong> road
                {physical.road_distance_m != null ? ` ${Math.round(physical.road_distance_m)} m away` : ''}
              </li>
            )}
            {physical.electricity_price_usd_per_kwh != null && (
              <li>
                Electricity: <strong>${physical.electricity_price_usd_per_kwh.toFixed(3)}/kWh</strong>
                {physical.utility ? ` · ${physical.utility}` : ''}
              </li>
            )}
            {physical.housing_units_within_1km != null && (
              <li>
                <strong>{physical.housing_units_within_1km.toLocaleString()}</strong> housing units within 1 km
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="rider-stations">
        <div className="rider-stations-head">Nearest public stations</div>
        {stations.length === 0 && <p className="rider-hint">No public stations found within 30 miles.</p>}
        {stations.slice(0, 8).map((s) => (
          <button
            key={s.id}
            className="rider-station"
            onClick={() => onSelectStation?.(s)}
            title="Show on map"
          >
            <EvStationIcon dcFast={s.dc_fast_ports > 0} />
            <span className="rider-station-copy">
              <span className="rider-station-name">{s.name}</span>
              <span className="rider-station-meta">
                {s.drive_minutes != null ? `${s.drive_minutes} min` : `${s.distance_miles} mi`}
                {s.dc_fast_ports > 0 ? ` · ${s.dc_fast_ports} DC fast` : ''}
                {s.level2_ports > 0 ? ` · ${s.level2_ports} L2` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>

      <p className="rider-footnote">
        {byDrive
          ? 'Ranked by real driving time from Mireye road routing, not straight-line distance. '
          : 'Ranked by straight-line distance; road routing was unavailable. '}
        Station locations from the DOE Alternative Fuels Data Center, public access only.
        {credits > 0 ? ` This check used ${credits} Mireye credits.` : ''}
      </p>
    </div>
  );
}
