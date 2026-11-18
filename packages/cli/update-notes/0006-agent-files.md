---
title: Serve llms.txt and Markdown copies of the public pages, and add pnpm agent:audit
version: 0.9.0
---

## What update does

- `apps/web` gets the public files for agents, built at build time: `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts` and `src/pages/[page].md.ts`, which serves `/index.md`, `/privacy.md` and `/terms.md`. The builders are in `src/lib/llms.ts`, `src/lib/landing-markdown.ts` and `src/lib/agent-document.ts`, with tests beside the first two.
- `apps/web/src/lib/agent-entries.ts` is a new registration table. `agent` and `cms` append one call each to its `entries` array with a `plugin-array` patch, so their sections appear in `/llms.txt`.
- The legal words move out of `src/pages/privacy.astro` and `src/pages/terms.astro` into `src/legal/privacy.md` and `src/legal/terms.md`. Both pages now render that Markdown, and the `.md` copies read the same file. `update` writes the two Markdown files when they are missing, and never overwrites them after that.
- `apps/web/src/layouts/Layout.astro` emits JSON-LD for the organization and the site on every page.
- `packages/config/src/sections/app.ts` gets `logoPath: "/favicon.svg"`, the logo the JSON-LD names.
- `src/pages/index.astro` is your file, so `update` does not change it. The new comment in the template's section recipe says to keep `LANDING_SECTIONS` in `src/lib/landing-markdown.ts` in the order of your blocks.
- `packages/tooling/src/agent-audit.ts` and its test add `pnpm agent:audit`, which checks the public files of a running product, and with `agent` installed its OpenAPI document and an MCP `tools/list`. The root `package.json` gets the `agent:audit` script.
- `AGENTS.md` gets a "Public Files for Agents" section and names the audit in "Code at the Root".

`robots.txt` does not change.

## What the merge plan gets

- `apps/web/src/pages/privacy.astro` and `terms.astro`, if you wrote your own policy in them. Move your text into `src/legal/privacy.md` and `src/legal/terms.md` as Markdown, then take the new pages.
- `apps/web/src/layouts/Layout.astro`, if you edited it. Keep your edits and take the `siteJsonLd` import, the `jsonLd` constant and the `<script type="application/ld+json">` line.
- `packages/config/src/sections/app.ts`, if you edited it. Take the `logoPath` field.
- The root `package.json`, if you edited it. Add the `agent:audit` script.
- `AGENTS.md`, if you edited it. Take the new section and the changed "Code at the Root" line.

## What you do

1. If you removed or reordered a section in `apps/web/src/pages/index.astro`, make the same change to `LANDING_SECTIONS` in `apps/web/src/lib/landing-markdown.ts`.
2. If you have a square logo, put it in `apps/web/public/` and set `app: { logoPath: "/logo.png" }` in `packages/config/src/project.ts`.

## Verify

```sh
pnpm typecheck
pnpm --filter @repo/web build
ls apps/web/dist/client/llms.txt apps/web/dist/client/index.md
```

With `pnpm dev` running, `pnpm agent:audit` prints one line per check and exits 0.
