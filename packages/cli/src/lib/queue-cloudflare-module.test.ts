import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Patch } from "./patch/index.js";
import { validateRegistryItem } from "./schema.js";
import type { RegistryEntry } from "./schema.js";

// `queue-cloudflare` patches `wrangler.jsonc` through a nested `bindingType` that has to
// create its parent object on the way in (`queues.producers`, `triggers.crons`), and adds
// a row to two generated tables: the queue's providers and the Worker's handlers. The
// property the whole install/remove contract rests on is that the way back out is exact:
// `saasaloy remove queue-cloudflare` is a render without it, so `wrangler.jsonc` comes
// back byte-identical to what the `api` module shipped.
//
// These tests drive the real descriptor against the real shipped files, not a fixture, so
// an edit to either side that breaks the round trip fails here rather than in a user's
// repository. A `queues: {}` left behind, a stray import, a lost comment or a changed
// indent all show up as a string inequality.

const repoRoot = new URL("../../../../", import.meta.url);

function repoFile(path: string): string {
  return fileURLToPath(new URL(path, repoRoot));
}

const DESCRIPTOR = repoFile("modules/queue-cloudflare/registry-item.json");

/** The files `queue-cloudflare` patches, as the `api` module ships them. */
const PRISTINE: Record<string, string> = {
  "apps/api/wrangler.jsonc": repoFile("modules/api/files/wrangler.jsonc"),
};

interface Descriptor {
  name: string;
  type: string;
  dependsOn: string[];
  envVars: Record<string, string>;
  files: { path: string; target: string }[];
  scaffolds: unknown[];
  patches: (Patch & { file: string })[];
  entries: RegistryEntry[];
}

async function readDescriptor(): Promise<Descriptor> {
  return JSON.parse(await readFile(DESCRIPTOR, "utf-8")) as Descriptor;
}

describe("queue-cloudflare descriptor", () => {
  it("is a valid provider module: one file, into the capability's providers folder", async () => {
    const descriptor = await readDescriptor();

    await expect(
      validateRegistryItem(descriptor as unknown as Record<string, unknown>)
    ).resolves.toMatchObject({ valid: true });
    expect(descriptor.name).toBe("queue-cloudflare");
    expect(descriptor.type).toBe("saasaloy:feature");
    expect(descriptor.dependsOn).toStrictEqual(["queue"]);
    expect(descriptor.scaffolds).toStrictEqual([]);
    // The binding *is* the credential, so a provider that reads only bindings declares
    // no secret of its own. `QUEUE_PROVIDER` belongs to the capability.
    expect(descriptor.envVars).toStrictEqual({});
    expect(descriptor.files).toStrictEqual([
      { path: "files/cloudflare.ts", target: "@queue/providers/cloudflare.ts" },
    ]);
  });

  it("declares the two producers, the consumer's knobs, and the every-minute tick", async () => {
    const { patches } = await readDescriptor();
    const wrangler = patches.filter(
      (patch) => patch.file === "apps/api/wrangler.jsonc"
    );

    expect(wrangler).toStrictEqual([
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding",
        bindingType: "queues.producers",
        entry: { binding: "JOBS", queue: "{{PROJECT_NAME}}-jobs" },
      },
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding",
        bindingType: "queues.producers",
        entry: { binding: "JOBS_DLQ", queue: "{{PROJECT_NAME}}-jobs-dlq" },
      },
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding",
        bindingType: "queues.consumers",
        entry: {
          queue: "{{PROJECT_NAME}}-jobs",
          max_batch_size: 10,
          max_batch_timeout: 5,
          max_retries: 3,
          dead_letter_queue: "{{PROJECT_NAME}}-jobs-dlq",
        },
        matchOn: "queue",
      },
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding",
        bindingType: "triggers.crons",
        entry: "* * * * *",
      },
    ]);
  });

  it("registers itself with the capability and the Worker's handler table", async () => {
    const { entries } = await readDescriptor();

    expect(entries).toStrictEqual([
      {
        table: "queue.providers",
        call: "cloudflare",
        import: { name: "cloudflare", from: "./providers/cloudflare" },
      },
      {
        table: "worker.handlers",
        call: "cloudflareQueueHandlers",
        import: {
          name: "cloudflareQueueHandlers",
          from: "@repo/queue/providers/cloudflare",
        },
      },
    ]);
  });

  it("patches only the file the api module ships", async () => {
    const { patches } = await readDescriptor();

    expect(
      [...new Set(patches.map((patch) => patch.file))].toSorted()
    ).toStrictEqual(Object.keys(PRISTINE).toSorted());
  });
});
