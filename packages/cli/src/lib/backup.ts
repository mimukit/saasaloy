import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm as rmPath,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { RefusalError } from "./exit.js";
import { pathExists, readIfPresent, resolveWithinRoot } from "./fs-utils.js";

// The undo `saasaloy update` never had (#144 follow-up). Before the applier writes a
// single byte, every path the plan will touch is copied under
// `.saasaloy/backup-<timestamp>/`, together with the four state files the run rewrites.
// `saasaloy update --abort` puts the newest backup back.
//
// A path the plan will *create* has nothing to copy, so it is recorded as absent and the
// restore deletes it. That asymmetry is the whole reason the record is a file rather than
// a directory listing: a directory alone cannot say "this used to not exist".

/** Where backups live, relative to the project root. */
export const BACKUP_DIR = join(".saasaloy", "backups");

/** The record written beside the copied files. */
export interface BackupRecord {
  /** ISO timestamp, the same value the directory is named after. */
  createdAt: string;
  /** CLI version that took the backup, for the restore's one-line report. */
  cliVersion: string;
  /** Project-relative POSIX paths that existed and were copied. */
  files: string[];
  /** Project-relative POSIX paths the run was about to create — restored by deleting them. */
  absent: string[];
}

const RECORD_FILE = "backup.json";

/** State files every run rewrites; backed up alongside the plan's own targets. */
export const STATE_FILES = [
  "saasaloy.json",
  "saasaloy-lock.json",
  "package.json",
  join(".saasaloy", "manifest.json"),
];

/** A directory name that sorts chronologically and is legal on every platform. */
function stampName(now: Date): string {
  return now.toISOString().replaceAll(/[:.]/g, "-");
}

export interface WriteBackupArgs {
  root: string;
  /** Project-relative POSIX paths the plan will write or delete. */
  targets: readonly string[];
  cliVersion: string;
  now?: Date;
}

/**
 * Copy `targets` and the state files into a fresh backup directory. Returns the
 * project-relative directory, so the caller can name it in the summary — the user needs
 * to see the path to trust the `--abort` that follows.
 */
export async function writeBackup(args: WriteBackupArgs): Promise<string> {
  const { root, targets, cliVersion } = args;
  const createdAt = (args.now ?? new Date()).toISOString();
  const rel = join(BACKUP_DIR, stampName(args.now ?? new Date(createdAt)));
  const dir = join(root, rel);
  const files: string[] = [];
  const absent: string[] = [];

  for (const target of new Set([...targets, ...STATE_FILES])) {
    const source = resolveWithinRoot(root, target);
    if (!(await pathExists(source))) {
      absent.push(target);
      continue;
    }
    const destination = join(dir, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    files.push(target);
  }

  const record: BackupRecord = {
    createdAt,
    cliVersion,
    files: files.toSorted(),
    absent: absent.toSorted(),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, RECORD_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf-8"
  );
  return rel;
}

/** Backup directory names, newest last. */
export async function listBackups(root: string): Promise<string[]> {
  const dir = join(root, BACKUP_DIR);
  if (!(await pathExists(dir))) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

export interface RestoreResult {
  /** Project-relative directory the files came from. */
  from: string;
  restored: string[];
  /** Files the run had created and the restore removed. */
  removed: string[];
}

/**
 * Put the newest backup back: every copied file over its original path, and every path
 * the run created deleted. Refuses rather than guesses when there is nothing to restore
 * or the record is unreadable — a half-applied restore is worse than none.
 */
export async function restoreLatestBackup(
  root: string
): Promise<RestoreResult> {
  const backups = await listBackups(root);
  const newest = backups.at(-1);
  if (!newest) {
    throw new RefusalError(
      `No backup to restore — nothing under ${BACKUP_DIR}. \`saasaloy update\` writes one before it applies a plan.`
    );
  }
  const rel = join(BACKUP_DIR, newest);
  const dir = join(root, rel);
  const raw = await readIfPresent(join(dir, RECORD_FILE));
  if (raw === undefined) {
    throw new RefusalError(
      `${join(rel, RECORD_FILE)} is missing — that backup can't be restored safely.`
    );
  }
  let record: BackupRecord;
  try {
    record = JSON.parse(raw) as BackupRecord;
  } catch (error) {
    throw new RefusalError(`${join(rel, RECORD_FILE)} is invalid.`, {
      cause: error,
    });
  }

  const restored: string[] = [];
  for (const target of record.files) {
    const source = join(dir, target);
    const destination = resolveWithinRoot(root, target);
    if (!(await pathExists(source))) {
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    restored.push(target);
  }
  const removed: string[] = [];
  for (const target of record.absent) {
    const destination = resolveWithinRoot(root, target);
    if (await pathExists(destination)) {
      await rmPath(destination, { force: true });
      removed.push(target);
    }
  }
  return { from: rel, restored, removed };
}

/** Read a backup's record — the tests' way in, and the restore's own parser. */
export async function readBackupRecord(
  root: string,
  name: string
): Promise<BackupRecord> {
  const raw = await readFile(
    join(root, BACKUP_DIR, name, RECORD_FILE),
    "utf-8"
  );
  return JSON.parse(raw) as BackupRecord;
}
