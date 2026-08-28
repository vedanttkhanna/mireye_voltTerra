import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLiveRegistrationRows } from '../live-registrations.js';

test('aggregates current BEV and PHEV records by a DMV county field', () => {
  const result = aggregateLiveRegistrationRows([
    { County: 'Example County', 'Fuel Type': 'Battery Electric', 'Vehicle Count': '12', 'Latest DMV Snapshot Flag': 'TRUE' },
    { County: 'Example County', 'Fuel Type': 'Plug-In Hybrid', 'Vehicle Count': '3', 'Latest DMV Snapshot Flag': 'true' },
    { County: 'Example County', 'Fuel Type': 'Gasoline', 'Vehicle Count': '99', 'Latest DMV Snapshot Flag': 'true' },
    { County: 'Example County', 'Fuel Type': 'Battery Electric', 'Vehicle Count': '20', 'Latest DMV Snapshot Flag': 'false' },
  ], [{ county_fips: '06001', county_name: 'Example County' }]);

  assert.equal(result.byCounty.get('06001'), 15);
  assert.equal(result.resolved, 15);
  assert.equal(result.unresolved, 0);
});

test('does not treat an unresolved registration location as zero EV demand', () => {
  const result = aggregateLiveRegistrationRows([
    { County: 'Unknown Place', 'Fuel Type': 'BEV', 'Vehicle Count': '8', 'Latest DMV Snapshot Flag': 'true' },
  ], [{ county_fips: '06001', county_name: 'Example County' }]);

  assert.equal(result.byCounty.size, 0);
  assert.equal(result.unresolved, 8);
});
