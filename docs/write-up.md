# VOLT-TERRA — Write-up

*County charging-gap & grid-feasibility agentic orchestrator, built on the Mireye API for the Mireye × Delhi University build challenge. Status: Days 1-13 of the 14-day plan complete.*

This document compiles what was actually built against [docs/volt-terra-spec.pdf](volt-terra-spec.pdf) (the original pitch) and [docs/build-brief.md](build-brief.md) (the program rules), day by day, including the real bugs found and fixed along the way. [README.md](../README.md) is the living reference for exact commands and current numbers; this is the narrative version.

## The question

*Which California counties have EV registrations outrunning their public charging infrastructure, and for the ones that do, is the fix "build a charger" or "upgrade the grid first"?*

## The datasets

| Dataset | Role | Source |
|---|---|---|
| Mireye API | Cited grid/utility physical fields (substation distance/voltage/status, transmission lines, interconnection queue) | `api.mireye.com`, Build plan |
| DOE Alternative Fuels Data Center | Existing public charger locations, port counts by type | `developer.nlr.gov` |
| CA DMV "Vehicle Fuel Type Count by ZIP" | EV registrations, 3 years, by ZIP | data.ca.gov |
| Census 2020 ZCTA-county crosswalk | ZIP → county join key | Census Bureau |
| Census 2020 Gazetteer Files | County centroid ("internal point") per county | Census Bureau |
| Census 2020 Centers of Population | Independent county demand-geography proxy | Census Bureau |
| CA NEVI award data (Rounds 1-3) | Real federal EV-infrastructure funding awards, used only for the Day 12 backtest | CEC/Caltrans, ArcGIS Hub |

Two of these (Mireye, AFDC) were in the original spec. DMV registrations and the Census files were always the plan. The NEVI dataset is new — added in Day 12 as backtest ground truth, discovered via live web search, not part of the original pitch.

## Architecture vs. the spec

The spec (PDF page 5) lists the agent loop as: `/v1/geocode` → `/v1/lookup` → `/v1/fetch` → `/v1/ask`, plus `GET /v1/meta/fields` and `POST /v1/field-requests`. What's actually implemented:

- **`/v1/geocode` — not used.** Every sample point in this pipeline already has a coordinate (a county's Census centroid, or an existing charger's own lat/lng) — there's no address string anywhere in the loop to resolve. This is a deliberate, documented deviation, not an oversight.
- **`/v1/lookup`, `/v1/fetch` (batched), `/v1/ask`, `GET /v1/meta/fields` — used as specified**, plus discovered along the way that `include_parcel: true` on `/v1/lookup` bills 300 credits instead of 1 (fixed before it was ever used for real).
- **`/v1/field-requests` — not used.** Never needed; nothing required was missing from the catalog.

The rest of the architecture (join pipeline → scoring → memo generation → dashboard) matches the spec's shape closely. Where it doesn't, it's called out below.

## Day-by-day: plan vs. build

The spec's 14-day plan (PDF page 6) is not reproduced in the README — only here and in project memory.

**Days 1-2 — Data ingest.** Pulled DOE AFDC charger locations and 3 years of CA DMV EV registrations, joined to county via ZIP through a Census ZCTA crosswalk. Matches the plan exactly. Named blind spot from the start: 6.7% of DMV rows and AFDC's ZIP-based (not lat/lng-based) county join both carry real, quantified error rates — not swept under the rug.

**Days 3-4 — Auth + pilot setup.** Verified `MIREYE_API_KEY` against the live API (not just trusting `.env`), confirmed `grid_interconnect`/`utilities` presets exist, confirmed county-level DMV coverage for all 58 CA counties. `npm run verify:setup` — a real script, not a manual check, so it can be re-run any time confidence is needed.

**Days 5-7 — Join pipeline.** Per the spec: sample each county, resolve join keys, quote cost, pull grid data. Built as `server/services/orchestrator.js`. Current county sampling uses the Census mean center of population plus up to 3 informational "corridor" points; the Gazetteer internal point is only a fallback. Every sample point is cross-checked against `/v1/lookup`'s own county resolution. A curated field subset is quoted and fetched under a safety budget that now includes lookup credits and runs before any metered call.

*Mid-build correction (surfaced in Days 10-11, folded back in here):* while generating a memo, `/v1/ask` cited an OpenStreetMap-sourced substation field VOLT-TERRA's own fetch never requested — Mireye's catalog had grown from 310 to 325 fields since Days 5-7. Added the OSM substation fields as a fallback (EIA primary, OSM only when EIA has nothing) and re-ran. A live vendor catalog isn't a fixed target; this project doesn't currently automate re-diffing against it.

**Days 8-9 — Signal logic.** Two independent things get computed:

1. *Driver-to-plug ratio* — `latest_registrations / (Level 2 + DC fast ports)`. Level 1 ports excluded (under 1% of the public network statewide, not a real fast-charging resource). A county is flagged "underserved" once its ratio clears 2x the state median — the peer-relative threshold the build brief explicitly asks for, not an arbitrary cutoff.
2. *Grid feasibility* — three hard gates evaluated at a representative point: a substation exists and is in service, is within 8km, and is at least 60kV. Both thresholds are derived from Mireye's own field documentation (not fit to the sample), and the design is a decision tree, not a weighted score, per the build brief's explicit preference for justifiable rules over arbitrary weights.

A county that clears all three gates is bucketed `fund_charger_now`; affirmative evidence of a failed distance, voltage, or status gate is `fund_grid_upgrade_first`. Missing distance or voltage evidence is `insufficient_data`, because absence of data is not proof that an upgrade is required.

*Bug found and fixed during this phase:* the first version of the feasibility check picked whichever of a county's sample points scored best — including existing-charger corridor points — which quietly favored any county with even one charger, since chargers tend to already sit near good grid access. Confirmed on real data (Riverside's corridor point papered over its centroid having zero substation data) and fixed by deciding the bucket from the centroid alone, with corridor points demoted to informational context only.

**Days 10-11 — Memo generation + dashboard.** `server/services/memo-generator.js` builds a question grounded in each flagged county's actual numbers and calls `/v1/ask` at the same point scoring.js used — matching the spec's "cited justification memo" requirement. Mireye's answers aren't a rubber stamp: they've pulled additional cited fields we hadn't fetched and, in two cases, explicitly qualified or partially corrected the framing.

The dashboard (Vite + React) follows the spec's "thin, read-only layer" framing precisely: a ranked table with bucket filters, a county drill-down with per-field citations and gate pass/fail reasons, a memo panel with on-demand generation, and a re-run trigger that confirms cost before spending credits. Verified live in an actual browser, not just a clean `vite build` — which caught two real bugs (a layout overflow at common window widths, and memo markdown rendering as literal asterisks) before they'd have shown up in a demo.

**Day 12 — Backtest.** The build brief asks for 10-20 cases against known outcomes. The closest available public ground truth is California's own NEVI (federal EV-infrastructure) award data — 114 real records across three funding rounds, live-queried from the state's own ArcGIS service, not hand-picked. 5 of 6 flagged counties have real NEVI investment. **Important, explicitly-documented caveat**: NEVI funds highway-corridor coverage gaps by federal rule, not county-level registration stress — a genuinely different question than VOLT-TERRA's — so this is a plausibility check, not proof of a correct answer. 33 of 58 counties received NEVI funding without clearing VOLT-TERRA's ratio threshold at all, which is expected under that distinction, not a miss.

A site-level spot-check went further: fetched live grid data at an actual NEVI-awarded station's real coordinates in Murrieta (Riverside County) and found it would clear every VOLT-TERRA gate on its own — evidence for the next finding.

**Days 12-13 — Sparse/edge-case fix, subsequently strengthened.** The original correction used the mean location of existing chargers when a county internal point was badly displaced. That improved large-county geography but still depended on historic charging supply. The current implementation replaces it with the Census mean center of population for every county, independently locating the population demand proxy; existing chargers remain informational context only.

**Post-review operational hardening.** Metered and mutating routes now require a separate operator key and are rate-limited. Pipeline operations cannot overlap, memo updates are serialized, cache replacement is atomic, and the full fetch-plus-lookup estimate is checked before any paid lookup. Counties with EV registrations and zero ports are explicitly flagged, while missing grid evidence routes to `insufficient_data`.

**Post-13 — Interactive map (added on request, not in the original 14-day plan).** The Riverside/San Bernardino/San Francisco centroid finding above led directly to a follow-up ask: an interactive map showing recommended counties and letting an analyst check feasibility at a specific point. This intersects the build brief's explicit "not site selection" rule, so the scope was checked with the user before building rather than assumed — the answer was to build both a county-level choropleth (the primary, default view — real Census county polygons, not points, colored by funding bucket) and an opt-in point-check tool, with the point-check deliberately never ranking or comparing candidate points, only reporting whether a clicked point clears the same physical gates a flagged county's own bucket used, with full citations. Verified in a real, driven browser session (a headless Chrome check, since the interactive browser extension wouldn't connect that session) — which caught a real bug: clicking the confirm button inside a map popup was also bubbling through to the underlying map's own click handler, silently opening a second popup at a different point. Fixed with an explicit `stopPropagation()`.

**Day 14 — Not started.** Demo recording and final ship remain.

## The enrichment, defended

Per the build brief: "a threshold you can justify from the physical world is [an argument]; a weighted score with arbitrary weights is not." VOLT-TERRA's gates are built that way — every numeric threshold traces to either Mireye's own field documentation or a directly observed real-world case, not a guessed round number:

- **8km distance ceiling**: Mireye's own field docs say interconnection cost "scales with feeder distance... >10-20km often kills a site." 8km sits well under that, appropriate for a smaller-budget charger project than the utility-scale generation projects that guidance is calibrated for.
- **60kV voltage floor**: the conventional real-world line between local distribution plant and sub-transmission capable of serving a real load. Only 2 of 192 substations resolved in the live sweep fell below it.
- **Representative point**: the Census mean center of population is independent of existing charging supply; it replaced both a geographic internal point and the former charger-location mean.
- **What's deliberately not a gate**: `interconnection_queue_active_capacity_caiso_mw`, despite being the field the spec's own worked example names — it counts generator interconnection requests, not charger load capacity, a meaningfully different thing. Using it as a hard gate would overclaim precision it doesn't have.

## What's been tested against reality

Per the build brief's point 6 — not a hypothetical checklist, things that actually happened during this build:

- **83% (5/6)** of flagged counties have real, independently-verifiable NEVI infrastructure investment.
- **1 real methodological bug** (corridor-point selection bias) found on live data and fixed before shipping.
- **1 real geocoding/data-source gap** (OSM substation fields) found via a memo disagreeing with our own fetch, fixed, and re-verified.
- **1 real centroid-representativeness bug**, found via direct investigation, fixed with a measured (not guessed) threshold, changing a real bucket outcome (Riverside).
- **1 transient API reliability issue** found, categorized separately rather than conflated with genuine data disagreement.
- A site-level spot-check against a real, independently-sourced NEVI award confirmed the fix was correct, not just internally self-consistent.

## Known limits (the honest list)

- DMV registrations: 6.7% of rows (1.9% of vehicles) don't resolve to a county — logged, not dropped.
- AFDC/DMV are ZIP-joined, not lat/lng-joined — confirmed to occasionally disagree with Mireye's own coordinate-based resolution (5 genuine cases in the latest run).
- The "L2 + DC fast ports, weighted equally" driver-to-plug denominator is a simplification — doesn't distinguish a DC-fast-rich county from an L2-only one.
- The Census county population center is real population data, but it is still a county-level proxy rather than an EV-registration-weighted or site-level demand surface.
- The NEVI backtest measures plausibility, not correctness, for reasons detailed above — this is stated plainly in the README, not glossed over.
- Grid feasibility gates are a physical proximity/voltage screen, not a substitute for an actual utility interconnection study — every generated memo says this explicitly, and in Riverside's case Mireye's own `/v1/ask` was visibly more cautious than VOLT-TERRA's hard-gate pass, which is left in the record rather than hidden.

## Last recorded numbers (pre-hardening California run)

| | |
|---|---|
| Counties covered | 58/58 |
| Sample points | 236 |
| Counties flagged underserved | 6 (median ratio 21.0, threshold 2x) |
| Bucket split | 6 `fund_charger_now`, 0 `fund_grid_upgrade_first` |
| Memos generated | 6/6 flagged counties |
| NEVI backtest | 5/6 flagged counties independently funded |
| Tests | 97 passing in the post-review implementation |
| Mireye credits used | 16,470 / 25,000 (8,530 remaining) |

## What's left

Day 14: demo recording and final ship. Everything else in the 14-day plan is built, tested, and run against live data — not a mock, not a hypothetical.
