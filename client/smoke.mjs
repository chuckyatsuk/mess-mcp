#!/usr/bin/env node
// Live smoke test. Needs a real agent key in MESS_KEY (environment, or an
// untracked .env at the repo root). Not run in CI — CI runs the fixture
// tests, which need no key.
//
// What it does to your ledger: creates ONE clearly-labeled test row
// (provider "SmokeTest"), exercises idempotent re-log, update, null-clear,
// and cancel on that row only, and leaves it cancelled. It reads counts
// from the rest of the ledger but never prints rows that aren't the test
// row, and never prints the key.
//
//   node smoke.mjs [--record <dir>]   # --record dumps raw responses (outside the repo!)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { MessClient, MessApiError } from "./dist/index.js";

const key = process.env.MESS_KEY ?? keyFromDotEnv();
if (!key) {
  console.error("MESS_KEY not set (env or repo-root .env). Nothing run.");
  process.exit(1);
}

const recordAt = process.argv.includes("--record")
  ? process.argv[process.argv.indexOf("--record") + 1]
  : null;
if (recordAt?.startsWith(new URL("..", import.meta.url).pathname)) {
  console.error("--record must point outside the repo.");
  process.exit(1);
}

const mess = new MessClient({ key });
const LABEL = `mess-mcp client smoke ${new Date().toISOString()} — safe to cancel`;
let step = 0;
const ok = (name, extra = "") => console.log(`ok ${++step}. ${name}${extra ? ` — ${extra}` : ""}`);
const record = (name, data) => {
  if (!recordAt) return;
  mkdirSync(recordAt, { recursive: true });
  writeFileSync(`${recordAt}/${name}.json`, JSON.stringify(data, null, 2) + "\n");
};

try {
  const list = await mess.listAccounts();
  record("list", list);
  ok(
    "listAccounts",
    `${list.count} rows, ${list.cancelled_hidden} cancelled hidden, ${list.ownerless_flags} ownerless flags`,
  );

  const logged = await mess.logAccount({
    name: "SmokeTest",
    instance_name: LABEL,
    notes: "created by client/smoke.mjs; cancelled at the end of the run",
    monthly_cost: 0,
  });
  record("log", logged);
  if (!logged.created) throw new Error("expected created: true on first log");
  ok("logAccount", `created, gaps: [${logged.gaps.join(", ")}]`);

  const relogged = await mess.logAccount({ name: "SmokeTest", instance_name: LABEL });
  record("relog", relogged);
  if (relogged.created) throw new Error("expected created: false on re-log");
  if (relogged.account.id !== logged.account.id) throw new Error("re-log produced a different row");
  ok("idempotent re-log", "created: false, same row id");

  const found = await mess.searchAccounts({ provider: "SmokeTest" });
  record("search", found);
  if (found.count !== 1) throw new Error(`expected 1 SmokeTest row, found ${found.count}`);
  ok("searchAccounts", "provider filter finds exactly the test row");

  const id = logged.account.id;
  const planned = await mess.updateAccount(id, { plan: "Free" });
  record("update", { account: planned });
  if (planned.plan_name !== "Free") throw new Error(`plan not set: ${planned.plan_name}`);
  ok("updateAccount", "plan set (returns as plan_name)");

  const cleared = await mess.updateAccount(id, { plan: null });
  record("update-clear", { account: cleared });
  if (cleared.plan_name !== null) throw new Error(`plan not cleared: ${cleared.plan_name}`);
  ok("null-to-clear", "plan_name back to null");

  await mess.updateAccount(id, { status: "cancelled" });
  const gone = await mess.searchAccounts({ provider: "SmokeTest" });
  const back = await mess.searchAccounts({ provider: "SmokeTest", include_cancelled: true });
  record("search-cancelled", back);
  if (gone.count !== 0) throw new Error("cancelled row still in default search");
  if (back.count < 1) throw new Error("cancelled row missing with include_cancelled");
  ok("cancel + default-search exclusion", "hidden by default, visible with include_cancelled");

  console.log("\nsmoke: all green (test row left cancelled)");
} catch (err) {
  if (err instanceof MessApiError) {
    console.error(`smoke failed at step ${step + 1}: HTTP ${err.status} — ${err.error}`);
  } else {
    console.error(`smoke failed at step ${step + 1}:`, err.message);
  }
  process.exit(1);
}

function keyFromDotEnv() {
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    return env.match(/^MESS_KEY=["']?(mess_sk_[^\s"']+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}
