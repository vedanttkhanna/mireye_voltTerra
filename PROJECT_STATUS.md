# VOLT-TERRA — Current State

*Snapshot as of 2026-08-24. Not a build narrative — see [docs/write-up.md](docs/write-up.md) for that. This is what's actually true right now, verified against the live cache and a live test run, not carried forward from earlier notes.*

## Status: Days 1-13 built and running on live data. Day 14 (demo) not started.

Every stage of the pipeline exists, is wired end to end, and has been run against real data — not a mock:

1. **Ingest** — DOE AFDC charger locations + CA DMV EV registrations (3 years), joined to county via a Census ZCTA crosswalk
2. **Join pipeline** — each county sampled at its Census population center + up to 3 corridor points (existing charger locations), cross-checked via Mireye `/v1/lookup`, grid data pulled via `/v1/fetch/batch`
3. **Scoring** — driver-to-plug ratio, peer-relative underserved threshold, 3-gate grid-feasibility check (substation in-service, ≤8km, ≥60kV)
4. **Memos** — cited justification memos via Mireye `/v1/ask`, one per flagged county
5. **Backtest** — cross-checked against real CA NEVI federal funding award data
6. **Dashboard** — Leaflet county choropleth, ranked table, drill-down with citations, memo panel, point-check tool
7. **Chat agent** — tool-calling LLM agent (Gemini/Groq) with a deterministic fallback when no LLM key is configured

## Live numbers (current cache, not re-derived from memory)

| | |
|---|---|
| Join pipeline last run | 2026-08-22, 04:25 UTC |
| Scoring last run | 2026-08-22, 04:27 UTC |
| Counties covered | 58 / 58 |
| Sample points | 236 |
| Lookup mismatches | 11 (AFDC/DMV ZIP-join vs. Mireye's own coordinate resolution disagreeing) |
| Mireye credits spent (join sweep) | 5,664 |
| Mireye credits remaining | 8,289 / 25,000 (resets Sept 1) |
| State median ratio | 21.0 EVs/port |
| Counties flagged underserved | 6 |
| Bucket split | **6 `fund_charger_now`, 0 `fund_grid_upgrade_first`, 0 `insufficient_data`** |
| Memos generated | 6 / 6 flagged counties |
| NEVI backtest agreement | 5 / 6 flagged counties (83%) — Yuba is the one miss |
| Tests | 128 total, all passing |

**Note on the bucket split:** `docs/write-up.md` currently states "5 `fund_charger_now`, 1 `fund_grid_upgrade_first`." That's stale — the live cache says 6/0. Worth regenerating the write-up against the current run before submission, since the build brief explicitly penalizes stale/overclaimed numbers.

## Known issues found during review

- **11 lookup mismatches** in the last join-pipeline run — cases where the AFDC/DMV ZIP-based county join disagreed with Mireye's own `/v1/lookup` coordinate resolution. Logged, not silently resolved either way.

## Live escalation in the chat agent (added 2026-08-24)

The chat agent now runs on **Groq** (`LLM_PROVIDER=groq`, key in `.env`) and can decide *on its own* to go gather evidence the cache doesn't contain. Two new metered MCP tools:

- **`fetch_live_grid_fields(lat, lng, reason)`** — fresh cited grid fields at one exact coordinate, ~23 credits.
- **`sample_county_points(county, count, reason)`** — fetches several genuinely new interior points across a county (farthest-point sampled inside the real polygon) to test whether its single cached population-center sample is representative. ~23 credits per point.

The system prompt now escalates on **evidence conflict**, not on every question: a cached gate verdict contradicting a memo, `data_sufficient: false`, or a question that turns on whether one sample represents a large county. Each answer is capped by `MAX_CHAT_CREDITS` (default 120), and the spend is shown in the UI per answer.

**Verified live on two counties:**
- *Riverside* — cached centroid passes gates, but all 3 fresh points failed (33kV distribution vs. the centroid's lucky 115kV). Agent **reversed the verdict** to `fund_grid_upgrade_first`. 92 credits.
- *Sutter* — 3 of 4 points pass; agent correctly did **not** overreact, reporting "mostly representative, with one failing area." 69 credits.

That contrast matters: it's reasoning from the evidence, not applying a fixed rule.

## Known limitations (already documented, still accurate)

- DMV registrations: 6.7% of CSV rows (1.9% of vehicles) don't resolve to a CA county.
- AFDC/DMV are joined to county via ZIP, not lat/lng — an approximation, occasionally disagrees with Mireye's coordinate-based resolution (see lookup mismatches above).
- The driver-to-plug ratio treats Level 2 and DC-fast ports as equal weight — doesn't distinguish a DC-fast-rich county from an L2-only one.
- A single population-center point can miss multiple demand clusters in large counties.
- The NEVI backtest measures plausibility, not correctness — NEVI funds highway-corridor coverage gaps, not county-level registration stress, a genuinely different criterion.
- Grid-feasibility gates are a physical proximity/voltage screen, not a substitute for an actual utility interconnection study.
- The gate logic treats a *missing* substation status as non-disqualifying (only an explicit "not in service" status fails the gate) — this is why Riverside County passes gates and lands in `fund_charger_now` despite its own `/v1/ask` memo being more cautious about the same unconfirmed status.

## What's left

- **Day 14**: demo recording and final ship — not started.
- Regenerate `docs/write-up.md`'s numbers against the current live run.
