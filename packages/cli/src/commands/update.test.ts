import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { runUpdate } from "./update.js";

// Both guards here reject bad input *before* the command reaches the registry, which is
// what keeps these tests offline. A value flag that swallowed the next flag would carry
// "--dry-run" into a ref lookup, and an `--out` aimed at a state file would replace it
// with merge-plan prose after the ledger had already been saved.

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-update-guards-"));
  await writeFile(
    join(dir, "saasaloy.json"),
    JSON.stringify({ aliases: { "@web": "apps/web" }, installed: ["email"] }),
    "utf-8"
  );
  process.chdir(dir);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(dir, { recursive: true, force: true });
});

// The update TUI writes to stderr so stdout stays reserved for the merge plan.
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  return {
    lines,
    restore() {
      process.stderr.write = originalWrite;
    },
  };
}

async function runCaptured(argv: string[]): Promise<[number, string]> {
  const captured = capture();
  let code: number;
  try {
    code = await runUpdate(argv);
  } finally {
    captured.restore();
  }
  return [code, captured.lines.join("")];
}

describe("runUpdate value flags", () => {
  it("rejects `--ref` when the next token is another flag", async () => {
    const [code, output] = await runCaptured(["email", "--ref", "--dry-run"]);
    expect(code).toBe(1);
    expect(output).toContain("--ref (missing value)");
  });

  it("rejects `--ref` at the end of the argv", async () => {
    const [code, output] = await runCaptured(["email", "--ref"]);
    expect(code).toBe(1);
    expect(output).toContain("--ref (missing value)");
  });

  it("still accepts the inline `--ref=<value>` form", async () => {
    // Reaches the "needs an explicit module" guard, which proves the ref was parsed.
    const [code, output] = await runCaptured(["--ref=v2"]);
    expect(code).toBe(1);
    expect(output).toContain("`--ref` needs an explicit module");
  });
});

describe("runUpdate --out", () => {
  it.each([
    ["saasaloy.json"],
    ["saasaloy-lock.json"],
    [join(".saasaloy", "manifest.json")],
  ])("refuses to write the merge plan over %s", async (target) => {
    const [code, output] = await runCaptured(["--out", target]);
    expect(code).toBe(1);
    expect(output).toContain("Refusing to write the merge plan");
  });

  it("refuses an absolute path that resolves to a state file", async () => {
    const [code, output] = await runCaptured([
      "--out",
      join(dir, "saasaloy-lock.json"),
    ]);
    expect(code).toBe(1);
    expect(output).toContain("Refusing to write the merge plan");
  });
});

// #98 Phase 5. `update` used to read a non-TTY *stdout* as "a script is driving me" and
// set `--yes` for itself. But stdout is where the merge plan goes, so `saasaloy update |
// tee log` applied every file unconfirmed. stdin is the stream the prompt actually reads,
// and a non-TTY stdin with no `--yes` means nobody can answer — so it refuses.
describe("runUpdate — the confirmation gate (#98)", () => {
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-tty-"));
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    process.chdir(project);
  });

  afterEach(() => {
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
  });

  afterAll(async () => {
    process.chdir(dir);
    await rm(project, { recursive: true, force: true });
  });

  it("refuses to apply when stdin isn't a terminal and `--yes` is absent", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(1);
    expect(output).toContain("No terminal to confirm in");
    // It refuses before the registry is reached, which is what keeps this test offline.
    expect(output).not.toContain("Nothing installed");
  });

  it("still refuses when only stdout is a terminal", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = true;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(1);
    expect(output).toContain("No terminal to confirm in");
  });

  it("proceeds past the gate with `--yes` on a piped stdin", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured(["--yes"]);
    expect(code).toBe(0);
    expect(output).toContain("Nothing installed");
  });

  it("proceeds past the gate for a preview, which writes nothing", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured(["--dry-run"]);
    expect(code).toBe(0);
    expect(output).toContain("Nothing installed");
  });

  it("proceeds past the gate on a terminal, with the merge plan piped away", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(0);
    expect(output).toContain("Nothing installed");
  });
});

// #98 Phase 5. `update` never imported `detectConflicts`, so a new version that pulls in
// a second driver installed it as a prerequisite — the exact pair `add` refuses. It also
// never read the new descriptor's `envVars`, so a version that starts requiring a secret
// updated in silence. Both run offline here, off a SAASALOY_REGISTRY_DIR checkout.
describe("runUpdate — conflicts and env vars (#98)", () => {
  let project: string;
  let registry: string;

  async function descriptor(
    name: string,
    item: Record<string, unknown>
  ): Promise<void> {
    const modDir = join(registry, name);
    await mkdir(modDir, { recursive: true });
    await writeFile(
      join(modDir, "registry-item.json"),
      JSON.stringify({ name, type: "saasaloy:feature", files: [], ...item }),
      "utf-8"
    );
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-conf-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-update-reg-"));
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function state(
    installed: string[],
    modules: Record<string, unknown>
  ): Promise<void> {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed }),
      "utf-8"
    );
    await writeFile(
      join(project, "saasaloy-lock.json"),
      JSON.stringify({ lockfileVersion: 1, modules }),
      "utf-8"
    );
  }

  const localEntry = { source: "local", ref: "local", resolved: "local" };

  it("refuses an update whose new prerequisite conflicts with an installed module", async () => {
    await state(["widget", "driver-a"], {
      widget: localEntry,
      "driver-a": { ...localEntry, conflictsWith: ["driver-b"] },
    });
    await descriptor("widget", { dependsOn: ["driver-b"] });
    await descriptor("driver-b", { conflictsWith: ["driver-a"] });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(1);
    expect(output).toContain("module conflict");
    expect(output).toContain("driver-a");
    expect(output).toContain("saasaloy remove driver-a");
    // Refused before anything landed: the lock still records only what was installed.
    const lock = JSON.parse(
      await readFile(join(project, "saasaloy-lock.json"), "utf-8")
    ) as { modules: Record<string, unknown> };
    expect(Object.keys(lock.modules).toSorted()).toStrictEqual([
      "driver-a",
      "widget",
    ]);
  });

  it("lets a non-conflicting update through", async () => {
    await state(["widget", "driver-a"], {
      widget: localEntry,
      "driver-a": { ...localEntry, conflictsWith: ["driver-b"] },
    });
    await descriptor("widget", {});

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).not.toContain("module conflict");
  });

  it("names the env vars the new version requires before applying", async () => {
    await state(["widget"], { widget: localEntry });
    await descriptor("widget", {
      envVars: { WIDGET_TOKEN: "Signs widget callbacks" },
    });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).toContain("WIDGET_TOKEN");
    expect(output).toContain("Signs widget callbacks");
  });
});
