# Mahogany & Hyde Operations — project notes for Claude Code

## What this repo is

**This is the EXACT working code of Jared Lim's Colour Craft Painting operations dashboard**, copied verbatim. Same components, same UI, same patterns, same hard-won fixes. Not a sanitized skeleton — the real thing.

Your job is to **adapt** it for Cody O'Neal's Mahogany and Hyde (custom woodworking, Arkansas). The visual design, component architecture, focus mode logic, bucketing logic, JWT auth, service-account Sheets pattern, ISR strategy — all of that stays exactly the same. What changes:

1. **Brand tokens** — CC navy/orange becomes MH walnut/mahogany/brass
2. **Business vocabulary** — "painting" / "crews" / "washing" / "colours" becomes "woodworking" / "Paul" (single producer) / "milling" / "finishing"
3. **CC-specific features Cody doesn't need** — subcontractor iCal feeds, weather widget, DripJobs CSV import, crew management, ProductionMap
4. **Sheet schema** — CC's 29-column Lead Tracker becomes MH's simpler Opportunity / Production / TimeEntries schema
5. **NEW features Cody needs** — phone-first `/clock` surface for per-task time entries (Paul clocks in/out by task)

## The adaptation playbook (Phase 0 — do this before anything else)

Run these in order as the **very first thing** after cloning the repo. Each step is a discrete pass; confirm in dev (`npm run dev` → load page → looks right) before moving to the next.

### Step 0.1 — Bulk rename CC → MH (visible strings)

- `app/layout.tsx`: change metadata title/description from Colour Craft to Mahogany & Hyde
- `app/manifest.ts`: change name + short_name
- `app/login/LoginForm.tsx`: replace the `<img src="/cc-logo.png" />` block with a text wordmark "Mahogany & Hyde" (no logo file ships with the starter). The "Colour Craft Painting" tagline becomes "Custom Woodworking".
- `app/page.tsx`: any "Colour Craft" copy in the dashboard header becomes "Mahogany & Hyde"
- Search-replace any visible "Colour Craft" / "CC" string in `app/**/*.tsx` and `components/**/*.tsx` to the MH equivalent
- Keep the `cc-` prefix in CSS variable names for now (Step 0.2 handles those) — only fix VISIBLE strings here

### Step 0.2 — Rebrand the design tokens

In `app/globals.css`, the `:root` block has CC color tokens. Replace the palette, keeping the same variable shape:

```css
/* Old CC palette */
--cc-navy: #0F2D4A; --cc-blue: #1E5C8A; --cc-accent: #E8923C; ...

/* New MH palette — walnut + cream + brass */
--mh-walnut: #3a2618; --mh-walnut-deep: #271710;
--mh-mahogany: #6e3a1f; --mh-brass: #b8893a;
--mh-brass-soft: #f4e6c6; --mh-cream: #f8f3e8;
```

Update the `@theme inline` block in lockstep: every `--color-cc-*` becomes `--color-mh-*`. Then search-replace `cc-navy` → `mh-walnut`, `cc-blue` → `mh-walnut-deep`, `cc-accent` → `mh-mahogany`, `cc-accent-soft` → `mh-brass-soft` across all `.tsx` files. The bg color `#F8F5EE` (CC's warm paper) can stay or shift slightly cooler — try `#f8f3e8`.

Bucket accent colors (overdue/today/7/14/30/90/unsched) and bucket logic stay identical — they work for any sales pipeline.

### Step 0.3 — Remove CC-specific features Cody doesn't need

Delete:
- `app/api/ical/` — subcontractor iCal feeds (Cody has no subs)
- `components/ProductionMap.tsx` + `ProductionMapClient.tsx` + `lib/geocode.ts` — no service area to map
- `lib/weather.ts` — woodwork doesn't depend on weather
- `lib/csvParse.ts` + DripJobs-related logic in `lib/leadActions.ts` — Cody uses Todoist + QB Time, not DripJobs
- Any "crew" UI (`AddJobModal.tsx` crew selector, Crew enum in `lib/types.ts`, crews API) — Cody's production is solo with Paul
- `app/api/lead`, `app/leads/`, `components/LeadCard*.tsx`, `LeadDrawer*.tsx`, `LeadBulkImportModal.tsx`, `LeadAddModal.tsx`, `LeadQuickLog.tsx`, `LeadTopPicks.tsx`, `LeadsCockpit.tsx`, `LeadsHeadlinePanel.tsx`, `LeadsHealthCard.tsx`, `LeadsInitNotice.tsx` — Cody's pre-quote outreach lives inside Opportunities as the "Initial Contact" stage; no separate Leads board
- The Leads link in `components/Nav.tsx`

Keep (these are gold):
- `/focus` (the killer feature)
- `app/production/page.tsx` core timeline + job cards (strip the crew/washing/colors UI; add wood species/finish fields)
- `components/OppCard.tsx`, `OppDrawer.tsx`, `BucketSection.tsx`, `VerbalYesRail.tsx`, `StageBadge.tsx`, `DateGroupSection.tsx`, `HeatGroupSection.tsx`, `FocusModeView.tsx`, `HeadlinePanel.tsx`, `SmartInsightsPanel.tsx`, `CommandPalette.tsx`, `Sparkline.tsx`
- `lib/bucketing.ts`, `lib/heat.ts`, `lib/insights.ts`, `lib/focusQueue.ts`, `lib/salesCadence.ts` — the prioritization brain
- `lib/sheets.ts` — the service-account read pattern (you'll rewrite the column parsers in Step 0.4)
- `lib/auth.ts`, `proxy.ts`, `app/login/`, `app/api/auth/` — auth layer unchanged
- All of `app/globals.css` structure (just swap palette)

### Step 0.4 — Adapt the sheet schema

CC's Lead Tracker is 29 columns. MH's much simpler:

**Opportunities tab (A-L):** id, name, stage, estValue, bookedValue, source, lastTouchDate, nextFollowUpDate, nextFollowUpType, notes, designerName, isTestRow

**Production tab (A-L):** id, name, bookedValue, materialsBudget, quotedHours, startDate, targetShipDate, status, woodSpecies, finishType, notes, isTestRow

**TimeEntries tab:** empty for now; Phase 3 (Postgres time_entries) populates this.

Rewrite `lib/sheets.ts` parsers for these column letters. Update `lib/types.ts` Opportunity + ProductionJob interfaces.

### Step 0.5 — Adapt the stage list

CC uses: Proposal Sent / Verbal Yes / On Hold / Long-Term / Won / Lost / Archived

MH uses: Initial Contact / Phone Conversation / Quote Sent / Verbal Yes / Booked / Lost / On Hold

Update `VALID_STAGES` in `lib/sheets.ts`, `ACTIVE_STAGES` / `TERMINAL_STAGES` in `lib/bucketing.ts`, the Stage enum in `lib/types.ts`, and any hardcoded stage strings in `components/StageBadge.tsx`.

### Step 0.6 — Add the new /clock surface

This is brand new — CC doesn't have it. Create `app/clock/page.tsx` for phone-first task time tracking. See Phase 3 below for the full spec; build the scaffold now (so the page exists in nav) and wire it fully in Prompt 3.

### Step 0.7 — Confirm everything renders

`npm run dev`, open localhost, login. Confirm `/opportunities`, `/production`, `/focus`, `/clock` all render with MH branding and the right stages. Fix anything broken before deploying.

---

---

## What's new since the initial transfer (2026-05-15 sync)

Jared's CC dashboard kept evolving after the May 13 transfer. The source files below were refreshed in this repo on 2026-05-15. None of these break the Phase 0 playbook — but a few touch sheet schema and routing logic, so adapt them with the rest of Phase 0.

**Sheet schema additions (Phase 0.4 — fold in when adapting Cody's sheet):**
- The "Production" tab is now called **"In Production"**. Add a NEW tab called **"Completed Jobs"** with the SAME column schema as In Production (A:AG, same headers). A job marked Complete in the dashboard now MOVES the row from In Production → Completed Jobs (not just an in-place status change).
- The Archive tab now holds Lost + Cancelled deals only — Won deals never go there. Won deals route directly to In Production. (Adapt this to MH's domain: a booked woodworking project goes straight to In Production, a Lost quote goes to Archive.)

**New routing rule in `lib/leadActions.ts::archiveLead`:**
- `result === "Won"` → write a new In Production row, NO Archive row
- `result === "Lost"` → write Archive row only
- On new In Production rows, auto-populates:
  - col J **Est Hours** = `round(bookedValue / 100)` (CC's rough $100/hr rate — Cody, change this to your $/hr rate or your shop's hours-per-dollar yardstick during Phase 0)
  - col U **Last Client Touch** = today (the booking day counts as the most-recent touch)

**Mark-Complete now MOVES rows:** `lib/productionActions.ts::updateStatus(jobId, "Complete")` reads the In Production row, appends to Completed Jobs, then clears the In Production row. Lets the production grid stay focused on active work.

**Production grid improvements (no schema change — pure UX):**
- Multiple unscheduled jobs stack vertically in the Unassigned column instead of rendering on top of each other (previous behaviour caused jobs to be hidden behind one another).
- Unscheduled job cards size to their estimated duration: `daysToFit(estHours)` rows tall. A 100-hour job appears as a 4-day card; a 25-hour job as 1 day.
- Drag-and-drop reliability fix: optimistic state now reconciles per-field against server data instead of blanket-clearing on every refresh. Fixes the ~10–20% rate of cards snapping back after drag (was a race condition between sheet write and Google Sheets read-after-write propagation).
- The "+" add-job affordance on empty cells no longer renders over occupied cells.

**TopPicks empty-state:** the "What to do next" panel now shows a "Queue clear" message when there are no urgent items, instead of disappearing entirely. Keeps the Focus Mode CTA always visible.

**Production card labels shortened:** Wash/Colors select labels trimmed to fit the 220px card width (Match instead of Match Required, etc.). Add `shrink-0` on flex `<select>` elements to prevent browser-squeeze overflow.

**Nav: Focus tab removed.** Focus Mode is reachable via the top-right CTA on the Pipeline page; doesn't need to be a top-level tab.

---

## Stack and conventions

- **Next.js 16 (App Router, Turbopack)** — middleware is renamed to `proxy.ts` and exports `proxy()` not `middleware()`. Don't revert.
- **React 19 Server Components**, ISR with `revalidate: 300` on the main pages
- **Tailwind 4** with `@theme inline` block in `app/globals.css` (no `tailwind.config.ts`)
- **TypeScript** strict mode
- **Service account** for Google Sheets — NOT OAuth. OAuth refresh tokens expire every 7 days in Google Cloud testing mode; service accounts don't have that problem.
- **JWT cookie** auth via `jose`. Single shared password. 30-day session.

## Hard-won learnings (read these — they save days)

1. **Never use `.toISOString().slice(0,10)` for "today".** It returns the UTC date, which is wrong overnight. Use `todayISO()` in `lib/utils.ts` which uses `Intl.DateTimeFormat` with an explicit timezone. Starter is hardcoded to `America/Vancouver` — change to `America/Chicago` for Arkansas.

2. **The sheet is the source of truth, the app is a view.** Never store data in the app that isn't also in the sheet.

3. **ISR revalidate = 300 seconds.** Sheet edits show in the app within 5 minutes. Don't "fix" this with constant re-fetches; you'll hit the Sheets API quota.

4. **Verify before declaring done.** Run `npm run build` after any change. Grep for any Tailwind class you used to confirm it appears as a literal — Tailwind v4 purges dynamic-string classes.

5. **One feature at a time, used a week before the next.** Parallel feature builds get abandoned.

6. **Focus Mode rule that must never break:** anyone touched today is EXCLUDED from the queue. `buildFocusQueue` filters by `lastTouchDate !== today`. Do not requeue same-day.

7. **Verbal Yes rail is pinned, always visible.** Don't bury it in the bucket list.

8. **Mobile-first for `/clock`, desktop-first for everything else.** Paul lives on `/clock` from his phone.

9. **Tailwind v4 theme tokens.** Add a `--mh-foo` var in `:root` AND mirror as `--color-mh-foo` in `@theme inline`, then use `bg-mh-foo` / `text-mh-foo` as literal class strings (not template strings).

10. **Plan before non-trivial work.** Enter planning mode, show plan, get approval, then execute.

## Phase 3 — /clock spec (when you get there)

Phone-first surface. Schema for the Postgres `time_entries` table (Neon free tier):

```
id           serial primary key
user         text not null  -- "Cody" or "Paul"
job_id       text not null  -- FK to ProductionJob.id
task         text not null  -- milling / glue-up / sanding / finishing / assembly / install
started_at   timestamptz not null default now()
ended_at     timestamptz null  -- null while running
units        numeric null
unit_type    text null  -- "linear-ft" / "sq-ft" / "pieces"
```

When Paul picks a different task while one is running, auto-stop the previous (set ended_at = now()) BEFORE inserting the new row. Wrap in a transaction. Concurrent clock-ins would double-count.

Job dropdown pulls from Todoist MCP (Todoist projects = jobs). Task dropdown from a hardcoded list (Cody confirms his standard task categories during Prompt 1).

## Phase 4 — the glue (after Phase 3)

- Morning briefing email at 7am Central
- AI Estimate Generator at /estimate
- Margin dashboard at /margins (per-commission rollup pulling QuickBooks expenses + Postgres labour hours)

## Commit style

Short imperative subject. End with `Co-Authored-By:` line if you want.
