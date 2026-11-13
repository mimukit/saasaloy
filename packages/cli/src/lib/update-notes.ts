import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RefusalError } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import { validateUpdateNote } from "./schema.js";
import type { When } from "./schema.js";

// Update notes (#298). A note tells the agent in a project what an upgrade asks of it
// beyond the files `saasaloy update` merges: an import path in the owner's own code, a
// moved stylesheet block, a port, a CORS origin. One Markdown file per note, with YAML
// frontmatter, in `packages/cli/update-notes/` for the base and
// `modules/<name>/update-notes/` for a module. The id comes from the path, so the
// frontmatter carries none.
//
// This file parses, validates and lists notes. Which notes a run shows is
// `commands/update.ts`'s business, not this file's.

/** The owner a base note's id starts with. A module note's owner is its module name. */
export const BASE_NOTE_OWNER = "base";

/** The folder that holds the notes, in the CLI package and in each module. */
export const UPDATE_NOTES_DIR = "update-notes";

/** The four `##` sections every note body holds, in this order. */
export const UPDATE_NOTE_SECTIONS = [
  "What update does",
  "What the merge plan gets",
  "What you do",
  "Verify",
] as const;

/** One parsed and validated update note. */
export interface UpdateNote {
  /** `<owner>/NNNN-<slug>`, for example `base/0001-brand-css` or `shell/0001-admin-kit-move`. */
  id: string;
  /** `base`, or the module name whose `update-notes/` folder holds the note. */
  owner: string;
  /** The `NNNN` of the file name, as a number. Unique within one folder. */
  serial: number;
  /** The `<slug>` of the file name. */
  slug: string;
  title: string;
  /** The CLI release that ships the change. Present on every base note, absent on every module note. */
  version?: string;
  /** The condition under which the note applies, tested with `whenHolds`. */
  when?: When;
  /** The Markdown after the frontmatter, leading blank lines removed, LF line endings. */
  body: string;
  /** Absolute path of the note file. */
  path: string;
}

/** What a merge plan prints of a note, and all a pending note stores of it (#298). */
export type UpdateNoteText = Pick<UpdateNote, "id" | "title" | "body">;

/**
 * A note that cannot be read: a bad file name, frontmatter outside the supported subset
 * or rejected by the schema, a missing section, a reused serial. It is bad input, not a
 * transient failure, so it refuses (exit 2) and names the file.
 */
export class UpdateNoteError extends RefusalError {
  override readonly name = "UpdateNoteError";

  constructor(
    readonly path: string,
    detail: string,
    options?: ErrorOptions
  ) {
    super(`Update note ${path}: ${detail}`, options);
  }
}

// --- Frontmatter --------------------------------------------------------------------
//
// The CLI has no YAML dependency, and a note needs very little of YAML. The subset:
//
//   key: scalar            plain, 'single' or "double" quoted; `true` / `false` are booleans
//   key: [a, b]            a flow list of scalars
//   key: { k: v, k: [a] }  a flow map, nesting flow values
//   key:                   a block map or a block list, indented under the key
//     - item
//
// Blank lines and `#` comments are skipped. Anything else (a block scalar, an anchor, a
// tag, a multi-line flow value) is refused with its line number, so an author learns at
// test time that the note says something this parser cannot read.

/** A parsed frontmatter value. */
export type FrontmatterValue =
  string | boolean | FrontmatterValue[] | { [key: string]: FrontmatterValue };

interface Line {
  /** 1-based, counted from the first line inside the frontmatter. */
  number: number;
  indent: number;
  text: string;
}

const KEY_LINE = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/;
const UNSUPPORTED_START = /^[|>&*!%@`]/;

class FrontmatterError extends Error {
  override readonly name = "FrontmatterError";

  constructor(line: number, detail: string) {
    super(`frontmatter line ${line}: ${detail}`);
  }
}

/** Strip a ` #` comment from an unquoted tail. */
function stripComment(text: string): string {
  const hash = text.search(/(?:^|[ \t])#/);
  return (hash === -1 ? text : text.slice(0, hash)).trimEnd();
}

function plainScalar(raw: string, line: number): string | boolean {
  if (raw === "") {
    throw new FrontmatterError(line, "empty value");
  }
  if (UNSUPPORTED_START.test(raw)) {
    throw new FrontmatterError(
      line,
      `"${raw}" uses YAML this parser does not read; quote the value`
    );
  }
  if (raw === "true" || raw === "false") {
    return raw === "true";
  }
  return raw;
}

/** A cursor over one line's flow value: `[a, b]`, `{ k: v }`, a quoted or plain scalar. */
class FlowReader {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly line: number
  ) {}

  read(): FrontmatterValue {
    const value = this.value(false);
    const rest = stripComment(this.text.slice(this.pos)).trim();
    if (rest !== "") {
      this.fail(`unexpected "${rest}" after the value`);
    }
    return value;
  }

  private fail(detail: string): never {
    throw new FrontmatterError(this.line, detail);
  }

  private skipSpace(): void {
    while (this.text[this.pos] === " " || this.text[this.pos] === "\t") {
      this.pos += 1;
    }
  }

  private value(inFlow: boolean): FrontmatterValue {
    this.skipSpace();
    const char = this.text[this.pos];
    if (char === "[") {
      return this.list();
    }
    if (char === "{") {
      return this.map();
    }
    if (char === '"' || char === "'") {
      return this.quoted(char);
    }
    return this.plain(inFlow);
  }

  private quoted(quote: string): string {
    if (quote === "'") {
      let out = "";
      this.pos += 1;
      while (this.pos < this.text.length) {
        const char = this.text[this.pos];
        if (char === "'") {
          if (this.text[this.pos + 1] === "'") {
            out += "'";
            this.pos += 2;
            continue;
          }
          this.pos += 1;
          return out;
        }
        out += char;
        this.pos += 1;
      }
      this.fail("unclosed single quote");
    }
    const end = /^"(?:[^"\\]|\\.)*"/.exec(this.text.slice(this.pos));
    if (!end) {
      this.fail("unclosed double quote");
    }
    this.pos += end[0].length;
    try {
      return JSON.parse(end[0]) as string;
    } catch (error) {
      throw new FrontmatterError(
        this.line,
        `bad escape in ${end[0]}: ${String(error)}`
      );
    }
  }

  private plain(inFlow: boolean): string | boolean {
    const stop = inFlow ? /[,\]}]/ : /$/;
    const rest = this.text.slice(this.pos);
    const match = stop.exec(rest);
    const end = match ? match.index : rest.length;
    const raw = inFlow ? rest.slice(0, end).trim() : stripComment(rest).trim();
    this.pos += inFlow ? end : rest.length;
    if (inFlow && /[[{:]/.test(raw)) {
      this.fail(`"${raw}" is not a plain value; quote it`);
    }
    return plainScalar(raw, this.line);
  }

  private list(): FrontmatterValue[] {
    this.pos += 1;
    const items: FrontmatterValue[] = [];
    this.skipSpace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return items;
    }
    for (;;) {
      items.push(this.value(true));
      this.skipSpace();
      const char = this.text[this.pos];
      this.pos += 1;
      if (char === "]") {
        return items;
      }
      if (char !== ",") {
        this.fail("a flow list needs a closing ]");
      }
    }
  }

  private map(): Record<string, FrontmatterValue> {
    this.pos += 1;
    const out: Record<string, FrontmatterValue> = {};
    this.skipSpace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipSpace();
      const key = /^([A-Za-z_][\w-]*):[ \t]*/.exec(this.text.slice(this.pos));
      if (!key) {
        this.fail("a flow map needs `key: value` pairs");
      }
      this.pos += key[0].length;
      if (Object.hasOwn(out, key[1]!)) {
        this.fail(`duplicate key "${key[1]!}"`);
      }
      out[key[1]!] = this.value(true);
      this.skipSpace();
      const char = this.text[this.pos];
      this.pos += 1;
      if (char === "}") {
        return out;
      }
      if (char !== ",") {
        this.fail("a flow map needs a closing }");
      }
    }
  }
}

function inlineValue(text: string, line: number): FrontmatterValue {
  return new FlowReader(text, line).read();
}

/** Parse the block lines from `start` at exactly `indent` into a map. Returns the next index. */
function blockMap(
  lines: readonly Line[],
  start: number,
  indent: number,
  out: Record<string, FrontmatterValue>
): number {
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) {
      return index;
    }
    if (line.indent > indent) {
      throw new FrontmatterError(line.number, "unexpected indentation");
    }
    const match = KEY_LINE.exec(line.text);
    if (!match) {
      throw new FrontmatterError(
        line.number,
        `expected \`key: value\`, found "${line.text}"`
      );
    }
    const key = match[1]!;
    if (Object.hasOwn(out, key)) {
      throw new FrontmatterError(line.number, `duplicate key "${key}"`);
    }
    const tail = stripComment(match[2] ?? "");
    index += 1;
    if (tail !== "") {
      out[key] = inlineValue(match[2]!, line.number);
      continue;
    }
    const child = lines[index];
    if (child === undefined || child.indent <= indent) {
      throw new FrontmatterError(line.number, `"${key}" has no value`);
    }
    if (child.text.startsWith("- ") || child.text === "-") {
      const items: FrontmatterValue[] = [];
      while (
        index < lines.length &&
        lines[index]!.indent === child.indent &&
        lines[index]!.text.startsWith("-")
      ) {
        const item = lines[index]!;
        const raw = item.text.slice(1).trim();
        if (!item.text.startsWith("- ") || raw === "") {
          throw new FrontmatterError(item.number, "empty list item");
        }
        items.push(inlineValue(raw, item.number));
        index += 1;
      }
      out[key] = items;
      continue;
    }
    const nested: Record<string, FrontmatterValue> = {};
    index = blockMap(lines, index, child.indent, nested);
    out[key] = nested;
  }
  return index;
}

/**
 * Split a note into its frontmatter, parsed, and its Markdown body. The file opens with a
 * `---` line and the frontmatter ends at the next one. Line endings come back as LF.
 *
 * @throws {Error} when the frontmatter is missing, unclosed or outside the supported subset.
 */
export function parseFrontmatter(source: string): {
  data: Record<string, FrontmatterValue>;
  body: string;
} {
  const all = source.replaceAll("\r\n", "\n").split("\n");
  if (all[0] !== "---") {
    throw new Error("the file has to open with a `---` frontmatter line");
  }
  const close = all.indexOf("---", 1);
  if (close === -1) {
    throw new Error("the frontmatter has no closing `---` line");
  }
  const lines: Line[] = [];
  for (const [offset, raw] of all.slice(1, close).entries()) {
    const text = raw.trimEnd();
    const trimmed = text.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (text.startsWith("\t")) {
      throw new FrontmatterError(offset + 1, "indent with spaces, not tabs");
    }
    lines.push({
      indent: text.length - trimmed.length,
      number: offset + 1,
      text: trimmed,
    });
  }
  const data: Record<string, FrontmatterValue> = {};
  const first = lines[0];
  if (first !== undefined) {
    const end = blockMap(lines, 0, first.indent, data);
    if (end < lines.length) {
      throw new FrontmatterError(lines[end]!.number, "unexpected indentation");
    }
  }
  const body = all
    .slice(close + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { body, data };
}

// --- Notes --------------------------------------------------------------------------

const FILE_NAME = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/;
const OWNER = /^[a-z0-9][a-z0-9-]*$/;

/** The serial and slug of a `NNNN-<slug>.md` file name, or `undefined` for any other name. */
export function parseNoteFileName(
  name: string
): { serial: number; slug: string } | undefined {
  const match = FILE_NAME.exec(name);
  if (!match) {
    return undefined;
  }
  const serial = Number(match[1]);
  return serial === 0 ? undefined : { serial, slug: match[2]! };
}

/** The `##` headings of a Markdown body, outside fenced blocks, in order. */
function sectionHeadings(body: string): string[] {
  const headings: string[] = [];
  let fence: string | undefined;
  for (const line of body.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) {
        fence = marker;
      } else if (
        marker.startsWith(fence[0]!) &&
        marker.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fence === undefined) {
      const heading = /^## +(.+?)\s*#*\s*$/.exec(line)?.[1];
      if (heading !== undefined) {
        headings.push(heading);
      }
    }
  }
  return headings;
}

function checkSections(path: string, body: string): void {
  const headings = sectionHeadings(body);
  const positions = UPDATE_NOTE_SECTIONS.map((section) => {
    const at = headings.indexOf(section);
    if (at === -1) {
      throw new UpdateNoteError(
        path,
        `the body is missing the "## ${section}" section. Every note holds ${UPDATE_NOTE_SECTIONS.map((name) => `"## ${name}"`).join(", ")}, in that order.`
      );
    }
    if (headings.includes(section, at + 1)) {
      throw new UpdateNoteError(
        path,
        `the body holds the "## ${section}" section twice.`
      );
    }
    return at;
  });
  if (positions.some((at, index) => index > 0 && at < positions[index - 1]!)) {
    throw new UpdateNoteError(
      path,
      `the body holds its sections out of order. Write them in this order: ${UPDATE_NOTE_SECTIONS.map((name) => `"## ${name}"`).join(", ")}.`
    );
  }
}

/**
 * Read, parse and validate one note. `owner` is `base` for a note in the CLI package's
 * folder, and the module name for a note in `modules/<owner>/update-notes/`.
 *
 * @throws {UpdateNoteError} when the note is malformed in any way.
 */
export async function parseUpdateNote(
  path: string,
  owner: string
): Promise<UpdateNote> {
  if (!OWNER.test(owner)) {
    throw new UpdateNoteError(
      path,
      `the owner "${owner}" is not \`base\` or a module name.`
    );
  }
  const name = parseNoteFileName(basename(path));
  if (!name) {
    throw new UpdateNoteError(
      path,
      "the file name has to be NNNN-<slug>.md: a four-digit serial from 0001, then a lowercase slug of letters, digits and dashes."
    );
  }
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(await readFile(path, "utf-8"));
  } catch (error) {
    if (error instanceof UpdateNoteError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new UpdateNoteError(path, `${detail}.`, { cause: error });
  }
  const { data, body } = parsed;
  const result = await validateUpdateNote(data);
  if (!result.valid) {
    throw new UpdateNoteError(
      path,
      `the frontmatter is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  const frontmatter = data as unknown as {
    title: string;
    version?: string;
    when?: When;
  };
  if (owner === BASE_NOTE_OWNER && frontmatter.version === undefined) {
    throw new UpdateNoteError(
      path,
      "a base note needs a version: the CLI release that ships the change."
    );
  }
  if (owner !== BASE_NOTE_OWNER && frontmatter.version !== undefined) {
    throw new UpdateNoteError(
      path,
      "a module note must not carry a version. `update` selects it by the module's revision, not by CLI version."
    );
  }
  checkSections(path, body);
  const id = `${owner}/${basename(path, ".md")}`;
  return {
    body,
    id,
    owner,
    path,
    serial: name.serial,
    slug: name.slug,
    title: frontmatter.title,
    ...(frontmatter.version === undefined
      ? {}
      : { version: frontmatter.version }),
    ...(frontmatter.when === undefined ? {} : { when: frontmatter.when }),
  };
}

/**
 * Every note in one `update-notes/` folder, in serial order. A missing folder lists
 * nothing, which is the case for every module that has no notes. A dotfile is skipped;
 * any other entry that is not a `NNNN-<slug>.md` file refuses, and so does a serial two
 * files share.
 *
 * @throws {UpdateNoteError} when an entry or a note is malformed.
 */
export async function listUpdateNotes(
  dir: string,
  owner: string
): Promise<UpdateNote[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
  const notes: UpdateNote[] = [];
  const bySerial = new Map<number, string>();
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry.name);
    if (!entry.isFile()) {
      throw new UpdateNoteError(
        path,
        "not a file. An update-notes folder holds NNNN-<slug>.md files only."
      );
    }
    const note = await parseUpdateNote(path, owner);
    const taken = bySerial.get(note.serial);
    if (taken !== undefined) {
      throw new UpdateNoteError(
        path,
        `serial ${String(note.serial).padStart(4, "0")} is already taken by ${taken}. A serial is never reused; take the next free one.`
      );
    }
    bySerial.set(note.serial, entry.name);
    notes.push(note);
  }
  return notes.toSorted((a, b) => a.serial - b.serial);
}

/** The `update-notes/` folder inside a module folder, such as `LoadedModule.dir`. */
export function moduleUpdateNotesDir(moduleDir: string): string {
  return join(moduleDir, UPDATE_NOTES_DIR);
}

// The base notes ship beside dist/ (package.json "files"), the way `lib/scaffold.ts`
// finds the template and `lib/schema.ts` its schemas. At runtime import.meta.url is
// <pkg>/dist/index.js; under vitest it is <pkg>/src/lib/update-notes.ts.
const NOTES_DIR_CANDIDATES = ["../update-notes", "../../update-notes"];

/** Absolute path of the base notes folder in the CLI package. */
export async function baseUpdateNotesDir(): Promise<string> {
  for (const candidate of NOTES_DIR_CANDIDATES) {
    const dir = fileURLToPath(new URL(candidate, import.meta.url));
    if (await pathExists(dir)) {
      return dir;
    }
  }
  // Fall back to the packaged location; `listUpdateNotes` reads a missing folder as empty.
  return fileURLToPath(new URL(NOTES_DIR_CANDIDATES[0]!, import.meta.url));
}
