import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistrationsCsv, aggregateRegistrationsByCounty } from '../registrations.js';

const sampleCsv = `Date,ZIP Code,Model Year,Fuel,Make,Duty,Vehicles
12/31/2023,90001,2020,Battery Electric,TESLA,Light,100
12/31/2023,90001,2019,Gasoline,HONDA,Light,500
12/31/2023,90001,2021,Plug-in Hybrid,TOYOTA,Light,40
12/31/2024,90001,2020,Battery Electric,TESLA,Light,150
12/31/2024,00000,2020,Battery Electric,TESLA,Light,10
`;

test('parseRegistrationsCsv filters to BEV + PHEV and drops other fuels', () => {
  const rows = parseRegistrationsCsv(sampleCsv);
  assert.equal(rows.length, 4); // the Gasoline row is excluded
  assert.ok(rows.every((r) => r.fuel === 'Battery Electric' || r.fuel === 'Plug-in Hybrid'));
});

test('parseRegistrationsCsv derives year from the Date column', () => {
  const rows = parseRegistrationsCsv(sampleCsv);
  const y2023 = rows.filter((r) => r.year === 2023);
  const y2024 = rows.filter((r) => r.year === 2024);
  assert.equal(y2023.length, 2);
  assert.equal(y2024.length, 2);
});

test('aggregateRegistrationsByCounty sums per county per year and computes YoY growth', () => {
  const rows = parseRegistrationsCsv(sampleCsv);
  const { counties, unresolvedZips } = aggregateRegistrationsByCounty(rows, { state: 'CA' });

  const la = counties.find((c) => c.county_name === 'Los Angeles County');
  assert.equal(la.registrations_by_year[2023], 140); // 100 BEV + 40 PHEV
  assert.equal(la.registrations_by_year[2024], 150);
  assert.equal(la.latest_registrations, 150);
  assert.ok(Math.abs(la.yoy_growth_rate - (150 - 140) / 140) < 1e-9);

  assert.deepEqual(unresolvedZips, ['00000']);
});

test('a county with only one year of data has null yoy_growth_rate', () => {
  const rows = [{ zip: '93636', year: 2024, fuel: 'Battery Electric', vehicles: 20 }];
  const { counties } = aggregateRegistrationsByCounty(rows, { state: 'CA' });
  assert.equal(counties[0].yoy_growth_rate, null);
});
