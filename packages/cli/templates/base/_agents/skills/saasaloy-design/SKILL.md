---
name: saasaloy-design
description: Keep DESIGN.md true of the Saasaloy design layer. Use theme to choose and apply a registry style, update after packages/ui changes, or audit the design contract for token drift.
derived-from: "designkit (MIT), narrowed 2026-08-09"
---

# saasaloy-design

This skill records the design system that the project already uses. It writes no components and no pages. Use `uikit` for that work.

The token home is `packages/ui/src/styles/globals.css`. The design contract is `DESIGN.md` at the project root.

The grounding rule controls every mode. Every token value must exist in the project code or in the Tailwind utility that the project uses. Do not choose a nearby value because it looks cleaner.

## Modes

- `theme` reads the product brief, selects a registry style with the owner, applies it, updates `DESIGN.md`, writes a new fingerprint, and lints the result.
- `update` re-derives the contract after a design layer change, writes a new fingerprint, and lints the result.
- `audit` checks the fingerprint and the contract. It never writes.

If the user does not name a mode, ask which mode to use. Do not choose between a write and an audit.

## Write surface

| Mode | Files |
|------|-------|
| `theme` | `packages/ui/src/styles/globals.css`, `DESIGN.md`, and `docs/product-brief.md` only when the brief is absent |
| `update` | `DESIGN.md` only |
| `audit` | none |

Do not edit `components.json` during a theme change. Do not add a dependency, script, component, page, or Tailwind class.

## Shared rules

Read `DESIGN.md`, `packages/ui/src/styles/globals.css`, and all files under `packages/ui/src/` before you derive tokens. Read the application files that use `@repo/ui` when you need to confirm usage.

Find the system in this order. Stop at the first match.

1. Use the Tailwind 4 `@theme` block.
2. Use the `:root` custom properties.
3. Report that the expected Saasaloy token home is missing.

Read declarations and usage. Count color values, type utilities, spacing utilities, radii, shadows, interaction states, and dark mode variants. A declared value with no use is not enough evidence for a design token.

Classify each proposed token as `extracted`, `consolidated`, or `omitted`. List the source values for each consolidation. Use `omitted` when the project does not define a scale.

Keep spacing omitted while the project uses Tailwind's default scale unchanged. Use this exact reason in the front matter: `Tailwind's default scale is used unchanged`.

Write elevation as prose under `## Elevation & Depth`. Never add `elevation` to `omitted`. The official linter does not accept that omission name.

Write motion as prose under `## Motion`. The alpha schema has no motion token group and no component transition token.

Use only these component token keys: `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, and `width`.

Keep the sections in this order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts, Motion, Dark Mode.

The seed is a one-time base file. ADR 0022 means Saasaloy has no update path for it. The fingerprint detects drift, and this skill repairs the contract.

## Fingerprint

The fingerprint covers only `packages/ui/src/styles/globals.css`. It does not cover components, blocks, or other files.

Compute the fingerprint from the file bytes. Use the first 12 lowercase hexadecimal characters of SHA-256.

```sh
node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; process.stdout.write(createHash('sha256').update(readFileSync('packages/ui/src/styles/globals.css')).digest('hex').slice(0, 12))"
```

The scaffold seed ends with this stamp.

```markdown
_Seeded from the saasaloy base template · CLI <version> · tokens sha256:<12 hex> of packages/ui/src/styles/globals.css_
```

After `theme` or `update`, replace the seed stamp with this stamp.

```markdown
_Updated from packages/ui on YYYY-MM-DD · tokens sha256:<12 hex> of packages/ui/src/styles/globals.css_
```

Do not change the fingerprint during `audit`.

## Official linter

Run the official linter after each write.

```sh
pnpm dlx @google/design.md lint DESIGN.md
```

The format is alpha. Read the current schema when a lint finding conflicts with this skill.

```sh
pnpm dlx @google/design.md spec --format json
```

Do not hide a warning. Fix it when the code supports the fix. Report it with the reason when the project intentionally keeps it.

If the network or `pnpm dlx` is unavailable, continue with the fingerprint and local extraction. State that structural lint did not run. Never call an unchecked file clean.

## `theme`

### 1. Read the product context

Read `docs/product-brief.md` first. Use its product, audience, differentiator, tone, and language answers. Do not ask those questions again.

If the brief is absent, read `.agents/skills/saasaloy-setup/SKILL.md`. Ask its product questions and write `docs/product-brief.md` in its exact format before you discuss the theme.

Ask only for design facts that the brief does not contain. Cover the color mood, the preset direction or registry URL, and the desired density.

### 2. Choose the registry style

Accept a `registry:style` URL from `https://ui.shadcn.com/create`, `https://tweakcn.com`, or another compatible registry. Do not invent a Saasaloy palette catalogue.

Preview the URL and the files that the command can change. Get approval before you run the command.

### 3. Apply the preset

Use the package-local executable from the project root.

```sh
pnpm --filter @repo/ui exec shadcn add <registry-style-url>
```

Confirm that the three `@source` rules, `@custom-variant dark`, and `@layer base` remain in `globals.css`. Confirm that `components.json` did not change.

Stop and report the failure when the preset removes a required rule or changes `components.json`. Do not repair an unknown preset merge without approval.

### 4. Re-derive the contract

Run the shared extraction process against the merged `globals.css` and its usage. Update the token front matter and only the prose sections that the new tokens affect.

Use the product brief to update Overview and Do's and Don'ts. Do not add product claims that the brief does not support.

Recompute and replace the fingerprint stamp. Run the official linter.

### 5. Report

Name the registry style URL. List the changed token groups and the new fingerprint. State the linter result. Tell the user to use `uikit` for component or page work.

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

Read the recorded 12-character fingerprint from the final stamp. Compute the current fingerprint from `globals.css`.

- `current` means the two fingerprints match.
- `stale` means they differ.
- `unverified` means the stamp or source file is missing.

### 2. Check token drift

Scan `packages/ui/src/` and the application usage. Report tokens whose values no longer exist. Report repeated values that no token covers.

Use `orphaned` for a documented token with no current source. Use `uncovered` for a repeated source value with no documented token.

### 3. Lint when possible

Run `pnpm dlx @google/design.md lint DESIGN.md` when the tool and network are available. If it cannot run, state that the fingerprint check ran offline and structural lint did not run.

### 4. Report

Open with the file count that the audit scanned. Give one verdict for the fingerprint and one verdict for token coverage. Name the worst drift and recommend `saasaloy-design update` when repair is needed.

## Boundaries

- Never write a component or a page. Use `uikit` for that work.
- Never add a token value that the project does not contain.
- Never change `globals.css` in `update` or `audit`.
- Never write during `audit`.
- Never claim that lint passed when the linter did not run.
- Never treat a matching fingerprint as proof that component usage has no drift.
