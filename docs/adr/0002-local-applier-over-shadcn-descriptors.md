# 0002 — Local applier over shadcn-shaped descriptors

`saasaloy add <module>` is a **local applier**, not an HTTP registry service. Modules live in the CLI's own repo as shadcn-style `registry-item.json`-shaped descriptors; the applier reads a descriptor off disk, resolves file targets through the `saasaloy.json` alias map, topo-sorts prerequisites, and applies files + npm deps + patches. Everything the full shadcn model adds (HTTP transport, cross-registry resolution, per-registry auth) exists to serve other users and is deferred. See build-spec [§2.4](../plans/saasaloy-build-spec.md) and [§2.11](../plans/saasaloy-build-spec.md).

## Status
accepted

## Considered Options
- Registry + CLI as an HTTP service (the draft's Phase-1 crown-jewel resolver) — deferred: cross-registry resolution serves other people, not user #1.
- A custom-hosted `registry.saasaloy.dev` — deferred in favour of a future GitHub-hosted, git-tag-versioned registry (zero infra, versioning for free, PR contribution path); a vanity domain becomes an optional CDN front only if raw GitHub's cache or rate limits bite.

## Consequences
- The graduation to remote is one line — `fs.readFile(...)` becomes `fetch(...)` — and the module *format* is identical in both worlds, so there is zero rework.
- Remote versions will be git tags/branches (`add billing@v2` → `…#v2`); pin to tags, never `main`, so a registry edit never silently changes what an old project resolves.
