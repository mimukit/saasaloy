// Tests for the vendor-blind half of packages/queue: provider selection, job lookup,
// payload validation and the wrapping that keeps one error shape at the boundary. Like
// ./cron.test.ts this file is repo-only — it is not in the descriptor's scaffold list —
// and it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineJob, defineQueue, defineSchedule } from "./define.ts";
import { QueueError } from "./provider.ts";
import type {
  EnqueueOptions,
  Job,
  QueueEnv,
  QueueProvider,
  StandardSchema,
} from "./provider.ts";

/** A handler that does nothing; these tests are about the machinery around it. */
function noop(): void {
  // Intentionally empty.
}

/** A provider that records what it was handed instead of sending it anywhere. */
function recorder(name = "memory") {
  const sent: { job: string; payload: unknown; options: EnqueueOptions }[] = [];
  const provider: QueueProvider = {
    enqueue(
      _env: QueueEnv,
      job: Job,
      payload: unknown,
      options: EnqueueOptions
    ) {
      sent.push({ job: job.name, options, payload });
      return Promise.resolve();
    },
    name,
  };
  return { provider, sent };
}

/** A hand-rolled Standard Schema, so the test needs no validation library either. */
const stringMessage: StandardSchema<{ message: string }> = {
  "~standard": {
    validate: (value: unknown) => {
      const ok =
        typeof value === "object" &&
        value !== null &&
        typeof (value as { message?: unknown }).message === "string";
      return ok
        ? { value: value as { message: string } }
        : {
            issues: [
              { message: "message must be a string", path: ["message"] },
            ],
          };
    },
    vendor: "test",
    version: 1,
  },
};

describe("createQueue — provider selection", () => {
  it("selects the provider QUEUE_PROVIDER names", () => {
    const a = recorder("memory");
    const b = recorder("cloudflare");
    const queue = defineQueue({
      jobs: [],
      providers: [a.provider, b.provider],
      schedules: [],
    });

    assert.equal(
      queue.create({ QUEUE_PROVIDER: "cloudflare" }).provider,
      "cloudflare"
    );
  });

  it("throws when QUEUE_PROVIDER is unset, rather than falling back to the only one", () => {
    const { provider } = recorder();
    const queue = defineQueue({
      jobs: [],
      providers: [provider],
      schedules: [],
    });

    assert.throws(
      () => queue.create({}),
      /QUEUE_PROVIDER is not set\..*Registered providers: memory\./s
    );
  });

  it("throws when QUEUE_PROVIDER names a provider that is not registered", () => {
    const { provider } = recorder();
    const queue = defineQueue({
      jobs: [],
      providers: [provider],
      schedules: [],
    });

    assert.throws(
      () => queue.create({ QUEUE_PROVIDER: "upstash" }),
      /QUEUE_PROVIDER is "upstash", which is not registered\./
    );
  });

  it("names the install command when nothing is registered at all", () => {
    const queue = defineQueue({ jobs: [], providers: [], schedules: [] });

    assert.throws(() => queue.create({}), /saasaloy add queue-memory/);
  });
});

describe("enqueue", () => {
  it("hands a validated payload to the provider", async () => {
    const { provider, sent } = recorder();
    const queue = defineQueue({
      jobs: [
        defineJob<{ message: string }>({
          handler: noop,
          name: "greet",
          schema: stringMessage,
        }),
      ],
      providers: [provider],
      schedules: [],
    });

    await queue
      .create({ QUEUE_PROVIDER: "memory" })
      .enqueue("greet", { message: "hi" }, { delaySeconds: 30 });

    assert.deepEqual(sent, [
      {
        job: "greet",
        options: { delaySeconds: 30 },
        payload: { message: "hi" },
      },
    ]);
  });

  it("raises unknown_job for a name nothing is registered under", async () => {
    const { provider, sent } = recorder();
    const queue = defineQueue({
      jobs: [],
      providers: [provider],
      schedules: [],
    });

    await assert.rejects(
      () => queue.create({ QUEUE_PROVIDER: "memory" }).enqueue("nope"),
      (error: unknown) =>
        error instanceof QueueError &&
        error.code === "unknown_job" &&
        error.retryable === false
    );
    assert.equal(sent.length, 0);
  });

  it("raises invalid_job before the provider is reached", async () => {
    const { provider, sent } = recorder();
    const queue = defineQueue({
      jobs: [
        defineJob<{ message: string }>({
          handler: noop,
          name: "greet",
          schema: stringMessage,
        }),
      ],
      providers: [provider],
      schedules: [],
    });

    await assert.rejects(
      () =>
        queue
          .create({ QUEUE_PROVIDER: "memory" })
          .enqueue("greet", { message: 42 }),
      (error: unknown) =>
        error instanceof QueueError &&
        error.code === "invalid_job" &&
        /message: message must be a string/.test(error.message)
    );
    assert.equal(sent.length, 0);
  });

  it("wraps a raw throw from a provider as provider_error, keeping the cause", async () => {
    const raw = new TypeError("fetch failed");
    const provider: QueueProvider = {
      enqueue: () => Promise.reject(raw),
      name: "memory",
    };
    const queue = defineQueue({
      jobs: [defineJob({ handler: noop, name: "greet" })],
      providers: [provider],
      schedules: [],
    });

    await assert.rejects(
      () => queue.create({ QUEUE_PROVIDER: "memory" }).enqueue("greet"),
      (error: unknown) =>
        error instanceof QueueError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === raw
    );
  });

  it("re-throws a QueueError a provider raised, untouched", async () => {
    const mapped = new QueueError("rate_limited", "slow down", {
      providerCode: "E_TOO_FAST",
      retryable: true,
    });
    const provider: QueueProvider = {
      enqueue: () => Promise.reject(mapped),
      name: "memory",
    };
    const queue = defineQueue({
      jobs: [defineJob({ handler: noop, name: "greet" })],
      providers: [provider],
      schedules: [],
    });

    await assert.rejects(
      () => queue.create({ QUEUE_PROVIDER: "memory" }).enqueue("greet"),
      (error: unknown) => error === mapped
    );
  });
});

describe("dispatch", () => {
  it("runs the registered handler with the payload and a context", async () => {
    const seen: { payload: unknown; attempt: number; steps: string[] }[] = [];
    const queue = defineQueue({
      jobs: [
        defineJob<{ message: string }>({
          handler: async (payload, ctx) => {
            const steps: string[] = [];
            await ctx.step("one", () => {
              steps.push("one");
            });
            await ctx.sleep(60);
            seen.push({ attempt: ctx.attempt, payload, steps });
          },
          name: "greet",
        }),
      ],
      providers: [],
      schedules: [],
    });

    await queue.dispatch("greet", { message: "hi" }, { attempt: 2 });

    assert.deepEqual(seen, [
      { attempt: 2, payload: { message: "hi" }, steps: ["one"] },
    ]);
  });

  it("defaults the context when a provider supplies none", async () => {
    let attempt = -1;
    const queue = defineQueue({
      jobs: [
        defineJob({
          handler: (_payload, ctx) => {
            attempt = ctx.attempt;
          },
          name: "greet",
        }),
      ],
      providers: [],
      schedules: [],
    });

    await queue.dispatch("greet", {});

    assert.equal(attempt, 0);
  });

  it("raises unknown_job for a message naming a job that is gone", async () => {
    const queue = defineQueue({ jobs: [], providers: [], schedules: [] });

    await assert.rejects(
      () => queue.dispatch("removed", {}),
      (error: unknown) =>
        error instanceof QueueError && error.code === "unknown_job"
    );
  });

  it("re-validates the payload on delivery", async () => {
    const queue = defineQueue({
      jobs: [
        defineJob<{ message: string }>({
          handler: noop,
          name: "greet",
          schema: stringMessage,
        }),
      ],
      providers: [],
      schedules: [],
    });

    await assert.rejects(
      () => queue.dispatch("greet", { message: 42 }),
      (error: unknown) =>
        error instanceof QueueError && error.code === "invalid_job"
    );
  });

  it("wraps a raw throw from a handler as provider_error", async () => {
    const raw = new Error("boom");
    const queue = defineQueue({
      jobs: [
        defineJob({
          handler: () => {
            throw raw;
          },
          name: "greet",
        }),
      ],
      providers: [],
      schedules: [],
    });

    await assert.rejects(
      () => queue.dispatch("greet", {}),
      (error: unknown) =>
        error instanceof QueueError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === raw
    );
  });
});

describe("schedules", () => {
  it("rejects a malformed cron expression at definition", () => {
    assert.throws(
      () => defineSchedule({ cron: "nope", job: "greet", name: "daily" }),
      (error: unknown) =>
        error instanceof QueueError && error.code === "invalid_job"
    );
  });

  it("returns only the schedules due at the tick", () => {
    const queue = defineQueue({
      jobs: [],
      providers: [],
      schedules: [
        defineSchedule({ cron: "0 2 * * *", job: "nightly", name: "nightly" }),
        defineSchedule({ cron: "*/5 * * * *", job: "poll", name: "poll" }),
      ],
    });

    const due = queue.dueSchedules(new Date(Date.UTC(2026, 8, 8, 2, 0)));

    assert.deepEqual(
      due.map((schedule) => schedule.name),
      ["nightly", "poll"]
    );
    assert.deepEqual(
      queue
        .dueSchedules(new Date(Date.UTC(2026, 8, 8, 2, 1)))
        .map((schedule) => schedule.name),
      []
    );
  });
});
