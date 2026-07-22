# QA Plan: Remote-first module registry (`saasaloy add`)

_Generated 2026-07-23 · covers the uncommitted remote-registry change (reframed #23): giget fetch, `RegistrySource`, coordinate parsing, `saasaloy-lock.json`, interactive picker._

## Summary
- `saasaloy add` now fetches a module from a GitHub repo (default `mimukit/saasaloy`) at install time instead of reading a bundled copy; a local `SAASALOY_REGISTRY_DIR` is a dev/offline override.
- "Working" means: the right module + its `dependsOn` prerequisites are fetched, applied to the alias targets, recorded in `.saasaloy/manifest.json`, and pinned by commit SHA in `saasaloy-lock.json` — with a usable interactive picker when no module is named.

## Preconditions

- **Branch:** `issue-23-bundle-modules-registry-into-published-npm`.
- **Build the CLI first** — run:

```sh
pnpm --filter saasaloy build
```

- **A consumer project to add into.** A throwaway one under the gitignored `.dev/` works — run:

```sh
mkdir -p .dev/manualqa && cd .dev/manualqa
printf '{ "aliases": { "@ui": "packages/ui/src", "@web": "apps/web/src" }, "installed": [] }\n' > saasaloy.json
printf '{ "name": "manualqa", "version": "0.0.0", "private": true }\n' > package.json
```

- **For the OFFLINE cases (TC-1, TC-7):** point at the repo's own `modules/` dir with the env override — no network needed:

```sh
export SAASALOY_REGISTRY_DIR="$(git rev-parse --show-toplevel)/modules"
```

- **For the REMOTE cases (TC-2…TC-6): the seeded `modules/` must be reachable on GitHub.** They are **not on `main` yet**, so until this branch merges, **push the branch** and address it by ref, e.g. `mimukit/saasaloy@issue-23-bundle-modules-registry-into-published-npm/hello-widget`. Unset the override for these:

```sh
unset SAASALOY_REGISTRY_DIR
git push -u origin issue-23-bundle-modules-registry-into-published-npm
```

- **Invoke the CLI** from inside the consumer project as:

```sh
node <repo>/packages/cli/dist/index.js add ...
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Interactive picker when no module is named (offline) | 🔴 Critical |
| TC-2 | Real-network add from GitHub applies module + deps | 🔴 Critical |
| TC-3 | Lock pins the commit SHA; re-install reproduces it | 🔴 Critical |
| TC-4 | Picker over an explicit `owner/repo` (remote) | 🟡 Normal |
| TC-5 | `GITHUB_TOKEN` is honored | 🟡 Normal |
| TC-6 | Network / bad-source failure is graceful | 🟡 Normal |
| TC-7 | Error and output readability (offline) | 🟢 Low |

## Test cases

### TC-1 — Interactive picker when no module is named (offline)  ·  🔴 Critical
_Needs a real terminal — the picker is an interactive list that can't be scripted._

**Steps**
1. Ensure `SAASALOY_REGISTRY_DIR` is exported (Preconditions, offline).
2. From the consumer project, run with **no module argument**:

```sh
node <repo>/packages/cli/dist/index.js add
```

3. Use the arrow keys to move the selection; pick `hello-widget`; press Enter.
4. At the `Proceed?` prompt, confirm.

**Expected**
- A selectable list appears listing `hello` and `hello-widget` (sorted), labelled with the source.
- Arrow keys move the highlight; Enter selects.
- After confirming, `hello` is applied before `hello-widget` (dependency order).
- Ends with `Applied hello, hello-widget`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Real-network add from GitHub applies module + deps  ·  🔴 Critical
_Needs network + the branch pushed (Preconditions, remote). This is the core remote path that can't run offline._

**Steps**
1. `unset SAASALOY_REGISTRY_DIR` and use a **fresh** consumer project.
2. Run (substitute the pushed branch name for `<branch>`):

```sh
node <repo>/packages/cli/dist/index.js add mimukit/saasaloy@<branch>/hello-widget --yes
```

**Expected**
- The command fetches over the network (no monorepo, no env override) and succeeds.
- These files appear: `packages/ui/src/hello.ts`, `apps/web/src/hello.ts`, `apps/web/src/components/HelloWidget.tsx`, `.claude/skills/hello-widget/SKILL.md`.
- `zod` and `nanoid` are reported as dependencies to install.
- `saasaloy-lock.json` shows `source: "mimukit/saasaloy"` and a 40-char `resolved` SHA (not `local`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Lock pins the commit SHA; re-install reproduces it  ·  🔴 Critical
_Needs network. Verifies the reproducibility guarantee._

**Steps**
1. After TC-2, note the `resolved` SHA in `saasaloy-lock.json` for `hello-widget`.
2. Push a **new commit** to the registry branch that changes `modules/hello-widget/files/web/hello.ts` (so HEAD moves).
3. Re-apply against the existing lock:

```sh
node <repo>/packages/cli/dist/index.js add hello-widget --yes --force
```

**Expected**
- The re-install resolves the **locked SHA**, not the new branch HEAD — the applied `hello.ts` matches the original commit, not your new change.
- `saasaloy-lock.json`'s `resolved` SHA is unchanged.
- (Moving off the pin is only possible with an explicit `@ref` or a future `update` — confirm a plain `add` does **not** silently pick up the new commit.)

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Picker over an explicit `owner/repo` (remote)  ·  🟡 Normal
_Needs network + a terminal._

**Steps**
1. `unset SAASALOY_REGISTRY_DIR`.
2. Run with a repo but **no module**:

```sh
node <repo>/packages/cli/dist/index.js add mimukit/saasaloy@<branch>
```

3. Observe the picker; cancel with Ctrl-C or Esc.

**Expected**
- The picker enumerates modules discovered on that GitHub repo (`hello`, `hello-widget`) via one API call — no committed index file needed.
- The prompt label names the source (`mimukit/saasaloy@<branch>`).
- Cancelling exits cleanly with `add cancelled`, nothing written.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — `GITHUB_TOKEN` is honored  ·  🟡 Normal
_Needs network + a token._

**Steps**
1. Export a valid token and run a remote add:

```sh
export GITHUB_TOKEN=<your token>
node <repo>/packages/cli/dist/index.js add mimukit/saasaloy@<branch>/hello --yes
```

2. (Optional, if you have one) point the coordinate at a **private** registry repo you own and confirm it fetches.

**Expected**
- The add succeeds with the token set (same result as without, for a public repo).
- With a private repo, the fetch succeeds only when the token is present.
- The token value never appears in any printed output or error.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Network / bad-source failure is graceful  ·  🟡 Normal
_Needs network (or disconnect to simulate)._

**Steps**
1. `unset SAASALOY_REGISTRY_DIR` and target a repo that doesn't exist:

```sh
node <repo>/packages/cli/dist/index.js add no-such-owner/no-such-repo/widget --yes
```

2. Optionally, disconnect from the network and retry a valid coordinate.

**Expected**
- Fails with a clear message (e.g. `Not found on GitHub…` or `Could not fetch module…`), not a raw stack trace.
- No partial files are written; `saasaloy.json` / `saasaloy-lock.json` are untouched.
- A rate-limit hit (if you trigger one unauthenticated) suggests setting `GITHUB_TOKEN`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Error and output readability (offline)  ·  🟢 Low
_Judge the on-screen rendering — the strings are agent-confirmed; you're judging clarity._

**Steps**
1. With the offline override set, run each and read the output:

```sh
node <repo>/packages/cli/dist/index.js add a/b/c/d
node <repo>/packages/cli/dist/index.js add nope
node <repo>/packages/cli/dist/index.js add acme/mods/hello
```

**Expected**
- Malformed coordinate → a clear "Malformed coordinate … expected name, owner/repo, or owner/repo[@ref]/name".
- Unknown module → "Unknown module "nope" …".
- The `acme/mods/hello` case prints a visible `▲ Ignoring source … override is set` warning, then proceeds against the local dir.
- The Plan / Dependencies / Env-vars boxes are legible and correctly aligned.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `saasaloy init <dir>` still scaffolds a base project unchanged.
- [ ] `saasaloy add hello-widget --dry-run` (offline) previews the plan and writes **nothing**.
- [ ] `saasaloy add hello-widget --diff` (offline) shows per-file diffs and writes nothing.
- [ ] Hand-edit an already-applied managed file, re-run `add … --force` → the edited file is reported as **drift → merge** and left untouched (not clobbered).
- [ ] Re-running `add hello-widget` when already installed prints "Nothing to do" and exits 0.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm --filter saasaloy typecheck
pnpm --filter saasaloy test
pnpm --filter saasaloy build
# offline e2e in a throwaway .dev/qa project, via SAASALOY_REGISTRY_DIR:
node packages/cli/dist/index.js add hello-widget --yes      # + idempotent re-run
node packages/cli/dist/index.js add a/b/c/d                 # malformed coordinate
node packages/cli/dist/index.js add nope                    # unknown module
node packages/cli/dist/index.js add acme/mods/hello         # override-conflict warn
```

- ✅ `typecheck` → clean (no errors).
- ✅ `test` → 39 passed across 6 files (incl. coordinate parser, local source, lock build/roundtrip/schema-validate, "records only installed", "dep SHA preserved").
- ✅ `build` → tsup ESM build success.
- ✅ Offline `add hello-widget` → `dependsOn` resolved (`hello` applied before `hello-widget`); 4 files written to `@ui`/`@web`/`.claude/skills`; `.saasaloy/manifest.json` has 4 hashed entries.
- ✅ `saasaloy-lock.json` → `hello` + `hello-widget` recorded, `hello-widget` carries `dependsOn:["hello"]`, `lockfileVersion:1`.
- ✅ Incremental add (`hello` then `hello-widget`) → lock kept `hello`'s prior entry and appended `hello-widget` (only-installed recorded).
- ✅ Idempotent re-run → "Nothing to do — already installed".
- ✅ Malformed coordinate `a/b/c/d` → clear "Malformed coordinate" error, exit 1, nothing written.
- ✅ Unknown module `nope` → "Unknown module "nope" …" error.
- ✅ `acme/mods/hello` with override set → `▲ Ignoring source "acme/mods" — SAASALOY_REGISTRY_DIR override is set.`

## Not covered / needs human judgment
- **The real GitHub fetch path (giget download, Git-Trees enumeration)** — can't run until the seeded `modules/` are pushed to a reachable ref; that's exactly what TC-2…TC-6 exercise by hand.
- **The interactive picker** — TTY-only; can't be scripted, must be eyeballed (TC-1, TC-4).
- **Private-repo auth and actual rate-limit behavior** — need a private registry repo and/or a real 60/hr limit hit (TC-5, TC-6).
- **Cross-machine reproducibility** — TC-3 approximates it on one machine; true reproduction needs a second clone / teammate.
- **Third-party (non-`mimukit`) registries** — need someone to publish their own `modules/<name>/` repo; the mechanism is identical but unverified end to end here.
- **Temp-dir cleanup after remote fetches** — happens on the remote path only; not observable offline.
