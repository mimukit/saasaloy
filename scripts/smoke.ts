// The shared helper for `modules/<name>/smoke.ts` (#187). A smoke script drives the
// playground's api over HTTP only, so one script runs on D1 and on Postgres, and it is
// never copied into a project. `scripts/play-smoke.ts` runs every installed module's
// script against a playground that `pnpm play:up` seeded.
//
// The helper signs a seeded user in, keeps the session cookie, and prints one PASS or
// FAIL line per check. Nothing here throws on a failed check: a script runs to its end,
// and the runner prints the total.

/** The password every seeded user signs in with (plan 0072, the auth seed slices). */
export const SEED_PASSWORD = "saasaloy-dev-password";

/**
 * The two auth surfaces. A client session (`/auth`, the customer app's origin) and an
 * admin session (`/admin/auth`, the admin app's origin) are separate cookies, and each
 * route accepts one of them.
 */
export type Surface = "admin" | "client";

const ORIGINS: Record<Surface, string> = {
  admin: "http://localhost:3001",
  client: "http://localhost:3002",
};
const AUTH_PATHS: Record<Surface, string> = {
  admin: "/admin/auth",
  client: "/auth",
};

export interface Reply {
  status: number;
  body: unknown;
}

/** The cookies of a `set-cookie` list, as name to value. */
export function readCookies(setCookies: string[]): Map<string, string> {
  const jar = new Map<string, string>();
  for (const line of setCookies) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    if (at > 0) {
      jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  return jar;
}

/** One caller: anonymous, or a signed-in user whose cookie rides on every request. */
export class Session {
  readonly api: string;
  readonly surface: Surface;
  private readonly jar = new Map<string, string>();

  constructor(api: string, surface: Surface) {
    this.api = api;
    this.surface = surface;
  }

  async request(
    path: string,
    init: {
      method?: string;
      json?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<Reply> {
    const headers: Record<string, string> = {
      origin: ORIGINS[this.surface],
      ...init.headers,
    };
    if (this.jar.size > 0) {
      headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(`${this.api}${path}`, {
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      headers,
      method: init.method ?? (init.json === undefined ? "GET" : "POST"),
    });
    for (const [name, value] of readCookies(response.headers.getSetCookie())) {
      this.jar.set(name, value);
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; keep the text.
    }
    return { body, status: response.status };
  }

  /** Sign in with email and the seed password on this session's surface. */
  async signIn(email: string, password = SEED_PASSWORD): Promise<Reply> {
    return this.request(`${AUTH_PATHS[this.surface]}/sign-in/email`, {
      json: { email, password },
    });
  }
}

/** A dotted path into a JSON body, or undefined where the path is absent. */
export function pick(body: unknown, path: string): unknown {
  let value = body;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export class Smoke {
  readonly api: string;
  passed = 0;
  failed = 0;

  constructor(api: string) {
    this.api = api;
  }

  check(name: string, ok: boolean, detail = ""): void {
    if (ok) {
      this.passed++;
      console.log(`PASS  ${name}`);
    } else {
      this.failed++;
      console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
    }
  }

  equal(name: string, expected: unknown, actual: unknown): void {
    this.check(
      name,
      Object.is(expected, actual),
      `expected [${String(expected)}] got [${String(actual)}]`
    );
  }

  anon(surface: Surface = "client"): Session {
    return new Session(this.api, surface);
  }

  /** A session signed in as a seeded user, with a check that the sign-in worked. */
  async as(surface: Surface, email: string): Promise<Session> {
    const session = new Session(this.api, surface);
    const reply = await session.signIn(email);
    this.equal(`${email} signs in (${surface})`, 200, reply.status);
    return session;
  }
}

/** What a `modules/<name>/smoke.ts` exports as its default. */
export type SmokeScript = (smoke: Smoke) => Promise<void>;
