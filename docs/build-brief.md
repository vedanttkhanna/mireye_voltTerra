# Mireye × Delhi University — Build Brief

*Teams of 2–3 · One account per person · Build plan, 25,000 credits each per month*

**What Mireye is.** An API that answers physical questions about any US coordinate — 300+ cited fields across terrain, land cover, built environment, utilities, climate and hazards. Every value comes back with the source it came from.

## The challenge

Build a **product with an agent at the centre of it**. Something with a surface and a user — not a notebook and a chart, and not a chatbot sitting on top of a table.

Three rules:

- **Research-led and product-led, both.** Start from a question worth answering, then build the thing that answers it for someone who is not you. A good project could be written up *and* shipped.
- **Not site selection.** That is our own product, and it is the obvious answer. Go somewhere else.
- **Fuse it.** Join Mireye with an existing US dataset nobody has combined it with. The interesting work is in the join.

What we are looking for is ***enrichment***: a signal that no single Mireye field states, which falls out when you combine several of them with something of your own.

## What we mean by "agent"

An agent, here, is software that **makes a decision you did not hardcode**. It runs a loop:

1. **Data** — it pulls Mireye's cited fields, plus a dataset you brought.
2. **Enrichment** — it derives something none of the sources state on their own.
3. **Signals** — that derived thing becomes a threshold, a score, a flag. Something with an edge.
4. **Tools** — it calls things. Mireye over HTTP or MCP, your own functions, a geocoder, whatever produces the output.
5. **Decision** — it picks, ranks, rejects, and can tell you *why* in terms of the signals.

The last two are what separate an agent from a dashboard. A dashboard shows you seven numbers. An agent looks at the seven numbers, decides this location is worth your attention and that one is not, and does something about it.

Your submission should sit squarely in that loop.

## A worked example

Cell carriers pay landowners rent for tower sites. Shady built an agent that finds that land automatically and drafts the outreach — on Mireye:

> ### 👉 **[x.com/Shadyymaine/status/2086904711836278898](https://x.com/Shadyymaine/status/2086904711836278898)**
>
> *Watch this one. It is the shape we are looking for.*

No Mireye field is called `good_tower_site`. The signal is derived from ordinary ones:

| Fields | What they tell you |
| --- | --- |
| `mobile_5g_coverage_class` | where coverage is weak — the demand |
| `antenna_structures_within_2km_count`, `nearest_antenna_structure_distance_m` | where towers already are — the gap |
| `elevation`, `slope_degrees` | height wins, grade kills |
| `nearest_road_distance_m`, `nearest_road_surface` | a service truck has to reach it |
| `fiber_broadband_available`, `nearest_transmission_line_distance_m` | backhaul and power |
| `housing_units_within_1km`, `tract_population` | someone to serve |
| `special_use_airspace_type`, `nearest_airport_distance_m`, `intersects_protected_area` | the disqualifiers |

A handful of ordinary fields and one rule become a ranked shortlist, and the agent acts on it. End yours at the shortlist plus a link to the county assessor — owner lookup is out of scope, see the budget.

## The work we expect

**1. Pick a question, not a topic.** "Something with wildfire data" is a topic. "Which rural fire stations are furthest from the housing they are supposed to protect, and where is that getting worse?" is a question. Write yours down in one sentence before you write any code. If you cannot, you are not ready to build yet.

**2. Find your second dataset.** Mireye brings the cited physical layer. You bring something else about the US — public filings, permits, prices, schedules, complaints, closures, listings, sensors, anything. It does not have to be geospatial; it has to be joinable. Unconventional beats clean. If the join is obvious, pick again.

**3. Build the enrichment, and defend it.** State plainly: these inputs, this rule, this output. Then argue why the rule is reasonable. A weighted score with arbitrary weights is not an argument. A threshold you can justify from the physical world is.

**4. Put an agent on it.** It should take a real input, gather what it needs through tools, decide, and produce something a person would act on — a ranked list, a letter, an alert, a verdict, a flagged exception.

**5. Show your working.** Every decision should be traceable back to the fields that drove it. Mireye returns a source for every value; carry that through to your output. An answer nobody can check is not a result.

**6. Test it against reality.** Pick 10–20 cases where you already know the right answer and run your agent on them. Report how it did, including where it failed. A project that honestly reports 12/20 is better than one claiming 20/20 without evidence.

**7. Say what you cannot know.** Every dataset has a resolution, a vintage and a blind spot. Name yours. Overclaiming is the single fastest way to lose credibility, and we will notice.

### What you hand in

- **The product.** Running, reachable, usable by someone who did not build it.
- **The agent.** Its loop, its tools, and its decision logic, written down.
- **A short write-up.** The question, the datasets, the enrichment, the evaluation, the limits. A few pages, not a thesis.
- **A demo.** Two or three minutes showing the agent making a decision and being right about it.

## Getting started

| | |
| --- | --- |
| `www.mireye.com` | one account per person — we put you on the Build plan |
| `GET /v1/meta/fields` | every field and its price — free, no key needed |
| `POST /v1/fetch/quote` | price a request before you run it — **learn this one first** |
| `POST /v1/fetch` | the data (use `/v1/fetch/batch` for many coordinates) |
| `POST /v1/ask` | ask in plain English — 10 credits |
| `api.mireye.com/mcp` | wire Mireye into Claude or Cursor over MCP — the fastest way to give an agent tools |
| `api.mireye.com/v1/docs` | reference docs |

## Your budget

Every person on the team gets their own account and their own 25,000 credits, so a team of three has 75,000 a month between you. Divide the work deliberately rather than three people fetching the same coordinates.

- **An ordinary field costs 1 credit per location.** 25,000 credits is roughly 25 fields across 1,000 coordinates. That is enough to build something real.
- **The parcel fields cost 300 credits per location** (owner, APN, boundary, zoning). Eighty-three lookups and your month is gone. They are out of scope for this program — design around them.
- **60 requests per minute.** Batch your coordinates rather than looping one at a time.
- **Quote before you fetch.** Every time. It costs nothing and it is the habit that saves the month.

## Field requests — use them sparingly

Your account carries a few **field requests**. A field request asks us to build a dataset you need into the API itself, so that it comes back cited and joinable like everything else.

They are deliberately few. Each one is real engineering on our side — sourcing the data, checking the licence, wiring it in — so treat them as a scarce resource, not a shopping list. Spend one when your project genuinely cannot proceed without it, and only after you have checked `GET /v1/meta/fields` and confirmed nothing close already exists.

A good field request names the dataset, the publisher, and what your agent would decide with it.
