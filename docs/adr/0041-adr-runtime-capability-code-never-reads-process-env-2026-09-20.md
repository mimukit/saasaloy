# 0041 — Runtime capability code never reads `process.env`; node tooling reads it freely

No file under a `packages/*/src` that a Worker imports reads `process.env`. The Worker's `env` object is the only source, and it arrives through `createEnv`. Node tooling — a setup script, a Pulumi program, `env-exec` — reads `process.env` with no ceremony. Settled while planning `docs/plans/0058-plan-env-capability-2026-09-20.md`.

## Status
accepted.

## Context

"Never read `process.env`" had been an unwritten rule in this repo since the first capability, and it was unwritten for a reason: it is not true of the whole repo. `scripts/` reads it. `infra`'s Pulumi program reads it. The `env` capability's own setup script has to read it, because that is where `INFISICAL_CLIENT_ID` arrives from in CI.

Stated too broadly, the rule gets ignored the first time someone hits a legitimate case, and then it stops binding anywhere. Stated with its boundary, it binds exactly where it matters.

## Decision

The rule binds **runtime capability code**: any file a Worker's bundle reaches. In practice that is everything under `packages/*/src` that a service imports, plus `apps/*/src`. Such a file reads its values from the object handed to it — `createEmail(c.env)`, `apiEnv(c.env)`, `webEnv()` — and never from a global.

Everything else reads `process.env` freely. `packages/env/scripts/env-setup.ts`, `packages/env/src/exec.ts`, `packages/env/src/providers/*`, `infra/index.ts`, and every file under `scripts/` in this repository.

The line is drawn at the bundle, not at the file extension, because the reason is mechanical. In a Worker there is no `process.env` to read: the value is `undefined` at best and a build error at worst, and the code that reached for it fails on the first request rather than at the gate. In node there is one, and pretending otherwise would mean passing an environment object through five call frames to reach the one function that needs it.

`infra` sits on both sides, and that is deliberate. `env-exec infra/.env -- pulumi up` loads the file into the process, and `infra/src/env.ts` then calls `infraEnv(process.env)` — node tooling reading the global, handing it to the same validator every Worker uses.

## Consequences

`createEnv` takes the source object as an argument and defaults to nothing. There is no "read the ambient environment" mode, which is the one design decision that keeps the rule enforceable rather than aspirational.

t3-env's code could not be reused for this reason among others: it reads `process.env` and validates at module scope, and a Worker can do neither. Its API shape was taken; none of its code ships.

Nothing lints this. The type error on a missing `env` argument and the Proxy on a client-side server key cover the failures that matter; a custom oxlint rule for `process.env` would fire on every file in `scripts/` and teach people to suppress it.
