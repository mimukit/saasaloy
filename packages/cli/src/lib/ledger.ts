import { LOCK_FILE, saveLock } from "./lock.js";
import { saveManifest, MANIFEST_FILE } from "./manifest.js";
import { CONFIG_FILE, saveConfig } from "./saasaloy-config.js";
import type { Lockfile } from "./lock.js";
import type { Manifest } from "./manifest.js";
import type { LoadedConfig } from "./saasaloy-config.js";

// The ledger is the three files that record what Saasaloy wrote into a project:
// `.saasaloy/manifest.json`, `saasaloy.json` and `saasaloy-lock.json`. One rule governs
// all three — the ledger describes disk even after a throw (#49) — and this file is the
// only place `add`, `update` and `remove` write them, so the rule is stated once (#150).
//
// The record half lives in `manifest.ts`. This half only writes; it mutates nothing and
// it decides nothing about provenance. `add`'s guarded `upsertLock` stays in `add.ts`
// because a lock pin is a claim about a fetch, not a record of disk.

/** One save that threw, in ledger order. `file` is the project-relative path. */
export interface LedgerFailure {
  error: unknown;
  file: string;
}

export interface LedgerInput {
  config: LoadedConfig;
  lock: Lockfile;
  manifest: Manifest;
  root: string;
}

/**
 * Write the manifest, the config and the lock, and never throw (#150).
 *
 * The saves run in sequence and *every* save runs, even after an earlier one fails. That
 * is the `add` rule from #49, now the only rule: `update` used to run the three through
 * `Promise.allSettled` and `remove` used to let the first throw skip the other two, which
 * left exactly the partial ledger the rule exists to prevent.
 *
 * Nothing is printed here, and the failures are returned rather than thrown. The command
 * owns the wording and the exit code, because the apply error — when there is one — has
 * to win over a save error, and only the caller knows whether there is one.
 */
export async function persistLedger(
  input: LedgerInput
): Promise<LedgerFailure[]> {
  const saves: [string, () => Promise<void>][] = [
    [MANIFEST_FILE, () => saveManifest(input.root, input.manifest)],
    [CONFIG_FILE, () => saveConfig(input.root, input.config)],
    [LOCK_FILE, () => saveLock(input.root, input.lock)],
  ];

  const failures: LedgerFailure[] = [];
  for (const [file, save] of saves) {
    try {
      await save();
    } catch (error) {
      failures.push({ error, file });
    }
  }
  return failures;
}
