import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { exitCodeFor, EXIT_REFUSED, isRefusal, RefusalError } from "./exit.js";
import { confirm, multiselect, select, text } from "./prompts.js";

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

afterEach(() => {
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
});

function noTerminal(): void {
  process.stdin.isTTY = false;
  process.stdout.isTTY = false;
}

// The guard throws before clack is reached, so none of these opens a real prompt.
async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the prompt to refuse");
}

describe("the prompt guard with no terminal", () => {
  it("refuses a select, names the flag, and exits 2", async () => {
    noTerminal();
    const error = await refusal(() =>
      select({
        answeredBy: "`--yes` to install, or `--no-install` to skip it",
        message: "Install dependencies now?",
        options: [{ label: "Yes", value: true }],
      })
    );
    expect(error).toBeInstanceOf(RefusalError);
    expect(isRefusal(error)).toBeTruthy();
    expect(exitCodeFor(error)).toBe(EXIT_REFUSED);
    expect((error as Error).message).toBe(
      'No terminal to answer "Install dependencies now?" — pass `--yes` to install, or `--no-install` to skip it.'
    );
  });

  it("refuses a multiselect, naming the flag (#233)", async () => {
    noTerminal();
    const error = await refusal(() =>
      multiselect({
        answeredBy: "one or more module names",
        message: "Pick modules to add",
        options: [{ label: "waitlist", value: "waitlist" }],
      })
    );
    expect(error).toBeInstanceOf(RefusalError);
    expect((error as Error).message).toBe(
      'No terminal to answer "Pick modules to add" — pass one or more module names.'
    );
  });

  it("refuses a confirm", async () => {
    noTerminal();
    const error = await refusal(() =>
      confirm({ answeredBy: "`--yes`", message: "Proceed?" })
    );
    expect((error as Error).message).toContain("pass `--yes`");
  });

  it("refuses a text, quoting the first line of the message without colour", async () => {
    noTerminal();
    const error = await refusal(() =>
      text({
        answeredBy: "`<name>`",
        message: "\u001B[36mProject name?\u001B[39m\nA second line of help",
      })
    );
    expect((error as Error).message).toBe(
      'No terminal to answer "Project name?" — pass `<name>`.'
    );
  });

  it("refuses when only stdout is redirected", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const error = await refusal(() =>
      confirm({ answeredBy: "`--yes`", message: "Proceed?" })
    );
    expect(error).toBeInstanceOf(RefusalError);
  });

  it("reads the prompt's own output stream when it is not stdout", async () => {
    // `update` draws its confirm on stderr. A piped stdout does not matter there, but a
    // stderr that is not a terminal does.
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    const output = Object.assign(Object.create(process.stderr), {
      isTTY: false,
    }) as NodeJS.WriteStream;
    const error = await refusal(() =>
      confirm({ answeredBy: "`--yes`", message: "Proceed?", output })
    );
    expect(error).toBeInstanceOf(RefusalError);
  });
});

// The guard only works if nothing goes around it. Every file in `src/commands/` may take
// clack's output helpers, but a prompt has to come from `lib/prompts.ts`. An allowlist,
// not a blocklist, so a prompt clack adds later (or one nobody thought of, like `path`)
// fails here too.
const ALLOWED_FROM_CLACK = new Set([
  "cancel",
  "intro",
  "isCancel",
  "log",
  "note",
  "outro",
  "spinner",
]);

const COMMANDS_DIR = fileURLToPath(new URL("../commands", import.meta.url));
const CLACK_IMPORT =
  /import\s+(type\s+)?([^;]*?)\s+from\s+["']@clack\/prompts["']/g;

/** The value names a source file imports from `@clack/prompts`. Type imports are skipped. */
function clackImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(CLACK_IMPORT)) {
    if (match[1]) {
      continue;
    }
    const clause = match[2] ?? "";
    const braces = /\{([^}]*)\}/.exec(clause);
    if (!braces) {
      // A default or namespace import (`import * as clack`) hands over every prompt.
      names.push(clause.trim());
      continue;
    }
    for (const part of (braces[1] ?? "").split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (name === "" || part.trim().startsWith("type ")) {
        continue;
      }
      names.push(name.split(/\s+as\s+/)[0] ?? name);
    }
  }
  return names;
}

describe("commands import prompts only through the guard", () => {
  it("reads named, aliased, type and namespace imports", () => {
    expect(
      clackImports(
        'import { cancel, select as pick, type Option } from "@clack/prompts";\n' +
          'import type { TextOptions } from "@clack/prompts";\n' +
          'import * as clack from "@clack/prompts";'
      )
    ).toStrictEqual(["cancel", "select", "* as clack"]);
  });

  it("finds no prompt imported straight from @clack/prompts", async () => {
    const files = (await readdir(COMMANDS_DIR)).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts")
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(COMMANDS_DIR, file), "utf-8");
      for (const name of clackImports(source)) {
        if (!ALLOWED_FROM_CLACK.has(name)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(
      offenders,
      "import prompts from ../lib/prompts.js so they refuse with no terminal"
    ).toStrictEqual([]);
  });
});
