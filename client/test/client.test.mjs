// Offline tests: the client against fixtures via an injected fetch. No
// network, no key. Fixture shapes are pinned against live API responses;
// the rows themselves are synthetic — no real ledger data lands in this
// repo. The error fixture is recorded verbatim (unauthenticated response).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MessClient, MessApiError } from "../dist/index.js";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// A fetch stub that records the request and replies with a canned response.
function stubFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, calls };
}

const client = (impl) =>
  new MessClient({ key: "mess_sk_YOUR_KEY", fetch: impl, baseUrl: "https://mess.test/" });

test("constructor requires a key", () => {
  assert.throws(() => new MessClient({ key: "" }), /key is required/);
});

test("listAccounts: GET /api/v1/accounts with bearer auth; envelope passed through", async () => {
  const { impl, calls } = stubFetch(fixture("accounts-list.json"));
  const list = await client(impl).listAccounts();

  assert.equal(list.count, 2);
  assert.equal(list.accounts[0].name, "Supabase");
  assert.equal(list.cancelled_hidden, 1);
  assert.equal(list.ownerless_flags, 1);
  const { url, init } = calls[0];
  assert.equal(init.method, "GET");
  assert.equal(url.href, "https://mess.test/api/v1/accounts"); // trailing slash trimmed
  assert.equal(init.headers.authorization, "Bearer mess_sk_YOUR_KEY");
});

test("searchAccounts: query params, include_cancelled only when set", async () => {
  const { impl, calls } = stubFetch(fixture("accounts-list.json"));
  const c = client(impl);

  await c.searchAccounts({ query: "acme", provider: "Supabase" });
  assert.equal(calls[0].url.searchParams.get("query"), "acme");
  assert.equal(calls[0].url.searchParams.get("provider"), "Supabase");
  assert.equal(calls[0].url.searchParams.get("include_cancelled"), null);

  await c.searchAccounts({ query: "acme", include_cancelled: true });
  assert.equal(calls[1].url.searchParams.get("include_cancelled"), "true");
});

test("logAccount: POST with JSON body; created flag and gaps surface", async () => {
  const { impl, calls } = stubFetch(fixture("log-created.json"));
  const result = await client(impl).logAccount({
    name: "Resend",
    instance_name: "Acme transactional email",
  });

  const { init } = calls[0];
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), {
    name: "Resend",
    instance_name: "Acme transactional email",
  });
  assert.equal(result.created, true);
  assert.deepEqual(result.gaps, ["account_email", "credentials_location"]);
  assert.equal(result.account.plan_name, null);
});

test("updateAccount: PATCH to the row; null survives to the wire, undefined does not", async () => {
  const account = JSON.parse(fixture("accounts-list.json")).accounts[0];
  const { impl, calls } = stubFetch(JSON.stringify({ account }));
  const row = await client(impl).updateAccount("acc 01/x", {
    account_email: null,
    project: "new-label",
    project_remove: "old-label",
    plan: undefined,
  });

  const { url, init } = calls[0];
  assert.equal(init.method, "PATCH");
  assert.equal(url.pathname, "/api/v1/accounts/acc%2001%2Fx");
  assert.deepEqual(JSON.parse(init.body), {
    account_email: null, // null-to-clear reaches the server
    project: "new-label",
    project_remove: "old-label",
    // plan: undefined dropped — absent means untouched
  });
  assert.equal(row.id, account.id); // {account} envelope unwrapped
});

test("errors: non-ok responses throw MessApiError with the server's message", async () => {
  const { impl } = stubFetch(fixture("error-401.json"), { status: 401 });
  await assert.rejects(
    () => client(impl).listAccounts(),
    (err) => {
      assert.ok(err instanceof MessApiError);
      assert.equal(err.status, 401);
      assert.match(err.error, /Missing or invalid API key/);
      return true;
    },
  );
});

test("errors: non-JSON body still surfaces status", async () => {
  const { impl } = stubFetch("<html>bad gateway</html>", { status: 502 });
  await assert.rejects(
    () => client(impl).listAccounts(),
    (err) => err instanceof MessApiError && err.status === 502,
  );
});
