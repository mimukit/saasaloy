# 0064: The CLI publishes from a tag-started, approved workflow with npm trusted publishing

Until 0.8.0 the maintainer published `saasaloy` from this box. `packages/cli/release-npm-last.js` moved release-it's npm plugin behind the git and GitHub steps ([ADR 0062](0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md)), and npm asked for a one-time password from a local login. The package carried no provenance, and the publish depended on one machine's npm session. Plan [0112](../plans/0112-plan-release-pipeline-gaps-2026-11-19.md) settled the move in its grill, decisions "Order", "Publish trigger", "Publish auth", "What release-it still does", "Token publish", "`publish.yml` checks" and "A failed publish" (issue [#358](https://github.com/mimukit/saasaloy/issues/358)).

**A `v*` tag push starts `.github/workflows/publish.yml`, its job runs in the GitHub environment `npm` with the owner as required reviewer, and it publishes with npm trusted publishing (OIDC).** The job has `permissions: contents: read, id-token: write` and no `NPM_TOKEN` secret. The trusted publisher on npmjs.com names `mimukit/saasaloy`, `publish.yml` and the environment `npm`. The repository is public, so `npm publish --provenance` records a provenance attestation. **release-it no longer publishes.** `packages/cli/.release-it.js` sets `npm: { publish: false }`, so release-it still bumps `packages/cli/package.json`, writes `packages/cli/CHANGELOG.md`, commits, tags, pushes and creates the GitHub Release. `release-npm-last.js` is deleted.

## Status

accepted. Amends [ADR 0062](0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md): its consequence "The tag reaches GitHub before npm publishes" keeps its rule, and the mechanism is now this workflow instead of a reordered release-it plugin.

## Considered Options

- **Keep the local publish and ship 0.9.0 first, then move to OIDC.** Rejected. It ships sooner, but the owner wants 0.9.0 to be the first release with provenance.
- **Publish on `release: published` with no approval.** Rejected. Any push that makes a GitHub Release would reach npm with no human check. The tag push with a required reviewer keeps one check on what reaches npm.
- **An `NPM_TOKEN` secret in the repository.** Rejected. A long-lived token is a secret that can leak, and OIDC needs none.
- **Run the full gate again in `publish.yml`.** Rejected. The local preflight ran the gate and the tarball smoke on the tagged commit. The workflow checks only that its tarball is the one the tag names: the tag equals `v` plus the `packages/cli` version, the CLI builds, `pnpm pack` makes the tarball, the tarball installs, and `saasaloy --version` prints the version.

## Consequences

- **The tag reaches GitHub before npm publishes, by construction.** The publish starts from the tag push, so no version can reach npm before its tag. `scripts/release-order.test.ts` runs release-it in dry-run mode and fails on any `npm publish` step, and it fails when `publish.yml` starts on anything other than a `v*` tag push or runs a job outside the `npm` environment.
- **A tag can exist with no version on npm.** The approval can wait, or the job can fail. That delays users and breaks nothing, because no installed CLI names the tag until npm offers it. A failed job is rerun on GitHub. `scripts/release-preflight.ts` refuses a new release while `npm view saasaloy@<version of the last tag> version` finds nothing, so a skipped version cannot go unnoticed. A network error stops the preflight with npm's own error, and it never reads as a published or a missing version.
- **npm must be 11.5.1 or later in the job.** Trusted publishing needs it. A step fails by name when `npm --version` is lower. Node 24 ships npm 11, so no install step is needed.
- **A token publish stays as the emergency path.** When GitHub Actions is down, the maintainer runs `npm publish` from a checkout of the tag with the 2FA one-time code. That version has no provenance. The trusted publisher stays the normal path, and npm keeps token publishes allowed for this reason.
- **The repository's own workflows stay on action tags.** `publish.yml` uses `actions/checkout`, `pnpm/action-setup` and `actions/setup-node` by tag, as `ci.yml` does. SHA pins apply to the workflows that modules ship, not to this repository's `.github/` (plan 0112, non-goals).
- **`actionlint` checks the workflow from a Docker image pinned by digest.** Nothing is installed on the box. CONTRIBUTING.md, "Releasing", names the command.

## References

Issue [#358](https://github.com/mimukit/saasaloy/issues/358). Plan: [`0112-plan-release-pipeline-gaps-2026-11-19.md`](../plans/0112-plan-release-pipeline-gaps-2026-11-19.md), phase 6. Prior: [ADR 0062](0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md). Code: `.github/workflows/publish.yml`, `packages/cli/.release-it.js`, `scripts/release-preflight.ts` (`checkTagPublished`, `unpublishedTagMessage`). Tests: `scripts/release-order.test.ts`, `scripts/release-preflight.test.ts`.
