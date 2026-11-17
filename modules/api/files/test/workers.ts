import { readFileSync } from "node:fs";
import os from "node:os";

// How many Vitest workers the api's tests run on. `../vitest.config.ts` sets the answer as
// `maxWorkers`, and the installed database driver reads it back in its global setup: on
// Postgres each worker gets a copy of the seeded test database and holds one connection to
// it. See the driver's skill, "Route tests".
//
// The count is half the CPUs, bounded by memory and capped at 4:
//
//   max(1, min(floor(cpus / 2), floor((memory - 2 GiB) / 1 GiB), 4))
//
// - Half the CPUs leaves the other half to the database server and to the rest of the run.
// - Each worker needs about 1 GiB, after 2 GiB kept back for the database and the system.
// - The cap of 4 protects a Postgres server that other projects share.
//
// `API_TEST_WORKERS` overrides it. `API_TEST_WORKERS=1` runs the files one at a time on the
// test database itself, with no copies.

const GIB = 1024 ** 3;

/** Memory kept back for the database server and the system, before any worker counts. */
const RESERVE = 2 * GIB;

/** Memory one worker needs. */
const PER_WORKER = GIB;

/** At most this many workers, whatever the box offers. */
const CAP = 4;

/** cgroup v2's memory limit for this process's group: a byte count, or `max` for none. */
const CGROUP_MEMORY_MAX = "/sys/fs/cgroup/memory.max";

export interface WorkerInputs {
  /** CPUs this process may use, from `os.availableParallelism()`. */
  cpus: number;
  /** Bytes of memory this process may use. */
  memory: number;
  /** `API_TEST_WORKERS`, when set. */
  override?: string;
}

/** The worker count for `inputs`. An override that is not a whole number from 1 is ignored. */
export function testWorkers({ cpus, memory, override }: WorkerInputs): number {
  if (override !== undefined && /^\d+$/.test(override.trim())) {
    const count = Number(override.trim());
    if (count >= 1) {
      return count;
    }
  }
  const byCpu = Math.floor(cpus / 2);
  const byMemory = Math.floor((memory - RESERVE) / PER_WORKER);
  return Math.max(1, Math.min(byCpu, byMemory, CAP));
}

/**
 * The cgroup v2 memory limit in bytes, or `undefined` outside a limited group. A container's
 * `os.totalmem()` reports the host's memory and ignores the limit.
 */
function cgroupMemoryLimit(): number | undefined {
  try {
    const value = readFileSync(CGROUP_MEMORY_MAX, "utf-8").trim();
    const bytes = Number(value);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** The worker count for this machine and this environment. */
export function apiTestWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const limit = cgroupMemoryLimit();
  return testWorkers({
    cpus: os.availableParallelism(),
    memory:
      limit === undefined ? os.totalmem() : Math.min(os.totalmem(), limit),
    override: env.API_TEST_WORKERS,
  });
}
