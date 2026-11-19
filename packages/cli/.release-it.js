// release-it config for the CLI. A JS file rather than JSON for one reason: the changelog
// plugin's `writerOpts.finalizeContext` is a function, and it links each breaking item to
// the update note its commit added (issue #298). The logic and its tests live in
// `scripts/changelog-update-notes.ts`.
//
// release-it never publishes to npm (ADR 0064). It bumps the version, writes the changelog,
// commits, tags, pushes and creates the GitHub Release. The tag push starts
// `.github/workflows/publish.yml`, which waits for the owner's approval in the GitHub
// environment `npm` and then publishes with npm trusted publishing (OIDC) and provenance.
// So the tag reaches GitHub before npm offers the version, by construction (ADR 0062).
// `npm.publish: false` keeps the built-in npm plugin for the version bump only, and
// `allowSameVersion` lets `pnpm release <version> --only-version` keep a version that a
// PR already set. `scripts/release-order.test.ts` checks that a dry run runs no publish.

import { finalizeUpdateNotes } from "../../scripts/changelog-update-notes.ts";

// release-it fills `${version}` itself. The string is its placeholder, not a JS template.
// oxlint-disable-next-line no-template-curly-in-string
const TAG = "v${version}";

export default {
  git: {
    requireBranch: "main",
    requireCleanWorkingDir: true,
    requireUpstream: true,
    requireCommits: true,
    commitMessage: `chore(release): ${TAG}`,
    tagName: TAG,
    tagAnnotation: `Release ${TAG}`,
  },
  github: {
    release: true,
    releaseName: TAG,
  },
  hooks: {
    "before:init": ["pnpm -w run release:preflight"],
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: { name: "conventionalcommits" },
      infile: "CHANGELOG.md",
      header: "# Changelog",
      ignoreRecommendedBump: true,
      writerOpts: {
        finalizeContext: (context) => finalizeUpdateNotes(context),
      },
    },
  },
  npm: {
    publish: false,
    allowSameVersion: true,
  },
};
