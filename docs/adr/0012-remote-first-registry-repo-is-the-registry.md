# 0012 — Remote-first registry: the GitHub repo is the registry

`saasaloy add <module>` fetches modules from a GitHub repo at install time (default source `mimukit/saasaloy`, path `modules/<name>/`) instead of reading a copy bundled into the published npm package. This brings the remote registry forward from "a later phase" (build-spec §2.11, ADR 0002) to now, and adopts skills.sh's model — **the repo *is* the registry**: no build step, no committed index, no central submission. The applier design from ADR 0002 is unchanged; only the *sourcing* of descriptors moves from disk-read to remote fetch.

## Status
accepted — amends [ADR 0002](0002-local-applier-over-shadcn-descriptors.md) (collapses its deferred `readFile → fetch` graduation into now, and revises its "pin to tags, never `main`" consequence — see Consequences).

## Considered Options
- **Bundle `modules/` into the npm tarball** (the original framing of #23) — rejected: forces relocating/copying the registry into `packages/cli`, ships a stale snapshot, and still leaves the "real" remote registry as unbuilt future work. Two mechanisms to maintain instead of one.
- **shadcn model** — `registry.json` index + `shadcn build` → served per-item JSON + namespaced-URL config — rejected: solves a curated central catalog and validation-at-fetch, problems we don't have; adds a build/publish step and a served-artifact that can drift from the authored tree.
- **Custom-hosted `registry.saasaloy.dev`** — rejected (as in 0002): infra for no v1 benefit; a custom domain is an optional later front.
- **Hand-rolled fetch** (codeload tarball + tar extractor, or per-file raw GETs) — rejected in favour of **giget** (unjs): zero-dep, ESM, SHA-pinned subtree extraction, `GITHUB_TOKEN` auth, and caching, out of the box.

## Consequences
- **Reproducibility moves from ref-pinning to a lockfile.** 0002 said "pin to tags, never `main`." Instead the default ref is the live default branch, and a new `saasaloy-lock.json` records the resolved commit **SHA** (plus source, ref, and the resolved dep graph) — so a re-install reproduces identical bytes without hand-pinning. Integrity *is* the commit SHA; no separate integrity field, no custom-domain coverage in v1.
- `modules/` **stays at repo root**; `packages/cli` `files` is untouched — nothing new ships in npm.
- `findRegistryDir`/`readModule` become a **`RegistrySource`** abstraction: remote (default) + `SAASALOY_REGISTRY_DIR` local override (dev/offline). The auto-disk candidates `../modules` and `../../../modules` are removed.
- Adds a runtime dependency on **giget**; the CLI honours `GITHUB_TOKEN`/`GIGET_AUTH` (tokenless public works at GitHub's unauth rate limit).
- **`dependsOn` is intra-repo only** in v1 (bare name = sibling in the same source repo); cross-repo `owner/repo#module` is deferred (#26).
- Anyone can publish a registry by pushing a `modules/<name>/` repo — no submission, consumed via `saasaloy add owner/repo/name`.

## References
Plan: `docs/plans/plan-remote-module-registry.md`. Issues: #23 (this), #26 (cross-repo deps), #27 (`remove`), #17 (update flow, amended).
