# Research: "everything is a plugin" from DeepSeek Harness and Cordis, applied to Saasaloy

First research date is 2026-10-02, at Saasaloy commit `9f78cd8`. This revision is dated 2026-10-24, at Saasaloy commit `508dc4f6`, 405 commits later. Every external source was fetched again on 2026-10-24, and every Saasaloy claim was checked against the current code. The scope covers both Saasaloy plugin layers: the add-time module system (descriptors, patches, `add`, `remove`, `update`) and the runtime provider layer (`define<Cap>`, `<CAP>_PROVIDER`, registration tables). Settled ADRs are open to challenge in this report.

The 2026-10-24 revision adds two sections: [Plugin architectures besides Cordis](#plugin-architectures-besides-cordis) and the [final adoption list](#final-adoption-list), which replaces the old ranked list.

## Recommendation

The verdict holds. Adopt the Cordis model at add time, and adopt only its static part at runtime. Do not take Cordis or DeepSeek Harness as a dependency.

A Saasaloy descriptor is close to a Cordis component. The paper models a component as a triple (d, p, e): the keys it depends on, the keys it provides, and its effects, each with an inverse. A descriptor has d (`dependsOn`, and now `when`) and e (files and patches with `INVERSES`). It still has no p, and its d still names modules, not contracts. Fibers, reactive reload and hot reload exist to keep a long-lived process consistent while its parts change, and a Worker isolate is not such a process.

Cordis is no longer the only model worth taking from. Four other systems fix gaps that Cordis leaves open, and each fix is cheap at add time:

- Nix gives every ordered contribution a numeric order key, so the result depends on the set of modules and not on install order.
- Django migrations make "this step has no reverse" a declared state, not a silent gap.
- OSGi gives a contract key a cardinality (`1..1`, `0..1`, `1..n`) and splits version ranges for providers and consumers.
- Backstage gives typed service refs with a root or a per-request scope, and a `multiton` ref for list-valued providers.

Do these five first, in this order:

1. Make add order irrelevant and every edit reversible. Give ordered inserts an order key, give the two `package.json` patch kinds an inverse, and test add-then-remove and add order on the whole registry.
2. Decide between a shared capability kit and per-capability copies before #245 writes eight more contract suites.
3. Build one typed, lazy service context, and land it with the billing to subscription rename (#211), which already blocks #162.
4. Let descriptors declare the contract keys they provide and require, with a cardinality. Derive `conflictsWith` and `requiresOneOf` from them.
5. Record why each module is installed, so that a stack and an orphan dependency can be removed.

## What changed since 2026-10-02

### In Saasaloy

The add-time layer moved toward the Cordis model without citing this report. No plan, issue, ADR or PR cites research 0003.

- **Optional dependencies now have a declared form.** ADR 0054 adds `when: {installed: [...], testing: true}` to `files[]`, `scaffolds[].files[]` and `patches[]` (`packages/cli/src/lib/when.ts`, `packages/cli/src/lib/schema.ts:188`). `remove X` takes out every entry gated on X, and `add X` backfills them. Seven descriptors use it. `onlyWith` stays files-only, in ten modules.
- **Every descriptor declares its CLI range.** ADR 0044 made `requires.saasaloy` mandatory, and `packages/cli/src/lib/registry-floors.test.ts` checks the floors against release tags. All 47 descriptors declare it. Capability contract versions still do not exist.
- **The typed config schema exists.** PR #160 merged on 2026-10-15. Twelve capabilities ship a zod `src/env-preset.ts`, and providers append their presets through `plugin-array` patches. ADR 0052 adds config sections, one file per module, with a unique key that `saasaloy add` enforces (`packages/cli/src/lib/collisions.ts:228-260`). That key rule is the first Saasaloy use of the paper's single-source rule (O-Insert), but only for config sections.
- **The SPA side got a named, reversible UI seam.** ADR 0056 adds `defineShellExtensions` with `{id, Provider, header?}`. `admin` and `app` register into `shellExtensions.extensions` through a `plugin-array` patch gated on `command`. A duplicate `id` throws at load, and `remove` takes the entry out. Landing pages still have no seam (ADR 0030 is unchanged).
- **Per-call provider choice exists in one capability.** `PAYMENT_PROVIDER` takes a list (AGENTS.md:13). `modules/payment/files/src/define.ts:229` picks the first listed provider that offers the method, and `handleCallback(name)` finds a provider by name. That is the DSH `ctx.llm` routing shape.
- **A second exclusive driver pair exists.** ADR 0055 splits `api-keys` into a core plus `api-keys-organization` and `api-keys-user`, declared with `conflictsWith` and `requiresOneOf` by hand, as `database` does. `rbac` is gone (#167), so the old `api-keys` to `rbac` row is obsolete.
- **`add` runs unattended.** ADR 0046 adds `add --with <module>`, which answers `requiresOneOf` without a prompt. `add` and `remove` both have `--dry-run` and `--diff`, and `update` keeps a backup that `update --abort` restores (`packages/cli/src/lib/backup.ts`).
- **The registry grew from 38 to 47 modules**: 31 features and 16 capabilities. New: `api-keys-organization`, `api-keys-user`, `app`, `command`, `e2e`, `env-infisical`, `file-uploads`, `kv-upstash`, `payment`, `payment-console`, `payment-manual`, `shell`. Removed: `entitlements`, `infra`, `rbac`.

Four things got worse:

- **More irreversible patches.** No patch kind is new, but the two kinds with no inverse now carry 71 patches: 43 `package-json-dependency` and 28 `package-json-script`. ADR 0042 moved the database lifecycle scripts into the drivers, so `database-d1` alone carries 13 script patches. A driver switch probably leaves stale scripts behind. Nobody has tested that end to end.
- **More copies of the runtime contract.** Eight selection functions (`selectProvider` in seven `define.ts` files, plus `selectProviders` in payment) and seven capability error classes. The October count of six and five was already low: it was seven and six then.
- **More ambient state.** Three `AsyncLocalStorage` scopes (auth, billing, payment), up from two. Seven runtime files read `env` from `cloudflare:workers`, up from four. Payment copied the billing setter pattern, so there are seven module-level setters.
- **More module knowledge in the CLI.** `lib/dev-vars.ts` is gone, but the CLI now knows `packages/config/src/project.ts`, `packages/env/.env`, the env service names (`lib/env-example.ts:31`), `BILLING_APP_NAME` (`lib/doctor.ts:1318-1362`) and the app list in `lib/doctor.ts:1165`, which omits `apps/app`.

### In the external sources

- **DeepSeek Harness** moved eight prerelease tags, from `dsh-v0.2.0-rc.2` to `dsh-v0.2.1-rc.3` (commit `1f81c04`, 2026-10-23), across 1,931 commits. It is still a "developer preview" and accepts no external pull requests.
- **Cordis** moved from `v4.0.0-rc.10` to `v4.0.0-rc.12` (commit `01b3962`, 2026-10-21). That closes the three lifecycle issues the first report cited. There is still no v4 stable.
- **The paper** has no v2. Its theorems and its stated limits are unchanged.
- **The `dsh-plugin` ecosystem** grew 32% in repos and 52% in npm packages. The share of plugins that the version gate checks nothing for went up, not down.

Two figures in the first report were wrong at the old tag. DSH runs a vendored Cordis core 4.0.0-rc.7, not the rc.10 this report studied. The "about 40 seams" count was loose: 33 rows in the generated seam table carry the `seam` role, out of 92 services. Both are corrected below.

## What the sources are

### DeepSeek Harness

DeepSeek Harness (DSH) is an AI agent harness. The tag studied is `dsh-v0.2.1-rc.3` (commit `1f81c04`, 2026-10-23). The README says "developer preview ... THERE WILL BE COMPATIBILITY-BREAKING CHANGES", and CONTRIBUTING.md says the project cannot accept external pull requests. The repo was created on 2026-08-13, so the project is ten weeks old. It shows 260,401 stars.

The claim is literal. The agent loop, the tool registry, the session log and the model adapters are all plugins, and each one is a config row like any other. The non-plugin core is the vendored Cordis kernel (2,696 lines, unchanged since rc.2), a launcher of about 1,000 lines, and a boot library of about 3,000 lines at the top level (about 5,400 with its subdirectories). A running product is a profile. A profile is an ordered stack of bundles. A bundle is an npm package whose `package.json` points at a YAML patch that inserts or replaces config rows by `id`.

DSH uses three shapes for one service with several vendors:

- A single slot with exactly one provider, as with `ctx.shell` or `ctx.fs`. You swap the provider by replacing its config row. A second provider in the same scope throws.
- A registry service, as with `ctx.llm` or `ctx.storage`. Many adapters register side by side under route names, and each request names the route it wants. A duplicate route throws `DUPLICATE_ADAPTER`, and no partial registration stays.
- An isolation scope. A config group gets its own instance of a service name.

DSH names the pattern a "capability seam" with three roles. The Service Definition owns the request and result types. The provider and the consumer import only the definition. The generated table in `docs/capability-seams.md` lists 99 services, and 35 carry the `seam` role (92 and 33 at rc.2). New since rc.2: the seams `ctx.worktrees` and `ctx.workingDirectory`, and the core services `ctx.pluginMarket`, `ctx.remoteAccess`, `ctx.claudeCodeMods` and `ctx.webApp`. `ctx.invariants` is gone.

Errors are normalized per seam. `StorageError` uses a closed union of seven codes. `LlmError` uses an open string with a few constants. Third-party plugins invent codes outside that set (`AUTH_FAILED` against the core's `INVALID_CREDENTIAL`). The new plugin market normalizes its errors as `plugin-market/*` codes.

The repo rules in `packages/AGENTS.md` are these:

- "A registry's `register()` returns the disposer." Every registry ships a test that disposes the contributing plugin and asserts that its entries are gone. This rule is unchanged.
- Product-visible plugins must also pass a test that boots a real config through the loader. Two postmortems show why. A stray `export default` made the loader drop `inject` while 178 unit tests passed (0001). An unevaluated `!!js` expression in a `disabled` field was truthy and turned off all file tools (0002).
- New since rc.2: "Give shared state an owner". It bans module-level caches, singletons, `globalThis` and `Symbol.for` bypasses.
- New since rc.2: "Keep business rules in their own package".

Changes since rc.2 that bear on plugins:

- **The version gate prefers one field.** Since `0.2.1-alpha.4`, "third-party plugin compatibility prioritizes `engines.dsh` when declared". When it is present, that range alone decides. The refusal record field `peers` became `requirements`. The boot README still says "These checks are not a sandbox against malicious package code."
- **Upgrade guides are a checked artifact.** `scripts/verify-upgrade-guides.ts` enforces the path `v<semver>/<slug>/guide.md`, frontmatter, the sections `Change` and `Migration`, and a 500-word cap. There were 2 guides at rc.2 and there are 43 now.
- **Breaking renames again broke third parties.** The composer `stats` row split into `activity` and `usage`, and the notes say "Plugins replacing the former `stats` row must update their registered IDs." The public `webRuntime` service was removed. Discussion #9598 reports that plugins broke "silently", because the guide sat under `v0.2.1-alpha.1/`, the last version without the change, and the release notes did not mention it.
- **A plugin market exists.** `ctx.pluginMarket` reads user-configured index URLs. It ships in an optional bundle that is off by default. Discussion #9907 shows it reports `compatible: true` for a plugin that boot would refuse, because the market reads a different field.
- **Silent non-activation is the common complaint.** A plugin whose error went to a logger with no sink (#9308), a patch row with no `name` silently disabled by preflight while `--dump-config` still shows it (#10203), boot recovery that silently reset the user's bundle list (#9753), and a request for a "did it load" status with a third state, "refused" (#10776).
- **Duplicate in-box copies.** A plugin with an old runtime dependency overwrote host core packages (#10338). A second copy of `dsh-scope` blocks every session (#10382). Discussion #8287 now reproduces with a plain `peerDependencies` plus pnpm's `autoInstallPeers`.

### Cordis and the paper

Cordis is the kernel under DSH and Koishi. The tag studied is `v4.0.0-rc.12` (commit `01b3962`, 2026-10-21). The README still says the API "is not yet stable and may change without notice". The paper is "A Programming Paradigm for Spatiotemporal Composability" (arXiv 2608.25512v1, 92 pages, submitted 2026-08-26). No v2 exists.

The paper defines two properties. Quoted from P §1.1:

- "Temporal composability addresses the time dimension: upon removal of a component, the modifications the component made to the shared environment must be completely and safely reversed."
- "Spatial composability addresses the space dimension: components must be able to declare, discover, and resolve their dependencies on one another in a structured and verifiable manner."

An effect is a function that returns the new state and its explicit inverse. Service registration is itself such an effect, so a dependency link is undone like any other change. Four results matter for Saasaloy:

- Recovery exactness (Theorem 68). Removal restores the earlier state when each inverse reverts its own step.
- Ordering (Theorem 70). A provider withdraws only after its dependents deactivate.
- Single source (rule O-Insert). Two components may not provide the same key in one realm.
- Confluence (Theorem 80). The final state depends only on the set of active components, not on the order of insertions and removals.

The paper admits several limits. The runtime does not check that an inverse really reverts its effect. That is "an obligation on the component author" (P §5.1.1). Order-sensitive targets such as a middleware chain are "not commutative" and need an explicit order (P §3.4.2). Linking is nominal by key, so key collision and interface drift remain open (P §6.6). The evaluation is a Koishi case study on Cordis v3, and the paper says "measuring the abstraction's overhead ... remains future work" (P §5.3).

The code and the proofs diverged for a while. Cordis rc.11 (2026-10-14) shipped "service disposal now follows dependency order" (#196), which closed #26. Before that release, the Theorem 70 order did not hold in Cordis code. DSH, which runs a vendored rc.7, gets the order from its own lifecycle patch. rc.11 also closed the epoch race #34, and rc.12 closed #127 (disposed fibers settle to `DISPOSED`). rc.12 also stops service lookup at isolation boundaries (#209) and reports config errors with `file:line:column`.

In code, every registration (`provide`, `on`, timers, child plugins) passes through `ctx.effect` and is recorded on the plugin's fiber. When a provider changes, every dependent unloads fully and reloads. Service types still come from global TypeScript module augmentation, and `inject` keys are still plain strings. Optional inject is still "not planned" (cordis#97), because it "lied to the type system".

The core has no `node:` imports, no `eval` and no `new Function` at rc.12. The unminified npm `lib/index.js` gzips to 12,303 bytes at rc.12, up 5.6% from rc.10. The first report's 9.8 KB figure came from a minified bundle, so the two numbers do not compare. Nobody has run Cordis in workerd, and the repo has no issue about Workers.

DSH vendors Cordis core 4.0.0-rc.7 and Loader 1.0.0-rc.5, with 24 local modifications (22 at rc.2). A proposed plan (`vendor/cordis-rc11-upgrade-plan.md`, 2026-10-14) stages an rc.11 upgrade over about eight PRs and retires about seven of those modifications.

### The dsh-plugin ecosystem

| Measure | 2026-10-02 | 2026-10-24 |
|---|---|---|
| GitHub topic `dsh-plugin` repos | 17,085 | 22,532 |
| npm keyword `dsh-plugin` packages | 6,583 | 10,033 |

The 2026-10-24 npm sample is 480 packages from 24 random pages within the first 5,000 search results, so it still leans toward popular packages. The GitHub sample is 45 repos, one from each of 45 random creation days.

- 80% to 83% have a real bundle manifest, about two thirds have tests, about 30% export a typed config schema, and about 30% ship built output with no source. These ratios match the first sample.
- 48% of npm packages declare neither `engines.dsh` nor a DSH peer, so the gate checks nothing for them. The first sample gave 35%.
- Of the packages that declare a range, 30% exclude the current runtime (37% before). The split is the finding: 7% of `engines.dsh` ranges exclude it, against 40% of peer-only ranges. One explicit field works far better than an inferred one.
- 18 packages list an in-box `@deepseek-ai/*` package under `dependencies`, which is the duplicate-copy hazard of #8287 and #10338.

Discussion #5636 (a community scan that rated 94.7% of 590 plugins High or Critical) is still open. New comments propose a declarative permission manifest and a graded manifest diff on each update. No maintainer decision exists, and DSH ships no plugin permission model.

## Saasaloy against the model

| Cordis or DSH concept | Saasaloy at `508dc4f6` | Gap |
|---|---|---|
| Component (d, p, e) | `registry-item.json` (`packages/cli/src/lib/schema.ts:209-251`) | p is missing. d names modules, not contracts. Config section keys are the one provided key. |
| Required dependency (`inject`) | `dependsOn` | `api` still depends on `logger-console`, one provider, not on "a logger provider" (ADR 0023). |
| Optional dependency (`ctx.get`) | `when: {installed}` on files and patches (ADR 0054); `onlyWith` on files | Mostly closed. `when` names modules, not contracts. |
| Single-source key (O-Insert) | `conflictsWith` plus `requiresOneOf` | Declared by hand per pair, now in two pairs. A driver switch removes the dependents with it (ADR 0026 l.34). No `swap` command. |
| Registry service, many providers | `<cap>.providers` plus `<CAP>_PROVIDER`; list-valued for payment | Close fit, and stricter than DSH. Payment routes per call. |
| Effect with inverse | Patch kind plus `INVERSES` (`packages/cli/src/lib/patch/index.ts:268-275`) | The two `package.json` kinds (71 patches) have no inverse. Per-kind byte round trips and the auth plugin round trip (`auth-audiences-module.test.ts:104-142`) exist. No test covers `add M` then `remove M` for every module. |
| Confluence | Not tested. `test/matrix/combinations.test.ts` checks conflict reports only. | Array patches append in install order (`patch/ts-array.ts:89`, `patch/nav-entry.ts:62`), so a table's order depends on install history. |
| Service context with `inject` | Each caller runs `create<Cap>(env)`, in about 40 module files | A queue job gets no `env` (#162, blocked by #211). Seven module-level setters, three `AsyncLocalStorage` scopes, seven module-scope `cloudflare:workers` reads. |
| Config schema with defaults | zod env presets (PR #160) and config sections (ADR 0052) | Closed. The descriptor `envVars` is still a flat map, guarded against the presets by `scripts/env-presets.test.ts`. |
| Peer-range gate | `requires.saasaloy` on all 47 descriptors (ADR 0044) | CLI half closed. No capability has a contract version. No upgrade notes. |
| Bundle and profile | Stacks (plan 0016) | Open (#58). `lib/requested.ts` attributes each module to its root in one run, but nothing persists it. |
| Ordered middleware (`waterfall`) | None | No patch kind adds `.use()`. The ratelimit and feature-flags skills tell the owner to hand-write it. |
| Slots (`ctx.slots`) | SPA shell extensions (ADR 0056); landing blocks plus a manual wire-up (ADR 0030) | Closed for SPAs. Landing pages: `remove` cannot undo the wire-up. |
| Generated catalog | `saasaloy list --json`, generated CLI README | No module graph. Drift: `modules/README.md` lacks email, logger, sms and four more modules; `CONTEXT.md:60` omits most providers; `modules/storage/files/src/provider.ts:4` cites the wrong ADR. |
| "No privileged core" | CLI with module knowledge | Grew. `lib/updater.ts:59-61`, `lib/ui-blocks.ts:11-16`, `lib/doctor.ts` (ratelimit at 553-640, app list at 1165, config, env and billing at 1318-1362), `lib/env-example.ts:31`, `lib/collisions.ts:233-241`, `lib/design.ts:7`. |

## What the principle gives Saasaloy

"Everything is a plugin" helps Saasaloy in three concrete ways. Each maps to one Cordis property.

The first is spatial. A module depends on a contract key, not on a module name. Then `api` needs "a logger provider", and any provider satisfies it. A driver switch keeps its dependents, because they depend on `database.driver`, not on `database-d1`. ADR 0054's `when` already gives optional entries a declared form. Contract keys would let it name a capability in place of a module.

The second is temporal. Every edit has an inverse, a test proves it, and the result does not depend on install order. `remove` and `update` then become safe by construction, not by care. The stakes are known: ADR 0034 records an `update` incident that "destroyed about 1,229 lines of committed work".

The third is a core with no privileged knowledge. The CLI never learns a module name, and the base never learns a provider name. The CLI moved the other way this month, and each new hard-coded path is a place where a new module needs a CLI change.

The principle does not help the runtime lifecycle. A Worker isolate is short-lived and serves one deployment's fixed set of modules. Saasaloy changes modules at add time and in git, not in a running process.

## Plugin architectures besides Cordis

This section compares twelve plugin and module systems against Cordis. Each was read from its primary docs or source on 2026-10-24. The axes are the ones that decide fit for Saasaloy's two layers: the add-time copy-in CLI (A) and the per-request Worker runtime (R).

### Comparison table

| Architecture | Unit, and how it declares deps and provides | Removal and reversibility | When it composes | Isolation | Typed service lookup | Version gate | Order of non-commutative contributions | Fit |
|---|---|---|---|---|---|---|---|---|
| **Cordis (baseline)** | Plugin with `inject` keys, `provide` keys and effects | Every effect has an inverse on a fiber. Dependents unload first (since rc.11). | Runtime, hot | None, in-process | Global augmentation, string `inject`, no compile check | Peer range (DSH `engines.dsh`) | Needs an explicit order (P §3.4.2). Not built in. | A: model fits. R: no fit. |
| **Backstage backend** | Plugin, or a module that extends one plugin. `deps` are typed service refs and extension points. | No unload. "Removal" is uninstall. Extension points take additions only. | Boot | None. Plugin-scoped instances. | Typed `createServiceRef<T>` | Package semver | Modules init before their plugin. No order among modules. | R: strong. A: medium. |
| **Effect-TS Layers** | `Layer<ROut, E, RIn>` | Scoped finalizers released in reverse order | Program start or per scope | None | An unmet `RIn` stays in the type, so the program does not compile | npm semver | Explicit (`provide`, `merge`) | R: the typing idea only |
| **Nix module system** | A module declares options and defines values. Fixed point over all modules. | Remove the module and evaluate again. Pure, so reversal is free. | Build (evaluation) | None | Option types checked at evaluation | Flake lock | `mkBefore` 500, default 1000, `mkAfter` 1500. Priority via `mkDefault` 1000 and `mkForce` 50. | A: strong |
| **Angular schematics, Nx generators** | A Rule maps a Tree to a Tree. Collections. | No inverse. A staged Tree commits only when valid. Migrations go forward only. | Codegen (`ng add`, `nx g`, `nx migrate`) | None | Typed Tree API, JSON schema options | `migrations.json` keyed by package version | Rules run in an explicit sequence | A: staging and migrations |
| **Rails generators (Thor) and Django migrations** | Generator made of actions. Django: per-app migrations. | Thor `destroy` reruns actions with `behavior = :revoke`. Django ops have a reverse or raise `IrreversibleError`. | Codegen, migrate | None | None | Gem semver; Django `dependencies` | Script order; migration graph | A: the reversible-op model |
| **Terraform providers** | Provider binary. Resources hold state. Modules declare `required_providers`. | `destroy` derives from state, not config. Plan before apply. | Plan and apply | Separate process over RPC | Schema per resource | `~>` constraints and a lock file with hashes | Graph from references | A: medium. Saasaloy already keeps state. |
| **OSGi Declarative Services** | Bundle exports and imports packages. References carry cardinality. | A component deactivates when a mandatory reference goes away | Runtime, hot | Classloader per bundle | Java interface plus filter | Semantic package versions. Provider imports `[2.1,2.2)`, consumer `[2.1,3)`. | `service.ranking` | A: cardinality and version policy |
| **VS Code extensions** | Extension with static `contributes`, `activationEvents`, `extensionDependencies` | `context.subscriptions` disposed on deactivate; async dispose not awaited | Runtime, lazy | Separate host process, for stability, not security | `vscode.d.ts` | Required `engines.vscode`, cannot be `*` | Contribution lists, `when` clauses | A: contributions as data |
| **Fastify plugins** | `register(fn)`. Metadata: `name`, `fastify` range, required `decorators`, `dependencies`. | `onClose` hooks | Boot (avvio) | Encapsulated child context, not security | Declaration merging | `fastify: '5.x'` checked at register | Registration order | R: boot-time requirement check |
| **Rollup and Vite hooks** | Plugin object with typed hooks | None | Build | None | Typed hook signatures | Peer range | Hook kinds `first`, `sequential`, `parallel`; `order: pre/post`; Vite `enforce` | A and R: the order vocabulary |
| **Cloudflare service bindings and Dynamic Workers** | A Worker with `WorkerEntrypoint` RPC. Bindings are capabilities. | Redeploy | Deploy; Dynamic Workers at request time | Isolate per Worker. workerd is "not a hardened sandbox". | RPC stubs | Compatibility date | Not applicable | R: the only real boundary that fits |
| **Domain peers: Payload, Better Auth, Medusa v2, Nuxt** | Payload: `config => config`. Better Auth: `{id, endpoints, schema, hooks}`. Medusa: isolated modules plus link files. Nuxt: `defineNuxtModule` with `moduleDependencies`. | Payload: an `enabled` flag. Medusa: delete the link file, and `db:sync-links` drops the table. | Boot or build | Medusa: per-module container | Better Auth `$InferServerPlugin` | Nuxt `meta.compatibility`; `moduleDependencies.version` throws at start | Plugin array order | Both. Closest to Saasaloy's domain. |
| **shadcn registry (direct peer)** | `registry-item.json` with `registryDependencies`, `files[].target`, `envVars` | No `remove` command (issues #2001, #6348) | Add time | None. Copy-in source. | None | `@version` in deps | None | Saasaloy is already ahead |

Dropped from the field, with the reason:

- **NestJS and Angular DI.** Decorator DI covers the same ground as Backstage refs and Effect Layers with weaker typing.
- **Yeoman.** It has no inverse and no structured patch model. Schematics and Nx replace it on every axis.
- **webpack Tapable.** Its order ideas match Rollup and Vite, which document them better.
- **WebAssembly Component Model, WASI, Extism.** These give the strongest sandbox, but no Saasaloy module is untrusted. WASI 0.3 is still a preview, and the Extism JS SDK warns of breaking changes before 1.0.
- **Home Assistant and Grafana.** Their manifests repeat the OSGi and VS Code ideas. Grafana's distinct idea, plugin signing, does not matter when the source sits in the owner's git. Neither was fetched.

### What each one adds to Cordis

**Backstage backend system (v1.56.0 docs).** A plugin declares `deps` as typed `createServiceRef<T>({id})` handles. A ref has scope `root` (one instance) or `plugin` (one per plugin), and a `multiton: true` ref receives an array. Extension points live in the core's public `-node` package, not in the plugin, and every module finishes `init` before its plugin does. Backstage has no unload: removal is uninstall, so extension points take additions only. That matches Saasaloy, where removal happens in git. Take the root versus request scope split and `multiton` for rank 3. Do not take `defaultFactory`: it is a silent fallback, which the `<CAP>_PROVIDER` rule forbids. The Backstage frontend system adds extensions that `attachTo` a named slot input, disabled by default when order matters and ordered in app config. That is a worked design for landing-page slots.

**Effect-TS Layers.** A `Layer<ROut, E, RIn>` carries its unmet requirements in the type. A program whose requirement type is not `never` cannot run, which is the compile-time inject check Cordis lacks. Finalizers in a scope release in reverse order. Effect is a whole runtime and a programming style, so a generated project should not inherit it. Take only the type trick: a handler's declared needs must be a subset of the installed service table's keys.

**Nix module system (NixOS 26.05).** Every module contributes definitions to typed options, and evaluation takes a fixed point over all modules. Two numbers make the result independent of import order. An override priority picks a winner (`mkForce` 50, plain 100, `mkDefault` 1000, option default 1500). An order priority sorts merged lists (`mkBefore` 500, default 1000, `mkAfter` 1500). `mkIf` pushes a condition into each definition, which is what `when` does for Saasaloy patches. Nix has no effects at all, so removal is evaluation again and reversal is free. Take numeric order keys for ordered inserts and default-versus-force priority for config sections. Do not take the lazy language.

**Angular schematics (v22.2.3) and Nx.** A Rule maps a Tree to a Tree, and the Tree stages changes that reach disk "only once they're confirmed to be valid". `nx migrate` works in two phases: it bumps versions and writes `migrations.json`, then runs package-authored generators keyed by version, which the user can reorder or comment out. Neither system has inverses. Saasaloy already plans before it writes (`add --dry-run`, `update --abort`), so staging is mostly in place. Take module-authored, version-keyed migrations for contract changes. Do not take the free-form Tree API: typed patch kinds are safer.

**Rails generators and Django migrations.** Thor dispatches each generator action to `invoke!` or `revoke!` from one `behavior` flag, so `rails destroy` reruns the generator in reverse. That is the Cordis effect and inverse in a codegen tool. Thor's `inject_into_file#revoke!` shows the risk: a greedy regex, an ignored `gsub!` result, and success reported when nothing matched. Saasaloy's `reversePatch` returns a refusal reason instead, which is the better design. Django migrations give each operation a reverse or raise `IrreversibleError`, and `migrate app zero` undoes an app. Take that explicit marker: a patch kind with no inverse should be a declared state that `add` reports, not a gap a reader finds in a comment.

**Terraform providers (v1.17).** Providers are separate binaries over RPC. Core plans from config plus state, and `destroy` derives from state. The lock file records the version, the constraints considered and the hashes, and it goes in version control. The docs advise `~>` in root modules and a floor only (`>=`) in reusable ones. Saasaloy already holds the state half: manifest hashes and recorded patches. Take the version advice for capability contracts. Do not take process plugins.

**OSGi Declarative Services (Compendium 8.1).** A reference carries cardinality `0..1`, `1..1`, `0..n` or `1..n`, and `service.ranking` picks among several targets. The semantic-versioning policy is asymmetric: a provider of an API imports `[2.1,2.2)`, a consumer imports `[2.1,3)`, because adding a method breaks implementers but not callers. Cordis allows one provider per key and no cardinality. Take cardinality per contract key (logger `1..1`, payment `1..n`) and the asymmetric ranges for contract versions. Do not take dynamic rebinding.

**VS Code extensions (docs dated 2026-10-21).** Most contributions are static JSON in `contributes`, and since 1.74 a contributed command activates its extension without an activation event. The extension host is a separate process, and the docs justify it by stability, not security. `engines.vscode` is required and "cannot be `*`". Take the rule that a contribution is data the host renders, not code it runs. Saasaloy mostly does this already. Do not take activation events.

**Fastify plugins (v5.12.7).** `fastify-plugin` metadata declares a `fastify` semver range, the `decorators` a plugin needs on each target, and `dependencies` by name. Fastify checks them at register time. The `decorators` field is a key-based "requires" in miniature. Take the boot check: the Worker asserts on first request that every service key it needs has a registered provider, and fails with one message.

**Rollup 4 and Vite 8.3.4.** A hook has a kind: `first` (stop at the first non-null result), `sequential` or `parallel`. Each hook may set `order: 'pre' | 'post'`, and Vite adds plugin-level `enforce`. This is the vocabulary the paper leaves open for non-commutative targets. Take `pre`, `normal` and `post` bands (or numbers) for a middleware table, and the `first` kind as the stated rule for list-valued provider fall-through.

**Cloudflare service bindings, Workers for Platforms and Dynamic Workers.** A service binding calls another Worker with "zero overhead", by default on the same thread, through `WorkerEntrypoint` RPC. workerd connects services by "capabilities instead of global namespaces" and versions behaviour by compatibility date. Dynamic Workers load code at request time with exactly the bindings the loader grants. This is the only option here with a real boundary that fits the runtime. Take "bindings are capabilities" as the stated reason a provider reads only `env`. Hold "a module as its own Worker" for a future third-party module tier.

**Domain peers.** Payload recommends an `enabled` option to "disable the plugin without uninstalling it". Better Auth plugins contribute schema, endpoints and before and after hooks, and the client infers the server's endpoints. Medusa keeps each module's models private: a cross-module relation is a file in `src/links` that becomes a link table with no foreign key, and deleting the file then `db:sync-links` drops the table. Nuxt `moduleDependencies` takes a `version` that throws at start on mismatch, plus `defaults` and `overrides` for another module's options. Take Medusa links in place of patching a column into another module's table, and Nuxt `defaults` for seeding another module's config section. Do not take config-transform plugins at runtime: they make install order part of the meaning.

**shadcn registry (4.x).** Its item format is close to Saasaloy's: `registryDependencies` by name, namespace or URL; `files[].target` with alias placeholders; `envVars` that never overwrite. It has `add --diff`, `--dry-run` and `--overwrite`, and no `remove`. Saasaloy is ahead on removal, patches, the manifest and the lock. Take namespaced registries (`@acme/x`) only when a third-party module tier exists, together with #39.

### Verdict on the alternatives

No alternative replaces Cordis as the model, because none of them states both composability properties as clearly. Cordis names the goals: every effect reversible, every dependency declared by key, one provider per key, a result that depends only on the set. It leaves the mechanisms that reach those goals in a codegen tool to others. Nix supplies order independence, Django supplies declared irreversibility, OSGi supplies cardinality and version policy, and Backstage and Effect supply typed runtime lookup. Saasaloy's add-time layer is a better host for all of them than any runtime kernel, because its effects are pure `string → string` codemods that a test can run directly.

## Final adoption list

Each idea is ranked by value per cost. S means one PR in the CLI or one module. M means several modules or one new ADR. L means a descriptor format change across all 47 modules. "Source" names where the idea comes from.

| Rank | Idea | Source | Layer | Cost | ADRs and issues touched |
|---|---|---|---|---|---|
| 1 | Order keys on ordered inserts, inverses for the two `package.json` kinds, declared irreversibility, registry-wide round-trip and add-order tests | Paper Theorems 68 and 80; Nix `mkOrder`; Django `IrreversibleError`; DSH disposal test | A | M | 0006, 0019, 0031, 0034, 0042, 0054 |
| 2 | Capability kit and one contract suite per capability, decided before #245 | DSH capability seam; Rollup `first` | R | M | AGENTS.md core rule, 0033, 0037, #172, #245 |
| 3 | One typed service context with root and request scope, landed with #211 | Cordis `provide`/`inject`; Backstage refs; Effect `RIn`; DSH "give shared state an owner"; Fastify boot check | R | M | 0028, 0029, 0050, #162, #211 |
| 4 | Contract keys with cardinality: `provides`, `requires`; `when` accepts a key | Cordis (d, p, e); O-Insert; OSGi cardinality | A | L | 0005, 0013, 0018, 0023, 0026, 0033, 0037, 0054, 0055, #39 |
| 5 | Install reason in the lock, `remove --prune`, stack removal | DSH profile of bundles; Cordis confluence | A | S | 0006, plan 0016, #58 |
| 6 | Contract versions with asymmetric ranges, checked upgrade notes, module-authored migrations | OSGi semver policy; DSH `verify-upgrade-guides.ts`; `nx migrate`; Terraform version advice | A | M | 0044, 0006 |
| 7 | Ordered middleware table with phase bands | Paper §3.4.2; Rollup and Vite `order` and `enforce` | R | M | 0028 |
| 8 | Generated module graph, `saasaloy explain`, and a three-state status per entry | DSH generated seam table; DSH #10776 | A | S | None |
| 9 | Remove module knowledge from the CLI | DSH "no privileged core" | A | M | 0005 |
| 10 | Link tables owned by the extending module, in place of `drizzle-column` | Medusa module links | Both | M | 0020, 0038 (grill first) |
| 11 | Config section defaults from another module | Nix `mkDefault`/`mkForce`; Nuxt `defaults` | A | S | 0052 |
| 12 | Named landing-page slots | DSH `ctx.slots`; Backstage `attachTo`; ADR 0056 | Both | M | Reopens 0030 (grill first) |

Done or overtaken since 2026-10-02:

- **Typed config schema per module** (old rank 8). PR #160 and ADR 0052 cover it. The one leftover is `saasaloy env --schema`, which is a small addition, not a design.
- **A required CLI range** (half of old rank 6). ADR 0044 made it mandatory on every descriptor.
- **Per-call provider choice** (old rank 12). Payment does it with a list-valued `PAYMENT_PROVIDER`. Revisit only when a second capability needs it.
- **Optional dependencies on patches** (part of old rank 4). ADR 0054's `when` covers it.

### 1. Make add order irrelevant and every edit reversible

This stays first, and it got more urgent. The paper's recovery result holds only when each inverse reverts its own step, and its confluence result holds only when the order of insertions does not matter. Saasaloy fails both today: 71 patches have no inverse, and array patches append in install order.

- **Order keys.** Give every ordered insert (`plugin-array`, `const-array`, `nav-entry`, `chained-route`) an optional `order` number with a default of 1000, after Nix. The applier inserts by (order, module name). The final array then depends only on the installed set. Without this step, the add-order test fails by design.
- **Inverses for `package.json`.** Record the prior state in the manifest's patch record, as "absent" or as the old value. On `remove`, restore it when the current value still equals the one the patch wrote. ADR 0042 made this pressing: a database driver switch leaves the old driver's scripts behind.
- **Declared irreversibility.** After Django, a patch kind with no inverse is a typed state in the schema, and `add` reports it in its plan. Today the only record is a code comment at `packages/cli/src/lib/patch/index.ts:256-262`.
- **Tests.** Per-kind byte round trips already exist. Add a registry test: on a fresh base, `add M` then `remove M` gives the starting tree for every module M, and `add A B` and `add B A` give the same tree for every pair with no dependency edge. `test/matrix/combinations.test.ts` already walks every pair, so the add-order check can extend it.

The add-order test also answers an open question. `chained-route` appends in install order, and Hono matches routes in order. The test shows if any two modules produce overlapping paths whose order matters.

### 2. One capability kit, decided before #245

The runtime contract is now copied eight times for selection and seven times for the error class, and the copies drift. `SmsError` forces `retryable` to false outside two codes, and the others trust the caller. #245 plans a contract suite per capability, each one its own copy. If it lands first, the copies double.

- Ship `@repo/capability` with `defineCapability({ name, envKey, codes, selection })`, which returns the `define`, `create` and error class for one capability. `selection` takes `"one"`, `"list"` (the payment rule, with Rollup's `first` semantics stated) and `"optional"` (the logger rule in `modules/logger/files/src/define.ts`).
- Ship `runContractSuite(provider, fixtures)` with it. Each capability publishes its fixtures, and each provider module runs the shared suite under `when: {testing: true}`.
- Put the package in a `capability` module that every provider-taking capability depends on, not in the base, so the base stays inert (ADR 0003).

This needs the `AGENTS.md` core rule amended from "zero runtime dependencies" to "zero third-party runtime dependencies". The rule exists to keep a core vendor-blind, and an in-repo copy-in package keeps it vendor-blind. Refactor 0002 chose the `create-module` scaffold instead. A scaffold leaves eight copies that drift again. A shared package gets one fix to all eight through `update` (ADR 0006).

### 3. One typed service context, landed with the subscription rename

DSH added a rule this month that names the problem: "Give shared state an owner", with no module-level caches or singletons. Saasaloy has seven module-level setters, three `AsyncLocalStorage` scopes and seven module-scope `cloudflare:workers` reads. #162 says "`setBillingConfig` exists because a job handler gets no `env`", and #162 waits on #211, the billing to subscription rename. The rename rewrites those files anyway, so build the context first and let the rename land on it.

- Add a `services` registration table in `apps/api`. Each capability patches one entry, for example `{ key: "email", scope: "isolate", create: (env) => createEmail(env) }`.
- Two scopes, after Backstage: `isolate` (built once per isolate, for clients that hold no request data) and `request` (built once per invocation, for anything that carries a tenant or a session).
- `defineWorker` builds a lazy, memoized `services` object and passes it to `fetch` through `c.var` and to the `queue` and `scheduled` handler sets the same way.
- Derive the type from the table, after Effect. A handler that reads a service whose module is not installed fails typecheck.
- On first request, assert that every key in the table resolved, after Fastify, and fail with one message.

Do not use a proxy, async activation or global type augmentation. Open question 3 asks whether the context should also replace the auth `AsyncLocalStorage` scope.

### 4. Depend on contracts, not on module names

This is still the largest change. Add two descriptor fields and widen one:

- `provides`: contract keys, each with a cardinality. `email-console` provides `email.provider` (`1..n` across the registry, one chosen by env). `database-d1` provides `database.driver` (`1..1`). `api-keys-user` provides `api-keys.owner` (`1..1`).
- `requires`: contract keys. `api` requires `logger.provider`, and any logger provider satisfies it.
- `when.installed` accepts a key as well as a module name.

The resolver checks cardinality. A `1..1` key must have exactly one installed provider. This is O-Insert, and it replaces the two hand-declared `conflictsWith` and `requiresOneOf` pairs. A key with a lower bound of 1 needs at least one provider. When several modules could satisfy a missing key, `add` prompts on a TTY and refuses under `--yes` unless `--with` names one (ADR 0046).

Three wins follow. `saasaloy swap database-d1 database-postgres` becomes possible, because dependents require `database.driver`, which fixes the trap in ADR 0026 l.34. `api` stops forcing `logger-console` (ADR 0023). The module `type` can be derived from what a module provides, which ends the taxonomy wart at `CONTEXT.md:61`. Keep `dependsOn` for edges where the dependency really is another module's files. Namespace the keys to avoid the collision risk in P §6.6, together with #39.

### 5. Record why a module is installed

`lib/requested.ts` already computes which root pulled each module in during one `add` run. Persist it.

- Add `requestedBy` to each lock record: `user`, a stack name, or the module that pulled it in.
- Add `remove --prune`, which removes the modules that nothing installed requires any more.
- Define a stack as a named set of requested modules. Removing a stack un-requests its members, then prunes.

DSH #9753 is the warning: boot recovery silently reset a user's bundle list. `remove --prune` must list every module it takes out, and refuse under `--yes` when the list includes a module the user requested.

### 6. Contract versions and checked upgrade notes

The CLI range is done. The contract half is not.

- Give each capability a contract version, carried in the key: `email.provider@1`.
- Use the OSGi split. A provider declares the minor it implements (`[1.2, 1.3)`), and a consumer declares the major it calls (`[1.2, 2)`), because a new method breaks providers but not callers.
- Make `add` refuse a mismatch, and make `update` of a capability that bumps its contract list the installed providers that also need an update.
- Make upgrade notes a checked artifact, after DSH `verify-upgrade-guides.ts`: one file per contract change with `Change` and `Migration` sections and a word cap, filed under the version that ships the change. DSH #9598 shows what the opposite convention costs. When the owner holds the code, the note is the only channel for the change.
- When a change can be applied mechanically, ship it as a module-authored migration keyed by version, after `nx migrate`, and let the owner skip or reorder it.

### 7. An ordered middleware table

A middleware chain is ordered, so independent modules cannot append to it safely. Add a `middleware` registration table in `apps/api`. Each entry is `{ name, phase, handler }`, where `phase` is a fixed enum: `early`, `auth`, `tenant`, `late`. The base sorts by phase, then by name, so registration commutes and rank 1's add-order test covers it. `ratelimit` and the feature-flags maintenance middleware then ship without a hand edit.

### 8. Generate the catalog, and say what loaded

Hand-written docs drifted in new places this month (`modules/README.md`, `CONTEXT.md:60`, `modules/storage/files/src/provider.ts:4`).

- Generate the module graph into `modules/README.md` and the wiki from the descriptors, and check freshness in CI. `saasaloy list --json` already exposes most of the data.
- Add `saasaloy explain`. It prints each registration table in the project and the module that patched each line, from the manifest.
- Give each patch and gated file one of three states in `explain` and `doctor`: present, missing, or skipped by a `when` condition. DSH users asked for exactly this split (#10776), because "refused" and "failed" look the same from outside.

### 9. Remove module knowledge from the CLI

Replace each hard-coded path with an alias lookup or a descriptor field. `database` can declare its schema barrel. The ratelimit binding rule in `lib/doctor.ts:553-640` belongs in a test inside the `ratelimit` module or in a declarative descriptor check. The billing finding at `lib/doctor.ts:1318-1362` belongs in the billing module. The app list at `lib/doctor.ts:1165` should come from the project, which also fixes the missing `apps/app`. Do not put executable code in descriptors.

### 10. Link tables in place of cross-module columns (grill first)

Medusa keeps each module's tables private and puts a cross-module relation in a link table that the extending module owns. Removal then drops a table instead of reversing a column edit in another module's schema. Saasaloy has one `drizzle-column` patch today, so the gain is small until more modules extend shared tables. Grill it when the subscription rename (#211) or teams touch the `users` or `organizations` tables.

### 11. Config section defaults

ADR 0052 gives each module one section, and the owner edits `project.ts`. Let a module set a default in another module's section at Nix `mkDefault` priority, so `project.ts` always wins without a merge. Keep an explicit `force` for the rare case, and make `doctor` report every forced value.

### 12. Named landing-page slots (grill first)

ADR 0056 already proved the shape for SPAs: a factory registration table with an `id`, gated by `when`, removed by `remove`. The Backstage frontend system shows how to extend it to page layout: an extension `attachTo` a named slot input, disabled by default when order matters, ordered by config. Landing pages are bespoke and owners edit them heavily, so a slot table may become noise. This reopens ADR 0030. Grill it before you plan it.

## What not to adopt

- **Cordis as a dependency of generated projects.** It is still a v4 release candidate with a stability warning. DSH vendors an older RC with 24 local modifications. Service types still come from global augmentation, and its gains need a long-lived process.
- **Runtime plugin install from npm, a loader or a marketplace.** The new DSH data argues harder for copy-in. Duplicate in-box copies (#8287, #10338, #10382), a market that disagrees with boot (#9907), and 48% of plugins with no version gate are all failures that copied source in the owner's git avoids by construction.
- **Fibers, reactive reload and hot reload.** These have nothing to act on in a Worker or in a one-shot CLI command.
- **Whole-row config replacement and replace-by-id.** The `stats` row split broke third-party patches again this month.
- **Expressions in config (`!!js`).** Postmortem 0002 shows how a missed evaluation path fails silently. Workers also forbid `new Function`.
- **Global type augmentation for services.** Derive types from registration tables.
- **Silent fallbacks.** Backstage `defaultFactory` and the DSH preflight that silently disables a nameless row (#10203) both hide a missing piece. Saasaloy's refuse-never-guess rule (ADR 0046) is the better form.
- **A separate Worker or a WASM sandbox per module.** No first-party module is untrusted. Revisit only for a third-party tier.
- **Config-transform plugins at runtime** (Payload). They make install order part of the meaning.

## Where the evidence is weak

- DSH is ten weeks old and pre-release. Its 260k stars, and a sampled plugin repo with 41,168 stars created on 2026-09-24, look inflated. This report treats popularity as weak evidence and relies on code, release notes, postmortems and discussions.
- The paper has no quantitative evaluation and no new version. Its recovery and confluence proofs assume that each inverse is correct. Cordis code did not meet Theorem 70 until rc.11, which shows that a proof and an implementation can differ.
- Nobody has run Cordis in workerd. The bundle figures in the two revisions use different methods.
- The ecosystem figures come from samples. The npm sample leans toward popular packages, and the GitHub sample is stratified by creation day, so the zero-star share does not compare across the two runs.
- Several alternative-architecture claims rest on search summaries, not direct fetches: the Nx migration pages, Nuxt `moduleDependencies`, the Fastify `onClose` and decorator typing, and the OSGi classloader boundary. None of them carries a top-five item.
- Nobody has tested whether a `database-d1` to `database-postgres` switch leaves stale scripts behind. Rank 1's round-trip test settles it.

## Open questions

1. Rank 4 changes the descriptor format for all 47 modules. My pick is to add `provides` and `requires` beside `dependsOn` and let `doctor` warn during the migration. A single cut-over is the alternative. Still open.
2. Rank 2 contradicts refactor 0002 and the per-capability suites that #245 plans. Do you accept the amendment to the `AGENTS.md` core rule, and should #245 wait for the kit? Still open, and now time-bound by #245.
3. Rank 3 overlaps ADR 0029 and ADR 0050. Should the service context own the request-scoped database client and replace the auth, billing and payment `AsyncLocalStorage` scopes? Still open.
4. Should rank 3 land inside #211, or as its own issue that #211 then depends on? New.
5. Do order keys (rank 1) apply to every array patch, or only to tables where order has meaning? My pick is every one, with a default, so the add-order test needs no exceptions. New.
6. Rank 12 reopens ADR 0030. ADR 0056 now gives a pattern to copy. Grill it or drop it? Still open.

The first revision's question 4 (is PR #160 the home for the config schema) is answered: PR #160 merged with zod presets, and ADRs 0039 to 0041 and 0052 hold the decisions.

## Evidence (primary sources)

All fetched 2026-10-24 unless marked. Agent clones are in `/tmp/research-2026-10-24/` and are lost on the next container rebuild.

- DeepSeek Harness at `dsh-v0.2.1-rc.3`, commit `1f81c047fc48fa190a683e469daa699857e9afe8` (2026-10-23): https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.3
  - Releases `dsh-v0.2.1-alpha.1` to `rc.3`: https://github.com/deepseek-ai/deepseek-harness/releases ; compare: https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.0-rc.2...dsh-v0.2.1-rc.3
  - Stability and contribution policy: `README.md` l.11-13, `CONTRIBUTING.md` l.9
  - Capability seams (generated): `docs/capability-seams.md`
  - Repo rules: `packages/AGENTS.md`, `AGENTS.md`, `docs/testing.md`
  - Version gate: `packages/boot/app-boot/README.md` (l.52), `docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md`
  - Upgrade guide verifier: `scripts/verify-upgrade-guides.ts`
  - Plugin market: `packages/boot/plugin-market/README.md`
  - Postmortems 0001 to 0004: `docs/postmortem/`
  - Vendored Cordis (core rc.7, loader rc.5, 24 modifications): `vendor/README.md`; rc.11 upgrade plan: `vendor/cordis-rc11-upgrade-plan.md` (2026-10-14)
  - First-revision tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84` (fetched 2026-10-02): LLM registry `packages/llm/llm/src/index.ts` l.396-440, `StorageError` in `packages/storage/storage/src/error.ts`, web search selection `packages/web/web/src/index.ts` l.80-193
- Cordis at `v4.0.0-rc.12`, commit `01b396240ce47cf2779c40af9bc445bb748fe112` (2026-10-21): https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.12 ; rc.11, commit `0b96d9fd` (2026-10-14): https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.11 ; npm: https://registry.npmjs.org/cordis
  - Issues: https://github.com/cordiverse/cordis/issues/26 , /34 , /97 , /127 , /133 , /196
  - Fiber lifecycle and effects: `packages/core/src/fiber.ts`; service store: `packages/core/src/reflect.ts`
- Paper: Shi, Zhang, Cui, "A Programming Paradigm for Spatiotemporal Composability", arXiv 2608.25512v1 (2026-08-26), https://arxiv.org/abs/2608.25512 (§1.1, §3.4.2, §4.2.1, Theorems 68, 70, 80, §5.1.1, §5.3, §6.5, §6.6). `https://arxiv.org/abs/2608.25512v2` returns 404.
- Ecosystem: https://api.github.com/search/repositories?q=topic:dsh-plugin ; https://registry.npmjs.org/-/v1/search?text=keywords:dsh-plugin ; sample data in `/tmp/research-2026-10-24/npmdata/`. Discussions #5636, #5816, #8199, #8287, #9308, #9342, #9598, #9753, #9907, #10203, #10338, #10382, #10776 at https://github.com/deepseek-ai/deepseek-harness/discussions
- Backstage v1.56.0: https://backstage.io/docs/backend-system/architecture/services , https://backstage.io/docs/backend-system/architecture/extension-points , https://backstage.io/docs/backend-system/architecture/modules , https://backstage.io/docs/frontend-system/architecture/extensions
- Effect: https://effect.website/docs/requirements-management/layers/ , https://effect.website/docs/requirements-management/layer-memoization/ (no version shown)
- Nix: NixOS manual 26.05, https://nixos.org/manual/nixos/stable/ ; priorities and order values: https://raw.githubusercontent.com/NixOS/nixpkgs/master/nixos/doc/manual/development/option-def.section.md (master)
- Angular v22.2.3: https://angular.dev/tools/cli/schematics , https://angular.dev/tools/cli/schematics-authoring ; Nx (search summaries): https://nx.dev/docs/kb/migration-generators , https://nx.dev/docs/features/automate-updating-dependencies
- Thor (main): https://raw.githubusercontent.com/rails/thor/main/lib/thor/actions.rb , https://raw.githubusercontent.com/rails/thor/main/lib/thor/actions/inject_into_file.rb ; Django 5.2: https://docs.djangoproject.com/en/5.2/topics/migrations/
- Terraform v1.17: https://developer.hashicorp.com/terraform/language/expressions/version-constraints , https://developer.hashicorp.com/terraform/language/files/dependency-lock , https://developer.hashicorp.com/terraform/plugin/how-terraform-works
- OSGi Compendium 8.1: https://docs.osgi.org/specification/osgi.cmpn/8.1.0/service.component.html ; semantic versioning importer policy (2019-01-10): https://docs.osgi.org/whitepaper/semantic-versioning/060-importer-policy.html
- VS Code (manifest page dated 2026-10-21): https://code.visualstudio.com/api/references/extension-manifest , https://code.visualstudio.com/api/references/activation-events , https://code.visualstudio.com/api/advanced-topics/extension-host
- Fastify v5.12.7: https://fastify.dev/docs/latest/Reference/Plugins/ , https://github.com/fastify/fastify-plugin
- Rollup 4: https://rollupjs.org/plugin-development/ ; Vite v8.3.4: https://vite.dev/guide/api-plugin
- Cloudflare: service bindings (updated 2026-10-13) https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/ ; Workers for Platforms (updated 2026-10-15) https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/ ; Dynamic Workers (updated 2026-10-12) https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/ ; workerd: https://github.com/cloudflare/workerd
- WebAssembly: https://component-model.bytecodealliance.org/design/why-component-model.html , https://github.com/WebAssembly/WASI ; Extism: https://extism.org/docs/overview , https://github.com/extism/js-sdk
- Payload: https://payloadcms.com/docs/plugins/build-your-own ; Better Auth: https://www.better-auth.com/docs/concepts/plugins ; Medusa: https://docs.medusajs.com/learn/fundamentals/module-links , https://docs.medusajs.com/learn/fundamentals/modules/isolation ; Nuxt 4.1 (search summaries): https://nuxt.com/docs/4.x/api/kit/modules , https://nuxt.com/blog/v4-1
- shadcn: https://ui.shadcn.com/docs/registry/registry-item-json , https://ui.shadcn.com/docs/cli , https://github.com/shadcn-ui/ui/issues/2001 , https://github.com/shadcn-ui/ui/issues/6348
- Saasaloy at `508dc4f6`: `packages/cli/src/lib/patch/index.ts` (l.117-124, 256-275), `packages/cli/src/lib/patch/ts-array.ts:89`, `packages/cli/src/lib/patch/nav-entry.ts:62`, `packages/cli/src/lib/schema.ts` (l.142-251), `packages/cli/src/lib/when.ts`, `packages/cli/src/lib/collisions.ts:228-260`, `packages/cli/src/lib/requested.ts`, `packages/cli/src/lib/backup.ts`, `packages/cli/src/lib/doctor.ts`, `packages/cli/src/lib/updater.ts:59-61`, `packages/cli/src/lib/ui-blocks.ts:11-16`, `packages/cli/src/lib/env-example.ts:31`, `packages/cli/src/lib/registry-floors.test.ts`, `packages/cli/src/lib/auth-audiences-module.test.ts`, `packages/cli/test/matrix/combinations.test.ts`, `packages/cli/src/commands/add.ts`, `modules/*/registry-item.json`, `modules/payment/files/src/define.ts`, `modules/logger/files/src/define.ts`, `modules/billing/files/src/`, `modules/payment/files/src/store.ts`, `modules/auth/files/src/db-scope.ts`, `docs/refactor/0002-refactor-full-project-2026-09-15.md`, `docs/research/0004-research-testing-gaps-2026-10-23.md`, ADRs 0005, 0023, 0026, 0028, 0029, 0030, 0033, 0034, 0037, 0042 to 0056, issues #39, #58, #162, #172, #211, #245, PR #160.
