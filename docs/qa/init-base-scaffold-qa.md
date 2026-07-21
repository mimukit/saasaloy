# QA Plan: `saasaloy init` base scaffold (Phase 0 vertical slice)

_Generated 2026-07-21 · covers commits `52db5ba` (extract syncProject) → `875bd91` (init command) → `411ec03` (base template): the end-to-end slice `saasaloy init` → generated base project → `sync` → `build` → Cloudflare deploy config._

## Summary
`saasaloy init <name>` scaffolds a near-inert Cloudflare-native base — an Astro marketing site (`apps/web`), stub `@repo/ui`, `@repo/config`, a pnpm 11 + Turborepo workspace, the `.agents/` agent layer, and a `wrangler.jsonc` for static-assets deploy — with the project name substituted throughout, then runs `sync` to generate the agent views. "Working" means: a human runs `init`, then `pnpm install && pnpm dev`, sees the landing page with their project name, navigates it, and can deploy it green to Cloudflare — all without touching the wiring.

## Preconditions
- Node ≥ 24, pnpm 11 (corepack will fetch the pinned version), macOS/Linux/Windows.
- The `saasaloy` CLI built from this repo:

```sh
pnpm --filter saasaloy build
```

- Scaffold a throwaway project to test against (run from a scratch dir, not this repo):

```sh
node /path/to/saasaloy/packages/cli/dist/index.js init my-app
cd my-app
pnpm install
```

- For TC-2 (deploy) you need a Cloudflare account and `wrangler login`. For TC-6 you need Claude Code.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Landing page renders with the project name in a browser (`pnpm dev`) | 🔴 Critical |
| TC-2 | Generated site deploys green to a real Cloudflare account | 🔴 Critical |
| TC-3 | Navigation between landing, terms, and privacy works | 🟡 Normal |
| TC-4 | `pnpm dev` hot-reload reflects an edit without restart | 🟡 Normal |
| TC-5 | Light/dark rendering is acceptable | 🟡 Normal |
| TC-6 | Generated project is agent-native in Claude Code | 🟡 Normal |
| TC-7 | Landing is readable/responsive on mobile width | 🟢 Low |
| TC-8 | `init` console output and next-steps are clear and correct | 🟢 Low |

## Test cases

### TC-1 — Landing page renders with the project name in a browser · 🔴 Critical
Confirms the whole slice visually: scaffold → cross-package `@repo/ui` import → Astro render.

**Steps**
1. In the scaffolded `my-app`, start the dev server:

```sh
pnpm dev
```

2. Open the printed URL (typically `http://localhost:4321`) in a browser.

**Expected:** The page shows a large heading `my-app` (the name you passed to `init`), the tagline "A Cloudflare-native SaaS, scaffolded with Saasaloy.", the `saasaloy add <module>` line, and Terms · Privacy links. Browser tab title reads `my-app — coming soon`. No console errors, no unreplaced `{{PROJECT_NAME}}`.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Generated site deploys green to a real Cloudflare account · 🔴 Critical
The "deploys green to Cloudflare" promise — only verifiable with real credentials (the agent could only dry-run).

**Steps**
1. Authenticate once:

```sh
pnpm --filter web exec wrangler login
```

2. Build and deploy:

```sh
pnpm --filter web build
pnpm --filter web run deploy
```

3. Open the `*.workers.dev` URL wrangler prints.

**Expected:** Deploy completes without error and the deployed URL serves the same landing page (project name, links, terms/privacy reachable). The Worker name is `my-app-web`.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Navigation between landing, terms, and privacy works · 🟡 Normal
**Steps**
1. With `pnpm dev` running, from the landing page click **Terms**, then back, then **Privacy**.

**Expected:** `/terms` and `/privacy` each render a titled placeholder page mentioning `my-app`, with a working "← Home" link back to `/`.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — `pnpm dev` hot-reload reflects an edit without restart · 🟡 Normal
**Steps**
1. With `pnpm dev` running, edit `apps/web/src/pages/index.astro` — change the tagline text — and save.

**Expected:** The browser updates near-instantly without a manual restart (Astro/Vite HMR).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Light/dark rendering is acceptable · 🟡 Normal
The landing sets `color-scheme: light dark`; only a human can judge both look fine.

**Steps**
1. View the landing page with OS appearance set to **Light**, then **Dark**.

**Expected:** Text is legible with adequate contrast in both modes; nothing is invisible (e.g. dark text on dark background).
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Generated project is agent-native in Claude Code · 🟡 Normal
Confirms the committed `AGENTS.md`/`CLAUDE.md` reach the tool in a real generated project (not just this repo).

**Steps**
1. Open the scaffolded `my-app` in a fresh Claude Code session.
2. Ask something answerable only from `AGENTS.md`, e.g. "Per this project's agent guidance, how should I add an API, and where do pnpm settings live?"

**Expected:** The answer reflects `AGENTS.md` (use `saasaloy add`, settings in `pnpm-workspace.yaml`) — proving `CLAUDE.md` → `@AGENTS.md` resolves in the generated project. These are plain committed files (no `sync`, not git-ignored), so they are present the moment `init` finishes and survive a `git clone`. No "no context" reply.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Landing is readable/responsive on mobile width · 🟢 Low
**Steps**
1. In the browser devtools, switch to a narrow viewport (~375px) on the landing page.

**Expected:** Heading and text scale sensibly (the heading uses `clamp()`), content stays centered and readable, no horizontal scroll.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — `init` console output and next-steps are clear and correct · 🟢 Low
**Steps**
1. Re-read the output from the `init` run (or run it again into a new dir).

**Expected:** The printed steps (`cd`, `pnpm install`, `pnpm dev`, `pnpm --filter web deploy`, `saasaloy add waitlist`) are accurate and in a sensible order; a newcomer could follow them without guessing.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] Generated project ships committed `AGENTS.md`/`CLAUDE.md` (name substituted, not git-ignored): `git check-ignore AGENTS.md CLAUDE.md` reports them as NOT ignored.
- [ ] `saasaloy --help` no longer lists a `sync` command, and `init` prints no "generated agent views" line (nothing is generated — the base ships fixed common rules).

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off. Run against a fresh scaffold `qa-app`._

Commands run:

```sh
pnpm --filter saasaloy build
node packages/cli/dist/index.js init <scratch>/qa-app
grep -rn "{{" <scratch>/qa-app          # leftover tokens
node packages/cli/dist/index.js init            # no arg
node packages/cli/dist/index.js init Bad_Name   # invalid name
node packages/cli/dist/index.js init <existing>  # non-empty dir
git -C <scratch>/qa-app check-ignore AGENTS.md CLAUDE.md .claude/skills
cd <scratch>/qa-app && pnpm install && pnpm build
pnpm --filter web exec wrangler deploy --dry-run
```

- ✅ Scaffold → 22 files written; `_gitignore` correctly emitted as `.gitignore`.
- ✅ Token substitution → root pkg `qa-app`, `wrangler.name` = `qa-app-web`, `@repo/ui` `siteName` = `qa-app`; `grep "{{"` found **no** unreplaced tokens.
- ✅ Committed agent views → `AGENTS.md` (begins `# qa-app — agent overview`) and one-line `CLAUDE.md` (`@AGENTS.md`) are copied straight from `templates/base` with the name substituted. No `sync`, no `.saasaloy/manifest.json` — nothing is generated.
- ✅ Generated `.gitignore` → `git check-ignore AGENTS.md CLAUDE.md` reports them NOT ignored (they are committed files now, always present for agent tools and clones).
- ✅ init edge cases → no-arg, `Bad_Name` (uppercase/underscore), and non-empty-dir each exit 1 with a clear message.
- ✅ `pnpm install` → clean; pre-approved build scripts (esbuild, workerd, sharp) ran with no prompts.
- ✅ `pnpm build` → Astro built 3 pages (`/`, `/terms`, `/privacy`) into `apps/web/dist`.
- ✅ Cross-package wiring → built `index.html` contains `<h1 ...>qa-app</h1>`, i.e. the `@repo/ui` import rendered (proves Turborepo JIT internal packages).
- ✅ `wrangler deploy --dry-run` → read 5 asset files from `dist`, computed upload size, exited cleanly — config is valid.
- ✅ Tool-repo typecheck → `tsc --noEmit` clean after the `syncProject` refactor.

## Not covered / needs human judgment
- **Real authenticated Cloudflare deploy** (TC-2) — needs an account/credentials; the agent could only `--dry-run`.
- **Browser rendering, HMR, dark mode, responsive** (TC-1, TC-3–TC-5, TC-7) — require a human eye and a running browser.
- **Claude Code loading generated agent context** (TC-6) — needs the tool; the pipeline itself is machine-verified in `agent-view-sync-qa.md`.
- **Windows** — the `_gitignore` rename and scaffold were verified on macOS only; symlink/junction behavior for skills is covered in `agent-view-sync-qa.md` (base ships no skills, so `.claude/skills` is empty here).
- **`saasaloy add` / modules** — not built yet (Phase 1); this slice ends at the base.
