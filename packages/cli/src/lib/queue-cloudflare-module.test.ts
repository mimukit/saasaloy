import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Patch } from "./patch/index.js";
import { validateRegistryItem } from "./schema.js";

// `queue-cloudflare` is the first module to patch three files at once, two of them
// through a nested `bindingType` that has to create its parent object on the way in
// (`queues.producers`, `triggers.crons`). The property the whole install/remove contract
// rests on is that the way back out is exact: `saasaloy remove queue-cloudflare` must
// leave `wrangler.jsonc`, `worker.ts` and `packages/queue/src/index.ts` byte-identical to
// what the `api` and `queue` modules shipped.
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

/** The files each module ships before `queue-cloudflare` is added to a project. */
const PRISTINE: Record<string, string> = {
  "apps/api/wrangler.jsonc": repoFile("modules/api/files/wrangler.jsonc"),
  "apps/api/src/worker.ts": repoFile("modules/api/files/src/worker.ts"),
  "packages/queue/src/index.ts": repoFile("modules/queue/files/src/index.ts"),
};

interface Descriptor {
  name: string;
  type: string;
  dependsOn: string[];
  envVars: Record<string, string>;
  files: { path: string; target: string }[];
  scaffolds: unknown[];
  patches: (Patch & { file: string })[];
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
    const { patches } = await readDescriptor();

    expect(patches).toStrictEqual(
      expect.arrayContaining([
        {
          file: "packages/queue/src/index.ts",
          kind: "plugin-array",
          exportName: "queue",
          arrayProp: "providers",
          call: "cloudflare",
          import: { name: "cloudflare", from: "./providers/cloudflare" },
        },
        {
          file: "apps/api/src/worker.ts",
          kind: "plugin-array",
          exportName: "worker",
          arrayProp: "handlers",
          call: "cloudflareQueueHandlers",
          import: {
            name: "cloudflareQueueHandlers",
            from: "@repo/queue/providers/cloudflare",
          },
        },
      ])
    );
  });

  it("touches only files the api and queue modules ship", async () => {
    const { patches } = await readDescriptor();

    expect(
      [...new Set(patches.map((patch) => patch.file))].toSorted()
    ).toStrictEqual(Object.keys(PRISTINE).toSorted());
  });
});
