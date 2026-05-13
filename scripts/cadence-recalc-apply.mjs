// Cadence recalc APPLY — runs after the dry-run preview is approved.
// Reads the latest cc-batch-proposals-*.json from ~/Downloads,
// snapshots current M+N values for every affected row to a backup JSON,
// writes the proposed NFU + NFU type via batch update, then spot-checks
// 10 rows to confirm what landed.

import { google } from "googleapis";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { homedir } from "os";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && existsSync("/tmp/cc-sa.json")) {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = readFileSync("/tmp/cc-sa.json", "utf-8");
}

const SHEET_ID = "1_ixxLJVKlu3JjgTyjgwSjq_bsZyv1Htp2iIbnBkXZmg";
const DOWNLOADS = `${homedir()}/Downloads`;

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function main() {
  // Load most-recent proposals file
  const files = readdirSync(DOWNLOADS)
    .filter((f) => f.startsWith("cc-batch-proposals-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) {
    console.error("No proposals file found in ~/Downloads — run cadence-recalc-preview.mjs first");
    process.exit(1);
  }
  const proposalsPath = `${DOWNLOADS}/${files[0]}`;
  const proposals = JSON.parse(readFileSync(proposalsPath, "utf-8"));
  console.log(`Loaded ${proposals.length} proposals from ${proposalsPath}\n`);

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // ─── STEP 1: Backup current M+N for every affected row ──────────────
  console.log("STEP 1: Snapshotting current state...");
  const ranges = proposals.map((p) => `Opportunities!M${p.sheetRow}:N${p.sheetRow}`);
  const { data: current } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges,
  });
  const backup = {
    timestamp: new Date().toISOString(),
    sheetId: SHEET_ID,
    note: "Pre-cadence-recalc snapshot. Use cadence-recalc-rollback.mjs to restore.",
    cells: proposals.map((p, i) => {
      const vr = current.valueRanges[i];
      const row = (vr.values && vr.values[0]) || [];
      return {
        range: vr.range,
        sheetRow: p.sheetRow,
        name: p.name,
        oldNFU: row[0] || "",
        oldNFUType: row[1] || "",
      };
    }),
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${DOWNLOADS}/cc-sheet-backup-${ts}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`  ✓ Backup written: ${backupPath}`);
  console.log(`  ✓ Captured ${backup.cells.length} rows × 2 cells\n`);

  // ─── STEP 2: Write new M+N values via batch update ─────────────────
  console.log("STEP 2: Writing new NFU dates + types...");
  const updates = proposals.map((p) => ({
    range: `Opportunities!M${p.sheetRow}:N${p.sheetRow}`,
    values: [[p.proposedNFU, p.proposedChannel]],
  }));
  // Also bump Last Updated (column W) to today
  const today = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date());
    return `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "day").value}`;
  })();
  for (const p of proposals) {
    updates.push({ range: `Opportunities!W${p.sheetRow}`, values: [[today]] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates,
    },
  });
  console.log(`  ✓ Wrote ${proposals.length} rows × M (NFU date) + N (NFU type) + W (last updated)\n`);

  // ─── STEP 3: Post-write spot-check ─────────────────────────────────
  console.log("STEP 3: Spot-checking 10 rows...\n");
  // Pick: 3 random + 2 manual-override + 2 future-cadence + 3 high-priority spill
  const sample = [];
  const byClass = {
    manual: proposals.filter((p) => p.classification === "manual"),
    future: proposals.filter((p) => p.classification === "future-cadence"),
    spill: proposals.filter((p) => p.classification === "spill").sort((a, b) => b.heat - a.heat),
  };
  // 3 random
  const pool = [...proposals];
  for (let i = 0; i < 3 && pool.length; i++) {
    sample.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  // 2 manual
  for (let i = 0; i < 2 && byClass.manual[i]; i++) sample.push(byClass.manual[i]);
  // 2 future-cadence
  for (let i = 0; i < 2 && byClass.future[i]; i++) sample.push(byClass.future[i]);
  // 3 high-priority spill
  for (let i = 0; i < 3 && byClass.spill[i]; i++) sample.push(byClass.spill[i]);

  const verifyRanges = sample.map((s) => `Opportunities!M${s.sheetRow}:N${s.sheetRow}`);
  const { data: verifyData } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: verifyRanges,
  });
  let mismatches = 0;
  sample.forEach((s, i) => {
    const row = (verifyData.valueRanges[i].values && verifyData.valueRanges[i].values[0]) || [];
    const actualDate = row[0] || "";
    const actualType = row[1] || "";
    const dateOK = actualDate === s.proposedNFU;
    const typeOK = actualType === s.proposedChannel;
    const status = dateOK && typeOK ? "✓" : "✗";
    if (!dateOK || !typeOK) mismatches++;
    console.log(`  ${status} Row ${s.sheetRow} · ${s.name} [${s.classification}]`);
    console.log(`     Expected: ${s.proposedNFU} [${s.proposedChannel}]`);
    console.log(`     Actual:   ${actualDate} [${actualType}]`);
  });

  console.log();
  if (mismatches === 0) {
    console.log(`✅ All ${sample.length} spot-checked rows match proposals exactly.`);
    console.log(`✅ Backup at: ${backupPath}`);
    console.log(`✅ Rollback command: node scripts/cadence-recalc-rollback.mjs ${backupPath}`);
  } else {
    console.log(`❌ ${mismatches} mismatches found. Sheet may be in an inconsistent state.`);
    console.log(`   Rollback: node scripts/cadence-recalc-rollback.mjs ${backupPath}`);
    process.exit(1);
  }

  // Invalidate dashboard ISR cache so the fresh data shows up immediately
  try {
    const url = "https://cc-pipeline-dashboard.vercel.app/api/revalidate";
    const res = await fetch(url, { method: "POST" });
    if (res.ok) console.log(`✓ Dashboard ISR cache invalidated`);
    else console.log(`(Note: dashboard revalidate endpoint returned ${res.status} — hard-refresh manually if needed)`);
  } catch (e) {
    console.log(`(Note: couldn't reach dashboard revalidate endpoint — hard-refresh manually if needed)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
