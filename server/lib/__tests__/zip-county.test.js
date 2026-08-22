import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipToCounty, listCountiesForState } from '../zip-county.js';

test('resolves known CA ZIPs to their county', () => {
  assert.equal(zipToCounty('90001', 'CA').county_name, 'Los Angeles County');
  assert.equal(zipToCounty('94102', 'CA').county_name, 'San Francisco County');
  assert.equal(zipToCounty('93636', 'CA').county_name, 'Madera County');
});

test('handles 9-digit ZIP+4 by truncating to 5', () => {
  assert.equal(zipToCounty('90001-1234', 'CA').county_name, 'Los Angeles County');
});

test('returns null for unknown ZIP', () => {
  assert.equal(zipToCounty('00000', 'CA'), null);
});

test('returns null for missing input', () => {
  assert.equal(zipToCounty(null, 'CA'), null);
  assert.equal(zipToCounty(undefined, 'CA'), null);
});

test('throws for a state with no bundled crosswalk', () => {
  assert.throws(() => zipToCounty('10001', 'NY'));
});

test('listCountiesForState returns all 58 CA counties', () => {
  const counties = listCountiesForState('CA');
  assert.equal(counties.length, 58);
});
