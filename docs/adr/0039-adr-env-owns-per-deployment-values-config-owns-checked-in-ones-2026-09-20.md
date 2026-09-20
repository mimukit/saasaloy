# 0039 — `env` owns per-deployment values, `config` owns checked-in ones

A value the platform supplies at runtime and that differs per deployment belongs to the `env` capability, secret or not. A value checked into the repository and identical in every deployment belongs to `config` (#154). One rule, no overlap. Settled while planning `docs/plans/0058-plan-env-capability-2026-09-20.md`.

## Status
accepted.

## Context

`env` and `config` were planned as two capabilities in the same week, and both answer "where does this value live". Without a rule, the boundary drifts to whichever one a contributor opened first, and a value ends up in both — which is worse than either, because two places that can disagree always eventually do.

The tempting rule is "secret versus not secret". It does not survive contact. `PUBLIC_API_URL` is not a secret and cannot be checked in: it is `http://localhost:4000` on a laptop and `https://api.example.com` in production. `BILLING_LOCKOUT_DAYS` is not a secret either and *can* be checked in: fourteen days is the product's policy, not the deployment's.

## Decision

The question is not secrecy. It is **who supplies the value, and does it change between deployments**.

`env` owns a value the platform supplies at runtime: a Workers secret, a binding, a `.env` line, a CI variable. It is listed in `packages/env/.env.example`, distributed by `pnpm env:setup`, and validated by `createEnv`. `EMAIL_FROM`, `DATABASE_URL`, `PUBLIC_API_URL` and `STRIPE_SECRET_KEY` are all `env`, and only the last is a secret.

`config` owns a value the repository supplies: a TypeScript literal a reviewer reads in a diff. It has no per-deployment form, so there is nothing to distribute and nothing to validate at the edge. `BILLING_LOCKOUT_DAYS`, a feature's default page size, the list of supported locales.

A value that is checked in but *overridable per deployment* is an `env` key with a default in the schema. `createEnv` already carries defaults, so this needs no third home.

## Consequences

A module author asks one question when adding a value: does a deployment change it? Yes puts it in `envVars` and the capability's env preset. No puts it in the package's own config module.

The drift test in `scripts/env-presets.test.ts` enforces the `env` half — a key in `envVars` with no preset, or a preset key no descriptor declares, fails the suite. Nothing enforces the `config` half yet, because `config` does not exist; #154 inherits that job.

`env` grew two defaults that look like config — `BILLING_LOCKOUT_DAYS` and `STORAGE_MAX_UPLOAD_BYTES` are both in presets with a default. They are there because they were `envVars` before this record and moving them is a breaking change for a project already setting them. #154 should reconsider both.
