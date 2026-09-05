#!/usr/bin/env node
// Mirror the published handshake disclosure at https://mess.fyi/mcp into disclosure/.
//
// The page publishes, verbatim, everything the MESS server sends an agent:
// the handshake instruction variants, the "sort out my mess" dig procedure,
// and the write-moment nudge (example line + the hook itself). This script
// pulls those exact texts out of the live page and writes them to files, so
// the mirror is verifiably current and every change to what the server says
// lands as a git diff.
//
//   node scripts/sync-disclosure.mjs           # rewrite disclosure/ from the live page
//   node scripts/sync-disclosure.mjs --check   # exit 1 if the mirror has drifted
//
// No key, no auth — the source page is public.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = "https://mess.fyi/mcp";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "disclosure");
const check = process.argv.includes("--check");

const html = await (await fetch(PAGE)).text();

// The page is a Next.js app; the full texts (including the collapsed
// "show the full prompt" blocks) live in the React Server Components
// payload, streamed as self.__next_f.push([1,"..."]) segments. Reassemble
// the stream, then cut it up.
let stream = "";
for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
  stream += JSON.parse(m[1]);
}
if (!stream) fail(`no RSC payload found at ${PAGE} — page structure changed?`);

// Long texts are T-chunks: `<id>:T<byte-length-hex>,` followed by that many
// UTF-8 bytes of raw text.
const streamBuf = Buffer.from(stream, "utf8");
const chunks = [];
for (const m of stream.matchAll(/[0-9a-f]+:T([0-9a-f]+),/g)) {
  const start = Buffer.byteLength(stream.slice(0, m.index + m[0].length), "utf8");
  chunks.push(streamBuf.subarray(start, start + parseInt(m[1], 16)).toString("utf8"));
}

// Short blocks (the nudge example, the hook JSON) are inline code props.
function codeBlock(titlePrefix) {
  const re = /"title":"((?:[^"\\]|\\.)*)","code":"((?:[^"\\]|\\.)*)"/g;
  for (const m of stream.matchAll(re)) {
    if (JSON.parse(`"${m[1]}"`).startsWith(titlePrefix)) return JSON.parse(`"${m[2]}"`);
  }
  fail(`code block titled "${titlePrefix}…" not found — page structure changed?`);
}

function textChunk(marker, label) {
  const hit = chunks.filter((c) => c.includes(marker));
  if (hit.length !== 1) fail(`expected exactly one chunk for ${label}, found ${hit.length}`);
  return hit[0];
}

const files = {
  "every-session.txt": textChunk("start or resume work on a project", "the every-session instructions"),
  "first-connect.txt": textChunk("Do not start until they say yes", "the first-connect variant"),
  "sort-out-my-mess.txt": textChunk("Sort out my mess:", "the dig procedure"),
  "write-nudge-example.txt": codeBlock("Example — exactly what the agent hears"),
  "write-nudge-hook.json": codeBlock("The hook itself"),
};

let drifted = [];
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(outDir, name);
  const body = content.endsWith("\n") ? content : content + "\n";
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === body) continue;
  if (check) drifted.push(name);
  else {
    writeFileSync(path, body);
    console.log(`wrote disclosure/${name}`);
  }
}

// The installable copy in hooks/ must stay byte-identical to the published
// hook (placeholder key and all) — that equality is the point of the mirror.
const published = files["write-nudge-hook.json"] + "\n";
const installable = join(root, "hooks", "write-nudge.json");
if (existsSync(installable) && readFileSync(installable, "utf8") !== published) {
  drifted.push("hooks/write-nudge.json (out of step with the published hook)");
}

if (check) {
  if (drifted.length) fail(`mirror has drifted from ${PAGE}:\n  ` + drifted.join("\n  "));
  console.log(`disclosure/ matches ${PAGE}`);
} else if (!process.exitCode) {
  console.log("disclosure/ is current");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
