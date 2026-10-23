// Run the `e2e` module's own suite, for real, inside a freshly scaffolded project.
//
// Most gates in this repo check a file. This one checks that the thing we ship works: it
// scaffolds `.dev/playground`, adds the module set the four flows need, writes every
// service's `.env`, installs, downloads Chromium, and runs `pnpm e2e`. The apps start, a
// browser signs the seeded admin in, a form submits, and a guarded route refuses an
// anonymous caller, or the gate is red.
//
// NOT part of `deps:verify`, and it must not become part of it. It downloads a browser and
// takes minutes, so the repo's standing green gate cannot depend on it. Run it by hand,
// `pnpm verify:e2e`, when the module, the base template or Playwright moves. CI runs it in
// `.github/workflows/e2e.yml` on a path filter.
//
// `--driver=d1` (the default) or `--driver=postgres` picks the database. Both are verified
// on purpose: the driver split is this repo's load-bearing claim, and an e2e capability that
// works under one driver proves the opposite of what it exists to prove. `db:setup` and
// `db:seed` hide the difference, so this script carries no second code path, only a
// different module name. Locally the postgres driver starts its own container through
// `compose.yaml`, so it needs a Docker daemon. To use a server you already run, set
// `E2E_DATABASE_SERVER` to a connection string with CREATEDB rights and
// `E2E_DB_SETUP_ARGS=--server`; CI does that with its service container.
//
// It starts from `pnpm play:reset` and leaves `.dev/playground` scaffolded and installed.
// That is a scratch directory, so anything in it is lost on the next run.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const playground = join(root, ".dev/playground");
const report = join(playground, "packages/e2e/playwright-report/index.html");

/** The modules a full run needs: every shipped flow's tag, plus the suite itself. */
export const MODULES = ["auth", "admin", "waitlist", "e2e"] as const;

export const DRIVERS = {
  d1: "database-d1",
  postgres: "database-postgres",
} as const;
export type Driver = keyof typeof DRIVERS;

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
export function readDriver(
  argv: readonly string[]
): { driver: Driver } | { error: string } {
  let driver: Driver = "d1";
  for (const arg of argv) {
    const match = /^--driver=(.+)$/.exec(arg);
    if (!match) {
      return {
        error: `unknown flag ${arg}. This command takes --driver=d1 or --driver=postgres.`,
      };
    }
    const value = match[1] ?? "";
    if (!Object.hasOwn(DRIVERS, value)) {
      return {
        error: `unknown driver ${value}. Pick one of: ${Object.keys(DRIVERS).join(", ")}.`,
      };
    }
    driver = value as Driver;
  }
  return { driver };
}

/** `E2E_DATABASE_SERVER`, or the driver's own container when it is unset or empty. */
export function databaseServer(value?: string): string {
  return value === undefined || value === "" ? CONTAINER_SERVER : value;
}

/**
 * Place the waitlist form on the landing page, the way a project owner would.
 *
 * `saasaloy add waitlist` writes the block and the island and then stops: nothing globs a
 * folder and no command edits `index.astro`, so placing it is a decision the owner makes
 * (the `saasaloy-waitlist` skill's Wire-up section carries these two lines). The spec needs
 * it placed, so do it here rather than teaching the module to edit a file it does not own.
 */
export function placeWaitlistForm(source: string): string | undefined {
  if (source.includes("WaitlistForm")) {
    return source;
  }
  const importAnchor = 'import Layout from "../layouts/Layout.astro";';
  const renderAnchor = "    <Cta siteName={siteName} />";
  if (!source.includes(importAnchor) || !source.includes(renderAnchor)) {
    return undefined;
  }
  return source
    .replace(
      importAnchor,
      `import WaitlistForm from "@web/components/WaitlistForm";\n${importAnchor}`
    )
    .replace(renderAnchor, `${renderAnchor}\n    <WaitlistForm client:load />`);
}

/** The server the postgres driver's own `compose.yaml` container answers on. */
export const CONTAINER_SERVER =
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

/**
 * Give `DATABASE_URL` a value in an env file's text, replacing the line that is there.
 *
 * The postgres driver leaves the key blank in `packages/env/.env.example`, and
 * `pnpm env:setup` refuses a blank key. A server URL is the honest value before
 * `db:setup` runs: it names no database this project manages, so `db:setup` creates the
 * project's own one and writes its URL over this line. `db:setup --server` creates it on
 * this very server, which is how CI points the run at its service container.
 *
 * The server comes from `E2E_DATABASE_SERVER`, never from `DATABASE_URL`. Every command this
 * script runs inherits its environment, and `db:seed` reads a `DATABASE_URL` there ahead of
 * `apps/api/.env`, so a server URL in it would aim the seed at the maintenance database,
 * which the seed refuses.
 */
export function withDatabaseUrl(source: string, url: string): string {
  return /^DATABASE_URL=.*$/m.test(source)
    ? source.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`)
    : `${source.replace(/\n*$/, "\n")}DATABASE_URL=${url}\n`;
}

function main(): void {
  const parsed = readDriver(process.argv.slice(2));
  if ("error" in parsed) {
    fail(parsed.error);
  }
  const { driver } = parsed;
  const module = DRIVERS[driver];

  // `play:reset`, not `play:init`: `init --force` writes over the old playground and keeps
  // its `saasaloy.json`, so a driver installed by the last run would still own the database
  // files and the other driver could not be added.
  step("scaffolding a clean .dev/playground (play:reset builds the CLI first)");
  run("pnpm", ["run", "play:reset"], "play:reset");

  // The playground sits inside this repo, which gitignores `/.dev/`. Without its own git
  // directory oxlint walks up, finds that rule and lints nothing, and `db:setup` would name a
  // database after THIS repo's branch. `saasaloy init` makes one; this is the fallback.
  if (!existsSync(join(playground, ".git"))) {
    step("giving the playground its own git directory");
    run("git", ["init", "-q", "."], "git init", playground);
  }

  // One module per call, through the shim `play:init` copied in: it points the CLI at THIS
  // worktree's `modules/` rather than the published registry, which is the only way an
  // unreleased module gets tested. The driver goes first, so `database` resolves to it rather
  // than stopping to ask.
  for (const name of [module, ...MODULES]) {
    step(`adding ${name}`);
    run(
      "./saasaloy",
      ["add", name, "--yes"],
      `saasaloy add ${name}`,
      playground
    );
  }

  step("placing the waitlist form on the landing page");
  const page = join(playground, "apps/web/src/pages/index.astro");
  const placed = placeWaitlistForm(readFileSync(page, "utf-8"));
  if (placed === undefined) {
    fail(
      "could not place the waitlist form",
      `An anchor is missing from ${page}. The base template's index.astro changed shape; update this script.`
    );
  }
  writeFileSync(page, placed);

  // `saasaloy env` would prompt for every key; the local defaults in the example are what a
  // development run needs, so copy them, the way the a11y job does.
  step("writing every service's .env from packages/env/.env.example");
  const values = join(playground, "packages/env/.env");
  const example = readFileSync(
    join(playground, "packages/env/.env.example"),
    "utf-8"
  );
  writeFileSync(
    values,
    driver === "postgres"
      ? withDatabaseUrl(
          example,
          databaseServer(process.env.E2E_DATABASE_SERVER)
        )
      : example
  );
  run("pnpm", ["install"], "pnpm install", playground);
  run("pnpm", ["run", "env:setup"], "env:setup", playground);

  // `play:reset` threw the old playground away, but not the database it made: that lives on
  // the Postgres server, and a fresh `db:generate` names its migration differently, so the
  // new run would fail creating tables the old one left. Adopt the database while there is
  // no migration to apply, then drop it through the project's own guarded `db:drop`. The
  // drop also removes `DATABASE_URL` from `apps/api/.env`, so `env:setup` puts the server
  // URL back for the suite's own `db:setup`.
  //
  // The docker backend's container is named after the playground directory, so every
  // worktree's playground on one machine shares it, and this drop reaches whatever another
  // worktree's playground left there. Point `E2E_DATABASE_SERVER` at a server of your own
  // when that matters.
  if (driver === "postgres") {
    step("dropping any database a previous playground left on the server");
    const setupArgs = (process.env.E2E_DB_SETUP_ARGS ?? "")
      .split(" ")
      .filter(Boolean);
    run("pnpm", ["run", "db:setup", ...setupArgs], "db:setup", playground);
    run("pnpm", ["run", "db:drop"], "db:drop", playground);
    run("pnpm", ["run", "env:setup"], "env:setup", playground);
  }

  // A generated project ships schema files and no migrations: `db:generate` is a decision a
  // project owner makes, so no module runs it for them. The suite needs the tables, so do
  // here what that owner would do first.
  step("generating the migrations");
  run(
    "pnpm",
    ["--filter", "@repo/db", "db:generate"],
    "db:generate",
    playground
  );

  step("downloading Chromium");
  run("pnpm", ["run", "e2e:install"], "e2e:install", playground);

  // Prove the template's own oxlint override reaches the suite. The vitest preset's file
  // glob claims a `*.spec.ts`, and those specs call an API that comes from `@playwright/test`,
  // so without the override a project owner's first `pnpm lint` is red on files they did not
  // write.
  step("linting and typechecking packages/e2e in the project");
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
  run(
    "pnpm",
    ["--filter", "@repo/e2e", "typecheck"],
    "typecheck of packages/e2e",
    playground
  );

  step("running the suite");
  run("pnpm", ["run", "e2e"], "pnpm e2e", playground);

  console.log(`\nverify-e2e: the ${driver} suite passed.`);
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  main();
}
