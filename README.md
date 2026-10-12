# FO Device Tracker

Consent-based tracker for employer-issued field-officer (FO) phones.

- **Phone page** `/device.html` — the FO opens it, enters a name, taps *Start sharing*.
- **Dashboard** `/` — you open it, sign in with the dashboard password, see every device, its online/offline status, and saved routes by date.

## How it works

```
FO phone (GPS) -> saved on the phone first -> uploaded to server -> database -> dashboard
```

- A GPS reading is saved on the phone **before** any upload. If there is no internet, readings wait on the phone and upload when the connection returns, with their **original timestamps**, so the route has no hole.
- A reading is only deleted from the phone after the server confirms it stored it.
- Recording rule (in `public/device.html`, top of the script): one reading every 15 s while moving 10 m or more; one every 60 s while standing still.
- A device is **online** if the server heard from it in the last 2 minutes, otherwise **offline** (grey dot, last position kept).
- History is kept 90 days (`RETENTION_DAYS`), then deleted automatically.

## Run on your laptop

```
npm install
npm start
```

Open http://localhost:3000. Chrome allows GPS on `localhost`. History is saved in `./data` (git-ignored).

## Settings (environment variables)

| Name | What it does |
|---|---|
| `DASHBOARD_PASSWORD` | **Set this.** Protects the dashboard and all location data. Username can be anything. |
| `DEVICE_KEY` | Optional access code the phones must enter. Stops strangers sending fake locations. |
| `DATABASE_URL` | Postgres address. Without it, history is TEMPORARY on Render (erased on every restart). |
| `RETENTION_DAYS` | How long history is kept. Default 90. |

## Limits (write these in your report)

- A website cannot track in the background. The FO's phone must keep the page open with the screen on. The page requests a screen wake lock to help.
- Browsers cannot read IMEI or a SIM number. Tracking a phone that was never set up, or that is switched off, needs enterprise device-management software.
- GPS accuracy depends on the phone and sky view; indoors it can be tens of metres off.
