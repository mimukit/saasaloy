import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadedModule } from "./registry.js";
import {
  fromRefusal,
  moduleNoteSources,
  selectBaseNotes,
  selectModuleNotes,
  selectUpdateNotes,
} from "./update-note-select.js";
import { BASE_NOTE_OWNER, baseUpdateNotesDir } from "./update-notes.js";
import type { UpdateNote } from "./update-notes.js";
import type { ModuleUpdateInput, UpdatePlan } from "./updater.js";

// #298 Phase 3: which update notes a run hands to the agent. Base notes go by CLI version
// range, module notes by comparing the `update-notes/` folder of the old and the new
// revision, and every note then passes the same `when` test a descriptor entry does.

const BODY = `## What update does

It writes a file.

## What the merge plan gets

Nothing.

## What you do

Run \`pnpm install\`.

## Verify

Run \`pnpm check\`.
`;

function baseNote(serial: number, version: string): UpdateNote {
  const slug = `note-${serial}`;
  return {
    id: `base/${String(serial).padStart(4, "0")}-${slug}`,
    owner: BASE_NOTE_OWNER,
    serial,
    slug,
    title: `Base note ${serial}`,
    version,
    body: BODY,
    path: `/notes/${slug}.md`,
  };
}

function moduleNote(owner: string, serial: number): UpdateNote {
  const slug = `note-${serial}`;
  return {
    id: `${owner}/${String(serial).padStart(4, "0")}-${slug}`,
    owner,
    serial,
    slug,
    title: `${owner} note ${serial}`,
    body: BODY,
    path: `/notes/${owner}/${slug}.md`,
  };
}

const ids = (notes: readonly UpdateNote[]): string[] => notes.map((n) => n.id);

describe(selectBaseNotes, () => {
  const all = [
    baseNote(1, "0.8.0"),
    baseNote(2, "0.9.0"),
    baseNote(3, "0.8.0"),
    baseNote(4, "1.0.0"),
  ];

  it("selects notes newer than the recorded CLI, up to and including the running one", () => {
    const picked = selectBaseNotes(all, {
      recorded: "0.8.0",
      running: "0.9.0",
    });
    expect(ids(picked.notes)).toStrictEqual(["base/0002-note-2"]);
    expect(picked.mayApply).toStrictEqual([]);
  });

  it("orders by version, then by serial", () => {
    const picked = selectBaseNotes(all, {
      recorded: "0.7.0",
      running: "1.0.0",
    });
    expect(ids(picked.notes)).toStrictEqual([
      "base/0001-note-1",
      "base/0003-note-3",
      "base/0002-note-2",
      "base/0004-note-4",
    ]);
  });

  it("selects nothing on the CLI that recorded the base", () => {
    const picked = selectBaseNotes(all, {
      recorded: "0.9.0",
      running: "0.9.0",
    });
    expect(picked).toStrictEqual({ notes: [], mayApply: [] });
  });

  it("puts the notes an adoption cannot place under may apply", () => {
    const picked = selectBaseNotes(all, {
      recorded: "0.9.0",
      running: "1.0.0",
      adoptedAt: "0.9.0",
    });
    expect(ids(picked.notes)).toStrictEqual(["base/0004-note-4"]);
    expect(ids(picked.mayApply)).toStrictEqual([
      "base/0001-note-1",
      "base/0003-note-3",
      "base/0002-note-2",
    ]);
  });

  it("takes `--from` as the lower bound and leaves nothing to may apply", () => {
    const picked = selectBaseNotes(all, {
      recorded: "0.9.0",
      running: "1.0.0",
      adoptedAt: "0.9.0",
      from: "0.8.0",
    });
    expect(ids(picked.notes)).toStrictEqual([
      "base/0002-note-2",
      "base/0004-note-4",
    ]);
    expect(picked.mayApply).toStrictEqual([]);
  });

  it("puts every note up to the running CLI under may apply when the recorded version is not semver", () => {
    const picked = selectBaseNotes(all, {
      recorded: "unknown",
      running: "0.9.0",
    });
    expect(picked.notes).toStrictEqual([]);
    expect(ids(picked.mayApply)).toStrictEqual([
      "base/0001-note-1",
      "base/0003-note-3",
      "base/0002-note-2",
    ]);
  });

  it("selects nothing when the running version is not semver", () => {
    expect(
      selectBaseNotes(all, { recorded: "0.7.0", running: "unknown" })
    ).toStrictEqual({ notes: [], mayApply: [] });
  });
});

describe(selectModuleNotes, () => {
  it("selects a note in the new revision that the old one lacks", () => {
    const picked = selectModuleNotes(
      [moduleNote("email", 1), moduleNote("email", 2)],
      [moduleNote("email", 1)]
    );
    expect(ids(picked.notes)).toStrictEqual(["email/0002-note-2"]);
    expect(picked.mayApply).toStrictEqual([]);
  });

  it("selects every note when the old folder is empty", () => {
    const picked = selectModuleNotes([moduleNote("shell", 1)], []);
    expect(ids(picked.notes)).toStrictEqual(["shell/0001-note-1"]);
  });

  it("puts every note under may apply when there is no merge base", () => {
    // `undefined` is the "no merge base" value under test, not a default.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    const picked = selectModuleNotes([moduleNote("email", 1)], undefined);
    expect(picked.notes).toStrictEqual([]);
    expect(ids(picked.mayApply)).toStrictEqual(["email/0001-note-1"]);
  });
});

describe(fromRefusal, () => {
  it("accepts no `--from`", () => {
    expect(fromRefusal(undefined, false)).toBeUndefined();
  });

  it("accepts a valid version on the first update after adoption", () => {
    expect(fromRefusal("0.7.0", true)).toBeUndefined();
  });

  it("refuses `--from` on any other run, saying the range is already exact", () => {
    expect(fromRefusal("0.7.0", false)).toContain("already exact");
  });

  it("refuses a version that is not semver", () => {
    expect(fromRefusal("seven", true)).toContain("seven");
  });
});

describe(moduleNoteSources, () => {
  function loaded(name: string, dir: string): LoadedModule {
    return { dir, item: { name, type: "saasaloy:feature" } };
  }

  it("reads both revisions, marks a missing base, and adds new prerequisites with an empty old folder", () => {
    const admin = loaded("admin", "/theirs/admin");
    const shell = loaded("shell", "/theirs/shell");
    const inputs = [
      {
        comparison: {} as ModuleUpdateInput["comparison"],
        theirs: admin,
        base: loaded("admin", "/base/admin"),
        prereqs: {
          order: ["shell"],
          modules: new Map([["shell", shell]]),
        },
      },
      {
        comparison: {} as ModuleUpdateInput["comparison"],
        theirs: loaded("email", "/theirs/email"),
        noMergeBase: "local install",
      },
    ] satisfies ModuleUpdateInput[];
    const plan = {
      modules: [
        { name: "admin", prereqNames: ["shell"] },
        { name: "email", prereqNames: [] },
      ],
    } as unknown as UpdatePlan;

    expect(moduleNoteSources(inputs, plan)).toStrictEqual([
      { name: "shell", theirsDir: "/theirs/shell", fresh: true },
      { name: "admin", theirsDir: "/theirs/admin", baseDir: "/base/admin" },
      { name: "email", theirsDir: "/theirs/email" },
    ]);
  });

  it("skips the base template, whose notes go by version", () => {
    const inputs = [
      {
        comparison: {} as ModuleUpdateInput["comparison"],
        theirs: loaded("base", "/tmp/render"),
        baseRecord: { name: "web", cliVersion: "0.8.0", templateHash: "a" },
      },
    ] satisfies ModuleUpdateInput[];
    const plan = {
      modules: [{ name: "base", prereqNames: [] }],
    } as unknown as UpdatePlan;
    expect(moduleNoteSources(inputs, plan)).toStrictEqual([]);
  });
});

describe(selectUpdateNotes, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "saasaloy-note-select-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  async function put(
    folder: string,
    name: string,
    frontmatter: string
  ): Promise<void> {
    await mkdir(join(dir, folder, "update-notes"), { recursive: true });
    await writeFile(
      join(dir, folder, "update-notes", name),
      `---\n${frontmatter}\n---\n\n${BODY}`
    );
  }

  it("filters every group by `when`, base notes first, then modules in order", async () => {
    await put("base", "0001-one.md", "title: One\nversion: 0.8.0");
    await put(
      "base",
      "0002-tests.md",
      "title: Tests\nversion: 0.8.0\nwhen: { testing: true }"
    );
    await put(
      "shell-new",
      "0001-kit.md",
      "title: Kit\nwhen: { installed: [admin] }"
    );
    await put("email-old", "0001-old.md", "title: Old");
    await put("email-new", "0001-old.md", "title: Old");
    await put("email-new", "0002-port.md", "title: Port");
    await put(
      "auth-new",
      "0001-origin.md",
      "title: Origin\nwhen: { installed: [api] }"
    );

    const picked = await selectUpdateNotes({
      base: {
        dir: join(dir, "base", "update-notes"),
        recorded: "0.7.0",
        running: "0.8.0",
      },
      modules: [
        { name: "shell", theirsDir: join(dir, "shell-new"), fresh: true },
        {
          name: "email",
          theirsDir: join(dir, "email-new"),
          baseDir: join(dir, "email-old"),
        },
        { name: "auth", theirsDir: join(dir, "auth-new") },
      ],
      when: {
        installed: new Set(["email", "auth", "shell"]),
        testingMode: "off",
      },
    });

    expect(ids(picked.notes)).toStrictEqual([
      "base/0001-one",
      "email/0002-port",
    ]);
    expect(picked.mayApply).toStrictEqual([]);
  });

  it("keeps a note whose `when` holds and a may-apply note from a module with no merge base", async () => {
    await put(
      "shell-new",
      "0001-kit.md",
      "title: Kit\nwhen: { installed: [admin] }"
    );
    await put("auth-new", "0001-origin.md", "title: Origin");

    const picked = await selectUpdateNotes({
      modules: [
        { name: "shell", theirsDir: join(dir, "shell-new"), fresh: true },
        { name: "auth", theirsDir: join(dir, "auth-new") },
      ],
      when: {
        installed: new Set(["admin", "shell", "auth"]),
        testingMode: "off",
      },
    });

    expect(ids(picked.notes)).toStrictEqual(["shell/0001-kit"]);
    expect(ids(picked.mayApply)).toStrictEqual(["auth/0001-origin"]);
  });

  it("lists a note once when two modules pull in the same new prerequisite", async () => {
    await put("shell-new", "0001-kit.md", "title: Kit");
    const shell = {
      name: "shell",
      theirsDir: join(dir, "shell-new"),
      fresh: true,
    };

    const picked = await selectUpdateNotes({
      modules: [shell, shell],
      when: { installed: new Set(["shell"]), testingMode: "off" },
    });

    expect(ids(picked.notes)).toStrictEqual(["shell/0001-kit"]);
  });

  it("reads the real base notes, so a project recorded at 0.7.0 gets the brand.css note", async () => {
    const picked = await selectUpdateNotes({
      base: {
        dir: await baseUpdateNotesDir(),
        recorded: "0.7.0",
        running: "0.8.0",
      },
      modules: [],
      when: { installed: new Set(), testingMode: "off" },
    });

    expect(ids(picked.notes)).toContain("base/0001-brand-css");
  });
});
