#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseJsonc } from "@repo/env/deploy";
import { deployConfig } from "./deploy.config.ts";
import { DEPLOY_TARGETS, SMOKE_CHECKS } from "./targets.ts";
import type { DeployConfig, DeployTarget, SmokeCheck } from "./types.ts";

// `pnpm deploy:production`: the one command that puts a commit live.
//
//   pnpm deploy:production                       gates, then every Worker in order, smoke, tag
//   pnpm deploy:production --dry-run             report every gate, the order and the smoke
//                                                checks; build, upload, migrate and tag nothing
//   pnpm deploy:production --migrate             run the production migration first
//   pnpm deploy:production --skip-ci "<reason>"  pass the CI gate, with the reason in the tag
//   pnpm deploy:production --only <service>      one Worker and its smoke checks, no tag
//
// The gates come from `deploy.config.ts`: the branch is on its list, the tree is clean,
// HEAD is the same commit as its branch on origin, the CI workflow passed on HEAD (when
// the config names one), and a migration file changed since the last deploy tag needs
// `--migrate`. A failed gate stops a real deploy before anything builds, and the message
// names the command that clears it.
//
// The Workers deploy one at a time in `DEPLOY_TARGETS` order, so a frontend never goes
// live ahead of the api route it calls. Each runs its own `deploy` script
// (`env-deploy <service>`). The smoke checks then ask each custom domain for the answers
// `SMOKE_CHECKS` lists, and only a run where every step passed tags HEAD with an
// annotated `<prefix><UTC yyyymmdd-hhmm>` tag and pushes it. The newest tag is what is
// live: a hotfix branches from it, and `git log <tag>..main` lists what the next deploy
// ships.

export interface Options {
  dryRun: boolean;
  migrate: boolean;
  skipCi?: string;
  only?: string;
}

const USAGE =
  'Usage: pnpm deploy:production [--dry-run] [--migrate] [--skip-ci "<reason>"] [--only <service>]';

/** A flag's value, or undefined when the next word is missing, blank or another flag. */
function flagValue(args: string[], index: number): string | undefined {
  const value = args[index + 1]?.trim();
  return value === undefined || value === "" || value.startsWith("--")
    ? undefined
    : value;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, migrate: false };
  // pnpm passes a `--` through when the caller writes one before the flags.
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--migrate") {
      options.migrate = true;
    } else if (arg === "--skip-ci") {
      const reason = flagValue(args, index);
      if (reason === undefined) {
        throw new Error(`--skip-ci needs a reason.\n${USAGE}`);
      }
      options.skipCi = reason;
      index += 1;
    } else if (arg === "--only") {
      const service = flagValue(args, index);
      if (service === undefined) {
        throw new Error(`--only needs a service.\n${USAGE}`);
      }
      options.only = service;
      index += 1;
    } else {
      throw new Error(`Unknown argument ${arg ?? ""}.\n${USAGE}`);
    }
  }
  return options;
}

// ---- Config --------------------------------------------------------------------------------

export interface ResolvedConfig {
  branches: string[];
  tagPrefix: string;
  ciWorkflow: string | undefined;
  migrations: string;
}

/**
 * The config with a default for every key it lacks. `deploy.config.ts` is the project's
 * and never changes after init, so a key this engine learns later is absent there.
 */
export function resolveConfig(config: DeployConfig): ResolvedConfig {
  return {
    branches: config.branches ?? ["main", "hotfix-*"],
    tagPrefix: config.tagPrefix ?? "deploy-",
    ciWorkflow: config.ciWorkflow,
    migrations: config.migrations ?? "packages/db/migrations/*.sql",
  };
}

function branchAllowed(branch: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? branch.startsWith(pattern.slice(0, -1))
      : branch === pattern
  );
}

// ---- Gates ---------------------------------------------------------------------------------

/** The CI workflow's runs on HEAD, reduced to the one fact the gate needs. */
export type CiState = "passed" | "running" | "failed" | "missing";

export interface CiRun {
  status: string;
  conclusion: string;
}

export function ciState(runs: CiRun[]): CiState {
  if (runs.some((run) => run.conclusion === "success")) {
    return "passed";
  }
  if (runs.some((run) => run.status !== "completed")) {
    return "running";
  }
  return runs.length === 0 ? "missing" : "failed";
}

/** What the gates read from git, GitHub and the workspace. */
export interface Facts {
  branch: string;
  dirty: string[];
  head: string;
  /** The commit the branch names on origin, or undefined when origin has no such branch. */
  remoteHead?: string | undefined;
  /** `off` when the config names no CI workflow, or `--skip-ci` passed the gate. */
  ci: CiState | "off";
  /** The newest deploy tag HEAD descends from. */
  lastTag?: string | undefined;
  /** Migration files changed since `lastTag`, or every one when there is no tag yet. */
  newMigrations: string[];
  /** Whether the project has a `@repo/db` workspace to migrate. */
  hasDb: boolean;
}

export interface Gate {
  name: string;
  state: "ok" | "fail" | "off";
  /** What passed, or what failed and the command that clears it. */
  detail: string;
}

function branchGate(facts: Facts, config: ResolvedConfig): Gate {
  const allowed = config.branches.join(", ");
  if (branchAllowed(facts.branch, config.branches)) {
    return {
      name: "Branch",
      state: "ok",
      detail: `The branch ${facts.branch} may deploy (${allowed}).`,
    };
  }
  const first = config.branches[0] ?? "main";
  return {
    name: "Branch",
    state: "fail",
    detail: `The branch is ${facts.branch}, and a deploy starts only from ${allowed}. Run: git switch ${first}`,
  };
}

function treeGate(facts: Facts): Gate {
  if (facts.dirty.length === 0) {
    return { name: "Tree", state: "ok", detail: "The tree is clean." };
  }
  return {
    name: "Tree",
    state: "fail",
    detail: `The tree has uncommitted changes (${facts.dirty.join(", ")}), so the tag would not record what goes live. Run: git commit, or git stash push -u`,
  };
}

function originGate(facts: Facts): Gate {
  const { branch } = facts;
  if (facts.remoteHead === undefined) {
    return {
      name: "Origin",
      state: "fail",
      detail: `origin has no ${branch}. Run: git push -u origin ${branch}`,
    };
  }
  if (facts.remoteHead !== facts.head) {
    return {
      name: "Origin",
      state: "fail",
      detail: `HEAD (${facts.head.slice(0, 7)}) is not origin/${branch} (${facts.remoteHead.slice(0, 7)}). Run: git pull --ff-only, or git push`,
    };
  }
  return {
    name: "Origin",
    state: "ok",
    detail: `HEAD is origin/${branch} (${facts.head.slice(0, 7)}).`,
  };
}

function ciGate(facts: Facts, options: Options, config: ResolvedConfig): Gate {
  if (config.ciWorkflow === undefined) {
    return {
      name: "CI",
      state: "off",
      detail:
        "CI gate: off. packages/tooling/src/deploy.config.ts names no ciWorkflow.",
    };
  }
  if (options.skipCi !== undefined) {
    return {
      name: "CI",
      state: "off",
      detail: `CI gate: skipped (${options.skipCi}). The reason goes into the tag message.`,
    };
  }
  const workflow = config.ciWorkflow;
  if (facts.ci === "passed") {
    return { name: "CI", state: "ok", detail: `${workflow} passed on HEAD.` };
  }
  const why = {
    failed: `${workflow} failed on HEAD. Fix it, push, and wait for a green run: gh run watch.`,
    missing: `${workflow} has no run on HEAD. Push the commit and wait for the run: gh run watch.`,
    off: `The run did not read ${workflow}. Run the deploy again.`,
    running: `${workflow} is still running on HEAD. Run: gh run watch, then deploy again.`,
  }[facts.ci];
  return {
    name: "CI",
    state: "fail",
    detail: `${why} When GitHub Actions itself is down, run: pnpm deploy:production --skip-ci "<reason>"`,
  };
}

function migrationGate(facts: Facts, options: Options): Gate {
  if (options.migrate && !facts.hasDb) {
    return {
      name: "Migrations",
      state: "fail",
      detail:
        "--migrate needs the @repo/db workspace, and this project has none. Run the deploy without --migrate.",
    };
  }
  const count = facts.newMigrations.length;
  if (count > 0 && !options.migrate) {
    const since = facts.lastTag ?? "the first commit (no deploy tag yet)";
    return {
      name: "Migrations",
      state: "fail",
      detail: `${count} migration file(s) changed since ${since}. Read the SQL, then run: pnpm deploy:production --migrate`,
    };
  }
  if (count > 0) {
    return {
      name: "Migrations",
      state: "ok",
      detail: `${count} migration file(s) changed, and --migrate runs them first.`,
    };
  }
  return {
    name: "Migrations",
    state: "ok",
    detail: options.migrate
      ? "No migration file changed. --migrate runs the migration anyway."
      : `No migration file changed since ${facts.lastTag ?? "the first commit (no deploy tag yet)"}.`,
  };
}

/** Every gate, passed or not. */
export function gateReport(
  facts: Facts,
  options: Options,
  config: ResolvedConfig
): Gate[] {
  return [
    branchGate(facts, config),
    treeGate(facts),
    originGate(facts),
    ciGate(facts, options, config),
    migrationGate(facts, options),
  ];
}

/** Every reason the deploy may not start. An empty list means every gate passed. */
export function gateProblems(
  facts: Facts,
  options: Options,
  config: ResolvedConfig
): string[] {
  return gateReport(facts, options, config)
    .filter((gate) => gate.state === "fail")
    .map((gate) => gate.detail);
}

// ---- Targets and smoke checks --------------------------------------------------------------

const TARGETS_FILE = "packages/tooling/src/targets.ts";

/**
 * The deploy order. `deployable` is every workspace under `apps/` with a wrangler config
 * and a `deploy` script. A workspace with no row, a row for a service that does not
 * deploy, and a service listed twice each stop the deploy: the engine refuses rather
 * than guess where a Worker goes in the order.
 */
export function orderTargets(
  targets: readonly DeployTarget[],
  deployable: readonly string[]
): { order: string[]; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.service)) {
      problems.push(
        `DEPLOY_TARGETS lists ${target.service} twice. Keep one row in ${TARGETS_FILE}.`
      );
    }
    seen.add(target.service);
    if (!deployable.includes(target.service)) {
      problems.push(
        `DEPLOY_TARGETS names ${target.service}, and apps/${target.service} is not a workspace with a wrangler.jsonc and a deploy script. Remove the row from ${TARGETS_FILE}.`
      );
    }
  }
  for (const service of deployable) {
    if (!seen.has(service)) {
      problems.push(
        `apps/${service} deploys and has no DEPLOY_TARGETS row, so its place in the order is unknown. Add { service: "${service}", order: <number> } to ${TARGETS_FILE}.`
      );
    }
  }
  const order = targets
    .filter((target) => deployable.includes(target.service))
    .toSorted((a, b) => a.order - b.order || a.service.localeCompare(b.service))
    .map((target) => target.service)
    .filter((service, index, all) => all.indexOf(service) === index);
  return { order, problems };
}

/** Rows that name a service that does not deploy, or reuse an id. */
export function smokeRowProblems(
  checks: readonly SmokeCheck[],
  deployable: readonly string[]
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.id)) {
      problems.push(
        `SMOKE_CHECKS lists ${check.id} twice. Keep one row in ${TARGETS_FILE}.`
      );
    }
    seen.add(check.id);
    if (!deployable.includes(check.service)) {
      problems.push(
        `SMOKE_CHECKS row ${check.id} names ${check.service}, which does not deploy. Remove the row from ${TARGETS_FILE}.`
      );
    }
  }
  return problems;
}

/** A smoke check with the full URL it requests. */
export interface SmokeRequest extends SmokeCheck {
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The hosts of the `routes[]` entries that set `custom_domain: true`. */
function customDomains(wranglerConfig: unknown): string[] {
  if (!isRecord(wranglerConfig) || !Array.isArray(wranglerConfig.routes)) {
    return [];
  }
  const routes: unknown[] = wranglerConfig.routes;
  return routes.flatMap((route) =>
    isRecord(route) &&
    route.custom_domain === true &&
    typeof route.pattern === "string"
      ? [route.pattern.replace(/\/+$/, "")]
      : []
  );
}

/**
 * One request per custom domain of `service` and smoke check for it. A service with no
 * custom domain gets none: a `workers.dev` address is never guessed.
 */
export function smokeUrls(
  service: string,
  wranglerConfig: unknown,
  checks: readonly SmokeCheck[]
): SmokeRequest[] {
  const own = checks.filter((check) => check.service === service);
  return customDomains(wranglerConfig).flatMap((host) =>
    own.map((check) => ({ ...check, url: `https://${host}${check.path}` }))
  );
}

export function smokeProblem(
  request: SmokeRequest,
  status: number,
  body: string
): string | undefined {
  if (status !== request.status) {
    return `${request.url} answered ${status}, expected ${request.status}.`;
  }
  if (request.body !== undefined && !body.includes(request.body)) {
    return `${request.url} answered ${status} without ${request.body} in the body.`;
  }
  return undefined;
}

// ---- Tag -----------------------------------------------------------------------------------

/** `deploy-20261023-1430`, in UTC, so tags sort in the order the deploys happened. */
export function tagName(now: Date, prefix: string): string {
  const iso = now.toISOString();
  return `${prefix}${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
}

const MIGRATE = ["--filter", "@repo/db", "run", "db:prod:migrate"];

export function tagMessage(
  head: string,
  options: Options,
  services: readonly string[]
): string {
  const lines = [
    `Production deploy of ${head.slice(0, 7)}: ${services.join(", ")}.`,
  ];
  if (options.migrate) {
    lines.push(`Ran pnpm ${MIGRATE.join(" ")} first.`);
  }
  if (options.skipCi !== undefined) {
    lines.push(`CI gate skipped: ${options.skipCi}`);
  }
  return lines.join("\n");
}

// ---- The run -------------------------------------------------------------------------------

/** A workspace under `apps/` that deploys. */
export interface Workspace {
  /** The directory name under `apps/`, which is also its `SERVICES` name. */
  service: string;
  /** The `name` in its `package.json`, for `pnpm --filter`. */
  packageName: string;
}

export interface Answer {
  status: number;
  text: () => Promise<string>;
}

/** Every side effect the run has, so a test can fake each one. */
export interface Io {
  /** Run git and answer its trimmed stdout. Throws when git exits non-zero. */
  git: (args: string[]) => string;
  /** Run gh and answer its stdout. Throws when gh exits non-zero. */
  gh: (args: string[]) => string;
  /** Run a command at the repository root with inherited output, and answer its exit code. */
  run: (command: string, args: string[]) => Promise<number>;
  fetch: (url: string) => Promise<Answer>;
  sleep: (ms: number) => Promise<void>;
  say: (text: string) => void;
  now: () => Date;
  /** Every workspace under `apps/` with a wrangler config and a `deploy` script. */
  workspaces: () => Workspace[];
  /** The parsed `apps/<service>/wrangler.jsonc`, or undefined when there is none. */
  wranglerConfig: (service: string) => unknown;
  /** Whether `packages/db` holds the `@repo/db` workspace. */
  hasDb: () => boolean;
}

export interface Project {
  config: DeployConfig;
  targets: readonly DeployTarget[];
  smokeChecks: readonly SmokeCheck[];
}

const SMOKE_TRIES = 3;
const SMOKE_PAUSE_MS = 5000;
const ENV_CHECK = ["packages/env/src/deploy.ts", "--check"];

function tryGit(io: Io, args: string[]): string | undefined {
  try {
    return io.git(args);
  } catch {
    return undefined;
  }
}

function splitLines(text: string | undefined): string[] {
  return (text ?? "").split("\n").filter((line) => line.trim() !== "");
}

function readCi(io: Io, workflow: string, head: string): CiState {
  const output = io.gh([
    "run",
    "list",
    "--workflow",
    workflow,
    "--commit",
    head,
    "--json",
    "status,conclusion",
  ]);
  const parsed: unknown = JSON.parse(output);
  const runs = Array.isArray(parsed)
    ? parsed.filter(isRecord).map((run) => ({
        status: typeof run.status === "string" ? run.status : "",
        conclusion: typeof run.conclusion === "string" ? run.conclusion : "",
      }))
    : [];
  return ciState(runs);
}

function readFacts(io: Io, options: Options, config: ResolvedConfig): Facts {
  const branch = io.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = io.git(["rev-parse", "HEAD"]);
  tryGit(io, ["fetch", "--quiet", "origin", branch]);
  const lastTag = tryGit(io, [
    "describe",
    "--tags",
    "--match",
    `${config.tagPrefix}*`,
    "--abbrev=0",
    "HEAD",
  ]);
  const migrationArgs =
    lastTag === undefined
      ? ["ls-files", "--", config.migrations]
      : ["diff", "--name-only", lastTag, "HEAD", "--", config.migrations];
  const needsCi =
    config.ciWorkflow !== undefined && options.skipCi === undefined;
  return {
    branch,
    // The status column starts with a space, so the path starts at the fourth character.
    dirty: splitLines(io.git(["status", "--porcelain"])).map((line) =>
      line.slice(3)
    ),
    head,
    remoteHead: tryGit(io, ["rev-parse", "--verify", `origin/${branch}`]),
    ci:
      needsCi && config.ciWorkflow !== undefined
        ? readCi(io, config.ciWorkflow, head)
        : "off",
    lastTag,
    newMigrations: splitLines(io.git(migrationArgs)),
    hasDb: io.hasDb(),
  };
}

async function step(
  io: Io,
  title: string,
  command: string,
  args: string[]
): Promise<void> {
  io.say(`\n== ${title}: ${command} ${args.join(" ")}`);
  if ((await io.run(command, args)) !== 0) {
    throw new Error(`${title} failed. No deploy tag was written.`);
  }
}

/** Each smoke request for `services`, and a line for each service that has none. */
function smokePlan(
  io: Io,
  services: readonly string[],
  checks: readonly SmokeCheck[]
): { requests: SmokeRequest[]; notes: string[] } {
  const requests: SmokeRequest[] = [];
  const notes: string[] = [];
  for (const service of services) {
    const own = checks.filter((check) => check.service === service);
    if (own.length === 0) {
      notes.push(`${service} has no smoke check in ${TARGETS_FILE}.`);
      continue;
    }
    const found = smokeUrls(service, io.wranglerConfig(service), checks);
    if (found.length === 0) {
      notes.push(
        `${service} has no custom domain (a routes[] entry with custom_domain: true in apps/${service}/wrangler.jsonc), so its ${own.length} smoke check(s) are skipped.`
      );
    }
    requests.push(...found);
  }
  return { requests, notes };
}

async function smoke(io: Io, requests: SmokeRequest[]): Promise<string[]> {
  const problems: string[] = [];
  for (const request of requests) {
    let problem: string | undefined = "no answer";
    // A custom domain can serve the old version for a few seconds after an upload.
    for (
      let attempt = 0;
      attempt < SMOKE_TRIES && problem !== undefined;
      attempt += 1
    ) {
      if (attempt > 0) {
        await io.sleep(SMOKE_PAUSE_MS);
      }
      try {
        const answer = await io.fetch(request.url);
        problem = smokeProblem(request, answer.status, await answer.text());
      } catch (error) {
        problem = `${request.url} did not answer: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    io.say(`${problem === undefined ? "ok  " : "FAIL"} ${request.url}`);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  return problems;
}

function rollbackLines(workspaces: readonly Workspace[]): string {
  return workspaces
    .map(
      (workspace) =>
        `  pnpm --filter ${workspace.packageName} exec env-deploy --run ${workspace.service} -- wrangler rollback`
    )
    .join("\n");
}

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Run the deploy, or the dry run. Throws with the reason when the run must exit 1. */
export async function deployProduction(
  options: Options,
  io: Io,
  project: Project
): Promise<void> {
  const config = resolveConfig(project.config);
  const workspaces = io.workspaces();
  const deployable = workspaces.map((workspace) => workspace.service);

  const planned = orderTargets(project.targets, deployable);
  const planProblems = [
    ...planned.problems,
    ...smokeRowProblems(project.smokeChecks, deployable),
  ];
  if (
    options.only !== undefined &&
    planned.problems.length === 0 &&
    !planned.order.includes(options.only)
  ) {
    planProblems.push(
      `--only ${options.only} is not a deploy target. Choose ${planned.order.join(", ") || "none"}.`
    );
  }
  if (planProblems.length > 0) {
    throw new Error(
      `The deploy did not start, because the targets are wrong:\n${list(planProblems)}`
    );
  }
  const services = options.only === undefined ? planned.order : [options.only];
  const chosen = services.flatMap((service) =>
    workspaces.filter((workspace) => workspace.service === service)
  );

  const facts = readFacts(io, options, config);
  io.say(`Branch ${facts.branch} at ${facts.head.slice(0, 7)}.`);
  if (facts.lastTag === undefined) {
    io.say("No deploy tag yet. This deploy writes the first one.");
  } else {
    const shipped = tryGit(io, ["log", "--oneline", `${facts.lastTag}..HEAD`]);
    io.say(`Last deploy: ${facts.lastTag}. Commits this deploy ships:`);
    io.say(
      shipped === undefined || shipped === ""
        ? "  (none, a redeploy of the same commit)"
        : shipped
    );
  }
  if (facts.newMigrations.length > 0) {
    io.say(
      `Migration files since the last deploy:\n  ${facts.newMigrations.join("\n  ")}`
    );
  }

  const gates = gateReport(facts, options, config);
  io.say("\nGates:");
  for (const gate of gates) {
    io.say(`  ${gate.state.padEnd(4)}  ${gate.detail}`);
  }
  const problems = gates
    .filter((gate) => gate.state === "fail")
    .map((gate) => gate.detail);

  const order = services
    .map((service) => {
      const target = project.targets.find((each) => each.service === service);
      return `${service} (${target?.order ?? "?"})`;
    })
    .join(", ");
  io.say(`\nDeploy order: ${order}`);

  const plan = smokePlan(io, services, project.smokeChecks);
  io.say("\nSmoke checks:");
  for (const request of plan.requests) {
    io.say(
      `  ${request.service}: ${request.url} answers ${request.status}${request.body === undefined ? "" : ` with ${request.body}`}`
    );
  }
  for (const note of plan.notes) {
    io.say(`  ${note}`);
  }

  if (options.dryRun) {
    io.say(`\n== Env check: node ${ENV_CHECK.join(" ")}`);
    const envExit = await io.run("node", ENV_CHECK);
    if (envExit !== 0) {
      io.say("A real deploy would stop at the env check above.");
    }
    if (options.migrate) {
      io.say(
        `\nA real deploy runs pnpm ${MIGRATE.join(" ")} here. The dry run does not.`
      );
    }
    const stops =
      envExit === 0 ? problems : [...problems, "The env check failed."];
    io.say(
      stops.length > 0
        ? `\nDry run done. A real deploy would stop:\n${list(stops)}`
        : "\nDry run done. Every gate passed. Nothing was built, uploaded, migrated or tagged."
    );
    return;
  }

  if (problems.length > 0) {
    throw new Error(
      `The deploy did not start. Clear each gate, then run it again:\n${list(problems)}`
    );
  }

  await step(io, "Env check", "node", ENV_CHECK);
  if (options.migrate) {
    await step(io, "Migrate", "pnpm", MIGRATE);
  }
  const deployed: Workspace[] = [];
  for (const workspace of chosen) {
    try {
      await step(io, `Deploy ${workspace.service}`, "pnpm", [
        "--filter",
        workspace.packageName,
        "run",
        "deploy",
      ]);
    } catch (error) {
      const live =
        deployed.length > 0
          ? `\nThese Workers are already live on the new commit. Roll one back with:\n${rollbackLines(deployed)}`
          : "";
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${live}`,
        { cause: error }
      );
    }
    deployed.push(workspace);
  }

  io.say("\n== Smoke checks");
  const failed = await smoke(io, plan.requests);
  if (failed.length > 0) {
    throw new Error(
      `The Workers are live, and a smoke check failed:\n${list(failed)}\nNo deploy tag was written. Fix and deploy again, or roll each Worker back:\n${rollbackLines(deployed)}`
    );
  }

  if (options.only !== undefined) {
    io.say(
      `\n${options.only} is live. A one-Worker deploy writes no tag, because the other Workers may run an older commit.`
    );
    return;
  }
  const tag = tagName(io.now(), config.tagPrefix);
  io.git([
    "tag",
    "--annotate",
    tag,
    "--message",
    tagMessage(facts.head, options, services),
  ]);
  try {
    io.git(["push", "--quiet", "origin", tag]);
  } catch (error) {
    throw new Error(
      `Deployed ${facts.head.slice(0, 7)} and wrote the tag ${tag}, and the push failed, so the tag is local only. The Workers stay live. Run: git push origin ${tag}`,
      { cause: error }
    );
  }
  io.say(`\nDeployed ${facts.head.slice(0, 7)} and pushed the tag ${tag}.`);
}

// ---- The real side effects -----------------------------------------------------------------

function readJson(file: string): unknown {
  return parseJsonc(readFileSync(file, "utf-8"));
}

function wranglerFile(dir: string): string | undefined {
  return ["wrangler.jsonc", "wrangler.json"]
    .map((name) => path.join(dir, name))
    .find((file) => existsSync(file));
}

function findWorkspaces(root: string): Workspace[] {
  const apps = path.join(root, "apps");
  if (!existsSync(apps)) {
    return [];
  }
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = path.join(apps, entry.name);
      const manifest = path.join(dir, "package.json");
      if (!existsSync(manifest) || wranglerFile(dir) === undefined) {
        return [];
      }
      const parsed = readJson(manifest);
      const scripts = isRecord(parsed) ? parsed.scripts : undefined;
      const name = isRecord(parsed) ? parsed.name : undefined;
      return isRecord(scripts) &&
        typeof scripts.deploy === "string" &&
        typeof name === "string"
        ? [{ service: entry.name, packageName: name }]
        : [];
    })
    .toSorted((a, b) => a.service.localeCompare(b.service));
}

function hasDbWorkspace(root: string): boolean {
  const manifest = path.join(root, "packages/db/package.json");
  if (!existsSync(manifest)) {
    return false;
  }
  const parsed = readJson(manifest);
  return isRecord(parsed) && parsed.name === "@repo/db";
}

function nodeIo(root: string): Io {
  const exec = (command: string, args: string[]): string =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf-8",
      // A failed read is a fact the gates report, so git's own stderr stays out of it.
      stdio: ["ignore", "pipe", "pipe"],
    });
  return {
    git: (args) => exec("git", args).trim(),
    gh: (args) => exec("gh", args),
    run: async (command, args) =>
      // `spawn` reports through events, not a promise, so this wraps it in one.
      // oxlint-disable-next-line promise/avoid-new
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
          resolve(code ?? (signal ? 1 : 0));
        });
      }),
    fetch: async (url) => await fetch(url, { redirect: "manual" }),
    sleep: async (ms) => {
      await delay(ms);
    },
    say: (text) => {
      process.stdout.write(`${text}\n`);
    },
    now: () => new Date(),
    workspaces: () => findWorkspaces(root),
    wranglerConfig: (service) => {
      const file = wranglerFile(path.join(root, "apps", service));
      return file === undefined ? undefined : readJson(file);
    },
    hasDb: () => hasDbWorkspace(root),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();
  await deployProduction(options, nodeIo(root), {
    config: deployConfig,
    targets: DEPLOY_TARGETS,
    smokeChecks: SMOKE_CHECKS,
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `\n${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
