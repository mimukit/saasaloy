# 0044: A descriptor declares the CLI it needs, and the PR that changes the contract bumps the CLI

The registry is this repo's `main` (ADR 0012), so a module change reaches every user on merge, while a CLI change reaches them only when the maintainer publishes. `saasaloy@0.5.2` met a registry whose descriptors used `envServices`, `envOptional` and the `@root` alias, rejected every one as an invalid descriptor, and left projects with no update path (#205). We decided that every descriptor some released CLI cannot read declares a `requires.saasaloy` range that excludes that release, that the CLI reads the range off the raw JSON before it reports schema errors, and that the PR which changes the descriptor contract bumps `packages/cli/package.json` to the version that will ship it. `packages/cli/src/lib/registry-floors.test.ts` enforces the first and last rule against the schema at every `v*` tag, plus a `BEHAVIOURS` table for a change the schema does not show. The release then publishes the version already in the tree with `pnpm release --no-increment`.

## Status

accepted

## Considered Options

- An integer `schemaVersion` on each descriptor. An old CLI rejects the new field as an unexpected property, which is the failure it was meant to explain, and a number cannot tell the user which CLI to install. `requires.saasaloy` already existed in 0.5.2's schema and names the version.
- A versioned registry path or an index file that maps a CLI to a registry ref. 0.5.2 fetches `modules/<name>` from the default branch of `mimukit/saasaloy` and nothing on the registry side can redirect it, so it helps only future CLIs, and it adds a second source of truth beside the descriptors.
- A CI check that fails `main` until npm carries a CLI that reads it. It turns a manual publish into a red build for every contributor, and it cannot run offline.
- Bumping the version only at release time, as before. A floor has to name a version the CLI in this tree satisfies, or the tree refuses its own registry, so the bump has to land with the floor.

## Consequences

- 0.5.2 and older validate before they read a floor, so they still print the schema errors. Their only fix is the next published CLI, and the PR that adds a floor asks for that release.
- The gap between a merge and the publish stays open. During it, a published CLI prints the upgrade line for a version npm does not have yet.
- CI checks out with `fetch-depth: 0`, because the test reads released schemas out of git, and it fails on a checkout with no tags rather than passing on nothing.
