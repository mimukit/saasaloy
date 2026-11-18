import { defineSection } from "@repo/config/define";

// `feature-flags`'s config section. Read it as `config["feature-flags"]`: the key is the
// module name, and a hyphen in a key needs the bracket form.
//
// `isolateTtlSeconds` was the `FLAGS_ISOLATE_TTL_SECONDS` env var until #162. Two
// deployments of one project trade KV reads against toggle latency the same way, so it is
// checked in here. Change it in `packages/config/src/project.ts`.

/** The `feature-flags` section. Override it in `packages/config/src/project.ts`. */
export function featureFlagsConfig() {
  return defineSection("feature-flags", {
    /**
     * Seconds a Worker isolate serves its cached copy of a flag document before it reads
     * the document from kv again. `0` skips the isolate cache.
     *
     * What a change costs: at 10 a warm isolate reads about 8,640 times a day, and a toggle
     * reaches every location in about 70 seconds once Workers KV's own propagation is
     * added. Raise it and you spend fewer KV reads, but every toggle, kill switch and
     * maintenance flag takes that much longer to land. Drop it to `0` and each request
     * pays one KV read, which counts against the free plan's 100,000 daily reads. A whole
     * number of seconds.
     */
    isolateTtlSeconds: 10,
  });
}
