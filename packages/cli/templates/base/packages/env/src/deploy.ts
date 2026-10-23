#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { incompleteKeys } from "./check.ts";
import { parseValues } from "./dotenv.ts";
import { readExample } from "./example.ts";
import { findService, SERVICES, serviceNames } from "./services.ts";
import type { Service } from "./services.ts";
import { sources } from "./sources.ts";
import type { EnvSource } from "./sources.ts";

// `env-deploy`: deploy a Worker with its production values, which never touch a file under
// `apps/`.
//
//   env-deploy --check                          every service's production values, or exit 1
//   env-deploy <service> [-- <wrangler args>]   build and deploy the workspace it runs in
//   env-deploy --run <service> -- <command>     run a command with those values
//
// The values come from the selected value source (`ENV_SOURCE`), loaded in memory with the
// `deploy` row's Cloudflare credentials beside them. A variable the shell already exports
// wins, so CI passes values as environment variables. The build gets the values in its
// environment, where Vite gives them priority over the dev `.env`, so the bundle inlines
// the production `PUBLIC_*` values. The Worker's secrets travel with its code in
// one `wrangler deploy --secrets-file`, written under the OS temp directory and deleted
// whether the deploy passes or fails.
//
// Two things keep the dev `.env` under `apps/` out of a production build. A key the
// value source leaves out is set to an empty string rather than left unset, and the build
// runs with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`. That file stays untouched.

/** The `SERVICES` row that holds the Cloudflare credentials wrangler reads. */
export const DEPLOY_SERVICE = "deploy";

/**
 * The deploy tooling's own keys. They never reach a Worker's secrets, whichever row a
 * value source filed them under: every deployed Worker would otherwise hold an API token
 * that can redeploy the account.
 */
const CREDENTIAL_PREFIX = "CLOUDFLARE_";

export type ProcessEnv = Record<string, string | undefined>;

/** Run a command to completion and answer with its exit code. */
export type Runner = (
  command: string,
  args: string[],
  options: { cwd: string; env: ProcessEnv }
) => Promise<number>;

/** Whether wrangler holds a `wrangler login` session under `env`. */
export type LoginCheck = (root: string, env: ProcessEnv) => boolean;

export interface Production {
  values: Map<string, string>;
  /** Keys the example lists for the service that hold no value. */
  missing: string[];
}

/** The values under the current environment. A blank credential stays out. */
export function childEnv(
  values: Map<string, string>,
  env: ProcessEnv
): ProcessEnv {
  const carried = [...values].filter(
    ([key, value]) => !(key.startsWith(CREDENTIAL_PREFIX) && value === "")
  );
  return { ...Object.fromEntries(carried), ...env };
}

function requireService(name: string): Service {
  const service = findService(name);
  if (!service) {
    throw new Error(
      `${name} is not a service. Choose ${serviceNames().join(", ")}.`
    );
  }
  return service;
}

/** One service's production values, with every key the shell exports laid over them. */
export async function loadProduction(options: {
  root: string;
  service: Service;
  source: EnvSource;
  processEnv: ProcessEnv;
}): Promise<Production> {
  const { root, service, source, processEnv } = options;
  const example = readExample(root, service.name);
  const values = new Map(
    await source.load({ root, service, environment: "prod", processEnv })
  );
  for (const key of parseValues(example).keys()) {
    const exported = processEnv[key];
    if (exported !== undefined) {
      values.set(key, exported);
    } else if (!values.has(key)) {
      // An empty value, not a missing one: Vite fills a key the environment lacks from
      // the dev `.env` beside the workspace, which would ship a `localhost` URL.
      values.set(key, "");
    }
  }
  return {
    values,
    missing: incompleteKeys(example, values, service.omit),
  };
}

/** A service's values and the deploy credentials, checked together. */
async function loadWithCredentials(options: {
  root: string;
  name: string;
  source: EnvSource;
  processEnv: ProcessEnv;
  loggedIn: LoginCheck;
}): Promise<Map<string, string>> {
  const { root, name, source, processEnv, loggedIn } = options;
  const names = name === DEPLOY_SERVICE ? [name] : [DEPLOY_SERVICE, name];
  const values = new Map<string, string>();
  const problems: string[] = [];
  for (const each of names) {
    const loaded = await loadProduction({
      root,
      service: requireService(each),
      source,
      processEnv,
    });
    for (const [key, value] of loaded.values) {
      values.set(key, value);
    }
    if (loaded.missing.length > 0) {
      problems.push(missingMessage(each, loaded.missing));
    }
  }
  const login = loginProblem(root, values, processEnv, loggedIn);
  if (login !== undefined) {
    problems.push(login);
  }
  if (problems.length > 0) {
    throw new Error(`${problems.join("\n")}\nNothing was built or deployed.`);
  }
  return values;
}

function missingMessage(service: string, keys: string[]): string {
  return `${service} has no production value for ${keys.join(", ")}.`;
}

/**
 * With no API token, wrangler falls back to a `wrangler login` session. With neither, it
 * opens a browser to log in, which hangs a headless run, so stop first and say why.
 */
function loginProblem(
  root: string,
  values: Map<string, string>,
  processEnv: ProcessEnv,
  loggedIn: LoginCheck
): string | undefined {
  const token = values.get("CLOUDFLARE_API_TOKEN") ?? "";
  if (token !== "" || loggedIn(root, childEnv(values, processEnv))) {
    return undefined;
  }
  return "CLOUDFLARE_API_TOKEN has no value and wrangler holds no login. Set the token at the value source, or run wrangler login.";
}

/**
 * Every service's production values, before anything builds. An empty result means a
 * deploy can start. `pnpm deploy:production` (the engine in `packages/tooling`) runs this
 * through `deploy.ts --check` after its gates and before the first Worker deploys, so a
 * blank key stops the run before anything uploads.
 */
export async function checkProduction(options: {
  root: string;
  source: EnvSource;
  processEnv: ProcessEnv;
  loggedIn: LoginCheck;
}): Promise<string[]> {
  const { root, source, processEnv, loggedIn } = options;
  const problems: string[] = [];
  let credentials = new Map<string, string>();
  for (const service of SERVICES) {
    const loaded = await loadProduction({ root, service, source, processEnv });
    if (loaded.missing.length > 0) {
      problems.push(missingMessage(service.name, loaded.missing));
    }
    if (service.name === DEPLOY_SERVICE) {
      credentials = loaded.values;
    }
  }
  const login = loginProblem(root, credentials, processEnv, loggedIn);
  if (login !== undefined) {
    problems.push(login);
  }
  return problems;
}

export interface WorkerConfig {
  main?: string;
  vars?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The secrets a Worker receives: its values minus the deploy credentials, minus a key its
 * config already sets in `vars`, minus an empty value. An assets-only Worker, one with no
 * `main`, runs no code to read a secret, so it gets none.
 */
export function secretsFor(
  values: Map<string, string>,
  config: WorkerConfig
): Record<string, string> {
  if (config.main === undefined) {
    return {};
  }
  const vars = new Set(Object.keys(config.vars ?? {}));
  return Object.fromEntries(
    [...values].filter(
      ([key, value]) =>
        value !== "" && !key.startsWith(CREDENTIAL_PREFIX) && !vars.has(key)
    )
  );
}

/** JSON with its comments and trailing commas removed, which is all `wrangler.jsonc` adds. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        index += text[index] === "\\" ? 2 : 1;
      }
      index += 1;
      out += text.slice(start, index);
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return JSON.parse(out.replaceAll(/,(\s*[}\]])/g, "$1"));
}

/**
 * The config `wrangler deploy` reads in `cwd`. A build that redirects it, as the Astro
 * adapter and `@cloudflare/vite-plugin` both do through `.wrangler/deploy/config.json`,
 * decides which file that is, so read it after the build.
 */
export function readWorkerConfig(cwd: string): WorkerConfig {
  const redirect = path.join(cwd, ".wrangler/deploy/config.json");
  let file: string | undefined;
  if (existsSync(redirect)) {
    const parsed: unknown = JSON.parse(readFileSync(redirect, "utf-8"));
    const configPath = isRecord(parsed) ? parsed.configPath : undefined;
    if (typeof configPath === "string") {
      file = path.resolve(path.dirname(redirect), configPath);
    }
  }
  file ??= ["wrangler.jsonc", "wrangler.json"]
    .map((name) => path.join(cwd, name))
    .find((candidate) => existsSync(candidate));
  if (file === undefined) {
    throw new Error(
      `${cwd} has no wrangler.jsonc or wrangler.json, so there is no Worker to deploy.`
    );
  }
  const config = parseJsonc(readFileSync(file, "utf-8"));
  if (!isRecord(config)) {
    throw new Error(`${file} does not hold a JSON object.`);
  }
  return {
    ...(typeof config.main === "string" ? { main: config.main } : {}),
    ...(isRecord(config.vars) ? { vars: config.vars } : {}),
  };
}

/**
 * Build the workspace in `cwd` with `name`'s production values and deploy it. The secrets
 * file lives only as long as the `wrangler deploy` that reads it.
 */
export async function deployService(options: {
  root: string;
  name: string;
  cwd: string;
  source: EnvSource;
  processEnv: ProcessEnv;
  run: Runner;
  loggedIn: LoginCheck;
  wranglerArgs?: string[];
}): Promise<void> {
  const { cwd, processEnv, run } = options;
  const values = await loadWithCredentials(options);
  const env = childEnv(values, processEnv);
  // The Cloudflare adapters prerender inside workerd, and wrangler hands workerd the dev
  // `.env` beside the workspace as its vars, ahead of the environment. This turns that
  // off for the build, so the production values are the only ones it sees.
  const buildEnv = { ...env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" };

  if ((await run("pnpm", ["run", "build"], { cwd, env: buildEnv })) !== 0) {
    throw new Error(`The ${options.name} build failed. Nothing was deployed.`);
  }

  const secrets = secretsFor(values, readWorkerConfig(cwd));
  const args = ["deploy"];
  let directory: string | undefined;
  try {
    if (Object.keys(secrets).length > 0) {
      directory = mkdtempSync(path.join(tmpdir(), "env-deploy-"));
      const file = path.join(directory, "secrets.json");
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
      args.push("--secrets-file", file);
    }
    args.push(...(options.wranglerArgs ?? []));
    if ((await run("wrangler", args, { cwd, env })) !== 0) {
      throw new Error(`wrangler deploy failed for ${options.name}.`);
    }
  } finally {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

/** Run one command with `name`'s production values and the deploy credentials. */
export async function runWithProduction(options: {
  root: string;
  name: string;
  cwd: string;
  source: EnvSource;
  processEnv: ProcessEnv;
  run: Runner;
  loggedIn: LoginCheck;
  command: string;
  args: string[];
}): Promise<number> {
  const values = await loadWithCredentials(options);
  return await options.run(options.command, options.args, {
    cwd: options.cwd,
    env: childEnv(values, options.processEnv),
  });
}

export type Invocation =
  | { kind: "check" }
  | { kind: "deploy"; service: string; wranglerArgs: string[] }
  | { kind: "run"; service: string; command: string; args: string[] };

const USAGE =
  "Usage: env-deploy --check | env-deploy <service> [-- <wrangler args>] | env-deploy --run <service> -- <command> [args...]";

export function parseArgs(argv: string[]): Invocation {
  const [first, ...rest] = argv;
  if (first === "--check" && rest.length === 0) {
    return { kind: "check" };
  }
  if (first === "--run") {
    const [service, separator, command, ...args] = rest;
    if (
      service !== undefined &&
      separator === "--" &&
      command !== undefined &&
      command !== ""
    ) {
      return { kind: "run", service, command, args };
    }
    throw new Error(USAGE);
  }
  if (first !== undefined && !first.startsWith("-")) {
    const [separator, ...wranglerArgs] = rest;
    if (separator === undefined) {
      return { kind: "deploy", service: first, wranglerArgs: [] };
    }
    if (separator === "--") {
      return { kind: "deploy", service: first, wranglerArgs };
    }
  }
  throw new Error(USAGE);
}

/** A workspace with wrangler installed, so `pnpm exec wrangler` resolves from the root. */
function wranglerWorkspace(root: string): string {
  const has = (dir: string): boolean =>
    existsSync(path.join(dir, "node_modules/.bin/wrangler"));
  if (has(process.cwd())) {
    return process.cwd();
  }
  const apps = path.join(root, "apps");
  const found = existsSync(apps)
    ? readdirSync(apps)
        .map((name) => path.join(apps, name))
        .find((dir) => has(dir))
    : undefined;
  if (found === undefined) {
    throw new Error(
      "No workspace under apps/ has wrangler installed. Run pnpm install."
    );
  }
  return found;
}

/** `wrangler whoami --json` reports `loggedIn`, and exits 1 when it is false. */
const wranglerLoggedIn: LoginCheck = (root, env) => {
  const result = spawnSync("pnpm", ["exec", "wrangler", "whoami", "--json"], {
    cwd: wranglerWorkspace(root),
    env,
    encoding: "utf-8",
  });
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return isRecord(parsed) && parsed.loggedIn === true;
  } catch {
    return false;
  }
};

const spawnRunner: Runner = async (command, args, { cwd, env }) =>
  // `spawn` reports through events, not a promise, so this wraps it in one.
  // oxlint-disable-next-line promise/avoid-new
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("error", (error) => {
      reject(
        new Error(`env-deploy: could not run ${command}: ${error.message}`)
      );
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve(code ?? (signal ? 1 : 0));
    });
  });

async function main(): Promise<void> {
  const invocation = parseArgs(process.argv.slice(2));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();
  const source = sources.select(process.env.ENV_SOURCE);
  const common = {
    root,
    source,
    processEnv: process.env,
    loggedIn: wranglerLoggedIn,
  };

  if (invocation.kind === "check") {
    const problems = await checkProduction(common);
    if (problems.length > 0) {
      const hint = problems.some((problem) =>
        problem.includes("has no production value")
      )
        ? `Set each missing key at the value source (${source.name}), or mark it "# Blank on purpose" in packages/env/.env.example.\n`
        : "";
      throw new Error(
        `${problems.join("\n")}\n${hint}Nothing was built or deployed.`
      );
    }
    process.stdout.write(
      `Every service has its production values (source: ${source.name}).\n`
    );
    return;
  }

  if (invocation.kind === "run") {
    process.exitCode = await runWithProduction({
      ...common,
      name: invocation.service,
      cwd: process.cwd(),
      run: spawnRunner,
      command: invocation.command,
      args: invocation.args,
    });
    return;
  }

  await deployService({
    ...common,
    name: invocation.service,
    cwd: process.cwd(),
    run: spawnRunner,
    wranglerArgs: invocation.wranglerArgs,
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
