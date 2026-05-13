# Mahogany & Hyde Operations — Starter

The exact working code of Jared Lim's Colour Craft Painting operations dashboard, copied verbatim, ready for Cody O'Neal's Claude Code to adapt for Mahogany and Hyde (custom woodworking, Arkansas).

**You don't run this manually. Cody's Claude Code does the cloning, adapting, and deploying.** This README exists only so Claude Code knows what's inside.

## Inside

- **Next.js 16 + Tailwind 4 + React 19 Server Components** dashboard with ISR
- **Service-account Google Sheets** read pattern (no OAuth expiry pain)
- **JWT cookie auth** with single shared password, 30-day session
- **`/opportunities`** — bucketed sales pipeline (overdue / today / next 7 / 14 / 30 / 90 / unscheduled) with pinned Verbal Yes rail
- **`/production`** — drag-to-resize Gantt-style schedule with crew/job cards (crews removed for MH adaptation)
- **`/focus`** — one-card-at-a-time Focus Mode with AI prioritization, no-same-day-requeue rule
- **`/leads`** — pre-quote board (removed for MH — pre-quote outreach lives inside Opportunities)
- 40+ working components, hard-won UX fixes baked in

## How Claude Code uses this

Read `CLAUDE.md`. That file is the adaptation playbook: which files to keep, which to delete, which strings to rename, which CSS variables to swap. Phase 0 (steps 0.1 through 0.7) walks through the full CC → MH transformation. After Phase 0, the rest of the build sequence follows the prompts in the guide page Jared shared with Cody.

## Setup is done by Claude Code

- `git clone` this repo, run `npm install`
- Create the Mahogany and Hyde Operations Google Sheet via workspace-mcp (three tabs: Opportunities / Production / TimeEntries — schema in `CLAUDE.md` Step 0.4)
- Set up service account access
- Fill `.env.local` (GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY, DASHBOARD_PASSWORD, AUTH_SECRET)
- Deploy to Vercel Hobby tier

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19 Server Components + ISR (`revalidate: 300`)
- Tailwind 4 with `@theme inline` color tokens in `app/globals.css`
- Google Sheets API (read-only) via service account JWT
- `jose` for JWT cookie auth
- `framer-motion`, `lucide-react`, `recharts`, `date-fns`, `tailwind-merge`, `clsx`
- Deployed on Vercel Hobby

## Credits

Architecture by Jared Lim. Adaptation playbook for Cody O'Neal of Mahogany and Hyde, May 2026.
