import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { writeJsonAtomic } from '../lib/atomic-json.js';
import { mireye } from './mireye.js';
import { listCountiesForState } from '../lib/zip-county.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

// Madera County centroid — the spec's own worked example (docs/volt-terra-spec.pdf,
// page 2). Also confirms the response shape (source, source_url, confidence,
// fetched_at) scoring.js and memo-generator.js will depend on in Days 5-11.
const SAMPLE_LOCATION = { lat: 36.9613, lng: -120.0607, label: 'Madera County, CA centroid' };
const REQUIRED_PRESETS = ['grid_interconnect', 'utilities'];

/**
 * Days 3-4 checklist item 1: confirms the two presets the join pipeline
 * (Days 5-7) is scoped around actually exist in Mireye's live catalog,
 * rather than trusting the README's point-in-time confirmation forever.
 */
export function checkPresetsPresent(catalog, presetNames = REQUIRED_PRESETS) {
  const presets = catalog.presets ?? {};
  const results = presetNames.map((name) => ({
    preset: name,
    found: Object.prototype.hasOwnProperty.call(presets, name),
    field_count: presets[name]?.length ?? 0,
  }));
  return { ok: results.every((r) => r.found), presets: results };
}

/**
 * Days 3-4 checklist item 2: confirms the pilot state's DMV registration
 * data (already ingested in Days 1-2) resolves at the county level well
 * enough to build on — not just that the ingest script ran without error.
 */
export function checkCountyCoverage({ crosswalkCounties, dmvCounties, chargerCounties }) {
  const crosswalkFips = new Set(crosswalkCounties.map((c) => c.county_fips));
  const dmvFips = new Set(dmvCounties.map((c) => c.county_fips));
  const chargerFips = new Set(chargerCounties.map((c) => c.county_fips));

  const missingFromDmv = crosswalkCounties.filter((c) => !dmvFips.has(c.county_fips));
  const missingFromChargers = crosswalkCounties.filter((c) => !chargerFips.has(c.county_fips));

  return {
    total_counties: crosswalkFips.size,
    dmv_counties_present: dmvFips.size,
    charger_counties_present: chargerFips.size,
    dmv_coverage_ratio: crosswalkFips.size ? dmvFips.size / crosswalkFips.size : 0,
    charger_coverage_ratio: crosswalkFips.size ? chargerFips.size / crosswalkFips.size : 0,
    missing_from_dmv: missingFromDmv.map((c) => c.county_name),
    missing_from_chargers: missingFromChargers.map((c) => c.county_name),
    ok: missingFromDmv.length === 0 && missingFromChargers.length === 0,
  };
}

/** Confirms a live /v1/fetch response actually carries usable, cited values. */
export function checkSampleFetch(sampleResponse, expectedFields) {
  const fields = sampleResponse.fields ?? {};
  const results = expectedFields.map((name) => {
    const f = fields[name];
    return {
      field: name,
      present: Boolean(f),
      has_source: Boolean(f?.source),
      status: f?.status ?? null,
    };
  });
  return { ok: results.every((r) => r.present && r.has_source), fields: results };
}

async function readJsonCache(filename) {
  const raw = await readFile(path.join(CACHE_DIR, filename), 'utf8');
  return JSON.parse(raw);
}

export async function verifyPilotSetup({ state = config.pilotState } = {}) {
  const catalog = await mireye.getFieldCatalog();
  const presetCheck = checkPresetsPresent(catalog);

  const quote = await mireye.fetchQuote({ preset: 'grid_interconnect', locations: 1 });
  const authCheck = { ok: Boolean(quote?.credits_total >= 0), plan: quote?.plan, allowance: quote?.allowance };

  const sample = await mireye.fetch({ ...SAMPLE_LOCATION, preset: 'grid_interconnect' });
  const sampleCheck = checkSampleFetch(sample, [
    'nearest_substation_distance_m',
    'nearest_substation_max_voltage_kv',
    'electric_utility_service_territory',
    'interconnection_queue_active_capacity_caiso_mw',
  ]);

  const [dmv, afdc] = await Promise.all([
    readJsonCache(`ev-registrations-${state}.json`),
    readJsonCache(`afdc-${state}.json`),
  ]);
  const coverageCheck = checkCountyCoverage({
    crosswalkCounties: listCountiesForState(state),
    dmvCounties: dmv.counties,
    chargerCounties: afdc.counties,
  });

  const report = {
    state,
    checked_at: new Date().toISOString(),
    mireye_auth: authCheck,
    preset_catalog: presetCheck,
    sample_fetch: sampleCheck,
    county_coverage: coverageCheck,
    ok: authCheck.ok && presetCheck.ok && sampleCheck.ok && coverageCheck.ok,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `pilot-setup-verification-${state}.json`);
  await writeJsonAtomic(outPath, report);

  return { outPath, ...report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outPath, ok, mireye_auth, preset_catalog, sample_fetch, county_coverage } = await verifyPilotSetup();

  console.log(`Mireye auth: ${mireye_auth.ok ? 'OK' : 'FAILED'} (plan: ${mireye_auth.plan}, ${mireye_auth.allowance?.credits_remaining}/${mireye_auth.allowance?.credits_included} credits remaining)`);
  console.log(`Preset catalog: ${preset_catalog.ok ? 'OK' : 'FAILED'} — ${preset_catalog.presets.map((p) => `${p.preset}=${p.found ? p.field_count + ' fields' : 'MISSING'}`).join(', ')}`);
  console.log(`Sample fetch (${SAMPLE_LOCATION.label}): ${sample_fetch.ok ? 'OK' : 'FAILED'}`);
  console.log(
    `County coverage: DMV ${county_coverage.dmv_counties_present}/${county_coverage.total_counties}, ` +
      `chargers ${county_coverage.charger_counties_present}/${county_coverage.total_counties}`
  );
  console.log(`Wrote ${outPath}`);

  if (!ok) {
    console.error('Days 3-4 verification FAILED — see report for details.');
    process.exit(1);
  }
  console.log('Days 3-4 verification passed.');
}
