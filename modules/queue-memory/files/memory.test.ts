// Tests for the in-process provider: the inline run, the step and sleep recording, the
// `failed` list, and the schedule tick behind `runDue`. Like the core's tests this file
// is repo-only — the descriptor ships `memory.ts` and nothing else — and it runs on
// `node:test` via `pnpm test:modules`.
//
// Nothing here is stubbed. `../index` resolves through the shim beside this module to
// the real `packages/queue` barrel, so every assertion below goes through the same job
// lookup, validation and error normalization a deployed Worker uses.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { memory } from "./memory.ts";
import { createQueue, defineJob, defineSchedule, queue } from "../index.ts";
import { QueueError } from "../provider.ts";

const ENV = { QUEUE_PROVIDER: "memory" };

/** A handler, or a step, that does nothing. Its running at all is the assertion. */
function noop(): void {
  // deliberately empty
}

/** Register a job on the live table for one test; `restore` takes it back out. */
function withJob(
  name: string,
  handler: Parameters<typeof defineJob>[0]["handler"],
  durable = false
): void {
  queue.jobs.push(defineJob({ durable, handler, name }));
}

function withSchedule(name: string, cron: string, job: string): void {
  queue.schedules.push(defineSchedule({ cron, job, name }));
}

let jobCount = 0;
let scheduleCount = 0;
let warnings: string[] = [];
let errors: string[] = [];
const realWarn = console.warn;
const realError = console.error;

beforeEach(() => {
  jobCount = queue.jobs.length;
  scheduleCount = queue.schedules.length;
  warnings = [];
  errors = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  queue.jobs.length = jobCount;
  queue.schedules.length = scheduleCount;
  queue.providers.length = 0;
  console.warn = realWarn;
  console.error = realError;
});

describe("memory() — the inline run", () => {
  it("is selected by QUEUE_PROVIDER=memory and runs the job at once", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    let seen: unknown;
    withJob("inline", (payload) => {
      seen = payload;
    });

    const client = createQueue(ENV);
    assert.equal(client.provider, "memory");
    await client.enqueue("inline", { message: "hello" });

    assert.deepEqual(seen, { message: "hello" });
    assert.equal(provider.ran.length, 1);
    assert.equal(provider.ran[0]?.job, "inline");
    assert.deepEqual(provider.ran[0]?.payload, { message: "hello" });
    assert.equal(provider.failed.length, 0);
  });

  it("records step names and sleep durations in order", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("durable-ish", async (_payload, ctx) => {
      await ctx.step("load", () => 1);
      await ctx.sleep(30);
      await ctx.step("send", () => 2);
      await ctx.sleep(5);
    });

    await createQueue(ENV).enqueue("durable-ish");

    assert.deepEqual(provider.steps, ["load", "send"]);
    assert.deepEqual(provider.sleeps, [30, 5]);
    assert.deepEqual(provider.ran[0]?.steps, ["load", "send"]);
  });

  it("returns from a sleep at once rather than waiting it out", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("slow", (_payload, ctx) => ctx.sleep(3600));

    const started = Date.now();
    await createQueue(ENV).enqueue("slow");

    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(provider.sleeps, [3600]);
  });

  it("records delaySeconds instead of holding the caller", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("delayed", noop);

    const started = Date.now();
    await createQueue(ENV).enqueue("delayed", undefined, { delaySeconds: 600 });

    assert.ok(Date.now() - started < 1000);
    assert.equal(provider.ran[0]?.delaySeconds, 600);
  });

  it("keeps a failed job in `failed` and does not throw at the call site", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("boom", async (_payload, ctx) => {
      await ctx.step("try", noop);
      throw new Error("upstream is down");
    });

    await createQueue(ENV).enqueue("boom", { id: 1 });

    assert.equal(provider.failed.length, 1);
    const failure = provider.failed[0];
    assert.equal(failure?.job, "boom");
    assert.deepEqual(failure?.payload, { id: 1 });
    assert.deepEqual(failure?.steps, ["try"]);
    assert.equal(failure?.error.code, "provider_error");
    assert.equal(failure?.error.retryable, false);
    assert.match(failure?.error.message ?? "", /upstream is down/);
    assert.equal(provider.ran.length, 1);
    assert.equal(errors.length, 1);
  });

  it("keeps a QueueError the handler threw exactly as it was thrown", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    const thrown = new QueueError("rate_limited", "slow down", {
      providerCode: "429",
      retryable: true,
    });
    withJob("limited", () => {
      throw thrown;
    });

    await createQueue(ENV).enqueue("limited");

    assert.equal(provider.failed[0]?.error, thrown);
    assert.equal(provider.failed[0]?.error.retryable, true);
    assert.equal(provider.failed[0]?.error.providerCode, "429");
  });

  it("re-throws at the call site when `rethrow` is on", async () => {
    const provider = memory({ rethrow: true });
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("boom", () => {
      throw new Error("nope");
    });

    await assert.rejects(
      () => createQueue(ENV).enqueue("boom"),
      (error: unknown) => error instanceof QueueError
    );
    assert.equal(provider.failed.length, 1);
  });

  it("warns about a durable job but still runs and records its steps", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("resumable", (_payload, ctx) => ctx.step("one", noop), true);

    await createQueue(ENV).enqueue("resumable");

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /checkpoints nothing/);
    assert.deepEqual(provider.steps, ["one"]);
    assert.equal(provider.failed.length, 0);
  });

  it("leaves the core's own errors alone", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    await assert.rejects(
      () => createQueue(ENV).enqueue("not-registered"),
      (error: unknown) =>
        error instanceof QueueError && error.code === "unknown_job"
    );
    assert.equal(provider.ran.length, 0);
  });

  it("reset() clears every recording", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("once", (_payload, ctx) => ctx.step("a", noop));
    await createQueue(ENV).enqueue("once");
    assert.equal(provider.ran.length, 1);

    provider.reset();

    assert.deepEqual(provider.ran, []);
    assert.deepEqual(provider.failed, []);
    assert.deepEqual(provider.steps, []);
    assert.deepEqual(provider.scheduled, []);
  });
});

describe("memory() — runDue", () => {
  it("runs only the schedules matching that minute, and records them", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("nightly", noop);
    withJob("hourly", noop);
    withSchedule("nightly-at-two", "0 2 * * *", "nightly");
    withSchedule("every-hour", "0 * * * *", "hourly");

    const fired = await provider.runDue(new Date("2026-09-08T02:00:30Z"), ENV);

    assert.deepEqual(
      fired.map((tick) => tick.schedule),
      ["nightly-at-two", "every-hour"]
    );
    assert.deepEqual(
      provider.ran.map((run) => run.job),
      ["nightly", "hourly"]
    );

    provider.reset();
    await provider.runDue(new Date("2026-09-08T03:00:00Z"), ENV);
    assert.deepEqual(
      provider.ran.map((run) => run.job),
      ["hourly"]
    );
  });

  it("enqueues nothing when no schedule is due", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("nightly", noop);
    withSchedule("nightly-at-two", "0 2 * * *", "nightly");

    assert.deepEqual(
      await provider.runDue(new Date("2026-09-08T03:00:00Z")),
      []
    );
    assert.deepEqual(provider.scheduled, []);
    assert.equal(provider.ran.length, 0);
  });

  it("selects this provider when no env is passed", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("tick", noop);
    withSchedule("every-minute", "* * * * *", "tick");

    await provider.runDue(new Date("2026-09-08T04:05:00Z"));

    assert.deepEqual(
      provider.ran.map((run) => run.job),
      ["tick"]
    );
  });

  it("keeps ticking when one schedule names a job that is gone", async () => {
    const provider = memory();
    queue.providers.length = 0;
    queue.providers.push(provider);

    withJob("survivor", noop);
    withSchedule("orphan", "* * * * *", "deleted-job");
    withSchedule("kept", "* * * * *", "survivor");

    await provider.runDue(new Date("2026-09-08T04:05:00Z"), ENV);

    assert.deepEqual(
      provider.scheduled.map((tick) => tick.schedule),
      ["orphan", "kept"]
    );
    assert.deepEqual(
      provider.ran.map((run) => run.job),
      ["survivor"]
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /orphan/);
  });
});
