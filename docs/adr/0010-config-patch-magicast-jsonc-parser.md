# 0010 — Config-patch engine: `magicast` + `jsonc-parser`

The structural ~10% of a module install — the edits that can't be pure file-drops — go through an AST-aware patch layer: `magicast` for TS/JS module edits (pushing `stripe()` into Better Auth's plugin array, config arrays) and `jsonc-parser` for `wrangler.jsonc` binding/route edits. The declarative 90% (env vars, schema additions via barrel, simple key merges) needs no codemod. Every patch is `--dry-run`/`--diff`-able. See build-spec [§3.4](../plans/saasaloy-build-spec.md); built under issue #7 (sessions `ca8f4ba8`/`6b1af46b`, 2026-07-22).

## Status
accepted

## Considered Options
- String/regex rewriting or full-file regeneration of config files — rejected: not AST-safe, and full regeneration would clobber a consumer's own edits. AST codemods touch only the target node.

## Consequences
- Two well-scoped codemod libraries, applied only to the ~10% structural edits; everything else stays a convention-based file-drop.
