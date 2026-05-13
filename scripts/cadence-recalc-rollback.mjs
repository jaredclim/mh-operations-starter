// Cadence recalc ROLLBACK — restores M+N values from a backup JSON.
// Usage: node scripts/cadence-recalc-rollback.mjs <path-to-backup.json>

import { google } from "googleapis";
import { readFileSync, existsSync } from "fs";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && existsSync("/tmp/cc-sa.json")) {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = readFileSync("/tmp/cc-sa.json", "utf-8");
}

const SHEET_ID = "1_ixxLJVKlu3JjgTyjgwSjq_bsZyv1Htp2iIbnBkXZmg";

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath || !existsSync(backupPath)) {
    console.error("Usage: node scripts/cadence-recalc-rollback.mjs <path-to-backup.json>");
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
  console.log(`Restoring ${backup.cells.length} cells from ${backup.timestamp}\n`);

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const updates = backup.cells.map((c) => ({
    range: `Opportunities!M${c.sheetRow}:N${c.sheetRow}`,
    values: [[c.oldNFU, c.oldNFUType]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates },
  });

  console.log(`✓ Restored ${backup.cells.length} rows. Sheet returned to pre-batch state.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
