# VOLT-TERRA

County charging-gap and grid-feasibility agentic orchestrator, built on the Mireye API for the Mireye × Delhi University build challenge.

Two products over one geospatial engine:

- **EV Facility** — for planners and funders. Ranks a state's counties by charging shortfall, then decides per county whether the fix is *fund a charger now* or *fund a grid upgrade first*, with cited evidence.
- **EV Rider** — for drivers. Answers "could I realistically own an EV at this address?" using live charging-station data and real road routing.

See [docs/volt-terra-spec.pdf](docs/volt-terra-spec.pdf) for the original spec and [docs/build-brief.md](docs/build-brief.md) for the program rules.

---

## Quick start

```bash
npm install
```

`.env` needs `MIREYE_API_KEY`. Everything else in [.env.example](.env.example) has a working default. Optional but recommended: `NREL_API_KEY` (a free key from developer.nlr.gov/signup — `DEMO_KEY` rate-limits hard on a full state pull) and `GROQ_API_KEY` for the chat agent.

```bash
npm run dev     # backend :3000, frontend :5173
npm test        # 135 tests, no network calls
```

Pick a role and an input mode on the landing page, choose a state, and run a sweep.

---

## How it works

### The live sweep (EV Facility)

Selecting a state runs the whole analysis **on demand against Mireye**. Nothing is precomputed — the result is held in memory only and deliberately never written to disk, so it cannot quietly become a cache.

1. **Charging supply** — live DOE AFDC pull for the state. Stations join to counties by AFDC's own county field, falling back to a Census ZIP→county crosswalk.
2. **Demand** — live EV registrations where a state publishes them (see below), otherwise Census county population. The response always states which was used.
3. **Grid + physical evidence** — one Mireye `/v1/fetch/batch` per county at its Census population-weighted center, pulling **31 cited fields** (see [`LIVE_SWEEP_FIELDS`](server/services/live-sweep.js)).
4. **Score and bucket** — ratio, peer-relative flag, then three physical gates.

Cost is deterministic: **31 credits × county count**. Nevada 527, Arizona 465, California ~1,800, Texas ~7,900.

### The demand signal

`demand_metric` in every sweep response is one of:

- `ev_registrations_per_public_port` — where a live county-level registration source exists ([`live-registrations.js`](server/services/live-registrations.js)).
- `people_per_public_port` — Census county population per port, everywhere else.

This exists because **there is no national county-level EV registration feed.** Atlas EV Hub covers only some states and DOE publishes registrations at state level only. Rather than pretend otherwise, the population proxy is used and labelled as such — a population figure is never presented as a registration count.

### Flagging and bucketing

A county is flagged **underserved** if any of:

- its ratio is at or above **1.5× the state median**, or
- it sits in the **worst quartile** of that state's own distribution, or
- it has **zero public ports**.

The quartile clause matters: the ratio distribution is long-tailed, so a pure multiple-of-median cutoff flagged only one or two counties in most states and left the ranked view empty. The quartile keeps the threshold peer-relative — what the build brief asks for — while guaranteeing a usable shortlist anywhere.

Each flagged county is then bucketed by **three hard physical gates** evaluated on live Mireye data:

| Gate | Threshold |
|---|---|
| A substation exists and is in service | published status, if any, must be `IN SERVICE` |
| Close enough | ≤ 8,000 m (~5 mi) |
| Strong enough | ≥ 60 kV |

Pass all three → `fund_charger_now`. Fail one → `fund_grid_upgrade_first`.

There is **no third "needs review" bucket.** When grid evidence is missing entirely, the county resolves to `fund_grid_upgrade_first` with `grid_evidence_incomplete: true` — if the substation reading cannot be verified you cannot certify the county as shovel-ready, and the conservative call is the one a funder can act on. The flag records that the verdict rests on absent evidence rather than a measured failure.

Thresholds trace to Mireye's own field documentation, not to fitted weights: 8 km sits well under the ">10-20 km often kills a site" guidance for interconnection cost, and 60 kV is the conventional line between local distribution and sub-transmission capable of serving real load.

### EV Rider

Answers a single-address question, and leans on Mireye for everything except station locations:

- **DOE AFDC** — where the public stations are. Mireye has no EV charging layer (checked across all 366 catalog fields), so this cannot come from Mireye.
- **Mireye `/v1/proximity` (`op: distance`, driving)** — real road routing to each candidate station. Results rank by **drive time**, not straight-line distance, because a station across a river or a freeway with no exit is not actually near you.
- **Mireye `/v1/fetch`** — conditions at the point itself: road class and distance, electricity price, utility, housing density, terrain.

Verdicts are `easy` / `workable` / `hard`, with the specific reasons listed. County congestion is folded in where known: plenty of plugs that are always occupied is not the same as plenty of plugs.

Private and fleet-only stations are excluded — a driver cannot plug into them.

### The agentic chat

A tool-calling agent (Groq, with Gemini supported and a deterministic fallback) that can **decide on its own to go gather evidence**. Ten MCP-style tools; the metered ones state their credit cost in their own description so the model can reason about spend:

| Tool | Cost |
|---|---|
| `get_statewide_summary`, `get_county_demand_metrics`, `get_grid_infrastructure`, `evaluate_feasibility_gates`, `make_funding_decision` | free (cache/pure logic) |
| `fetch_live_grid_fields` | ~31 credits |
| `sample_county_points` | ~31 credits per point |
| `find_nearest_substations` | ~2 credits straightline, ~300 driving |
| `get_labor_shed` | free exact quote; ~1,200+ only on explicit `confirm` |
| `ask_mireye_evidence` | ~10 credits |

The system prompt escalates on **evidence conflict**, not on every question: a cached gate verdict contradicting a memo, missing evidence, or a question that turns on whether one sample represents a large county. Spend per answer is capped by `MAX_CHAT_CREDITS`, and the credits used are shown in the UI.

`get_labor_shed` is quote-first by design — it returns a free exact price and only runs when explicitly confirmed, mirroring the brief's "quote before you fetch" discipline.

---

## Mireye endpoints used

Verified against the live OpenAPI spec at `api.mireye.com/v1/openapi.json`. Auth is `Authorization: Bearer $MIREYE_API_KEY` — confirmed against the live API, since the spec declares no security scheme.

| Endpoint | Used for |
|---|---|
| `GET /v1/meta/fields` | Field and preset catalog (free, no key) |
| `POST /v1/fetch/quote` | Prices every sweep before it runs — free and unmetered |
| `POST /v1/fetch` | Single-point field pull (point checks, rider physical context) |
| `POST /v1/fetch/batch` | The sweep itself: ≤25 locations per call |
| `POST /v1/proximity` | Road routing (`distance`), nearest substations (`nearest`), reachable population (`labor_shed`) |
| `POST /v1/lookup` | Canonical join keys. `include_parcel` stays false — parcel data is 300 credits/location and out of scope |
| `POST /v1/ask` | Cited justification memos |
| `POST /v1/geocode` | Implemented, unused — every sample point already has a coordinate |

All of it lives in [server/services/mireye.js](server/services/mireye.js), with a 60 req/min limiter, 25-location batch chunking, per-request timeouts, and retry-with-backoff on 429/502/503/504 **and** transport-level failures.

---

## API

| Route | Purpose |
|---|---|
| `POST /api/live/sweep/:state` | Run the live sweep. Spends credits. |
| `GET /api/live/quote/:state` | Price a sweep without running it. |
| `GET /api/live/result/:state` | Last in-memory result, if any. |
| `POST /api/explore/check-point` | Grid-feasibility check at one coordinate. |
| `POST /api/rider/check-point` | Rider feasibility: stations, routing, physical context. |
| `POST /api/chat` | The agent. |
| `GET /api/counties/boundaries/:state`, `/state-outline/:state` | Map geometry. |
| `GET /api/counties/stats`, `/:fips`, `/:fips/memo` | California pipeline output. |
| `POST /api/pipeline/run`, `/score` | The original CA-only pipeline. |

---

## California pipeline (original)

California predates the live sweep and keeps its own richer pipeline, driven by real CA DMV EV registrations rather than a population proxy, with corridor sampling and NEVI backtesting:

```bash
npm run verify:setup       # confirm auth, presets, county coverage
npm run pipeline:run       # ingest + sample + Mireye grid fetch
npm run pipeline:score     # score and bucket (free, no credits)
npm run pipeline:memos     # /v1/ask memos for flagged counties
npm run backtest           # cross-check against real NEVI awards
```

---

## Data sources

- **DOE Alternative Fuels Data Center** — charger locations. Note NREL's `developer.nrel.gov` retired in May 2026; the API is now at `developer.nlr.gov`.
- **US Census** — 2020 county population-weighted centers (3,221 counties), ZCTA→county crosswalk, cartographic boundaries. Optional live ACS population via `CENSUS_API_KEY`.
- **State DMV / open data** — EV registrations where published. California's is the fullest.
- **CA NEVI awards (CEC/Caltrans ArcGIS)** — backtest ground truth only.
- **Mireye** — all cited physical, grid, economic and routing fields.

---

## Known limits

- **No national EV registration data.** Most states fall back to population per port. Stated in every response; never relabelled as registrations.
- **One sample point per county.** A single population center is a coarse proxy for a large, varied county — this is exactly why the chat agent can escalate and sample more points.
- **Level 2 and DC-fast ports are weighted equally** in the ratio. A DC-fast-rich county and an L2-only one look the same.
- **The gates are a physical screen, not an interconnection study.** Every memo says so.
- **A missing substation status does not fail the status gate** — only an explicitly non-in-service one does. That is a deliberate, stated choice, and it is why a county can pass gates while its own `/v1/ask` memo is more cautious.
- **The NEVI backtest measures plausibility, not correctness.** NEVI funds highway-corridor coverage gaps, not county demand stress — a genuinely different criterion.
- **Live sweep results are not persisted.** Restarting the server loses them, by design.

---

## Tests

```bash
npm test
```

135 tests across 16 files, using Node's built-in runner. All service tests inject `fetchImpl` / `askImpl` / `proximityImpl`, so the suite makes no network calls and spends no credits.
