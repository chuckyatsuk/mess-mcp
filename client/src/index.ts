/**
 * A small typed client for the MESS REST surface (`/api/v1/accounts`).
 *
 * The whole client is this one file, on purpose — you can read everything
 * it does in one sitting. Zero dependencies; global fetch (Node >= 18,
 * or any edge runtime).
 *
 * Field names match the wire exactly — what you see here is what travels.
 * Every shape below is pinned against the live API, not guessed: the one
 * naming wrinkle is that you *send* `plan` and rows come back with
 * `plan_name`, which this client preserves rather than papers over.
 */

export type Role =
  | "database"
  | "auth"
  | "email"
  | "hosting"
  | "dns"
  | "payments"
  | "storage"
  | "cache"
  | "monitoring"
  | "analytics"
  | "cdn"
  | "queue"
  | "search"
  | "other";

export type Ownership = "owned" | "client" | "employer" | "shared";

export type Status = "active" | "paused" | "cancelled" | "trial";

/** One ledger row: an account — a login at a provider. */
export interface Account {
  id: string;
  /** Provider / product name, e.g. "Supabase". */
  name: string;
  /** The human label that tells this account apart. */
  instance_name: string;
  role: Role;
  ownership: Ownership;
  status: Status;
  /** Bare email address that owns the account — null is an honest gap. */
  account_email: string | null;
  plan_name: string | null;
  /** Monthly cost in USD; 0 means free; null means unknown. */
  monthly_cost: number | null;
  /** Comma-separated project labels this account serves, or null. */
  project: string | null;
  login_url: string | null;
  /** Provider-side id: project ref, team slug, account id. */
  account_identifier: string | null;
  /** Where the secrets live — never the secrets themselves. */
  credentials_location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** How and by whom this row was last kept current (e.g. "rest", "mcp"). */
  last_kept_via: string | null;
  last_kept_by: string | null;
  last_confirmed_at: string | null;
}

/** Search responses: the rows plus how many matched. */
export interface SearchResult {
  accounts: Account[];
  count: number;
}

/** The full-ledger response carries the ledger's own health metadata. */
export interface AccountList extends SearchResult {
  /** Cancelled rows hidden from this listing. */
  cancelled_hidden: number;
  /** Rows flagged as having no recorded owner. */
  ownerless_flags: number;
  ownerless_note: string | null;
}

/**
 * What a write reports back: the row, whether it was created (false means
 * the idempotent re-log updated an existing row), and which fields the
 * ledger still considers open questions — gaps are a feature, not an error.
 */
export interface LogResult {
  created: boolean;
  account: Account;
  gaps: string[];
  gaps_note: string | null;
}

/** Input for logAccount. Idempotent on name + instance_name. */
export interface LogAccountInput {
  name: string;
  instance_name: string;
  account_email?: string;
  account_identifier?: string;
  credentials_location?: string;
  login_url?: string;
  monthly_cost?: number;
  notes?: string;
  ownership?: Ownership;
  /** Sent as `plan`; rows echo it back as `plan_name`. */
  plan?: string;
  /** Comma-separated labels; merged into the row's list on re-log. */
  project?: string;
  role?: Role;
}

/**
 * Patch for updateAccount. `null` on a nullable field CLEARS it — a wrong
 * value is worse than a blank; clearing shows the honest gap.
 *
 * `project` ADDs labels, `project_remove` takes labels away; only `null`
 * clears the whole list. There is no delete anywhere in this API (the
 * server answers DELETE with 405) — the closest thing is
 * `status: "cancelled"`, which keeps the history.
 */
export interface UpdateAccountPatch {
  name?: string;
  instance_name?: string;
  account_email?: string | null;
  account_identifier?: string | null;
  credentials_location?: string | null;
  login_url?: string | null;
  monthly_cost?: number | null;
  notes?: string | null;
  ownership?: Ownership;
  plan?: string | null;
  project?: string | null;
  project_remove?: string;
  role?: Role;
  status?: Status;
}

export interface ListOptions {
  /** Also return rows marked cancelled. Default false. */
  include_cancelled?: boolean;
}

export interface SearchOptions extends ListOptions {
  /** Free text matched across project, provider, label, email, plan, … */
  query?: string;
  /** Exact provider name filter, e.g. "Supabase". */
  provider?: string;
}

/** The server's error shape is `{"error": "…"}`; this carries it plus the HTTP status. */
export class MessApiError extends Error {
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string) {
    super(`MESS API ${status}: ${error}`);
    this.name = "MessApiError";
    this.status = status;
    this.error = error;
  }
}

export interface MessClientOptions {
  /** An agent key (`mess_sk_…`). Required — the client never reads env itself. */
  key: string;
  /** Default https://mess.fyi — override for testing. */
  baseUrl?: string;
  /** Injectable transport, so tests can run against fixtures with no network. */
  fetch?: typeof fetch;
}

export class MessClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MessClientOptions) {
    if (!options.key) throw new Error("MessClient: key is required");
    this.key = options.key;
    this.baseUrl = (options.baseUrl ?? "https://mess.fyi").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** The whole ledger for this workspace, with its health metadata. */
  listAccounts(options: ListOptions = {}): Promise<AccountList> {
    return this.request("GET", "/api/v1/accounts", { query: flag(options) });
  }

  /** Find accounts — the orientation call when picking a project back up. */
  searchAccounts(options: SearchOptions): Promise<SearchResult> {
    return this.request("GET", "/api/v1/accounts", {
      query: {
        ...(options.query !== undefined && { query: options.query }),
        ...(options.provider !== undefined && { provider: options.provider }),
        ...flag(options),
      },
    });
  }

  /**
   * Log an account. Idempotent on name + instance_name: re-logging the same
   * account updates the row instead of duplicating it (`created: false`),
   * and `project` labels merge into the existing list.
   */
  logAccount(input: LogAccountInput): Promise<LogResult> {
    return this.request("POST", "/api/v1/accounts", { body: input });
  }

  /** Correct a row by id. See UpdateAccountPatch for null-to-clear semantics. */
  async updateAccount(id: string, patch: UpdateAccountPatch): Promise<Account> {
    const result = await this.request<{ account: Account }>(
      "PATCH",
      `/api/v1/accounts/${encodeURIComponent(id)}`,
      { body: patch },
    );
    return result.account;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      url.searchParams.set(k, v);
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        ...(options.body !== undefined && { "content-type": "application/json" }),
      },
      // JSON.stringify keeps explicit nulls (clear-the-field) and drops
      // undefined keys — exactly the patch semantics we want on the wire.
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      throw new MessApiError(response.status, text.slice(0, 200));
    }

    if (!response.ok) {
      const message =
        json && typeof json === "object" && "error" in json
          ? String((json as { error: unknown }).error)
          : response.statusText;
      throw new MessApiError(response.status, message);
    }

    return json as T;
  }
}

function flag(options: ListOptions): Record<string, string> {
  return options.include_cancelled ? { include_cancelled: "true" } : {};
}
