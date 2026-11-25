# Modules

Every installable module in the default registry is listed in [the module catalog](generated/modules.md). The catalog is generated from each module's `registry-item.json`, so it lists every module and cannot go stale. Each module also has its own page under `generated/modules/`, with its dependencies, environment variables, files and the skill text an agent reads. The tiers (capability, feature, provider, driver) are defined in [the glossary](generated/glossary.md).

For the environment variables of all modules in one table, see [the environment reference](generated/env.md).

Dependencies install automatically: `saasaloy add waitlist` installs each module it depends on first, prerequisites first. `database` names its one driver, `database-postgres`, in `requiresOneOf`. A list with one option is no choice, so `add` installs the driver too and prints one line that names it:

```
database needs database-postgres; adding it.
```

`saasaloy add waitlist --yes` installs the module, `database` and the driver in one run, with no terminal needed. The one choice `add` will not make for you is a list of two or more, such as the `api-keys` owner: an interactive run asks you to pick, `--with api-keys-user` names it on the command line, and a `--yes` run without `--with` stops and names the options. A capability brings its vendor SDK and encapsulates it, so nothing else in your project imports Hono, Drizzle or Better Auth directly ([ADR 0020](../adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)).

To see what any module would do to your project before installing it:

```bash
saasaloy add <name> --dry-run
```

To list what a registry offers, including third-party ones, see [`saasaloy list`](reference.md#saasaloy-list). `saasaloy list --json` gives each module's one-line `description`, its `stage` (`validate`, `mvp`, `teams`, `money` or `scale`) and its `needs` (`cloudflare-paid`, `stripe`, `domain`, `vendor-account`), read from the descriptor. To publish a module of your own, start at [Contribute a module](how-to/contribute-a-module.md).

_Verified against `main`@`be6eca1e` on 2026-11-25._
