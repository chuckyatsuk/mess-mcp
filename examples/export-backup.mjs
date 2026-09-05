#!/usr/bin/env node
// Export the whole ledger — cancelled rows included — to a JSON file and a
// deterministic markdown file. Point a nightly cron at this and the ledger
// has an off-site history.
//
//   MESS_KEY=mess_sk_... node export-backup.mjs [out-dir]
//
// Deterministic on purpose: rows sorted by provider then label, stable
// field order, no timestamps in the output that aren't the rows' own — the
// same ledger always renders the same bytes, so day-over-day diffs show
// real changes only.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MessClient } from "@mess/client";

const key = process.env.MESS_KEY;
if (!key) {
  console.error("MESS_KEY not set.");
  process.exit(1);
}
const outDir = process.argv[2] ?? "mess-backup";

const mess = new MessClient({ key });
const list = await mess.listAccounts({ include_cancelled: true });
const rows = [...list.accounts].sort(
  (a, b) => a.name.localeCompare(b.name) || a.instance_name.localeCompare(b.instance_name),
);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ledger.json"), JSON.stringify(rows, null, 2) + "\n");

const lines = ["# MESS ledger export", ""];
lines.push(`${rows.length} accounts (${rows.filter((r) => r.status === "cancelled").length} cancelled).`, "");
for (const row of rows) {
  lines.push(`## ${row.name} — ${row.instance_name}`, "");
  const field = (label, value) => value != null && value !== "" && lines.push(`- ${label}: ${value}`);
  field("status", row.status + (row.status === "cancelled" ? " (kept for history)" : ""));
  field("role", row.role);
  field("owner", row.account_email ?? "NO RECORDED OWNER");
  field("projects", row.project);
  field("plan", row.plan_name);
  field("monthly cost", row.monthly_cost != null ? `$${row.monthly_cost}` : null);
  field("credentials", row.credentials_location);
  field("identifier", row.account_identifier);
  field("login", row.login_url);
  field("notes", row.notes);
  lines.push("");
}
writeFileSync(join(outDir, "ledger.md"), lines.join("\n"));

console.log(`exported ${rows.length} rows to ${outDir}/ledger.json and ${outDir}/ledger.md`);
