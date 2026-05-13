// D2D Address Backfill — DRY RUN.
// Reads the Lead Tracker (Opportunities + Production + Archive) and the
// external D2D Tracker, finds rows in the Lead Tracker with no address,
// matches them against the D2D tracker by name + phone, outputs a
// proposed write set as CSV + JSON for review.

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && existsSync("/tmp/cc-sa.json")) {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = readFileSync("/tmp/cc-sa.json", "utf-8");
}

const LEAD_TRACKER_ID = "1_ixxLJVKlu3JjgTyjgwSjq_bsZyv1Htp2iIbnBkXZmg";
const D2D_TRACKER_ID = "1OrYzPRvktwpGzMNPt4asmuDygqmfHlzdOEcHCzz0H4c";
const D2D_TABS = [
  "Leads & Estimates - Zen",
  "Leads & Estimates - Noah",
  "Leads & Estimates - Emily",
];

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Normalize name: lowercase, strip diacritics, collapse whitespace,
// drop punctuation. Used as the match key.
function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normPhone(s) {
  const digits = (s || "").replace(/[^0-9]/g, "");
  return digits.slice(-10); // last 10 = North American number
}
// Extract first + last name tokens — handles "Jared C. Lim" → ["jared", "lim"]
function nameTokens(s) {
  const norm = normName(s);
  if (!norm) return [];
  const parts = norm.split(" ");
  if (parts.length === 1) return parts;
  return [parts[0], parts[parts.length - 1]];
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // ─── Read D2D library ──────────────────────────────────────────────
  console.log("Reading D2D tracker tabs...");
  const d2dLeads = []; // { name, phone, email, address, source }
  for (const tab of D2D_TABS) {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: D2D_TRACKER_ID,
      range: `${tab}!A1:Z200`,
    });
    const rows = data.values || [];
    // Find header row — has "Customer Name:" in col C
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const cells = rows[i] || [];
      if (cells.some((c) => /customer name/i.test(c || ""))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;
    // Data starts after header. Columns: A=status, B=date, C=name, D=phone, E=email, F=address
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = (r[2] || "").trim();
      const phone = (r[3] || "").trim();
      const email = (r[4] || "").trim();
      const address = (r[5] || "").trim();
      if (!name && !phone && !email) continue;
      if (!address || address.length < 5) continue;
      // Filter out commentary rows (e.g., "Everything above this line...")
      if (name.length > 60) continue;
      d2dLeads.push({
        name,
        phone: normPhone(phone),
        email: email.toLowerCase(),
        address,
        source: tab.replace("Leads & Estimates - ", ""),
      });
    }
  }
  console.log(`  Loaded ${d2dLeads.length} D2D leads with addresses`);

  // ─── Read Lead Tracker — find rows missing addresses ───────────────
  console.log("\nReading Lead Tracker (Opportunities + Production + Archive)...");

  // Opportunities (A2:AE1000, col E = address, B = name, C = phone, D = email, G = stage)
  const oppData = await sheets.spreadsheets.values.get({
    spreadsheetId: LEAD_TRACKER_ID,
    range: "Opportunities!A2:AE1000",
  });
  const oppRows = (oppData.data.values || []).map((r, i) => ({
    sheet: "Opportunities",
    sheetRow: i + 2,
    id: (r[0] || "").trim(),
    name: (r[1] || "").trim(),
    phone: normPhone(r[2] || ""),
    email: (r[3] || "").trim().toLowerCase(),
    address: (r[4] || "").trim(),
    stage: (r[6] || "").trim(),
  })).filter((r) => r.name && !/^TEST\b/i.test(r.name));

  // Production (col E = address, B = name)
  const prodData = await sheets.spreadsheets.values.get({
    spreadsheetId: LEAD_TRACKER_ID,
    range: "Production!A2:F500",
  });
  const prodRows = (prodData.data.values || []).map((r, i) => ({
    sheet: "Production",
    sheetRow: i + 2,
    id: (r[0] || "").trim(),
    name: (r[1] || "").trim(),
    phone: normPhone(r[2] || ""),
    email: (r[3] || "").trim().toLowerCase(),
    address: (r[4] || "").trim(),
    stage: "Production",
  })).filter((r) => r.name);

  // Archive (col E = address)
  const archData = await sheets.spreadsheets.values.get({
    spreadsheetId: LEAD_TRACKER_ID,
    range: "Archive!A2:M500",
  });
  const archRows = (archData.data.values || []).map((r, i) => ({
    sheet: "Archive",
    sheetRow: i + 2,
    id: (r[0] || "").trim(),
    name: (r[1] || "").trim(),
    phone: normPhone(r[2] || ""),
    email: (r[3] || "").trim().toLowerCase(),
    address: (r[4] || "").trim(),
    stage: (r[12] || r[6] || "").trim(),
  })).filter((r) => r.name);

  const allLT = [...oppRows, ...prodRows, ...archRows];
  const missing = allLT.filter((r) => !r.address || r.address.length < 5);
  console.log(`  Total Lead Tracker rows: ${allLT.length}`);
  console.log(`  Missing addresses: ${missing.length}`);
  console.log(`    • Opportunities: ${missing.filter((r) => r.sheet === "Opportunities").length}`);
  console.log(`    • Production:    ${missing.filter((r) => r.sheet === "Production").length}`);
  console.log(`    • Archive:       ${missing.filter((r) => r.sheet === "Archive").length}`);

  // ─── Match missing rows against D2D library ────────────────────────
  console.log("\nMatching missing rows against D2D library...");
  const matches = []; // { row, d2d, matchKind, confidence }
  const unmatched = [];
  for (const row of missing) {
    const rowTokens = nameTokens(row.name);
    let bestMatch = null;
    let bestScore = 0;
    for (const d2d of d2dLeads) {
      let score = 0;
      let why = [];
      // Phone match (strongest)
      if (row.phone && d2d.phone && row.phone === d2d.phone) {
        score += 100;
        why.push("phone");
      }
      // Email match
      if (row.email && d2d.email && row.email === d2d.email && !/^(no\s?email|will give|did not)/i.test(d2d.email)) {
        score += 50;
        why.push("email");
      }
      // Name match (token-based — handles "Frank M" vs "Frank Mak")
      const d2dTokens = nameTokens(d2d.name);
      if (rowTokens.length && d2dTokens.length) {
        // Both first tokens match
        if (rowTokens[0] === d2dTokens[0]) score += 30;
        // Last tokens match (or one is prefix of other)
        if (rowTokens.length > 1 && d2dTokens.length > 1) {
          const a = rowTokens[1], b = d2dTokens[1];
          if (a === b) score += 30;
          else if (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))) score += 20;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { d2d, why };
      }
    }
    if (bestMatch && bestScore >= 60) {
      matches.push({
        row,
        d2d: bestMatch.d2d,
        why: bestMatch.why.join("+"),
        confidence: bestScore >= 100 ? "high" : bestScore >= 80 ? "medium" : "low",
      });
    } else {
      unmatched.push(row);
    }
  }

  console.log(`  ✓ Matched: ${matches.length}`);
  console.log(`    • high confidence (phone+name): ${matches.filter((m) => m.confidence === "high").length}`);
  console.log(`    • medium confidence: ${matches.filter((m) => m.confidence === "medium").length}`);
  console.log(`    • low confidence: ${matches.filter((m) => m.confidence === "low").length}`);
  console.log(`  ✗ Unmatched (no D2D entry found): ${unmatched.length}`);

  // ─── Output ────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = `${homedir()}/Downloads/cc-d2d-backfill-preview-${ts}.csv`;
  const csv = [
    "sheet,sheetRow,id,name,stage,d2d_source,d2d_name,d2d_phone,proposed_address,confidence,match_reason",
    ...matches.map((m) => [
      m.row.sheet,
      m.row.sheetRow,
      m.row.id,
      `"${m.row.name}"`,
      m.row.stage,
      m.d2d.source,
      `"${m.d2d.name}"`,
      m.d2d.phone,
      `"${m.d2d.address.replace(/"/g, "'")}"`,
      m.confidence,
      m.why,
    ].join(",")),
  ].join("\n");
  writeFileSync(csvPath, csv);
  const jsonPath = `${homedir()}/Downloads/cc-d2d-backfill-${ts}.json`;
  writeFileSync(jsonPath, JSON.stringify(matches, null, 2));

  console.log(`\nFull match CSV: ${csvPath}`);
  console.log(`Write-set JSON:  ${jsonPath}`);

  // ─── Unmatched report ──────────────────────────────────────────────
  console.log(`\n=== UNMATCHED (${unmatched.length}) — NOT in D2D tracker ===`);
  unmatched.slice(0, 30).forEach((u) => {
    console.log(`  ${u.sheet} row ${u.sheetRow} · ${u.name} (${u.stage})${u.phone ? ` · ${u.phone}` : ""}${u.email ? ` · ${u.email}` : ""}`);
  });
  if (unmatched.length > 30) console.log(`  ... and ${unmatched.length - 30} more (full list in CSV)`);

  // ─── Sample for eyeball (10 rows: 3 high, 3 medium, 3 low, 1 unmatched edge) ─
  console.log(`\n=== 10-ROW SAMPLE (review before approving write) ===\n`);
  const byConf = { high: [], medium: [], low: [] };
  matches.forEach((m) => byConf[m.confidence]?.push(m));
  const sample = [
    ...byConf.high.slice(0, 4),
    ...byConf.medium.slice(0, 3),
    ...byConf.low.slice(0, 3),
  ];
  sample.forEach((m) => {
    console.log(`  [${m.confidence}] ${m.row.sheet} row ${m.row.sheetRow} · ${m.row.name}`);
    console.log(`    Match via: ${m.why} (D2D source: ${m.d2d.source})`);
    console.log(`    Proposed address: ${m.d2d.address}`);
    console.log();
  });

  // Distribution check (per cc-sheet-batch-safety)
  const conf = { high: byConf.high.length, medium: byConf.medium.length, low: byConf.low.length };
  console.log(`=== DISTRIBUTION ===`);
  console.log(`  high confidence: ${conf.high} (auto-apply OK)`);
  console.log(`  medium:          ${conf.medium} (review recommended)`);
  console.log(`  low:             ${conf.low} (manual review required)`);
  console.log(`  unmatched:       ${unmatched.length} (action: provide address manually or pull from DripJobs)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
