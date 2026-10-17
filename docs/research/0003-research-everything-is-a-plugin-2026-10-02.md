# Research: "everything is a plugin" from DeepSeek Harness and Cordis, applied to Saasaloy

Research date is 2026-10-02. The repository reference is commit `9f78cd8`. The scope covers both Saasaloy plugin layers: the add-time module system (descriptors, patches, `add`, `remove`, `update`) and the runtime provider layer (`define<Cap>`, `<CAP>_PROVIDER`, registration tables). Settled ADRs are open to challenge in this report.

## Recommendation

Adopt the Cordis model at add time, and adopt only its static part at runtime. Do not take Cordis or DeepSeek Harness as a dependency.

The Saasaloy add-time layer is already close to a Cordis orchestrator. The paper models a component as a triple (d, p, e). These are the keys it depends on, the keys it provides, and its effects, each with an inverse. A Saasaloy descriptor has d (`dependsOn`) and e (files and patches with `INVERSES`). It has no p. Its d names modules, not contracts. The paper itself names "scaffold tooling" as the remedy for its own granularity cost (P §6.5). So the model fits the CLI better than it fits a Worker.

The runtime half of Cordis does not fit. Fibers, reactive reload of dependents and hot reload exist to keep a long-lived process consistent while its parts change. A Worker isolate never sees a provider leave during a request. Saasaloy gets the useful part (a typed service context built from a registration table) without the proxy, the async activation or the global type augmentation.

Do these five first, in this order:

1. Make every patch kind reversible. Then test add-then-remove and add order on the whole registry.
2. Move the six copies of `selectProvider` and the five error classes into one small capability kit. Ship one contract conformance suite per capability with it.
3. Build one typed, lazy service context and pass it to the `fetch`, `queue` and `scheduled` entry points.
4. Let descriptors declare the contract keys they provide and require. Derive `conflictsWith` and `requiresOneOf` from those keys.
5. Record why each module is installed, so that a stack and an orphan dependency can be removed.

## What the sources are

### DeepSeek Harness

DeepSeek Harness (DSH) is an AI agent harness. The tag studied is `dsh-v0.2.0-rc.2` (commit `639ed01`, 2026-09-29). Its README calls it a "developer preview" with breaking changes to come. The repo was created on 2026-08-13, so the project is seven weeks old.

The claim is literal. The agent loop, the tool registry, the session log and the model adapters are all plugins. Each one is a config row like any other. The non-plugin core is the vendored Cordis kernel (about 2,700 lines), a launcher of about 990 lines and a boot library of about 2,600 lines. A running product is a profile. A profile is an ordered stack of bundles. A bundle is an npm package whose `package.json` points at a YAML patch that inserts or replaces config rows by `id`.

DSH uses three shapes for one service with several vendors:

- A single slot with exactly one provider, as with `ctx.shell` or `ctx.fs`. You swap the provider by replacing its config row. A second provider in the same scope throws.
- A registry service, as with `ctx.llm` or `ctx.storage`. Many adapters register side by side under route names, and each request names the route it wants. A duplicate route throws `DUPLICATE_ADAPTER`, and no partial registration stays.
- An isolation scope. A config group gets its own instance of a service name.

DSH names the pattern a "capability seam" with three roles. The Service Definition owns the request and result types. The provider and the consumer import only the definition. The docs list about 40 seams.

Errors are normalized per seam. `StorageError` uses a closed union of seven codes. `LlmError` uses an open string with a few constants. Third-party plugins already invent codes outside that set (`AUTH_FAILED` against the core's `INVALID_CREDENTIAL`).

The repo rule is that "a registry's `register()` returns the disposer". Every registry ships a test that disposes the contributing plugin and asserts that its entries are gone. Product-visible plugins must also pass a test that boots a real config through the loader. Two postmortems show why. A stray `export default` made the loader drop `inject` while 178 unit tests passed. An unevaluated `!!js` expression in a `disabled` field was truthy and turned off all file tools.

### Cordis and the paper

Cordis is the kernel under DSH and Koishi. The tag studied is `v4.0.0-rc.10` (commit `f8ea3cd`). The README says the API "is not yet stable". The paper is "A Programming Paradigm for Spatiotemporal Composability" (arXiv 2608.25512, 92 pages).

The paper defines two properties. Quoted from P §1.1:

- "Temporal composability addresses the time dimension: upon removal of a component, the modifications the component made to the shared environment must be completely and safely reversed."
- "Spatial composability addresses the space dimension: components must be able to declare, discover, and resolve their dependencies on one another in a structured and verifiable manner."

An effect is a function that returns the new state and its explicit inverse. Service registration is itself such an effect, so a dependency link is undone like any other change. Four results matter for Saasaloy:

- Recovery exactness (Theorem 68). Removal restores the earlier state when each inverse reverts its own step.
- Ordering (Theorem 70). A provider withdraws only after its dependents deactivate.
- Single source (rule O-Insert). Two components may not provide the same key in one realm.
- Confluence (Theorem 80). The final state depends only on the set of active components, not on the order of insertions and removals.

The paper admits several limits. The runtime does not check that an inverse really reverts its effect. That is "an obligation on the component author" (P §5.1.1). Order-sensitive targets such as a middleware chain are "not commutative" and need an explicit order (P §3.4.2). Linking is nominal by key, so key collision and interface drift remain open (P §6.6). The evaluation is a Koishi case study. Koishi runs Cordis v3, and the paper describes v4. The paper says "measuring the abstraction's overhead ... remains future work" (P §5.3).

In code, every registration (`provide`, `on`, timers, child plugins) passes through `ctx.effect` and is recorded on the plugin's fiber. A fiber's identity depends on its providers. When a provider changes, every dependent unloads fully and reloads. Service types come from global TypeScript module augmentation. The `inject` list is a plain string array, so a missing inject compiles and fails at runtime. The maintainer removed optional inject because it "lied to the type system" (cordis#97).

The core has no `node:` imports and no `eval`. It bundles to about 9.8 KB gzipped. The loader, the YAML include and hot reload are Node-only. Building a `Context` cost about 1.2 ms in one run on this box, and each proxied service read cost about 16 µs.

### The dsh-plugin ecosystem

The `dsh-plugin` topic has 17,085 repos, and npm has 6,583 packages with the keyword. A random sample of 100 repos gives these figures:

- 84 have a real bundle manifest and 65 have tests.
- Only 31 export a typed config schema.
- 28 ship built `lib/` output with no source.
- 52 have zero stars.

Of the 13 top-30 repos that carry only the tag, none ships a DSH patch file. The topic is noisy.

Three findings bear on Saasaloy.

- Version gates fail when authors skip them. Of 2,000 npm plugin manifests, 708 declare no DSH peer, so the host checks nothing for them. Of the 1,292 that declare one, 482 (37%) exclude the current runtime. Upgrade 0.1 to 0.2 left 11 of 22 bundles broken for one user (discussion #8199).
- Replacement by row id breaks. Plugins replace official providers by disabling official rows by `id`. A core rename then breaks the patch. A whole-row config replace drops keys that the patch did not repeat.
- In-process plugins have no security boundary. Host plugins run with full user privileges. A community scan rated 94.7% of 590 plugins High or Critical (self-reported, discussion #5636).

## Saasaloy against the model

| Cordis or DSH concept | Saasaloy today | Gap |
|---|---|---|
| Component (d, p, e) | `registry-item.json` | p is missing. d names modules, not contracts. |
| Required dependency (`inject`) | `dependsOn` | `api` depends on `logger-console`, one provider, not on "a logger provider" (ADR 0023). `api-keys` depends on `rbac` but needs its files (plan 0060 l.17). |
| Optional dependency (`ctx.get`) | `onlyWith` on files only | Patches have no condition. Plan 0065 l.113 lists the workarounds. |
| Single-source key (O-Insert) | `conflictsWith` plus `requiresOneOf` | Declared by hand per pair. A driver switch removes the dependents with it (ADR 0026 l.34). |
| Registry service, many providers | `<cap>.providers` array plus `<CAP>_PROVIDER` | Close fit. Saasaloy is stricter than DSH, because the env var is required. |
| Effect with inverse | Patch kind plus `INVERSES` (`packages/cli/src/lib/patch/index.ts:263-270`) | `package-json-dependency` and `package-json-script` have no inverse. No test checks add then remove. |
| Confluence | Not tested | Nobody knows if `add a b` and `add b a` give the same tree. |
| Service context with `inject` | Each caller runs `create<Cap>(c.env)`. Billing uses five module-level setters. | A job handler gets no `env` (#162). Two `AsyncLocalStorage` scopes. Four files read `cloudflare:workers` at module scope. |
| Config schema with defaults | `envVars`, a flat map of descriptions | No type, default or scope (plan 0058 l.13). PR #160 is in review. |
| Peer-range gate | `requires.saasaloy` | No module declares it. No capability has a contract version. |
| Bundle and profile | Stacks (plan 0016) | "What does removing a stack do?" is open (#58). |
| Ordered middleware (`waterfall`) | None | No patch kind adds `.use()` (plan 0053 l.27). Ratelimit and maintenance middleware need hand edits. |
| Slots (`ctx.slots`) | Blocks plus a manual wire-up (ADR 0030) | `remove` cannot undo the wire-up. |
| Generated catalog | Hand-written docs | Drift exists. `modules/README.md:47` omits the kv and storage providers. `AGENTS.md:6` says storage takes drivers, and `AGENTS.md:18` says providers. |
| "No privileged core" | CLI with module knowledge | `lib/updater.ts:55-57`, `lib/dev-vars.ts:26`, `lib/doctor.ts:436-510` and `lib/ui-blocks.ts:11` hard-code module paths. |

## What the principle gives Saasaloy

"Everything is a plugin" helps Saasaloy in three concrete ways. Each maps to one Cordis property.

The first is spatial. A module depends on a contract key, not on a module name. Then `api` needs "a logger provider", and any provider satisfies it. A driver switch keeps its dependents, because they depend on `database.driver`, not on `database-d1`. Optional features get a declared form instead of the three workarounds in plan 0065.

The second is temporal. Every edit has an inverse, and a test proves it. `remove` and `update` then become safe by construction, not by care. The stakes are known. ADR 0034 records an `update` incident that "destroyed about 1,229 lines of committed work".

The third is a core with no privileged knowledge. The CLI never learns a module name, and the base never learns a provider name. Today four CLI files know about `database`, `api`, `ui` and `ratelimit`. Each one is a place where a new module needs a CLI change. Refactor 0002 l.20 measured this. One descriptor field, `onlyWith`, changed nine CLI files.

The principle does not help the runtime lifecycle. A Worker isolate is short-lived and serves one deployment's fixed set of modules. Saasaloy changes modules at add time and in git, not in a running process. Reactive reload, dependency-driven unload and hot reload have nothing to act on there.

## Ranked adoption list

Each change is ranked by value per cost. S means one PR in the CLI or one module. M means several modules or one new ADR. L means a descriptor format change across all 38 modules.

| Rank | Change | Source idea | Cost | ADRs touched |
|---|---|---|---|---|
| 1 | Reversible patch kinds, round-trip and confluence tests | Paper Theorems 68 and 80. DSH disposal test per registry. | M | 0006, 0019, 0031, 0034 |
| 2 | Capability kit and contract conformance suite | DSH capability seam. Closed error unions. | M | AGENTS.md core rule, 0033, 0037 |
| 3 | One typed service context for every entry point | Cordis `provide` and `inject`, typed from a table. | M | 0028, 0029, 0033 |
| 4 | Contract keys: `provides`, `requires`, `optional` | Cordis component (d, p, e). O-Insert. | L | 0005, 0013, 0018, 0023, 0026, 0033, 0037 |
| 5 | Install reason in the lock, prune, stack removal | DSH profile of bundles. Cordis confluence. | S | 0006, plan 0016 |
| 6 | Contract versions and a required CLI range | DSH peer gate before import | S | 0012 |
| 7 | Ordered middleware table | Paper §3.4.2 on non-commutative chains | M | 0028 |
| 8 | Typed config schema per module | DSH `Config` schema and `--dump-config-schema` | M | Coordinate with PR #160 |
| 9 | Generated capability graph and `saasaloy explain` | DSH generated seam graph and config catalog | S | None |
| 10 | Remove module knowledge from the CLI | DSH "no privileged core to patch" | M | 0005 |
| 11 | Named UI slots | DSH `ctx.slots` | M | Reopens 0030 |
| 12 | Per-call provider choice and named backends | DSH `ctx.llm` routing, `storage.backend.<name>` | S | 0033 |

### 1. Make every edit reversible, and prove it

The paper's recovery result holds only when each inverse reverts its own step. Cordis leaves that as an author's duty. DSH turns it into a test rule. Saasaloy can do better than both, because its effects are pure `string → string` codemods that a test can run directly.

- Give `package-json-dependency` and `package-json-script` an inverse. Record the prior state in the manifest's patch record, as "absent" or as the old value. On `remove`, restore that state if the current value still equals the one the patch wrote.
- Add a property test per patch kind. Apply the patch, apply its inverse, and assert that the bytes equal the input.
- Add a registry test. On a fresh base, `add M` then `remove M` must give the starting tree for every module M. For two modules with no dependency edge, `add A B` and `add B A` must give the same tree.

The confluence test will also answer an open question. `chained-route` appends in install order, and Hono matches routes in order. The test shows if any two modules produce overlapping paths whose order matters.

### 2. One capability kit and one conformance suite per contract

The runtime contract is implemented six times. Refactor 0002 candidate 12 (l.303) counts `selectProvider` six times, the error class body five times and the "wrap as `provider_error`" step six times. Issue #172 asks for one shared conformance suite for kv, and says queue, storage and email carry the same duplication. The copies already drift. `SmsError` forces `retryable` to false outside two codes, and the others trust the caller.

DSH's capability seam gives the target shape. The Service Definition owns the types and the closed code union. Providers and consumers import only the definition.

- Ship a small package, for example `@repo/capability`, with `defineCapability({ name, envKey, codes, selection })`. It returns the `define`, `create` and error class for one capability.
- Ship `runContractSuite(provider, fixtures)` with it. Each capability publishes its suite, and each provider module runs it in its own test.
- Make the logger rule a declared option, `selection: "optional"`, not a hand-written exception. The logger reason stays as written in `modules/logger/files/src/define.ts:177-186`.

This breaks the `AGENTS.md` rule that a core "has zero runtime dependencies". I recommend this amendment: "zero third-party runtime dependencies". The rule exists to keep the core vendor-blind, and an in-repo, copy-in package keeps it vendor-blind. Refactor 0002 put the shared code in the `create-module` scaffold instead. A scaffold copy keeps six copies that drift again. A shared package gets one fix to all six through the existing `update` path (ADR 0006). Put the package in a `capability` module that every provider-taking capability depends on, not in the base, so the base stays inert (ADR 0003).

### 3. One typed service context for every entry point

Cordis consumers receive services from a context and never construct them. DSH shows the failure mode of the Cordis typing. A global augmentation types `ctx.tools` as present whether or not the plugin injected it. That is the most frequent class of DSH bug report (postmortem 0001, discussions #6179 and #8414). Saasaloy already knows the better form. ADR 0028 chose a registration table because "a table needs a patch and yields" a type.

Today each consumer calls `create<Cap>(c.env)` itself. A queue job gets no `env`, so billing installs five module-level setters as an import side effect (`modules/billing/files/src/{enqueue,notify,store,config}.ts`). Issue #162 says "`setBillingConfig` exists because a job handler gets no `env`".

- Add a `services` registration table in `apps/api`. Each capability patches one entry, for example `{ key: "email", create: (env) => createEmail(env) }`.
- Let `defineWorker` build a lazy, memoized `services` object once per invocation. Pass it to `fetch` through `c.var`, and to the `queue` and `scheduled` handler sets the same way.
- Derive the type from the table. A consumer that reads a service whose module is not installed then fails typecheck, not at runtime.

Lazy construction means an unused service costs nothing in the isolate. The context is per invocation and never reactive. This keeps the Cordis gain (consumers stop constructing providers) and drops the Cordis costs (a proxy, async activation and an untyped `inject`).

### 4. Depend on contracts, not on module names

This is the largest change, and it carries the most value. Add three descriptor fields:

- `provides`, a list of contract keys, each with an `exclusive` flag. For example, `email-console` provides `email.provider`. `database-d1` provides `database.driver`, which is exclusive.
- `requires`, a list of contract keys. `api` requires `logger.provider`, and any logger provider satisfies it.
- `optional`, a list of keys that a module uses if present. `onlyWith` then accepts a key, and it applies to patches as well as files.

The resolver applies two rules. An exclusive key must have exactly one installed provider. This is O-Insert, and it replaces `conflictsWith` and `requiresOneOf` for drivers. A shared key needs at least one provider. When several modules could satisfy a missing key, `add` prompts on a TTY and refuses under `--yes`, as `requiresOneOf` does now.

Three wins follow:

- `saasaloy swap database-d1 database-postgres` becomes possible, because dependents require `database.driver`, not `database-d1`. This fixes the trap in ADR 0026 l.34.
- `api` stops forcing `logger-console` (ADR 0023).
- The module `type` can be derived from what a module provides. That ends the taxonomy wart in `CONTEXT.md` ("a provider module is typed `saasaloy:feature`"). ADR 0037 accepted the wart because "a third tier would be a descriptor-format change". This change is that format change, so fix both together.

Keep `dependsOn` for feature-on-feature edges where the dependency really is another module's files. Keys must be namespaced to avoid the collision risk the paper names in P §6.6. Do this together with #39 (registry-scoped module ids).

### 5. Record why a module is installed

DSH composes a product from an ordered stack of bundles. Cordis confluence says the result depends only on the final set. Saasaloy can use both ideas to close #58.

- Add `requestedBy` to each lock record. Its value is `user`, a stack name, or the module that pulled it in.
- Add `remove --prune`. It removes the modules that nothing installed requires any more.
- Define a stack as a named set of requested modules. Removing a stack un-requests its members, then prunes.

### 6. Contract versions and a required CLI range

DSH refuses a plugin before import when its peer range excludes the running host. The ecosystem data shows the gate works only when authors declare the range. Saasaloy has the field (`requires.saasaloy`), and no module declares it.

- Make `doctor` require `requires.saasaloy` on every module.
- Give each capability a contract version. Each provider declares the version it implements. With rank 4, the key carries it, for example `email.provider@1`.
- Make `add` refuse a mismatch. Make `update` of a capability that bumps its contract list the installed providers that also need an update.
- Write an upgrade note for every contract bump. When the owner holds the code, the note is the only channel for the change (ecosystem lesson 8).

### 7. An ordered middleware table

The paper separates commutative targets (each registration takes its own keyed entry) from ordered chains. A middleware chain is ordered, so independent modules cannot append to it safely. Saasaloy has no way to add `.use()` today (plan 0053 l.27 and l.55).

Add a `middleware` registration table in `apps/api`. Each entry is `{ name, phase, handler }`, where `phase` is a fixed enum such as `early`, `auth`, `tenant` or `late`. The base sorts by phase, then by name. The registration then commutes, so install order no longer matters and rank 1's confluence test can cover it. `ratelimit` and `feature-flags` maintenance then ship their middleware without a hand edit.

### 8. A typed config schema per module

DSH plugins export a `Config` schema with defaults, and `dsh --dump-config-schema` prints every schema as JSON Schema. Cordis accepts any Standard Schema validator, which includes Zod. Saasaloy's `envVars` is a description map with no type, default or scope.

PR #160 (an `env` capability, in review) covers part of this ground. Let each module contribute its schema to that capability through a registration table. Validate on first service construction, and let `saasaloy env --schema` print the merged schema. Settle the shape inside PR #160, not in a second design.

### 9. Generate the capability graph

DSH generates its seam graph, its event catalog and its config catalog from source, and CI checks that they are fresh. Saasaloy's hand docs have drifted in four places this survey found: `modules/README.md:47`, `CONTEXT.md:155`, `modules/storage/files/src/provider.ts:4` and `AGENTS.md:6`.

- Generate the module graph into `modules/README.md` and the wiki, and check freshness in CI. After rank 4, the graph shows contract keys.
- Add `saasaloy explain`. It prints each registration table in the project and the module that patched each line, from the manifest.

### 10. Remove module knowledge from the CLI

The DSH launcher is about 990 lines, and it knows no plugin by name. The Saasaloy CLI knows four modules by path. Replace each hard-coded path with an alias lookup or a descriptor field. For example, `database` can declare its schema barrel. The ratelimit binding rule in `lib/doctor.ts:436-510` should move to a test inside the `ratelimit` module, or into a declarative descriptor check. Do not put executable code in descriptors.

### 11. Named UI slots (grill before you plan)

DSH client plugins register UI into typed named slots, and a slot entry goes away when its owner unloads. ADR 0030 rejected the `sections/*.astro` glob because it gave the consumer "nothing it can name". A named slot gives the consumer a name. A slot table in `apps/web` (for example `landing.after-hero`) would let `remove` take a block off a page.

The risk is real. Landing pages are bespoke, and owners edit them heavily. A slot table could become noise that every owner deletes. This reopens ADR 0030, so test it in a grill session before you write a plan.

### 12. Per-call provider choice and named backends (defer)

DSH routes each LLM request to a named adapter, and its storage hub lets a consumer pick a named backend. In Saasaloy, the use cases would be a tenant that brings its own email vendor, or two storage buckets with different providers. No current module needs either. The smallest form is `create(env, { provider })`, and it weakens the rule that the env var selects. Decide when a module asks for it.

## What not to adopt

- **Cordis as a dependency of generated projects.** The API is a v4 release candidate with a stability warning. DSH vendors it and carries 22 local modifications. Its service types come from global augmentation, which the maintainer says "lied to the type system". Its gains need a long-lived process, and a Worker is not one.
- **Runtime plugin install from npm, a loader or a marketplace.** The DSH data argues for copy-in. Plugins run with full privileges, many ship built code only, and peer gates check nothing for 35% of them. Copied source in the owner's own git is the strongest security property Saasaloy has. Keep it.
- **Fibers, reactive reload and hot reload.** These have nothing to act on in a Worker or in a one-shot CLI command.
- **Whole-row config replacement and disable-by-id.** Both broke DSH plugins when a key or an `id` changed. Saasaloy's keyed array inserts are the better form.
- **Expressions in config (`!!js`).** Postmortem 0002 shows how a missed evaluation path fails silently. Workers also forbid `new Function`.
- **Global type augmentation for services.** Derive types from registration tables, as rank 3 does.
- **Contract changes with no upgrade path.** DSH removed public APIs with no deprecation signal (discussion #5816), and plugins feature-detect to survive. Rank 6 makes the contract version and the upgrade note part of every contract change.

## Where the evidence is weak

- DSH is seven weeks old and pre-release. Its 242k stars and several top plugin repos with 30k to 99k stars look inflated, and many of those repos predate DSH. This report treats popularity as weak evidence. It relies on code, postmortems and discussion threads.
- The paper has no quantitative evaluation (P §5.3). Its recovery and confluence proofs assume that each inverse is correct, and nothing checks that. Rank 1 adds the check for Saasaloy.
- The Cordis Workers claim rests on static checks, a bundle and a Node run with code generation disabled. Nobody ran it in workerd. The timing figures come from single runs on one machine.
- The ecosystem figures come from samples. The npm sample leans toward popular packages, and the random repo sample under-weights the first week.
- Four Saasaloy branches in review are not on `main`: env (#153, PR #160), config (#154, ADR 0039), the rbac dissolve (#167) and the database lifecycle (#152). They can change ranks 3, 4 and 8.

## Evidence (primary sources)

All fetched 2026-10-02. Agent clones are in `/tmp/research/` and are lost on the next container rebuild.

- DeepSeek Harness at `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`: https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2
  - Architecture and "no privileged core": `docs/architecture.md`
  - Capability seams: `docs/capability-seams.md`, https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams
  - LLM registry and errors: `packages/llm/llm/src/index.ts` (l.396-440), `packages/llm/llm/src/error.ts`, `packages/llm/llm/src/retry-policy.ts`
  - Storage hub and `StorageError`: `packages/storage/storage/src/index.ts`, `packages/storage/storage/src/error.ts`
  - Web search selection with no fallback: `packages/web/web/src/index.ts` (l.80-193)
  - Peer gate and failure matrix: `packages/boot/app-boot/README.md` (l.52-56, l.94-108)
  - Testing rules: `docs/testing.md`, `packages/AGENTS.md`, `AGENTS.md`
  - Postmortems: `docs/postmortem/0001-acp-default-export-drops-inject.md`, `docs/postmortem/0002-js-expression-disabled-filesystem-tools.md`
  - Vendored Cordis modifications: `vendor/README.md`
  - Publishing guide: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
- Cordis at `v4.0.0-rc.10`, commit `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c`: https://github.com/cordiverse/cordis
  - Fiber lifecycle and effects: `packages/core/src/fiber.ts`
  - Service store and access checks: `packages/core/src/reflect.ts`
  - Events: `packages/core/src/events.ts`
  - Loader entries and isolation: `packages/loader/src/config/entry.ts`, `packages/loader/src/config/isolate.ts`
  - Optional inject removed: https://github.com/cordiverse/cordis/issues/97
  - Open lifecycle bugs: https://github.com/cordiverse/cordis/issues/34, https://github.com/cordiverse/cordis/issues/26, https://github.com/cordiverse/cordis/issues/127
- Paper: Shi, Zhang, Cui, "A Programming Paradigm for Spatiotemporal Composability", arXiv 2608.25512v1, https://arxiv.org/abs/2608.25512 (§1.1, §3.4.2, §4.2.1, Theorems 68, 70, 80, §5.1.1, §5.3, §6.5, §6.6)
- Ecosystem: https://github.com/topics/dsh-plugin. Curated registry `awesome-dsh-plugin/awesome-dsh-plugin` at `bb8496ec4cbb`. Discussions #5636 (scan), #8199 (upgrade breakage), #8287 (duplicate core copy), #5816 (removed APIs).
- Saasaloy at `9f78cd8`: `packages/cli/src/lib/patch/index.ts`, `packages/cli/src/lib/doctor.ts`, `packages/cli/src/lib/updater.ts`, `modules/*/registry-item.json`, `modules/logger/files/src/define.ts`, `modules/billing/files/src/`, `docs/refactor/0002-refactor-full-project-2026-09-15.md`, ADRs 0005, 0023, 0026, 0028, 0029, 0030, 0033, 0034, 0037, issues #39, #58, #162, #172, PR #160.

## Open questions

1. Rank 4 changes the descriptor format for all 38 modules. My pick is to add `provides` and `requires` beside `dependsOn` and let `doctor` warn during the migration. A single cut-over is the alternative.
2. Rank 2 contradicts refactor 0002, which chose the `create-module` scaffold over a shared package. Do you accept the amendment to the `AGENTS.md` core rule?
3. Rank 3 overlaps ADR 0029. Should the service context own the request-scoped database client and replace the auth `AsyncLocalStorage` scope?
4. Is PR #160 the home for rank 8, or does the per-module schema need its own ADR?
5. Rank 11 reopens ADR 0030. Grill it or drop it?
