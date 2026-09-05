# Architecture

How MESS is put together as a remote MCP server, and why it is shaped the
way it is. The server's source is not public; everything below is either
published (the [handshake disclosure](https://mess.fyi/mcp), the
[docs](https://mess.fyi/docs)), observable from the client side (this
repo's client and smoke tests exercise the live API), or an explanation
the owner has reviewed. Where a detail would cross into the closed
implementation, this document says so instead of pretending.

## The shape of the thing

MESS is one hosted service with two front doors sharing one auth model
and one ledger:

- **MCP** at `https://mess.fyi/api/mcp` — streamable HTTP, for coding
  agents. Eight tools, one prompt. Listed in the MCP registry as
  [`fyi.mess/mess`](https://registry.modelcontextprotocol.io/v0/servers?search=fyi.mess),
  manifest at
  [`/.well-known/mcp.json`](https://mess.fyi/.well-known/mcp.json).
- **REST** at `https://mess.fyi/api/v1/accounts` — the same ledger and the
  same bearer keys, for scripts and CI, where an MCP session would be
  overhead. The typed client in [`client/`](client/) covers this surface.

The division of labor is deliberate: agents write the ledger over MCP as
a side effect of normal work; humans read it on the web app; scripts and
pipelines get REST. Nothing on any surface accepts a secret value —
that boundary is a design decision, covered last.

## Transport: streamable HTTP, and why

The server speaks MCP's streamable HTTP transport — plain HTTPS requests
to one endpoint, authenticated per-request with a bearer header.

For this product the alternatives lose on distribution. A stdio server is
a *local install* — a binary or npm package per machine, per client, with
versions drifting across them. MESS's entire pitch is that the ledger
outlives any one machine; the server holding it should too. Remote HTTP
means wiring it in is one paste (the `claude mcp add` line in the
README), every client gets the same server version, and a key revoked at
[mess.fyi/settings/api](https://mess.fyi/settings/api) is dead everywhere
at once. Statelessness per request also matches the workload: short
tool calls against a database, no session affinity worth preserving.
[OWNER? — happy to state whether the transport layer holds any session
state at all, if you're willing to say.]

## The handshake is the product

MCP servers send `instructions` with the initialize handshake. Most
treat that field as a formality. MESS treats it as the whole mechanism:
the instructions are what make agents log accounts *unprompted* — no
per-session reminders, no custom system prompts to install.

Two engineering consequences follow:

1. **A context budget.** Clients truncate long handshakes, so every
   instruction variant is budgeted to fit an agent's context whole. The
   15-paragraph dig procedure ships separately as an MCP *prompt*
   (`sort_out_my_mess`) that the agent fetches in full only when the
   human asks for it. Instructions push behavior; prompts carry
   procedures. The server picks the variant — an empty ledger gets the
   onboarding variant that offers the dig and never runs it without a
   yes.
2. **Disclosure as an obligation.** If instructions steer agents, the
   human deserves to read them. Every variant is published verbatim at
   [mess.fyi/mcp](https://mess.fyi/mcp) and mirrored in
   [`disclosure/`](disclosure/) with a drift check, so "published
   verbatim" is auditable, with history.

## Keys and scoping

Auth is a bearer agent key (`mess_sk_…`) per user, passed as an
`Authorization` header on both surfaces. Keys are stored hashed,
revocable any time, and writes are rate-limited per key. A key resolves
to a workspace, and every read and write is scoped to it: the key *is*
the tenancy boundary, there is no cross-workspace query surface.
[OWNER? — is per-user-per-workspace the right way to describe key→
workspace resolution on Team plans, or is a key per member per shared
ledger? Happy to state it precisely if you'll confirm the model.]

Unauthenticated requests get one deliberately instructive error —
`{"error": "Missing or invalid API key. Pass it as: Authorization:
Bearer mess_sk_..."}` — because the caller is usually an agent that can
fix its own configuration if told how.

## Idempotent writes

`log_account` is idempotent on **provider + label** (`name` +
`instance_name`): re-logging updates the row instead of duplicating it,
and the REST response says which happened (`created: true | false`).
The `project` field merges on write — labels are added to the row's
list, never overwritten — because an account often serves projects the
current session cannot see.

This is the load-bearing design decision for an agent-written ledger.
Agents cannot reliably remember whether they already logged something,
and the same account surfaces on many machines in many sessions. Making
the write idempotent means the correct agent behavior is also the
simplest one: *log what you see, every time you see it*. Re-runs refresh
rows instead of corrupting the ledger, which is also why the dig
procedure can tell users to re-run it every few weeks.

The failure asymmetry drives the merge rules: a wrong split is a
mergeable duplicate the human can cancel; a wrong merge *hides an
account*, which is the exact failure MESS exists to prevent. So
consolidation requires a confirmed shared login, and unconfirmed
boundaries get one row per instance, flagged in notes.

## No delete

There is no delete anywhere in the API. Not "discouraged" — absent. The
MCP surface has no delete tool, and the REST surface answers `DELETE`
with `405`. A dead or duplicate row gets `status: "cancelled"`, which
drops it from default reads (responses report `cancelled_hidden` so the
hiding itself is visible) while keeping the row.

An inventory's history is evidence: *we had a Stripe account, who
cancelled it, when?* is exactly the question a ledger should answer.
Related: corrections prefer clearing to guessing — updates accept
explicit `null` to blank a wrongly-recorded field, because a wrong value
reads as an answer while a blank reads as the open question it is.

## What the server refuses to infer

Two facts are structurally unknowable from an agent session, and the API
is designed so they can only enter the ledger as a human's answer:

- **Project boundaries.** A session sees a directory basename. Whether
  `acme-web` and `acme-admin` are one project lives in the human's head,
  and name similarity does not recover it. So groupings are recorded
  only via `confirm_project_alias` — from the human's answer, never
  inferred — and rows keep their original labels; *reads* resolve
  aliases, nothing is rewritten.
- **Access breadth.** From a session you can prove a key works; you can
  never see who else holds one. So `record_access` writes only what the
  human states, and an empty `list_access` means *nothing recorded* —
  never "nobody else has access."

The pattern generalizes: every observable fact is agent-writable,
every unobservable fact requires the human, and absence of a record is
surfaced as an open question rather than defaulted. The write responses
carry this — `gaps` on a log, `ownerless_flags` on a listing — so an
open question is API output, not something a client has to derive.

## The metadata boundary as a security decision

There is no field for a secret value. That is a schema decision, not a
policy one — the ledger *cannot* hold credentials, so no bug, breach, or
over-eager agent can put them there. The row stores *where* credentials
live (`credentials_location: "1Password vault Acme"`), which is the fact
a human needs and the one worth reading aloud in a stand-up.

The same boundary is enforced on the client side of every flow:

- The dig instructs agents to read env var **names** only (`cut -d=
  -f1`), so secret values never even enter the agent's context during
  discovery.
- The write-moment nudge hook matches provider CLIs *on your machine*
  and sends two strings: the matched provider name and the repo folder
  name. Never the command. The hook is seven lines of shell in
  [`hooks/write-nudge.json`](hooks/write-nudge.json); verify that claim
  by reading it.

The threat model this buys: a compromised MESS account leaks a map of
what exists — real metadata, worth protecting, which is why keys are
hashed and revocable — but no credential to any of it. The map and the
vault fail separately.

## What stays closed

The web app, the check engine (the watch: RDAP domain expiry, URL
liveness, free-tier pause detection), storage, and the instruction-
serving logic are the hosted service. This repo is the client half:
everything that runs on your machine or in your pipeline, plus this
description. Where the two halves meet — the handshake, the API
surfaces — is published and mirrored here, which is the part you have
to trust to wire an agent into anything.
