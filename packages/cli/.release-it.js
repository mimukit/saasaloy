// release-it config for the CLI. A JS file rather than JSON for one reason: the changelog
// plugin's `writerOpts.finalizeContext` is a function, and it links each breaking item to
// the update note its commit added (issue #298). The logic and its tests live in
// `scripts/changelog-update-notes.ts`.
//
// npm publishes last (ADR 0062). The CLI reads the default registry at the tag of its own
// version, so the tag must be on GitHub before npm offers that version to anyone.
// `./release-npm-last.js` is release-it's npm plugin moved behind git and github; its
// options go under the `npm` namespace exactly as the built-in plugin's did.

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
    "./release-npm-last.js": [
      "npm",
      {
        publish: true,
        allowSameVersion: true,
      },
    ],
  },
};
