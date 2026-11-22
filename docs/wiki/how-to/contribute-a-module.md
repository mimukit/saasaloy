# Contribute a module

A module is a folder under [`modules/`](../../../modules/) in this repo. A plain `saasaloy add` can install the module after the next CLI release.

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

The descriptor requires `name` and `type`. Everything else is optional to the schema: `description`, `stage`, `needs`, `requires`, `dependsOn`, `conflictsWith`, `requiresOneOf`, `dependencies`, `devDependencies`, `files`, `envVars`, `envServices`, `envOptional`, `devVars`, `removeWarnings`, `patches`, `tables`, `entries`, `scaffolds`, `enablesTesting`, `agent`. Four of those decide how a module behaves beside other modules. `dependsOn` pulls a prerequisite in. `requiresOneOf` lists the drivers that can satisfy a capability. If the list has one driver, `add` includes it without a prompt. If the list has more than one driver, an interactive `add` asks you to choose unless the project or the command already selects one. `conflictsWith` prevents two modules from installing together. For example, the two `api-keys` drivers declare a conflict. `saasaloy doctor` still holds a registry to `description`, the one line `saasaloy list --json` gives an agent choosing modules, and every module in this repo also sets `stage` and `needs`. `removeWarnings` is an array of sentences `remove` reads from the descriptor at the lock's release and prints on the way out, for the state a removal cannot undo; `subscription` is the example to copy. The schema sets `additionalProperties: false`, so a field it has never heard of fails the run. The full contract is
[`packages/cli/schemas/registry-item.schema.json`](../../../packages/cli/schemas/registry-item.schema.json),
and `saasaloy add` validates against it, so a typo fails at install with a named error
rather than a mystery crash. `modules/email-cloudflare/registry-item.json` is a short,
complete example that exercises files, `dependsOn`, two patch kinds and one `entries` row.

A module never writes a row into a list in a file the owner keeps. A list that other modules add to is a [registration table](../../../CONTEXT.md#registration-table): the module that owns it declares it under `tables`, each module that adds to it declares a row under `entries`, and the CLI writes the table as a `<name>.generated.ts` file on every run. A descriptor that holds `tables` or `entries` sets `requires.saasaloy` to `>=0.10.0`. The `create-module` skill documents every field of both.

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
path to use while you are iterating. `pnpm play:init` builds the CLI, scaffolds `.dev/playground`, drops the shim in and commits a git baseline. `pnpm play:watch` re-applies an installed module each time you save one of its files, `pnpm play:restore` returns the playground to the baseline in about a second, and `pnpm play:reset` gives you a fresh one.

If your module ships TypeScript payload files with tests beside them, `pnpm test:modules` runs them under `node --test` over `modules/*/files/**/*.test.ts`. `pnpm test` runs it as one of its five passes. A new capability core, meaning a module with both `files/src/define.ts` and a `files/src/providers/` folder, also needs a row in the `CORES` table of `scripts/provider-selection.test.ts`: `pnpm test:scripts` fails and names the module until it has one, and the row's mode says which `<CAP>_PROVIDER` rule the core follows. When your change touches a pinned dependency in a descriptor or the base template, `pnpm deps:verify` re-scaffolds the playground and installs, builds, lints and typechecks the generated project; CI does not run it, because it needs the network.

Test the removal side too. `saasaloy remove` renders the project again without the module, so with `SAASALOY_REGISTRY_DIR` set it reads your checkout. A module whose files land outside its own alias, or that patches a file it doesn't own, is where the gaps show up. See [Remove a module](remove-a-module.md#what-stays-behind).

## Submitting

Open a pull request against `main` the same as any other change. A GitHub Actions gate runs on every push and pull request, and it runs the same seven scripts you run locally, in this order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify:content`, `pnpm verify:pins`, `pnpm docs:check` and `pnpm badges:check`. `pnpm deps:verify` is deliberately left out of it. A green local tree is a green CI run, so run the seven before you push. A new module changes the module count that `badges:check` compares, so run `pnpm badges:generate` and commit `apps/web/public/badges.json` with the module.

The CLI reads the default registry at the tag of its own version. `saasaloy list @main` and a local checkout can show modules before the next release. See [ADR 0062](../../adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md) and the [runbook for a bad descriptor on `main`](../runbooks/bad-descriptor-on-main.md).

## Registries other than this one

`saasaloy add someone/their-repo/their-module` already works, so a module does not have to
live here. Third-party module identity is still moving:
[#39](https://github.com/mimukit/saasaloy/issues/39) will change how those modules are
named. The grammar as it stands today is in
[the reference](../reference.md#module-coordinates).

_Verified against `main`@`e2830008` on 2026-11-22._
