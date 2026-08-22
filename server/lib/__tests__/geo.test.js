import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceMeters, meanPoint, pointInGeometry, findContainingFeature } from '../geo.js';

// A simple 10x10 square, [lng, lat] winding, centered at (0,0).
const SQUARE_RING = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
  [-5, -5],
];
// The same square with a 2x2 hole cut out of its center.
const HOLE_RING = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
];

test('haversineDistanceMeters returns 0 for identical points', () => {
  assert.equal(haversineDistanceMeters({ lat: 37.7, lng: -122.4 }, { lat: 37.7, lng: -122.4 }), 0);
});

test('haversineDistanceMeters matches a known real-world distance (SF to LA, ~560km)', () => {
  const sf = { lat: 37.7749, lng: -122.4194 };
  const la = { lat: 34.0522, lng: -118.2437 };
  const km = haversineDistanceMeters(sf, la) / 1000;
  assert.ok(km > 550 && km < 570, `expected ~560km, got ${km.toFixed(1)}km`);
});

test('meanPoint averages lat/lng across multiple points', () => {
  const mean = meanPoint([
    { lat: 10, lng: 20 },
    { lat: 20, lng: 40 },
  ]);
  assert.deepEqual(mean, { lat: 15, lng: 30 });
});

test('meanPoint returns null for an empty list', () => {
  assert.equal(meanPoint([]), null);
  assert.equal(meanPoint(undefined), null);
});

// --- pointInGeometry ---

test('pointInGeometry finds a point inside a simple Polygon', () => {
  const geometry = { type: 'Polygon', coordinates: [SQUARE_RING] };
  assert.equal(pointInGeometry({ lat: 0, lng: 0 }, geometry), true);
  assert.equal(pointInGeometry({ lat: 100, lng: 100 }, geometry), false);
});

test('pointInGeometry excludes a point inside a polygon\'s hole', () => {
  const geometry = { type: 'Polygon', coordinates: [SQUARE_RING, HOLE_RING] };
  assert.equal(pointInGeometry({ lat: 0, lng: 0 }, geometry), false); // inside the hole
  assert.equal(pointInGeometry({ lat: 3, lng: 3 }, geometry), true); // inside the square, outside the hole
});

test('pointInGeometry checks every polygon in a MultiPolygon', () => {
  const farAwaySquare = SQUARE_RING.map(([lng, lat]) => [lng + 100, lat + 100]);
  const geometry = { type: 'MultiPolygon', coordinates: [[SQUARE_RING], [farAwaySquare]] };
  assert.equal(pointInGeometry({ lat: 0, lng: 0 }, geometry), true);
  assert.equal(pointInGeometry({ lat: 100, lng: 100 }, geometry), true);
  assert.equal(pointInGeometry({ lat: 50, lng: 50 }, geometry), false);
});

test('pointInGeometry recurses into a GeometryCollection (San Francisco\'s real shape: mainland + islands)', () => {
  const farAwaySquare = SQUARE_RING.map(([lng, lat]) => [lng + 100, lat + 100]);
  const geometry = {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Polygon', coordinates: [SQUARE_RING] },
      { type: 'Polygon', coordinates: [farAwaySquare] },
    ],
  };
  assert.equal(pointInGeometry({ lat: 0, lng: 0 }, geometry), true);
  assert.equal(pointInGeometry({ lat: 100, lng: 100 }, geometry), true);
  assert.equal(pointInGeometry({ lat: 50, lng: 50 }, geometry), false);
});

test('pointInGeometry returns false for a missing geometry', () => {
  assert.equal(pointInGeometry({ lat: 0, lng: 0 }, null), false);
});

// --- findContainingFeature ---

test('findContainingFeature returns the feature whose polygon contains the point', () => {
  const fc = {
    features: [
      { properties: { county_name: 'Square County' }, geometry: { type: 'Polygon', coordinates: [SQUARE_RING] } },
      {
        properties: { county_name: 'Faraway County' },
        geometry: { type: 'Polygon', coordinates: [SQUARE_RING.map(([lng, lat]) => [lng + 100, lat + 100])] },
      },
    ],
  };
  const found = findContainingFeature({ lat: 0, lng: 0 }, fc);
  assert.equal(found.properties.county_name, 'Square County');
});

test('findContainingFeature returns null when no feature contains the point', () => {
  const fc = { features: [{ properties: {}, geometry: { type: 'Polygon', coordinates: [SQUARE_RING] } }] };
  assert.equal(findContainingFeature({ lat: 1000, lng: 1000 }, fc), null);
});
