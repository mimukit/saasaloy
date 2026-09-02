# Plan: retire the sections glob for ui-package blocks

Grilled: 2026-09-01

Tracked: [#62](https://github.com/mimukit/saasaloy/issues/62)

## Context

The base landing page discovers module UI through a glob (`apps/web/src/pages/index.astro:20-30` globs `../sections/*.astro`). A module drops a section file and appears on the landing page with no edit to the page, in whatever position filename sort dictates. `waitlist` is the only module using it (`@web/sections/waitlist.astro`). This splits the UI story: base UI is a `.tsx` block in `@repo/ui/blocks/`, module UI is an `.astro` file in the web app. It also makes page composition an accident of installation order rather than an owner decision.

Success: the glob is gone, module UI lands in `packages/ui/src/blocks/` exactly like base blocks, the applier prints precise wire-up instructions, and `remove` still works. The waitlist proof (docs/qa/qa-waitlist-module-2026-07-24.md) still passes end to end.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where wire-up instructions live | In the module's skill (`SKILL.md`), under a required "Wire-up" section. `add.ts:253-256` already states "There is deliberately no `nextSteps` field on the descriptor. The skill is the single source of a module's procedure." The applier prints only a pointer ("manual wire-up needed — see /saasaloy-<module>"). The skill is symlinked into the project, so the instructions are durable, not terminal scrollback. |
| How the descriptor expresses "ships a block" | No new field. A `files` entry whose target string starts with `@ui/blocks/` is the signal; the alias-prefix check is the convention. The applier warns when such a file arrives from a module with no `agent.skills` entry, so the convention cannot ship instruction-less. |
| Does the applier edit the page itself | Never. Placement is the owner's call (the issue's own non-goal). The applier writes the block file and prints the pointer only. |
| What moves into `packages/ui` for waitlist | Both the section wrapper and `WaitlistForm` merge into one `blocks/waitlist.tsx` with named export `Waitlist`. The two `package-json-dependency` patches (`hono`, `@repo/api`) retarget `packages/ui/package.json`, and `waitlist-env.d.ts` moves into `packages/ui/src/types/`. |
| API URL plumbing | The block keeps the `import.meta.env.PUBLIC_API_URL` read. `ui` ships source and the consumer's bundler compiles it, so the read resolves unchanged; the env coupling already exists in the shipped form. |
| Hydration | The whole block hydrates: `<Waitlist client:load />`. A static React component cannot contain a hydrated React child, so merging the pieces forces this; the extra hydrated markup is a heading and a paragraph. |
| Placement hint precision | Exact anchor, marked as a suggestion: import `Waitlist` from `@repo/ui/blocks/waitlist`, place `<Waitlist />` after `<Cta />` in `src/pages/index.astro`, "or wherever you want it". |
| Authoring rule | The `create-module` skill gains the requirement that a UI-bearing module's skill carries a "Wire-up" section — in this issue, not a follow-up. |
| Migration for already-applied installs | New installs only. ADR 0022 establishes that base files are a one-time gift with no update path; the glob keeps working in old projects. |
| Ordering vs landing-blocks polish | No conflict. Issue #60 is closed; this lands independently. |

## Approach

Reuses: the `@ui` alias (already in the base `saasaloy.json`), the `./blocks/*": "./src/blocks/*.tsx"` subpath export in `packages/ui/package.json`, the managed-files remove path in `remover.ts` (a block file is a managed file, so deletion already works), and `printNextSteps()` in `add.ts`.

Rejected: a structured `wireUp` descriptor field (reverses the settled no-`nextSteps` stance); applier auto-inserting the import (auto-placement is the issue's non-goal); a wrapper-only block with a slot (two-import wire-up, block renders nothing alone); an `apiUrl` prop (forces every wire-up to plumb env); an `.astro` block in `ui` (changes the package's `*.tsx` export contract).

### Phase 1: retire the glob in the base template (built 2026-09-02)

- Delete the glob block, the sections render loop, and its wrapper `div` from `packages/cli/templates/base/apps/web/src/pages/index.astro`; the page becomes explicit imports only.
- Note in the template's `AGENTS.md` that module UI arrives as `@repo/ui` blocks wired by hand.
- Confirm no glob-convention references remain (`grep -r "sections" packages/cli/templates/base`).

### Phase 2: migrate the waitlist module (built 2026-09-02, amended)

- Merge `files/web/sections/waitlist.astro` and `files/web/components/WaitlistForm.tsx` into `modules/waitlist/files/ui/blocks/waitlist.tsx`, named export `Waitlist` (panel plus form, one component). Descriptor target `@ui/blocks/waitlist.tsx`.
- Move `waitlist-env.d.ts` to target `@ui/types/waitlist-env.d.ts`; retarget the `hono` and `@repo/api` dependency patches to `packages/ui/package.json`. Keep the `hono` version pin aligned with `modules/api` (the versioned-patch rule in the waitlist skill; `pnpm deps:check` scans it).
- Update `modules/waitlist/skills/saasaloy-waitlist/SKILL.md`: replace the sections-glob contract (drop table rows and boundary lines referencing `sections/*.astro`) with a "Wire-up" section: block `@repo/ui/blocks/waitlist`, export `Waitlist`, `<Waitlist client:load />` after `<Cta />` in `src/pages/index.astro`, "or wherever you want it".
- Update the `create-module` skill: a UI-bearing module targets `@ui/blocks/` and its skill must carry a "Wire-up" section.

**Amended 2026-09-02 during implementation ([ADR 0030](../adr/adr-0030-module-ui-ships-as-a-ui-package-block-2026-09-02.md)).** The merge above put `hc<AppType>` inside `packages/ui`, and `packages/ui` has a `typecheck` script that the old location (`apps/web`) does not. One `import type { AppType } from "@repo/api/client"` there makes `tsc` compile the whole api and db source tree under the ui package's tsconfig, which turned `@repo/ui:typecheck` red with four errors. The block is therefore presentational and takes a required `onSubmit`; the typed client stays in `apps/web/src/components/WaitlistForm.tsx`, which the page renders. The `hono` and `@repo/api` patches and `waitlist-env.d.ts` stay pointed at `apps/web`, unchanged. The Wire-up section names `WaitlistForm`, not `Waitlist`, because Astro serializes island props and a function cannot cross from `.astro` into an island.

### Phase 3: applier pointer and remove caveat (built 2026-09-02)

- In `add.ts` `printNextSteps()`, when any applied file target starts with `@ui/blocks/`, append a "Manual wire-up needed" item pointing at the module's skill command; warn when the module ships no skill.
- In `remove` output, when such a file is removed, state that the block file is deleted but manual wire-up edits (the import in `index.astro`) are not auto-reversed. Known limit: the two dependency patches are already `drop`-kind on remove (#36), so `hono`/`@repo/api` linger in `packages/ui/package.json` after uninstall — unchanged behaviour, new location.

### Phase 4: verify (built 2026-09-02)

- `pnpm lint`, `pnpm deps:verify` green.
- Run the waitlist proof in `.dev` per `docs/qa/qa-waitlist-module-2026-07-24.md`: scaffold, add waitlist, follow the printed wire-up, confirm the form submits end to end. Update the QA doc's steps for the new wire-up.
- Confirm `saasaloy remove waitlist` deletes the block, prints the caveat, and the project builds after the owner removes the import.

## Non-goals

- Redesigning any block.
- Auto-placing blocks or heuristic ordering.
- A migration path for projects scaffolded under the old convention.
- Changing the descriptor schema.
- Fixing #36 (non-reversible dependency patches).
