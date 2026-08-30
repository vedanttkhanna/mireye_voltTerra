import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCountyRiderFeasibility } from '../rider.js';

const county = ({ ports, dcFast, ratio }) => ({
  charger_count: ports,
  chargers: { station_count: 1, level2_ports: ports - dcFast, dc_fast_ports: dcFast },
  driver_to_plug_ratio: ratio,
});

test('a county with no public ports at all is hard', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 0, dcFast: 0, ratio: null }), {
    stateMedianRatio: 500,
  });
  assert.equal(rated.rating, 'hard');
  assert.match(rated.reasons[0], /no public charging ports/);
});

test('Level 2 only is hard: there is nothing to fast charge on', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 40, dcFast: 0, ratio: 100 }), {
    stateMedianRatio: 500,
  });
  assert.equal(rated.rating, 'hard');
  assert.match(rated.reasons[0], /no public DC fast charging/);
});

test('fast charging at or below the state median is easy', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 200, dcFast: 30, ratio: 400 }), {
    stateMedianRatio: 500,
  });
  assert.equal(rated.rating, 'easy');
  assert.equal(rated.contested, false);
});

test('above the median but not contested is workable', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 200, dcFast: 30, ratio: 700 }), {
    stateMedianRatio: 500,
  });
  assert.equal(rated.rating, 'workable');
  assert.equal(rated.contested, false);
  assert.match(rated.reasons[0], /above the state median/);
});

test('contention at twice the median caps a well-equipped county at workable', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 200, dcFast: 30, ratio: 1000 }), {
    stateMedianRatio: 500,
  });
  assert.equal(rated.rating, 'workable');
  assert.equal(rated.contested, true);
  assert.match(rated.reasons[0], /twice the state median/);
});

test('no demand figure to compare against is reported as unknown, not as easy', () => {
  const rated = scoreCountyRiderFeasibility(county({ ports: 200, dcFast: 30, ratio: null }), {
    stateMedianRatio: null,
  });
  assert.equal(rated.rating, 'unknown');
  assert.match(rated.reasons.at(-1), /not enough demand data/);
});
