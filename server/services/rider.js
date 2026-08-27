// EV Rider mode: "could I realistically own an EV at this address?"
//
// The facility side of VOLT-TERRA asks whether a COUNTY should be funded. This
// asks the opposite question for one person at one point.
//
// Division of labour, and why: Mireye's catalog has no EV charging station
// layer (checked across all 366 fields), so DOE AFDC is the only source for
// WHERE the chargers are. Everything after that is Mireye:
//   - /v1/proximity op=distance, mode=driving  -> real road routing to each
//     station, which is what a driver actually experiences. Straight-line
//     distance flatters a station across a river or a freeway with no exit.
//   - /v1/fetch -> the physical context at the point itself: road access,
//     electricity price, terrain, and the local grid.

import { config } from '../config.js';
import { mireye } from './mireye.js';

const AFDC_NEAREST_PATH = '/api/alt-fuel-stations/v1/nearest.json';

// Search radius for the station pull. Wide enough that a rural point still
// returns something to reason about rather than an empty list.
const SEARCH_RADIUS_MILES = 30;
const STATION_LIMIT = 25;

// Thresholds, stated rather than fitted:
//   - 2 mi: a charger you would casually detour to.
//   - 5 mi: still reachable, but you plan around it.
//   - 10 mi DC fast: the practical range for a rapid top-up when you cannot
//     charge at home; beyond that a fast charge becomes its own errand.
//   - 25 mi DC fast: last point at which fast charging is realistically usable.
export const CONVENIENT_MILES = 2;
export const REACHABLE_MILES = 5;
export const DCFC_CONVENIENT_MILES = 10;
export const DCFC_USABLE_MILES = 25;

// Drive-time equivalents, used in preference to the mile thresholds whenever
// Mireye routing succeeded. Minutes are what a driver actually plans around.
export const CONVENIENT_MINUTES = 6;
export const REACHABLE_MINUTES = 15;
export const DCFC_CONVENIENT_MINUTES = 20;
export const DCFC_USABLE_MINUTES = 40;

// Physical context for the rider's own location, all 1 credit per field.
export const RIDER_PHYSICAL_FIELDS = [
  'nearest_road_distance_m',
  'nearest_road_class',
  'avg_retail_electricity_price_industrial_usd_per_kwh',
  'housing_units_within_1km',
  'elevation',
  'slope_degrees',
  'nearest_substation_distance_m',
  'electric_utility_service_territory',
];

// 1 origin x N destinations in driving mode was observed at ~12 credits per
// destination, so this caps a single rider check at a predictable spend.
const ROUTE_DESTINATIONS = 6;
const ROUTE_CREDIT_CEILING = 250;

/**
 * A rider can only actually plug into a public station. AFDC's `private`
 * (fleet-only) and `planned` entries are excluded, otherwise a point next to a
 * corporate depot looks well served when none of it is usable.
 */
export function filterUsableStations(stations = []) {
  return stations.filter((s) => s.access_code === 'public' && s.status_code === 'E');
}

function summarizeStation(s) {
  return {
    id: s.id,
    name: s.station_name,
    lat: s.latitude,
    lng: s.longitude,
    distance_miles: s.distance != null ? Number(Number(s.distance).toFixed(2)) : null,
    network: s.ev_network ?? 'Non-networked',
    level2_ports: Number(s.ev_level2_evse_num || 0),
    dc_fast_ports: Number(s.ev_dc_fast_num || 0),
    access: s.access_code,
    city: s.city,
  };
}

/**
 * Turns the nearby-station picture plus county congestion into a plain verdict.
 * Mirrors the facility side's gate style: an explicit tier, plus the specific
 * reasons behind it, so the answer is inspectable rather than a bare score.
 */
export function scoreRiderFeasibility({ stations, nearestDcfcMiles = null, countyRatio, stateMedianRatio }) {
  const withDistance = stations.filter((s) => s.distance_miles != null);
  const nearest = withDistance[0] ?? null;

  const nearestMiles = nearest?.distance_miles ?? null;
  // DC fast distance comes from its own targeted query, not from scanning the
  // general list: in a dense metro the nearest 25 stations are often all Level
  // 2, which made a downtown point with a fast charger 0.3 mi away score as if
  // it had none.
  const dcfcMiles = nearestDcfcMiles ?? withDistance.find((s) => s.dc_fast_ports > 0)?.distance_miles ?? null;
  const within10 = withDistance.filter((s) => s.distance_miles <= 10).length;

  // Prefer Mireye's road routing when it succeeded: drive minutes are what a
  // driver plans around, and they can differ sharply from crow-flies distance.
  const routedMinutes = withDistance
    .map((s) => s.drive_minutes)
    .filter((m) => m != null)
    .sort((a, b) => a - b);
  const nearestMinutes = routedMinutes[0] ?? null;
  const dcfcMinutes = withDistance
    .filter((s) => s.dc_fast_ports > 0 && s.drive_minutes != null)
    .map((s) => s.drive_minutes)
    .sort((a, b) => a - b)[0] ?? null;
  const usingDriveTime = nearestMinutes != null;

  const reasons = [];
  if (nearestMiles == null) reasons.push('no public charging found within the search radius');
  else if (usingDriveTime && nearestMinutes > REACHABLE_MINUTES) {
    reasons.push(`nearest public charger is a ${nearestMinutes} minute drive`);
  } else if (!usingDriveTime && nearestMiles > REACHABLE_MILES) {
    reasons.push(`nearest public charger is ${nearestMiles} mi away`);
  }
  if (dcfcMiles == null) reasons.push(`no public DC fast charging within ${SEARCH_RADIUS_MILES} mi`);
  else if (dcfcMinutes != null && dcfcMinutes > DCFC_USABLE_MINUTES) {
    reasons.push(`nearest DC fast charger is a ${dcfcMinutes} minute drive`);
  } else if (dcfcMinutes == null && dcfcMiles > DCFC_USABLE_MILES) {
    reasons.push(`nearest DC fast charger is ${dcfcMiles} mi away`);
  }

  // Congestion is a real part of the rider experience: plenty of plugs that are
  // always occupied is not the same as plenty of plugs.
  const contested =
    countyRatio != null && stateMedianRatio != null && countyRatio >= stateMedianRatio * 2;
  if (contested) {
    reasons.push(`this county has ${countyRatio.toFixed(1)} EVs per port, over twice the state median`);
  }

  const nearOk = usingDriveTime
    ? nearestMinutes <= CONVENIENT_MINUTES
    : nearestMiles != null && nearestMiles <= CONVENIENT_MILES;
  const nearReachable = usingDriveTime
    ? nearestMinutes <= REACHABLE_MINUTES
    : nearestMiles != null && nearestMiles <= REACHABLE_MILES;
  const fastOk = dcfcMinutes != null
    ? dcfcMinutes <= DCFC_CONVENIENT_MINUTES
    : dcfcMiles != null && dcfcMiles <= DCFC_CONVENIENT_MILES;
  const fastUsable = dcfcMinutes != null
    ? dcfcMinutes <= DCFC_USABLE_MINUTES
    : dcfcMiles != null && dcfcMiles <= DCFC_USABLE_MILES;

  let verdict;
  if (nearOk && fastOk && !contested) verdict = 'easy';
  else if (nearReachable && fastUsable) verdict = 'workable';
  else verdict = 'hard';

  return {
    verdict,
    verdict_label:
      verdict === 'easy' ? 'Easy to own an EV here'
        : verdict === 'workable' ? 'Workable with planning'
          : 'Hard without home charging',
    nearest_public_miles: nearestMiles,
    nearest_dc_fast_miles: dcfcMiles,
    nearest_public_drive_minutes: nearestMinutes,
    nearest_dc_fast_drive_minutes: dcfcMinutes,
    ranked_by: usingDriveTime ? 'mireye_drive_time' : 'straight_line',
    public_stations_within_10mi: within10,
    county_evs_per_port: countyRatio ?? null,
    state_median_evs_per_port: stateMedianRatio ?? null,
    contested,
    reasons,
  };
}

/** Pulls the nearest public charging stations to a point from DOE AFDC. */
export async function fetchNearestStations({
  lat,
  lng,
  chargingLevel = null,
  limit = STATION_LIMIT,
  apiKey = config.nrelApiKey,
  baseUrl = config.afdcBaseUrl,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(AFDC_NEAREST_PATH, baseUrl);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('fuel_type', 'ELEC');
  url.searchParams.set('status', 'E');
  url.searchParams.set('access', 'public');
  if (chargingLevel) url.searchParams.set('ev_charging_level', chargingLevel);
  url.searchParams.set('radius', String(SEARCH_RADIUS_MILES));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('api_key', apiKey);

  const res = await fetchImpl(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AFDC nearest lookup failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data?.fuel_stations)) {
    throw new Error('AFDC nearest returned an invalid station list');
  }

  return filterUsableStations(data.fuel_stations)
    .map(summarizeStation)
    .sort((a, b) => (a.distance_miles ?? Infinity) - (b.distance_miles ?? Infinity));
}

/**
 * Both halves of the rider picture in one call: the nearby station list, and
 * the true nearest DC fast charger from its own query.
 */
export async function fetchRiderContext({ lat, lng, fetchImpl = fetch } = {}) {
  const [stations, dcFast] = await Promise.all([
    fetchNearestStations({ lat, lng, fetchImpl }),
    fetchNearestStations({ lat, lng, chargingLevel: 'dc_fast', limit: 1, fetchImpl }),
  ]);
  return { stations, nearestDcfcMiles: dcFast[0]?.distance_miles ?? null };
}


/**
 * Real road routing from the rider's point to each candidate station, via
 * Mireye /v1/proximity. Returns the stations re-ranked by drive time rather
 * than crow-flies distance, which is the ranking a driver would actually use.
 * Falls back to the straight-line order if routing is unavailable, so a
 * proximity outage degrades the answer rather than breaking it.
 */
export async function routeToStations({ lat, lng, stations, proximityImpl = mireye.proximity.bind(mireye) } = {}) {
  const candidates = stations.slice(0, ROUTE_DESTINATIONS).filter((s) => s.lat != null && s.lng != null);
  if (candidates.length === 0) return { routed: stations, credits_spent: 0, routing_available: false };

  try {
    const response = await proximityImpl({
      op: 'distance',
      origins: [`${lat},${lng}`],
      destinations: candidates.map((s) => `${s.lat},${s.lng}`),
      mode: 'driving',
      max_credits: ROUTE_CREDIT_CEILING,
    });

    const byIndex = new Map((response.legs ?? []).map((leg) => [leg.destination_index, leg]));
    const routed = candidates.map((s, i) => {
      const leg = byIndex.get(i);
      return {
        ...s,
        drive_miles: leg?.distance_miles ?? null,
        drive_minutes: leg?.duration_minutes != null ? Number(leg.duration_minutes.toFixed(1)) : null,
      };
    });

    routed.sort((a, b) => (a.drive_minutes ?? Infinity) - (b.drive_minutes ?? Infinity));
    const rest = stations.slice(ROUTE_DESTINATIONS);
    return {
      routed: [...routed, ...rest],
      credits_spent: response.credits_charged ?? 0,
      routing_available: true,
    };
  } catch (err) {
    return { routed: stations, credits_spent: 0, routing_available: false, routing_error: err.message };
  }
}

/** Physical context at the rider's own coordinate, straight from Mireye. */
export async function fetchRiderPhysical({ lat, lng, fetchImpl = mireye.fetch.bind(mireye) } = {}) {
  try {
    const response = await fetchImpl({ lat, lng, fields: RIDER_PHYSICAL_FIELDS });
    const value = (name) => {
      const f = response?.fields?.[name];
      return f?.status === 'ok' ? f.value : null;
    };
    return {
      fields: response?.fields ?? null,
      road_distance_m: value('nearest_road_distance_m'),
      road_class: value('nearest_road_class'),
      electricity_price_usd_per_kwh: value('avg_retail_electricity_price_industrial_usd_per_kwh'),
      housing_units_within_1km: value('housing_units_within_1km'),
      elevation_m: value('elevation'),
      slope_degrees: value('slope_degrees'),
      utility: value('electric_utility_service_territory'),
      credits_spent: RIDER_PHYSICAL_FIELDS.length,
    };
  } catch (err) {
    return { fields: null, credits_spent: 0, error: err.message };
  }
}
