# 0003 — Base is the landing page only

`saasaloy init` scaffolds a near-inert marketing shell — `apps/web` (Astro) + `packages/ui` + `packages/config` — and nothing else. Everything churny (API, database, auth, admin, features) installs on demand via `add`. A frozen base is exactly what rots; a landing page barely churns while auth/API/DB wiring churns constantly, so pushing all churny wiring into patchable modules and keeping the base inert is the anti-rot thesis taken to its end. See build-spec [§2.6](../plans/saasaloy-build-spec.md).

## Status
accepted — supersedes the draft's "auth in base"

## Considered Options
- Auth (and other wiring) shipped in the base — rejected: it puts the churniest code in the one place designed to be frozen. Auth is a capability module instead.
- A styled landing page in the base — the base was locked as plain, near-inert Astro (no Tailwind/React), resolving the tension between "near-inert" and Phase 0's "prove scaffolding + deploy."

## Consequences
- Only `apps/web`, `packages/ui`, `packages/config`, and the committed agent docs exist after `init`; everything else is `via add`.
