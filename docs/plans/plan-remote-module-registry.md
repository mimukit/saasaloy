# Plan — Remote-first module registry (reframes #23)

> Status: hardened via grillkit + three researchkit passes (shadcn registry, skills.sh, giget/degit).
> Supersedes the original #23 premise ("bundle `modules/` into the published npm package").
> Related ADR: remote-first, repo-is-the-registry (see `docs/adr/`).

## 1. Problem & pivot

`saasaloy add <module>` reads its registry off disk via `findRegistryDir()`
(`packages/cli/src/lib/registry.ts`). The original #23 aimed to **bundle `modules/`
into the npm tarball** so a real install could find it.

We are **not** doing that. The owner decided **remote-first**: adding a module pulls
its files from a GitHub repo at install time. This collapses the build spec's two
phases (local applier now, remote registry "later") into one — the `readFile → fetch`
graduation happens **now**. Consequences:

- `modules/` **stays at repo root**, authored as today. The `create-module` skill and
  docs are unchanged.
- `packages/cli/package.json` `files` is **untouched** — nothing new ships in npm.
- The auto-disk candidates in `registry.ts` (`../modules`, `../../../modules`) are
  **removed** and replaced by a `RegistrySource` abstraction (remote default + local
  dev override).

## 2. Distribution model — the repo *is* the registry (skills.sh)

Adopted from skills.sh (`vercel-labs/skills`), not shadcn's build-and-serve model:

- **No `build` step, no committed index, no central submission.** A registry repo is
  just `modules/<name>/registry-item.json` + `modules/<name>/files/` (+ optional
  `skills/`), by convention.
- **Default source = `mimukit/saasaloy`** (the CLI's own repo), `modules/<name>/`.
- Discovery is a **separate, optional** concern (the interactive picker), not a
  per-repo committed artifact.

Contrast rejected: shadcn requires `registry.json` + `shadcn build` → served
`/r/<name>.json` + namespaced-URL config. That solves a curated central catalog and
validation-at-fetch — problems we don't have.

## 3. Module coordinate & resolution

Grammar accepted by `saasaloy add`:

| Input | Resolves to |
|---|---|
| `waitlist` | default repo (`mimukit/saasaloy`), module `waitlist`, default branch |
| `owner/repo/waitlist` | third-party repo, module `waitlist`, default branch |
| `owner/repo@ref/waitlist` | pinned ref (branch/tag/SHA) |
| `owner/repo` | **no module → interactive picker** over that repo |
| _(no arg)_ | **interactive picker** over the default repo |

- **Default ref = the repo's live default branch.** Reproducibility comes from the
  **resolved commit SHA written to the lockfile**, not from hand-pinning tags.
- **`dependsOn` = intra-repo only (v1).** A bare `dependsOn: ["api"]` resolves to a
  sibling in the **same source repo** the module came from (shadcn's "bare = same
  registry" rule). Cross-repo (`owner/repo#module`) is a **follow-up issue**.

## 4. Fetch layer — giget (unjs)

- Use **`giget`** (`downloadTemplate("github:owner/repo/modules/<name>#<sha>", { dir, auth })`).
  Zero runtime deps, ESM, tarball-based, SHA-pinned subtree extraction.
- Flow per module: **resolve branch → commit SHA** (GitHub Git-Trees API) → **giget
  fetch subtree at `#<sha>`** to a temp dir → **read files → sha256 each → apply** into
  the consumer project → record in `.saasaloy/manifest.json` + `saasaloy-lock.json`.
- **Auth:** honor `GITHUB_TOKEN` / `GIGET_AUTH`. Tokenless public works (60 req/hr);
  token raises to 5000/hr and unlocks private registries.
- **Temp-dir lifecycle & caching:** delegated to **giget's cache feature** — do not
  hand-roll temp management.

## 5. Enumeration (picker)

- No-arg `saasaloy add`, or `saasaloy add owner/repo`, triggers an interactive picker.
- Enumerate via the **GitHub Git-Trees API** (`GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`,
  one call) filtered to `modules/*/registry-item.json`. **No committed index** — zero
  author burden, consistent with skills.sh.
- Render with `@clack/prompts` (already a dependency).

## 6. State files (consumer project)

| File | Role | Change |
|---|---|---|
| `saasaloy.json` | intent — `aliases` + `installed[]` (names) | unchanged |
| **`saasaloy-lock.json`** | **provenance — machine-owned** | **new** |
| `.saasaloy/manifest.json` | applied-file ledger (path→{module,hash}) | unchanged |

`saasaloy-lock.json` (npm-style split from `saasaloy.json`) records the full resolved
graph. **Integrity = the GitHub commit SHA** (immutable anchor); no separate integrity
hash field, no custom-domain coverage.

```json
{
  "$schema": "https://saasaloy.dev/schemas/saasaloy-lock.schema.json",
  "lockfileVersion": 1,
  "modules": {
    "waitlist": { "source": "mimukit/saasaloy", "ref": "main", "resolved": "<sha>", "dependsOn": ["api", "database"] },
    "api":      { "source": "mimukit/saasaloy", "ref": "main", "resolved": "<sha>", "dependsOn": ["database"] },
    "database": { "source": "mimukit/saasaloy", "ref": "main", "resolved": "<sha>" }
  }
}
```

New JSON schema `saasaloy-lock.schema.json` alongside the existing three in
`packages/cli/schemas/`. `registry-item.schema.json` is **reused as-is**.

## 7. CLI internals

- Refactor `findRegistryDir` / `readModule` (`packages/cli/src/lib/registry.ts`) into a
  **`RegistrySource`** abstraction:
  - **remote (default)** — coordinate parse → resolve SHA → giget fetch → yield
    descriptor + file bytes.
  - **local dev override** — `SAASALOY_REGISTRY_DIR` points at a local checkout
    (dev/offline; giget also accepts local paths). Retained.
- Remove the auto-disk candidates (`../modules`, `../../../modules`).

## 8. Scope of THIS issue (reframed #23) — components 1–7

Delivered here:
1. giget fetch core (+ `GITHUB_TOKEN`).
2. `RegistrySource` refactor + `SAASALOY_REGISTRY_DIR` local override.
3. Coordinate parsing (`name` | `owner/repo/name` | `owner/repo@ref/name` | `owner/repo`).
4. `saasaloy-lock.json` (schema + read/write; SHA-anchored).
5. Intra-repo `dependsOn` resolution.
6. Interactive picker (Git-Trees enumeration → clack).
7. Temporarily seed `hello` / `hello-widget` to e2e `saasaloy add hello-widget`
   from real GitHub (no monorepo fallback, no env override), then remove the fixtures
   after manual QA so the default registry contains only real modules.

### Acceptance criteria
- [x] `saasaloy add hello-widget` fetches from `mimukit/saasaloy` over the network and
      applies files into a fresh consumer project (packed/installed CLI, no monorepo).
- [x] `saasaloy add owner/repo/name` resolves against the requested GitHub repo.
- [x] No-arg `saasaloy add` (and `saasaloy add owner/repo`) shows an interactive picker
      of available modules.
- [x] `saasaloy-lock.json` is written with `source` + `ref` + resolved `sha` + resolved
      dep graph; a second install against the committed lock reproduces identical bytes.
- [x] `dependsOn` resolves intra-repo (topologically sorted, behind the confirm prompt).
- [x] `GITHUB_TOKEN` is honored when present (higher rate limit / private repos).
- [x] `SAASALOY_REGISTRY_DIR` still works as a local dev/offline override.
- [x] Auto-disk candidates removed from `registry.ts`.

## 9. Follow-up issues (not in this issue)

1. **Cross-repo `dependsOn`** (#26, `blocked` by #23) — explicit `owner/repo#module`
   form; resolver fans out across multiple source repos + SHAs; lock records each dep's
   distinct source.
2. **`saasaloy update`** (#17) — re-resolve branch → new SHA, rewrite lock, AI-merge on
   drift. Folded into the existing full-update-flow issue, not a new one.
3. **`saasaloy remove`** (#27, `ready`) — undo applied files via the manifest.
4. _(later, maybe)_ custom-domain / non-GitHub sources; dedicated `saasaloy/registry`
   repo split.

> This issue: **#23** (reframed, implementation and QA complete; pending merge).

## 10. Non-goals / explicit cuts
- No bundling of `modules/` into npm; `packages/cli` `files` unchanged.
- No `build`/serve step, no committed registry index.
- No integrity field beyond the commit SHA; no custom-domain support.
- No CI e2e against real GitHub for now (unit tests use disposable fixtures; manual
  real-network QA was completed against temporary modules before they were removed).
