# GMB Guard — full-stack Next.js app

Automated Google Business Profile monitoring for 200+ listings. One Next.js 15
process: the UI (App Router, React 19) and the API (Route Handlers) share a
SQLite file database. No database server, no ORM, no migration tool.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` needs `GOOGLE_PLACES_API_KEY`; everything else is optional. The
database file `data/gmb.sqlite` is created on first request.

## Layout

```
app/                      UI pages (client components) + API routes
  page.tsx                Dashboard
  businesses/             Listings table, add/edit, check, export
  import/                 CSV import wizard
  reports/                Suspension report
  alerts/                 Alert preferences + alert log
  schedule/               Cron info, pause, run history
  settings/               Appearance, integrations status
  api/listings            GET list · POST create (+ immediate check)
  api/listings/[id]       GET (+history, alerts) · PATCH · DELETE
  api/listings/manual-check   POST { listingId | listingIds | all }
  api/listings/import     POST { rows[] }
  api/listings/stats      Dashboard counters + facets
  api/audit-logs          Status-change feed
  api/alert-logs          Alert delivery log
  api/check-runs          Cron / manual run history
  api/reports             Suspensions per day, events, uptime
  api/settings            GET / PATCH preferences · POST test-alert
  api/cron/check-gmb      Scheduled entry point (Bearer CRON_SECRET)
components/               App shell, drawer, modals, primitives
lib/db.ts                 SQLite data layer (better-sqlite3)
lib/google-places.ts      Place Details client, status mapping, retry
lib/gmb-checker.ts        checkListing / runChecks (batched)
lib/notifications.ts      Telegram + Resend alerts, digest, test
lib/settings.ts           Preferences (stored in SQLite)
lib/client/               Browser API client + formatting helpers
deploy/                   Ubuntu VPS scripts (PM2 + nginx + crontab)
```

## Status mapping

| Google `status`                              | `business_status`     | Stored status |
| -------------------------------------------- | --------------------- | ------------- |
| `OK`                                         | `OPERATIONAL` / none  | `ACTIVE`      |
| `OK`                                         | `CLOSED_PERMANENTLY`  | `CLOSED`      |
| `OK`                                         | `CLOSED_TEMPORARILY`  | `CLOSED` (constant in `lib/google-places.ts`) |
| `NOT_FOUND`, `INVALID_REQUEST`, `ZERO_RESULTS` | —                   | `SUSPENDED`   |
| `OVER_QUERY_LIMIT`, `UNKNOWN_ERROR`          | —                     | retried ×3; status untouched, `lastError` set |
| `REQUEST_DENIED`, HTTP 4xx                   | —                     | not retried; status untouched, `lastError` set |

A listing that has never been checked shows as **Pending** in the UI.

## Alerts

Every status transition writes an audit log row and fires Telegram + email in
parallel (each skipped if unconfigured, controllable per event under Alerts →
Preferences). Every delivery attempt is stored in the alert log. After each
scheduled run a digest is sent only when something changed or errored.

## Scheduling

`/api/cron/check-gmb` is called once a day by Vercel Cron (`vercel.json`) or a
crontab on the VPS (`deploy/install-cron.sh`). It needs
`Authorization: Bearer $CRON_SECRET`. Set `CRON_SCHEDULE` to the same
expression so the Schedule page shows the right countdown. "Check all" in the
UI runs the same logic on demand.

## Deploy

See `deploy/README.md` (Ubuntu VPS) — or push to Vercel with a persistent
volume for `DATABASE_PATH`.
