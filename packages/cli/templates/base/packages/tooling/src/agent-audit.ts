#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseValues, splitLines } from "@repo/env/dotenv";

// `pnpm agent:audit [--site <origin>] [--api <origin>] [--require-key] [--json]`: check
// what a running product offers to agents, and exit non-zero on a gap.
//
// The web checks run on every product: `/llms.txt` (200, `text/plain`, the llmstxt.org
// title and summary), `/llms-full.txt`, every Markdown copy `/llms.txt` links on the site,
// the JSON-LD on the home page, and a `robots.txt` that does not shut every crawler out.
//
// The api checks run when `saasaloy.json` lists `agent`: `/openapi.json` (OpenAPI 3.x with
// paths), the api's `/llms.txt`, the Server Card, `/mcp` without a key (it must answer
// 401), and an MCP `tools/list` with the key in `AGENT_AUDIT_KEY` (at least one tool, each
// an `operationId` of the OpenAPI document). A key check then calls one scoped read-only
// tool twice: a wrong key must get `unauthorized`, and the audit key must not. With no `agent`, the site's `/llms.txt` need
// not name an MCP address, and the command says it skipped the api checks.
//
// With no `AGENT_AUDIT_KEY`, the 401 from `/mcp` counts as proof the endpoint is up and
// gated, and `tools/list` is skipped. `--require-key` turns that skip into a failure; an
// unattended run that seeds a key passes it.
//
// The origins come from `--site` and `--api`, else `PUBLIC_SITE_URL` and `PUBLIC_API_URL`
// in the environment, else the same keys in `apps/web/.env.local`, then `apps/web/.env`.
// So in a dev checkout, `pnpm agent:audit` audits the dev servers `pnpm dev` started.
//
// Exit codes: 0 when no check failed (a skip is not a failure), 1 on a gap, 2 on a usage
// error such as an unknown flag or no site origin.

const KEY_VAR = "AGENT_AUDIT_KEY";
const TIMEOUT_MS = 10_000;
/** The MCP revision the raw `tools/list` call names. The server negotiates down. */
const MCP_PROTOCOL_VERSION = "2025-06-18";

const USAGE =
  "Usage: pnpm agent:audit [--site <origin>] [--api <origin>] [--require-key] [--json]";

/** A usage error: the command exits 2, not 1. */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface AuditArgs {
  site?: string;
  api?: string;
  requireKey: boolean;
  json: boolean;
}

/** Read the flags. A `--`, which `pnpm run x -- --flag` forwards, is skipped. */
export function parseAuditArgs(argv: readonly string[]): AuditArgs {
  const args = argv.filter((arg) => arg !== "--");
  const result: AuditArgs = { requireKey: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? "";
    if (flag === "--require-key") {
      result.requireKey = true;
    } else if (flag === "--json") {
      result.json = true;
    } else if (flag === "--site" || flag === "--api") {
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new UsageError(`${flag} needs a value.\n${USAGE}`);
      }
      result[flag === "--site" ? "site" : "api"] = value;
      index += 1;
    } else {
      throw new UsageError(`Unknown argument ${flag}.\n${USAGE}`);
    }
  }
  return result;
}

/** What the audit runs against. */
export interface AuditTargets {
  site: string;
  api?: string;
  agent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The modules `saasaloy.json` lists as installed, or none. */
function installedModules(root: string): string[] {
  const file = path.join(root, "saasaloy.json");
  if (!existsSync(file)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
  const installed = isRecord(parsed) ? parsed.installed : undefined;
  return Array.isArray(installed)
    ? installed.filter((name): name is string => typeof name === "string")
    : [];
}

/** `key` from `apps/web/.env.local`, else `apps/web/.env`. */
function webFileValue(root: string, key: string): string | undefined {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, "apps/web", name);
    if (existsSync(file)) {
      const value = parseValues(splitLines(readFileSync(file, "utf-8"))).get(
        key
      );
      if (value !== undefined && value !== "") {
        return value;
      }
    }
  }
  return undefined;
}

/** The origins and whether `agent` is installed. A missing origin is a usage error. */
export function resolveTargets(
  args: AuditArgs,
  env: Record<string, string | undefined>,
  root: string
): AuditTargets {
  const pick = (flag: string | undefined, key: string) =>
    flag ?? nonEmpty(env[key]) ?? webFileValue(root, key);
  const site = pick(args.site, "PUBLIC_SITE_URL");
  const api = pick(args.api, "PUBLIC_API_URL");
  const agent = installedModules(root).includes("agent");
  if (site === undefined) {
    throw new UsageError(
      `No site origin. Pass --site <origin>, or set PUBLIC_SITE_URL.\n${USAGE}`
    );
  }
  if (agent && api === undefined) {
    throw new UsageError(
      `agent is installed and there is no api origin. Pass --api <origin>, or set PUBLIC_API_URL.\n${USAGE}`
    );
  }
  return {
    site: trimSlash(site),
    ...(api === undefined ? {} : { api: trimSlash(api) }),
    agent,
  };
}

/** `value`, or undefined when it is unset or empty. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function trimSlash(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export type CheckStatus = "pass" | "fail" | "skip";

export interface Check {
  id: string;
  status: CheckStatus;
  detail: string;
}

export type AuditFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A fetched response, or the error the request threw. */
interface Got {
  status: number;
  type: string;
  body: string;
}

async function get(
  fetcher: AuditFetch,
  url: string,
  init?: RequestInit
): Promise<Got | Error> {
  try {
    const response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const pass = (id: string, detail: string): Check => ({
  id,
  status: "pass",
  detail,
});
const fail = (id: string, detail: string): Check => ({
  id,
  status: "fail",
  detail,
});
const skip = (id: string, detail: string): Check => ({
  id,
  status: "skip",
  detail,
});

/** Why `got` is not a 200 of one of `types`, or undefined when it is. */
function answerGap(
  got: Got | Error,
  url: string,
  types: readonly string[]
): string | undefined {
  if (got instanceof Error) {
    return `${url} did not answer: ${got.message}`;
  }
  if (got.status !== 200) {
    return `${url} answered ${String(got.status)}`;
  }
  if (!types.some((type) => got.type.startsWith(type))) {
    return `${url} is ${got.type || "untyped"}, not ${types.join(" or ")}`;
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The JSON-RPC message in an MCP response: the body itself, or, for an event stream, the
 * last `data:` line that parses.
 */
export function parseMcpBody(body: string, contentType: string): unknown {
  if (!contentType.startsWith("text/event-stream")) {
    return parseJson(body);
  }
  const messages = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => parseJson(line.slice("data:".length).trim()))
    .filter((message) => message !== undefined);
  return messages.at(-1);
}

/** A robots.txt whose `User-agent: *` group has `Disallow: /`. */
function blocksEveryCrawler(robots: string): boolean {
  let inStar = false;
  for (const raw of splitLines(robots)) {
    const line = raw.replace(/#.*/, "").trim();
    const [field = "", ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field.trim())) {
      inStar = value === "*";
    } else if (inStar && /^disallow$/i.test(field.trim()) && value === "/") {
      return true;
    }
  }
  return false;
}

/** The web checks. `mcpUrl` is the address `llms.txt` must name; undefined without agent. */
export async function auditWeb(
  fetcher: AuditFetch,
  site: string,
  mcpUrl?: string
): Promise<Check[]> {
  const checks: Check[] = [];
  const llmsUrl = `${site}/llms.txt`;
  const llms = await get(fetcher, llmsUrl);
  const llmsGap = answerGap(llms, llmsUrl, ["text/plain"]);
  const llmsBody = llms instanceof Error ? "" : llms.body;
  if (llmsGap !== undefined) {
    checks.push(fail("web/llms.txt", llmsGap));
  } else if (!/^# \S/.test(llmsBody) || !/^> \S/m.test(llmsBody)) {
    checks.push(
      fail("web/llms.txt", `${llmsUrl} has no "# title" and "> summary" lines`)
    );
  } else {
    checks.push(pass("web/llms.txt", `${llmsUrl} 200 text/plain`));
  }

  if (mcpUrl === undefined) {
    checks.push(
      skip("web/llms.txt-mcp", "agent is not installed, so no MCP address")
    );
  } else if (llmsBody.includes(mcpUrl)) {
    checks.push(pass("web/llms.txt-mcp", `names ${mcpUrl}`));
  } else {
    checks.push(fail("web/llms.txt-mcp", `${llmsUrl} does not name ${mcpUrl}`));
  }

  const fullUrl = `${site}/llms-full.txt`;
  const full = await get(fetcher, fullUrl);
  const fullGap = answerGap(full, fullUrl, ["text/plain"]);
  checks.push(
    fullGap === undefined && !(full instanceof Error) && /^# \S/.test(full.body)
      ? pass("web/llms-full.txt", `${fullUrl} 200 text/plain`)
      : fail("web/llms-full.txt", fullGap ?? `${fullUrl} has no "# title" line`)
  );

  const markdownUrls = [...llmsBody.matchAll(/\]\(([^)\s]+\.md)\)/g)]
    .map((match) => match[1] ?? "")
    .filter((url) => url.startsWith(`${site}/`));
  if (markdownUrls.length === 0) {
    checks.push(
      fail("web/markdown", `${llmsUrl} links no Markdown copy on ${site}`)
    );
  } else {
    const gaps: string[] = [];
    for (const url of markdownUrls) {
      const page = await get(fetcher, url);
      const gap = answerGap(page, url, ["text/markdown", "text/plain"]);
      if (gap !== undefined) {
        gaps.push(gap);
      } else if (!(page instanceof Error) && !/^#{1,6} \S/m.test(page.body)) {
        gaps.push(`${url} has no heading`);
      }
    }
    checks.push(
      gaps.length === 0
        ? pass(
            "web/markdown",
            `${String(markdownUrls.length)} Markdown copies answer`
          )
        : fail("web/markdown", gaps.join("; "))
    );
  }

  const homeUrl = `${site}/`;
  const home = await get(fetcher, homeUrl);
  const homeGap = answerGap(home, homeUrl, ["text/html"]);
  const homeBody = home instanceof Error ? "" : home.body;
  checks.push(
    homeGap === undefined &&
      homeBody.includes("application/ld+json") &&
      /"@type":\s*"Organization"/.test(homeBody)
      ? pass("web/json-ld", "the home page carries an Organization")
      : fail(
          "web/json-ld",
          homeGap ?? `${homeUrl} has no JSON-LD with an Organization`
        )
  );

  const robotsUrl = `${site}/robots.txt`;
  const robots = await get(fetcher, robotsUrl);
  const robotsGap = answerGap(robots, robotsUrl, ["text/plain"]);
  if (robotsGap !== undefined) {
    checks.push(fail("web/robots.txt", robotsGap));
  } else if (!(robots instanceof Error) && blocksEveryCrawler(robots.body)) {
    checks.push(
      fail("web/robots.txt", `${robotsUrl} disallows / for every crawler`)
    );
  } else {
    checks.push(pass("web/robots.txt", "crawlers may read the site"));
  }
  return checks;
}

/** The `operationId` of every operation in an OpenAPI document. */
function operationIds(document: unknown): Set<string> {
  const ids = new Set<string>();
  const paths = isRecord(document) ? document.paths : undefined;
  for (const item of Object.values(isRecord(paths) ? paths : {})) {
    for (const operation of Object.values(isRecord(item) ? item : {})) {
      if (isRecord(operation) && typeof operation.operationId === "string") {
        ids.add(operation.operationId);
      }
    }
  }
  return ids;
}

function rpcRequest(
  method: string,
  params: Record<string, unknown>,
  key?: string
): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  };
}

function toolsListRequest(key?: string): RequestInit {
  return rpcRequest("tools/list", {}, key);
}

/** The key the key check sends to prove a wrong key is refused. */
export const WRONG_KEY = "saasaloy-agent-audit-wrong-key";

/**
 * A tool the key check may call: a read with a scope word and no required argument, so
 * the call changes nothing and its route's gate must check the key.
 */
function probeTool(tools: readonly unknown[]): string | undefined {
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      continue;
    }
    const meta = isRecord(tool._meta) ? tool._meta : {};
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    const schema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (
      typeof meta["saasaloy/scope"] === "string" &&
      annotations.readOnlyHint === true &&
      required.length === 0
    ) {
      return tool.name;
    }
  }
  return undefined;
}

/** The error code a `tools/call` answer carries, `unauthorized` for an HTTP 401. */
function callErrorCode(got: Got): string | undefined {
  if (got.status === 401) {
    return "unauthorized";
  }
  const message = parseMcpBody(got.body, got.type);
  const result = isRecord(message) ? message.result : undefined;
  if (!isRecord(result) || result.isError !== true) {
    return undefined;
  }
  const content = isRecord(result.structuredContent)
    ? result.structuredContent
    : {};
  const error = isRecord(content.error) ? content.error : {};
  return typeof error.code === "string" ? error.code : "error";
}

/**
 * `/mcp` itself checks only that a bearer key is present (ADR 0063); each route's gate
 * checks the key when a tool runs. So the proof that the key works is one tool call: the
 * wrong key must get `unauthorized`, and the audit key must not.
 */
async function keyCheck(
  fetcher: AuditFetch,
  mcpUrl: string,
  key: string,
  tools: readonly unknown[]
): Promise<Check> {
  const name = probeTool(tools);
  if (name === undefined) {
    return skip(
      "api/key-check",
      "no read-only tool with a scope and no required argument to call"
    );
  }
  const call = async (sent: string) =>
    await get(
      fetcher,
      mcpUrl,
      rpcRequest("tools/call", { name, arguments: {} }, sent)
    );
  const wrong = await call(WRONG_KEY);
  if (wrong instanceof Error) {
    return fail("api/key-check", `${mcpUrl} did not answer: ${wrong.message}`);
  }
  if (callErrorCode(wrong) !== "unauthorized") {
    return fail(
      "api/key-check",
      `${name} with a wrong key did not answer unauthorized: ${wrong.body.slice(0, 200)}`
    );
  }
  const right = await call(key);
  if (right instanceof Error) {
    return fail("api/key-check", `${mcpUrl} did not answer: ${right.message}`);
  }
  if (callErrorCode(right) === "unauthorized") {
    return fail("api/key-check", `${name} refused ${KEY_VAR} as unauthorized`);
  }
  return pass(
    "api/key-check",
    `${name} refuses a wrong key and accepts ${KEY_VAR}`
  );
}

/** The api checks, for a product with `agent`. */
export async function auditApi(
  fetcher: AuditFetch,
  api: string,
  key: string | undefined,
  requireKey: boolean
): Promise<Check[]> {
  const checks: Check[] = [];

  const openapiUrl = `${api}/openapi.json`;
  const openapi = await get(fetcher, openapiUrl);
  const openapiGap = answerGap(openapi, openapiUrl, ["application/json"]);
  const document =
    openapi instanceof Error ? undefined : parseJson(openapi.body);
  const ids = operationIds(document);
  if (openapiGap !== undefined) {
    checks.push(fail("api/openapi.json", openapiGap));
  } else if (
    !isRecord(document) ||
    typeof document.openapi !== "string" ||
    !document.openapi.startsWith("3.") ||
    !isRecord(document.paths)
  ) {
    checks.push(
      fail("api/openapi.json", `${openapiUrl} is not OpenAPI 3.x with paths`)
    );
  } else {
    checks.push(
      pass(
        "api/openapi.json",
        `OpenAPI ${document.openapi}, ${String(ids.size)} operations`
      )
    );
  }

  const mcpUrl = `${api}/mcp`;
  const llmsUrl = `${api}/llms.txt`;
  const llms = await get(fetcher, llmsUrl);
  const llmsGap = answerGap(llms, llmsUrl, ["text/plain"]);
  checks.push(
    llmsGap === undefined &&
      !(llms instanceof Error) &&
      llms.body.includes(mcpUrl)
      ? pass("api/llms.txt", `${llmsUrl} names ${mcpUrl}`)
      : fail("api/llms.txt", llmsGap ?? `${llmsUrl} does not name ${mcpUrl}`)
  );

  const cardUrl = `${api}/mcp/server-card`;
  const card = await get(fetcher, cardUrl);
  const cardGap = answerGap(card, cardUrl, [
    "application/mcp-server-card+json",
    "application/json",
  ]);
  const cardBody = card instanceof Error ? undefined : parseJson(card.body);
  const remotes = isRecord(cardBody) ? cardBody.remotes : undefined;
  const remoteUrls = Array.isArray(remotes)
    ? remotes.map((remote: unknown) => (isRecord(remote) ? remote.url : ""))
    : [];
  checks.push(
    cardGap === undefined && remoteUrls.includes(mcpUrl)
      ? pass("api/server-card", `names ${mcpUrl}`)
      : fail("api/server-card", cardGap ?? `${cardUrl} does not name ${mcpUrl}`)
  );

  const anonymous = await get(fetcher, mcpUrl, toolsListRequest());
  if (anonymous instanceof Error) {
    checks.push(
      fail("api/mcp-auth", `${mcpUrl} did not answer: ${anonymous.message}`)
    );
  } else if (anonymous.status === 401) {
    checks.push(pass("api/mcp-auth", `${mcpUrl} answers 401 with no key`));
  } else {
    checks.push(
      fail(
        "api/mcp-auth",
        `${mcpUrl} answered ${String(anonymous.status)} with no key, not 401`
      )
    );
  }

  if (key === undefined) {
    const why = `no ${KEY_VAR}, so tools/list did not run`;
    checks.push(
      requireKey
        ? fail("api/tools-list", `${why} (--require-key)`)
        : skip("api/tools-list", `${why}; set it to a key to list the tools`)
    );
    return checks;
  }
  const listed = await get(fetcher, mcpUrl, toolsListRequest(key));
  if (listed instanceof Error || listed.status !== 200) {
    checks.push(
      fail(
        "api/tools-list",
        listed instanceof Error
          ? `${mcpUrl} did not answer: ${listed.message}`
          : `tools/list answered ${String(listed.status)}: ${listed.body.slice(0, 200)}`
      )
    );
    return checks;
  }
  const message = parseMcpBody(listed.body, listed.type);
  const result = isRecord(message) ? message.result : undefined;
  const tools = isRecord(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) {
    checks.push(fail("api/tools-list", "tools/list returned no tool array"));
    return checks;
  }
  const names = tools.map((tool: unknown) =>
    isRecord(tool) && typeof tool.name === "string" ? tool.name : ""
  );
  const unknown = names.filter((name) => !ids.has(name));
  if (names.length === 0) {
    checks.push(
      fail(
        "api/tools-list",
        "tools/list lists no tool: mark at least one route callable"
      )
    );
    return checks;
  }
  if (unknown.length > 0) {
    checks.push(
      fail(
        "api/tools-list",
        `tools not in the OpenAPI document: ${unknown.join(", ")}`
      )
    );
    return checks;
  }
  checks.push(
    pass(
      "api/tools-list",
      `${String(names.length)} tools: ${names.join(", ")}`
    ),
    await keyCheck(fetcher, mcpUrl, key, tools)
  );
  return checks;
}

export interface AuditDeps {
  fetch: AuditFetch;
  env: Record<string, string | undefined>;
  /** The project root, where `saasaloy.json` and `apps/web` live. */
  root: string;
  say: (line: string) => void;
}

/** Run every check and report. Returns the exit code. */
export async function runAudit(
  argv: readonly string[],
  deps: AuditDeps
): Promise<number> {
  let args: AuditArgs;
  let targets: AuditTargets;
  try {
    args = parseAuditArgs(argv);
    targets = resolveTargets(args, deps.env, deps.root);
  } catch (error) {
    if (error instanceof UsageError) {
      deps.say(error.message);
      return 2;
    }
    throw error;
  }

  const api = targets.agent ? targets.api : undefined;
  const mcpUrl = api === undefined ? undefined : `${api}/mcp`;
  const checks = await auditWeb(deps.fetch, targets.site, mcpUrl);
  if (api === undefined) {
    checks.push(
      skip("api", "agent is not installed, so the api checks did not run")
    );
  } else {
    const key = nonEmpty(deps.env[KEY_VAR]);
    checks.push(...(await auditApi(deps.fetch, api, key, args.requireKey)));
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  if (args.json) {
    deps.say(
      JSON.stringify(
        {
          ok: failed === 0,
          site: targets.site,
          api: targets.api ?? null,
          agent: targets.agent,
          checks,
        },
        null,
        2
      )
    );
    return failed === 0 ? 0 : 1;
  }
  for (const check of checks) {
    deps.say(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
  }
  const count = (status: CheckStatus) =>
    checks.filter((check) => check.status === status).length;
  deps.say(
    `${String(count("pass"))} passed, ${String(failed)} failed, ${String(count("skip"))} skipped.`
  );
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await runAudit(process.argv.slice(2), {
      fetch: async (url, init) => await fetch(url, init),
      env: process.env,
      root: process.cwd(),
      say: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
