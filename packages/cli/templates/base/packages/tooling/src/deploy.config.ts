import type { DeployConfig } from "./types.ts";

// The gates `pnpm deploy:production` applies. This file is the project's: `saasaloy init`
// writes it once and `saasaloy update` never touches it again, so edit it freely. A key
// you delete falls back to the default named beside it.

export const deployConfig: DeployConfig = {
  // Release and deploy from main, or from a hotfix-<slug> branch cut from the last
  // deploy tag. `pnpm release` reads this list too.
  branches: ["main", "hotfix-*"],
  // Every deploy tag starts with this. The newest one is what is live.
  tagPrefix: "deploy-",
  // The GitHub Actions workflow that must pass on HEAD, such as "ci.yml". Unset turns
  // the CI gate off, and `pnpm deploy:production --dry-run` says so.
  ciWorkflow: undefined,
  // A new file here since the last deploy tag needs `pnpm deploy:production --migrate`.
  migrations: "packages/db/migrations/*.sql",
  // What `pnpm release` writes before a deploy: a version, CHANGELOG.md and a tag.
  release: {
    // Every release tag starts with this, so the first release is v0.1.0.
    tagPrefix: "v",
    // Create a GitHub Release. It needs GITHUB_TOKEN or a signed-in gh.
    githubRelease: true,
    // Below 1.0, a breaking change bumps the minor. Run pnpm release major for 1.0.0.
    preMajor: true,
    // The changelog sections, as the conventionalcommits preset's `types`. Unset keeps
    // the preset's list: feat, fix, perf and revert show, and a breaking commit always does.
    changelogSections: undefined,
  },
};
