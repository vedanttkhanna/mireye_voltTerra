import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStationsByCounty, pickEvenlySpaced } from '../afdc.js';

const stations = [
  { id: 1, zip: '90001', ev_level2_evse_num: 2, ev_dc_fast_num: 0, ev_level1_evse_num: 0 }, // LA County
  { id: 2, zip: '90002', ev_level2_evse_num: 0, ev_dc_fast_num: 4, ev_level1_evse_num: 0 }, // LA County
  { id: 3, zip: '93636', ev_level2_evse_num: 1, ev_dc_fast_num: 0, ev_level1_evse_num: 1 }, // Madera County
  { id: 4, zip: '00000', ev_level2_evse_num: 1, ev_dc_fast_num: 0, ev_level1_evse_num: 0 }, // unresolvable
];

test('aggregates station counts and port totals per county', () => {
  const { counties } = aggregateStationsByCounty(stations, { state: 'CA' });

  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.station_count, 2);
  assert.equal(la.level2_ports, 2);
  assert.equal(la.dc_fast_ports, 4);

  const madera = counties.find((c) => c.county_name === 'Madera County');
  assert.equal(madera.station_count, 1);
  assert.equal(madera.level1_ports, 1);
});

test('collects stations with unresolvable ZIPs instead of dropping them silently', () => {
  const { unresolved } = aggregateStationsByCounty(stations, { state: 'CA' });
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].id, 4);
});

test('handles an empty station list', () => {
  const { counties, unresolved } = aggregateStationsByCounty([], { state: 'CA' });
  assert.deepEqual(counties, []);
  assert.deepEqual(unresolved, []);
});

test('missing EVSE-count fields default to zero rather than NaN', () => {
  const { counties } = aggregateStationsByCounty([{ id: 5, zip: '90001' }], { state: 'CA' });
  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.level2_ports, 0);
  assert.equal(la.dc_fast_ports, 0);
  assert.equal(la.level1_ports, 0);
});

test('collects corridor_points from stations that carry coordinates', () => {
  const withCoords = [
    { id: 1, zip: '90001', latitude: 34.0, longitude: -118.2 },
    { id: 2, zip: '90001', latitude: 34.1, longitude: -118.3 },
    { id: 3, zip: '90001' }, // no coords — excluded
  ];
  const { counties } = aggregateStationsByCounty(withCoords, { state: 'CA' });
  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.corridor_points.length, 2);
  assert.deepEqual(la.corridor_points[0], { id: 1, station_name: undefined, lat: 34.0, lng: -118.2 });
});

test('demand_centroid averages ALL geocoded stations, not just the truncated corridor sample', () => {
  const withCoords = [
    { id: 1, zip: '90001', latitude: 34.0, longitude: -118.0 },
    { id: 2, zip: '90001', latitude: 34.2, longitude: -118.2 },
    { id: 3, zip: '90001', latitude: 34.4, longitude: -118.4 },
    { id: 4, zip: '90001', latitude: 34.6, longitude: -118.6 },
  ];
  const { counties } = aggregateStationsByCounty(withCoords, { state: 'CA' });
  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.corridor_points.length, 3); // truncated per CORRIDOR_SAMPLE_SIZE
  assert.ok(Math.abs(la.demand_centroid.lat - 34.3) < 1e-9); // mean of all 4
  assert.ok(Math.abs(la.demand_centroid.lng - -118.3) < 1e-9);
});

test('demand_centroid is null for a county with no geocoded stations', () => {
  const { counties } = aggregateStationsByCounty([{ id: 1, zip: '90001' }], { state: 'CA' });
  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.demand_centroid, null);
});

test('pickEvenlySpaced returns the whole list when under the max', () => {
  assert.deepEqual(pickEvenlySpaced([1, 2], 3), [1, 2]);
});

test('pickEvenlySpaced spreads picks across the full index range', () => {
  const list = Array.from({ length: 9 }, (_, i) => i);
  assert.deepEqual(pickEvenlySpaced(list, 3), [0, 3, 6]);
});
