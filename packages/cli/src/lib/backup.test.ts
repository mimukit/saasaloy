import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_DIR,
  listBackups,
  readBackupRecord,
  restoreLatestBackup,
  writeBackup,
} from "./backup.js";
import { pathExists } from "./fs-utils.js";

// The undo path (#144): a run that overwrites owned files has to be reversible without
// git, because the projects this bug hit had no clean tree to fall back to.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-backup-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

describe(writeBackup, () => {
  it("copies what exists and records what does not", async () => {
    await write("AGENTS.md", "mine\n");
    await write("saasaloy.json", "{}\n");

    const rel = await writeBackup({
      root,
      targets: ["AGENTS.md", "apps/web/src/pages/404.astro"],
      cliVersion: "1.2.3",
    });

    expect(rel.startsWith(BACKUP_DIR)).toBeTruthy();
    const record = await readBackupRecord(
      root,
      rel.slice(BACKUP_DIR.length + 1)
    );
    expect(record.cliVersion).toBe("1.2.3");
    expect(record.files).toContain("AGENTS.md");
    expect(record.files).toContain("saasaloy.json");
    expect(record.absent).toContain("apps/web/src/pages/404.astro");
    await expect(readFile(join(root, rel, "AGENTS.md"), "utf-8")).resolves.toBe(
      "mine\n"
    );
  });
});

describe(restoreLatestBackup, () => {
  it("puts an overwritten file back and deletes one the run created", async () => {
    await write("AGENTS.md", "mine\n");
    await writeBackup({
      root,
      targets: ["AGENTS.md", "new.txt"],
      cliVersion: "1.2.3",
    });
    await write("AGENTS.md", "the template's\n");
    await write("new.txt", "created by the update\n");

    const result = await restoreLatestBackup(root);

    expect(result.restored).toContain("AGENTS.md");
    expect(result.removed).toStrictEqual(["new.txt"]);
    await expect(readFile(join(root, "AGENTS.md"), "utf-8")).resolves.toBe(
      "mine\n"
    );
    await expect(pathExists(join(root, "new.txt"))).resolves.toBeFalsy();
  });

  it("restores the newest of several backups", async () => {
    await write("a.txt", "one\n");
    await writeBackup({
      root,
      targets: ["a.txt"],
      cliVersion: "1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await write("a.txt", "two\n");
    await writeBackup({
      root,
      targets: ["a.txt"],
      cliVersion: "1",
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    await write("a.txt", "three\n");

    await expect(listBackups(root)).resolves.toHaveLength(2);
    await restoreLatestBackup(root);
    await expect(readFile(join(root, "a.txt"), "utf-8")).resolves.toBe("two\n");
  });

  it("refuses when there is nothing to restore", async () => {
    await expect(restoreLatestBackup(root)).rejects.toThrow(
      "No backup to restore"
    );
  });
});
