import type { DeployConfig } from "./types.ts";

// The gates `pnpm deploy:production` applies. This file is the project's: `saasaloy init`
// writes it once and `saasaloy update` never touches it again, so edit it freely. A key
// you delete falls back to the default named beside it.

export const deployConfig: DeployConfig = {
  // Deploy from main, or from a hotfix-<slug> branch cut from the last deploy tag.
  branches: ["main", "hotfix-*"],
  // Every deploy tag starts with this. The newest one is what is live.
  tagPrefix: "deploy-",
  // The GitHub Actions workflow that must pass on HEAD, such as "ci.yml". Unset turns
  // the CI gate off, and `pnpm deploy:production --dry-run` says so.
  ciWorkflow: undefined,
  // A new file here since the last deploy tag needs `pnpm deploy:production --migrate`.
  migrations: "packages/db/migrations/*.sql",
};
