import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCountyCentroid } from '../county-centroids.js';

test('resolves known CA county FIPS to a centroid inside California', () => {
  const madera = getCountyCentroid('06039', 'CA');
  assert.equal(madera.county_name, 'Madera County');
  assert.ok(madera.lat > 32 && madera.lat < 42, 'latitude should be within CA');
  assert.ok(madera.lng > -125 && madera.lng < -114, 'longitude should be within CA');
});

test('returns null for an unknown FIPS code', () => {
  assert.equal(getCountyCentroid('99999', 'CA'), null);
});

test('throws for a state with no bundled centroid file', () => {
  assert.throws(() => getCountyCentroid('36001', 'NY'));
});
