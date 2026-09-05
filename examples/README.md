# Examples

Three scripts against the REST surface, using [`@mess.fyi/client`](../client/).
Each wants `MESS_KEY` in the environment (an agent key from
mess.fyi → Settings → Agent keys) and nothing else.

```bash
cd examples && npm install
MESS_KEY=mess_sk_YOUR_KEY node morning-orientation.mjs my-project
```

| script | what it does |
|---|---|
| [`ci-check.mjs`](ci-check.mjs) | Fail the pipeline when the checkout touches providers the ledger has no row for — env var *names* and package deps matched against provider fingerprints, then checked against the ledger. The write-moment nudge's trick, run against files in CI. |
| [`export-backup.mjs`](export-backup.mjs) | The whole ledger (cancelled rows included) to JSON + deterministic markdown. Same ledger, same bytes — day-over-day diffs show real changes only. |
| [`morning-orientation.mjs`](morning-orientation.mjs) | What does this project run on, who owns each piece, what's still an open question. The orientation call, from a shell instead of an agent. |

In CI, `MESS_KEY` goes in your secret store, e.g.:

```yaml
- run: node examples/ci-check.mjs my-project
  env:
    MESS_KEY: ${{ secrets.MESS_KEY }}
```
