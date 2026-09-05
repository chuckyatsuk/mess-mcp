# Disclosure mirror

Everything the MESS server sends an agent is published verbatim at
[mess.fyi/mcp](https://mess.fyi/mcp). This directory mirrors that page's
payload texts into git, so "published verbatim" comes with history: any
change to what the server tells your agent lands here as a diff you can
read, blame, and date.

| file | what it is |
|---|---|
| `every-session.txt` | The keeping instructions — what arrives with the MCP handshake in every session. |
| `first-connect.txt` | The onboarding variant served on first connect to an empty ledger — it offers the dig, and never runs it without your say-so. |
| `sort-out-my-mess.txt` | The dig itself, served whole as an MCP prompt (`/mcp__mess__sort_out_my_mess` in Claude Code). |
| `write-nudge-example.txt` | Exactly what the agent hears from the write-moment nudge, composed by the same code that serves it. |
| `write-nudge-hook.json` | The nudge hook that runs on your machine, verbatim — identical to the installable copy in [`../hooks/`](../hooks/). |

## Verifying the mirror

```bash
npm run sync-disclosure         # rewrite this directory from the live page
npm run check-disclosure        # exit 1 if the mirror has drifted
```

The sync script ([`../scripts/sync-disclosure.mjs`](../scripts/sync-disclosure.mjs))
fetches the public page and extracts the exact published texts — no key, no
auth, nothing you can't run yourself. A clean `check-disclosure` means the
files here are byte-identical to what mess.fyi/mcp publishes right now.
