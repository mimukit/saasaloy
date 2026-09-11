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

```text
modules/
  <name>/
    registry-item.json       # the descriptor
    files/                   # files copied into the consumer project
    skills/saasaloy-<name>/  # optional agent skill, installed alongside the files
```

The descriptor requires `name` and `type`. Everything else is optional: `requires`, `dependsOn`, `conflictsWith`, `requiresOneOf`, `dependencies`, `devDependencies`, `files`, `envVars`, `devVars`, `removeWarnings`, `patches`, `scaffolds`, `agent`. Four of those decide how a module behaves beside other modules. `dependsOn` pulls a prerequisite in. `requiresOneOf` names a set of drivers and makes `add` prompt for one when none is present, the way `database` names `database-d1` and `database-postgres`. `conflictsWith` refuses the pair outright, the way each of those two drivers names the other. `removeWarnings` is an array of sentences `add` records in the manifest and `remove` prints on the way out, for the state a removal cannot undo; `billing` and `entitlements` are the examples to copy. The schema sets `additionalProperties: false`, so a field it has never heard of fails the run. The full contract is
[`packages/cli/schemas/registry-item.schema.json`](../../../packages/cli/schemas/registry-item.schema.json),
and `saasaloy add` validates against it, so a typo fails at install with a named error
rather than a mystery crash. `modules/email-cloudflare/registry-item.json` is a short,
complete example that exercises files, `dependsOn` and two patch kinds.

`registry-item.json`, capability, feature and provider all have precise meanings in
[`CONTEXT.md`](../../../CONTEXT.md).

## Scaffold it and check it

The CLI writes the skeleton, so you never start from a blank file:

```bash
saasaloy new module <name> --type <tier> --depends-on api,database
```

It writes a schema-valid `modules/<name>/registry-item.json`, an empty `modules/<name>/files/`, and a `modules/<name>/skills/saasaloy-<name>/SKILL.md` stub whose frontmatter matches the folder. Leave the flags off and it prompts for the tier and the dependencies. It refuses inside a generated project, because a `modules/` folder means nothing in a repo that installs modules. The `create-module` skill runs this command for the skeleton and keeps the judgment about tier and conventions.

Then validate what you wrote:

```bash
saasaloy doctor modules            # the whole registry
saasaloy doctor modules/<name>     # one module
```

`doctor` checks the descriptor against the schema and against the conventions the schema cannot express: every declared file is on disk, every `target` names an alias the base template or some scaffold defines, `dependsOn` resolves within the registry, npm deps are exact-pinned, and each `agent.skills` folder exists with the `saasaloy-` prefix. It reports every violation rather than the first, and exits 2 when it finds any. It reads local folders only.

## Test it before you open the PR

Modules install from a checkout as well as from GitHub. Point the CLI at your working copy
with `SAASALOY_REGISTRY_DIR` and install into a throwaway project:

```bash
cd /path/to/a/throwaway/project
SAASALOY_REGISTRY_DIR=/path/to/your/saasaloy/modules saasaloy add my-module --diff
```

Use an absolute path: a relative one resolves against the directory you run `add` from,
not against your checkout. Run it from the throwaway project, not from the checkout — the
tool repo is not a Saasaloy project, so `add` there cancels:

```text
No saasaloy.json found in <dir>. Run `saasaloy init` first, or cd into a Saasaloy project.
```

The local source wins over any `owner/repo` coordinate, and the CLI says so when both are
present.

The repo has a purpose-built version of this loop — a scaffolded playground plus a shim
that wires `SAASALOY_REGISTRY_DIR` to your checkout automatically, so you can edit a module
and re-run without a rebuild dance. It is documented in
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md#manual-qa-the-devplayground), and it is the
path to use while you are iterating. `pnpm play:init` builds the CLI, scaffolds `.dev/playground` and drops the shim in; `pnpm play:reset` gives you a clean one.

If your module ships TypeScript payload files with tests beside them, `pnpm test:modules` runs them under `node --test` over `modules/*/files/**/*.test.ts`. `pnpm test` runs it as one of its three passes. When your change touches a pinned dependency in a descriptor or the base template, `pnpm deps:verify` re-scaffolds the playground and installs, builds, lints and typechecks the generated project; CI does not run it, because it needs the network.

Test the removal side too. `saasaloy remove` reads only the local state files, and a
module whose files land outside its own alias, or that patches a file it doesn't own, is
where the gaps show up. See [Remove a module](remove-a-module.md#what-stays-behind).

## Submitting

Open a pull request against `main` the same as any other change. A GitHub Actions gate runs on every push and pull request, and it runs the same four scripts you run locally, in this order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify:content`. `pnpm deps:verify` is deliberately left out of it. A green local tree is a green CI run, so run the four before you push.

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

_Verified against `main`@`42cbf03` on 2026-09-11._
