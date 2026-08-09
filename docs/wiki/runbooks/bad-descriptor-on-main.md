# A bad descriptor reached `main`

The repo is the registry, so there is no build, no publish and no cache between a merge
and a downstream install. The moment a broken `modules/<name>/registry-item.json` lands on
`main`, it is what unpinned installs resolve. Treat it as an outage, not a stale artifact.

## Symptoms

A downstream `saasaloy add` cancels with one of the descriptor validation errors:

```
Unknown module "<name>" — no <name>/registry-item.json in the registry.
Module "<name>" has an invalid descriptor:
  <ajv errors, one per line>
Module folder "<name>" declares name "<other>" — the folder and descriptor name must match.
```

A module the graph pulled in as a prerequisite reports the same errors with
`(required by <module>)` appended.

## 1. Work out who is actually broken

Not everyone is, and the difference decides how loud you have to be.

**Protected.** A consumer running `saasaloy add <name>` where `<name>` already has an entry
in that project's `saasaloy-lock.json`, for the same `owner/repo`, with no explicit `@ref`
on the command line. That install rewrites the coordinate to the SHA the lock recorded and
never sees `main`'s tip.

**Not protected.** Everything else, which is most real traffic:

- a **first-time** `saasaloy add <name>` in any project. There is no lock entry, so the
  default branch resolves to its current tip.
- any add carrying an explicit `@ref`, including one that names `main`. An explicit ref
  skips the lock pin entirely.
- `saasaloy list`, which never reads a lockfile.

One more thing to know before you rely on `list` to detect this: `list` builds its names
from the repo's git tree and reads no descriptors, so **a broken module still appears in
the list**. It fails only at `add`. A green `list` proves nothing here.

## 2. Confirm the break locally

Reproduce from a clean checkout of `main`, without touching GitHub, by pointing the CLI at
the checkout:

```bash
git clone https://github.com/mimukit/saasaloy.git /tmp/saasaloy-check
cd /path/to/a/scaffolded/project
SAASALOY_REGISTRY_DIR=/tmp/saasaloy-check/modules saasaloy add <name> --dry-run
```

The local source uses the same loader and the same schema validation as a remote fetch, so
the error you get here is the error downstream users are getting. `--dry-run` stops before
anything is written.

## 3. Revert on `main`

There is no artifact to invalidate and no release to yank. The revert commit becomes the
new default-branch tip, and the next unpinned resolve picks it up.

```bash
git checkout main
git pull
git revert <bad-sha>
git push origin main
```

If the bad descriptor arrived in a merge commit, revert the merge (`git revert -m 1
<merge-sha>`). Prefer reverting over a forward fix while people are broken: a revert is one
reviewable commit that restores a state you know worked, and you can land the real fix
afterwards without a clock running.

Force-pushing over the bad commit would also work mechanically, but it orphans the SHA that
every lockfile written since the merge points at, which turns one broken module into
unreproducible installs. Do not do it.

## 4. Verify the fix

Re-run step 2 against a fresh clone, then confirm the remote path end to end from a
scratch project:

```bash
saasaloy init /tmp/verify-app --no-install
cd /tmp/verify-app
saasaloy add <name> --dry-run
```

`--dry-run` is enough: the descriptor is fetched, validated and planned before the write
stage, so it exercises everything that was failing.

## 5. Tell the affected users

Anyone who hit this needs one of two things:

- **Nothing**, if the revert is already on `main`. Their next `add` resolves the new tip.
- **A pinned coordinate**, if they need to move before the revert lands:

  ```bash
  saasaloy add mimukit/saasaloy@<last-good-sha>/<name>
  ```

  Any commit SHA or tag works. Because an explicit ref bypasses the lock pin, this also
  gets a user off a bad SHA their own lockfile already recorded.

## Why there is no faster lever

Merging is publishing
([ADR 0012](../../adr/adr-0012-remote-first-registry-repo-is-the-registry-2026-07-23.md)),
and the repo has no CI: there is no `.github/` directory, and `pnpm lint` is a declared
no-op that runs no tasks. Review is the only thing between a descriptor and every
downstream install. [#46](https://github.com/mimukit/saasaloy/issues/46) adds the gate that
would have caught this.

Until then, the cheap prevention is step 2 run *before* the merge. See
[Contribute a module](../how-to/contribute-a-module.md#test-it-before-you-open-the-pr).

_Verified against `main`@`48d32d7` on 2026-08-09._
