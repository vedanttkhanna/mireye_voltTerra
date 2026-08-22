import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGazetteerText } from '../county-centroids.js';

const HEADER = 'USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                ';

test('parses CA rows and skips other states', () => {
  const text = [
    HEADER,
    'CA\t06039\t01675868\tMadera County\t1\t1\t1\t1\t37.209821\t-119.749802     ',
    'NY\t36001\t00974104\tAlbany County\t1\t1\t1\t1\t42.601168\t-73.972866       ',
  ].join('\n');

  const rows = parseGazetteerText(text, { usps: 'CA' });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    county_fips: '06039',
    county_name: 'Madera County',
    lat: 37.209821,
    lng: -119.749802,
  });
});

test('throws if an expected column is missing', () => {
  const text = 'USPS\tGEOID\tNAME\n' + 'CA\t06039\tMadera County';
  assert.throws(() => parseGazetteerText(text, { usps: 'CA' }), /missing expected column/);
});
