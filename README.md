# VOLT-TERRA

VOLT-TERRA is an EV charging and grid planning application built with the Mireye API.

It serves two types of users:

- **EV Facility** helps businesses, planners, and funding teams find counties that need more chargers. It checks whether the grid can support a charger or needs an upgrade first.
- **EV Rider** helps drivers check whether owning an EV is practical at a location. It considers nearby public chargers, driving time, road access, and local conditions.

## Features

- Live state and county charging analysis
- Grid readiness checks using substation data
- Charger or grid-upgrade funding recommendations
- Address and map checks for EV riders
- AI chat with cited location evidence

## Technology

The frontend uses React, Vite, and React Leaflet. The API server uses Node.js and Express. Data comes from Mireye, DOE AFDC, the US Census, and available state EV registration sources. Gemini or Groq can power the optional AI chat.

## Setup

Node.js 20 or newer is required.

1. Install dependencies:

```bash
npm ci
```

2. Create a local environment file:

```bash
cp .env.example .env
```

3. Add the required Mireye key:

```env
MIREYE_API_KEY=your_key_here
```

Optional keys:

```env
GROQ_API_KEY=
GEMINI_API_KEY=
NREL_API_KEY=DEMO_KEY
CENSUS_API_KEY=
```

Use either Groq or Gemini for model-backed chat. An AFDC key is recommended for full state sweeps. Do not commit the `.env` file.

4. Start the application:

```bash
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API health check: `http://localhost:3000/api/health`

## How it works

1. The user selects a state. The app first estimates the number of counties and the Mireye credit cost.
2. The server gets public charging stations from DOE AFDC.
3. The server uses public EV registrations when available. Otherwise, it clearly uses county population as a demand estimate.
4. County population-center coordinates are sent to Mireye in batches. Mireye returns cited grid, road, terrain, cost, and risk fields.
5. The app compares charging demand with public charging supply and checks three grid rules.
6. Results are shown as county rankings, map layers, evidence, and recommendations.

The three grid rules are:

| Check | Rule |
|---|---|
| Status | A known substation status must be `IN SERVICE`. |
| Distance | A usable substation must be within 8,000 meters. |
| Voltage | The substation must support at least 60 kV. |

An underserved county that passes the rules is marked `fund_charger_now`. A county that fails a rule is marked `fund_grid_upgrade_first`.

## Application APIs

| Method and route | Purpose |
|---|---|
| `GET /api/health` | Checks whether the Node server is running. |
| `GET /api/live/quote/:state` | Estimates counties and credits for a state. |
| `POST /api/live/sweep/:state` | Runs the full live state analysis. |
| `GET /api/live/result/:state` | Reads the latest in-memory state result. |
| `GET /api/counties/boundaries/:state` | Gets county shapes for the map. |
| `GET /api/counties/state-outline/:state` | Gets the outer state boundary. |
| `GET /api/counties/:fips` | Gets evidence and results for one county. |
| `GET /api/counties/:fips/stations` | Gets public stations from the latest sweep. |
| `POST /api/explore/check-point` | Checks grid readiness at one coordinate. |
| `POST /api/rider/check-point` | Checks EV practicality at one location. |
| `POST /api/chat` | Sends a question to the AI agent. |
| `GET /api/counties/:fips/memo` | Reads a saved county memo. |
| `POST /api/counties/:fips/memo` | Generates a cited county memo. |

The older California-only workflow is available under `/api/pipeline/*`.

## External APIs

| API | Use |
|---|---|
| Mireye `/v1/fetch/quote` | Estimates credit cost. |
| Mireye `/v1/fetch/batch` | Gets fields for all counties in a sweep. |
| Mireye `/v1/fetch` | Gets fields for one location. |
| Mireye `/v1/proximity` | Calculates driving routes and finds substations. |
| Mireye `/v1/ask` | Produces cited evidence and memos. |
| DOE AFDC | Gets statewide and nearby public charging stations. |
| Census ACS | Gets current county population when configured. |
| State DMV and Atlas EV Hub | Provide EV registration data when available. |
| Groq or Gemini | Runs the optional AI chat agent. |
| OpenStreetMap Nominatim | Converts an address into coordinates. |

API keys are read only by the server. Nominatim is a public address search called by the frontend.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Starts the frontend and API together. |
| `npm run server:start` | Starts only the Node API. |
| `npm run client:dev` | Starts only the frontend. |
| `npm run build` | Builds the frontend for production. |
| `npm test` | Runs the offline tests. |

## Vercel deployment

The repository includes `vercel.json` and a Node function in `api/index.js`.

1. Import the repository into Vercel.
2. Add `MIREYE_API_KEY` in Project Settings under Environment Variables.
3. Add optional Groq, Gemini, AFDC, and Census keys.
4. Deploy the project.
5. Open `https://your-domain/api/health`.

A working health response looks like:

```json
{
  "ok": true,
  "pilot_state": "CA"
}
```

Redeploy the project after changing an environment variable.

## Tests

The project has 144 offline tests across 18 files.

```bash
npm test
```

## Notes

- Most states do not publish county-level EV registration data, so population may be used as a labelled estimate.
- The result is a planning screen, not a utility interconnection study.
- Live sweep results are kept in memory and are lost when the server restarts.
- Vercel memory is not permanent, so durable production state needs a database or object storage.
- Metered routes have rate and credit limits but do not currently require user login.
- Use `https://developer.nlr.gov` for AFDC. The old `developer.nrel.gov` host is retired.

More detail is available in the [project specification](docs/volt-terra-spec.pdf) and [project write-up](docs/write-up.md).
