# VOLT-TERRA

**County charging-gap & grid-feasibility agentic orchestrator**, built on the [Mireye API](https://www.mireye.com) for the Mireye × Delhi University build challenge.

VOLT-TERRA answers one question: *which California counties have EV registrations outrunning their public charging infrastructure, and for the ones that do, is the fix "build a charger" or "upgrade the grid first"?*

It's an agent, not a dashboard: it pulls EV registration data (state DMV) and existing charger locations (DOE), joins them against cited physical grid data from Mireye (substation distance, voltage, interconnection capacity), computes a peer-relative demand signal, runs that signal through a physical feasibility screen, and sorts every flagged county into a funding or data-review outcome — with a plain-English, cited justification memo generated per county via Mireye's `/v1/ask`. Every decision traces back to the exact fields and sources that drove it.

By the numbers (live California pilot, one full statewide run): **58/58 counties analyzed, 6 flagged as underserved, 123 automated tests passing, cross-checked against 114 real state EV-infrastructure funding records.** See [`docs/write-up.md`](docs/write-up.md) for the full day-by-day build narrative, including every bug found and fixed against live data.

## What it does

- **Ranks and flags counties.** Computes registered-EVs-per-charging-port for every county, and flags the ones running at 2× (or more) the state median — a peer-relative threshold, not an arbitrary cutoff.
- **Screens grid feasibility.** For each flagged county, checks whether a real substation sits close enough and at high enough voltage to support a new DC fast charger. Missing evidence becomes `insufficient_data`; it is never treated as proof that an upgrade is required.
- **Writes the justification memo.** Calls Mireye's `/v1/ask` to generate a cited, plain-English memo per flagged county — ready to attach to a funding request.
- **Backtests itself against reality.** Cross-checks its own flags against real federal NEVI charging-infrastructure award data for California, and reports plainly where the two signals agree and where they don't.
- **Interactive map.** A county-level choropleth (colored by funding bucket) plus an opt-in tool to check live grid feasibility — with full citations — at any point on the map.
- **Shows its work.** Every number in the dashboard traces back to a Mireye field, a source URL, and a confidence rating. Nothing is a black box.

## Requirements

- **Node.js ≥ 20**
- A [Mireye API key](https://www.mireye.com) (free tier works for light use; the Build plan is what this project was developed against — 25,000 credits/month)
- A long, random `OPERATION_API_KEY`, separate from the Mireye key, for protected POST actions
- macOS/Linux shell with `unzip` available (used to unpack two Census data downloads on first ingest — present by default on macOS and most Linux distros)

## Setup

```bash
npm install
cp .env.example .env   # then fill in MIREYE_API_KEY and OPERATION_API_KEY
```

`.env.example` documents every variable. Both `MIREYE_API_KEY` and `OPERATION_API_KEY` must be configured for live operations.

The chat agent supports Gemini or Groq. Set one provider and its server-side key:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

Use `LLM_PROVIDER=gemini` for Gemini, or `auto` to try Gemini, then Groq, before the deterministic fallback. Never expose either key through a `VITE_` variable.

Chat requests carry recent conversation history plus structured state/county context containing demand metrics, the current bucket, grid feasibility, and cited Mireye fields. The model autonomously chooses cached county/state tools and only calls the metered live Mireye evidence tool when deeper live physical evidence is explicitly requested.

```bash
npm run dev             # backend on :3000, frontend on :5173 (proxies /api to :3000)
```

That's enough to browse the dashboard against the data already committed in the repo (`server/data/`, `server/data/cache/`). To regenerate everything from scratch against the live Mireye API, run the pipeline in order:

```bash
npm test                        # unit tests, no network calls

# one-time reference data (re-run only if you switch pilot state)
npm run ingest:afdc             # DOE charger locations for PILOT_STATE
npm run ingest:registrations    # state DMV EV registrations for PILOT_STATE
npm run ingest:centroids        # Census population-weighted county centers
npm run ingest:boundaries       # Census county polygon boundaries, for the map

npm run verify:setup            # confirm Mireye auth + pilot-state data coverage
npm run pipeline:run            # run the full join pipeline sweep against live Mireye data
npm run pipeline:score          # score + bucket counties from the cached sweep (no credits spent)
npm run pipeline:memos          # generate /v1/ask justification memos for flagged counties
npm run backtest                 # cross-check flags/buckets against real CA NEVI award data
```

`pipeline:run` and `pipeline:memos` spend real Mireye credits (a full CA sweep runs ~5,700 credits; each memo ~10). Everything else is free or reads from the local cache.

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

Credit-spending and cache-mutating HTTP operations require `X-Operation-Key`, are rate-limited, and are mutually exclusive. The dashboard asks for the operator key once per browser session and never embeds it in the client bundle. The Mireye key remains server-side and must never be exposed through Vite client variables.

## Data sources

- **DOE Alternative Fuels Data Center** — existing public charger locations and port counts.
- **California DMV "Vehicle Fuel Type Count by Zip Code"** — EV registrations, 3 years back.
- **US Census Bureau** — ZIP-to-county crosswalk, 2020 mean centers of population by county, and county boundary polygons (three separate Census products).
- **California NEVI award data** (CEC/Caltrans) — real federal EV-infrastructure funding records, used only to backtest VOLT-TERRA's own flags against a real-world outcome.

Full source URLs, vintages, and known error rates for each are in [`docs/write-up.md`](docs/write-up.md).

## Known limitations

Named plainly rather than glossed over — full detail and reasoning in [`docs/write-up.md`](docs/write-up.md):

- A small percentage of registration/charger records don't resolve to a county (ZIP-matching limits in the source data), logged rather than silently dropped.
- The demand ratio treats Level 2 and DC-fast ports equally, which doesn't distinguish a DC-fast-rich county from an L2-only one.
- A single county population center is stronger than a geographic centroid or charger-location mean, but it can still hide multiple demand clusters in large, heterogeneous counties.
- The grid-feasibility backtest against NEVI award data measures plausibility, not correctness — NEVI and VOLT-TERRA's underlying signals answer genuinely different questions (highway-corridor coverage vs. county-level demand).
- The map's point-check tool is a physical-screen readout, not a site-selection or ranking tool — it never compares or ranks candidate points.

## Status

Days 1–13 of the program's 14-day build plan are complete and run against live data, plus an added interactive map. Day 14 (demo recording) remains. Full day-by-day detail: [`docs/write-up.md`](docs/write-up.md).
