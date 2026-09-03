# Plan: React Email as an opt-in template engine (`email-react`)

Grilled: 2026-09-03

Issue #59. This plan reverses §Templating of `plan-email-capability-module-2026-08-04.md`, which rejected React Email because "react-dom/server in the api Worker is bundle weight every project pays for". The opt-in module shape is what beats that objection: only a project that runs `saasaloy add email-react` pays the weight, so "every project pays" stops being true. The Phase 3 bundle measurement is recorded as information in the ADR, not judged against a budget. The blocker is gone: #15 is closed and PR #51 (the `@repo/email` core) is merged.

## Context

Hand-written HTML email ages badly across clients (Outlook, dark mode, table layout). React Email ships tested primitives and a preview server, and the template ecosystem around it is where new transactional templates actually get written. `@repo/ui` already puts scaffolded projects in JSX territory. The outcome that means success: a project can `saasaloy add email-react` and author templates in JSX that render to the exact `{ subject, html, text? }` object the providers already consume, with zero change to `packages/email` core or any provider, and with a measured (not guessed) Worker bundle delta on record.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Module shape | A separate opt-in module `email-react` (`saasaloy:feature`, `dependsOn: ["email"]`) that scaffolds a new workspace `packages/email-react` (`@repo/email-react`). The core keeps its zero-runtime-dependency claim literally true, and the JSX tsconfig (`"jsx": "react-jsx"`) lives in its own file instead of needing a tsconfig patch kind the applier does not have. Rejected: patching react deps and `.tsx` files into `packages/email` — it dirties the core's contract and needs tsconfig patching. |
| Render time | Request-time `render()` in the Worker. Template props are per-recipient (name, one-time URLs), so "build-time rendering" degenerates into pre-rendered HTML with a placeholder substitution pass — a worse hand-rolled template engine. The bundle objection is answered by measurement (Phase 3), not by moving render time. |
| Coexistence | Both idioms stay. Tagged templates remain the zero-dep default that `email` ships; JSX is opt-in via `email-react`. Same `EmailTemplate<Props>` contract, so a project can mix them per template. Neither "wins" — the descriptor system exists exactly for this kind of opt-in. |
| Template contract | Unchanged: `(props) => { subject, html, text? }`. A JSX template calls `@react-email/render`'s `render()` internally (or via a small `defineReactTemplate` helper) and returns the same object. Providers and `defineEmail` need no change at all. |
| Bundle verdict | No hard budget. The reversal is closed by the module shape (only opting-in projects pay), and the measured delta goes in the ADR as recorded information. Rejected: a numeric gate — it would re-litigate a cost only opt-in projects bear. |
| Plaintext | The JSX helper sets `text` explicitly via `render({ plainText: true })` — React Email's own plaintext renderer, purpose-built for its table-heavy markup. The core's `deriveText()` fallback stays as-is for tagged templates and never sees JSX output. A template can still pass its own `text` to override. |
| Layout | No JSX twin of the tagged `layout()`. JSX templates compose `@react-email/components` primitives (`Html`, `Container`, `Preview`, …) directly, so there is no second bespoke layout to drift. |
| Preview server | In scope. `packages/email-react` ships a `dev` script running the `react-email` CLI, and each template file adds a default-exported preview wrapper with sample props alongside the named `(props) => {...}` export. |
| Skill | A sibling skill `saasaloy-email-react` ships in `modules/email-react/skills/`, so the guidance travels with the module that installs the files. `saasaloy-email` gains one pointer line. |
| React pin | `email-react` pins the same `react` version as `packages/ui` (19.2.8 today), and `deps:verify` gains a pin-match rule so skew fails loud instead of installing two reacts. |
| Escaping | JSX escapes interpolations by default, so `SafeHtml`/`raw()` are irrelevant inside a JSX template and stay untouched in core. `safeUrl` stays mandatory for any caller-supplied `href` — escaping never stopped a `javascript:` URL in either idiom — and `email-react` re-exports it from `@repo/email` so the worked example carries it. |
| Dependencies | `packages/email-react` depends on `react`, `@react-email/components`, `@react-email/render` (exact-pinned per repo convention), plus `@repo/email` (`workspace:*`) for `EmailTemplate` and `safeUrl`. `react-dom` comes in transitively via `@react-email/render`. |
| Wiring | Descriptor patches `apps/api/package.json` with `@repo/email-react` (`workspace:*`), mirroring how `email` patches in `@repo/email`. No `packages/email` patch at all. |

## Approach

Reuses: the `EmailTemplate<Props>` type and `safeUrl` from `modules/email/files/src/provider.ts` / `render.ts`, the core's `deriveText()` fallback in `define.ts:resolve()`, the scaffold-workspace mechanism `modules/email/registry-item.json` already demonstrates, the `package-json-dependency` patch kind, and the `create-module` skill's descriptor conventions.

### Phase 1: decision record

- Add a note under §Templating in `docs/plans/plan-email-capability-module-2026-08-04.md`: reversed by this plan, link both ways.
- Record the render-time and module-shape decision as an ADR under `docs/adr/` (the issue's acceptance asks for a recorded decision; the repo keeps ADRs for hard-to-reverse trade-offs). The ADR states the verdict: the opt-in module shape answers the bundle objection, and the Phase 3 measurement is recorded there as information, not judged against a budget.

### Phase 2: the `email-react` module

- `modules/email-react/registry-item.json`: `saasaloy:feature`, `dependsOn: ["email"]`, scaffold workspace `packages/email-react` (alias `@email-react`), patch `apps/api/package.json` dependency.
- Scaffold files: `package.json` (deps above, the `react-email` CLI as a devDependency, a `dev` script for the preview server, `clean` via exact-pinned `rimraf`, `typecheck`), `tsconfig.json` (extends `@repo/tsconfig/base.json`, `"jsx": "react-jsx"`, workers types), `src/index.ts` re-exporting the helper and `safeUrl`, `src/templates/welcome.tsx` — the worked welcome template built from `@react-email/components` primitives directly (no bespoke JSX layout), same props as the tagged-template one, `safeUrl` on the CTA href, `text` set by the helper via `render({ plainText: true })`, plus a default-exported preview wrapper with sample props for the preview server.
- The `defineReactTemplate` helper renders the element with `render()` for `html` and `render({ plainText: true })` for `text`, and returns `{ subject, html, text }`.
- Sibling skill `modules/email-react/skills/saasaloy-email-react/SKILL.md`; add one pointer line to `saasaloy-email`.
- Add a pin-match rule to `deps:verify`: the `react` pin in `modules/email-react/files/package.json` must equal the one in `packages/cli/templates/base/packages/ui/package.json`.
- Follow the `create-module` skill for descriptor shape and lint gates (`pnpm lint`, `pnpm deps:*` cover `modules/*/files/**`).

### Phase 3: measure and verify end to end

- In `.dev`, scaffold a playground, `add email email-console email-react`, wire a route that sends the JSX welcome template. `pnpm typecheck` must pass.
- Measure the Worker bundle: `wrangler deploy --dry-run --outdir` gzip size with the tagged-template welcome only vs with the JSX welcome imported. Record both numbers in the ADR and this plan as information (no budget gate — see the bundle-verdict decision).
- Send end to end through `email-console`; eyeball the `render({ plainText: true })` output for readability.
- Start the preview server (`pnpm --filter @repo/email-react dev`) and confirm the welcome template renders with its sample props.

### Phase 4: docs and skill

- Update the template-contract section of `modules/email/skills/saasaloy-email/SKILL.md` to name the opt-in JSX idiom, and add the pointer line to `saasaloy-email-react`.
- Write the `saasaloy-email-react` skill: the helper contract, `safeUrl` on hrefs, the preview-wrapper convention, and when to pick JSX over tagged templates.

## Open questions

None. The 2026-09-03 grill settled render time, module shape, bundle verdict, plaintext, layout, preview server, skill shape, and the react pin. The preview wrapper's exact export shape is an implementation detail Phase 2 verifies against the `react-email` CLI's file discovery.

## Non-goals

- No change to `packages/email` core, its providers, or the `EmailTemplate` contract.
- No removal or deprecation of the tagged-template idiom.
- No React in the base template or in `email` itself; nothing here runs for a project that does not `add email-react`.
- No queue/retry/scheduling work; unchanged from the email plan.
