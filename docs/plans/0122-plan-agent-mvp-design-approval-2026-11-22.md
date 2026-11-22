# Plan: Approve product scope and design before the agent builds an MVP

Grilled: 2026-11-22

## Context

The current Saasaloy workflow starts the local MVP build as soon as the owner approves the product read-back. The build then picks a web theme preset without owner review. An owner who wants to approve brand colors and screens has no review step between those events. The new workflow gives the owner two decisions before the build. The first confirms the product brief and spec. The second confirms the design system and mockup images for that scope.

The baseline is three v0.10.0 Codex interview runs, with 15 to 17 owner replies and all 33 applicable benchmark checks passing on rescore. [Benchmark rescore](../research/0016-research-agent-bench-v0-10-0-codex-rescore-2026-11-21.md)

Target: One product approval and one design approval in each interview case with no revisions. After design approval, the agent asks zero questions and delivers a local build that passes the existing checks and the live agent checks. Track interview replies separately from approval replies so the added design step does not hide changes in interview length.

## Design decisions (settled)

| Decision | Resolution |
| --- | --- |
| Product approval | The owner first approves the brief and spec. Resolve weak answers, scope, access rules and screens before proposing a design. |
| Design approval | The owner approves a named design round for that product scope. A requested revision needs approval of the new round. The agent sets `autonomy: afk` only after design approval and starts the unattended build in the same session. |
| Approval record | Keep one approval record with the approved file hashes, approval dates and current design round. Keep the design values and image references in `docs/product-design.md`. The build checks the record before it uses those files. |
| Approval invalidation | A material change to the brief or spec sends both approvals back for review. A design revision sends only the design back. Hash the approved brief, spec and design document. Exclude the workflow's `autonomy` field from the brief hash so the build can start without changing the approved content. |
| Design scope | Show one design direction per round. Cover the landing page and the main customer workflow, including mobile and any empty or error state that affects completion. Use the supplied brand assets and check contrast for text and controls. |
| Theme and component rules | Start from the current theme or a preset. Allow exact colors, typography and component styles within the existing design system. Show the values in the review, including the sidebar colors when the mockup shows a sidebar. The web and customer apps share `brand.css`. Staff screens retain the admin theme. |
| UI registry | Use the current theme files. Keep the proposed UI registry out of this plan's dependencies. |
| Image generation | Use the agent's image generation tool for mockup images. Check for this tool before the interview. If it is unavailable, offer owner-supplied images or a preset that the owner explicitly approves at design review. |
| Image access | Before starting or resuming a build with an approved image round, verify the checksum of each image. Accept the same image from a new local path or owner-approved link. When the images are unavailable, record the blocker and wait for the same images. Keep replacement locations separate from the approved design content. |
| Design conflicts | Fix and log small spacing and focus-state adjustments that preserve the approved design. If a conflict requires a material change to approved colors, layout or user actions, record it under `## Blocked`. Resume after the owner approves the revised design. If the fix changes the spec, confirm the product scope again first. |
| Deployment | Remove the preview question from the local interview. Keep deployment in the owner handoff. |
| Verification | Use the existing Node test runner and fake agent for the approval sequence and resume cases. Run the existing live benchmark to check the generated project. Require the attended test with real mockup images and one revision before marking the plan complete. |
| Benchmark baseline | Keep the same three products. Save each opening description. Count interview replies and approval replies separately. |

## Approach

Extend `saasaloy-setup`, `saasaloy-design` and `saasaloy-build`. The setup skill owns approval of the brief and spec. The design skill owns the draft, the mockup round and its approval. The build skill checks these inputs and applies the approved design during Brand. Keep the approved design separate from the generated app's `DESIGN.md`, which describes the styles in use after the build.

A prompt change alone has a smaller diff. It leaves approval state in the conversation, which makes it hard to resume or check which images the owner approved. A new CLI command could enforce the sequence, but it would add CLI state and image tool integration. The existing skills can use the project files and the tools the agent already has.

### Phase 1: Define the product and design approval records (#385)

- Use one approval record to identify the approved brief and spec, the approved version of `docs/product-design.md`, the design round and the dates of both approvals. A later session must identify the exact inputs the owner approved.
- Define how to invalidate approvals. A material change to the approved scope returns the product to review and invalidates its design approval. A design revision returns only the design to review.
- Use the generated project's ignored `.artifacts/mockups/` folder for image files during a run. Keep image binaries out of Git. Record durable references when the owner supplies them or authorizes publication. Use the repository's gist convention for mockup images created for Saasaloy's own plans.
- Keep the proposed design values and image references in `docs/product-design.md`. Include colors by role, typography, spacing and component guidance. Check the rules in [the generated project guide](../../packages/cli/templates/base/AGENTS.md), [the web design contract](../../packages/cli/templates/base/apps/web/DESIGN.md) and [the customer app theme](../../modules/app/files/ui/styles/app.css).

Done when: The approval check accepts the brief after the workflow sets `autonomy: afk`. It rejects a changed approved input or replacement image with a different checksum. It accepts the same image from a different location.

### Phase 2: Add preflight, product approval and the design round (#385)

Issue #386 owns the Postgres preflight in this phase.

- Update [the entry instructions](../../llms.txt) to check the existing CLI prerequisites and confirm a Postgres backend before the interview. Use Docker or a configured Postgres server. Carry the selected backend into local database setup. Follow [the Postgres skill](../../modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md) and the server setup pattern in [the scaffold check](../../scripts/scaffold-check.ts).
- Update [the setup skill](../../packages/cli/templates/base/_agents/skills/saasaloy-setup/SKILL.md) to use facts from the opening description. Ask for missing facts and decisions. Keep the brief and spec completeness checks. Remove the local preview question. Read back and record the product decision before starting design.
- Extend [the design skill](../../packages/cli/templates/base/_agents/skills/saasaloy-design/SKILL.md) to propose design values before it changes the theme. Generate mockup images from the approved brief and spec. Show them with the design values for review. Use the agreed fallback when image generation is unavailable.
- Keep `autonomy: afk` unset until the owner approves the current design round. Record the approval, set the flag and start the build. When the owner leaves before approval, keep the drafts and wait at the pending step.

Done when: A prepared product description reduces the questions to its missing items. A product approval starts design. A design revision waits for approval of the new round. No build stage starts before design approval on the new interview path.

### Phase 3: Apply the approved design and verify the local MVP (#385)

Issue #386 owns the live agent checks in this phase.

- Update [the build skill](../../packages/cli/templates/base/_agents/skills/saasaloy-build/SKILL.md) to check approvals and image access before starting or resuming. Detect stale or missing approvals on the new path. Use the existing `## Blocked` log when an unattended run cannot proceed.
- Apply the approved colors and typography to the shared brand styles in Brand. Derive and lint `apps/web/DESIGN.md` from the applied styles. Keep the existing Tailwind imports and semantic tokens. Use the approved mockup references when [the feature skill](../../packages/cli/templates/base/_agents/skills/saasaloy-feature/SKILL.md) builds customer screens.
- Fix and log minor implementation adjustments that preserve the reviewed design. When a material design conflict blocks the build, record the conflict and the approval needed, then stop without asking questions during the unattended run.
- Keep the stage checks, entity commits and resume behavior. Allow a brief that already authorizes a headless run to use the existing preset path. Apply its approved design when the brief supplies one.
- Before Handover, start the local services and run `pnpm agent:audit --require-key` with a scoped local key. Create and read back a record through MCP. Reuse the audit command and the MCP checks in [the benchmark scorer](../../scripts/agent-bench/score.ts). Keep test data and keys local. Stop the services and record both results in the build log.

Done when: A generated project applies the approved brand values and completes `pnpm check`, the live agent audit and the scoped MCP create-and-read check. The log names the approved round and the check results. An older headless brief still completes with a preset.

### Phase 4: Update the public workflow and run the benchmark (#387)

Issue #385 owns the changes to the public workflow in this phase.

Attended: The maintainer or a designated reviewer acts as the product owner for the final live test. The reviewer requests one revision and approves the revised images. The plan stays open until this check passes.

- Update the generated [agent guide](../../packages/cli/templates/base/AGENTS.md), [CLI setup message](../../packages/cli/src/commands/init.ts), [owner guide](../wiki/how-to/build-with-an-agent.md) and [README](../../README.md). Check the other pages that cover these files in [the wiki map](../wiki/.wikimap.yaml). Regenerate the CLI reference and run `pnpm docs:check` and `pnpm docs:stale`.
- Update the [interview harness](../../scripts/agent-bench/interview.ts), [runner](../../scripts/agent-bench.ts), scorer and answer files. Record product approval and design approval as distinct events. Count questions after design approval as failures. Replace the local preview check with a check that the build makes no deploy call.
- Use image fixtures in automated tests for approval, revision, resume and the image-tool fallback. Run the existing scaffold check to verify the packaged instructions. Use the same three benchmark products and save their opening descriptions. In an attended run, generate real mockup images and request one revision before approval. Compare the applied brand values and main screens with the approved round.

Done when: The three benchmark briefs pass the local MVP checks. Each interview case without a revision records one product approval, one design approval and zero questions after design approval. The attended run revises the mockups once and builds only after the owner approves the revised round.

## Migration and rollback

Existing briefs and completed builds keep their current format. A brief with `autonomy: afk` and no design approval record keeps the preset path. Record enough state on a new interview to distinguish it from an older brief. If a new run stops during review, leave the drafts and resume from the pending approval. A rollback can restore the prior skills and keep the brief and spec readable. It must leave any pending approvals for the owner to resolve.

## Non-goals

- Automated preview or production deploys.
- A separate admin redesign.
- A new image generation service or an image file format.
- Automatic publication of owner assets or mockup images.
