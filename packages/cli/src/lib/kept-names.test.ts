import { describe, expect, it } from "vitest";
import { keepRecordedPatch, keepWorkerName } from "./kept-names.js";
import type { ManifestPatch } from "./manifest.js";
import type { RegistryPatch } from "./schema.js";

// A project that installed a module before `{{PROJECT_NAME}}` existed keeps the live names
// in its files (#197): `update` must not rename its Worker or point it at a new queue.

const consumer = (queue: string, dlq: string): RegistryPatch => ({
  file: "apps/api/wrangler.jsonc",
  kind: "wrangler-binding",
  bindingType: "queues.consumers",
  entry: { queue, max_retries: 3, dead_letter_queue: dlq },
  matchOn: "queue",
});

const record = (patch: RegistryPatch): ManifestPatch => ({
  file: patch.file,
  module: "queue-cloudflare",
  patch,
});

describe(keepWorkerName, () => {
  const mine = '{\n  "name": "api",\n  // kept\n  "main": "src/worker.ts"\n}\n';
  const theirs = '{\n  "name": "alpha-api",\n  "main": "src/worker.ts"\n}\n';

  it("compares as the new name and writes the project's own", () => {
    const { compared, written } = keepWorkerName(
      "apps/api/wrangler.jsonc",
      mine,
      theirs
    );
    expect(compared).toBe(mine.replace('"api"', '"alpha-api"'));
    expect(written).toBe(theirs.replace('"alpha-api"', '"api"'));
  });

  it("passes a file that is not a wrangler config through", () => {
    expect(keepWorkerName("apps/api/package.json", mine, theirs)).toStrictEqual(
      { compared: mine, written: theirs }
    );
  });

  it("passes a file the project does not hold yet through", () => {
    expect(
      keepWorkerName("apps/api/wrangler.jsonc", undefined, theirs)
    ).toStrictEqual({ compared: undefined, written: theirs });
  });
});

describe(keepRecordedPatch, () => {
  const raw = consumer("{{PROJECT_NAME}}-jobs", "{{PROJECT_NAME}}-jobs-dlq");
  const rendered = consumer("alpha-jobs", "alpha-jobs-dlq");

  it("keeps the recorded entry when only the templated values differ", () => {
    const old = consumer("app-jobs", "app-jobs-dlq");
    expect(keepRecordedPatch(raw, rendered, [record(old)])).toBe(old);
  });

  it("matches an old name that had no prefix at all", () => {
    const rawName: RegistryPatch = {
      file: "packages/x.jsonc",
      kind: "wrangler-binding",
      bindingType: "services",
      entry: { binding: "API", service: "{{PROJECT_NAME}}-api" },
    };
    const old: RegistryPatch = {
      ...rawName,
      entry: { binding: "API", service: "api" },
    };
    expect(keepRecordedPatch(rawName, rawName, [record(old)])).toBe(old);
  });

  it("ships the rendered entry when a value without the token changed", () => {
    const old: RegistryPatch = {
      file: "apps/api/wrangler.jsonc",
      kind: "wrangler-binding",
      bindingType: "queues.consumers",
      entry: {
        queue: "app-jobs",
        max_retries: 5,
        dead_letter_queue: "app-jobs-dlq",
      },
      matchOn: "queue",
    };
    expect(keepRecordedPatch(raw, rendered, [record(old)])).toBe(rendered);
  });

  it("ships the rendered entry when nothing is recorded", () => {
    expect(keepRecordedPatch(raw, rendered, [])).toBe(rendered);
  });

  it("never swaps an op that carries no token", () => {
    const plain = consumer("jobs", "jobs-dlq");
    const old = consumer("other", "other-dlq");
    expect(keepRecordedPatch(plain, plain, [record(old)])).toBe(plain);
  });
});
