import { describe, expect, it } from "vitest";
import { BASE_INTENT, BASE_MODULE, BASE_NO_MERGE_BASE } from "./base.js";
import { renderMergePlan } from "./merge-plan.js";
import type { UpdateNote } from "./update-notes.js";
import type {
  ModuleComparison,
  ModuleUpdatePlan,
  PlannedUpdateFile,
  UpdatePlan,
} from "./updater.js";
import { VERIFY_COMMAND } from "./updater.js";

// The differentiating artifact (CONTEXT.md): natural-language intent + target files +
// old/new context, in one markdown document an agent CLI can act on unedited. These
// tests pin the contract the document makes to its reader — not its prose.

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

function comparison(
  overrides: Partial<ModuleComparison> = {}
): ModuleComparison {
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

function modulePlan(
  overrides: Partial<ModuleUpdatePlan> = {}
): ModuleUpdatePlan {
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
    prereqConflictsWith: {},
    prereqRequiresOneOf: {},
    removeWarnings: [],
    newEnvVars: {},
    needsMerge: true,
    ...overrides,
  };
}

function plan(
  modules: ModuleUpdatePlan[],
  overrides: Partial<UpdatePlan> = {}
): UpdatePlan {
  return {
    modules,
    skipped: [],
    missingLockEntries: [],
    verifyCommand: VERIFY_COMMAND,
    needsMerge: modules.some((m) => m.needsMerge),
    notes: [],
    mayApplyNotes: [],
    ...overrides,
  };
}

describe(renderMergePlan, () => {
  it("opens one `## <module>` section per module that drifted", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({ files: [file()] }),
        modulePlan({
          name: "auth",
          comparison: comparison({ name: "auth" }),
          files: [file({ module: "auth" })],
        }),
      ])
    );
    expect(doc).toContain("## email");
    expect(doc).toContain("## auth");
  });

  it("omits a module that needs no merge", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({ needsMerge: false }),
        modulePlan({
          name: "auth",
          comparison: comparison({ name: "auth" }),
          files: [file({ module: "auth" })],
        }),
      ])
    );
    expect(doc).not.toContain("## email");
    expect(doc).toContain("## auth");
  });

  it("carries the commit subjects as intent", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          intent: ["fix(email): retry on 429", "feat(email): add reply-to"],
          files: [file()],
        }),
      ])
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
      ])
    );
    expect(doc).toContain("no merge base — local install");
    expect(doc).toContain("**theirs → mine**");
    // The file section carries one two-way diff, not the two three-way ones.
    expect(doc).not.toContain("**base → theirs**");
  });

  it("marks an untracked collision as a new file, rendered two-way", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({ files: [file({ action: "conflict", base: undefined })] }),
      ])
    );
    expect(doc).toMatch(/new file collides with yours/i);
    expect(doc).toContain("theirs → mine");
  });

  // A `conflict` can carry a base (the module shipped an older revision of the file; the
  // one on disk was simply never tracked), and the three-way diffs are rendered right
  // below this paragraph — so it must not claim the comparison is two-way.
  it("does not claim there is no base for a conflict that has one", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file({ action: "conflict" })] })])
    );
    expect(doc).not.toMatch(/there is no base for it/i);
    expect(doc).not.toMatch(/this is a two-way comparison/i);
    expect(doc).toContain("**base → theirs**");
    expect(doc).toContain("**base → mine**");
  });

  it("says a dropped file's edits are still on disk", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [],
          removals: [file({ action: "delete-drift", theirs: undefined })],
        }),
      ])
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
      ])
    );
    expect(doc).toContain("apps/api/wrangler.jsonc");
    expect(doc).toContain("d1_databases[binding=DB]");
    expect(doc).toContain("9f2c-real");
  });

  // A patched file's manifest hash is never re-recorded, so it always reads as drift on
  // the next update. Saying which module patched it keeps the document honest about why.
  it("names the module whose config patch also touched a drifted file", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [
            file({ target: "apps/api/package.json", patchedBy: ["email"] }),
          ],
        }),
      ])
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

  // `update` can't tell a finished merge from an unfinished one, so a plain re-run
  // re-offers the same files. The document says that, and names the one command that
  // records a finished merge (#223).
  it("never promises that a plain re-run will record the merge", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).not.toMatch(/record the result/i);
    expect(doc).toContain(`the lock stays on \`${OLD_SHA}\``);
    expect(doc).toMatch(/offer the same\s+files again/i);
  });

  it("names the --resolved command for every file to merge (#223)", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [file()],
          removals: [
            file({
              action: "delete-drift",
              target: "apps/api/src/old file.ts",
            }),
          ],
        }),
      ])
    );
    expect(doc).toContain(
      "saasaloy update \\\n  --resolved apps/api/src/lib/email.ts \\\n  --resolved 'apps/api/src/old file.ts' --yes"
    );
    expect(doc).not.toMatch(/Nothing, and that is deliberate/);
  });

  it("names each module's own base when several drifted at once", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({ files: [file()] }),
        modulePlan({
          name: "auth",
          comparison: comparison({ name: "auth", current: "c".repeat(40) }),
          files: [file({ module: "auth" })],
        }),
      ])
    );
    expect(doc).toMatch(/each module's lock entry stays on the base SHA/i);
  });

  it("names the verification command without inviting anyone to run it here", () => {
    const doc = renderMergePlan(plan([modulePlan({ files: [file()] })]));
    expect(doc).toContain("## Verification");
    expect(doc).toContain(VERIFY_COMMAND);
  });

  it("names the migration command when the update touched a db schema", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file()] })], {
        migrationCommand: "pnpm --filter @repo/db db:generate",
      })
    );
    expect(doc).toContain("pnpm --filter @repo/db db:generate");
  });

  it("renders a drifted base file with the base's intent line and its no-merge-base reason (#120)", () => {
    const doc = plan([
      modulePlan({
        name: BASE_MODULE,
        comparison: comparison({
          name: BASE_MODULE,
          source: "bundled template",
          ref: "template",
          current: "0.1.0 (aaaaaaa)",
          latest: "0.2.0 (bbbbbbb)",
        }),
        noMergeBase: BASE_NO_MERGE_BASE,
        baseRecord: {
          name: "web",
          cliVersion: "0.2.0",
          templateHash: "b".repeat(64),
        },
        files: [
          file({
            module: BASE_MODULE,
            from: "AGENTS.md",
            target: "AGENTS.md",
            base: undefined,
            theirs: "v2\n",
            mine: "v1 plus mine\n",
          }),
        ],
        needsMerge: true,
      }),
    ]);

    const out = renderMergePlan(doc);

    expect(out).toContain("## base");
    expect(out).toContain(BASE_INTENT);
    expect(out).toContain(BASE_NO_MERGE_BASE);
    expect(out).toContain("Source in the template: `AGENTS.md`");
    expect(out).toContain("**theirs → mine**");
    expect(out).toContain("0.1.0 (aaaaaaa)");
    expect(out).toContain("0.2.0 (bbbbbbb)");
  });

  it("returns an empty document when nothing drifted", () => {
    expect(renderMergePlan(plan([modulePlan({ needsMerge: false })]))).toBe("");
  });

  it("fences file content that itself contains a code fence", () => {
    const doc = renderMergePlan(
      plan([
        modulePlan({
          files: [
            file({
              target: "docs/guide.md",
              base: "a\n",
              theirs: "```ts\ncode\n```\n",
              mine: "b\n",
            }),
          ],
        }),
      ])
    );
    // A longer fence keeps the embedded ``` from ending the block early.
    expect(doc).toContain("````");
  });
});

// #298 Phase 3: update notes carry the work outside the files `update` merges. They ride
// the merge plan ahead of the file sections, and they alone are enough to emit it.
describe("renderMergePlan — update notes", () => {
  const BODY = [
    "## What update does",
    "",
    "It moves the tokens.",
    "",
    "## What you do",
    "",
    "```md",
    "## not a heading",
    "```",
    "",
    "### A step",
    "",
    "## Verify",
    "",
    "Run `pnpm check`.",
    "",
  ].join("\n");

  function updateNote(overrides: Partial<UpdateNote> = {}): UpdateNote {
    return {
      id: "base/0001-brand-css",
      owner: "base",
      serial: 1,
      slug: "brand-css",
      title: "Move the web tokens into brand.css",
      version: "0.8.0",
      body: BODY,
      path: "/cli/update-notes/0001-brand-css.md",
      ...overrides,
    };
  }

  it("emits a plan for notes alone, with no file to merge", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ needsMerge: false })], { notes: [updateNote()] })
    );
    expect(doc).toContain("# Saasaloy merge plan");
    expect(doc).toContain("## Update notes");
    expect(doc).toContain(
      "### base/0001-brand-css: Move the web tokens into brand.css"
    );
    expect(doc).not.toContain("## email");
    expect(doc).not.toContain("--resolved");
    expect(doc).toContain(`- \`${VERIFY_COMMAND}\``);
  });

  it("demotes the note's headings under its own, and leaves a fenced block alone", () => {
    const doc = renderMergePlan(plan([], { notes: [updateNote()] }));
    expect(doc).toContain("\n#### What update does\n");
    expect(doc).toContain("\n##### A step\n");
    expect(doc).toContain("\n## not a heading\n");
    expect(doc).not.toMatch(/^## What you do$/m);
  });

  it("puts the update notes ahead of the per-module file sections", () => {
    const doc = renderMergePlan(
      plan([modulePlan({ files: [file()] })], { notes: [updateNote()] })
    );
    expect(doc.indexOf("## Update notes")).toBeGreaterThan(-1);
    expect(doc.indexOf("## Update notes")).toBeLessThan(
      doc.indexOf("## email")
    );
    expect(doc).toContain("--resolved");
  });

  it("gives may-apply notes their own subsection that asks the agent to check each one", () => {
    const doc = renderMergePlan(
      plan([], {
        notes: [updateNote()],
        mayApplyNotes: [
          updateNote({
            id: "shell/0001-admin-kit-move",
            owner: "shell",
            slug: "admin-kit-move",
            title: "The admin ui kit moves into the shell module",
            version: undefined,
          }),
        ],
      })
    );
    const may = doc.indexOf("### Notes that may apply");
    expect(may).toBeGreaterThan(doc.indexOf("### base/0001-brand-css"));
    const section = doc.slice(may);
    expect(section).toMatch(/check whether/i);
    expect(section).toContain(
      "#### shell/0001-admin-kit-move: The admin ui kit moves into the shell module"
    );
    expect(section).toContain("\n##### What update does\n");
  });

  it("names the --done command for every note, may apply included (#298 Phase 4)", () => {
    const doc = renderMergePlan(
      plan([], {
        notes: [updateNote()],
        mayApplyNotes: [updateNote({ id: "shell/0001-admin-kit-move" })],
      })
    );
    const done = doc.indexOf("### When a note is done");
    expect(done).toBeGreaterThan(doc.indexOf("### Notes that may apply"));
    expect(doc.slice(done)).toContain(
      "saasaloy update \\\n  --done base/0001-brand-css \\\n  --done shell/0001-admin-kit-move --yes\n"
    );
    expect(doc.slice(done)).toContain("exits `3` until it is cleared");
  });

  it("still returns an empty document with no merge and no note", () => {
    expect(renderMergePlan(plan([], {}))).toBe("");
  });
});
