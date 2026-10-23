import { defineConfig, devices } from "@playwright/test";

import {
  hasModule,
  installedApps,
  READY,
  readConfig,
  ROOT,
  SPEC_TAGS,
} from "./lib/project.ts";

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
// run leaves nothing holding a port.
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

const webServer = installedApps(config).map((app) => ({
  command: `pnpm --filter @repo/${app} dev`,
  cwd: ROOT,
  url: READY[app],
  // Astro's `astro dev` detaches itself when it detects an AI-agent environment, and a
  // detached server is one Playwright cannot own or kill. `ASTRO_DEV_BACKGROUND` turns that
  // detection off; the name reads backwards, but it is the only lever the CLI exposes, and
  // `--background` stays the opt-in. Harmless for the two vite apps, which never detach.
  env: { ASTRO_DEV_BACKGROUND: "1" },
  // Off CI, attach to a `pnpm dev` you already have running rather than failing on a busy
  // port. On CI nothing is running, and reusing would hide a start-up failure.
  reuseExistingServer: !process.env.CI,
  // A cold `vite dev` in a fresh checkout compiles the whole graph on first request.
  timeout: 120_000,
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
