#!/usr/bin/env node
// CI gate: fail the pipeline when this project touches providers the
// ledger doesn't know about.
//
//   MESS_KEY=mess_sk_... node ci-check.mjs [project-name]
//
// Detection is deliberately the same trick as the write-moment nudge, run
// against files instead of commands: read env var NAMES from .env* files
// (never values — the map, not the vault) plus dependency names from
// package.json, match them against known provider fingerprints, then ask
// the ledger whether each matched provider is on record for this project.
// Exit 1 with a list of unlogged providers; exit 0 clean.
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { MessClient } from "@mess.fyi/client";

// provider -> fingerprints matched against env var names and package deps
const FINGERPRINTS = {
  Vercel: ["VERCEL", "vercel"],
  Supabase: ["SUPABASE", "@supabase/"],
  Stripe: ["STRIPE", "stripe"],
  Cloudflare: ["CLOUDFLARE", "CF_ACCOUNT", "wrangler"],
  "Fly.io": ["FLY_", "flyctl"],
  Netlify: ["NETLIFY", "netlify-cli"],
  Railway: ["RAILWAY"],
  Neon: ["NEON_", "@neondatabase/"],
  Turso: ["TURSO", "@libsql/"],
  Upstash: ["UPSTASH", "@upstash/"],
  DigitalOcean: ["DIGITALOCEAN", "DO_API"],
  Heroku: ["HEROKU"],
  Resend: ["RESEND", "resend"],
  PlanetScale: ["PLANETSCALE", "PSCALE", "@planetscale/"],
};

const key = process.env.MESS_KEY;
if (!key) {
  console.error("MESS_KEY not set — add it as a CI secret.");
  process.exit(1);
}
const project = process.argv[2] ?? basename(process.cwd());

// 1. What does this checkout touch? Env var NAMES only.
const names = new Set();
for (const file of readdirSync(".").filter((f) => f.startsWith(".env"))) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const name = line.match(/^\s*(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=/)?.[1];
    if (name) names.add(name);
  }
}
let deps = {};
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  deps = { ...pkg.dependencies, ...pkg.devDependencies };
} catch {}

const touched = Object.entries(FINGERPRINTS)
  .filter(([, prints]) =>
    prints.some(
      (p) =>
        [...names].some((n) => n.startsWith(p)) ||
        Object.keys(deps).some((d) => (p.endsWith("/") ? d.startsWith(p) : d === p)),
    ),
  )
  .map(([provider]) => provider);

if (touched.length === 0) {
  console.log(`ci-check: no known provider fingerprints in "${project}" — nothing to verify.`);
  process.exit(0);
}

// 2. Does the ledger know each one, for this project?
const mess = new MessClient({ key });
const unlogged = [];
for (const provider of touched) {
  const { accounts } = await mess.searchAccounts({ provider });
  const serving = accounts.some((a) =>
    (a.project ?? "").split(",").some((label) => label.trim() === project),
  );
  if (!serving) unlogged.push(provider);
}

if (unlogged.length === 0) {
  console.log(`ci-check: all ${touched.length} detected providers are on the ledger for "${project}".`);
  process.exit(0);
}

console.error(`ci-check: "${project}" touches providers the ledger has no row for:`);
for (const provider of unlogged) console.error(`  - ${provider}`);
console.error(
  "\nEither an account exists and isn't logged (log it — an agent session" +
    " with MESS wired in will do it from the provider CLI), or the ledger" +
    " row doesn't list this project (update_account merges labels).",
);
process.exit(1);
