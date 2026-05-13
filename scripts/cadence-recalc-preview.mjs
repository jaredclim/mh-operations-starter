// Cadence recalc DRY-RUN preview (V2 — priority-driven spread).
// Reads all Opportunities, computes proposed NFU using a two-pass:
//   Pass 1: classify each lead (manual override / future-cadence / spill)
//   Pass 2: spill leads spread across days by priority, max 10/day total
// Hot leads / VY / Promise capped to early days regardless of priority order.
// Writes preview CSV + sample to ~/Downloads — no sheet writes.
//
// Usage: node scripts/cadence-recalc-preview.mjs

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && existsSync("/tmp/cc-sa.json")) {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = readFileSync("/tmp/cc-sa.json", "utf-8");
}

const SHEET_ID = "1_ixxLJVKlu3JjgTyjgwSjq_bsZyv1Htp2iIbnBkXZmg";
const RANGE = "Opportunities!A2:AE1000";
const DAILY_CAP = 10;

// ─── Cadence math (mirrors lib/salesCadence.ts) ────────────────────────────
const CADENCE_TABLE = [
  { interval: 0,  channel: "Call" },
  { interval: 2,  channel: "Call" },
  { interval: 2,  channel: "Call" },
  { interval: 3,  channel: "Call + Email" },
  { interval: 3,  channel: "Call + Email" },
  { interval: 4,  channel: "Email" },
  { interval: 7,  channel: "Email" },
  { interval: 14, channel: "Call + Email" },
  { interval: 20, channel: "Email" },
  { interval: 30, channel: "Email" },
];
const VY_CADENCE = [
  { interval: 0, channel: "Call" },
  { interval: 2, channel: "Call" },
  { interval: 3, channel: "Call + Email" },
  { interval: 5, channel: "Call + Email" },
  { interval: 4, channel: "Email" },
];

function addDays(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const x = new Date(a + "T12:00:00Z").getTime();
  const y = new Date(b + "T12:00:00Z").getTime();
  return Math.round((y - x) / 86400000);
}
function todayPT() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  return `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "day").value}`;
}

function estimateTouchCount(opp) {
  const fromAttempts = opp.callAttempts || 0;
  const dateMatches = (opp.notes || "").match(/\[\d{4}-\d{2}-\d{2}/g);
  const fromNotes = dateMatches ? dateMatches.length : 0;
  const fromLastTouch = opp.lastTouchDate ? 1 : 0;
  return Math.max(fromAttempts, fromNotes, fromLastTouch);
}

// Heat score (mirrors lib/heat.ts::computeHeat) — drives priority order
const STAGE_BASE = { "Verbal Yes": 80, "Proposal Sent": 55, "On Hold": 30, "Long-Term": 20 };
const HOT_KEYWORDS = ["verbal yes","going to book","ready to book","ready to go","approve","approved","deposit","let's do it","let's go","go ahead","yes let","going through with","want to move forward","happy to proceed"];
const COLD_KEYWORDS = ["next year","later this year","passed","going with","went with","not at this time","decided to go","another company","after we","thinking about","hold off","not now","spring 2027","in the spring","in the fall","in the winter","in the new year"];

function computeHeatScore(opp, today) {
  let score = STAGE_BASE[opp.stage] ?? 30;
  if (opp.promise) score += 25;
  if (opp.lastEmailReceived) {
    const d = daysBetween(opp.lastEmailReceived, today);
    if (d >= 0 && d <= 14) score += 15;
  }
  if (opp.lastTouchDate) {
    const d = daysBetween(opp.lastTouchDate, today);
    if (d >= 0 && d <= 7) score += 5;
    else if (d > 14) score -= Math.min(25, d - 14);
  } else {
    score -= 5;
  }
  if (opp.callAttempts != null && opp.callAttempts > 2) {
    score -= Math.min(15, (opp.callAttempts - 2) * 2);
  }
  const lower = (opp.notes || "").toLowerCase();
  let hot = 0, cold = 0;
  for (const k of HOT_KEYWORDS) if (lower.includes(k)) hot++;
  for (const k of COLD_KEYWORDS) if (lower.includes(k)) cold++;
  if (hot) score += Math.min(15, hot * 8);
  if (cold) score -= Math.min(30, cold * 15);
  return Math.max(0, Math.min(100, score));
}

function nextScheduledTouch(opp, touchCount, today) {
  const notes = opp.notes || "";
  const forceCall = /\[OVERRIDE:\s*force-call/i.test(notes);
  const forceEmail = /\[OVERRIDE:\s*force-email|\[OVERRIDE:\s*passive-email|\[OVERRIDE:\s*low-priority/i.test(notes);

  // Manual override note — matches:
  //   "FU pushed to 2026-07-01"
  //   "FU date pushed to 2026-07-01"
  //   "FU updated to 2026-07-01"
  //   "Next FU 2026-07-01"
  //   "FU = 2026-07-01"
  //   "Next FU is 2026-07-01"
  // The most-recent date in the notes wins (notes are prepended newest-first
  // by appendNote, so the first match is the most recent).
  // Tight: only explicit action verbs (pushed/updated/set/scheduled/moved/changed)
  // catching e.g. "FU pushed to 2026-07-01" or "FU date pushed to 2026-07-01".
  // Skip permissive "FU 2026-08-25" / "next FU 2026-..." patterns — those
  // false-positive on date mentions buried in log lines.
  const overridePattern = /FU(?:\s+(?:date|target|next))?\s+(?:pushed\s+to|updated\s+to|set\s+to|scheduled\s+for|moved\s+to|changed\s+to)\s+(\d{4}-\d{2}-\d{2})/i;
  const m = notes.match(overridePattern);
  if (m && m[1] >= today) {
    return { date: m[1], channel: "Call", manual: true, reason: `Manual note: FU set to ${m[1]}` };
  }
  // Also support the "FU updated to YYYY-MM-DD" pattern with the literal
  // "follow-up" or "follow up" word:
  const fuPattern = /follow\s*-?\s*up\s+(?:pushed\s+to|updated\s+to|set\s+to|scheduled\s+for|moved\s+to|changed\s+to)\s+(\d{4}-\d{2}-\d{2})/i;
  const m2 = notes.match(fuPattern);
  if (m2 && m2[1] >= today) {
    return { date: m2[1], channel: "Call", manual: true, reason: `Manual note: FU set to ${m2[1]}` };
  }

  if (opp.stage === "Verbal Yes") {
    const stepIdx = Math.min(touchCount, VY_CADENCE.length - 1);
    const step = VY_CADENCE[stepIdx];
    const anchor = opp.lastTouchDate || today;
    const date = addDays(anchor, step.interval);
    let channel = step.channel;
    if (forceCall) channel = "Call";
    if (forceEmail) channel = "Email";
    return { date, channel, reason: `VY step ${stepIdx + 1}` };
  }

  // Promise=YES with future date → use promise date
  if (opp.promise && opp.promisedTime && /^\d{4}-\d{2}-\d{2}/.test(opp.promisedTime)) {
    const pd = opp.promisedTime.slice(0, 10);
    if (pd >= today) {
      return { date: pd, channel: forceEmail ? "Email" : "Call", reason: `Promise date ${pd}` };
    }
  }

  if (opp.stage === "On Hold") {
    const anchor = opp.lastTouchDate || today;
    return { date: addDays(anchor, 14), channel: "Call", reason: "On Hold +14d" };
  }
  if (opp.stage === "Long-Term") {
    const anchor = opp.lastTouchDate || today;
    return { date: addDays(anchor, 21), channel: "Email", reason: "Long-Term +21d" };
  }

  const stepIdx = Math.min(touchCount, CADENCE_TABLE.length - 1);
  const step = CADENCE_TABLE[stepIdx];
  const anchor = opp.lastTouchDate || opp.proposalDate || today;
  const date = addDays(anchor, step.interval);
  let channel = step.channel;
  if (opp.callAttempts >= 3 && stepIdx < 5) channel = "Email";
  if (forceCall) channel = "Call";
  if (forceEmail) channel = "Email";
  return { date, channel, reason: `Cadence step ${stepIdx + 1} (+${step.interval}d)` };
}

function getAuth() {
  const envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!envKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const creds = JSON.parse(envKey);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function parseDate(raw) {
  if (!raw) return null;
  const t = raw.trim();
  const iso = t.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  return null;
}
function parseInt0(raw) {
  if (!raw) return 0;
  const n = parseInt(raw.toString().replace(/[^0-9-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = data.values || [];
  const today = todayPT();

  const ACTIVE = new Set(["Proposal Sent", "Verbal Yes", "On Hold", "Long-Term"]);
  const leads = [];
  rows.forEach((r, idx) => {
    const sheetRow = idx + 2;
    const name = (r[1] || "").trim();
    if (!name || /^TEST\b/i.test(name)) return;
    const stage = (r[6] || "").trim();
    if (!ACTIVE.has(stage)) return;
    const opp = {
      sheetRow,
      id: (r[0] || "").trim(),
      name,
      stage,
      estValue: parseInt0((r[7] || "").replace(/[^0-9.-]/g, "")),
      estDate: parseDate(r[8] || ""),
      proposalDate: parseDate(r[9] || ""),
      lastTouchDate: parseDate(r[10] || ""),
      lastTouchType: (r[11] || "").trim(),
      currentNFU: parseDate(r[12] || ""),
      currentNFUType: (r[13] || "").trim(),
      promise: /yes/i.test(r[14] || ""),
      promisedTime: (r[15] || "").trim(),
      notes: (r[18] || "").trim(),
      lastEmailReceived: (r[24] || "").trim(),
      callAttempts: parseInt0(r[27] || ""),
    };
    opp.touchCount = estimateTouchCount(opp);
    opp.heat = computeHeatScore(opp, today);
    opp.cadence = nextScheduledTouch(opp, opp.touchCount, today);
    leads.push(opp);
  });

  // ─── Two-pass allocation ────────────────────────────────────────────
  // Pass 1: classify into 4 buckets
  //   manual    — honor as-is (FU pushed to ... notes)
  //   promise   — INVIOLATE. Lead has promise=YES with a specific date.
  //               Lands on that date, NO daily cap applies. If Jared
  //               promised 12 people Tuesday, all 12 surface Tuesday.
  //   future    — cadence says future date — use that date (subject to cap)
  //   spill     — cadence says today or past — priority spread with cap
  const manual = [];
  const promise = [];
  const future = [];
  const spill = [];
  for (const l of leads) {
    if (l.cadence.manual) {
      manual.push(l);
    } else if (l.promise && l.promisedTime && /^\d{4}-\d{2}-\d{2}/.test(l.promisedTime)) {
      // Promise with a concrete date — INVIOLATE
      promise.push(l);
    } else if (l.cadence.date > today) {
      future.push(l);
    } else {
      spill.push(l);
    }
  }

  // Pass 2: allocate spill by priority, respecting per-day cap
  // Day cap counts BOTH future-bucket leads landing on that day AND spill assignments.
  // VY / Promise / Hot leads get hard caps on how far they can be pushed.
  spill.sort((a, b) => {
    if (b.heat !== a.heat) return b.heat - a.heat;
    return b.estValue - a.estValue;
  });

  const dayCount = {};
  // Manual + Promise + Future allocations count toward the day's tally —
  // but PROMISES bypass the cap entirely (we still count them so the
  // spread algorithm avoids piling more spill on a promise-heavy day).
  for (const f of future) dayCount[f.cadence.date] = (dayCount[f.cadence.date] || 0) + 1;
  for (const m of manual) dayCount[m.cadence.date] = (dayCount[m.cadence.date] || 0) + 1;
  for (const p of promise) {
    const pd = p.promisedTime.slice(0, 10);
    const target = pd < today ? today : pd; // overdue promises → today
    dayCount[target] = (dayCount[target] || 0) + 1;
  }

  function findEarliestSlot(maxDaysOut) {
    for (let d = 0; d <= maxDaysOut; d++) {
      const day = addDays(today, d);
      if ((dayCount[day] || 0) < DAILY_CAP) return day;
    }
    // Fallback: just put it on the max day
    return addDays(today, maxDaysOut);
  }

  const allocations = new Map(); // leadId → final date
  for (const f of future) allocations.set(f.id || f.name, f.cadence.date);
  for (const m of manual) allocations.set(m.id || m.name, m.cadence.date);
  for (const p of promise) {
    const pd = p.promisedTime.slice(0, 10);
    // Overdue promise → call today. Promise date >= today → keep as-is.
    // Either way, NO cap — promise dates are inviolate per Jared's rule
    // (2026-05-12): if he promised 12 people Tuesday, all 12 land Tuesday.
    allocations.set(p.id || p.name, pd < today ? today : pd);
  }

  for (const s of spill) {
    let maxDaysOut = 14; // default ceiling
    if (s.stage === "Verbal Yes") maxDaysOut = 2;
    else if (s.promise) maxDaysOut = 2;
    else if (s.heat >= 70) maxDaysOut = 3; // Hot
    else if (s.heat >= 50) maxDaysOut = 6; // Warm
    else if (s.heat >= 25) maxDaysOut = 10; // Cool
    else maxDaysOut = 14; // Cold

    const slot = findEarliestSlot(maxDaysOut);
    allocations.set(s.id || s.name, slot);
    dayCount[slot] = (dayCount[slot] || 0) + 1;
  }

  // Build the final proposal set
  const proposals = leads.map((l) => ({
    sheetRow: l.sheetRow,
    id: l.id,
    name: l.name,
    stage: l.stage,
    heat: l.heat,
    estValue: l.estValue,
    lastTouchDate: l.lastTouchDate,
    currentNFU: l.currentNFU,
    proposedNFU: allocations.get(l.id || l.name),
    proposedChannel: l.cadence.channel,
    cadenceReason: l.cadence.reason,
    classification: l.cadence.manual
      ? "manual"
      : (l.promise && l.promisedTime && /^\d{4}-\d{2}-\d{2}/.test(l.promisedTime))
        ? "promise-inviolate"
        : (l.cadence.date > today ? "future-cadence" : "spill"),
    touchCount: l.touchCount,
    notes: l.notes,
  }));

  // Distribution
  const dist = {};
  proposals.forEach((p) => { dist[p.proposedNFU] = (dist[p.proposedNFU] || 0) + 1; });
  const maxBucket = Math.max(...Object.values(dist));
  const maxPct = ((maxBucket / proposals.length) * 100).toFixed(1);

  // CSV out
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = `${homedir()}/Downloads/cc-batch-preview-${ts}.csv`;
  const csv = [
    "row,id,name,stage,heat,est_value,classification,last_touch,current_nfu,proposed_nfu,channel,cadence_reason",
    ...proposals
      .slice()
      .sort((a, b) => a.proposedNFU.localeCompare(b.proposedNFU) || b.heat - a.heat)
      .map((p) => [
        p.sheetRow, p.id, `"${p.name}"`, p.stage, p.heat, p.estValue,
        p.classification, p.lastTouchDate || "(none)", p.currentNFU || "(none)",
        p.proposedNFU, p.proposedChannel, `"${p.cadenceReason}"`,
      ].join(",")),
  ].join("\n");
  writeFileSync(csvPath, csv);

  // JSON for the write phase
  const jsonPath = `${homedir()}/Downloads/cc-batch-proposals-${ts}.json`;
  writeFileSync(jsonPath, JSON.stringify(proposals, null, 2));

  console.log(`\n=== CADENCE RECALC DRY-RUN — V2 PRIORITY SPREAD (${today}) ===\n`);
  console.log(`Total active leads: ${proposals.length}`);
  console.log(`  • manual override:    ${manual.length}`);
  console.log(`  • promise (INVIOLATE): ${promise.length}`);
  console.log(`  • natural future:     ${future.length}`);
  console.log(`  • spill (was-clamped): ${spill.length}`);
  console.log(`Daily cap: ${DAILY_CAP} (promises bypass)`);

  console.log(`\nDISTRIBUTION:`);
  Object.entries(dist).sort((a, b) => a[0].localeCompare(b[0])).forEach(([d, c]) => {
    const bar = "█".repeat(Math.min(c, 30));
    console.log(`  ${d} → ${c.toString().padStart(2)} ${bar}`);
  });
  console.log(`\n  Largest same-date bucket: ${maxBucket} (${maxPct}%)`);
  if (maxBucket / proposals.length > 0.4) {
    console.log(`  ⚠️  STILL ANOMALOUS — investigate`);
  } else {
    console.log(`  ✅ Distribution healthy — no single-date dominance`);
  }

  console.log(`\nFull preview CSV: ${csvPath}`);
  console.log(`Write-set JSON:    ${jsonPath}`);

  // Sample 10 rows for eyeball
  console.log(`\n=== 10-ROW SAMPLE FOR EYEBALL ===\n`);
  const sample = [];
  // 3 highest-heat
  const byHeat = [...proposals].sort((a, b) => b.heat - a.heat);
  for (let i = 0; i < 3 && byHeat[i]; i++) sample.push({ kind: "top-heat", ...byHeat[i] });
  // 3 lowest-heat
  const byColdest = [...proposals].sort((a, b) => a.heat - b.heat);
  for (let i = 0; i < 3 && byColdest[i]; i++) sample.push({ kind: "coldest", ...byColdest[i] });
  // 1 VY
  const vy = proposals.find(p => p.stage === "Verbal Yes");
  if (vy) sample.push({ kind: "VY", ...vy });
  // 1 promise (renamed local var to avoid shadowing the outer `promise` bucket)
  const promiseLead = leads.find(l => l.promise && l.promisedTime);
  if (promiseLead) sample.push({ kind: "promise", ...proposals.find(p => p.id === promiseLead.id) });
  // 1 manual override
  if (manual.length) sample.push({ kind: "manual", ...proposals.find(p => p.classification === "manual") });
  // 1 spill mid-priority
  const midSpill = proposals.filter(p => p.classification === "spill").sort((a, b) => b.heat - a.heat)[Math.floor(spill.length / 2)];
  if (midSpill) sample.push({ kind: "mid-priority-spill", ...midSpill });

  sample.forEach(s => {
    console.log(`  [${s.kind}] Row ${s.sheetRow} · ${s.name} (${s.stage}, heat=${s.heat}, $${s.estValue})`);
    console.log(`     Last touch: ${s.lastTouchDate || "(none)"}`);
    console.log(`     Current NFU: ${s.currentNFU || "(none)"}`);
    console.log(`     PROPOSED NFU: ${s.proposedNFU} [${s.proposedChannel}] — ${s.classification}`);
    console.log(`     Reason: ${s.cadenceReason}`);
    console.log();
  });

  // Per-day roster (compact)
  console.log(`=== PER-DAY ROSTER (priority order within each day) ===\n`);
  const sortedDays = Object.keys(dist).sort();
  for (const day of sortedDays.slice(0, 10)) {
    const dayLeads = proposals
      .filter(p => p.proposedNFU === day)
      .sort((a, b) => b.heat - a.heat);
    console.log(`${day} (${dayLeads.length} leads):`);
    dayLeads.forEach(p => {
      console.log(`  · ${p.name.padEnd(22)} ${p.stage.padEnd(14)} heat=${String(p.heat).padStart(3)} $${String(p.estValue).padStart(6)} [${p.classification}]`);
    });
    console.log();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
