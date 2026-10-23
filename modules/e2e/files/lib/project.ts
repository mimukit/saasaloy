import { readFileSync } from "node:fs";
import path from "node:path";

// What the suite needs to know about the project it is testing: which modules are
// installed, which apps therefore exist, and on which port each one answers.
//
// Everything here reads `saasaloy.json`, the file `saasaloy add` maintains. Nothing is
// inferred from a directory listing: a half-removed workspace would still be on disk, and
// a suite that trusts the filesystem would start an app the project no longer has.
//
// This file is `packages/e2e/lib/project.ts`, so the repo root is three levels up.

/** The repo root, resolved from this workspace rather than from the shell's cwd. */
export const ROOT = path.resolve(import.meta.dirname, "../../..");

/** The shape `saasaloy.json` carries. Only the field this suite reads is declared. */
interface SaasaloyConfig {
  /** Every module `saasaloy add` installed, by descriptor name. */
  installed: string[];
}

/**
 * Every tag a spec in this suite may carry, each one the name of a module directory in the
 * registry. `playwright.config.ts` turns the ones that are not installed into `grepInvert`,
 * so a spec for an absent module is never collected — never collected, not skipped, because
 * a skip on a 404 turns a broken route into a green run.
 *
 * Add the tag here when you add a spec that needs a module. The tool repo's
 * `scripts/e2e-tags.test.ts` asserts every name below is a real module, so a rename in the
 * registry fails that test instead of silently disabling a flow.
 *
 * The base app (`web`) is deliberately absent. It is always present, so a tag naming it
 * could never gate anything, and keeping the vocabulary to module names is what lets the
 * guard test be exact.
 */
export const SPEC_TAGS = ["api", "admin", "auth", "waitlist"] as const;

export type SpecTag = (typeof SPEC_TAGS)[number];

/** Each app's pinned dev port. These match the port map in the project's `AGENTS.md`. */
export const PORTS = { web: 3000, admin: 3001, api: 4000 } as const;

export const URLS = {
  web: `http://localhost:${PORTS.web}`,
  admin: `http://localhost:${PORTS.admin}`,
  api: `http://localhost:${PORTS.api}`,
} as const;

/**
 * `saasaloy.json`, read from the repo root.
 *
 * An unreadable or malformed file throws. It must not degrade to "nothing installed": that
 * reading would build a `webServer` list without the api and a `grepInvert` that
 * uncollects every spec, and the run would end green having tested nothing.
 */
export function readConfig(): SaasaloyConfig {
  const file = path.resolve(ROOT, "saasaloy.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (error) {
    throw new Error(
      `Could not read ${file}. The e2e suite reads it to decide which apps to start and which specs to collect.`,
      { cause: error }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${file} is not valid JSON.`, { cause: error });
  }

  const installed =
    typeof parsed === "object" && parsed !== null && "installed" in parsed
      ? parsed.installed
      : undefined;
  if (
    !Array.isArray(installed) ||
    !installed.every((name) => typeof name === "string")
  ) {
    throw new TypeError(`${file} has no "installed" array of module names.`);
  }
  return { installed };
}

/** True when `saasaloy add` installed the named module. */
export function hasModule(config: SaasaloyConfig, name: string): boolean {
  return config.installed.includes(name);
}

export type App = keyof typeof PORTS;

/** The apps this project actually holds, in the order Playwright should start them. */
export function installedApps(config: SaasaloyConfig): App[] {
  const apps: App[] = [];
  if (hasModule(config, "api")) {
    apps.push("api");
  }
  // The base app. `saasaloy init` always scaffolds it, so it is never in `installed`.
  apps.push("web");
  if (hasModule(config, "admin")) {
    apps.push("admin");
  }
  return apps;
}

/**
 * The URL Playwright polls to decide an app has started.
 *
 * It is not the app's origin for `api`. Playwright reads any status at or above 400 as "not
 * ready", and the api Worker answers `GET /` with its 404 envelope — no route is mounted
 * there, on purpose — so waiting on the origin would time out on a Worker that is running
 * perfectly. `/health` is the route `api` ships for exactly this question.
 */
export const READY: Record<App, string> = {
  web: URLS.web,
  admin: URLS.admin,
  api: `${URLS.api}/health`,
};

/**
 * The account the admin specs sign in as. It is a seed row, not a fixture this suite
 * creates: the `auth` module's seed slices write it, and `prepare.ts` runs `pnpm db:seed`
 * before every run, which upserts it back to these values. Change it only together with
 * `packages/db/src/seed/slices/users.ts` and `accounts.ts`.
 */
export const SEED_ADMIN = {
  email: "superadmin@example.test",
  password: "saasaloy-dev-password",
} as const;
