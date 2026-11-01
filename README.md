# FO Tracker

A consent-based tracker for field officers (FOs). An FO's work phone shares its GPS location from a web page; a supervisor's dashboard shows live positions, saved routes, weekly site assignments and check-in verification.

## How it works

- **Phone page** (`/device`): the FO taps *Start sharing*. GPS points and check-ins are saved on the phone first (IndexedDB), then uploaded with their original GPS timestamps, so nothing is lost when the signal drops. The page also opens with no internet after the first visit.
- **Check-in**: the FO taps *Check in* next to a site (or *another place*). The phone waits for a precise GPS fix, shows the distance from the site, takes an optional photo, and saves it.
- **Dashboard** (`/`, password protected): *Live* (where phones are), *Day* (route + check-ins for a day, flags, photos, CSV), *Plan* (weekly sites, visited / not-visited board, paste-import of sites, CSV).
- **Verification**: a check-in is *verified* inside the site's radius, *off site* outside it, *unplanned* for "another place". Flags (weak GPS, no tracking nearby, impossible travel, phone clock ahead) mark check-ins worth a second look. Numbers live in `src/rules.js`.

## Run it

```
npm install
cp .env.example .env     # then fill in DATABASE_URL (a Postgres database; Neon's free tier works)
npm run dev
```

Open `http://localhost:3000/device` and `http://localhost:3000/`.

## Settings (environment variables)

| Name | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `DASHBOARD_PASSWORD` | Password for the dashboard and every API that returns locations |
| `DEVICE_KEY` | Optional access code the phones must enter |
| `GOOGLE_MAPS_API_KEY` | Enables Google Maps. Empty = OpenStreetMap. Restrict the key to your site's address and the Maps JavaScript API in Google Cloud Console |
| `GOOGLE_MAP_ID` | Google map style id (default `DEMO_MAP_ID`) |
| `RETENTION_DAYS` | How long data is kept (default 90) |
| `TIMEZONE` | Where "today" and "this week" are counted (default `Africa/Lagos`) |

## Code layout

```
server.js            starts everything
src/config.js        settings
src/rules.js         business numbers (radius, accuracy, speed limits...)
src/db/              connection pool, migrations (numbered .sql files, run once each)
src/domain/          pure functions: validation, check-in judging, site-list parsing
src/stores/          SQL, one file per table group
src/services/        what happens on an upload / assignment / review (uses stores + domain)
src/http/            routes, error handling
public/              the phone page (open to anyone) and shared files
private/             the dashboard (served only after the password)
test/                unit + API tests; test/e2e = real-browser tests
```

Changing the database: add a new numbered file in `src/db/migrations/`. Never edit one that has already been deployed.

## Tests

```
npm test                                    # unit + API tests (needs TEST_DATABASE_URL, a database with "test" in its name; it is wiped)
PLAYWRIGHT_PATH=... npm run test:e2e        # browser tests (phone + dashboard)
```

## Limits to know

- A web page cannot track in the background: the phone page must stay open with the screen on.
- Browsers cannot read a phone's IMEI or SIM number.
- Free hosting sleeps after 15 minutes without traffic; the first request after that is slow.
