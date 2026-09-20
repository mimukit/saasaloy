// Run the `e2e` module's own suite, for real, inside a freshly scaffolded project.
//
// Every other gate in this repo checks a file. This one checks that the thing we ship
// actually works: it scaffolds `.dev/playground`, adds the module set a flow needs, installs,
// downloads Chromium, and runs `pnpm e2e`. The apps start, a browser signs in, a form
// submits, and a guarded route refuses an anonymous caller — or the gate is red.
//
// NOT part of `deps:verify`, and it must not become part of it. It downloads a browser and
// takes minutes, so the repo's standing green gate cannot depend on it. Run it by hand —
// `pnpm verify:e2e` — when the module, the base template or Playwright moves, and let CI run
// it on a `modules/**` path filter.
//
// `--driver=d1` (the default) or `--driver=postgres` picks the database. Both are verified
// on purpose: the driver split is this repo's load-bearing claim, and an e2e capability that
// works under one driver proves the opposite of what it exists to prove. `db:setup` hides
// the difference, so this script carries no second code path — only a different module name.
//
// It leaves `.dev/playground` scaffolded and installed. That is a scratch directory; any
// `play:init` re-scaffolds it clean.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const playground = join(root, ".dev/playground");
const report = join(playground, "packages/e2e/playwright-report/index.html");

/** The modules a full run needs: every shipped flow's tag, plus what they depend on. */
const MODULES = ["auth", "admin", "waitlist", "e2e"];

const DRIVERS = { d1: "database-d1", postgres: "database-postgres" } as const;
type Driver = keyof typeof DRIVERS;

function fail(message: string, ...detail: string[]): never {
  console.error(`verify-e2e: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  if (existsSync(report)) {
    console.error(`  HTML report: ${report}`);
  }
  process.exit(1);
}

function step(message: string): void {
  console.log(`\nverify-e2e: ${message}`);
}

function run(
  command: string,
  args: readonly string[],
  label: string,
  cwd = root
): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    fail(`${label} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(`${label} failed`, `exit code ${String(result.status)}`);
  }
}

/** `--driver=<name>`, defaulting to d1. Any other flag is a typo, not a request. */
function readDriver(): Driver {
  let driver: Driver = "d1";
  for (const arg of process.argv.slice(2)) {
    const match = /^--driver=(.+)$/.exec(arg);
    if (!match) {
      fail(
        `unknown flag ${arg}`,
        "This command takes --driver=d1 or --driver=postgres."
      );
    }
    const value = match[1]!;
    if (!(value in DRIVERS)) {
      fail(
        `unknown driver ${value}`,
        `Pick one of: ${Object.keys(DRIVERS).join(", ")}.`
      );
    }
    driver = value as Driver;
  }
  return driver;
}

/**
 * Place the waitlist block on the landing page, the way a project owner would.
 *
 * `saasaloy add waitlist` writes the block and the island and then stops: nothing globs a
 * folder and no command edits `index.astro`, so placing it is a decision the owner makes
 * (the `saasaloy-waitlist` skill's Wire-up section carries these two lines). The spec needs
 * it placed, so do it here rather than teaching the module to edit a file it does not own.
 */
function placeWaitlistForm(): void {
  const page = join(playground, "apps/web/src/pages/index.astro");
  const source = readFileSync(page, "utf-8");
  if (source.includes("WaitlistForm")) {
    return;
  }
  const withImport = source.replace(
    'import Layout from "../layouts/Layout.astro";',
    'import WaitlistForm from "@web/components/WaitlistForm";\nimport Layout from "../layouts/Layout.astro";'
  );
  const placed = withImport.replace(
    "    <Cta siteName={siteName} />",
    "    <Cta siteName={siteName} />\n    <WaitlistForm client:load />"
  );
  if (placed === source) {
    fail(
      "could not place the waitlist form",
      `Neither anchor was found in ${page}. The base template's index.astro changed shape; update this script.`
    );
  }
  writeFileSync(page, placed);
}

/**
 * Put `DATABASE_URL` where the postgres driver looks for it.
 *
 * `db:setup --server` creates the project's own database on the server `DATABASE_URL`
 * already names, and it reads that value from `apps/api/.dev.vars` rather than from the
 * process environment — which is right for a developer and leaves CI nowhere to say which
 * server the service container is on. Copy it across when the environment sets one.
 */
function seedServerUrl(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return;
  }
  const devVars = join(playground, "apps/api/.dev.vars");
  if (!existsSync(devVars)) {
    fail(
      "apps/api/.dev.vars does not exist",
      "The api module did not write it, so there is nowhere to record DATABASE_URL."
    );
  }
  const source = readFileSync(devVars, "utf-8");
  // The copied example already carries a blank `DATABASE_URL=` line, so fill that one
  // rather than appending a second key the Worker would read past.
  const filled = /^DATABASE_URL=.*$/m.test(source)
    ? source.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`)
    : `${source.replace(/\n*$/, "\n")}DATABASE_URL=${url}\n`;
  writeFileSync(devVars, filled);
}

const driver = readDriver();

step("building the CLI");
run("pnpm", ["--filter", "saasaloy", "build"], "cli build");

step(`scaffolding .dev/playground with ${DRIVERS[driver]}`);
run("pnpm", ["run", "play:init"], "play:init");

// The playground sits inside this repo, which gitignores `/.dev/`. Without its own git
// directory oxlint walks up, finds that rule and lints nothing, and `db:setup` would name a
// database after THIS repo's branch. One `git init` fixes both.
if (!existsSync(join(playground, ".git"))) {
  step("giving the playground its own git directory");
  run("git", ["init", "-q", "."], "git init", playground);
}

// One module per call, through the shim `play:init` copied in: it points the CLI at THIS
// worktree's `modules/` rather than the published registry, which is the only way an
// unreleased module gets tested. The driver goes first, so `database` resolves to it rather
// than stopping to ask.
for (const name of [DRIVERS[driver], ...MODULES]) {
  step(`adding ${name}`);
  run("./saasaloy", ["add", name, "--yes"], `saasaloy add ${name}`, playground);
}

step("placing the waitlist form on the landing page");
placeWaitlistForm();

// `saasaloy add` writes `.dev.vars.example` and stops: the real file is gitignored and
// holds secrets, so filling it in is the owner's job. Copy it, which is exactly what the
// module's own refusal message tells that owner to do. The dev defaults in it are enough —
// BETTER_AUTH_URL names a loopback host, which is what lets auth run with no secret.
step("copying apps/api/.dev.vars.example to .dev.vars");
copyFileSync(
  join(playground, "apps/api/.dev.vars.example"),
  join(playground, "apps/api/.dev.vars")
);

if (driver === "postgres") {
  step("recording DATABASE_URL in apps/api/.dev.vars");
  seedServerUrl();
}

step("installing");
run("pnpm", ["install"], "pnpm install", playground);

// A generated project ships schema files and no migrations: `db:generate` is a decision a
// project owner makes, so no module runs it for them. The suite needs the tables, so do
// here what that owner would do first.
step("generating the migrations");
run("pnpm", ["--filter", "@repo/db", "db:generate"], "db:generate", playground);

step("downloading Chromium");
run("pnpm", ["run", "e2e:install"], "e2e:install", playground);

// Prove the template's own oxlint override reaches the suite. The vitest preset's file
// glob claims a `*.spec.ts`, and those specs call an API that comes from `@playwright/test`
// — so without the override a project owner's first `pnpm lint` is red on files they did
// not write. The narrow pass is deliberate: `pnpm lint` also runs a type-aware pass over
// `packages/ui`, which is a separate matter from this module.
step("linting packages/e2e in the project");
run(
  "pnpm",
  [
    "exec",
    "oxlint",
    "-c",
    "oxlint.config.mjs",
    "--deny-warnings",
    "packages/e2e",
  ],
  "oxlint over packages/e2e",
  playground
);

step("running the suite");
run("pnpm", ["run", "e2e"], "pnpm e2e", playground);

console.log(`\nverify-e2e: the ${driver} suite passed.`);
