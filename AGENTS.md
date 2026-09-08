
# Saasaloy — agent overview

## Architecture philosophy: portable capabilities, swappable providers

**Cloudflare is a provider, not the architecture.** Every capability that wraps an external service ships as a neutral core plus provider modules, so a project swaps the vendor without touching the core, a consumer, or any other module. `email` + `email-cloudflare` / `email-plunk` / `email-console` is the reference shape; `logger` and `sms` follow it. `queue` + `queue-cloudflare` / `queue-upstash`, `storage` + `storage-cloudflare` / `storage-s3`, and `kv` + `kv-cloudflare` / `kv-upstash` are the same shape applied to bindings.

Hold these rules when you design or extend a capability:

- **The core is vendor-blind.** `packages/<cap>` has zero runtime dependencies. It imports no vendor SDK and no Workers binding. It exports a provider contract (`provider.ts`), a `define<Cap>({ providers })` registry (`define.ts`), a `create<Cap>(env)` factory, and one normalized error type with stable codes.
- **`env` goes in whole.** The factory takes the Worker environment as an opaque object. Which key a provider reads — a binding, a secret, nothing — is exactly what a caller must not learn. Never read `process.env`.
- **A provider is one file plus one patch.** It lands in the core's `providers/` folder and registers through a `plugin-array` patch into the `providers` array. It owns only what differs per vendor: a binding, an npm dependency, a secret. See `.agents/skills/create-provider/`.
- **`<CAP>_PROVIDER` selects at runtime.** Required even when one provider is installed. An unset or unknown value throws at construction. Never fall back to a default, in either direction.
- **Providers normalize their own failures.** Map the vendor code onto the capability's error codes, keep the raw one in `providerCode`, and set `retryable` honestly. A caller's `catch` sees one shape.
- **Ship a local provider.** `-console` or `-memory`, so a project develops and tests the capability with no vendor account and no network.
- **Cloudflare is the default, never the assumption.** If a new provider would need more than one file and a registration patch, the contract is wrong. Fix the contract.

Two boundaries stay in force. A capability owns its vendor packages, and no other workspace imports them (ADR 0020). A **stateful** capability where swapping means a data migration takes [driver modules](CONTEXT.md) instead — `conflictsWith`, exactly one installed, chosen at `add` time, not by an env var — which is how `database`, `database-d1` and `database-postgres` split (ADR 0026). Which capabilities sit on each side of that line is settled by the ADR in #125 Phase 1; read it before you pick.

## Conventions

- **Package manager is pnpm 11**; all non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- Always use `.dev` directory for testing or running `saasaloy` cli commands.
- **Every scaffolded workspace ships a `clean` script.** Any `package.json` under `packages/cli/templates/base/` or `modules/*/files/` must declare `"clean"` backed by an exact-pinned `rimraf` devDependency — never `rm -rf` (not cross-platform). Clean only what the workspace generates (`dist`, `.astro`, `.wrangler`, `*.tsbuildinfo`); the template's root `clean` handles `node_modules` and `.turbo` for the whole repo. See the template's `AGENTS.md`.
- **`pnpm lint` is four passes and it covers everything we ship** — oxlint type-aware over `packages/cli/src scripts`, oxlint plain over `.`, Stylelint, then `prettier --check .`. That includes `packages/cli/templates/base/**` and `modules/*/files/**`. The `-c oxlint.config.mjs` flag is not optional, and **never run `oxlint --fix-suggestions`** (it rewrites `a[i++]` to `a[i += 1]` and the tests still pass). Fix a violation, or suppress the one line with `// oxlint-disable-next-line <rule>` above it and a reason; a repo-wide rule off goes in `oxlint.config.mjs`'s `suppressed` block with its reason. Markdown is deliberately unformatted. See CONTRIBUTING.md "Linting and formatting" and ADRs 0023/0025.
- **Template + module-descriptor deps are pnpm-invisible** — keep them fresh with `pnpm deps:update` (interactive: grouped report → pick bumps → confirm; majors are their own opt-in group) → `pnpm deps:verify`. Exact-pinned, within-major, 3-day cooldown; `--allow-major`/`--allow-fresh` to override, `--yes` for non-interactive. `pnpm deps:check` is the read-only CI gate. See CONTRIBUTING.md "Updating dependencies" and ADR 0016. The repo's own workspace deps stay on `pnpm outdated`/`update`.
