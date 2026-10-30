// release-it config for the CLI. A JS file rather than JSON for one reason: the changelog
// plugin's `writerOpts.finalizeContext` is a function, and it links each breaking item to
// the update note its commit added (issue #298). The logic and its tests live in
// `scripts/changelog-update-notes.ts`.

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
  npm: {
    publish: true,
    allowSameVersion: true,
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
};
