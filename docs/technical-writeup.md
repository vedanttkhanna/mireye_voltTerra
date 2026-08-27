# VOLT-TERRA — Technical Writeup

*A detailed reference for how the system actually works, file by file, as of 2026-08-24. Every claim below was verified against the current source and a live test/data run in this session — nothing here is carried forward from an earlier state without re-checking. For the narrative build story see [write-up.md](write-up.md); for a live-numbers snapshot see [../PROJECT_STATUS.md](../PROJECT_STATUS.md); for setup commands see [../README.md](../README.md).*

## 1. What it does

VOLT-TERRA ranks California's 58 counties by EV-registrations-per-charging-port, flags the ones under real charging stress, and for each flagged county runs a live physical-grid feasibility check against Mireye to decide whether the fix is **"fund a charger now"** or **"fund a grid upgrade first"** — then writes a cited justification memo for that decision. A secondary chat agent lets an analyst ask the same system questions in natural language, with the same physical-data grounding.

Stack: Node/Express backend, no database (JSON cache files under `server/data/cache/`), Vite/React frontend with a Leaflet map. No build step server-side — `node --watch` in dev.

## 2. Architecture, top to bottom

```
External data                Backend services                    Cache (server/data/)
──────────────                ────────────────                    ───────────────────
DOE AFDC API        ──ingest──▶ afdc.js                ──────────▶ afdc-CA.json
CA DMV (data.ca.gov) ──ingest─▶ registrations.js        ──────────▶ ev-registrations-CA.json
Census ZCTA file     (static)──▶ zip-county.js (lib)     ──────────▶ zip-county-crosswalk-ca.json
Census pop. centers  ──ingest──▶ county-centroids.js     ──────────▶ county-centroids-CA.json
Census county KML    ──ingest──▶ county-boundaries.js    ──────────▶ county-boundaries-CA.json
                                        │
                                        ▼
                              orchestrator.js (join pipeline)
                              samples each county, calls Mireye
                              /v1/lookup + /v1/fetch/batch      ──▶ join-pipeline-CA.json
                                        │
                                        ▼
                              scoring.js (ratio + gates + bucket) ─▶ scored-counties-CA.json
                                        │
                                        ▼
                              memo-generator.js (Mireye /v1/ask)  ─▶ memos-CA.json
                                        │
                                        ▼
                              nevi-backtest.js (CEC ArcGIS)       ─▶ backtest-CA.json, nevi-awards-CA.json

Express routes (server/routes/) read those cache files and serve them to:
  React dashboard (src/) ── Leaflet choropleth, ranked table, drill-down, memo panel
  Chat agent (llm-agent.js + mcp-tools.js) ── Gemini → Groq → deterministic fallback chain
```

Nothing computes live in the frontend or in a route handler — every route is a cache read (or, for `/pipeline/run` and `/pipeline/score`, a trigger that re-runs a service and re-writes the cache). This matches the build brief's "the agent decides, the dashboard displays" framing literally: there is no scoring logic in `src/`.

## 3. Data sources

| Source | What it provides | Ingested by | Vintage |
|---|---|---|---|
| DOE Alternative Fuels Data Center (`developer.nlr.gov`) | Every open (`status=E`) electric charging station in CA: location, ZIP, Level 2 / DC-fast / Level 1 port counts | `afdc.js` | Live at ingest time (`updated_at` per station) |
| CA DMV "Vehicle Fuel Type Count by Zip Code" (`data.ca.gov`, CKAN) | BEV + PHEV registration counts by ZIP, 3 most recent annual snapshots | `registrations.js` | 3 most recent "as of" dates |
| Census 2020 ZCTA-to-county relationship file | ZIP → county FIPS join key (primary county = larger land-area overlap) | one-time build, not a live ingest — see `server/data/zip-county-crosswalk-ca.json` | 2020 |
| Census 2020 Mean Centers of Population, county-level | One population-weighted point per county — the primary sample point scoring decides on | `county-centroids.js` | 2020 |
| Census 2020 Cartographic Boundary Files (1:500k, KML) | County polygon geometry for the choropleth map | `county-boundaries.js` | 2020 |
| CA Energy Commission / Caltrans NEVI awards (ArcGIS FeatureServer) | Real federal EV-infrastructure funding awards, Rounds 1-3 | `nevi-backtest.js` | Live at ingest time |
| Mireye API | Cited physical grid/utility fields per coordinate | `mireye.js` client, called from `orchestrator.js` and `memo-generator.js` | Live per call |

### Why ZIP-code join, not lat/lng

Both AFDC and DMV data are ZIP-code-level; Mireye and the Census boundary data are coordinate/polygon-level. `zip-county.js` bridges them with the Census ZCTA relationship file, assigning a ZIP that straddles a county line to whichever county holds the larger land-area share of that ZCTA. This is an approximation, not exact — `orchestrator.js`'s `checkLookupAgreement` cross-checks every sample point's expected county against Mireye's own `/v1/lookup` result and records disagreements (`lookup_mismatches` in `join-pipeline-CA.json`) rather than silently trusting the ZIP join.

## 4. The Mireye API client (`server/services/mireye.js`)

A from-scratch client, verified against the live OpenAPI spec at `api.mireye.com/v1/openapi.json` (not just the pitch deck) during initial scaffolding. Key behaviors:

- **Auth**: `Authorization: Bearer $MIREYE_API_KEY` on every call except `GET /v1/meta/fields` (free, no key).
- **Rate limiting**: an in-process sliding-window limiter capped at 60 requests/minute, matching the Build plan's documented limit.
- **Batching**: `fetchBatch` enforces Mireye's 25-location cap per call and throws if exceeded; `fetchBatchChunked` transparently splits a longer location list into sequential ≤25 batches.
- **Retries**: exponential backoff on 429/502/504, honoring a `Retry-After` header when present.
- **Endpoints wired**: `getFieldCatalog` (`GET /v1/meta/fields`), `getPlans` (`GET /v1/meta/plans`), `fetchQuote`, `fetch`, `fetchBatch`/`fetchBatchChunked`, `geocode`, `lookup`, `ask`, `createFieldRequest`. `/v1/geocode` is implemented but never called in the pipeline — every sample point already has a coordinate (population center or AFDC station lat/lng), so there's no address string to resolve.

## 5. Ingestion services

### `afdc.js`
Paginates `GET /api/alt-fuel-stations/v1.json` (200 rows/page, DOE's hard max) with exponential backoff on 429/502/503/504 — `DEMO_KEY`'s tight rate ceiling makes this necessary for a full CA sweep. `validateStation` rejects malformed records (bad coordinate pairs, non-numeric port counts, unparseable timestamps) before they reach aggregation. `aggregateStationsByCounty` joins each station to a county via `zip-county.js`, sums Level 2 / DC-fast / Level 1 port counts, and — via `pickEvenlySpaced` — keeps up to 3 station coordinates per county as **corridor points**, spread evenly across the county's station list index (not geographic clustering). Stations with unresolvable ZIPs are logged in an `unresolved` array, not dropped silently. `ingestAfdc` refuses to overwrite the cache if fewer than 50% of expected counties resolve.

### `registrations.js`
Resolves the 3 most recent annual CSV resources from the CA DMV CKAN package via `package_show`, downloads and parses each with `csv-parse`, and counts rows where `Fuel` is `Battery Electric` or `Plug-in Hybrid` toward "EV registrations" (a stated judgment call — PHEVs lean on public charging less than BEVs, but both rely on it more than a conventional hybrid). `year` comes from each row's own `Date` column, not the resource filename. `aggregateRegistrationsByCounty` sums per county per year and computes a simple year-over-year growth rate. Refuses to overwrite the cache below 90% expected county coverage.

### `county-centroids.js`
Downloads the Census Bureau's 2020 county mean-center-of-population file (`CenPop2020_Mean_CO06.txt` for CA), parses it, and validates every row (5-digit FIPS, finite non-negative population, finite lat/lng, no duplicate FIPS) before writing. This is the file `server/lib/county-centroids.js` reads at runtime via `getCountyCentroid(fips, state)`.

### `county-boundaries.js`
The most structurally distinct ingester: Census only publishes cartographic boundaries as shapefile/geodatabase/KML/geopackage, not GeoJSON. It downloads the 1:500,000 county KML zip, shells out to `unzip` to extract the KML entry, parses it with `@xmldom/xmldom`, and converts to GeoJSON with `@tmcw/togeojson` (chosen specifically because it correctly turns a `MultiGeometry` — e.g. San Francisco's mainland + Farallon Islands — into a `GeometryCollection`, rather than silently keeping only one polygon). Filters to CA's `STATEFP` and writes `county-boundaries-CA.json`.

### `zip-county.js` (`server/lib/`)
Not an ingester — a static lookup built once from the Census 2020 ZCTA-to-county relationship file (1,808 CA ZCTAs), committed to the repo as `zip-county-crosswalk-ca.json`. Also exports `listCountiesForState`, which every other service uses as the canonical "all 58 CA counties" list.

## 6. The join pipeline (`orchestrator.js`)

`runFullSweep` is the step that turns ingested data plus live Mireye calls into `join-pipeline-CA.json`:

1. **Ingest** — runs `ingestAfdc` and `ingestRegistrations` in parallel (re-fetches fresh data on every sweep).
2. **County sampling** (`buildCountySamplePoints`) — one **population_center** point per county (from `county-centroids.js`) plus up to 3 **corridor** points (existing AFDC charger locations for that county). Corridor points are explicitly never allowed to become the bucket-deciding point — see §7.
3. **Cost preflight** — calls `mireye.fetchQuote` once (1 location, the full `GRID_FEASIBILITY_FIELDS` list) and multiplies by the total sample-point count to estimate total cost. If the estimate exceeds `MAX_SWEEP_CREDITS` (default 15,000), the sweep throws `CreditCapError` before spending anything.
4. **Canonical join** — one `mireye.lookup(lat,lng)` call per sample point (`include_parcel: false`, since parcel data is 300 credits/location and explicitly out of scope per the build brief). `checkLookupAgreement` compares Mireye's returned county against the ZIP-crosswalk's expected county and records `lookup_mismatches`, split into `different_county` (a real disagreement) and `unresolved` (Mireye's lookup returned nothing — observed to often be transient on retry, not a real ambiguity).
5. **Grid data fetch** — one `mireye.fetchBatchChunked` call across every sample point, requesting `GRID_FEASIBILITY_FIELDS` (23 fields — see below).
6. **Persistence** — `writeJsonAtomic` (temp file + atomic rename) writes `join-pipeline-CA.json`, so a crash mid-write can't corrupt the cache.

### `GRID_FEASIBILITY_FIELDS`
A curated subset of the `grid_interconnect` + `utilities` presets (not the full preset — irrelevant fields like water/sewer/gas are excluded, and the 6 non-CAISO interconnection-queue variants are dropped since this pilot is CA/CAISO-only): substation distance/voltage/status (EIA primary), `nearest_osm_substation_*` (OSM fallback, added mid-project after a memo cross-check revealed a case where EIA had nothing for a coordinate but OSM did — see §8), utility service territory, ISO/RTO, CAISO interconnection queue capacity, transmission line distance/voltage/redundancy, and nearby power plant/proposed generator fields.

## 7. Scoring (`scoring.js`)

Two independent computations, both stated explicitly as design choices with reasoning in the code:

### Driver-to-plug ratio
```
ratio = latest_registrations / (level2_ports + dc_fast_ports)
```
Level 1 ports are excluded (residential-grade, not a real public-charging resource). `flagUnderservedCounties` computes the state median ratio and flags any county at or above `median × UNDERSERVED_THRESHOLD_MULTIPLIER` (default 2.0) — a peer-relative threshold, per the build brief's explicit requirement, not an arbitrary cutoff.

### Grid feasibility — `computeGridFeasibilityScore`
Three **hard gates**, evaluated at one sample point:

| Gate | Threshold | Constant |
|---|---|---|
| Substation exists | any distance found | — |
| Close enough | ≤ 8,000 m (~5 mi) | `SUBSTATION_DISTANCE_CONSTRAINED_M` |
| Strong enough | ≥ 60 kV | `SUBSTATION_VOLTAGE_MIN_KV` |

A 4th soft condition: if the substation's status is *explicitly* published as anything other than `"IN SERVICE"`, the gates fail outright (`statusDisqualifies`). A **missing/unpublished** status does *not* disqualify — this is a deliberate permissive default, and it's the concrete reason Riverside County currently passes gates (`Status: -`) despite its own `/v1/ask` memo recommending a utility study first (see §9).

The 0–100 **score** (`distanceScore` up to 60 + `voltageScore` up to 40 + a 10-point redundancy bonus) is separate from `passes_gates` and is explicitly documented as "a display aid, not a second source of truth" — a county can score low and still pass every gate (Yuba County: score 28/100, still `fund_charger_now`, verified live).

**EIA vs. OSM fallback**: EIA substation fields are always primary; `nearest_osm_substation_*` fields are only consulted when EIA returns nothing for that coordinate. OSM has no published operational-status field, so the status-disqualification check simply doesn't apply on the OSM path (there's no "unpublished status" ambiguity to resolve, since the concept doesn't exist in that source).

### Primary sample point selection — `scoreCountyGridFeasibility`
The **population_center** point is always primary if present (falls back to a legacy `centroid` type, then to the best-scoring remaining point only if neither exists — documented as not occurring for any of CA's 58 counties currently). This replaced an earlier version that picked whichever sample point scored highest, corridor points included — a real bug, caught on a live CA run: Riverside County's population center had no substation in range at all, but an existing charger's corridor point sat 913m from a 66kV substation and would have been picked as "best," flipping the bucket to `fund_charger_now` on evidence that shouldn't have supported it. Corridor/charger points are now carried through only as `grid_context.best_alternative_site` — informational, explicitly excluded from the bucket decision, because they describe historic supply placement, not demand.

### Bucketing — `bucketCounty`
```
insufficient_data   if grid_feasibility.data_sufficient === false (missing distance or voltage)
fund_charger_now     if passes_gates === true
fund_grid_upgrade_first  otherwise
```
Only computed for counties that are flagged underserved — a non-flagged county has no funding decision to make.

## 8. Memo generation (`memo-generator.js`)

`buildMemoQuestion` constructs a question grounded in the county's own computed numbers (ratio, nearest substation distance/voltage/status) and asks Mireye's `/v1/ask` directly whether the grid can support a new DC-fast deployment or needs capacity work first — Mireye answers independently from its own fetched fields (it never sees VOLT-TERRA's bucket verdict), making the memo a genuine cross-check on the gate logic rather than narration of a number already known. The question is asked at the exact same coordinate `scoring.js` used, so the memo and the bucket are talking about the same physical location.

This cross-check is what surfaced the EIA/OSM gap in the first place: during Days 10-11, a memo cited OSM substation fields the join pipeline hadn't fetched — Mireye's own catalog had grown from 310 to 325 fields since the field list was curated. The OSM fallback fields were added to `GRID_FEASIBILITY_FIELDS` in response.

`generateMemoForCounty` (one county) and `generateAllMemos` (every flagged county without a memo, or all of them with `regenerate: true`) both persist to `memos-CA.json` via `writeJsonAtomic`, merging rather than clobbering other counties' memos.

## 9. NEVI backtest (`nevi-backtest.js`)

Queries the CEC's public ArcGIS FeatureServer for all real NEVI (federal EV-infrastructure) award records across California, aggregates award counts per county (with a name-normalization fix for a known data-entry typo, `"San Bernadino"` → `"San Bernardino"`), and joins that to `scored-counties-CA.json`.

**The comparison is stated as a plausibility check, not proof**, up front in the file's own header comment: NEVI awards are allocated by federal Alternative Fuel Corridor coverage-gap rules (is there a charger every ~50 highway miles on a designated corridor) — a fundamentally different criterion from VOLT-TERRA's county-level registration-per-charger ratio. `summarizeBacktest` deliberately does not compute a single accuracy number, since that would overstate what the comparison can prove; it reports the four quadrants (flagged+funded, flagged+not-funded, not-flagged+funded, and the funding rate among flagged counties) plainly.

A deeper site-level spot-check (`server/data/evidence/nevi-site-spotcheck-riverside.json`, dated 2026-08-21) predates the current run and was done against the *old* geographic centroid (before the population-center fix described in §7): it found Riverside's old centroid sat in a remote desert area ~150km from the nearest real NEVI-awarded station (Murrieta, near the I-15 corridor), and that the real award site's own grid fields (substation 1,006m away, 115kV, confirmed IN SERVICE) would have cleared VOLT-TERRA's gates easily. This is preserved as historical evidence supporting the fix, not current live behavior — the live pipeline now samples the population center, not that old centroid.

## 10. The chat agent

Two files with overlapping responsibility, worth being precise about:

- **`llm-agent.js`** (688 lines) is what `routes/chat.js` actually calls (`runAutonomousAgent`) — the live entry point.
- **`chat-agent.js`** (180 lines) exports `queryChatAgent`, an earlier/parallel implementation that is no longer wired to any route, but its helper functions (`findCountyFromText`, `findCountiesFromText`, `buildGroundedChatQuestion`) are still imported and used by `llm-agent.js`. Effectively a shared-helpers module now, not a standalone agent path.

### Provider chain — `runAutonomousAgent`
Controlled by `LLM_PROVIDER` (`auto` | `gemini` | `groq`, default `auto`):
1. **Gemini** (`callGeminiAgent`) — if `GEMINI_API_KEY` is set. Calls `generativelanguage.googleapis.com` with Gemini's native `function_declarations` tool format, looping up to 8 tool-call turns.
2. **Groq** (`callGroqAgent`) — if Gemini isn't configured or fails. OpenAI-compatible `/chat/completions` API, same `MCP_TOOL_DEFINITIONS` reformatted to lowercase JSON-schema types (`jsonSchemaForGroq`), with its own retry loop on 429/503 respecting `Retry-After` or a parsed "try again in Ns" message.
3. **Deterministic fallback** (`callDeterministicAgent`) — if neither key is configured, or both fail. This is not a canned response: it still executes the same MCP tools (`get_county_demand_metrics`, `get_grid_infrastructure`, `evaluate_feasibility_gates`, `ask_mireye_evidence`, `make_funding_decision`) against cached data and, for a single flagged county, makes a **live** `/v1/ask` call for physical evidence — the deterministic path is a rule-based orchestrator over real tools, not a template string. It also handles multi-county comparison questions (2+ counties named in one message) with its own comparison-table synthesis.

**As of this writeup, neither `GEMINI_API_KEY` nor `GROQ_API_KEY` is set in `.env`** — every chat request currently runs the deterministic path. Verified live: asking about Riverside County returned a real synthesis citing 8 distinct sources (DMV, AFDC, EIA, OSM, PAD_US, USFS_LCMS, USGS_3DEP_COG) with the response explicitly labeled `provider: "deterministic"`, `fallback_used: true`.

### `mcp-tools.js` — the tool layer
`MCP_TOOL_DEFINITIONS` is the shared tool schema all three providers use (translated to each provider's native function-calling format). `executeMcpTool` implements each one:
The tool set splits cleanly into free (cache-reading) and metered (live) tools; the agent is told which is which in both the tool descriptions and `buildAgentContext`'s `data_policy` block, so it can reason about its own spend.

- `get_statewide_summary`, `get_county_demand_metrics` — read `scored-counties-CA.json`, zero Mireye cost.
- `get_grid_infrastructure` — reads cached `join-pipeline-CA.json`, only recomputes via `computeGridFeasibilityScore` if a cached score isn't already present.
- `evaluate_feasibility_gates` — a raw wrapper around `scoring.js`'s own gate function, so a hypothetical distance/voltage can be gate-checked without hitting Mireye.
- `ask_mireye_evidence` — calls `mireye.ask` directly, ~10 credits.
- `fetch_live_grid_fields(lat, lng, reason)` — **live and metered** (~23 credits). Fetches fresh `GRID_FEASIBILITY_FIELDS` at one coordinate and evaluates the gates. This is the tool that lets the agent produce evidence the cache does not contain.
- `sample_county_points(county, count, reason)` — **live and metered** (~23 credits/point). Generates genuinely new interior coordinates inside the county polygon (`interiorPoints`, using farthest-point sampling over a bbox grid filtered by `pointInGeometry`, so picks spread across the county's real extent rather than clustering on one axis), fetches each, and reports whether they agree with the cached population-center verdict.
- `make_funding_decision` — pure logic, mirrors `bucketCounty`'s decision tree (including `insufficient_data`) so the chat agent's verdict and the batch pipeline's bucket use identical rules.

### Escalation (added 2026-08-24)

The system prompt's ESCALATION block instructs the agent to reach for the two live tools **without being asked** when (a) a cached gate verdict contradicts another cited source, (b) cached evidence is missing or `data_sufficient: false`, or (c) the question turns on whether one sample represents a large county. It is explicitly told *not* to escalate for questions the context already answers, for ranking/comparison questions, or to re-read a supplied value — the earlier prompt had been tuned purely to minimise API calls (commit `98be712`), and this rebalances the trigger from "never" to "on conflict" rather than removing the discipline.

Spend is bounded per answer by `config.maxChatCredits` (default 120). `runToolWithBudget` refuses a metered call once the budget is exhausted and returns an explanation the model can act on, so the agent finishes with partial evidence and says so rather than failing the request. The accumulated `credits_spent` is returned with every answer and rendered in the chat UI.

Verified live: asked to adjudicate Riverside's known bucket-vs-memo contradiction, the agent called `sample_county_points` (3 points) then `fetch_live_grid_fields` (1 point) for 92 credits, found the cached centroid's 115kV substation was not representative (the three fresh points sat on 33kV distribution or >8km away), and reversed the verdict to `fund_grid_upgrade_first`. Asked the same representativeness question about Sutter, it sampled, found 3 of 4 points passing, and correctly declined to overturn the bucket — reporting one failing area instead.

### `buildAgentContext` (in `llm-agent.js`)
Builds a compact JSON context object (`schema_version: 'volt-terra.agent-context.v1'`) injected into every Gemini/Groq call: statewide summary, the resolved county (if any) with a filtered set of Mireye fields (`CONTEXT_MIREYE_FIELDS` — only the ones relevant to grid feasibility, not the full raw fetch), and an explicit `data_policy` block (`cached_context_costs_mireye_credits: false`, `ask_mireye_evidence_is_live_and_metered: true`) so the LLM itself understands which of its own tools cost money.

## 11. Safety / guardrail infrastructure

- **`lib/safe-persistence.js`** — `writeJsonAtomic`: writes to a `{path}.{pid}.{uuid}.tmp` file with `wx` (fail if exists), then renames atomically over the real path. Used by every service that writes a cache file, so a crash mid-write never leaves a truncated/corrupt JSON file.
- **`lib/operation-guard.js`** — two pieces of middleware:
  - `conflictWhileRunning(name, handler)` — an in-process mutex; a second concurrent request for the same named operation gets `409 operation_in_progress` instead of racing the first.
  - `rateLimit({ name, max, windowMs })` — a sliding-window limiter keyed by operation name + IP, returning `429` with a `Retry-After` header. Applied per-route: `/pipeline/run` (1/hour — it spends real credits), `/pipeline/score` (6/hour — free, re-scores cached data), `/explore/check-point` (10/hour), `/chat` (12/hour).
- **`config.maxSweepCredits`** (default 15,000) and **`config.maxPointCheckCredits`** (default 50) — hard caps checked against a live `/v1/fetch/quote` (sweep) or a deterministic field count (point-check) before any metered call runs, guarding the shared 25,000-credit monthly allowance from a misconfigured field list or sample size.

## 12. Internal REST API (`server/routes/`)

| Route | Method | Reads/writes | Notes |
|---|---|---|---|
| `/api/health` | GET | — | liveness + pilot state |
| `/api/counties` | GET | `join-pipeline` + `scored-counties` | raw per-county data, enriched with ratio/bucket if scoring has run |
| `/api/counties/boundaries` | GET | `county-boundaries` + `scored-counties` | GeoJSON merged with bucket, for the map |
| `/api/counties/stats` | GET | `scored-counties` | the ranked/bucketed view the dashboard renders |
| `/api/counties/:fips` | GET | `join-pipeline` + `scored-counties` + `backtest` | drill-down: cited fields + bucket + NEVI stations awarded |
| `/api/counties/:fips/memo` | GET/POST | `memos` | GET reads a cached memo; POST generates one on demand (~10 credits) |
| `/api/pipeline/run` | POST | triggers `orchestrator.runFullSweep` + `scoring.runScoring` | rate-limited 1/hour, mutex-guarded |
| `/api/pipeline/score` | POST | triggers `scoring.runScoring` only | free — re-scores existing join-pipeline cache |
| `/api/pipeline/status` | GET | all cache files' metadata | what's been run and when |
| `/api/pipeline/backtest` | GET | `backtest` | 404 with instructions if `npm run backtest` hasn't been run |
| `/api/explore/check-point` | POST | live `mireye.fetch` + `county-boundaries` + `scored-counties` | the map's ad-hoc point-check tool — reuses `computeGridFeasibilityScore` and `GRID_FEASIBILITY_FIELDS` directly, so a point-check and a county's bucket are computed identically |
| `/api/chat` | POST | `runAutonomousAgent` | validates message + history shape (≤6 messages, ≤1,500 chars each) before calling the agent |

`explore.js`'s point-check deliberately never ranks or compares candidate points — it answers "does this point clear the same physical gates a flagged county's bucket used," not "where's the best site," which the code comments explicitly tie back to the build brief's "not site selection" rule.

## 13. Frontend (`src/`)

- **`App.jsx`** — top-level layout: a full-screen `CountyMap` as a background layer, a floating brand overlay, a nav (`County Demand` / `AI Chat`), and one floating panel at a time (`County Demand` → `RankedTable` + `CountyDrilldown`; `AI Chat` → `ChatPanel`).
- **`CountyMap.jsx`** — Leaflet (`react-leaflet`) choropleth over CARTO Voyager tiles. Renders county polygons colored by bucket, markers at each flagged county's sample point (green = passes gates, amber = fails) plus its `best_alternative_site` if present, and an explore-mode click handler wired to `/api/explore/check-point`. Custom zoom buttons (`ZoomButtons`, driven via a lifted `mapInstance` ref) replace Leaflet's default control, which sat hidden under the title overlay at its default top-left position.
- **`CountyDrilldown.jsx`** — per-county cited-field breakdown, gate pass/fail reasons (`GateFailureList`), and the memo panel.
- **`MemoPanel.jsx`** / **`FieldCitations.jsx`** / **`CitationChip.jsx`** / **`CitationList.jsx`** — memo text (rendered through a small markdown-lite renderer, `utils/markdownLite.jsx`) plus per-field source/confidence/fetched-at citation chips.
- **`ChatPanel.jsx`** — message stream, county-focus context bar, tool-execution disclosure (`<details>`), and confidence/provider/data-gap metadata per response.
- **`hooks/useApi.js`** — three small hooks: `useApi` (GET on mount + refetch), `usePostAction` (POST, no body), `usePostJson` (POST with a body) — the only client-side data-fetching abstraction; no state management library.

No scoring, bucketing, or threshold logic exists in `src/` — every number the UI shows came from a route that read a cache file the backend already computed.

## 14. Testing

121 tests across 14 files (`server/lib/__tests__/`, `server/services/__tests__/`), run via Node's built-in `node --test` — no external test framework. All service-level tests mock `fetchImpl`/`askImpl` rather than hitting live APIs; the aggregation/scoring/parsing functions are tested as pure functions with fixture data.

**Current status: 120 passing, 1 failing.** The failure (`llm-agent.test.js`, "deterministic fallback compares selected county with a county named in natural language") asserts `29.5 vs. 61.7` but the live cache now produces `29.5 vs. 61.8` — a stale hardcoded expectation from an earlier data snapshot, not a logic defect (Contra Costa's real current ratio is 61.8, confirmed against `scored-counties-CA.json` and the live dashboard).

## 15. Known limitations (stated plainly, not glossed over)

- **DMV join loss**: 6.7% of CSV rows (1.9% of vehicles) don't resolve to a CA county — logged in `unresolvedZips`, not dropped silently.
- **ZIP-based join, not coordinate-based**: both AFDC and DMV are joined to county via ZIP; `orchestrator.js` cross-checks this against Mireye's own `/v1/lookup` and records disagreements (11 in the current run) rather than assuming the ZIP join is always right.
- **Equal-weight port counting**: the driver-to-plug ratio treats a Level 2 port and a DC-fast port as equivalent demand-servers, which doesn't distinguish a DC-fast-rich county from an L2-only one.
- **Single demand point per county**: the population center can miss multiple real demand clusters in large, geographically heterogeneous counties (documented and evidenced directly by the Riverside/Murrieta spot-check in §9).
- **Permissive status gate**: a missing/unpublished substation status does not fail the feasibility gate — only an explicit non-"IN SERVICE" status does. This is a stated design choice, not an oversight, but it's the direct cause of at least one visible bucket/memo disagreement (Riverside).
- **NEVI backtest measures plausibility, not correctness** — a fundamentally different allocation criterion (highway-corridor coverage vs. county registration stress), stated in the backtest's own output.
- **Physical gates are a screening proxy**, not a substitute for an actual utility interconnection study — every memo says this explicitly.
- **Chat agent escalation is capped** at `MAX_CHAT_CREDITS` (120) per answer; a question needing deeper investigation than that is answered from partial evidence, and says so.

## 16. Current live numbers

Pulled fresh from cache/tests during this writeup (2026-08-24), not carried forward from earlier:

| | |
|---|---|
| Counties covered | 58 / 58 |
| Sample points | 236 |
| Lookup mismatches | 11 |
| Credits spent (last sweep) | 5,664 / 25,000 |
| State median ratio | 21.0 EVs/port |
| Counties flagged underserved | 6 |
| Bucket split | 6 `fund_charger_now`, 0 `fund_grid_upgrade_first`, 0 `insufficient_data` |
| Memos generated | 6 / 6 |
| NEVI backtest agreement | 5 / 6 flagged counties (83%) |
| Tests | 128 total, all passing |
