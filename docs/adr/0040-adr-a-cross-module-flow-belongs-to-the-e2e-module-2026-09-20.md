# 0040 — A cross-module flow belongs to the `e2e` module

The `e2e` capability takes neither providers nor drivers, and every browser spec it runs is its own, including the spec that exercises another module's feature. A module that ships a screen ships no spec for it. Settled while planning issue [#155](https://github.com/mimukit/saasaloy/issues/155) (`docs/plans/0059-plan-e2e-capability-2026-09-20.md`).

## Status

accepted. It applies [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md) and [ADR 0037](0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md) rather than amending either, and it adds one rule those records do not cover: who owns a test that crosses two modules.

## No providers and no drivers

The three-question test never gets asked here, because it tests how a capability's alternate implementations differ, and `e2e` has none. It wraps no external service. Playwright is a devDependency inside `packages/e2e`, the way `drizzle-kit` is a devDependency inside `packages/db`, and swapping it would replace every file in the workspace rather than adding one beside them — that is a rewrite, not a driver.

So `e2e` is a plain capability with one scaffold, the same shape plan 0057 settled for the database lifecycle scripts. There is no `E2E_PROVIDER`, and there is nothing for `conflictsWith` to keep apart.

What the capability does read at runtime is `saasaloy.json`. That is not provider selection; it is the suite asking the project which apps exist and which modules are installed, so it can start the right processes and collect the right specs.

## A flow crosses modules, so no feature module owns it

The waitlist flow is the worked example. A visitor fills a form that `waitlist` ships, in a page `web` owns, which posts through a client `api` scaffolds, to a route `waitlist` patched in, which writes a row into a table `database` migrated under a driver the project chose. Five modules. Asking which one owns the test has no good answer.

Two arrangements were considered and one was taken.

**Rejected: the feature module ships its own spec.** `waitlist` would carry `specs/waitlist.spec.ts` targeting `@e2e/specs/`, which means `dependsOn: ["e2e"]`. Every project that wants a waitlist form would then install Playwright, whether or not it wanted a browser suite. A test capability that a project cannot decline is not a capability, it is a tax. The alternative — an optional dependency the applier resolves only when `e2e` is already present — is a resolver feature that exists for this one case.

**Taken: `e2e` owns every spec, and gates each one on a tag.** A spec declares the modules it needs as Playwright tags, `playwright.config.ts` reads `installed` from `saasaloy.json`, and the tags whose module is absent become `grepInvert`. A spec for a module the project does not have is never collected. `saasaloy add e2e` on a project with only `api` runs one flow; the same command on a project with `auth`, `admin` and `waitlist` runs four. Nothing is installed that the project did not ask for.

The cost is stated plainly: a module's flow lives in a directory that module does not own, so adding a feature and adding its flow are two edits in two places. That is the price of keeping the browser suite optional, and it is paid once per flow.

## Never collected, never skipped

A spec whose module is absent is uncollected at configuration time. It is **not** allowed to run and call `test.skip()` on a 404.

The difference is the whole point of the capability. A suite that skips on a missing route reports green when a route breaks, because a broken route and an uninstalled module look identical from inside the browser — both are a 404. Deciding before anything runs, from the file that records what is installed, keeps a 404 meaning what it should mean: the app is broken.

That decision has a failure mode of its own, and it is guarded. A tag naming no module is never in any project's `installed`, so its spec is uncollected everywhere and the suite still reports green — which is exactly what renaming a module would cause. `scripts/e2e-tags.test.ts` asserts every tag in the suite names a real directory under `modules/`, and runs in `pnpm test`.

## Consequences

- `modules/e2e/files/specs/` is the only place a Playwright spec lives, in this repo and in a generated project.
- A new module that ships a user-facing flow adds its spec and its tag to `e2e`, in the same pull request. Nothing enforces that; the tag guard only catches a tag that names nothing.
- The tag vocabulary is module names and nothing else. The base app (`web`) has no tag, because it is always present and a tag for it could never gate anything.
- `packages/e2e` declares no `test` script and the root `vitest.config.ts` excludes it, so `pnpm test` stays unit-only and the two runners never read each other's files.
