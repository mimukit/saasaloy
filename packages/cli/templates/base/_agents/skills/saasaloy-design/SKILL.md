---
name: saasaloy-design
description: Keep apps/web/DESIGN.md, and apps/admin/DESIGN.md when the admin app is installed, true of the Saasaloy design layer. Use theme to choose and apply a registry style to the web app, update after packages/ui changes, or audit a design contract for token drift. Under autonomy: afk in docs/product-brief.md, theme picks the preset from the brief without asking.
derived-from: "designkit (MIT), narrowed 2026-08-09"
---

# saasaloy-design

This skill records the design system that the project already uses. It writes no components and no pages. For that work, follow `packages/ui/AGENTS.md`.

Each app has its own token home and its own contract:

| App | Token home | Contract |
|-----|------------|----------|
| web | `packages/ui/src/styles/brand.css` | `apps/web/DESIGN.md` |
| admin, when installed | `packages/ui/src/styles/admin.css` | `apps/admin/DESIGN.md` |

`brand.css` and `admin.css` both import `packages/ui/src/styles/globals.css`, which holds the shared Tailwind setup and no token values. The web app's stylesheet, `packages/ui/src/styles/web.css`, imports `brand.css` and adds the landing page's layout, type and motion vocabulary. Ask which app when the user does not say, and work on one contract at a time. Never read one app's tokens into the other app's contract.

The admin contract also covers the shell primitive set in `packages/ui/src/components/shell/`, its blocks in `packages/ui/src/blocks/shell/`, its containers in `packages/ui/src/containers/shell/` and the defaults in `packages/ui/src/styles/shell.css`, as `admin.css` overrides them. The web contract covers the base `components/`, the other `blocks/` and the web app.

The grounding rule controls every mode. Every token value must exist in the project code or in the Tailwind utility that the project uses. Do not choose a nearby value because it looks cleaner.

## Modes

- `theme` reads the product brief, selects a registry style with the owner, applies it, updates `DESIGN.md`, writes a new fingerprint, and lints the result.
- `update` re-derives the contract after a design layer change, writes a new fingerprint, and lints the result.
- `audit` checks the fingerprint and the contract. It never writes.

If the user does not name a mode, ask which mode to use. Do not choose between a write and an audit. The one exception is an unattended run: see [Unattended run](#unattended-run).

## Write surface

| Mode | Files |
|------|-------|
| `theme` | web only: `packages/ui/src/styles/brand.css`, `apps/web/DESIGN.md`, `docs/product-brief.md` only when the brief is absent, and `docs/build-log.md` under `autonomy: afk` |
| `update` | the chosen app's `DESIGN.md`, and `docs/build-log.md` under `autonomy: afk` |
| `audit` | none, under `autonomy: afk` too |

`theme` never runs for the admin app. A preset targets `brand.css` through `components.json`, and nothing writes to `admin.css` but a person. When the user asks to restyle the admin app, say so, and offer `update` after they edit `admin.css`.

Do not edit `components.json` during a theme change. Do not add a dependency, script, component, page, or Tailwind class.

## Shared rules

Read the chosen app's `DESIGN.md` and theme file, `packages/ui/src/styles/globals.css`, and the files under `packages/ui/src/` that the app renders before you derive tokens. Read the application files that use `@repo/ui` when you need to confirm usage.

Find the system in this order. Stop at the first match.

1. Use the Tailwind 4 `@theme` block.
2. Use the `:root` custom properties.
3. Report that the expected Saasaloy token home is missing.

Read declarations and usage. Count color values, type utilities, spacing utilities, radii, shadows, interaction states, and dark mode variants. A declared value with no use is not enough evidence for a design token.

Classify each proposed token as `extracted`, `consolidated`, or `omitted`. List the source values for each consolidation. Use `omitted` when the project does not define a scale.

Keep spacing omitted while the project uses Tailwind's default scale unchanged. Use this exact reason in the front matter: `Tailwind's default scale is used unchanged`.

Write elevation as prose under `## Elevation & Depth`. Never add `elevation` to `omitted`. The official linter does not accept that omission name.

Write motion as prose under `## Motion`. The alpha schema has no motion token group and no component transition token.

The landing page's layout, type and motion vocabulary lives in `web.css`, after its import of `brand.css`, and `DESIGN.md` must name all of it:

- The type ramp in `@theme`: `--text-display`, `--text-section-title` and `--text-lead`. Record the largest size of each fluid `clamp()` step as the token's `fontSize`, and describe the fluid range in the Typography prose.
- The container widths in `@theme` (`--container-page`, `--container-narrow`, `--container-wide`) and the `section-container*` and `section-y` utilities. Describe them under `## Layout`. Spacing stays omitted, because these are named widths and one section rhythm, not a spacing scale.
- The motion utilities: `blur-in`, `beam-in`, `reveal`, `marquee`, `shine-text`, `nav-float` and `hover-lift`. Describe each under `## Motion`, and say that each one stops under reduced motion.
- The decoration utility `grid-pattern`. Describe it under `## Components` with the landing blocks it decorates.

A theme preset replaces the colour tokens and leaves this vocabulary alone. After a `theme` run, check that the vocabulary survived and that `DESIGN.md` still describes it.

Use only these component token keys: `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, and `width`.

Keep the sections in this order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts, Motion, Dark Mode.

The web contract is a one-time base seed. ADR 0022 means Saasaloy has no update path for it. The admin contract is an admin module file, so `saasaloy update` lists an edited copy in its merge plan. In both cases the fingerprint detects drift, and this skill repairs the contract.

## Fingerprint

The fingerprint covers only the chosen app's token home: `packages/ui/src/styles/brand.css` for the web contract, `packages/ui/src/styles/admin.css` for the admin contract. It does not cover `globals.css`, `web.css`, components, blocks, or other files. The commands and stamps below name `brand.css`; substitute `admin.css` for the admin contract.

Compute the fingerprint from the file bytes. Use the first 12 lowercase hexadecimal characters of SHA-256.

```sh
node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; process.stdout.write(createHash('sha256').update(readFileSync('packages/ui/src/styles/brand.css')).digest('hex').slice(0, 12))"
```

The scaffold seed ends with this stamp.

```markdown
_Seeded from the saasaloy base template · CLI <version> · tokens sha256:<12 hex> of packages/ui/src/styles/brand.css_
```

After `theme` or `update`, replace the seed stamp with this stamp.

```markdown
_Updated from packages/ui on YYYY-MM-DD · tokens sha256:<12 hex> of packages/ui/src/styles/brand.css_
```

Do not change the fingerprint during `audit`.

## Official linter

Run the official linter after each write, on the contract you wrote.

```sh
pnpm dlx @google/design.md lint apps/web/DESIGN.md
pnpm dlx @google/design.md lint apps/admin/DESIGN.md
```

The format is alpha. Read the current schema when a lint finding conflicts with this skill.

```sh
pnpm dlx @google/design.md spec --format json
```

Do not hide a warning. Fix it when the code supports the fix. Report it with the reason when the project intentionally keeps it.

If the network or `pnpm dlx` is unavailable, continue with the fingerprint and local extraction. State that structural lint did not run. Never call an unchecked file clean.

## `theme`

### 1. Read the product context

Read `docs/product-brief.md` first. When its frontmatter holds `autonomy: afk`, follow [Unattended run](#unattended-run). Use its product, audience, differentiator, tone, and language answers. Do not ask those questions again.

If the brief is absent, offer to run `saasaloy-setup`:

> There's no `docs/product-brief.md`, so I'd be picking a theme for a product I know nothing about. `/saasaloy-setup` asks ten questions and leaves the brief behind; then this picks up where it stops. Want me to run it now?

Invoke that skill rather than reading its files. Do **not** improvise your own interview, and do not write `docs/product-brief.md` yourself. `saasaloy-setup` owns the brief and its format, and two skills asking overlapping questions is how an owner answers the same thing twice.

Ask only for design facts that the brief does not contain. Cover the color mood, the preset direction or registry URL, and the desired density.

### 2. Choose the registry style

Accept a `registry:style` URL from `https://ui.shadcn.com/create`, `https://tweakcn.com`, or another compatible registry. Do not invent a Saasaloy palette catalogue.

Preview the URL and the files that the command can change. Get approval before you run the command.

### 3. Apply the preset

Use the package-local executable from the project root.

```sh
pnpm --filter @repo/ui exec shadcn add <registry-style-url>
```

`components.json` points shadcn at `brand.css`, so the preset merges into the `:root`, `.dark` and `@theme inline` blocks there. Confirm that `globals.css` and `web.css` did not change, that `globals.css` still holds the `@source` rules and `@layer base`, and that `web.css` still holds the landing vocabulary. Confirm that `globals.css`, `brand.css` and `web.css` hold one `@theme inline` and one `@custom-variant dark` between them. Confirm that `components.json` did not change.

Stop and report the failure when the preset removes a required rule or changes `components.json`. Do not repair an unknown preset merge without approval.

### 4. Re-derive the contract

Run the shared extraction process against the merged `brand.css`, the landing vocabulary in `web.css`, and their usage. Update the token front matter and only the prose sections that the new tokens affect.

Use the product brief to update Overview and Do's and Don'ts. Do not add product claims that the brief does not support.

Recompute and replace the fingerprint stamp. Run the official linter.

### 5. Report

Name the registry style URL. List the changed token groups and the new fingerprint. State the linter result. Tell the user that component or page work follows `packages/ui/AGENTS.md`.

## Unattended run

`autonomy: afk` in the frontmatter of `docs/product-brief.md` means nobody is at the keyboard. Ask nothing, and wait for no approval. When a person in this conversation asks to choose the theme or to approve it, take the attended path instead.

1. **Pick the mode.** With no mode named, run `theme` for the web app. A named mode runs as named. `theme` never runs for the admin app, here as anywhere.
2. **Read the brief instead of asking.** Take the colour mood and the density from the Tone answer, the Audience answer and the site the owner pointed at. Ask no design question.
3. **Pick one registry style that fits the tone.** Take a tweakcn theme, served at `https://tweakcn.com/r/themes/<name>.json`, as [step 2 of `theme`](#2-choose-the-registry-style) allows. `https://ui.shadcn.com/create` needs a person at a browser, so it is not an option here. Fetch the URL first and check that it serves a `registry:style` item. Do not invent a palette, and do not write token values by hand.
4. **Apply it and re-derive the contract** with steps 3 and 4 of `theme`, with no preview and no approval. First copy `brand.css` and `components.json` to a temporary folder outside the repo, because a fresh project may have no commit to restore them from. Every check in step 3 still applies. When the preset removes a required rule or changes `components.json`, copy both files back and log the failure under `## Blocked`.
5. **Fall back when you cannot reach a registry.** With no network, keep the shipped theme, run `update` on `apps/web/DESIGN.md` only if its fingerprint is stale, adding or deleting no section, and list the theme choice under `## Left for a human`.
6. **Log the run** in `docs/build-log.md`: the registry style URL, one line on why it fits the brief's tone, and the linter result. Add the lines under the current stage's `##` section when a build is running, and under a new `## Design` section when none is. Create the log with a `# Build log` title when it does not exist. Leave the fingerprint out: the log's reader takes the first hex string in a section as its commit. The stage that commits adds its commit hash to that section.

## `update`

### 1. Find the change

Read `git status --short`. Read the working tree diff when it exists. Otherwise, compare the current branch with its base branch.

Identify changes under `packages/ui/`. State which DESIGN.md sections they affect. State which sections remain unchanged.

### 2. Re-derive with restraint

Run the shared extraction process. Edit existing tokens and affected prose only.

Ask before you add or delete a section. Do not rewrite the full file because one token changed.

Recompute and replace the fingerprint stamp. Run the official linter.

### 3. Report

List each changed token with its old and new value. Name the sections left unchanged. State the new fingerprint and linter result.

## `audit`

Audit is read-only. Do not edit or format any file.

### 1. Check the fingerprint offline

Read the recorded 12-character fingerprint from the final stamp. Compute the current fingerprint from the chosen app's token home, `brand.css` or `admin.css`.

- `current` means the two fingerprints match.
- `stale` means they differ.
- `unverified` means the stamp or source file is missing.

### 2. Check token drift

Scan `packages/ui/src/` and the application usage. Report tokens whose values no longer exist. Report repeated values that no token covers.

Use `orphaned` for a documented token with no current source. Use `uncovered` for a repeated source value with no documented token.

### 3. Lint when possible

Run `pnpm dlx @google/design.md lint apps/<app>/DESIGN.md` for the chosen app when the tool and network are available. If it cannot run, state that the fingerprint check ran offline and structural lint did not run.

### 4. Report

Open with the file count that the audit scanned. Give one verdict for the fingerprint and one verdict for token coverage. Name the worst drift and recommend `saasaloy-design update` when repair is needed.

## Boundaries

- Never write a component or a page. That work follows `packages/ui/AGENTS.md`.
- Never add a token value that the project does not contain.
- Never change `globals.css` or `web.css` in any mode, or `brand.css` in `update` or `audit`.
- Never write during `audit`.
- Never claim that lint passed when the linter did not run.
- Never treat a matching fingerprint as proof that component usage has no drift.
