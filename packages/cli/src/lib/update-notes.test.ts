import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import cliPackage from "../../package.json" with { type: "json" };
import { isRefusal } from "./exit.js";
import { compareVersions, parseVersion } from "./semver.js";
import {
  BASE_NOTE_OWNER,
  UpdateNoteError,
  baseUpdateNotesDir,
  listUpdateNotes,
  moduleUpdateNotesDir,
  parseFrontmatter,
  parseNoteFileName,
  parseUpdateNote,
} from "./update-notes.js";
import type { UpdateNote } from "./update-notes.js";

// #298 Phase 2: an update note is a Markdown file with YAML frontmatter, one per change
// that asks the project for work outside the files `update` merges. The loader parses
// one, validates it, derives its id from its path and lists a folder in serial order.

const SECTIONS = `## What update does

It writes a file.

## What the merge plan gets

Nothing.

## What you do

1. Run this:

   \`\`\`sh
   pnpm install
   \`\`\`

## Verify

\`\`\`sh
pnpm check
\`\`\`
`;

function note(frontmatter: string, body = SECTIONS): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-notes-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

async function put(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe(parseFrontmatter, () => {
  it("reads plain, quoted and boolean scalars", () => {
    const { data, body } = parseFrontmatter(
      note(
        [
          "title: Move the tokens # a comment",
          'version: "0.8.0"',
          "other: 'it''s here'",
          "flag: true",
        ].join("\n"),
        "Body\n"
      )
    );

    expect(data).toStrictEqual({
      flag: true,
      other: "it's here",
      title: "Move the tokens",
      version: "0.8.0",
    });
    expect(body).toBe("Body\n");
  });

  it("reads a nested map with a block list", () => {
    const { data } = parseFrontmatter(
      note(
        "title: X\nwhen:\n  testing: true\n  installed:\n    - admin\n    - app"
      )
    );

    expect(data).toStrictEqual({
      title: "X",
      when: { installed: ["admin", "app"], testing: true },
    });
  });

  it("reads a flow map and a flow list", () => {
    const { data } = parseFrontmatter(
      note("title: X\nwhen: { installed: [admin, 'app'] }")
    );

    expect(data).toStrictEqual({
      title: "X",
      when: { installed: ["admin", "app"] },
    });
  });

  it("skips blank lines and full-line comments", () => {
    const { data } = parseFrontmatter(note("# note\n\ntitle: X\n"));

    expect(data).toStrictEqual({ title: "X" });
  });

  it("reads CRLF line endings", () => {
    const { data, body } = parseFrontmatter(
      "---\r\ntitle: X\r\n---\r\nBody\r\n"
    );

    expect(data).toStrictEqual({ title: "X" });
    expect(body).toBe("Body\n");
  });

  it("refuses a file with no frontmatter", () => {
    expect(() => parseFrontmatter("# Title\n")).toThrow(/frontmatter/);
  });

  it("refuses an unclosed frontmatter", () => {
    expect(() => parseFrontmatter("---\ntitle: X\n")).toThrow(/closing/);
  });

  it("refuses a duplicate key", () => {
    expect(() => parseFrontmatter(note("title: X\ntitle: Y"))).toThrow(
      /duplicate key "title"/
    );
  });

  it("refuses YAML outside the supported subset", () => {
    expect(() => parseFrontmatter(note("title: |\n  long"))).toThrow(/line 1/);
    expect(() => parseFrontmatter(note("- title"))).toThrow(/line 1/);
    expect(() => parseFrontmatter(note("title: [a, b"))).toThrow(/line 1/);
  });
});

describe(parseNoteFileName, () => {
  it("splits a serial and a slug", () => {
    expect(parseNoteFileName("0012-brand-css.md")).toStrictEqual({
      serial: 12,
      slug: "brand-css",
    });
  });

  it.each([
    "1-brand.md",
    "0001_brand.md",
    "0001-Brand.md",
    "0001-brand.txt",
    "0001-.md",
    "0000-brand.md",
    "README.md",
  ])("rejects %s", (name) => {
    expect(parseNoteFileName(name)).toBeUndefined();
  });
});

describe(parseUpdateNote, () => {
  it("parses a base note and derives its id", async () => {
    const path = await put(
      "0001-brand-css.md",
      note("title: Move the tokens\nversion: 0.8.0")
    );

    await expect(parseUpdateNote(path, BASE_NOTE_OWNER)).resolves.toStrictEqual(
      {
        body: SECTIONS,
        id: "base/0001-brand-css",
        owner: "base",
        path,
        serial: 1,
        slug: "brand-css",
        title: "Move the tokens",
        version: "0.8.0",
      }
    );
  });

  it("parses a module note with a when", async () => {
    const path = await put(
      "0003-kit.md",
      note("title: Move the kit\nwhen:\n  installed:\n    - admin")
    );

    await expect(parseUpdateNote(path, "shell")).resolves.toMatchObject({
      id: "shell/0003-kit",
      owner: "shell",
      serial: 3,
      when: { installed: ["admin"] },
    });
  });

  it("refuses a base note with no version", async () => {
    const path = await put("0001-x.md", note("title: X"));

    await expect(parseUpdateNote(path, BASE_NOTE_OWNER)).rejects.toThrow(
      /needs a version/
    );
  });

  it("refuses a module note that carries a version", async () => {
    const path = await put("0001-x.md", note("title: X\nversion: 0.8.0"));

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(
      /must not carry a version/
    );
  });

  it("refuses frontmatter the schema rejects, naming the key", async () => {
    const path = await put("0001-x.md", note("title: X\nid: api/0001-x"));

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(
      /unexpected property "id"/
    );
  });

  it("refuses a bad file name", async () => {
    const path = await put("brand.md", note("title: X"));

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(/NNNN-<slug>/);
  });

  it("refuses an owner that is not a module name", async () => {
    const path = await put("0001-x.md", note("title: X"));

    await expect(parseUpdateNote(path, "Api")).rejects.toThrow(/owner/);
  });

  it("refuses a body that lacks a section", async () => {
    const path = await put(
      "0001-x.md",
      note("title: X", SECTIONS.replace("## Verify", "## Check"))
    );

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(/"## Verify"/);
  });

  it("refuses sections out of order", async () => {
    const swapped = SECTIONS.replace("## What update does", "## TMP")
      .replace("## What you do", "## What update does")
      .replace("## TMP", "## What you do");
    const path = await put("0001-x.md", note("title: X", swapped));

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(/order/);
  });

  it("ignores a heading inside a fenced block", async () => {
    const body = SECTIONS.replace("## Verify", "```md\n## Verify\n```");
    const path = await put("0001-x.md", note("title: X", body));

    await expect(parseUpdateNote(path, "api")).rejects.toThrow(/"## Verify"/);
  });

  it("throws a refusal that names the file", async () => {
    const path = await put("0001-x.md", "no frontmatter");
    const refusal = await parseUpdateNote(path, "api").catch(
      (error: unknown) => error
    );

    expect(refusal).toBeInstanceOf(UpdateNoteError);
    expect(isRefusal(refusal)).toBeTruthy();
    expect((refusal as UpdateNoteError).path).toBe(path);
    expect((refusal as Error).message).toContain(path);
  });
});

describe(listUpdateNotes, () => {
  it("lists a folder's notes in serial order", async () => {
    await put("0010-later.md", note("title: Later"));
    await put("0002-sooner.md", note("title: Sooner"));
    await put(".gitkeep", "");

    const notes = await listUpdateNotes(dir, "api");

    expect(notes.map((entry) => entry.id)).toStrictEqual([
      "api/0002-sooner",
      "api/0010-later",
    ]);
  });

  it("lists nothing for a missing folder", async () => {
    await expect(
      listUpdateNotes(join(dir, "missing"), "api")
    ).resolves.toStrictEqual([]);
  });

  it("refuses a stray file", async () => {
    await put("0001-x.md", note("title: X"));
    await put("notes.txt", "");

    await expect(listUpdateNotes(dir, "api")).rejects.toThrow(/notes\.txt/);
  });

  it("refuses a folder inside the notes folder", async () => {
    await mkdir(join(dir, "0002-y.md"));

    await expect(listUpdateNotes(dir, "api")).rejects.toThrow(/not a file/);
  });

  it("refuses a reused serial", async () => {
    await put("0001-x.md", note("title: X"));
    await put("0001-y.md", note("title: Y"));

    await expect(listUpdateNotes(dir, "api")).rejects.toThrow(/serial 0001/);
  });
});

describe("note folders", () => {
  it("resolves the base folder inside the package", async () => {
    await expect(baseUpdateNotesDir()).resolves.toMatch(
      /packages\/cli\/update-notes$/
    );
  });

  it("puts a module's notes in its update-notes folder", () => {
    expect(moduleUpdateNotesDir("/reg/shell")).toBe("/reg/shell/update-notes");
  });
});

// Every note the repo ships, parsed the way `update` will parse it. A malformed note, a
// stray file in a notes folder or a broken cross-reference fails here, not in a
// project's merge plan.
const MODULES = fileURLToPath(new URL("../../../../modules/", import.meta.url));

async function repoNotes(): Promise<UpdateNote[]> {
  const notes = await listUpdateNotes(
    await baseUpdateNotesDir(),
    BASE_NOTE_OWNER
  );
  const modules = (await readdir(MODULES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const module of modules) {
    notes.push(
      ...(await listUpdateNotes(
        moduleUpdateNotesDir(join(MODULES, module)),
        module
      ))
    );
  }
  return notes;
}

describe("the repo's update notes", () => {
  it("parses every note and holds the v0.8.0 set", async () => {
    const ids = (await repoNotes()).map((entry) => entry.id);

    expect(ids).toStrictEqual(
      expect.arrayContaining([
        "base/0001-brand-css",
        "api/0001-app-origin",
        "auth/0001-app-origin",
        "email-react/0001-preview-port",
        "shell/0001-admin-kit-move",
      ])
    );
  });

  it("dates every base note at or before the CLI in this package", async () => {
    const current = parseVersion(cliPackage.version)!;
    const late = (await repoNotes())
      .filter((entry) => entry.owner === BASE_NOTE_OWNER)
      .filter((entry) => {
        const version = parseVersion(entry.version ?? "");
        return version === undefined || compareVersions(version, current) > 0;
      })
      .map((entry) => `${entry.id} (${entry.version ?? "no version"})`);

    expect(late).toStrictEqual([]);
  });

  it("names only modules the registry has in a when", async () => {
    const modules = new Set(await readdir(MODULES));
    const unknown = (await repoNotes()).flatMap((entry) =>
      (entry.when?.installed ?? [])
        .filter((name) => !modules.has(name))
        .map((name) => `${entry.id} names ${name}`)
    );

    expect(unknown).toStrictEqual([]);
  });

  it("names only notes that exist when it points at another note", async () => {
    const notes = await repoNotes();
    const ids = new Set(notes.map((entry) => entry.id));
    const refs = notes.flatMap((entry) =>
      [...entry.body.matchAll(/`([a-z0-9][a-z0-9-]*\/\d{4}-[a-z0-9-]+)`/g)].map(
        (match) => ({ from: entry.id, to: match[1]! })
      )
    );

    expect(refs.length).toBeGreaterThan(0);
    expect(
      refs
        .filter((ref) => !ids.has(ref.to))
        .map((ref) => `${ref.from} names ${ref.to}`)
    ).toStrictEqual([]);
  });
});
