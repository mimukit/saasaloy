import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditFetch } from "./agent-audit.ts";
import {
  auditApi,
  auditWeb,
  parseAuditArgs,
  parseMcpBody,
  resolveTargets,
  runAudit,
} from "./agent-audit.ts";

const SITE = "http://localhost:3000";
const API = "http://localhost:4000";
const KEY = "key-secret-value";

const LLMS = `# Acme

> Acme keeps the books.

## Pages

- [Home](${SITE}/index.md)
- [Privacy Policy](${SITE}/privacy.md)

## API for agents

- [MCP server](${API}/mcp): Streamable HTTP.

## Optional

- [Full text](${SITE}/llms-full.txt)
`;

const HOME = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"}]}</script></head></html>`;

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "Acme", version: "1.0.0" },
  paths: {
    "/notes": {
      get: { operationId: "notes_list" },
      post: { operationId: "notes_create" },
    },
  },
};

const TOOLS = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    tools: [
      {
        name: "notes_list",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
        _meta: { "saasaloy/scope": "notes:read" },
      },
      { name: "notes_create", inputSchema: { type: "object" } },
    ],
  },
};

type Route = (init: RequestInit | undefined) => Response;

function text(body: string, type: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": type } });
}

function json(
  body: unknown,
  status = 200,
  type = "application/json"
): Response {
  return text(JSON.stringify(body), type, status);
}

function authHeader(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get("authorization");
}

/** The JSON-RPC method a request to `/mcp` names. */
function rpcMethod(init: RequestInit | undefined): string | undefined {
  if (typeof init?.body !== "string") {
    return undefined;
  }
  const message: unknown = JSON.parse(init.body);
  return typeof message === "object" &&
    message !== null &&
    "method" in message &&
    typeof message.method === "string"
    ? message.method
    : undefined;
}

/**
 * The api's `/mcp`: 401 with no key, a tool list for the audit key, and a tool call that
 * the route's gate answers, `unauthorized` for a key `accepts` refuses.
 */
function mcp(
  init: RequestInit | undefined,
  accepts: (key: string) => boolean
): Response {
  const key = authHeader(init);
  if (key === null) {
    return json({ error: { code: "unauthorized", message: "A key" } }, 401);
  }
  if (rpcMethod(init) === "tools/list") {
    return accepts(key)
      ? text(
          `event: message\ndata: ${JSON.stringify(TOOLS)}\n\n`,
          "text/event-stream"
        )
      : json({ error: { code: "unauthorized", message: "A key" } }, 401);
  }
  const result = accepts(key)
    ? { isError: false, structuredContent: { notes: [] } }
    : {
        isError: true,
        structuredContent: { error: { code: "unauthorized", message: "no" } },
      };
  return json({ jsonrpc: "2.0", id: 1, result });
}

/** A full product: the web files, and the api with `agent`. */
function product(): Map<string, Route> {
  return new Map<string, Route>([
    [`${SITE}/llms.txt`, () => text(LLMS, "text/plain; charset=utf-8")],
    [
      `${SITE}/llms-full.txt`,
      () => text("# Acme\n\n> Acme keeps the books.\n", "text/plain"),
    ],
    [`${SITE}/index.md`, () => text("# Ledgers\n", "text/markdown")],
    [`${SITE}/privacy.md`, () => text("# Privacy Policy\n", "text/markdown")],
    [`${SITE}/`, () => text(HOME, "text/html")],
    [
      `${SITE}/robots.txt`,
      () => text("User-agent: *\nAllow: /\n", "text/plain"),
    ],
    [`${API}/openapi.json`, () => json(OPENAPI)],
    [
      `${API}/llms.txt`,
      () => text(`# Acme api\n\n- [MCP](${API}/mcp)\n`, "text/plain"),
    ],
    [
      `${API}/mcp/server-card`,
      () =>
        json(
          { remotes: [{ url: `${API}/mcp` }] },
          200,
          "application/mcp-server-card+json"
        ),
    ],
    [`${API}/mcp`, (init) => mcp(init, (key) => key === `Bearer ${KEY}`)],
  ]);
}

function fetchFrom(routes: Map<string, Route>): AuditFetch {
  return async (url, init) => {
    const route = routes.get(url);
    if (route === undefined) {
      return text("Not found", "text/html", 404);
    }
    return await Promise.resolve(route(init));
  };
}

function byId(checks: { id: string; status: string }[]) {
  return Object.fromEntries(checks.map((check) => [check.id, check.status]));
}

describe(parseAuditArgs, () => {
  it("reads the flags, and skips a forwarded --", () => {
    expect(
      parseAuditArgs([
        "--",
        "--site",
        SITE,
        "--api",
        API,
        "--require-key",
        "--json",
      ])
    ).toStrictEqual({ site: SITE, api: API, requireKey: true, json: true });
  });

  it("defaults the switches off", () => {
    expect(parseAuditArgs([])).toStrictEqual({
      requireKey: false,
      json: false,
    });
  });

  it("refuses an unknown flag and a flag with no value", () => {
    expect(() => parseAuditArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseAuditArgs(["--site"])).toThrow(/needs a value/);
  });
});

describe(parseMcpBody, () => {
  it("reads a JSON body", () => {
    expect(
      parseMcpBody(JSON.stringify(TOOLS), "application/json")
    ).toStrictEqual(TOOLS);
  });

  it("reads the data line of an event stream", () => {
    expect(
      parseMcpBody(
        `event: message\ndata: ${JSON.stringify(TOOLS)}\n\n`,
        "text/event-stream"
      )
    ).toStrictEqual(TOOLS);
  });
});

describe(resolveTargets, () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "agent-audit-"));
    mkdirSync(path.join(root, "apps/web"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function install(modules: string[]) {
    writeFileSync(
      path.join(root, "saasaloy.json"),
      JSON.stringify({ base: "web", installed: modules })
    );
  }

  it("reads agent from saasaloy.json, and the origins from apps/web/.env.local", () => {
    install(["api", "agent"]);
    writeFileSync(
      path.join(root, "apps/web/.env"),
      `PUBLIC_SITE_URL=http://old:1\nPUBLIC_API_URL=http://old:2\n`
    );
    writeFileSync(
      path.join(root, "apps/web/.env.local"),
      `PUBLIC_SITE_URL=${SITE}\nPUBLIC_API_URL=${API}\n`
    );
    expect(resolveTargets(parseAuditArgs([]), {}, root)).toStrictEqual({
      site: SITE,
      api: API,
      agent: true,
    });
  });

  it("lets a flag beat the environment, and the environment beat the files", () => {
    install([]);
    writeFileSync(
      path.join(root, "apps/web/.env.local"),
      "PUBLIC_SITE_URL=http://file:1\n"
    );
    expect(
      resolveTargets(
        parseAuditArgs(["--api", "http://flag:2"]),
        { PUBLIC_SITE_URL: "http://env:1", PUBLIC_API_URL: "http://env:2" },
        root
      )
    ).toStrictEqual({
      site: "http://env:1",
      api: "http://flag:2",
      agent: false,
    });
  });

  it("needs a site origin", () => {
    install([]);
    expect(() => resolveTargets(parseAuditArgs([]), {}, root)).toThrow(
      /--site/
    );
  });

  it("needs an api origin when agent is installed", () => {
    install(["agent"]);
    expect(() =>
      resolveTargets(parseAuditArgs(["--site", SITE]), {}, root)
    ).toThrow(/--api/);
  });
});

describe(auditWeb, () => {
  it("passes every web check on a full product", async () => {
    const checks = await auditWeb(fetchFrom(product()), SITE, `${API}/mcp`);
    expect(checks.every((check) => check.status === "pass")).toBeTruthy();
    expect(byId(checks)).toStrictEqual({
      "web/llms.txt": "pass",
      "web/llms.txt-mcp": "pass",
      "web/llms-full.txt": "pass",
      "web/markdown": "pass",
      "web/json-ld": "pass",
      "web/robots.txt": "pass",
    });
  });

  it("fails when llms.txt is gone", async () => {
    const routes = product();
    routes.delete(`${SITE}/llms.txt`);
    const checks = byId(await auditWeb(fetchFrom(routes), SITE, `${API}/mcp`));
    expect(checks["web/llms.txt"]).toBe("fail");
  });

  it("fails llms.txt served as html", async () => {
    const routes = product();
    routes.set(`${SITE}/llms.txt`, () => text(LLMS, "text/html"));
    const checks = byId(await auditWeb(fetchFrom(routes), SITE));
    expect(checks["web/llms.txt"]).toBe("fail");
  });

  it("fails when llms.txt does not name the MCP address", async () => {
    const checks = byId(
      await auditWeb(fetchFrom(product()), SITE, "http://elsewhere/mcp")
    );
    expect(checks["web/llms.txt-mcp"]).toBe("fail");
  });

  it("skips the MCP line without agent", async () => {
    const checks = byId(await auditWeb(fetchFrom(product()), SITE));
    expect(checks["web/llms.txt-mcp"]).toBe("skip");
  });

  it("fails a Markdown copy that is missing", async () => {
    const routes = product();
    routes.delete(`${SITE}/privacy.md`);
    const checks = byId(await auditWeb(fetchFrom(routes), SITE));
    expect(checks["web/markdown"]).toBe("fail");
  });

  it("fails a robots.txt that shuts every crawler out", async () => {
    const routes = product();
    routes.set(`${SITE}/robots.txt`, () =>
      text("User-agent: *\nDisallow: /\n", "text/plain")
    );
    const checks = byId(await auditWeb(fetchFrom(routes), SITE));
    expect(checks["web/robots.txt"]).toBe("fail");
  });

  it("fails a home page with no JSON-LD", async () => {
    const routes = product();
    routes.set(`${SITE}/`, () => text("<html></html>", "text/html"));
    const checks = byId(await auditWeb(fetchFrom(routes), SITE));
    expect(checks["web/json-ld"]).toBe("fail");
  });

  it("fails a check, not the run, when the site does not answer", async () => {
    const checks = await auditWeb(async () => {
      throw new TypeError("fetch failed");
    }, SITE);
    const llms = checks.find((check) => check.id === "web/llms.txt");
    expect(llms?.status).toBe("fail");
    expect(llms?.detail).toMatch(/fetch failed/);
  });
});

describe(auditApi, () => {
  it("passes every api check with a key", async () => {
    const checks = await auditApi(fetchFrom(product()), API, KEY, false);
    expect(byId(checks)).toStrictEqual({
      "api/openapi.json": "pass",
      "api/llms.txt": "pass",
      "api/server-card": "pass",
      "api/mcp-auth": "pass",
      "api/tools-list": "pass",
      "api/key-check": "pass",
    });
  });

  it("fails the key check when the tool accepts a wrong key", async () => {
    const routes = product();
    routes.set(`${API}/mcp`, (init) => mcp(init, () => true));
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/key-check"]).toBe("fail");
  });

  it("fails the key check when the tool refuses the audit key", async () => {
    const routes = product();
    routes.set(`${API}/mcp`, (init) =>
      rpcMethod(init) === "tools/call"
        ? mcp(init, () => false)
        : mcp(init, (key) => key === `Bearer ${KEY}`)
    );
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/key-check"]).toBe("fail");
  });

  it("skips the key check when no scoped read takes no argument", async () => {
    const routes = product();
    const tools = TOOLS.result.tools.map(({ name, inputSchema }) => ({
      name,
      inputSchema,
    }));
    routes.set(`${API}/mcp`, (init) =>
      authHeader(init) === null
        ? json({ error: { code: "unauthorized" } }, 401)
        : json({ jsonrpc: "2.0", id: 1, result: { tools } })
    );
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/tools-list"]).toBe("pass");
    expect(checks["api/key-check"]).toBe("skip");
  });

  it("counts a 401 with no key as proof the endpoint is up, and skips tools/list", async () => {
    const checks = byId(
      await auditApi(fetchFrom(product()), API, undefined, false)
    );
    expect(checks["api/mcp-auth"]).toBe("pass");
    expect(checks["api/tools-list"]).toBe("skip");
  });

  it("fails tools/list with no key under --require-key", async () => {
    const checks = byId(
      await auditApi(fetchFrom(product()), API, undefined, true)
    );
    expect(checks["api/tools-list"]).toBe("fail");
  });

  it("fails an /mcp that answers without a key", async () => {
    const routes = product();
    routes.set(`${API}/mcp`, () => json(TOOLS));
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/mcp-auth"]).toBe("fail");
  });

  it("fails a tool list that is empty", async () => {
    const routes = product();
    routes.set(`${API}/mcp`, (init) =>
      authHeader(init) === null
        ? json({ error: { code: "unauthorized" } }, 401)
        : json({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
    );
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/tools-list"]).toBe("fail");
  });

  it("fails a tool the OpenAPI document does not hold", async () => {
    const routes = product();
    routes.set(`${API}/openapi.json`, () =>
      json({
        ...OPENAPI,
        paths: { "/notes": { get: { operationId: "notes_list" } } },
      })
    );
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/tools-list"]).toBe("fail");
  });

  it("fails an OpenAPI document that is not 3.x", async () => {
    const routes = product();
    routes.set(`${API}/openapi.json`, () => json({ swagger: "2.0" }));
    const checks = byId(await auditApi(fetchFrom(routes), API, KEY, false));
    expect(checks["api/openapi.json"]).toBe("fail");
  });
});

describe(runAudit, () => {
  let root: string;
  let lines: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "agent-audit-run-"));
    lines = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function deps(
    routes: Map<string, Route>,
    modules: string[],
    env: Record<string, string> = {}
  ) {
    writeFileSync(
      path.join(root, "saasaloy.json"),
      JSON.stringify({ base: "web", installed: modules })
    );
    return {
      fetch: fetchFrom(routes),
      env: { PUBLIC_SITE_URL: SITE, PUBLIC_API_URL: API, ...env },
      root,
      say: (line: string) => {
        lines.push(line);
      },
    };
  }

  it("exits 0 on a full product with a key", async () => {
    const code = await runAudit(
      [],
      deps(product(), ["agent"], { AGENT_AUDIT_KEY: KEY })
    );
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatch(/12 passed, 0 failed, 0 skipped/);
  });

  it("exits 1 after llms.txt is removed", async () => {
    const routes = product();
    routes.delete(`${SITE}/llms.txt`);
    await expect(
      runAudit([], deps(routes, ["agent"], { AGENT_AUDIT_KEY: KEY }))
    ).resolves.toBe(1);
    expect(
      lines.some((line) => line.startsWith("FAIL web/llms.txt"))
    ).toBeTruthy();
  });

  it("exits 0 without agent, and says it skipped the api checks", async () => {
    const routes = product();
    routes.set(`${SITE}/llms.txt`, () =>
      text(
        LLMS.replace(/## API for agents[\s\S]*?## Optional/, "## Optional"),
        "text/plain"
      )
    );
    await expect(runAudit([], deps(routes, []))).resolves.toBe(0);
    expect(lines.some((line) => line.startsWith("SKIP api"))).toBeTruthy();
    expect(lines.join("\n")).toMatch(/agent is not installed/);
  });

  it("prints one JSON report under --json", async () => {
    const code = await runAudit(
      ["--json"],
      deps(product(), ["agent"], { AGENT_AUDIT_KEY: KEY })
    );
    expect(code).toBe(0);
    const report: unknown = JSON.parse(lines.join("\n"));
    expect(report).toHaveProperty("ok", true);
    expect(report).toHaveProperty("agent", true);
    expect(report).toHaveProperty("checks.length", 12);
  });

  it("exits 2 on a usage error", async () => {
    await expect(runAudit(["--nope"], deps(product(), []))).resolves.toBe(2);
  });
});
