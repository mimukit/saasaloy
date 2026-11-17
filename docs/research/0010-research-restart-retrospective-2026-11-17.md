# Research: what to keep and what to change in a restart of Saasaloy

Created on 2026-11-17. Source revision is `aaa17db4` on `main`. This document gives an opinion. It changes no source file.

Review: pending

## Question

The project starts again today with the same goal. Which parts stay, and which architecture changes?

## Method and limits

Five subagents on the Haiku model collected facts from the CLI, the modules, the generated project, the git history and the repo tooling. The main session read `README.md`, `CONTEXT.md`, `llms.txt`, refactor survey 0003, research 0003 and 0005, and plan 0107. The main session wrote every opinion here.

The main session checked these facts against the working tree and GitHub: the patch counts, the engine line counts, the CI steps, the state of PR #285, issues #205 and #220, the dialect variant counts, the registry default ref, and the absence of merge code in the CLI. A fact marked "(collected)" comes from a subagent and has no second check. No test and no build ran. I read no patch codemod in full.

## Verdict

The goal is right, and the architecture of a generated project is right. The cost sits in the delivery mechanism: how module code is stored, shipped, applied and updated. I keep almost every decision about what a generated project contains. I change three decisions about how the code gets there.

1. One pure render function and a three-way merge replace the three engines that edit a project in place.
2. Module code lives in a reference project that compiles, and it ships on the same release as the CLI.
3. The project supports one SQL dialect.

Three smaller changes follow: the descriptor format, the shape of a feature, and the order of work.

## The numbers behind the verdict

| Measure | Value |
| --- | --- |
| Age | 119 days and 1,435 commits, 2026-07-21 to 2026-11-17 |
| Modules | 49 descriptors: 16 typed `capability`, 33 typed `feature` |
| Module payload | 632 files and 90,479 lines of TypeScript, TSX and Astro (collected) |
| CLI source | 24,066 lines without tests |
| Engine share of the CLI | 13,637 lines, 57%: `add`, `update`, `remove`, their libraries, the patch folder, the merge plan and the ledger |
| Descriptor patches | 216 in 8 kinds |
| Fix commits | 263, and 65 of them carry the `cli` scope, the largest group (collected) |
| Agent benchmark | 1 of 7 lines pass on 2026-10-24. The docs record no later scored run. |
| Review queue | 18 open pull requests and about 70,700 added lines on 2026-11-07 (plan 0107) |

## What I keep

| Decision | Why it stays |
| --- | --- |
| The stage rule and the inert base | It is the product position. A ready-made boilerplate cannot copy it without a rewrite. |
| Copy-in source and no runtime library | Plumbing files rarely change in a project, so their hash matches and `update` overwrites them. The promise costs little. |
| The provider contract: a neutral core, one runtime file for each provider, `<CAP>_PROVIDER` with no fallback, a local provider, one error type | Refactor survey 0003 found the capability cores cold, with no file above 10 commits. Code that stays unchanged for this long has the right contract. |
| Registration tables in place of folder scans (ADR 0028) | A static table gives a type. I keep the table and change how the CLI writes it. See change 1. |
| The ledger rules (ADR 0006, 0031, 0034, 0046) | A hash for each written file. An edited file is never overwritten. A second run completes a partial run. The CLI exits 2 when it would have to guess. |
| The `env` and `config` split with one typed gate for each service | The two-deployment test gives one answer for every value. |
| The runtime stack | Hono with a typed RPC client, Drizzle, Better Auth with two instances, TanStack Router SPAs on one shell, the branded `TenantId`. |
| Deploy through wrangler with gates, an order and a deploy tag (ADR 0043, 0048) | A restart goes there on day one and skips the 85 days of Pulumi (collected). |
| The agent layer | `AGENTS.md`, one skill for each module, `llms.txt`, `--json`, and the agent benchmark. |
| ADRs, the `CONTEXT.md` glossary and the guard tests | Every reversal in this review has an ADR that states the reason. |

## Change 1: one render function and a three-way merge

### Today

`add`, `update` and `remove` are three engines, and each one edits the project in place. Each engine holds its own copy of the rules for a tracked file. Refactor survey 0003 counts five spellings of one question: may the tool overwrite this file? Surveys 0002 and 0003 both crown a candidate that joins these copies. A manifest record carries six optional flags (`adopted`, `from`, `when`, `seed`, `mergedWith`, `deleted`), and four engines read them.

`update` does not merge. The CLI collects the base, the incoming file and the file on disk, then writes a Markdown merge plan. A person or an agent does the merge. ADR 0034 records the incident that shaped these rules: an update destroyed about 1,229 lines of committed work.

A patch is an AST edit with a hand-written inverse. 84 of the 216 patches (the two `package.json` kinds) have no inverse, so `remove` leaves them in place. Research 0003 reports that array patches append in install order, so the result depends on install history.

### Restart design

One pure function gives the file tree for a set of modules:

```ts
render({ base, modules, options }): Map<Path, Bytes>
```

`add`, `remove` and `update` become one operation. The CLI renders the old set as the base and the new set as the incoming tree. The working tree is the third side. The CLI runs a three-way merge for each file and writes standard conflict markers. `package.json` and `wrangler.jsonc` merge by key.

Registration tables become files the CLI writes in full. 116 of the 216 patches append one entry to a table: `plugin-array` 75, `chained-route` 18, `const-array` 14, `nav-entry` 9. A table file holds imports and one array, sorted by an order key the descriptor declares:

```ts
// apps/api/src/routes.generated.ts (written by saasaloy)
import { health } from "./routes/health";
import { waitlist } from "./routes/waitlist";
export const routes = (base: Base) =>
  base.route("/health", health).route("/waitlist", waitlist);
```

The owner adds project routes in `index.ts`, which the CLI writes one time.

These parts are not necessary in this design: patch inverses, refusal tables, backfill, the `adopted` and `mergedWith` flags, tombstones, the merge plan format and the recovery path for a partial apply. A render goes to a temporary directory, so a failed run changes nothing.

### Price

- `remove` needs the old module payload, and today `remove` works offline. A payload cache under `.saasaloy/` closes this. ADR 0059 rejected a snapshot for the base, and I reverse that decision.
- A text merge can give a file that does not compile, where an AST patch refuses. The typecheck after the merge finds it.
- Update notes stay, because a merge cannot change code the owner wrote.

### Confidence

High for render and merge. Medium for generated table files. Better Auth derives types from the `plugins` array, and one prototype with a generated plugin file settles the doubt.

## Change 2: a reference project that compiles, on one release

### Today

The module payload sits in `modules/*/files`, outside every workspace. `ci.yml` runs `pnpm typecheck`, and that command covers `packages/cli` and `scripts` only. No workflow typechecks a scaffolded project. PR #285 adds that check to the nightly smoke run. It is open since 2026-10-26 and conflicts with `main`. Plan 0107 names three escapes that this gap let through: #251, #269 and #274.

The repo carries tooling whose only job is to act as a project for loose files: `ts-resolve-hook.ts`, `config-shim.ts`, `watch-template.ts`, the playground scripts and the three dependency scripts. 97 module test files run in this repo and never reach a project. 19 ship.

The CLI ships on npm. The base resolves at the CLI release tag. Modules resolve at the head of the default branch (`registry.ts:488`). Issue #205 shows the result: `saasaloy@0.5.2` could read no descriptor on `main`. The repair was a `requires.saasaloy` floor on every descriptor and a test that guards the floors. Plan 0107 states that a module pull request "reaches users the moment it lands on `main`".

### Restart design

The repo holds a `reference/` project, a real pnpm workspace with every module installed. An author writes module code there, with the normal `pnpm dev`, `pnpm typecheck` and `pnpm test`. A descriptor names the paths that its module owns. A build step cuts the registry payload from the reference project. CI compiles and tests the reference project on every pull request.

The default registry resolves at the release tag of the CLI that runs. One version covers the CLI, the base and the modules. A third-party registry keeps the commit SHA lock of ADR 0012.

### Price

- The registry needs a build step. ADR 0012 chose no build step, and this reverses it.
- Two modules that exclude each other cannot share one tree. Change 3 removes the database pair. The `api-keys` owner pair needs a second variant or a runtime setting.

### Confidence

High. The current repo already pays for the reference project through the playground, the shims and the guard tests, and does not get the compiler in return.

## Change 3: one SQL dialect

### Today

14 modules ship twin schema files: 34 variant files and 2,781 lines. `database-postgres` holds 4,298 lines and `database-d1` holds 1,216 (collected). The end-to-end workflow runs every flow two times. `conflictsWith`, `requiresOneOf` and `onlyWith` exist mainly for this split.

The stage rule and the driver choice contradict each other. A project picks its driver at the `validate` stage, because `waitlist` needs a database. The newest module, `ecommerce`, is Postgres only. Plan 0106 gives the reason: "Most projects that sell run Postgres; D1 would cost the row lock and a second schema." A project that started on D1 reaches the `money` stage and must remove its driver, and the tool moves no data. The free start blocks the paid stage.

### Restart design

I choose Postgres as the only dialect. Every stage can run on it. The modules that need a row lock are the modules that earn money. The repo already shows where the work went: the Postgres driver has more than three times the code of the D1 driver. The `db:setup --neon` backend gives a database with no Docker.

### Price

The README promises a hosting bill close to zero on D1. With Postgres only, that promise depends on a Postgres host with a free tier. I did not check current vendor terms, and that check comes before this decision. The other option is D1 only, and then `ecommerce` and row locks leave the scope.

### Confidence

Medium. The count of real projects on each driver settles it. Issue #205 names one downstream project, `primeshopr`, and it uses the Postgres driver.

## Change 4: one source for the descriptor

The schema allows two `type` values for four kinds of module. `CONTEXT.md` calls this a "taxonomy wart, on purpose". `dependsOn` names modules, so `api` depends on `logger-console`, one specific provider. The JSON schema and the TypeScript types are two hand-kept copies, and refactor survey 0003 measures 4 to 12 changed files for each new field. An env key is declared in the descriptor and again in the zod preset, and a guard test compares the two.

In a restart the descriptor is TypeScript: `defineModule({ kind, provides, requires, … })` with one zod schema that gives the types and the JSON. `kind` has four values. A module requires a contract key such as `logger.provider`, and exclusive pairs follow from a key with cardinality one. The CLI reads env keys from the preset. Research 0003 recommends the contract keys, and I agree with it. Confidence is high. This costs little at the start and much now.

## Change 5: a feature is one workspace

316 of the 321 `files[]` entries land in a workspace that the module does not scaffold (collected). `shell` writes 81 files into `packages/ui`. The `admin` skill says the module carries no server code, and its descriptor writes 15 files into `apps/api`. Survey 0003 found 31 files that three or more open pull requests edit.

In a restart a feature is one folder, `features/<name>/`, that exports its routes, schema and screens. The apps take them through the generated tables of change 1. Ownership is a directory, and a file collision between modules cannot occur.

Confidence is low to medium. TanStack file routes, the `drizzle-kit` schema globs and the Tailwind source scan each need proof. A prototype of `teams` in this shape settles it, and I build that prototype before I commit to the change.

## Change 6: the order of work

- Build `shell` before `admin`. The admin UI was rebuilt on a copied kit on 2026-10-19, and the kit moved into `shell` on 2026-10-24. `modules/admin` has 378 file touches, more than any other module (collected).
- Make the agent benchmark the gate for new modules. The one scored run passes 1 of 7 lines, at 47 modules. A restart takes `waitlist`, `auth`, `app`, `admin`, `email` and `subscription` to 7 of 7 before it adds `cms`, `notification` or `ecommerce`.
- Keep the review queue inside what one reviewer reads. Changes 1 and 2 move rules from review into the compiler, and that is the larger repair.

## What I do not change, although it has a cost

- The copied provider selector. Eight copies of about 22 lines exist. Survey 0003 dropped the generator because three copies differ on purpose, and I agree.
- The hand-kept ADR and glossary discipline. 556 of 1,435 commits are typed `docs` (collected). The ADRs and `CONTEXT.md` are worth that cost. The four hand-kept module catalogue files are not, and plan 0107 already replaces them.

## If the repo continues without a restart

1. Typecheck a full scaffold on every pull request. PR #285 holds the work.
2. Decide the dialect before PR #344 (`ecommerce`) merges. Each new module with a table adds a twin schema.
3. Resolve the default registry at the CLI release tag.
4. Move the four table patch kinds to generated files. This removes 116 of 216 patches and does not touch `update`.
5. Use render and merge for `update` first. `add` and `remove` follow.
