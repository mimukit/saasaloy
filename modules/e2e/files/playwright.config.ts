import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import {
  API_LOG,
  hasModule,
  installedApps,
  READY,
  readConfig,
  ROOT,
  SERVE,
  SPEC_TAGS,
} from "./lib/project.ts";
import type { App } from "./lib/project.ts";

// The browser suite's whole configuration, derived from `saasaloy.json` rather than
// written out by hand. Two things come from that file.
//
// **Which specs are collected.** A spec declares the modules it needs as Playwright tags —
// `test.describe("admin login", { tag: ["@admin", "@auth"] }, …)`. Every tag this suite may
// use is listed in `lib/project.ts`; the ones the project does not have become `grepInvert`,
// so their specs are never collected. Never collected, not skipped: a `test.skip()` on a
// 404 turns a broken route into a green run, which is the exact failure this suite exists
// to catch.
//
// **Which apps are started.** `webServer` gets one entry per installed app on its pinned
// dev port. Playwright owns those processes and kills every one it started, so a headless
// run leaves nothing holding a port. `E2E_SERVE` picks how each app starts: `dev` runs its
// dev server, `built` builds it through turbo and serves the build with its `preview`
// script. Unset, CI gets `built` and a local run gets `dev` (`serveMode` in `lib/project.ts`).
//
// The database is NOT set up here. `prepare.ts` does it, and the `e2e` script runs that
// before `playwright test`, because the api Worker reads `apps/api/.env` when it boots — a
// database created after `webServer` starts would never reach it.
const config = readConfig();

// Chromium only. A second engine doubles the run for a class of bug this suite is not
// looking for; the flows here are about the app, not about browser differences.
const CHROMIUM = devices["Desktop Chrome"];

/** The tags whose module is absent, as one regex, or `undefined` when none is. */
function uncollected(): RegExp | undefined {
  const absent = SPEC_TAGS.filter((tag) => !hasModule(config, tag));
  return absent.length > 0
    ? new RegExp(`@(${absent.join("|")})\\b`)
    : undefined;
}

/**
 * The command that starts `app` in this run's serve mode. Each app reads its own port from
 * `DEV_PORT`, which `pnpm dev:ports` writes, for `dev` and `preview` alike, so the command
 * names none.
 *
 * The built mode builds through turbo, so a build that `pnpm build` already made for the
 * same sources and env files is a cache hit rather than a second build. `--only` keeps
 * each entry to its own app: every entry starts at once, and without it two entries would
 * build `apps/api` into the same `dist` together.
 *
 * The api's output also goes to `API_LOG`, through `lib/tee-log.ts`, for every project: a
 * spec runs in a worker process and cannot read the `webServer` pipe, so a spec that needs
 * what the api printed, such as a code the console SMS provider wrote, reads that file.
 */
function serveCommand(app: App): string {
  const start =
    SERVE === "built"
      ? `pnpm turbo run build --filter=@repo/${app} --only --ui=stream && pnpm --filter @repo/${app} preview`
      : `pnpm --filter @repo/${app} dev`;
  if (app !== "api") {
    return start;
  }
  const tee = path.relative(
    ROOT,
    path.resolve(import.meta.dirname, "lib/tee-log.ts")
  );
  // One quoted argument, so the `&&` of the built command runs inside the tee as well.
  return `node "${tee}" "${path.relative(ROOT, API_LOG)}" "${start}"`;
}

const webServer = installedApps(config).map((app) => ({
  command: serveCommand(app),
  cwd: ROOT,
  url: READY[app],
  // `astro dev` and `astro preview` detach themselves when they detect an AI-agent
  // environment, and a detached server is one Playwright cannot own or kill. These two
  // variables turn that detection off; the names read backwards, but they are the only
  // lever the CLI exposes. Harmless for the vite apps, which never detach.
  env: { ASTRO_DEV_BACKGROUND: "1", ASTRO_PREVIEW_BACKGROUND: "1" },
  // Start a fresh API when tests write to the database checked by prepare.ts. A built run
  // reuses nothing: the server already on the port is most likely `pnpm dev`, and a pass
  // against it would say nothing about the build.
  reuseExistingServer:
    SERVE === "dev" &&
    !process.env.CI &&
    (app !== "api" || !hasModule(config, "database")),
  // A cold `vite dev` in a fresh checkout compiles the whole graph on first request; a
  // built run builds first, which takes longer on a cache miss.
  timeout: SERVE === "built" ? 300_000 : 120_000,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
}));

export default defineConfig({
  testDir: "./specs",
  // A flow drives a real app through a real database, so specs run one at a time. Two
  // specs signing the seeded admin in at once would race on its sessions.
  workers: 1,
  fullyParallel: false,
  // A committed `test.only` would silently shrink the suite on CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  grepInvert: uncollected(),
  webServer,

  reporter: [
    // `list` first: a headless run has no browser to open, so the failing step has to
    // reach stdout.
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    ...CHROMIUM,
    // No `baseURL`. A spec names the app it drives (`URLS.web`, `URLS.admin`), because this
    // suite crosses three origins and a single base would make two of them implicit.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...CHROMIUM } }],

  // Drops the database on CI only. A local run keeps it, so the next run skips the
  // migration; every spec that writes a row makes its own unique row, so a crashed run
  // cannot poison the next one.
  globalTeardown: "./global-teardown.ts",
});
