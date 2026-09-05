#!/usr/bin/env node
// The orientation call, as a script: what does this project run on, who
// owns each piece, and what's still an open question. Run it when picking
// a project back up — or from a shell profile, so every terminal opens
// oriented.
//
//   MESS_KEY=mess_sk_... node morning-orientation.mjs [project-name]
//
// Defaults to the current directory's name, same as an agent would see.
import { basename } from "node:path";
import { MessClient } from "@mess.fyi/client";

const key = process.env.MESS_KEY;
if (!key) {
  console.error("MESS_KEY not set.");
  process.exit(1);
}
const project = process.argv[2] ?? basename(process.cwd());

const mess = new MessClient({ key });
const { accounts, count } = await mess.searchAccounts({ query: project });

if (count === 0) {
  console.log(`"${project}": nothing on the ledger. Unrecorded isn't the same as nothing —`);
  console.log(`an agent session with MESS wired in will log what it finds here.`);
  process.exit(0);
}

console.log(`"${project}" runs on ${count} account${count === 1 ? "" : "s"}:\n`);
const gaps = [];
for (const a of accounts) {
  const cost = a.monthly_cost ? ` · $${a.monthly_cost}/mo` : "";
  const plan = a.plan_name ? ` · ${a.plan_name}` : "";
  console.log(`  ${a.name} — ${a.instance_name}${plan}${cost}`);
  console.log(`    owner: ${a.account_email ?? "NOT RECORDED"} · credentials: ${a.credentials_location ?? "NOT RECORDED"}`);
  if (!a.account_email) gaps.push(`${a.name}: no recorded owner`);
  if (!a.credentials_location) gaps.push(`${a.name}: credentials location unknown`);
}

if (gaps.length) {
  console.log(`\nOpen questions (${gaps.length}):`);
  for (const g of gaps) console.log(`  - ${g}`);
}
