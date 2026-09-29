// Prove the tarball npm would publish actually works, before it is published.
//
// Everything else in this repo exercises the CLI from source: `pnpm test` runs vitest
// against `src/`, and `play:init` runs `dist/index.js` from inside the workspace. Neither
// touches the `files` whitelist in packages/cli/package.json, so a template directory or a
// schema dropped from that list breaks nobody here and everybody out there. This script
// closes that gap: it packs, installs the tarball into a directory that is not a workspace
// member, and drives `init` and `add` through the installed bin.
//
// The CLI steps run OFFLINE. `add` points at the repo's own `modules/` through
// SAASALOY_REGISTRY_DIR, so what is under test is the packed artifact and not GitHub's
// uptime. The remote fetch path is a separate, deliberate manual check before the first
// publish.
//
// The last step is the one exception, and it needs the npm registry. It installs the
// scaffolded project and starts the web app's `astro dev` (issue #186). A dependency the
// template reaches through a range can move under our exact pins with no change on our
// side, and then a fresh project's dev server fails for everyone. Only a real install
// finds that, so `.github/workflows/smoke.yml` runs this script on a schedule as well.
//
// npm does the install, not pnpm: pnpm would find pnpm-workspace.yaml above .dev/ and link
// rather than install, which is the one thing this script exists to avoid.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cliDir = join(root, "packages/cli");
const scratch = join(root, ".dev/release-smoke");
const installDir = join(scratch, "install");
const workDir = join(scratch, "work");
const projectDir = join(workDir, "smoke");

/** The dependency blocks a published manifest can carry a `workspace:` range in. */
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Files `init` must have written, relative to the scaffolded project. */
const INIT_FILES = ["package.json", "saasaloy.json", "pnpm-workspace.yaml"];

/**
 * What `add api` must have written. `apps/api/src/index.ts` is the module's own code and
 * `saasaloy-lock.json` is the applier's record of it, so this covers both halves of an add:
 * the files landed, and the project knows they did.
 */
const ADD_FILES = [
  "apps/api/package.json",
  "apps/api/src/index.ts",
  "saasaloy-lock.json",
];

/** The web app's pinned dev origin, from `apps/web/astro.config.mjs` (`strictPort`). */
const WEB_DEV_URL = "http://localhost:3000/";

/**
 * How long the web dev server gets to answer. A cold start measured 36.6s on a dev box
 * (plan 0066, Phase 0), and a CI runner is slower, so this leaves room for both.
 */
const WEB_DEV_TIMEOUT_MS = 180_000;

/**
 * Log lines that mean a React component threw during the server render. React writes
 * these to the log and Astro still answers 200 with the HTML around the failed block, so
 * the status code alone does not show the fault.
 */
const RENDER_ERROR_PATTERNS = [
  /Invalid hook call/,
  /Cannot read properties of null \(reading 'use[A-Z]\w*'\)/,
];

export interface SmokeOptions {
  /** Leave `.dev/release-smoke/` in place after a green run, for inspection. */
  keep: boolean;
  /** Flags and positionals this script does not accept. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--keep"]);

/**
 * Split this script's argv. Exported for its own test: a typo'd `--kep` that silently
 * wiped the scratch tree would be read as "the directory was never kept", which sends the
 * maintainer looking at the wrong thing.
 */
export function parseArgs(argv: string[]): SmokeOptions {
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));
  return { keep: argv.includes("--keep"), unknown };
}

/**
 * Every `workspace:` range in a manifest, as `block.name` paths. Exported for its own test.
 *
 * `npm publish` does not rewrite these ranges the way `pnpm publish` does, so a single one
 * ships a package that fails to install for everyone who is not in this monorepo. The CLI
 * has no workspace dependency today; this is the guard that notices the day someone adds one.
 */
export function findWorkspaceDeps(manifest: Record<string, unknown>): string[] {
  const offenders: string[] = [];
  for (const block of DEPENDENCY_BLOCKS) {
    const deps = manifest[block];
    if (typeof deps !== "object" || deps === null) {
      continue;
    }
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        offenders.push(`${block}.${name}`);
      }
    }
  }
  return offenders;
}

/**
 * Every log line that reports a React render fault. Exported for its own test.
 *
 * Two copies of React in the server bundle (issue #186) show up as "Invalid hook call"
 * and as a hook read off a null dispatcher, so the check matches both and nothing wider.
 */
export function findRenderErrors(log: string): string[] {
  return log
    .split("\n")
    .filter((line) =>
      RENDER_ERROR_PATTERNS.some((pattern) => pattern.test(line))
    );
}

function fail(message: string, ...detail: string[]): never {
  console.error(`release-smoke: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

function step(message: string): void {
  console.log(`release-smoke: ${message}`);
}

function run(
  command: string,
  args: readonly string[],
  label: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${label} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(`${label} failed`, `exit code ${String(result.status)}`);
  }
}

async function readManifest(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    return fail(`could not read ${relative(root, file)}`, String(error));
  }
}

async function assertExists(
  dir: string,
  files: string[],
  label: string
): Promise<void> {
  const missing: string[] = [];
  for (const file of files) {
    try {
      await readFile(join(dir, file), "utf-8");
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    fail(
      `${label} did not write ${String(missing.length)} expected file(s)`,
      ...missing.map((file) => join(relative(root, dir), file))
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Start `astro dev` in the scaffolded web app, request the home page, and stop the
 * server. Returns `null` when the page answers 200 with a clean log, or the reason it
 * failed with the log tail.
 *
 * `ASTRO_DEV_BACKGROUND=1` keeps the server in this child. Astro 7 detaches the server
 * when it detects a coding agent and returns at once, which would leave the log in
 * `.astro/dev.log` and a child here that is not the server. Astro sets this variable on
 * the process it detaches, and the process that sees it skips the agent check and serves
 * in place. `--ignore-lock` looks like the public switch for this, but Astro 7.3.1 refuses
 * it outright when it detects an agent. `detached` gives the server its own process
 * group, so the stop reaches workerd as well.
 */
async function checkWebDev(webDir: string): Promise<string | null> {
  const server = spawn("pnpm", ["exec", "astro", "dev"], {
    cwd: webDir,
    detached: true,
    env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  server.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  let exitCode: number | null | undefined;
  server.on("exit", (code) => {
    exitCode = code;
  });

  const tail = (): string => log.trim().split("\n").slice(-20).join("\n");

  try {
    const deadline = Date.now() + WEB_DEV_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        return `astro dev exited with code ${String(exitCode)} before it answered.\n${tail()}`;
      }
      let status: number | undefined;
      try {
        const response = await fetch(WEB_DEV_URL);
        await response.arrayBuffer();
        ({ status } = response);
      } catch {
        // Not listening yet.
      }
      if (status !== undefined) {
        if (status !== 200) {
          return `${WEB_DEV_URL} answered ${String(status)}, not 200.\n${tail()}`;
        }
        const errors = findRenderErrors(log);
        if (errors.length > 0) {
          return `${WEB_DEV_URL} answered 200, but the server render logged ${String(errors.length)} React error(s):\n${errors.slice(0, 5).join("\n")}`;
        }
        return null;
      }
      await sleep(1000);
    }
    return `${WEB_DEV_URL} did not answer within ${String(WEB_DEV_TIMEOUT_MS / 1000)}s.\n${tail()}`;
  } finally {
    if (server.pid !== undefined && exitCode === undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.unknown.length > 0) {
    fail(
      `unknown argument(s): ${options.unknown.join(", ")}`,
      "usage: pnpm release:smoke [--keep]"
    );
  }

  // --- Pack ----------------------------------------------------------------------

  await rm(scratch, { force: true, recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const sourceManifest = await readManifest(join(cliDir, "package.json"));
  const version = sourceManifest.version;
  if (typeof version !== "string") {
    fail("packages/cli/package.json has no version");
  }

  step(`packing saasaloy@${version}`);
  // `npm pack` runs prepack, so dist/ in the tarball is built from this checkout rather
  // than from whatever the last `pnpm build` left behind. It has to be prepack and not
  // prepublishOnly: npm runs prepublishOnly on `npm publish` only, which would leave this
  // smoke check packing a stale dist/ and proving nothing about the build being released.
  run("npm", ["pack", "--pack-destination", installDir], "npm pack", {
    cwd: cliDir,
  });
  const tarball = join(installDir, `saasaloy-${version}.tgz`);

  // --- Install it somewhere that is not a workspace member -------------------------

  // A package.json of its own stops npm walking up into the repo and installing there.
  await writeFile(
    join(installDir, "package.json"),
    `${JSON.stringify({ name: "saasaloy-release-smoke", private: true, version: "0.0.0" }, null, 2)}\n`
  );

  step("installing the tarball into .dev/release-smoke/install");
  run("npm", ["install", "--no-audit", "--no-fund", tarball], "npm install", {
    cwd: installDir,
  });

  // --- Assert the manifest that actually shipped ------------------------------------

  const installedRoot = join(installDir, "node_modules/saasaloy");
  const packedManifest = await readManifest(
    join(installedRoot, "package.json")
  );
  const offenders = findWorkspaceDeps(packedManifest);
  if (offenders.length > 0) {
    fail(
      `the packed manifest carries ${String(offenders.length)} workspace: range(s)`,
      ...offenders,
      "`npm publish` does not rewrite these, so the published package cannot be installed.",
      "Depend on a published version, or bundle the code into packages/cli."
    );
  }

  await assertExists(
    installedRoot,
    [
      "dist/index.js",
      // npm reads the page from this file and nothing else. 0.1.0 shipped without it and
      // the npm listing was blank, so prepack generates it and this line proves it packed.
      "README.md",
      "templates/base/package.json",
      "schemas/saasaloy.schema.json",
    ],
    "the tarball"
  );

  // --- Drive the installed bin ------------------------------------------------------

  const bin = join(installDir, "node_modules/.bin/saasaloy");
  const offlineEnv = {
    ...process.env,
    SAASALOY_REGISTRY_DIR: join(root, "modules"),
  };

  // `src/version.ts` resolves `../package.json` from `dist/index.js`. That depth only holds
  // while tsup emits one flat file and `files` ships package.json alongside dist/, and both
  // are packaging decisions this script is the last check on.
  step("running `saasaloy --version`");
  const reported = spawnSync(bin, ["--version"], {
    cwd: workDir,
    encoding: "utf-8",
  });
  if (reported.status !== 0 || !reported.stdout.includes(version)) {
    fail(
      "the installed bin does not report its own version",
      `Expected ${version}, got ${JSON.stringify(reported.stdout.trim())}.`,
      "src/version.ts reads ../package.json relative to dist/index.js — check the",
      "`files` array and tsup's output layout."
    );
  }

  step("running `saasaloy init smoke --no-install --no-git`");
  run(bin, ["init", "smoke", "--no-install", "--no-git"], "saasaloy init", {
    cwd: workDir,
  });
  await assertExists(projectDir, INIT_FILES, "init");

  step("running `saasaloy add api --yes` against the local registry");
  run(bin, ["add", "api", "--yes"], "saasaloy add api", {
    cwd: projectDir,
    env: offlineEnv,
  });
  await assertExists(projectDir, ADD_FILES, "add api");

  // --- Start the web app's dev server (needs the network) ---------------------------

  step("installing the scaffolded project with pnpm");
  run("pnpm", ["install"], "pnpm install", { cwd: projectDir });

  step(`starting \`astro dev\` in apps/web and requesting ${WEB_DEV_URL}`);
  const devFailure = await checkWebDev(join(projectDir, "apps/web"));
  if (devFailure !== null) {
    fail("the web app's dev server failed", ...devFailure.split("\n"));
  }

  if (!options.keep) {
    await rm(scratch, { force: true, recursive: true });
  }

  const kept = options.keep ? ` Kept ${relative(root, scratch)}.` : "";
  console.log(
    `release-smoke: saasaloy@${version} packs, installs outside the workspace, and scaffolds a project that takes the api module and serves its web app in dev.${kept}`
  );
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
