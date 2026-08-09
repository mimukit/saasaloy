# Saasaloy documentation

Saasaloy scaffolds a Cloudflare-native Turborepo and then copies features into it on
demand. The scaffolded base is a landing page and a UI package; the API, database, auth
and product features arrive later, one `saasaloy add` at a time, as files you own and can
edit.

The CLI ships four commands: `init`, `add`, `remove`, `list`. Nothing else exists yet.

Two things worth knowing before you pick a page:

- **The CLI is not published to npm.** Installing it today means cloning this repo and
  linking the built binary. [Getting started](getting-started.md) walks that path.
  [#46](https://github.com/mimukit/saasaloy/issues/46) tracks the publish.
- **The registry is this repo.** `saasaloy add waitlist` fetches `modules/waitlist/` from
  GitHub at a resolved commit SHA. There is no package registry in between.

## Use Saasaloy

You want a project scaffolded and features installed into it.

- [Getting started](getting-started.md) — install the CLI, scaffold a project, run it.
- [Add a module](how-to/add-a-module.md) — install a feature and its prerequisites.
- [Remove a module](how-to/remove-a-module.md) — take one back out, and what stays behind.

## Build a module

You want to publish a module other projects can install.

- [Contribute a module](how-to/contribute-a-module.md) — where the authoring guides live
  and how to test a module before it ships.
- [A bad descriptor reached `main`](runbooks/bad-descriptor-on-main.md) — the registry is
  live, so this is an incident. Who breaks, who doesn't, and how to revert.

## Both tracks

- [Architecture](architecture.md) — how the CLI, the registry and a generated project fit
  together.
- [Reference](reference.md) — every command, flag, environment variable and config file.

## Elsewhere in the repo

- [`CONTEXT.md`](../../CONTEXT.md) defines the vocabulary these pages use: module,
  capability, provider, coordinate, applier.
- [`docs/adr/`](../adr/) records why the design is what it is, one decision per file.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) covers development in this repo: the
  `.dev/playground`, the scripts, and the dependency update flow.

_Verified against `main`@`48d32d7` on 2026-08-09._
