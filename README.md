# Mahogany & Hyde Operations — Starter

A sanitized clone of the sales pipeline + production schedule system that Jared Lim built for Colour Craft Painting, adapted for Mahogany and Hyde (custom woodworking, Arkansas).

**Live demo of the structure:** `/opportunities`, `/production`, `/clock`, `/focus`.

## What this gives you

- **The architecture that works.** Service-account Google Sheets reads. JWT cookie auth. Next.js 16 + Tailwind 4 + React 19 Server Components + ISR. All the working patterns from Jared's CC dashboard, with paint-specific business logic stripped out.
- **Generic stages and schemas you'll customize.** `lib/types.ts` defines a woodwork-tailored Opportunity stage list and a ProductionJob shape with `woodSpecies` + `finishType` already wired in.
- **A `CLAUDE.md` packed with hard-won learnings** so your Claude Code doesn't have to re-discover them.
- **TODOs marked `TODO (CODY):`** at every spot that needs your input. Tell Claude Code to walk through them one at a time.

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/jaredclim/mh-operations-starter.git mh-operations
cd mh-operations
npm install

# 2. Set up environment
cp .env.example .env.local
# Fill in: GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY, DASHBOARD_PASSWORD, AUTH_SECRET

# 3. Run locally
npm run dev
# Open http://localhost:3000

# 4. Deploy to Vercel (Hobby tier — free)
vercel link
vercel --prod
```

## Setup walkthrough

### Step 1 — Create the Google Sheet

In your Google Drive create a sheet called **Mahogany and Hyde Operations** with three tabs:

**Tab: `Opportunities`** &mdash; columns A through L

| Col | Field | Example |
|---|---|---|
| A | id | OPP001 |
| B | name | Sarah Chen (Designer) |
| C | stage | Initial Contact / Phone Conversation / Quote Sent / Verbal Yes / Booked / Lost / On Hold |
| D | estValue | 5800 |
| E | bookedValue | 0 |
| F | source | designer / cold / past-client / referral |
| G | lastTouchDate | 2026-05-12 |
| H | nextFollowUpDate | 2026-05-19 |
| I | nextFollowUpType | call / email / text / IG-comment |
| J | notes | Free text |
| K | designerName | Sarah Chen |
| L | isTestRow | leave blank, or "TEST" to hide |

**Tab: `Production`** &mdash; columns A through L

| Col | Field |
|---|---|
| A | id |
| B | name |
| C | bookedValue |
| D | materialsBudget |
| E | quotedHours |
| F | startDate |
| G | targetShipDate |
| H | status (Scheduled / In Production / Complete) |
| I | woodSpecies |
| J | finishType |
| K | notes |
| L | isTestRow |

**Tab: `TimeEntries`** &mdash; leave blank for now. The /clock page will write here in Phase 3.

### Step 2 — Get a Google Service Account key

Tell Claude Code:

> Walk me through creating a Google Cloud service account with read access to the Sheets API and granting it access to my Mahogany and Hyde Operations sheet. Then take the downloaded JSON key, collapse it to a single line, and paste it into .env.local as GOOGLE_SERVICE_ACCOUNT_KEY.

This is a one-time setup. The key never expires.

### Step 3 — Set the dashboard password

In `.env.local`:

```
DASHBOARD_PASSWORD=<something you and Paul will remember>
AUTH_SECRET=<generate with: openssl rand -hex 32>
GOOGLE_SHEET_ID=<from your sheet URL>
```

### Step 4 — Deploy to Vercel (Hobby tier, free)

```bash
vercel link        # link this folder to a new Vercel project
vercel             # preview deploy
vercel --prod      # production deploy
```

After deploy, set the same four env vars in the Vercel dashboard (Settings → Environment Variables). Hobby tier is free and fully sufficient for your use case.

## Architecture in one paragraph

The Google Sheet is the database. The Next.js app is a beautiful, AI-augmented view on top of it. Pages re-fetch the sheet every 5 minutes (ISR). Edits to the sheet show up in the app within 5 minutes. The app does not write back to the sheet in V1 — that lands in Phase 2 when you add quick-log buttons. The /clock page (Phase 3) writes time entries to a separate Postgres database (Neon free tier) because writes-per-minute would otherwise blow through the Google Sheets API quota.

## What's intentionally missing

This is V1. The following are NOT in the starter — they're TODOs for Cody to drive with Claude Code:

- AI summarization of Fathom transcripts per designer
- Server Actions to log a touch from Focus Mode back into the sheet
- Gantt timeline view on `/production`
- Todoist MCP integration on `/clock`
- Postgres `time_entries` table + the auto-stop-previous-timer transaction
- Morning briefing email
- Job-cost rollup pulling QB materials + Postgres labour hours

The `CLAUDE.md` in this repo documents exactly what to do next and why.

## Credits

Architecture by Jared Lim. Sanitized starter prepared for Cody O'Neal of Mahogany and Hyde, May 2026.
