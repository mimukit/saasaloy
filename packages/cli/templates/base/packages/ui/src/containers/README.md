# `src/containers/`

Containers are the shells and layouts that hold blocks and components on a page: an app shell, a page layout, a page frame. The visual weight of a screen sits in its blocks; a container decides where they go.

The base ships none. `saasaloy add shell` writes the signed-in apps' shell and layouts into `src/containers/shell/`.

Rules (the full version is in `packages/ui/AGENTS.md`):

- A container takes its data, its links and its callbacks as props. It imports no router and no session; the app that owns them passes them in.
- No IO anywhere in `@repo/ui`: no fetch, no persistence, no auth.
- One container, one file. Reach it by subpath: `import { ShellLayout } from "@repo/ui/containers/shell/shell-layout";`.
- A folder may hold `shell/`, `admin/`, `web/` or `shared/` children where one module owns the files.
