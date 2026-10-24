# {{PROJECT_NAME}} — agent instructions

This is a SaaS project scaffolded with Saasaloy.

## Find the right skill

Every installed module ships a skill in `.agents/skills/<name>/SKILL.md`, linked into `.claude/skills/`. Before you change a module's code, list `.agents/skills/` or run `saasaloy list --installed --json`, which gives each installed module's `skill`, `description` and `stage`, and read that skill first.

## Project Structure

This is a **pnpm workspace monorepo** managed by **Turborepo**.

- **Root**: Configuration files only. Repository tooling lives in `packages/tooling` (see "Code at the Root")
- **`apps/*`**: Applications. The base ships `apps/web` (Astro). `saasaloy add` writes the others: `admin` and `app` (TanStack Router SPAs) and `api` (Hono on Workers)
- **`packages/*`**: Shared packages

### Dev Port Map

Every dev port in this repo is pinned, not assigned on the fly. The api Worker's CORS allow-list and the auth module's trusted origins hardcode the localhost origins, so a drifting port turns into an unexplained CORS rejection.

| Workspace | Port | Dev URL | Pinned in |
| --- | --- | --- | --- |
| `apps/web` (Astro) | 3000 | `http://localhost:3000` | `apps/web/astro.config.mjs` (`server.port`) |
| `apps/admin` (TanStack Router) | 3001 | `http://localhost:3001` | `apps/admin/vite.config.ts` (`server.port`, `strictPort`) |
| `apps/app` (TanStack Router) | 3002 | `http://localhost:3002` | `apps/app/vite.config.ts` (`server.port`, `strictPort`) |
| `packages/email-react` preview | 3003 | `http://localhost:3003` | `packages/email-react/package.json` (`dev`, `--port`) |
| `apps/api` (Hono on Workers) | 4000 | `http://localhost:4000` | `apps/api/wrangler.jsonc` (`dev.port`) |
| Postgres (local, `database-postgres`) | 5432 | `postgres://postgres:postgres@127.0.0.1:5432/app` | `DATABASE_URL` in `packages/env/.env.example` |

The `apps/admin`, `apps/app`, preview and `apps/api` rows apply once you run `saasaloy add` for `admin`, `app`, `email-react` or `api`.

Rules for a new app or service:

- **Take the next free port in the block** — `apps/*` count up from 3000, backend services from 4000. Add a row to this table in the same change.
- **Set `strictPort` (or the framework's equivalent).** A busy port must fail loudly. A silent `+1` moves the app to an origin nothing allows.
- **Name the origin, don't infer it.** A browser-side caller reads `PUBLIC_API_URL` through `webEnv()` or `adminEnv()`, with no fallback — an unset key fails the build naming the key. A server-side caller reads its own key through `apiEnv(c.env)`.
- **Update both allow-lists when you add a browser origin**: `DEV_ORIGINS` in `apps/api/src/index.ts` and `DEV_ORIGINS` in `packages/auth/src/auth.ts`.

### Code at the Root

No code lives at the repository root. The root holds configuration only: `package.json`, `turbo.json`, the lint and format configs, `vitest.config.ts`. A tool, a script or a codemod goes into a workspace, where it gets a `tsconfig.json`, a `typecheck` script, the type-aware lint pass and the root Vitest run. A root `scripts/` folder gets none of them.

`packages/tooling` (`@repo/tooling`) is the workspace for the repository's own tooling. It holds the deploy command (`src/deploy-production.ts`) and the skill linker (`src/link-skills.ts`). A root script that runs one of them names the file: `node packages/tooling/src/<name>.ts`. Two of its files are yours: `src/deploy.config.ts` and `src/targets.ts`. `saasaloy update` never writes them again after `saasaloy init`. The other files are managed.

### Workspace Commands

Run a command in one package with `pnpm --filter <package-name> <command>` (`pnpm --filter @repo/ui build`), and a Turborepo task with `pnpm turbo run <task> --filter <package-name>`.

### The `clean` Script — Required in Every Workspace

`pnpm clean` at the root wipes the repo back to a fresh-clone state: it runs `turbo run clean` across every workspace, then deletes all `node_modules` and `.turbo` directories. Recover with `pnpm install`.

**Every app and package you create MUST declare its own `clean` script.** A workspace without one is silently skipped by `turbo run clean` and leaves stale build output behind.

- Use **`rimraf`** (added as an exact-pinned `devDependency` of that workspace) — never `rm -rf`, which does not exist on Windows. Pass `-g` when any argument is a glob; without it rimraf treats arguments as literal paths.
- Delete only what the workspace **generates**: `dist`, `.astro`, `.wrangler`, `*.tsbuildinfo`. Never delete committed source or generated-then-committed files (e.g. Drizzle migrations).
- Do **not** delete `node_modules` or `.turbo` from a workspace-level `clean` — the root script removes those in one pass after Turborepo has finished. Deleting `.turbo` while Turborepo is still streaming its task log into it fails on Windows.

```jsonc
// apps/<name>/package.json
"scripts": {
  "clean": "rimraf -g dist .wrangler \"*.tsbuildinfo\""
},
"devDependencies": {
  "rimraf": "6.1.3"
}
```

## Tech & Tools

- **pnpm** — non-auth settings live in `pnpm-workspace.yaml` (camelCase), never `.npmrc`. Exact versions are pinned (`saveExact`).
- **TypeScript + ESM.** Internal packages are consumed JIT (no build step) via `workspace:*`.
- **Add features, don't hand-wire them.** Prefer `saasaloy add <module>` over manually creating routes/schema/auth. Most of what a module contributes is a file dropped at a convention-based extension point; the rest is a small reversible patch on a file that has to name its entries statically. An api route is the second kind — `saasaloy add` edits `apps/api/src/index.ts` to add one `.route()` link and its import, and `saasaloy remove` takes both out again. Do not add a route by dropping a file into `apps/api/src/routes/` and expecting it to mount: nothing globs that folder, and the entry file's `AppType` is what the typed `hc` client reads.

### The `@repo/env` Environment Layer

`packages/env` owns every environment value this project reads. One tracked key list, one command that distributes it, one typed gate in front of the capabilities.

- **`packages/env/.env.example` is the key list**, and it is the only example file. It is tracked, and `saasaloy add` regenerates it from the installed modules' own descriptions. A value you type in it survives that, and nothing is ever removed.
- **`packages/env/.env` holds the values**, and it is gitignored. `saasaloy env` prompts for each unset key and writes it.
- **`pnpm env:setup` writes every service's own `.env`** from those two files. A *service* is a workspace that reads a `.env` — `api`, `web`, `admin` — and `packages/env/src/services.ts` is the table. The `deploy` row has no file: it holds the Cloudflare credentials a deploy loads in memory.
- **`pnpm deploy:production` deploys every Worker.** It checks the git gates and every service's production values first, then deploys each Worker one at a time in the order `packages/tooling/src/targets.ts` gives. Each Worker runs its own `env-deploy <service>`: build with the production values in the environment, then `wrangler deploy --secrets-file`. The `local` source reads production values from the gitignored `packages/env/.env.prod`. Nothing writes a production value under `apps/`. The `saasaloy-deploy` skill covers the gates, the flags and the rollback.
- **`createEnv` is the gate.** `apiEnv(c.env)` on the server, `webEnv()` in a frontend. It validates on the first call and throws once naming every failing key, its module and what the key is for.
- **A `client` key must start with `PUBLIC_`**, and the type system enforces it. Client code reading a server key throws by name.
- **There is no `.dev.vars`.** Every runtime here reads `.env`. A leftover `.dev.vars` hides `.env` from wrangler without warning, so `saasaloy doctor` reports one and `pnpm env:setup` carries its values across and deletes it.
- **Never read `process.env`** in a file a Worker imports. Node tooling reads it freely.

The `saasaloy-env` skill is the runbook: adding a key, the section rule, the server/client split, blank-on-purpose keys, and the offline rule.

### The `@repo/config` Value Layer

`packages/config` (`@repo/config`) owns the values this project checks into its repo and ships identically to every environment: the product name, the locale, the legal paths, and each installed module's section. Read it with a plain import, from any app or package:

```ts
import { config } from "@repo/config";

config.app.name; // `siteName` in @repo/ui re-exports this
config.app.locale; // the shared layout's <html lang>
```

It is a frozen plain object, built once at module load. It has **zero runtime dependencies and imports nothing**, which is what lets every app, every package and every browser bundle import it.

**config or `.env`?** Two deployments of *this* project — production and staging. If the value can differ between them it is an env var, secret or not. If it cannot, it is config. A database URL is env; the product's name is config.

**The landing copy is not config.** Prices, tier ids and every sentence on the page stay in `@repo/ui/content/landing.ts`.

Four files, and only one is yours:

| Path | Who owns it |
|------|-------------|
| `src/project.ts` | **You.** The only file here you edit. Nothing overwrites it. |
| `src/sections.ts` | The section registry. `saasaloy add` patches one line in; don't hand-edit the array. |
| `src/sections/<key>.ts` | The module that installed it (`app` is the base's). |
| `src/define.ts` | The base template. The composition core. |

The merge goes **one level below the section**: `app: { name: "..." }` replaces the name and keeps the rest of `app`, while a nested record or an array is replaced whole. A key no installed section defines is a `typecheck` error, which is the only validation there is — the values are literals in this repo. Run `/saasaloy-config` for the whole runbook.

### The `@repo/ui` Design Layer

`packages/ui` owns the design layer: the Tailwind theme in `src/styles/`, the vendored shadcn primitives, the blocks, the containers and the copy. Its own guide is `packages/ui/AGENTS.md`. Read it before you add or change UI in any app. These are the rules that reach past the package:

- **Read the app's `DESIGN.md` first.** `apps/web/DESIGN.md` covers the web app, and `apps/admin/DESIGN.md` covers the admin app when it is installed. There is no `DESIGN.md` at the repository root.
- **No IO in `@repo/ui`.** A block or a container takes its data, its links and its callbacks as props. The app owns fetch, auth, the router and the stores, and passes in what the block needs.
- **Import by subpath.** `import { Button } from "@repo/ui/components/button"`. The package root exports project-wide constants only (`siteName`).
- **The signed-in apps use the `shell` set.** `apps/admin` and `apps/app` import from `@repo/ui/{components,blocks,containers}/shell/*`, and a lint rule makes a base primitive there an error.
- **Words live in `packages/ui/src/content/`**, never in a block, so a copy pass and a later translation find them.
- **No UI kit as a dependency.** Copy a kit's component into `src/components/` or `src/blocks/` as source this project owns.

### The Base Skills

Seven skills ship with the base, as real files in `.agents/skills/` linked into `.claude/skills/`. Two run in order when you make the project yours:

1. **`saasaloy-setup`** interviews the owner once and writes `docs/product-brief.md`, then sets `config.app.name` and `config.app.locale`. Other skills read the brief rather than ask again.
2. **`saasaloy-landing-copy`** writes `packages/ui/src/content/landing.ts` from the brief.

The other five run when the thing they own moves:

- **`saasaloy-design`** keeps each app's `DESIGN.md` true, and swaps the web theme for a shadcn preset.
- **`saasaloy-config`** covers `@repo/config`: a section, the merge rule, config versus `.env`.
- **`saasaloy-env`** covers `packages/env`: adding a key, the server and client split, `pnpm env:setup`.
- **`saasaloy-testing`** says which test a change needs under this project's testing mode.
- **`saasaloy-deploy`** covers `pnpm deploy:production`, its gates and the rollback.

### Naming Conventions

- **Code**: camelCase functions (`fetchUserData`), PascalCase components and types (`UserProfile`, `ApiResponse`), UPPER_SNAKE_CASE constants (`MAX_RETRIES`)
- **Files**: kebab-case for components (`user-profile.tsx`), camelCase for utilities (`utils.ts`)

## Linting, Formatting, and Commit Hooks

The linter is **[oxlint](https://oxc.rs)** configured from **[Ultracite](https://www.ultracite.ai)**'s presets, with **Prettier** and **Stylelint** owning formatting. All four run from `oxlint.config.mjs`, `prettier.config.js` and `stylelint.config.js` at the root — there is no shared config package, because oxlint cannot consume one (`extends` takes file paths, JSON only).

- `pnpm lint` — the gate. Four passes, in order:
  1. `lint:types` — oxlint with `--type-aware` over `packages/config/src`, `packages/env/src`, `packages/tooling/src` and `packages/ui/src`
  2. `lint:code` — oxlint over everything, no type information
  3. `lint:css` — Stylelint over `**/*.css`
  4. `format:check` — `prettier --check .`
- `pnpm lint:fix` — passes 1-3 with `--fix`: the type-aware oxlint invocation over the same four folders, the plain one over everything, then Stylelint. **Never** add `--fix-suggestions`: it rewrites `a[i++]` to `a[i += 1]`, which is a different program.
- `pnpm format` — `prettier --write .`
- `pnpm typecheck` — `turbo run typecheck`, which runs `tsc` in each workspace, and it must pass before you commit.

**Why the type-aware pass is scoped and the plain one is not.** `--type-aware` is a global CLI switch, so the split is by invocation rather than by config. It stays off `.astro` because `apps/web/tsconfig.json` includes the build-generated `.astro/types.d.ts`, which would make `astro sync` a prerequisite of every `pnpm lint`, including on a fresh clone. Do not merge the two passes.

**Markdown is not formatted.** `.prettierignore` excludes `**/*.md` because Ultracite's Prettier config sets `proseWrap: "never"`, which would collapse every hand-wrapped paragraph into a single line.

**Commit hooks are installed by husky** on your first `pnpm install`, and they need a `.git` directory, which `saasaloy init` creates for you. The root `prepare` script is `husky && node packages/tooling/src/link-skills.ts`, so the same install also links every folder in `.agents/skills/` into `.claude/skills/`. pnpm skips `prepare` when an install changes nothing, so after you add a skill folder to a checkout that is already installed, run `pnpm skills:link`. The hooks:

- `pre-commit` runs **lint-staged** over staged files only — oxlint `--fix`, Stylelint `--fix`, Prettier `--write`. It skips the type-aware pass on purpose: that one needs the whole project graph, which defeats staged-file scoping.
- `commit-msg` runs **commitlint** with `@commitlint/config-conventional`, so messages must read `type(scope): subject` — `feat:`, `fix(api):`, `chore(deps):`.

Bypass in a genuine emergency with `git commit --no-verify`, or `HUSKY=0` to skip every hook (which is also how you keep hooks out of CI).

## Testing Instructions

The block below states this project's testing mode, which `saasaloy.json` records under `testing.mode`. Change the mode with `saasaloy testing <off|tests-after|tdd>`, never by hand: the command rewrites the block and the file together. The `saasaloy-testing` skill says what each mode asks and which test each kind of change needs: a unit test, a route test, a seed slice or a Playwright spec. Once `auth` is installed with testing on, `apps/api/src/routes/auth.test.ts` is the route test to copy.

<!-- saasaloy:testing -->
Testing mode: `off`. This project ships no module tests, and `saasaloy add` writes none. Do not add tests unless the owner asks for them.

- Turn module tests on with `saasaloy testing tests-after`, or `saasaloy testing tdd` to work test-first.
<!-- /saasaloy:testing -->

- Run every gate at once: `pnpm check`. It runs `typecheck`, `lint`, `test` and `build` in that order, stops at the first failure, and edits no file. Run `pnpm lint:fix` and `pnpm format` first.
- Run type checking: `pnpm typecheck` (must pass before commits)
- Run linting: `pnpm lint` (see above — it reports, `pnpm lint:fix` fixes, and `pnpm format` rewrites the formatting)
- Run the tests: `pnpm test`. It runs `turbo run test` (each workspace's own `test` script), then `vitest run` from the root, whose `vitest.config.ts` treats every workspace under `apps/*` and `packages/*` as a project. Write new tests for Vitest: put a `*.test.ts` file beside the code, and give the workspace a `vitest.config.ts` only when it needs setup of its own. Do not add a per-workspace `test` script that calls Vitest, or the file runs twice. `packages/env` is the exception: its tests run on `node --test` through its own `test` script, and the root config leaves it out.
- Run the browser suite: `pnpm e2e`, once `saasaloy add e2e` is installed. It is Playwright against the running apps, in `packages/e2e`. Run `pnpm e2e:install` once per machine first to download Chromium. The root `vitest.config.ts` leaves `packages/e2e` out, so `pnpm test` never collects a Playwright spec. The `saasaloy-e2e` skill covers adding a flow and reading a red run.
- `packages/tooling` tests run on Vitest through the root `vitest.config.ts`, like every other workspace. The workspace has a `typecheck` script and no `test` script, so `pnpm test` runs each file once.
- Before you hand over UI work, run `pnpm dev`, load the pages you changed, and read the dev server's terminal output. Fix every error and warning it prints. A clean build does not prove a clean dev server.

## Branches and Deploys

- **Deploy from `main`.** `pnpm deploy:production` starts only from a branch that `branches` in `packages/tooling/src/deploy.config.ts` allows: `main` and `hotfix-*` by default. Every other branch fails the branch gate.
- **A fix while `main` holds unreleased work goes on a `hotfix-<slug>` branch** cut from the last deploy tag: `git switch -c hotfix-<slug> "$(git describe --tags --match 'deploy-*' --abbrev=0)"`. Deploy from that branch, then merge it into `main` so the next deploy keeps the fix.
- **No long-lived production branch.** The newest deploy tag marks the commit that is live, so no branch has to.
- **Never move or delete a deploy tag.** Each successful deploy pushes an annotated `deploy-<UTC yyyymmdd-hhmm>` tag. `git log <tag>..main` lists what the next deploy ships, and a hotfix branches from the tag.
- **Release before you deploy.** `pnpm release` bumps the root `package.json` version, writes `CHANGELOG.md`, and pushes an annotated `v<version>` tag and a GitHub Release. The `v*` tag names the release, and the `deploy-*` tag records when it went live. A deploy from a commit that is not a release warns and still runs. Never move or delete a release tag, and never edit `version` by hand.
- **Merge a hotfix branch into `main`, never rebase it.** A rebase rewrites the commit its release tag names.
- **An agent deploys only after the owner says so in the same session.** It runs `pnpm deploy:production --dry-run` and reports first. The `saasaloy-deploy` skill is the procedure, and `docs/runbook-deploy.md` holds this project's own deploy steps.

## Unattended work

An agent may build this project with no person at the keyboard. These rules apply only then, and they override "Ask First" where they say so.

- **The signal is `autonomy: afk`** in the YAML frontmatter of `docs/product-brief.md`. Only a person sets it: `saasaloy-setup` asks "Run the build unattended?" as its last question. With no such field, every skill keeps its attended path and asks.
- **A person supplies the two inputs**: the env values in `packages/env/.env`, and the brief, written through the attended `saasaloy-setup` interview. The person also runs `pnpm env:setup` before the first build. The brief is complete when all ten answers are filled (Name, Language, Audience, Problem, Current alternative, Differentiator, Proof, Tone, Pricing, Where "sign up" goes) and none is tagged `weak:`. With an incomplete brief, stop before the first module and list each missing or weak section under `## Blocked` in `docs/build-log.md`.
- **`pnpm check` is the gate.** Run `pnpm lint:fix` and `pnpm format`, then `pnpm check`. A stage is not done until it passes.
- **Commit once per stage on `build/mvp`.** Create the branch if it does not exist, and continue on it when it does. Commit through the Husky and commitlint hooks, never with `--no-verify`. Never push.
- **`docs/build-log.md` is the output.** Give each stage a `## <stage>` section with what it did and its commit hash. Put what stopped the run under `## Blocked`, and each step you leave for a person under `## Left for a human`. A new session reads the log first and continues from the last stage with a commit.
- **Allowed without asking:** database schema changes and migrations, new dependencies (exact-pinned), and new workspace packages (with a `clean` script).
- **Still forbidden:** a deploy (`pnpm deploy:production`, `wrangler deploy`), anything that spends money or creates a vendor account, editing a secret (`packages/env/.env`, `.env.prod`, a dashboard), deleting data outside the local dev database, and `git push`. Every other "Ask First" item stays forbidden too. Log the step under `## Left for a human` and carry on.

## Boundaries

### ✅ Always Do

- Read the app's `DESIGN.md` (`apps/web/DESIGN.md` for the web app, `apps/admin/DESIGN.md` for the admin app) before writing or changing UI
- Run `pnpm typecheck` before committing code changes
- Run `pnpm lint` and fix all errors
- Give every new app or package a `clean` script backed by `rimraf` (see above)
- Use TypeScript strict mode (no `any` without explicit reason)
- Use workspace package names (`@repo/ui`, `@repo/config`, `@repo/tsconfig`) for imports
- Put a value you would otherwise write twice in `@repo/config`, and a per-deployment value in `packages/env/.env` — see above

### ⚠️ Ask First

Under `autonomy: afk`, "Unattended work" above decides these instead.

- Adding new dependencies (especially to root `package.json`)
- Building new UI before the owner has approved a mockup. Show screenshots of the mockup first and get approval. A change after approval gets a new mockup, not a fix after the work lands
- Modifying Turborepo configuration (`turbo.json`)
- Changing TypeScript strictness settings
- Modifying the husky hooks (`.husky/`), `lint-staged.config.js`, or `commitlint.config.js`
- Creating new workspace packages
- Changing `oxlint.config.mjs`, `prettier.config.js`, or `stylelint.config.js` — including turning a rule off. Suppress the one occurrence with a comment that says why instead
- Database schema changes or migrations
- CI/CD workflow modifications (`.github/workflows/`)

### 🚫 Never Do

- Never use `npm` or `npx`, instead use `pnpm` & `pnpm dlx`
- Never use `rm -rf` in a package script — it breaks on Windows; use `rimraf`
- Commit secrets or API keys. `packages/env/.env` is gitignored; `packages/env/.env.example` is tracked and holds local defaults only
- Modify `node_modules/` or `pnpm-lock.yaml` manually (use `pnpm install`)
- Remove or disable TypeScript strict mode
- Remove or disable the lint-staged or commitlint hooks, or commit with `--no-verify` as a habit rather than an emergency
- Use `any` type without explicit `@ts-expect-error` or `@ts-ignore` with justification
- Break the workspace structure (don't move packages outside `apps/*` or `packages/*`)
- Commit without running type checks and linting
