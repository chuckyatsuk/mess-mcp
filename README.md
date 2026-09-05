# MESS — the ledger your agents keep

**[mess.fyi](https://mess.fyi)** · remote MCP server · `https://mess.fyi/api/mcp`

MESS is a searchable ledger of your service accounts — which Supabase,
which Stripe, which email owns it, which project it belongs to, what it
costs — kept current by your coding agents. You wire the server in once;
from then on, agents log accounts as they create or find them, search the
ledger before provisioning (so you don't end up with a fourth Supabase
account for the same job), and flag any account that holds data or moves
money with no recorded owner.

**The map, not the vault:** MESS stores metadata only. There is no field
for a secret value, on purpose. Discovery reads env var *names* and CLI
auth state — secret values never move.

## What's in this repo

The server is a hosted service and stays closed. Everything client-side
lives here, inspectable:

| | |
|---|---|
| [`hooks/`](hooks/) | The optional Claude Code hooks the app serves, as versioned files. |
| [`disclosure/`](disclosure/) | The [mess.fyi/mcp](https://mess.fyi/mcp) handshake texts, mirrored verbatim — with a sync script that proves it. |
| [`client/`](client/) | A typed, zero-dependency TypeScript client for the REST surface. One file; read it in a sitting. |
| [`examples/`](examples/) | A CI gate for unlogged providers, a ledger backup, a morning orientation script. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How a production remote MCP server is put together, and why this one is shaped the way it is. |

## Setup

Grab a free key at [mess.fyi](https://mess.fyi) (Settings → Agent keys), then:

**Claude Code**

```bash
claude mcp add --transport http --scope user mess https://mess.fyi/api/mcp \
  --header "Authorization: Bearer mess_sk_YOUR_KEY"
```

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mess": {
      "url": "https://mess.fyi/api/mcp",
      "headers": { "Authorization": "Bearer mess_sk_YOUR_KEY" }
    }
  }
}
```

Any other MCP client that speaks streamable HTTP works the same way.
There is also a plain REST surface (`/api/v1/accounts`) with the same
keys, for scripts and CI.

## The surface

Seven tools, one prompt:

| | |
|---|---|
| `log_account` | Log an account the moment it's created — provider, label, owning email, project, cost, where the credentials live. Idempotent. |
| `search_accounts` | Find accounts by project, provider, email, plan — the orientation call when picking a project back up. |
| `list_accounts` | The whole ledger in one call. |
| `update_account` | Correct a row, record an owner, mark an account cancelled. There is no delete — history is kept. |
| `confirm_project_alias` | Record the human's answer that one project label belongs to another. Agents see a directory name, not a project; two checkouts of one repo look like two projects and a six-repo estate looks like six. Only ever from their answer — never guessed from similar names. |
| `record_access` | Who can still get into an account — a different question from who owns it, and the one that catches the contractor who left in March whose login still works. Team plan. |
| `list_access` | Read that back, per account or across the ledger. Team plan. |
| `sort_out_my_mess` (prompt) | The dig: a field-tested procedure that inventories the accounts this machine and your projects touch and backfills the ledger. In Claude Code: `/mcp__mess__sort_out_my_mess`. |

Two things an agent cannot work out for itself, and so never guesses:

- **Project boundaries.** From a session you see `${PWD##*/}` — a directory
  name. Whether two labels are one project lives in the human's head, and
  name similarity does not recover it (on the ledger this was built against,
  1 of 6 similar-looking clusters was a real match). So groupings come only
  from a confirmed answer, and rows keep their labels either way — reads
  resolve, nothing is rewritten.
- **Access breadth.** From inside a session you can prove a key works; you
  can never see who else holds one. So no records means *nothing recorded* —
  never "nobody else has access."

Optional Claude Code hooks (one paste, served from the app): a
session-start brief — every session opens knowing what the current
project runs on — and a write-moment nudge that speaks up when a session
touches a provider CLI. Only a provider name and repo folder name are
ever sent.

Both hooks also live here, versioned:
[`hooks/session-brief.json`](hooks/session-brief.json) and
[`hooks/write-nudge.json`](hooks/write-nudge.json) — the same JSON the
app serves, with `mess_sk_YOUR_KEY` where your key goes. The paste is
still the easy path; the repo copies are the inspectable one. Read what
runs on your machine before you install it, and when it changes, see the
change as a diff. To install from here, merge either file's `hooks`
block into `~/.claude/settings.json` and put your key in.

## Full disclosure

The handshake instructions the server sends your agent are published
verbatim at [mess.fyi/mcp](https://mess.fyi/mcp) — every variant, plus
the dig procedure and the hook nudges. If you'd rather your agent didn't
volunteer writes, don't wire it in.

That page is also mirrored in this repo, under
[`disclosure/`](disclosure/): every variant, the dig, the nudge, as
files. `npm run check-disclosure` fetches the live page and fails if the
mirror has drifted — so "published verbatim" isn't a claim you have to
take on trust, it's one with history.

Free to 20 accounts. Teams share one ledger (scoped digs, personal stays
personal) and add access breadth. Questions: hello@mess.fyi.

## License

This repository — the setup docs above — is MIT licensed. It is not the
server: MESS itself is a hosted service and its source is not public.
What the server sends your agent is, though, published verbatim at
[mess.fyi/mcp](https://mess.fyi/mcp).
