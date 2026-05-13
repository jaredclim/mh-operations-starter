# Mahogany & Hyde Operations — project notes for Claude Code

## What this is

The starter for Cody O'Neal's internal operations dashboard at Mahogany and Hyde, custom woodworking shop in Arkansas. Built from a sanitized clone of Jared Lim's Colour Craft sales + production system. Three surfaces in one Next.js app:

- `/opportunities` — sales pipeline, bucketed by next-follow-up date, with a pinned Verbal Yes rail on top
- `/production` — booked commissions in build
- `/clock` — phone-first clock-in/out for Cody and Paul (per-task time entries)
- `/focus` — one-card-at-a-time focus mode for outbound sales sessions

## Stack and conventions

- **Next.js 16 (App Router, Turbopack)** — note: middleware is renamed to `proxy.ts` and exports `proxy()` not `middleware()`. Don't revert.
- **React 19 Server Components**, ISR with `revalidate: 300` on the main pages
- **Tailwind 4** with `@theme inline` block in `app/globals.css` (no separate `tailwind.config.ts`)
- **TypeScript** strict mode
- **Service account** for Google Sheets read access — NOT OAuth. OAuth refresh tokens expire every 7 days when a Google Cloud project is in testing mode; service accounts don't have that problem.
- **JWT cookie** for auth via `jose`. Single shared password for Cody and Paul. 30-day session.
- **No database in V1**. Time entries (the only high-write surface) get added on Neon Postgres in Phase 3 — see `app/clock/page.tsx` TODOs.

## File layout

```
app/
  page.tsx                  redirects to /opportunities
  layout.tsx                root layout + top nav
  globals.css               Tailwind + M&H brand tokens
  opportunities/page.tsx    sales pipeline
  production/page.tsx       commissions in build
  clock/page.tsx            phone-first clock-in (scaffolded)
  focus/page.tsx            one-card-at-a-time focus mode
  login/page.tsx            Suspense wrapper
  login/LoginForm.tsx       password form
  api/auth/route.ts         POST = login, DELETE = logout
lib/
  types.ts                  Opportunity, ProductionJob, TimeEntry, stages
  utils.ts                  cn, currency, date helpers, todayISO
  sheets.ts                 Google Sheets API client
  bucketing.ts              active filter + date-based buckets
  focusQueue.ts             prioritization for /focus
  auth.ts                   JWT helpers
proxy.ts                    Next.js 16 proxy (was middleware) — auth gate
```

## Data layer notes

- Sheet ID set via `GOOGLE_SHEET_ID` env var. No fallback — set this in `.env.local`.
- Three tabs: `Opportunities`, `Production`, `TimeEntries` (TimeEntries column reads added in Phase 3).
- Column mappings are documented at the top of each `fetch*` function in `lib/sheets.ts`. If you reorder columns in the sheet, update the parsers there.
- Test rows (column L = "TEST") are filtered at parse time.
- Terminal stages (`Booked`, `Lost`) excluded from the active opportunity board by `bucketize`.

## Auth notes

- One shared password set via `DASHBOARD_PASSWORD` env var
- `proxy.ts` intercepts all routes except `/login`, `/api/auth`, and `_next/*`
- JWT secret in `AUTH_SECRET` env var (32+ random chars — generate with `openssl rand -hex 32`)
- Cookie is HttpOnly, Secure in prod, SameSite=Lax, 30-day max age

## Hard-won learnings from Jared (read these before coding)

1. **Never use `.toISOString().slice(0,10)` for "today's date".** It returns the UTC date, which is wrong overnight. Always go through `todayISO()` in `lib/utils.ts` which uses `Intl.DateTimeFormat` with an explicit timezone.

2. **The sheet is the source of truth, the app is a view.** Never store data in the app that isn't also in the sheet. Cody and Paul need to be able to edit the sheet directly if anything ever breaks.

3. **ISR revalidate = 300 seconds.** Sheet edits don't show up in the app instantly — there's a 5-minute lag. Don't try to optimize this away with constant re-fetches; you'll blow through the Google Sheets API quota.

4. **Verify before declaring done.** After any code change, run `npm run build` and grep for any Tailwind class you used to confirm it appears as a literal (Tailwind v4 purges classes that don't appear as text). Test on mobile if anything goes on `/clock`.

5. **One feature at a time, used for a week before the next.** Every time Jared tried to ship four features in parallel, two of them got abandoned half-built. Build, ship, use it for a real week, then move.

6. **Focus Mode rule that must never break:** anyone touched today is EXCLUDED from the queue. `buildFocusQueue` filters `o.lastTouchDate !== today`. Do not surface someone again the same day even if they're high-priority.

7. **The Verbal Yes rail is pinned, always visible.** Don't bury it inside the bucket list. It's the closest-to-revenue section and the whole reason the app exists.

8. **Mobile-first for `/clock`, desktop-first for everything else.** Paul will live on `/clock` from his phone. Cody works the pipeline from a laptop.

9. **Tailwind v4 trap.** No `tailwind.config.ts`. The `@theme inline` block in `app/globals.css` defines color tokens. To add a new color: add a `--mh-foo` var in `:root`, mirror it as `--color-mh-foo` inside `@theme inline`, then use it as `bg-mh-foo` / `text-mh-foo` in JSX. The class names must appear as literal strings, not template-strings-with-variables, or they'll get purged.

10. **When extending, plan first.** Tell Claude Code to enter planning mode before any non-trivial change. Get the plan. Approve. Then let it execute. This saves multiple hours of re-work.

## When extending

- **New tab**: add `app/<name>/page.tsx` plus a nav link in `app/layout.tsx`. Auth + ISR carry over.
- **New sheet column**: update the column letter map in `lib/sheets.ts` parsers AND the type in `lib/types.ts`.
- **New stage**: add to `OPPORTUNITY_STAGES` in `lib/types.ts`. Decide if it's `ACTIVE` or `TERMINAL` in `lib/bucketing.ts`.
- **New action button in Focus Mode**: add a Server Action that writes to the sheet's `lastTouchDate` + `notes` columns.

## Open TODOs for Cody to drive with Claude Code

Search the codebase for `TODO (CODY):` — every spot that needs Cody's input is tagged there.

- `app/clock/page.tsx` — wire to Todoist MCP, hook up Postgres time_entries, build the auto-stop-previous-timer transaction
- `app/production/page.tsx` — upgrade card grid to Gantt timeline
- `app/focus/page.tsx` — add Server Actions for Called / Emailed / Texted / IG-comment / Skip
- `app/opportunities/page.tsx` — add drawer / detail panel on card click

## Commit style

`<short imperative>` then optional body. End with the model attribution if you want, but it's optional.
