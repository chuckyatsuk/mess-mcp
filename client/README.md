# @mess.fyi/client

Typed, zero-dependency client for the [MESS](https://mess.fyi) REST API —
the ledger of your service accounts, kept current by your coding agents.
MESS stores which Supabase, which Stripe, which email owns it, which
project it serves, what it costs — metadata only, never secrets: the map,
not the vault.

The whole client is [one file](https://github.com/currentlycurrently/mess-mcp/blob/main/client/src/index.ts)
you can read in a sitting. Global `fetch` (Node ≥ 18, or any edge
runtime). Every type is pinned against the live API, not guessed.

```bash
npm install @mess.fyi/client
```

```ts
import { MessClient } from "@mess.fyi/client";

const mess = new MessClient({ key: process.env.MESS_KEY! });
// an agent key from mess.fyi → Settings → Agent keys

// What does this project run on?
const { accounts } = await mess.searchAccounts({ query: "acme-web" });

// Log an account the moment it exists. Idempotent on name + label:
// re-logging updates the row, never duplicates it.
const { created, account, gaps } = await mess.logAccount({
  name: "Supabase",
  instance_name: "Acme Corp production",
  project: "acme-web",
  account_email: "ops@example.com",
});

// Correct a row. null CLEARS a field — a wrong value is worse than a
// blank. There is no delete: status "cancelled" keeps the history.
await mess.updateAccount(account.id, { monthly_cost: 25 });
```

## Surface

Four methods over `https://mess.fyi/api/v1/accounts`, same bearer keys
as the [MCP server](https://mess.fyi/mcp):

| method | returns |
|---|---|
| `listAccounts()` | The whole ledger, plus its health: `count`, `cancelled_hidden`, `ownerless_flags`. |
| `searchAccounts({ query?, provider? })` | Matching rows and `count`. |
| `logAccount(input)` | `{ created, account, gaps }` — `gaps` are the fields the ledger still considers open questions. |
| `updateAccount(id, patch)` | The corrected row. `null` clears a field; `project` adds labels, `project_remove` removes them. |

The responses carry the product's opinions on purpose — open questions
(`gaps`, `ownerless_flags`) are API output, not something you derive.
Errors throw `MessApiError` with the HTTP status and the server's message.

## More

- [Repo](https://github.com/currentlycurrently/mess-mcp) — examples
  (a CI gate for unlogged providers, ledger backup, morning orientation),
  the served hooks, and the verbatim disclosure mirror.
- [ARCHITECTURE.md](https://github.com/currentlycurrently/mess-mcp/blob/main/ARCHITECTURE.md) —
  how the server is put together, from the outside.
- MESS never stores secret values. There is no field for one, on purpose.

MIT (this client — the [server](https://mess.fyi) is a hosted service).
