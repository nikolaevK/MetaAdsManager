# Ads Manager

An internal Meta Ads Manager: browse and edit campaigns / ad sets / ads, launch new campaigns from templates with
an approval step, manage a creative library, and monitor ad review — all driven by the Marketing API (v26.0) with a
server-side system-user token.

**Stack:** Next.js 16 (App Router, Cache Components, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 ·
Drizzle ORM · SQLite locally / Turso (libSQL) in production · Vitest.

## Quick start

```bash
cp .env.example .env.local        # fill META_ACCESS_TOKEN, META_APP_SECRET, CRON_SECRET, SEED_ADMIN_*
echo "INLINE_WORKER=true" >> .env.local   # run background jobs inside `next dev`
npm install
npm run db:migrate
npm run db:seed                   # first admin + default naming/UTM + launch template #1
npm run dev                       # http://localhost:3000
```

Every ad account your Meta token can access is imported automatically (grouped into clients by Meta Business) and
starts syncing: structure, review status and 90 days of insights. Run `npm run accounts:sync` to import right away. Open **Settings → Launch templates** and set the pixel on
"Peptide Ads — Standard Launch" (template #1 is seeded without one on purpose).

## How it works

| Area | Where |
| --- | --- |
| Data model: Client → Ad Account → Campaign → Ad Set → Ad, creative library, templates, naming, UTM | `src/lib/db/schema.ts` |
| Account discovery: every ad account the token can access is imported (grouped by Meta Business) every 30 min | `src/lib/sync/accounts.ts` |
| Design system: tokens, light/dark themes, components, ⌘K command palette | `docs/design-system.md`, `src/components/ui.tsx`, `src/components/shell/*` |
| Graph client: `appsecret_proof`, token in header, typed errors, batch API (≤50/call), cursor paging | `src/lib/meta/client.ts` |
| Rate limits: parses `x-business-use-case-usage`, `x-ad-account-usage`, `x-app-usage`, insights throttle; blocks/defers per bucket | `src/lib/meta/usage-headers.ts`, `rate-limit.ts` |
| Job queue (SQLite-backed, atomic claim, dedupe keys, backoff, stale-lock reaping) | `src/lib/jobs/*` |
| Insights sync via async report jobs → `insights_daily` (dashboards never call Meta live) | `src/lib/sync/insights.ts` |
| Structure mirror + ad review monitoring (`effective_status`, `ad_review_feedback`, `issues_info`, webhooks) | `src/lib/sync/structure.ts`, `review.ts`, `src/app/api/webhooks/meta` |
| Campaign builder: Campaign → Ad sets → Ads → Review, autosaved drafts (`launch_drafts`), all 6 objectives, CBO/ABO, per-ad-set conversion location (website, messaging apps, app, on-ad), inline upload + crop per placement, up to 5 primary texts / headlines, Advantage+ enhancement toggles | `src/app/(app)/launches/new/*`, `src/lib/launch/draft.ts`, `objectives.ts`, `spec.ts` |
| Launch pipeline + idempotency ledger + rollback + activation | `src/lib/launch/pipeline.ts`, `ledger.ts`, `payloads.ts` |
| Campaigns table: ~35 metrics (registry), column presets + saved column sets per user, CSV export, bulk edit | `src/lib/metrics.ts`, `src/lib/columns.ts`, `src/app/(app)/campaigns/*` |
| Editor sheet: create/edit campaigns, ad sets (budget, bidding, schedule, locations, age, gender, interests, custom audiences, placements) and ads (copy on live ads, media from the library, previews) — read live from Meta | `src/app/(app)/campaigns/editor/*`, `src/lib/meta/objects.ts`, `targeting.ts` |
| History: every edit stores before/after values; one-click undo | `src/app/(app)/history`, `src/lib/queries/history.ts` |
| Date range: calendar picker, presets, previous-period comparison, remembered across pages (cookie) | `src/components/date-range-picker.tsx`, `src/lib/dates.ts` |

### Launch pipeline

1. **Media** — images → `/act_x/adimages` (hash); videos → chunked `/act_x/advideos` upload, then polled until
   `video_status = ready`. Uploads are cached per ad account.
2. **Creatives** — one creative per ad and per kind of ad set (where clicks go + which placements it uses):
   `asset_feed_spec` with the 1:1 and 9:16 assets, two `asset_customization_rules` (feed placements → 1:1,
   Stories/Reels → 9:16) and every primary text / headline option. Messaging ads use the feed file and one
   call to action per app (`DOF_MESSAGING_DESTINATION` when several apps are chosen).
3. **Advantage+ creative enhancements** — every feature in `degrees_of_freedom_spec.creative_features_spec` is sent as
   `OPT_OUT` unless it is switched on for that ad in the builder.
4. **Campaign → ad sets → ads**, all `PAUSED`, created via the batch API.
5. **Approval** — buyers review real placement renders (`/generatepreviews`); an admin approves. Activation runs
   ads → ad sets → campaign *last*, and re-pauses everything if any step fails.

Every object gets a ledger row (`launch_objects`) *before* the request is sent, so retries resume instead of
duplicating, and an unknown outcome (crash mid-request) is reconciled by name lookup. A permanent failure deletes
everything created so far (ads → ad sets → campaign → creatives), so half a campaign can never go live. Double
submits are absorbed by the launch's idempotency key.

### Editing live objects

The editor reads campaigns, ad sets and ads straight from Meta when opened, and every save is a partial
`POST` of only the changed fields. Targeting is patched onto the live spec, so settings the editor doesn't
show (locales, extra "narrow further" groups) survive. Meta creatives are immutable: editing an ad's copy
creates a new creative from the old spec and points the ad at it (the ad goes back through review).
New campaigns, ad sets and ads are always created **paused**. Before-values are captured for every edit, so
History can undo it.

## Background jobs

Jobs (syncs, launches, activation, rollback) live in the `jobs` table. Run them in one of three ways:

- **Dev / single server:** `INLINE_WORKER=true` runs a worker inside the Next server.
- **Self-hosted:** `npm run worker` as a separate long-running process (recommended in production).
- **Serverless:** call `GET /api/cron` every minute with `Authorization: Bearer $CRON_SECRET`.

User actions also kick the worker immediately via `after()`, so launches start without waiting for a tick.

Schedules: structure every 15 min, review every 10 min, last 3 days of insights hourly, last 28 days daily,
90-day backfill on connect.

## Security

- Email/password auth, scrypt (N=2¹⁷) hashes, DB-backed sessions (only SHA-256 of the token stored), httpOnly
  SameSite=Lax cookies, login throttling per email and IP, roles: `admin` / `buyer` / `viewer`.
- Every Server Action and route handler re-checks the session and role; inputs validated with Zod; writes are
  audit-logged; edits are limited to objects mirrored from connected ad accounts.
- The Meta token never leaves the server (no DB storage, sent in the `Authorization` header, `appsecret_proof` on).
- Webhooks verify `X-Hub-Signature-256`; cron requires a bearer secret (constant-time compare).
- Uploads are streamed to disk, size-capped, and type-checked by magic bytes; files are served only to signed-in users.
- Strict security headers (CSP allowing only Meta preview frames, `frame-ancestors 'none'`, HSTS in production).

## Deploying

- **Database:** create a Turso DB, set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`, run `npm run db:migrate`.
- **Files:** creative uploads are stored on local disk (`STORAGE_DIR`), and video files can be large, so deploy to a
  host with a persistent volume (VM, Fly.io, Railway, Render, Docker) and run `npm run worker` alongside `npm start`.
  Serverless platforms with request-body limits (e.g. 4.5 MB on Vercel) would need direct-to-object-storage uploads.
- **Webhooks (optional, faster review alerts):** in the Meta app, subscribe the *Ad Account* object to
  `with_issues_ad_objects` and `in_process_ad_objects` with callback `https://<host>/api/webhooks/meta` and your
  `META_WEBHOOK_VERIFY_TOKEN`. Polling keeps working without it.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest (unit + full launch pipeline against a fake Graph API) |
| `META_GRAPH_BASE_URL=http://localhost:4555 npm run dev` | Point the Graph client at a local mock server (never set in production) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run db:generate` / `db:migrate` / `db:seed` | Drizzle migrations and seed |
| `npm run worker` | Background job worker |
| `npm run accounts:sync` | Import every ad account the token can access and run the first syncs now |
| `USER_PASSWORD=… npm run user:create -- --email … --name … --role admin` | Create a user |
