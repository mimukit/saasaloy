# Plan: fail a blank KV_KEY_PREFIX at env time under kv-upstash

Grilled: 2026-10-24

## Context

Issue #249, found in the review of #173. With `KV_PROVIDER=upstash`, a blank `KV_KEY_PREFIX` passes both env gates: `pnpm env:setup` and the `createEnv` call in `apps/api/src/env.ts`. The kv-upstash provider refuses the blank prefix only on its first call (`keyPrefix()` in `modules/kv-upstash/files/upstash.ts`). The ratelimit middleware defaults to `onError: "allow"`, so that first-call failure lets every request past the limiter until someone reads the logs.

Three things in the code stop a fix inside kv-upstash alone:

- `flatten()` in `packages/cli/templates/base/packages/env/src/define.ts` puts a preset's own `extends` before the preset itself, and `collect()` lets the last preset win. kv-upstash appends its preset into `kvPreset.extends`, so kv's own optional `KV_KEY_PREFIX` (default `""`) always overrides anything kv-upstash declares.
- The applier unions `envOptional` across one `add` run (`packages/cli/src/lib/applier.ts`, the `envOptional` set near line 669 and the loop near line 885). `saasaloy add kv-upstash` on a project without kv installs kv in the same run, so `renderEnvExample` (`packages/cli/src/lib/env-example.ts`) keeps the `# Blank on purpose` marker on `KV_KEY_PREFIX`, and `pnpm env:setup` accepts the blank value.
- `scripts/env-presets.test.ts` requires a module's preset to name exactly its `envVars`. kv-upstash must list `KV_KEY_PREFIX` in its own `envVars` before its preset may declare the key.

Goal: a project on Upstash cannot deploy a blank key prefix, so the limiter never fails open for this reason. No number fits. The check is behavioural: in a `.dev` project with kv-upstash installed and `KV_KEY_PREFIX=` blank, `pnpm env:setup` fails and names `KV_KEY_PREFIX`, and the api's `createEnv` throws an `EnvValidationError` that names `KV_KEY_PREFIX (kv-upstash)`. The same project on kv-memory or kv-cloudflare still accepts the blank value.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the override happens | Split kv's preset. A new top-level `kvCorePreset` holds `KV_PROVIDER` and `KV_KEY_PREFIX`. `kvPreset` keeps no keys of its own and starts as `extends: [kvCorePreset]`. The `plugin-array` codemod appends (`appendEntry` in `packages/cli/src/lib/patch/ts-array.ts`), so a provider preset lands after `kvCorePreset` and wins. |
| Why not change `flatten()` order | Rejected. Parent-first order would change the precedence of every preset in every project, for one capability's need. The kv split keeps the change inside kv. |
| Why not a refine in the kv core | Rejected. A `superRefine` that reads `KV_PROVIDER === "upstash"` puts a vendor name into the vendor-blind core (AGENTS.md, "The core is vendor-blind"). |
| `kvCorePreset` stays a top-level const | Its keys sit at four-space indent, which is the shape `declaredKeys()` in `scripts/env-presets.test.ts` reads. A preset nested inline in the `extends` array would hide the keys from that test. |
| kv-upstash's declaration | Add `KV_KEY_PREFIX` to kv-upstash's `envVars` (required wording, e.g. `staging:` or the project name) and to `upstashEnvPreset` as `z.string().min(1)`. No `envOptional` entry. `emptyStringAsUndefined` turns `KV_KEY_PREFIX=` into unset, so the gate reports `unset` with kv-upstash's description. |
| The provider's own check | `keyPrefix()` in `upstash.ts` stays. A caller can build the client without the env gate, and the check costs nothing. |
| Applier rule for the marker | A key gets `# Blank on purpose` only when every module that declares it in the run lists it in `envOptional`. Track the declaring modules and the optional-listing modules per key, and emit the intersection. |
| Two separate runs | Already correct, no change. `add kv` writes the marker, and a later `add kv-upstash` declares the key without `envOptional`, so `renderEnvExample` rebuilds the comment from the description and drops the marker. Phase 2 adds a test that pins this. |
| Description in `.env.example` | Last declaring module wins in `envVars`, and the plan orders kv before kv-upstash, so kv-upstash's required wording lands in the key list. Phase 2 asserts it. |
| CLI floor | Only kv-upstash needs the applier change. Set kv-upstash's `requires.saasaloy` to `>=0.8.0`. `packages/cli/package.json` is at `0.8.0`, the newest tag is `v0.7.0`, and `modules/app` already requires `>=0.8.0`. kv's floor stays at `>=0.7.0`, because its change is a payload file only. |
| Existing kv-upstash projects (grill Q1, asked) | Upgrade note only. The fix commit body and `saasaloy-kv/SKILL.md` say: projects that added kv-upstash before 0.8.0 delete the `# Blank on purpose` line above `KV_KEY_PREFIX` in `packages/env/.env.example`. `createEnv` still guards them until they do. `saasaloy update` sends their patched `env-preset.ts` to the merge plan, and the resolver keeps `upstashEnv()` after `kvCorePreset`. |
| `saasaloy remove kv-upstash` (grill Q2, asked) | Add a `removeWarnings` line to kv-upstash: `KV_KEY_PREFIX` stays required in `packages/env/.env.example`; if the next provider allows a blank prefix, add the `# Blank on purpose: this key may stay empty.` line above it, or keep a value. No remover change. |
| Marker rule across runs (grill Q3, defaulted) | Within one run only. Two separate runs already drop the marker. Re-adding kv with kv-upstash installed is the one path that restores it, and it stays out of scope. |
| Breaking change (grill Q4, defaulted) | No. A blank prefix already failed on the first call, so no working project breaks. Ship as `fix(kv-upstash):` with the upgrade note in the body. |
| `kvCorePreset` visibility (grill Q5, defaulted) | Module-private `const`, not exported. `createEnv` output types come from the service's own keys, not from `extends`. |
| Outward actions and attended work (grill build-stop) | None beyond the implementation's own branch and PR. No phase is attended, and the `.dev` checks run unattended. No follow-up issue is filed. |
| Test approach | Three existing runners, no new one. `test:base` (`packages/env/src/define.test.ts`) pins "a later preset in `extends` overrides an earlier one". `test:tooling` (`packages/cli/src/commands/add.test.ts`, beside the existing `envOptional` cases) pins the marker rule. `test:scripts` keeps the preset and `envVars` match. A `.dev` project run checks the kv wiring end to end, because no in-repo test can import `@repo/env` from a module payload. |

## Approach

Follow the issue's proposed change. It reuses the `extends` composition that `createEnv` already has, the `appendEntry` codemod behaviour, the existing `envOptional` field and `BLANK_ON_PURPOSE` marker, and the preset test as it stands. No new mechanism ships.

### Phase 1: provider preset wins over the kv core (built 2026-10-24)

- `modules/kv/files/src/env-preset.ts`: move the two keys into `export const kvCorePreset = definePreset({ module: "@repo/kv", server: { ... } })`. Make `kvPreset = definePreset({ module: "@repo/kv", extends: [kvCorePreset] })`. Keep the "keep this line in exactly this shape" comment, and add one that states the order rule: `flatten` runs `extends` in array order, the last declaration of a key wins, so `kvCorePreset` stays first and a provider preset appended after it may tighten a core key.
- `modules/kv-upstash/registry-item.json`: add `KV_KEY_PREFIX` to `envVars` with required wording. Set `requires.saasaloy` to `>=0.8.0`, or to the next unreleased CLI version if 0.8.0 has shipped by then. Add the `removeWarnings` line from Design decisions.
- `modules/kv-upstash/files/env.ts`: add `KV_KEY_PREFIX: z.string().min(1).describe(...)`. Replace the comment that says the key stays optional with the reason it is required here (one Redis database is one flat keyspace).
- `packages/cli/templates/base/packages/env/src/define.test.ts`: add a case where an inner preset declares a key optional and a later preset in the same `extends` array declares it `min(1)`. A blank value must throw and name the later preset's module.

Done when: `pnpm test:base` and `pnpm test:scripts` pass, including the new override case, and `pnpm lint` passes.

### Phase 2: the marker needs every declaring module (built 2026-10-24)

- `packages/cli/src/lib/applier.ts`: replace the plain `envOptional` union with per-key tracking. Emit a key in `plan.envOptional` only when each module that declares it in `envVars` also lists it in `envOptional`.
- Tests, beside the existing `envOptional` cases in `packages/cli/src/commands/add.test.ts`: one run that adds kv and kv-upstash together leaves no marker on `KV_KEY_PREFIX` and carries kv-upstash's description; one run that adds kv and kv-memory keeps the marker; two runs (`kv`, then `kv-upstash`) end with no marker.

Done when: `pnpm test:tooling` passes with the three new cases, and in a `.dev` project `saasaloy add kv-upstash` (kv not yet installed) writes `packages/env/.env.example` with no `# Blank on purpose` line above `KV_KEY_PREFIX`.

### Phase 3: docs and the end-to-end check (built 2026-10-24)

- Add the upgrade note for existing kv-upstash projects to `modules/kv/skills/saasaloy-kv/SKILL.md`, and carry the same note in the fix commit body.
- Update the `KV_KEY_PREFIX` wording where it says "optional" without the Upstash exception: `modules/kv/skills/saasaloy-kv/SKILL.md`, `modules/README.md`, `docs/wiki/modules.md`, and `docs/wiki/how-to/deploy-to-cloudflare.md` if it touches the key.
- Run the check from Context in a `.dev` project: kv-upstash with a blank prefix fails both gates; a filled prefix passes both; kv-memory with a blank prefix passes both.

Done when: the `.dev` run shows `pnpm env:setup` failing on `KV_KEY_PREFIX` and `createEnv` throwing `KV_KEY_PREFIX (kv-upstash): unset` under kv-upstash with a blank value, and both gates passing under kv-memory with the same blank value.

## Open questions

None. The grill on 2026-10-24 settled every question the draft raised. See the rows marked "grill" in Design decisions.

## Non-goals

- No change to `flatten()` or `collect()` order in `packages/env`.
- No change to the ratelimit `onError: "allow"` default.
- No new vendor logic in the kv core.
- No change to kv-cloudflare or kv-memory: a blank prefix stays valid there.
- No `saasaloy update` or `saasaloy remove` change to `.env.example`. Existing projects get an upgrade note, and `remove` gets a warning.
