import { describe, expect, it } from "vitest";
import { renderMergePlan } from "./merge-plan.js";
import type { ModuleComparison, ModuleUpdatePlan, PlannedUpdateFile, UpdatePlan } from "./updater.js";
import { VERIFY_COMMAND } from "./updater.js";

// The differentiating artifact (CONTEXT.md): natural-language intent + target files +
// old/new context, in one markdown document an agent CLI can act on unedited. These
// tests pin the contract the document makes to its reader — not its prose.

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

function comparison(overrides: Partial<ModuleComparison> = {}): ModuleComparison {
  return {
    name: "email",
    source: "mimukit/saasaloy",
    ref: "main",
    current: OLD_SHA,
    latest: NEW_SHA,
    status: "outdated",
    ...overrides,
  };
}

function file(overrides: Partial<PlannedUpdateFile> = {}): PlannedUpdateFile {
  return {
    module: "email",
    from: "files/lib/email.ts",
    target: "apps/api/src/lib/email.ts",
    targetAbs: "/tmp/project/apps/api/src/lib/email.ts",
    action: "drift",
    base: "const retries = 1;\n",
    theirs: "const retries = 3;\n",
    mine: "const retries = 1; // ours\n",
    ...overrides,
  };
}

function modulePlan(overrides: Partial<ModuleUpdatePlan> = {}): ModuleUpdatePlan {
  return {
    name: "email",
    comparison: comparison(),
    intent: [],
    files: [],
    removals: [],
    links: [],
    patches: [],
    depAdds: [],
    devDepAdds: [],
    depBumps: [],
    depConflicts: [],
    prereqNames: [],
    prereqDependsOn: {},
    needsMerge: true,
    ...overrides,
  };
}

function plan(modules: ModuleUpdatePlan[], overrides: Partial<UpdatePlan> = {}): UpdatePlan {
  return {
    modules,
    skipped: [],
    missingLockEntries: [],
    verifyCommand: VERIFY_COMMAND,
    needsMerge: modules.some((m) => m.needsMerge),
    ...overrides,
  };
}

describe("renderMergePlan", () => {
  it("opens one `## <module>` section per module that drifted", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({ files: [file()] }),
        modulePlan({ name: "auth", comparison: comparison({ name: "auth" }), files: [file({ module: "auth" })] }),
      ]),
    );
    expect(doc).toContain("## email");
    expect(doc).toContain("## auth");
  });

  it("omits a module that needs no merge", () => {
    const doc = renderMergePlan(plan([modulePlan({ needsMerge: false }), modulePlan({ name: "auth", comparison: comparison({ name: "auth" }), files: [file({ module: "auth" })] })]));
    expect(doc).not.toContain("## email");
    expect(doc).toContain("## auth");
  });

  it("carries the commit subjects as intent", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ intent: ["fix(email): retry on 429", "feat(email): add reply-to"], files: [file()] })]),
    );
    expect(doc).toContain("fix(email): retry on 429");
    expect(doc).toContain("feat(email): add reply-to");
  });

  it("states plainly when no intent could be read", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toMatch(/no commit subjects/i);
  });

  it("records provenance: old SHA, new SHA and the ref", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toContain(OLD_SHA);
    expect(doc).toContain(NEW_SHA);
    expect(doc).toContain("mimukit/saasaloy");
    expect(doc).toContain("main");
  });

  it("gives a drifted file both a base → theirs and a base → mine diff", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toContain("apps/api/src/lib/email.ts");
    expect(doc).toContain("base → theirs");
    expect(doc).toContain("base → mine");
    // The module's change and the user's change are both legible in the diffs.
    expect(doc).toContain("const retries = 3;");
    expect(doc).toContain("const retries = 1; // ours");
  });

  it("stamps a missing merge base with its reason and renders two-way", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          noMergeBase: "local install",
          files: [file({ base: undefined })],
        }),
      ]),
    );
    expect(doc).toContain("no merge base — local install");
    expect(doc).toContain("**theirs → mine**");
    // The file section carries one two-way diff, not the two three-way ones.
    expect(doc).not.toContain("**base → theirs**");
  });

  it("marks an untracked collision as a new file, rendered two-way", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file({ action: "conflict", base: undefined })] })]),
    );
    expect(doc).toMatch(/new file collides with yours/i);
    expect(doc).toContain("theirs → mine");
  });

  it("says a dropped file's edits are still on disk", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [],
          removals: [file({ action: "delete-drift", theirs: undefined })],
        }),
      ]),
    );
    expect(doc).toMatch(/dropped this file/i);
    expect(doc).toMatch(/still (here|on disk)/i);
  });

  it("reports a config patch whose key already holds a different value", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [file()],
          patches: [
            {
              module: "email",
              file: "apps/api/wrangler.jsonc",
              fileAbs: "/tmp/project/apps/api/wrangler.jsonc",
              patch: {
                file: "apps/api/wrangler.jsonc",
                kind: "wrangler-binding",
                bindingType: "d1_databases",
                entry: { binding: "DB", database_id: "local" },
              },
              action: "unchanged",
              diff: "",
              matched: {
                key: "d1_databases[binding=DB]",
                current: { binding: "DB", database_id: "9f2c-real" },
                wanted: { binding: "DB", database_id: "local" },
              },
            },
          ],
        }),
      ]),
    );
    expect(doc).toContain("apps/api/wrangler.jsonc");
    expect(doc).toContain("d1_databases[binding=DB]");
    expect(doc).toContain("9f2c-real");
  });

  // A patched file's manifest hash is never re-recorded, so it always reads as drift on
  // the next update. Saying which module patched it keeps the document honest about why.
  it("names the module whose config patch also touched a drifted file", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file({ target: "apps/api/package.json", patchedBy: ["email"] })] })]),
    );
    expect(doc).toMatch(/also applied a config patch/i);
    expect(doc).toContain("`email`");
  });

  it("says nothing about patches for a file no module patched", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).not.toMatch(/also applied a config patch/i);
  });

  it("tells the agent the user's edits are the ones that must not be lost", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toMatch(/must not be lost/i);
  });

  it("names the verification command without inviting anyone to run it here", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toContain("## Verification");
    expect(doc).toContain(VERIFY_COMMAND);
  });

  it("names the migration command when the update touched a db schema", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file()] })], { migrationCommand: "pnpm --filter @repo/db db:generate" }),
    );
    expect(doc).toContain("pnpm --filter @repo/db db:generate");
  });

  it("returns an empty document when nothing drifted", () => {
    expect(renderMergePlan(plan([modulePlan({ needsMerge: false })]))).toBe("");
  });

  it("fences file content that itself contains a code fence", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [file({ target: "docs/guide.md", base: "a\n", theirs: "```ts\ncode\n```\n", mine: "b\n" })],
        }),
      ]),
    );
    // A longer fence keeps the embedded ``` from ending the block early.
    expect(doc).toContain("````");
  });
});
