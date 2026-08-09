# Contribute a module

A module is a folder under [`modules/`](../../../modules/) in this repo. There is no
publish step and no package registry: merging it to `main` makes it installable by every
downstream `saasaloy add`. This page tells you where the authoring rules live and what
order to do things in.

## Read these first

Two guides carry the actual rules, and this page does not repeat them:

- [`.agents/skills/create-module/`](../../../.agents/skills/create-module/SKILL.md) —
  writing the descriptor and laying out the files a module drops, including the two-tier
  capability/feature split and the conventions that let modules compose.
- [`.agents/skills/create-provider/`](../../../.agents/skills/create-provider/SKILL.md) —
  the narrower case: one implementation behind a capability's provider interface, such as
  `email-cloudflare` behind `email`. Read `create-module` first.

They live under `.agents/` because they double as agent instructions. They are the
authoritative source either way.

For how to work in this repo — the `.dev/playground`, the scripts, and the dependency
update flow — see [`CONTRIBUTING.md`](../../../CONTRIBUTING.md).

## The shape of a module

```
modules/
  <name>/
    registry-item.json       # the descriptor
    files/                   # files copied into the consumer project
    skills/saasaloy-<name>/  # optional agent skill, installed alongside the files
```

The descriptor requires `name` and `type`. Everything else is optional:
`dependsOn`, `dependencies`, `devDependencies`, `files`, `envVars`, `patches`,
`scaffolds`, `agent`. The full contract is
[`packages/cli/schemas/registry-item.schema.json`](../../../packages/cli/schemas/registry-item.schema.json),
and `saasaloy add` validates against it, so a typo fails at install with a named error
rather than a mystery crash. `modules/email-cloudflare/registry-item.json` is a short,
complete example that exercises files, `dependsOn` and two patch kinds.

`registry-item.json`, capability, feature and provider all have precise meanings in
[`CONTEXT.md`](../../../CONTEXT.md).

## Test it before you open the PR

Modules install from a checkout as well as from GitHub. Point the CLI at your working copy
with `SAASALOY_REGISTRY_DIR` and install into a throwaway project:

```bash
SAASALOY_REGISTRY_DIR=./modules saasaloy add my-module --diff
```

The local source wins over any `owner/repo` coordinate, and the CLI says so when both are
present.

The repo has a purpose-built version of this loop — a scaffolded playground plus a shim
that wires `SAASALOY_REGISTRY_DIR` to your checkout automatically, so you can edit a module
and re-run without a rebuild dance. It is documented in
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md#manual-qa-the-devplayground), and it is the
path to use while you are iterating.

Test the removal side too. `saasaloy remove` reads only the local state files, and a
module whose files land outside its own alias, or that patches a file it doesn't own, is
where the gaps show up. See [Remove a module](remove-a-module.md#what-stays-behind).

## Submitting

Open a pull request against `main` the same as any other change. Nothing gates it
automatically: the repo has no CI, and `pnpm lint` is a declared no-op, so review is the
only check. [#46](https://github.com/mimukit/saasaloy/issues/46) tracks adding a real gate.

Because merging is publishing, a broken descriptor on `main` is a live incident rather
than a stale build.
[A bad descriptor reached `main`](../runbooks/bad-descriptor-on-main.md) is the runbook for
that, and it is worth reading before your first merge, not after.

## Registries other than this one

`saasaloy add someone/their-repo/their-module` already works, so a module does not have to
live here. Third-party module identity is still moving:
[#39](https://github.com/mimukit/saasaloy/issues/39) will change how those modules are
named. The grammar as it stands today is in
[the reference](../reference.md#module-coordinates).

_Verified against `main`@`48d32d7` on 2026-08-09._
