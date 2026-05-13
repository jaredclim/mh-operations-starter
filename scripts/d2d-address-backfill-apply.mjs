// D2D Address Backfill — APPLY.
// Loads the latest cc-d2d-backfill-*.json from ~/Downloads, snapshots
// current Address values for every row being modified, writes the new
// addresses to col E of Opportunities/Production/Archive, then spot-
// checks 10 random rows.

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
  const files = readdirSync(DOWNLOADS)
    .filter((f) => f.startsWith("cc-d2d-backfill-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) throw new Error("No backfill JSON found. Run preview first.");
  const matches = JSON.parse(readFileSync(`${DOWNLOADS}/${files[0]}`, "utf-8"));
  console.log(`Loaded ${matches.length} matches from ${files[0]}\n`);

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // ─── BACKUP ─────────────────────────────────────────────────────────
  console.log("STEP 1: Backing up current Address values...");
  const ranges = matches.map((m) => `${m.row.sheet}!E${m.row.sheetRow}`);
  const { data: cur } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges,
  });
  const backup = {
    timestamp: new Date().toISOString(),
    purpose: "D2D address backfill — pre-write snapshot",
    cells: matches.map((m, i) => {
      const vr = cur.valueRanges[i];
      const row = (vr.values && vr.values[0]) || [];
      return {
        sheet: m.row.sheet,
        sheetRow: m.row.sheetRow,
        name: m.row.name,
        range: vr.range,
        oldAddress: row[0] || "",
      };
    }),
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${DOWNLOADS}/cc-sheet-backup-d2d-${ts}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`  ✓ Backup: ${backupPath}`);
  console.log(`  ✓ Captured ${backup.cells.length} cells\n`);

  // ─── WRITE ──────────────────────────────────────────────────────────
  console.log("STEP 2: Writing addresses...");
  const updates = matches.map((m) => ({
    range: `${m.row.sheet}!E${m.row.sheetRow}`,
    values: [[m.d2d.address]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates },
  });
  console.log(`  ✓ Wrote ${matches.length} addresses\n`);

  // ─── SPOT-CHECK ─────────────────────────────────────────────────────
  console.log("STEP 3: Spot-checking 10 random rows...\n");
  const sample = [];
  const pool = [...matches];
  while (sample.length < Math.min(10, pool.length)) {
    sample.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  const verifyRanges = sample.map((m) => `${m.row.sheet}!E${m.row.sheetRow}`);
  const { data: ver } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: verifyRanges,
  });
  let mismatches = 0;
  sample.forEach((m, i) => {
    const actual = ((ver.valueRanges[i].values || [[]])[0] || [])[0] || "";
    const ok = actual === m.d2d.address;
    if (!ok) mismatches++;
    console.log(`  ${ok ? "✓" : "✗"} ${m.row.sheet} row ${m.row.sheetRow} · ${m.row.name}`);
    console.log(`     Expected: ${m.d2d.address}`);
    console.log(`     Actual:   ${actual}`);
  });
  console.log();
  if (mismatches === 0) {
    console.log(`✅ All 10 spot-checked rows match. Backfill complete.`);
    console.log(`✅ Rollback: node scripts/d2d-address-rollback.mjs ${backupPath}`);
  } else {
    console.log(`❌ ${mismatches} mismatches. Investigate before declaring done.`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
