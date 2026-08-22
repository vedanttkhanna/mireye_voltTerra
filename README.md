# VOLT-TERRA

**County charging-gap & grid-feasibility agentic orchestrator**, built on the [Mireye API](https://www.mireye.com) for the Mireye × Delhi University build challenge.

VOLT-TERRA answers one question: *which California counties have EV registrations outrunning their public charging infrastructure, and for the ones that do, is the fix "build a charger" or "upgrade the grid first"?*

It's an agent, not a dashboard: it pulls EV registration data (state DMV), existing charger locations (DOE), and independent county population centers (Census), joins them against cited physical grid data from Mireye, computes a peer-relative demand signal, and runs that signal through a physical feasibility screen. Flagged counties become `fund_charger_now`, `fund_grid_upgrade_first`, or `insufficient_data`; missing evidence is never treated as proof that an upgrade is required.

The most recent recorded California run analyzed **58/58 counties, flagged 6 as underserved, and cross-checked against 114 real state EV-infrastructure funding records**. The current implementation has **96 passing automated tests**. Re-run the pipeline after checkout to produce results with the current population-center and insufficient-data methodology.

## What it does

- **Ranks and flags counties.** Computes registered-EVs-per-charging-port and flags counties running at 2× the state median. A county with registered EVs and zero qualifying ports is always flagged rather than silently receiving a null ratio.
- **Screens grid feasibility.** Evaluates cited grid fields at the Census mean center of population, an independent demand-geography proxy. Missing distance or voltage evidence produces `insufficient_data` for human review.
- **Writes the justification memo.** Calls Mireye's `/v1/ask` to generate a cited, plain-English memo per flagged county — ready to attach to a funding request.
- **Backtests itself against reality.** Cross-checks its own flags against real federal NEVI charging-infrastructure award data for California, and reports plainly where the two signals agree and where they don't.
- **Interactive map.** A county-level choropleth (colored by funding bucket) plus an opt-in tool to check live grid feasibility — with full citations — at any point on the map.
- **Shows its work.** Every number in the dashboard traces back to a Mireye field, a source URL, and a confidence rating. Nothing is a black box.

## Requirements

- **Node.js ≥ 20**
- A [Mireye API key](https://www.mireye.com) (free tier works for light use; the Build plan is what this project was developed against — 25,000 credits/month)
- macOS/Linux shell with `unzip` available (used to unpack two Census data downloads on first ingest — present by default on macOS and most Linux distros)

## Setup

```bash
npm install
cp .env.example .env   # then fill in MIREYE_API_KEY
```

The backend binds to `127.0.0.1` by default. Set `HOST` deliberately when placing it behind a reverse proxy or exposing it to another machine. The dashboard does not ask for a separate operator key.

```bash
npm run dev             # backend on :3000, frontend on :5173 (proxies /api to :3000)
```

Reference geography is committed under `server/data/`, but generated pipeline output under `server/data/cache/` is intentionally gitignored. A fresh clone shows setup guidance until the first pipeline run. To generate results:

```bash
npm test                        # unit tests, no network calls

# one-time reference data (re-run only if you switch pilot state)
npm run ingest:afdc             # DOE charger locations for PILOT_STATE
npm run ingest:registrations    # state DMV EV registrations for PILOT_STATE
npm run ingest:centroids        # Census county centroids for PILOT_STATE
npm run ingest:boundaries       # Census county polygon boundaries, for the map
npm run ingest:population-centers # Census county mean centers of population

npm run verify:setup            # confirm Mireye auth + pilot-state data coverage
npm run pipeline:run            # run the full join pipeline sweep against live Mireye data
npm run pipeline:score          # score + bucket counties from the cached sweep (no credits spent)
npm run pipeline:memos          # generate /v1/ask justification memos for flagged counties
npm run backtest                 # cross-check flags/buckets against real CA NEVI award data
```

`pipeline:run`, `pipeline:memos`, and map point checks spend real Mireye credits. Before a sweep performs any paid lookup, it quotes the batch and checks the combined fetch + lookup estimate against both `MAX_SWEEP_CREDITS` and the reported remaining allowance.

## Operational safety

- Metered and mutating requests are rate-limited. Concurrent pipeline operations return `409 Conflict`, and memo persistence is serialized.
- Generated JSON is written to a temporary sibling and atomically renamed, preventing readers from observing partially-written cache files.
- `HOST=127.0.0.1` is the safe default. There is no application-level login, so deployments exposed beyond the local machine should add authentication at the reverse proxy or platform layer. Multi-instance deployments also need shared rate limiting and job coordination.

## Project structure

```
server/
  services/     ingest scripts, the join pipeline, scoring, memo generation, backtest
  routes/       Express API routes
  lib/          shared pure logic (ZIP/geo utilities, county lookups) — unit tested
  data/         reference datasets (Census crosswalks, boundaries) — committed
  data/cache/   pipeline run output — gitignored, regenerated by the scripts above
src/
  components/   React dashboard (ranked table, map, county drill-down, memo panel)
  hooks/        API data-fetching hooks
docs/
  write-up.md          full build narrative — plan vs. build, bugs found, evaluation, limits
  build-brief.md       the challenge's program rules
  volt-terra-spec.pdf  the original project pitch/spec
```

## Pilot state: California

Chosen because it's the demo example in the project's own spec (Madera County), and because California publishes usable county-level EV registration data. See [Data sources](#data-sources).

## Mireye API endpoints in use

| Endpoint | Used for |
|---|---|
| `GET /v1/meta/fields` | Field + preset catalog — confirms the grid fields this project depends on before building the join. |
| `POST /v1/fetch/quote` | Prices a fetch before it runs, per the program's own rule to quote before every real sweep. |
| `POST /v1/fetch` | Single-location field fetch — the map's live point-check tool. |
| `POST /v1/fetch/batch` | Up to 25 locations per call — how a statewide sweep stays under the rate limit. |
| `POST /v1/lookup` | Resolves a coordinate to a canonical county — cross-checks the ZIP-based join against Mireye's own resolution. |
| `POST /v1/ask` | Generates the cited justification memo per flagged county. |
| `POST /v1/geocode`, `POST /v1/field-requests` | Not used — every sample point already has a coordinate, and nothing required was missing from the catalog. See the write-up for the full reasoning. |

Client implementation (rate limiting, batching, retry-with-backoff) lives in [`server/services/mireye.js`](server/services/mireye.js).

## Data sources

- **DOE Alternative Fuels Data Center** — existing public charger locations and port counts.
- **California DMV "Vehicle Fuel Type Count by Zip Code"** — EV registrations, 3 years back.
- **US Census Bureau** — ZIP-to-county crosswalk, county internal-point fallbacks, county mean centers of population, and boundary polygons.
- **California NEVI award data** (CEC/Caltrans) — real federal EV-infrastructure funding records, used only to backtest VOLT-TERRA's own flags against a real-world outcome.

Full source URLs, vintages, and known error rates for each are in [`docs/write-up.md`](docs/write-up.md).

## Known limitations

Named plainly rather than glossed over — full detail and reasoning in [`docs/write-up.md`](docs/write-up.md):

- A small percentage of registration/charger records don't resolve to a county (ZIP-matching limits in the source data), logged rather than silently dropped.
- The demand ratio treats Level 2 and DC-fast ports equally, which doesn't distinguish a DC-fast-rich county from an L2-only one.
- The Census population center is a population-geography proxy, not an EV-registration-weighted site recommendation.
- `insufficient_data` requires an analyst or utility to obtain better substation evidence; it is intentionally not collapsed into either funding verdict.
- The grid-feasibility backtest against NEVI award data measures plausibility, not correctness — NEVI and VOLT-TERRA's underlying signals answer genuinely different questions (highway-corridor coverage vs. county-level demand).
- The map's point-check tool is a physical-screen readout, not a site-selection or ranking tool — it never compares or ranks candidate points.

## Status

Days 1–13 of the program's 14-day build plan are complete and run against live data, plus an added interactive map. Day 14 (demo recording) remains. Full day-by-day detail: [`docs/write-up.md`](docs/write-up.md).
