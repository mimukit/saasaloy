# Plan — Rename `author-module` → `create-module` and refresh the skill

**Issue:** [#19](https://github.com/mimukit/saasaloy/issues/19) (`ready`)

## Context

The module-authoring skill at `.agents/skills/author-module/SKILL.md` is the runbook every
new Saasaloy module is written against. Two problems have accumulated:

1. **Wrong name.** It's called `author-module`; we want `create-module` (clearer, matches the
   `saasaloy add`/"create a module" vocabulary users reach for).
2. **Stale agent-context model.** Step 4 and its supporting sections still document the
   **reversed-away** design: modules drop `.agents/NN-*.md` fragments and the consumer runs
   `saasaloy sync` to re-derive `AGENTS.md`/`CLAUDE.md`/skill-links. The build-spec has since
   recorded a reversal (§2.13, §3.3, §5, and the `3c4ccf1` / `996e74d` commits): `AGENTS.md`/
   `CLAUDE.md` are **committed static files**, there is **no `saasaloy sync`**, and module guidance
   ships as a **Claude skill folder copied into `.claude/skills/`** by `saasaloy add`, tracked in
   the manifest. The skill still tells authors to do the thing that no longer exists.

`docs/plans/plan-phase-3-modules.md` already flags this drift as an open question (lines 31, 89–92)
and blocks on it: Phase-3 modules can't be authored cleanly against a stale runbook. Success =
the skill is renamed, fires correctly under the new name, and its every instruction matches the
current static-`AGENTS.md` + copied-skills reality — with no `.agents/` fragment / `sync` residue
anywhere in the skill or its cross-references.

## Design decisions (settled)

Hardened via grillkit — the plan's original open questions were all resolved by reading build-spec
§3.3, `packages/cli/src/commands/add.ts`, and the repo's actual skill wiring.

| Decision | Resolution |
|----------|-----------|
| New skill name | `create-module` — hard rename, no alias/redirect kept. |
| Rename blast radius | References exist **only** in `SKILL.md` (self), build-spec (~120, ~249), and `plan-phase-3-modules.md`. **README and `saasaloy.agent.json` do *not* reference the skill** — earlier draft overstated the targets. Grep `author-module` after: zero hits. |
| Skill's two homes | Canonical file is `.agents/skills/create-module/SKILL.md`; `.claude/skills/create-module` is a **symlink** to it (how the harness discovers it). **Both ends rename**; arrangement kept, not re-architected. Old dir + old symlink → manual `rm` (owner). |
| Ground-truth agent model | Build-spec §2.13/§3.3 reversal: static committed `AGENTS.md`/`CLAUDE.md`; module guidance = a Claude **skill folder copied into `.claude/skills/`** by `add`, manifest-tracked. **No `.agents/` fragments, no `saasaloy sync`.** |
| Descriptor `agent` field | **Already settled by build-spec §3.3** — `"agent": { "skills": ["skills/<name>"] }`. A module ships `modules/<name>/skills/<name>/SKILL.md`, copied verbatim to `.claude/skills/<name>/`. Drop `agent.fragments[]` entirely; the skill just needs to match §3.3 (not "decide" it). |
| "Shape of a module" gap | The skill's shape diagram (`registry-item.json` + `files/`) must **grow a `skills/` sibling** next to `files/` — the previous draft missed this. |
| Orphaned `saasaloy.agent.json` | **Delete it in this plan** — it still declares the reversed-away `concat` (`.agents/` → `AGENTS.md`) + skills pipeline and **nothing in `packages/cli/src` reads it**. Same stale-sync residue class as the skill; leaving it contradicts the model the skill now teaches. Manual `rm` (owner). |
| Phase-reality note | `saasaloy add` is genuinely still a stub (`add.ts` is a pure stub whose header comment already describes the correct copy-skills model), so the "Phase-1 stub" note is **accurate** — only its "agent fragment" phrasing is stale. **No standalone "refresh" phase**; the fix folds into the agent-model cleanup. |
| Changelog | Hard rename only — no separate reversal entry in build-spec §5 (the agent-model reversal is already recorded there; this is follow-through). |

## Approach

### Phase 1 — Rename both ends + delete the orphan
- Move `.agents/skills/author-module/` → `.agents/skills/create-module/` (git-mv the directory).
- Re-point the harness symlink: `.claude/skills/create-module` → `../../.agents/skills/create-module`.
- **Manual `rm` handoff to owner** (repo policy — nothing deleted here): remove the old
  `.agents/skills/author-module/` directory, the old `.claude/skills/author-module` symlink, and
  the orphaned `saasaloy.agent.json`.
- Update `SKILL.md` frontmatter `name: author-module` → `create-module` and the `# author-module`
  heading → `# create-module`.
- Update external references: `docs/plans/saasaloy-build-spec.md` (~120, ~249) and
  `docs/plans/plan-phase-3-modules.md` (~18, ~31, ~90, ~92, ~93, ~116). Grep `author-module`
  after — zero hits expected.

### Phase 2 — Fix the stale agent-context model (core cleanup)
- **"Shape of a module"** — add the `skills/` sibling to `files/`:
  `modules/<name>/skills/<name>/SKILL.md`.
- **Step 4 ("Contribute agent context")** — rewrite from the fragment+`sync` model to §3.3: a
  module ships a **Claude skill folder** (`skills/<name>/SKILL.md`) that `saasaloy add` **copies
  into the consumer's `.claude/skills/`** and records in `.saasaloy/manifest.json` (so `remove`
  undoes it). Delete the `agent.fragments[]` concept, the `NN-*.md` ordering guidance, and the
  concat/`AGENTS.md`-rebuild/`sync` description.
- **Step 2 descriptor example** — replace the `agent` block with the §3.3 form:
  `"agent": { "skills": ["skills/<name>"] }`; drop `"fragments": [...]` and the stale
  `files/.../agent/30-waitlist.md` fragment path.
- **The Scope note** (~123–126) — drop the "`saasaloy sync` regenerates views" caveat; keep only
  the still-true part (this CLI repo tracks its own `AGENTS.md`/`CLAUDE.md` directly and exposes its
  own dev skill via `.agents/` + `.claude/skills` symlink; use `.dev/` to exercise a module).
- **Phase-reality note** (~16–21) — keep the accurate "`add` is a stub / author-against-conventions"
  framing; fix only the "agent fragment the applier reads" phrasing to "skill folder the applier
  copies."
- **"Conventions to honor" bullet 2** and the **checklist item** — replace fragment/`sync` language
  with "ships a Claude skill folder (`skills/<name>/`) copied into `.claude/skills/`".
- **Frontmatter `description`** — drop "agent fragment"; say "registry-item.json + files + a Claude
  skill".

### Phase 3 — Tighten flow + fix triggers
- **Step ordering** — collapse the redundancy across Step 4 ↔ "Conventions to honor" ↔ "Authoring
  checklist" (agent context is currently stated three times). Keep the path crisp:
  tier → descriptor → files/conventions → skill → update-story self-check → checklist.
- **Trigger/description text** — update frontmatter examples so the skill still fires on
  "add a waitlist/billing module", "create a module", "author a capability", and work under
  `modules/`, under the new `create-module` name.

### Phase 4 — Verify
- `grep -rn "author-module\|agent.fragments\|saasaloy sync\|30-waitlist" .agents docs README.md`
  returns nothing stale; `grep -rn "saasaloy.agent.json" .` shows no remaining references.
- Re-read `SKILL.md` end-to-end against build-spec §2.13/§3.3/§5 — every agent-context claim matches.

## Open questions

None outstanding — grillkit closed the plan's original four (descriptor shape → settled by §3.3;
phase-reality → `add` confirmed a stub; skill-file naming → `skills/<name>/SKILL.md` copied verbatim;
`saasaloy.agent.json` → delete). Reopen only if implementation surfaces a mismatch between the skill
text and build-spec §3.3.

## Non-goals

- **Changing module conventions themselves** — the `routes/` glob, schema barrel, alias targets,
  patch policy, and update/manifest story stay as-is; this is a rename + doc-accuracy pass, not a
  redesign.
- **Re-architecting the repo's own skill hosting** — the `.agents/`-canonical + `.claude/skills/`
  symlink arrangement is kept; only the names change.
- **Implementing the applier** — wiring `saasaloy add`'s file/skill copy is separate work; this plan
  only makes the skill describe the agreed §3.3 contract.
- **The Phase-3 module roadmap** — `plan-phase-3-modules.md` owns which modules get built; this plan
  only unblocks its stale-runbook open question.
- **Deleting files directly** — the old `author-module/` directory, its `.claude/skills` symlink, and
  `saasaloy.agent.json` are handed to the owner as manual `rm`s, per repo policy.
