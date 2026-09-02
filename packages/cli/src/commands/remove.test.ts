import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { stripAnsi } from "../lib/tui.js";
import { runRemove } from "./remove.js";

// Same hazard as `add`: `remove` with no module opens a picker, which without a terminal
// would hang forever instead of failing.

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
const ORIGINAL_CWD = process.cwd();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-remove-tty-"));
  // One installed module, so the command gets past "nothing installed" and reaches the
  // picker branch.
  await writeFile(
    join(dir, "saasaloy.json"),
    JSON.stringify({
      aliases: { "@web": "apps/web" },
      installed: ["waitlist"],
    }),
    "utf-8"
  );
  process.chdir(dir);
});

afterEach(() => {
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(dir, { recursive: true, force: true });
});

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  return {
    lines,
    restore() {
      process.stdout.write = originalWrite;
    },
  };
}

describe("runRemove without a module name", () => {
  it("fails with the usage line instead of opening a prompt nobody can answer", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runRemove([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy remove [<module>]");
  });

  it("also refuses when only stdout is redirected", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runRemove([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy remove [<module>]");
  });

  it("prints stored warnings before a dry-run exits", async () => {
    await mkdir(join(dir, ".saasaloy"), { recursive: true });
    await writeFile(
      join(dir, ".saasaloy", "manifest.json"),
      JSON.stringify({
        managed: {},
        links: {},
        patches: [],
        removeWarnings: {
          waitlist: ["The deployed waitlist data survives removal."],
        },
      }),
      "utf-8"
    );
    await writeFile(
      join(dir, "saasaloy-lock.json"),
      JSON.stringify({ lockfileVersion: 1, modules: {} }),
      "utf-8"
    );
    const captured = capture();
    let code: number;
    try {
      code = await runRemove(["waitlist", "--dry-run"]);
    } finally {
      captured.restore();
    }
    const output = captured.lines.join("");
    expect(code).toBe(0);
    expect(output).toContain("The deployed waitlist data survives removal.");
    expect(output.indexOf("survives removal")).toBeLessThan(
      output.indexOf("dry run")
    );
  });
});

// #62. `remove` deletes the block file it wrote, and it cannot delete the import line the
// owner added by hand — nothing recorded where that line went. Say so, or the next build
// fails on a module the user believes is fully uninstalled.
describe("runRemove — a ui block leaves its wire-up behind (#62)", () => {
  let project: string;
  const BLOCK = "packages/ui/src/blocks/widget.tsx";
  const BODY = "export const Widget = () => null;\n";

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-remove-block-"));
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({
        aliases: { "@ui": "packages/ui/src" },
        installed: ["widget"],
      }),
      "utf-8"
    );
    await mkdir(join(project, "packages", "ui", "src", "blocks"), {
      recursive: true,
    });
    await writeFile(join(project, ...BLOCK.split("/")), BODY, "utf-8");
    await mkdir(join(project, ".saasaloy"), { recursive: true });
    await writeFile(
      join(project, ".saasaloy", "manifest.json"),
      JSON.stringify({
        managed: {
          [BLOCK]: { module: "widget", hash: hashContent(BODY) },
        },
        links: {},
        patches: [],
        removeWarnings: {},
      }),
      "utf-8"
    );
    await writeFile(
      join(project, "saasaloy-lock.json"),
      JSON.stringify({ lockfileVersion: 1, modules: {} }),
      "utf-8"
    );
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    await rm(project, { recursive: true, force: true });
  });

  it("deletes the block and says the import is not reversed", async () => {
    const captured = capture();
    let code: number;
    try {
      code = await runRemove(["widget", "--yes"]);
    } finally {
      captured.restore();
    }
    const output = captured.lines.join("");

    expect(code).toBe(0);
    await expect(
      pathExists(join(project, ...BLOCK.split("/")))
    ).resolves.toBeFalsy();
    expect(output).toContain(BLOCK);
    expect(output).toContain("not reversed");
  });
});
