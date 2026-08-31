# 0027 — Design contract ships in the base

> Renumbered from 0023 to 0027 on 2026-08-31 (issue [#98](https://github.com/mimukit/saasaloy/issues/98)). Five records shared 0023, so a bare "ADR 0023" citation named none of them. A document dated before that day cites this record as ADR 0023.

Every generated project already receives the same design layer, but agents have no stable statement of its tokens or intent. The base now includes a seeded `DESIGN.md` and a base-shipped `saasaloy-design` skill because every project needs the contract before any optional module arrives.

## Status

accepted

## Considered Options

- Ship the contract as a module. This repeats the rejected dependency shape from ADR 0022 because every project and every UI module needs it.
- Generate the contract during `init`. The base UI is byte-identical for each project, so generation repeats a fixed extraction and adds CLI work.
- Seed the contract without a fingerprint. This lets a preset change leave an authoritative-looking file that no longer matches the tokens.
- Depend on the maintainer's designkit skill. That skill is not part of a generated project, so the result would fail for project owners.

## Consequences

- `init` copies a reviewed `DESIGN.md` and substitutes the project name and CLI version.
- The seed has no Saasaloy update path because ADR 0022 makes base files a one-time gift.
- A token fingerprint detects changes to `packages/ui/src/styles/globals.css` without a network call or linter.
- The `saasaloy-design` skill repairs the contract after a theme or UI token change.
- The official linter runs through `pnpm dlx`, so the template gains no pinned linter dependency or build gate.
- The fingerprint covers only `globals.css`. Component changes need a full design audit because the fingerprint cannot detect them.

## References

Issue #75. Plan: [`plan-design-md-in-the-base-2026-08-09.md`](../plans/plan-design-md-in-the-base-2026-08-09.md). Prior decisions: [ADR 0022](adr-0022-design-layer-ships-in-the-base-2026-08-06.md), [ADR 0015](adr-0015-module-skills-agents-canonical-claude-symlink-2026-07-24.md), and [ADR 0014](adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md).
