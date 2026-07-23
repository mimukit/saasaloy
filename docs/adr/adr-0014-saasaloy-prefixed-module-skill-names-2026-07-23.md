# 0014 — Module skills are namespaced with a `saasaloy-` prefix

Every module ships its agent guidance as a Claude skill folder that `saasaloy add` copies into the consumer's `.claude/skills/` (ADR 0007). That directory is **shared with the user's own installed skills**, and a generated project may accumulate a dozen-plus module skills alongside them — so a bare, generic skill name (`api`, `billing`, `auth`) is exactly the kind of name a user might already have, and a copy-in collision would silently clobber one or the other. **Decision:** every module skill is named `saasaloy-<module>` — the skill folder under the module (`modules/<name>/skills/saasaloy-<name>/`), the frontmatter `name:` inside its `SKILL.md`, and therefore the copied `.claude/skills/saasaloy-<name>/` all carry the prefix. The `api` module ships `skills/saasaloy-api/` with `name: saasaloy-api`. Settled while building `api`, the first module to ship a skill.

## Status
accepted — refines [ADR 0007](adr-0007-agent-native-static-agents-md-copied-skills-2026-07-22.md) (module guidance as copied Claude skill folders) by pinning the skill **name**space.

## Considered Options
- **Unprefixed names** (`api`, `billing`) — rejected: `.claude/skills/` is shared with the user's own skills; a generic module name can collide with a pre-existing user skill on copy-in and clobber it (or be clobbered). No namespace = no collision guarantee.
- **Nest under a `saasaloy/` subdirectory** (`.claude/skills/saasaloy/api/`) — rejected: skill discovery keys on the top-level folder name under `.claude/skills/`, so a nested layout isn't discovered as a skill; a flat prefixed name is what the tooling actually reads.
- **Prefix only the copied `.claude/skills/` folder, keep the module-side folder + frontmatter bare** — rejected: the applier copies the folder *verbatim* and the manifest tracks it by path, so a rename-on-copy adds a translation step and a drift-seam between the authored `name:` and the installed folder. Keeping folder name = frontmatter `name` = installed name (all `saasaloy-<module>`) keeps copy-in a pure copy.

## Consequences
- **The skill folder, its frontmatter `name`, and the installed path are identical and prefixed:** `modules/<name>/skills/saasaloy-<name>/SKILL.md` with `name: saasaloy-<name>` → `.claude/skills/saasaloy-<name>/`. Documented in `create-module` (Step 4 + checklist) and the `CONTEXT.md` glossary.
- **`agent.skills[]` entries point at the prefixed path** (`"skills/saasaloy-api"`). The waitlist example in build-spec §3.3 and the schema example were updated to match.
- **The `registry-item.schema.json` `agent.skills` items could enforce the prefix** with a `^skills/saasaloy-[a-z0-9-]+$` pattern; deferred to the same schema-tightening pass as ADR 0013's `scaffolds.items` (when the applier's copy step lands), so the convention isn't yet machine-checked.
- **Existing authored skill renamed:** `modules/api/skills/api/` → `modules/api/skills/saasaloy-api/`. The old folder is left for manual removal (no auto-delete).

## References
Plan: `docs/plans/plan-api-capability-module-2026-07-23.md`. Convention doc: `.agents/skills/create-module/SKILL.md` (Step 4 + checklist). Glossary: `CONTEXT.md` (Module skill). Schema: `packages/cli/schemas/registry-item.schema.json`. Related: [ADR 0007](adr-0007-agent-native-static-agents-md-copied-skills-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md). Issue: #8.
