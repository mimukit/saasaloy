# Plan: an agent builds a SaaS MVP on Saasaloy with no human at the keyboard

Grilled: 2026-10-24

## Context

An AI coding agent that gets only the Saasaloy repo URL and "build a SaaS MVP" cannot reach a working MVP today. It finds no consumer entry point, it cannot pick modules from data, some CLI commands hang or refuse with no flag to answer them, the base skills interview a human, and no skill tells it how to build a product feature across the stack. The signed-in end user also has no app to land in: `admin` is gated on the admin role (`modules/admin/files/src/lib/auth.ts:77`), and #183 leaves the customer panel unplanned. And no email is sent anywhere in the flow: `auth` sets `requireEmailVerification: false` and does not depend on `email` (`modules/auth/files/src/auth.ts:81`).

Two recent plans close part of the gap, and this plan builds on them rather than repeating them. Plan 0072 put Vitest in the base, `pnpm db:seed` with per-table seed slices, and a route test harness on a real database. Plan 0070 put `pnpm deploy:production` in the base.

The gap audit behind this plan was a chat report on 2026-10-19. Its findings, with the file references, are carried into the phases below.

Success: a headless agent starts in an empty folder that holds a complete product brief and a local env file. With no further human input it ends at the MVP bar below. A benchmark script measures this, and the plan is done when one benchmark run reaches the bar.

**The MVP bar (local only).** It matches the README's "Build the MVP" row: `auth`, `admin`, `email` with `email-console`, plus the new `app` module and one entity.

- The landing page carries copy derived from the brief, not Saasaloy's default copy.
- A visitor signs up and signs in through the `app` module and lands on a signed-in screen.
- A password reset request writes a reset mail to the `email-console` output.
- One product entity from the brief exists end to end: table, migration, seed slice, validator, api route, a screen in `app`, a list in `admin`, and a route test.
- `pnpm check` passes, and `pnpm db:seed` runs twice with the same counts.
- The work sits in one commit per stage on the `build/mvp` branch, with nothing pushed.
- `docs/build-log.md` records each stage, its commit, and each step the agent left for a human.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| MVP bar | Local only, with the modules in the README's MVP row. The agent stops at a running, seeded, tested local app. Deploy stays a human step through plan 0070's `pnpm deploy:production`. |
| Product UI home | A new `app` capability module: a customer SPA at `apps/app` on port 3002, open to every signed-in user. The `web` app holds only public pages. |
| Module name | `app`, at `apps/app`. Docs write it as the code span `app` to keep it apart from the plain word. |
| Shared shell | A new `shell` capability owns the layout, nav, user menu and theme toggle under `@repo/ui/*/shell`, and the primitives and blocks they and the apps render (see "`shell` owns"). `admin` and `app` both depend on it. It holds no auth logic: `admin` guards on the role, `app` guards on the session. The work moves #204's shell paths after #204 merges, and does not reopen #204. |
| Sign-in and sign-up | `auth` writes `blocks/auth/sign-in.tsx` and `blocks/auth/sign-up.tsx` into `@repo/ui`. Each takes an `onSubmit`, per the no-IO rule. Each app renders them on its own route and calls `authClient` there. `admin`'s `login.tsx` renders the block. The blocks import the `shell` primitives and install with `onlyWith: shell`, so `auth` gets no new dependency and a project with no SPA gets no unused blocks (#226 grill, 2026-10-24). If #225 lands before #226, it uses `components/admin/*` with `onlyWith: admin`, and #226 moves both to `shell`. |
| Password reset mail | `auth` ships an `onlyWith: email` file that sets Better Auth's `sendResetPassword` through `@repo/email`. Email verification stays off. |
| Human input contract | The human writes a complete `docs/product-brief.md` through the attended `saasaloy-setup` interview, and supplies the env values in a file. After the agent starts, it never asks. |
| Complete brief | All ten `saasaloy-setup` sections are present and filled, and none is marked weak. With an incomplete brief, the unattended run stops before the first module and lists the missing sections under "Blocked" in `docs/build-log.md`. |
| AFK signal | `autonomy: afk` in the frontmatter of `docs/product-brief.md`. The human sets it: `saasaloy-setup` asks "Run the build unattended?" as the last interview question. Every skill with an interview checks the field. |
| Unattended permissions | Under `autonomy: afk`, the base `AGENTS.md` "Ask First" items (schema changes, new dependencies, new workspaces) are allowed. Deploy, spending money, secret edits, deleting data outside the dev database, and `git push` stay forbidden. |
| Commits in unattended work | One commit at the end of each stage, on the `build/mvp` branch, through the project's Husky and commitlint hooks. No push. A resumed run continues on the existing branch. |
| Entry point | Docs and skills, no MCP server. A consumer `llms.txt` and a wiki page in this repo, a `saasaloy-build` skill in every generated project, and `--json` output on the CLI. |
| `AGENTS.md` stays static | ADR 0007 holds. A module never appends to `AGENTS.md`. The agent finds installed module skills by listing `.agents/skills/` and through `saasaloy list --installed --json`. ADR 0007's stale "module guidance is Claude-only" consequence is corrected. |
| No-TTY rule | Every prompt in the CLI goes through one guard. With no TTY and no flag that answers the prompt, the command exits 2 and names the flag. No command waits on stdin it cannot read. |
| JSON output shape | `--json` prints one JSON document to stdout with a top-level `schemaVersion: 1`. The TUI and warnings go to stderr. Exit codes stay as `lib/exit.ts` defines them. |
| Env values with no prompt | `env --from-file <path>` and `env --set KEY=VALUE` both ship. Skills and docs use `--from-file`, because `--set` leaves a secret in shell history. |
| `update --resolved` | Records the file's current hash as the new baseline in the manifest, the same model as ADR 0006. It does not check the content. |
| Descriptor vocabulary | Two fixed enums. `stage` is one of `validate`, `mvp`, `teams`, `money`, `scale`. `needs` is a list from `cloudflare-paid`, `stripe`, `domain`, `vendor-account`. The schema keeps both optional, and this repo's `doctor` requires `description`. |
| One check command | `pnpm check` runs typecheck, lint, test and build, and stops at the first failure. It edits no file. Skills run `pnpm lint:fix` and `pnpm format` before it. |
| ADRs | Two, written at the grill: ADR 0046 for the CLI's unattended contract (the no-TTY rule and `--json` with `schemaVersion`), and ADR 0047 for the `app` module as the product UI home, with `shell` as its shared owner. |
| Test runners | CLI changes test with the CLI's Vitest suite (`packages/cli`). Repo scripts, the scorer and the skill lint test use `node --test` beside the script. `app` routes use plan 0072's route test harness. `shell` and `app` screens get no DOM tests. The scorer checks them over HTTP, and #202 and #203 own UI tests. |
| Benchmark | Claude Code in headless mode: `claude -p --permission-mode bypassPermissions --max-turns 400`, run on demand on this box, inside `.dev/bench/` only. It does not run in CI. |
| Benchmark input | One hand-written B2C single-user brief at `scripts/agent-bench/brief.md`, complete and with `autonomy: afk`. The owner reviews it in the Phase 2 PR. A second brief, for a B2B team product, comes after the first PASS and is outside this plan. |
| Benchmark cadence | Manual runs before a release, and after a change to a base skill or to the CLI's unattended contract. `CONTRIBUTING.md`'s release checklist gets a line for it. |
| Approved outward actions | Phase 13 may file GitHub issues for FAIL lines, labelled `needs-planning`, with no human present. Publishing this plan may edit #183's body to drop the customer panel and link this plan. Nothing else. |
| UI house rules for `shell` and `app` | The rules in the base `apps/web/DESIGN.md` and `AGENTS.md`, plus the admin shell rules #192 settles. The visual reference is PR #204's admin shell. Phase 1 approves the `app` variant of it. |
| `app` look | The `shell` frame with the web brand tokens, light first. `admin` keeps its dark backoffice theme. Settled in the #227 grill on 2026-10-22. |
| Brand tokens | The token block of the base `packages/ui/src/styles/web.css` moves to `brand.css`: the token values, `@custom-variant dark` and `@theme inline`. `web.css` imports it and keeps the landing layout and motion CSS. The `app` stylesheet imports it too. `components.json` and the `apps/web/DESIGN.md` fingerprint name `brand.css`, because shadcn merges a preset in place only in the file that holds both blocks. |
| `shell` stays app-neutral | `shell` has no dependency on `admin` and imports no app stylesheet. Its components read semantic tokens only, and `shell.css` adds `@source` for the shell folders. This is what lets `saasaloy add app` run with no `admin`. |
| `shell` owns | Everything generic in #204's set: the ~40 coss primitives and their `NOTICE.md`, every block except the `feature-flags` block, the 6 containers, the 3 `lib` helpers, the brand mark asset and `assets.d.ts`, and the `@tanstack/react-table` patch that `data-table` needs. `admin` keeps `admin.css`, the `apps/admin` scaffold and the api route. `feature-flags` keeps its block at `blocks/admin/feature-flags.tsx`. `shell` has `dependsOn: []`, because the base `packages/ui` carries every other package it imports. Settled in the #226 grill on 2026-10-24. |
| `shell` paths | `@repo/ui/{components,blocks,containers,lib}/shell/*`, per ADR 0047. Each file keeps its name and changes only its folder, so `containers/admin/shell-layout.tsx` becomes `containers/shell/shell-layout.tsx`. ADR 0047 gets a dated amendment that `shell` owns the primitives, blocks, containers, helpers and `shell.css`. |
| `shell` tokens | `shell` ships `packages/ui/src/styles/shell.css`. It holds the `@source` lines for the shell folders, the `@theme inline` mapping for `destructive-foreground`, `success`, `warning`, `info`, the `status-ok`, `status-warn`, `status-bad` and `status-open` pairs and `accent-sort`, the `--animate-skeleton` and `--animate-toast-*` keyframes, and default values in `:root` and `.dark` from the approved mockup's Tailwind ramp values. It imports nothing. An app stylesheet imports its theme, then `shell.css`, then sets its overrides. `admin.css` keeps its measured values as overrides. |
| `shell` props | `ShellSidebar` takes `subtitle` (default `"Admin"`, `null` hides it). `ShellLayout` takes `trail`, as the approved mockup wrote it. The avatar fallback keeps `bg-muted` and adds `ring-1 ring-border`, so the circle shows on every canvas. The `shell-sidebar.tsx` comments name the app's sign-in route, not `/login`. |
| `shell` consumers | The seven modules that write admin screens (`teams`, `billing`, `payment`, `feature-flags`, `multitenant`, `file-uploads`, `api-keys-organization`) change their imports to the `shell` paths in #226 and keep `dependsOn: admin`. The base `oxlint.config.mjs` twin-primitive rule adds the `shell` folders to its globs. |
| Pre-`shell` `admin` projects | The changelog gives the steps, under the breaking changes of the release (`feat(shell)!`): one `saasaloy update` of every installed module, so `shell` installs and the dependent modules get the new imports, then one `sed` line over the project's own files, then the merge plan for an edited file, then `pnpm check`. #226 tests the steps in a `.dev` project made from the pre-move registry. `saasaloy-shell` repeats them. No compatibility stubs and no CLI codemod. |
| `shell` token guard | `scripts/shell-tokens.test.ts`, under `node --test`, reads the class names in `modules/shell/files/**` and checks that the base `web.css` token block or `shell.css` defines each colour and `animate-` token. |
| `app` dev origin | `http://localhost:3002` goes into `DEV_ORIGINS` in the base source of `api` and `auth`, the same as 3001, with no patch. A project made before that release gets it through `saasaloy update api auth`. `saasaloy-app` says so in its wire-up step and names the CORS symptom in failure modes, and the changelog says the same. |
| `app` production origin | No new key. The production `app` origin goes into `CORS_ORIGINS`, the one list the api CORS spine and `auth`'s `trustedOrigins` both read through `packages/env`. `saasaloy-app` documents it with `COOKIE_DOMAIN` and the workers.dev case. |
| `app` deploy | `apps/app` ships an assets-only `wrangler.jsonc` with `not_found_handling: "single-page-application"`, a `"deploy": "env-deploy app"` script, and an `app` row in `packages/env/src/services.ts`, like `admin`. `pnpm deploy:production` deploys it. |
| `app` routes and home | `/sign-in`, `/sign-up` and `/`. The safe-destination check copies admin's `redirect.ts`, and a sign-up lands on `/`. The scaffolded home has a welcome panel and an empty state that points to `saasaloy-feature`, with no demo entity. The list and form patterns ship as recipes in `saasaloy-app`. |
| `app` port | 3002, as settled on 2026-10-21. The `email-react` preview held 3002 and moves to 3003, settled in the #227 grill on 2026-10-22. |
| Password reset screens | Outside #227. #230 plans reset blocks in `auth` and the routes in `app`. |
| `app` tests | `app` adds no api route, so it ships no route test. A CLI e2e test adds `app` to base, `api`, `database-d1` and `auth` with no `admin`. `pnpm check` runs in a `.dev` project. |

## Approach

Treat "agent native" as a contract with three parts, then fix each place the contract breaks. The parts are one human input at the start, one command that says whether the work is done, and one file where the agent writes what it did and what it could not do. A benchmark measures the contract before and after, so the work stops when an agent reaches the bar and not when the list runs out.

What it reuses:

- `isInteractive()` in `packages/cli/src/lib/tui.ts` and the refusal pattern `add` and `update` already use (`add.ts:607-618`, `update.ts:551`).
- The exit codes in `packages/cli/src/lib/exit.ts`.
- The `requiresOneOf` resolution in `packages/cli/src/lib/requires.ts` for `add --with`.
- The manifest hash model (ADR 0006) for `update --resolved`.
- `docs/wiki/modules.md` and `docs/wiki/reference.md` as the source text for each module's `description`, `stage` and `needs`.
- PR #204's shell under `modules/admin/files/ui/{components,blocks,containers}/admin` as the content of `shell`.
- The `admin` module (descriptor, `login.tsx`, the "Add a screen" recipe in `saasaloy-admin`) as the base for the `app` module.
- The `onlyWith` mechanism for the password reset file.
- Plan 0072's seed slices and route test harness for the feature recipe and the MVP bar.
- `scripts/saasaloy-shim.sh`, `SAASALOY_REGISTRY_DIR` and the `.dev/` convention, so the benchmark runs the local CLI and the local modules.
- The add command's skill pointer (`add.ts:328-354`) for the "next skill" handoff.

Rejected, one line each: an MCP server (a second interface to keep in step with the CLI, and every agent already runs shell commands); a generated section in `AGENTS.md` (ADR 0007 rejected regenerated views for a reason that still holds); module stacks as the first move (#58 composes modules but does not teach the agent to build a feature); named human checkpoints during the run (intake up front instead); an idea file as the minimum intake (the agent would invent product decisions nobody made); `app` depending on `admin` for its shell (customer code would import "admin"); a copied shell per app (about 60 files that drift).

### Phase 1: approve the `app` shell mockup (#227)

Attended: the owner approves the mockup screenshots in the planning session. It waits on PR #204 to merge.

- Wait for PR #204 (the admin shell rebuild) to merge, so the mockup starts from the shell that `shell` will own. The approval row records the main SHA the mockup used, and a shell change after it starts a new round.
- Build the mockup as a throwaway Vite app under `.dev/app-mockup/` that renders the merged #204 components and the `brand.css` tokens with fake data. Keep only the screenshots, under `docs/plans/assets/`, and delete the app after approval.
- Mock up four `app` screens: sign in, sign up, the signed-in home with one entity list, and one entity form. The entity is a neutral "Projects" demo: name, status pill, member count and updated in the list, and name, description and status in the form. Show both themes and a 360px width.
- Record the approval and the round it settled on as a row in this plan's Design decisions.
- Phases 2 to 7 and the Phase 9 prep do not wait on this phase. The rest of Phase 9 does.

Done when: this plan carries an "`app` mockup approved" row with a date and a screenshot path.

### Phase 2: the benchmark and a baseline run (#222)

- Add `scripts/agent-bench.ts`. It makes an empty folder `.dev/bench/<run-id>/` and copies in `scripts/agent-bench/brief.md` as `./product-brief.md` and `scripts/agent-bench/env` as `./env`. It puts the local CLI on `PATH` through `scripts/saasaloy-shim.sh` and sets `SAASALOY_REGISTRY_DIR` to this repo's `modules/`. Then it starts `claude -p` with the prompt in `scripts/agent-bench/prompt.md`.
- The prompt names the repo URL, `./product-brief.md` and `./env`, and asks for a SaaS MVP. Nothing else.
- Write the brief fixture: a B2C single-user tool, complete, with `autonomy: afk`.
- Add `scripts/agent-bench/score.ts`. It checks each MVP bar line against the finished project and prints PASS or FAIL per line. It starts the dev servers on the pinned ports and stops them, with a timeout. When a line fails, it reads `docs/build-log.md` for the stop point. Tests for its log parsing sit beside it on `node --test`.
- Run it once against main. Save the result as the next `docs/research/NNNN-research-agent-bench-baseline-YYYY-MM-DD.md`.

Done when: `node scripts/agent-bench.ts` finishes with a per-line PASS/FAIL table and leaves no process running, and the baseline report names the first step where the agent stopped.

### Phase 3: no command waits on a missing TTY (#223)

- Route every `@clack/prompts` call in `packages/cli/src/commands/` through the guard. That covers the `init` name prompt (`init.ts:291`), the `init` install prompt (`init.ts:439`), and the `remove` confirms (`remove.ts:325`, `remove.ts:340`).
- Add `init --yes`, which installs with no prompt. Make a failed `pnpm install` in `init` exit 1 (`init.ts:449-470`).
- Make a cancel exit 1 in `env` and `new` (`env.ts:358`, `new.ts:186`), as `exit.ts` defines.
- Add a CLI test that runs every command with stdin closed and a timeout. It asserts that each command exits within the timeout with a code from `exit.ts`.

Done when: the closed-stdin test passes for every command in `packages/cli/src/commands/index.ts`, and `saasaloy init </dev/null` exits 2 and names `<name>`.

### Phase 4: a flag answers every prompt (#223)

- `add --with <module>` satisfies a `requiresOneOf` choice, so `saasaloy add waitlist --with database-d1 --yes` installs in one command.
- `env --from-file <path>` and `env --set KEY=VALUE` (repeatable) write `packages/env/.env` with no prompt. Both check each key against the installed modules' `envVars` and refuse an unknown key.
- `update --resolved <path>` (repeatable) records the file's current hash in the manifest. The next `update` stops offering that file, and exits 0 when nothing is left (`merge-plan.ts:291-300`).
- Fix `docs/wiki/reference.md`: the `env` section (lines 157-177), the commands that read `GITHUB_TOKEN` (line 331), and the new flags.

Done when: a CLI e2e test builds a project with `auth`, `admin`, `email`, `email-console` and `waitlist --with database-d1` using flags only and no TTY, and a second `update` after `--resolved` exits 0.

### Phase 5: the CLI speaks JSON, and modules describe themselves (#223)

- Add `description` (one line), `stage` and `needs` to `registry-item.schema.json`, with the enums from Design decisions. Fill all three on every descriptor.
- Make `saasaloy doctor` in this repo fail a descriptor with no `description`.
- Add `--json` to `list`, `doctor`, `outdated`, `env --check` and `add --dry-run`. `list --json` carries name, tier, description, stage, needs, `dependsOn`, `requiresOneOf`, `conflictsWith`, `envVars`, the skill name and an `installed` flag.
- Add `list --installed`.
- Keep [ADR 0046](../adr/0046-adr-the-cli-runs-unattended-by-refusing-never-by-guessing-2026-10-21.md) true: amend it if the build changes the no-TTY rule or the `--json` shape.

Done when: `saasaloy list --json | node -e` parses, every module in it has a non-empty `description`, `stage` and `needs`, and `saasaloy add waitlist --dry-run --json` lists every file and patch that the human-readable plan shows.

### Phase 6: the generated project's agent guide (#224)

- Cut the base `AGENTS.md` to 250 lines or fewer. Move the design-layer detail (about 360 lines today) into `packages/ui/AGENTS.md`, with a `packages/ui/CLAUDE.md` that holds `@AGENTS.md`.
- Drop the migration notes for projects made before the theme split from `AGENTS.md`. They stay in the changelog and the `update` merge plan.
- Fix the stale lines: `apps/*` "currently empty" (L11), "TanStack Start" (L23), "Three skills" (L468), the `git init` claim in `saasaloy-setup`, and the `uikit` pointer in `saasaloy-design`.
- Add `pnpm check` to the base `package.json`.
- Add an "Unattended work" section. It names `autonomy: afk` as the signal, the brief as the input, `pnpm check` as the gate, `build/mvp` and one commit per stage as the record, and `docs/build-log.md` as the output. It lists what the agent may do and what stays forbidden, per Design decisions.
- Add a "Find the right skill" section: list `.agents/skills/`, or run `saasaloy list --installed --json`.
- Correct the consequence line in ADR 0007.

Done when: `wc -l` on the base `AGENTS.md` prints 250 or fewer, a scaffolded project has `packages/ui/AGENTS.md`, and `pnpm check` passes on a fresh `saasaloy init` project.

### Phase 7: auth blocks and the password reset mail (#225)

- Add `blocks/auth/sign-in.tsx` and `blocks/auth/sign-up.tsx` to the `auth` module's files, written into `@repo/ui`. Each takes an `onSubmit` and does no IO. They import the `shell` primitives and install with `onlyWith: shell`.
- Change `admin`'s `login.tsx` to render the sign-in block.
- Add an `onlyWith: email` file to `auth` that sets `sendResetPassword` through `@repo/email`, with a template in the email module's convention.
- Document both in `saasaloy-auth`, with a "Wire-up" section for the blocks.

Done when: in a project with `auth`, `admin`, `email` and `email-console`, a POST to the api's password reset endpoint writes a reset mail to the api's stdout, and the admin sign-in still works with a seeded admin.

### Phase 8: the `shell` capability (#226)

- Add `modules/shell/` as a capability with `dependsOn: []`. Move the files "`shell` owns" names from `@repo/ui/*/admin` to `@repo/ui/*/shell`, with no auth logic.
- Add `shell.css` per "`shell` tokens". `admin.css` imports it and keeps its values as overrides.
- Add the `subtitle` and `trail` props, the avatar ring and the sign-in route comments per "`shell` props".
- Make `admin` depend on `shell` and import from the new paths. Change the seven consumer modules and the base lint rule per "`shell` consumers".
- Add `scripts/shell-tokens.test.ts` per "`shell` token guard".
- Ship `saasaloy-shell` with "Add a nav entry", "Use the shell in a new app", wire-up, removal and the upgrade steps. Update the docs that name the admin paths: the base `AGENTS.md`, `saasaloy-design`, the containers `README.md`, `saasaloy-admin` and `CONTEXT.md`. Amend ADR 0047.
- Test the upgrade steps in a `.dev` project made from the pre-move registry, and write them in the changelog.

Done when: `saasaloy add admin` in a fresh project also installs `shell`; the admin app renders its shell from `@repo/ui/*/shell`; `modules/admin/files/ui` holds only `styles/admin.css`; `saasaloy add shell` works with no `admin`; `scripts/shell-tokens.test.ts` passes; and the changelog steps take a pre-move `.dev` project to a passing `pnpm check`.

### Phase 9: the `app` module (#227)

Prep, which does not wait on Phase 1: add `http://localhost:3002` to `DEV_ORIGINS` in the base source of `api` (`modules/api/files/src/index.ts`) and `auth` (`modules/auth/files/src/auth.ts`), add the 3002 row to the `AGENTS.md` port map, move the `email-react` preview from 3002 to 3003 (its `dev` script, its skill and a port map row), and correct the `CORS_ORIGINS` description in `modules/api/files/src/env.ts`, which says the localhost origins are always allowed when a set value replaces them. Split the base `web.css` token block into `brand.css` per Design decisions, prove the web build gives the same CSS, and prove a shadcn preset apply still merges in a `.dev` project.

- Add `modules/app/` as a capability that depends on `api`, `auth` and `shell`. It scaffolds `apps/app` on port 3002 with `strictPort`, the shell approved in Phase 1, sign-in and sign-up routes that render the `auth` blocks, a signed-in home, and the error screen from `@repo/ui`.
- The home has no demo entity. `@repo/ui/styles/app.css` imports `brand.css` and adds `@source` for the shell folders.
- Ship an assets-only `wrangler.jsonc` with the single-page-application fallback, a `deploy` script through `env-deploy app`, and an `app` row in `packages/env/src/services.ts`.
- Ship `saasaloy-app` with "Add a screen" (with the list and form recipes from the approved mockup), "Protect a screen", "Call the api", wire-up, removal and failure modes. Wire-up names `saasaloy update api auth` for a project made before the prep release and the production origin in `CORS_ORIGINS`. Failure modes names the CORS symptom, `COOKIE_DOMAIN` and the workers.dev case.
- Ship a seed slice only if the module adds a table, and a route test for any route it adds. Add a CLI e2e test that adds `app` with no `admin`.
- Keep [ADR 0047](../adr/0047-adr-the-signed-in-product-lives-in-an-app-module-on-a-shared-shell-2026-10-21.md) true: amend it if the build changes the `app` or `shell` decision.

Done when: in a project with `app`, a seeded plain user signs in at `http://localhost:3002` and sees the home screen, a signed-out visit redirects to sign in, `saasaloy add app` works in a project with no `admin`, `pnpm deploy:production` includes `apps/app`, and `pnpm check` passes.

### Phase 10: AFK paths for the base skills (#224)

- `saasaloy-setup`: the interview stays attended. Its last question, "Run the build unattended?", writes `autonomy: afk` to the brief's frontmatter. When a later run finds `autonomy: afk` and a complete brief, it sets `siteName` and `lang` and asks nothing. With an incomplete brief, it lists the missing sections under "Blocked" in `docs/build-log.md` and stops.
- `saasaloy-landing-copy`: under `autonomy: afk`, it writes `landing.ts` from the brief with no draft approval, and it logs the change in `docs/build-log.md`.
- `saasaloy-design`: under `autonomy: afk`, it picks a preset that fits the brief's tone, applies it, and re-derives `apps/web/DESIGN.md`.
- With no `autonomy: afk`, all three keep their current attended path.

Done when: each of the three skills, started on the benchmark brief, writes its output with no question to the user, and `saasaloy-setup` started on a brief with one empty section stops and logs that section.

### Phase 11: the build skill and the feature recipe (#228)

- Add `saasaloy-build` to the base skills. It moves `./product-brief.md` into `docs/` after `init` when it finds one there. It checks that the brief is complete, picks modules from `saasaloy list --json` by `stage` and `needs`, and runs the stages in order on `build/mvp`. Each stage ends with `pnpm lint:fix`, `pnpm format`, `pnpm check` and one commit. It writes and resumes `docs/build-log.md`, so a new session continues where the last one stopped.
- Add `saasaloy-feature` to the base skills: one entity from start to finish. The steps are table, `db:generate`, migrate, seed slice, validator, route, `hc` client, a screen in `app`, a list in `admin`, a route test, and `pnpm check`. It hands off to each module skill for the detail and does not copy it.
- Give each capability skill a "Next" line naming the skill that usually follows: database, then validators, then api, then `app` or admin.
- Add a "Wire-up" section to each skill whose module writes a UI block, as `add` already expects (`add.ts:344-354`).
- Add removal and failure-mode sections where the gap audit found none: email, logger, sms, kv, storage, queue, validators, teams.

Done when: `scripts/skills.test.ts` passes on `node --test`. It checks that each capability skill has a "Next" line and each skill of a UI-writing module has a "Wire-up" section.

### Phase 12: the consumer entry point (#228)

- Add `llms.txt` at the repo root. It says what Saasaloy is, how to start a project, that a complete brief is the required input, where the build skill is, and links the wiki pages an agent needs.
- Add `docs/wiki/how-to/build-with-an-agent.md`. It covers how to run `saasaloy-setup` to write the brief, the env file, the prompt to give, what to expect in `docs/build-log.md` and on `build/mvp`, and what stays a human step.
- Add one line at the top of the root `AGENTS.md` that sends an agent which wants to use Saasaloy, not develop it, to `llms.txt`.
- Link the page from `README.md` and `docs/wiki/index.md`.

Done when: `llms.txt` exists, and a `node --test` script test checks that every link in it resolves to a file in this repo.

### Phase 13: the benchmark reaches the bar (#228)

- Run `scripts/agent-bench.ts`. For each FAIL line, fix it in this plan's scope or file a GitHub issue labelled `needs-planning`, then run again.
- Stop after 3 runs. If FAIL lines remain, the report lists them with their issues.
- Save the final run as a research report beside the baseline.
- Add the benchmark line to the release checklist in `CONTRIBUTING.md`.

Done when: one benchmark run prints PASS on every MVP bar line, and the report links that run's `docs/build-log.md`.

## Open questions

None. The grill on 2026-10-21 settled every question in the draft, the #227 grill on 2026-10-22 settled the `app` details, and the #226 grill on 2026-10-24 settled the `shell` details.

## Non-goals

- Deploy. Plan 0070 owns `pnpm deploy:production`, and #199 owns a CI deploy. The agent stops at a local app.
- Real vendor accounts (Stripe, Cloudflare Email, a domain). The bar uses local providers only.
- An unattended path that starts from an idea and writes the brief. A human writes the brief.
- A second benchmark brief, which comes after the first PASS.
- A CI workflow in the generated project.
- An MCP server for the CLI.
- Module stacks (#58) and `init --stack`.
- A browser e2e suite (plan 0059, PR #164), DOM tests (#203) and an automated a11y check (#202). The scorer checks over HTTP.
- `payment` and `subscription` in the bar. They join a later bar after #211 lands.
- Polish of the `web` landing page and the admin shell beyond what Phase 1 approves. #191, #192 and the rest of #183 own those.
