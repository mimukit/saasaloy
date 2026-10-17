import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatFiles, formatReport, prettierBin } from "./format.js";
import type { Runner } from "./format.js";

// The runner is injected, so these tests never start a real Prettier. What they pin is
// the contract the three commands rely on: which files reach Prettier, with which flags,
// and that no outcome throws.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-format-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function installPrettier(): Promise<void> {
  const bin = prettierBin(root);
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, "");
}

function recorder(result: Awaited<ReturnType<Runner>>) {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const run: Runner = (command, args, cwd) => {
    calls.push({ args, command, cwd });
    return Promise.resolve(result);
  };
  return { calls, run };
}

describe(formatFiles, () => {
  it("runs nothing when no file was patched", async () => {
    const { calls, run } = recorder({ ok: true });
    await installPrettier();
    await expect(formatFiles(root, [], run)).resolves.toStrictEqual({
      kind: "nothing",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports no-prettier before the first install", async () => {
    const { calls, run } = recorder({ ok: true });
    await expect(
      formatFiles(root, ["apps/api/src/index.ts"], run)
    ).resolves.toStrictEqual({
      files: ["apps/api/src/index.ts"],
      kind: "no-prettier",
    });
    expect(calls).toHaveLength(0);
  });

  it("runs the project's Prettier once over each file, from the root", async () => {
    const { calls, run } = recorder({ ok: true });
    await installPrettier();
    const outcome = formatFiles(
      root,
      [
        "packages/kv/src/index.ts",
        "apps/api/src/env.ts",
        "apps/api/src/env.ts",
      ],
      run
    );
    await expect(outcome).resolves.toStrictEqual({
      files: ["packages/kv/src/index.ts", "apps/api/src/env.ts"],
      kind: "formatted",
    });
    expect(calls).toStrictEqual([
      {
        args: [
          "--write",
          "--ignore-unknown",
          "--log-level",
          "warn",
          "--",
          "packages/kv/src/index.ts",
          "apps/api/src/env.ts",
        ],
        command: prettierBin(root),
        cwd: root,
      },
    ]);
  });

  it("returns a failure instead of throwing", async () => {
    const { run } = recorder({ message: "SyntaxError: x", ok: false });
    await installPrettier();
    await expect(formatFiles(root, ["a.ts"], run)).resolves.toStrictEqual({
      files: ["a.ts"],
      kind: "failed",
      message: "SyntaxError: x",
    });
  });
});

describe(formatReport, () => {
  it("says nothing when nothing was patched", () => {
    expect(formatReport({ kind: "nothing" })).toBeNull();
  });

  it("counts the files it formatted", () => {
    expect(formatReport({ files: ["a.ts"], kind: "formatted" })).toStrictEqual({
      level: "step",
      message: "format  1 patched file with Prettier",
    });
    expect(
      formatReport({ files: ["a.ts", "b.ts"], kind: "formatted" })?.message
    ).toBe("format  2 patched files with Prettier");
  });

  it("points at pnpm format when Prettier is missing or fails", () => {
    expect(
      formatReport({ files: ["a.ts"], kind: "no-prettier" })
    ).toMatchObject({ level: "info" });
    const failed = formatReport({
      files: ["a.ts"],
      kind: "failed",
      message: "boom",
    });
    expect(failed?.level).toBe("warn");
    expect(failed?.message).toContain("pnpm format");
    expect(failed?.message).toContain("boom");
  });
});
