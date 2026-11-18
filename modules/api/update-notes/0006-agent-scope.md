---
title: A callable route names its key scope
---

This note needs `api/0005-route-contract`. Apply it first.

## What update does

`apps/api/src/contract.ts` gives the callable branch of the agent statement one more field, `scope`. A callable route now states `agent: { callable: true, readOnly, confirm, scope }`, where `scope` is the key scope its gate demands, written `resource:action` (`books:read`), or `null` for a public route that demands no key. The `agent` module puts the word on each MCP tool and on its line in `llms.txt`. A closed route is unchanged.

`apps/api/src/contract.test.ts`, when the testing mode is on, names the scope in its sample route.

The `saasaloy-api` skill shows the field and says the statement names the scope while the route's gate enforces it.

## What the merge plan gets

- `apps/api/src/contract.ts`, if you edited it. Keep your edits and take the `scope: string | null` member of the callable branch.

## What you do

Add `scope` to every `callable: true` statement of a route you wrote yourself. `pnpm typecheck` names each one that lacks it. The shipped routes get theirs from their own module notes.

## Verify

```sh
pnpm typecheck
grep -rn "callable: true" apps/api/src/routes | wc -l
grep -rn "scope:" apps/api/src/routes | wc -l
```

The typecheck passes, and the second count is at least the first.
