// Tests for the in-process provider: the inline run, the step and sleep recording, the
// `failed` list, and the schedule tick behind `runDue`. It ships as `memory.test.ts`
// beside the provider when testing is on, and `pnpm test:modules` runs it in place in the
// saasaloy repo.
//
// Nothing here is stubbed. `../index` resolves by its project path to the real
// `packages/queue` barrel, so every assertion below goes through the same job lookup,
// validation and error normalization a deployed Worker uses.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The barrel is imported before the provider on purpose. In a project the barrel registers
// this provider, so the two files import each other, and only this order lets the provider
// finish loading before the barrel calls it.
import { createQueue, defineJob, defineSchedule, queue } from "../index";
import { memory } from "./memory";
import { QueueError } from "../provider";

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

// The tables the project registered. A project's modules add jobs and schedules of their
// own, so each test starts from empty tables and gets the project's back afterwards.
let projectJobs: typeof queue.jobs = [];
let projectSchedules: typeof queue.schedules = [];
let warnings: string[] = [];
let errors: string[] = [];
const realWarn = console.warn;
const realError = console.error;

describe("memory queue provider", () => {
  beforeEach(() => {
    projectJobs = queue.jobs.splice(0);
    projectSchedules = queue.schedules.splice(0);
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
    queue.jobs.splice(0, queue.jobs.length, ...projectJobs);
    queue.schedules.splice(0, queue.schedules.length, ...projectSchedules);
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
      expect(client.provider).toBe("memory");
      await client.enqueue("inline", { message: "hello" });

      expect(seen).toStrictEqual({ message: "hello" });
      expect(provider.ran).toHaveLength(1);
      const [run] = provider.ran;
      expect({ job: run?.job, payload: run?.payload }).toStrictEqual({
        job: "inline",
        payload: { message: "hello" },
      });
      expect(provider.failed).toHaveLength(0);
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

      expect(provider.steps).toStrictEqual(["load", "send"]);
      expect(provider.sleeps).toStrictEqual([30, 5]);
      expect(provider.ran[0]?.steps).toStrictEqual(["load", "send"]);
    });

    it("returns from a sleep at once rather than waiting it out", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("slow", (_payload, ctx) => ctx.sleep(3600));

      const started = Date.now();
      await createQueue(ENV).enqueue("slow");

      expect(Date.now() - started < 1000).toBeTruthy();
      expect(provider.sleeps).toStrictEqual([3600]);
    });

    it("records delaySeconds instead of holding the caller", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("delayed", noop);

      const started = Date.now();
      await createQueue(ENV).enqueue("delayed", undefined, {
        delaySeconds: 600,
      });

      expect(Date.now() - started < 1000).toBeTruthy();
      expect(provider.ran[0]?.delaySeconds).toBe(600);
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

      expect(provider.failed).toHaveLength(1);
      const [failure] = provider.failed;
      expect({
        code: failure?.error.code,
        job: failure?.job,
        payload: failure?.payload,
        retryable: failure?.error.retryable,
        steps: failure?.steps,
      }).toStrictEqual({
        code: "provider_error",
        job: "boom",
        payload: { id: 1 },
        retryable: false,
        steps: ["try"],
      });
      expect(failure?.error.message ?? "").toMatch(/upstream is down/);
      expect(provider.ran).toHaveLength(1);
      expect(errors).toHaveLength(1);
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

      expect(provider.failed[0]?.error).toBe(thrown);
      expect(provider.failed[0]?.error.retryable).toBeTruthy();
      expect(provider.failed[0]?.error.providerCode).toBe("429");
    });

    it("re-throws at the call site when `rethrow` is on", async () => {
      const provider = memory({ rethrow: true });
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("boom", () => {
        throw new Error("nope");
      });

      await expect(() => createQueue(ENV).enqueue("boom")).rejects.toThrow(
        expect.toSatisfy((error: unknown) => error instanceof QueueError)
      );
      expect(provider.failed).toHaveLength(1);
    });

    it("warns about a durable job but still runs and records its steps", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("resumable", (_payload, ctx) => ctx.step("one", noop), true);

      await createQueue(ENV).enqueue("resumable");

      expect(warnings).toHaveLength(1);
      expect(warnings[0] ?? "").toMatch(/checkpoints nothing/);
      expect(provider.steps).toStrictEqual(["one"]);
      expect(provider.failed).toHaveLength(0);
    });

    it("leaves the core's own errors alone", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      await expect(() =>
        createQueue(ENV).enqueue("not-registered")
      ).rejects.toThrow(
        expect.toSatisfy(
          (error: unknown) =>
            error instanceof QueueError && error.code === "unknown_job"
        )
      );
      expect(provider.ran).toHaveLength(0);
    });

    it("reset() clears every recording", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("once", (_payload, ctx) => ctx.step("a", noop));
      await createQueue(ENV).enqueue("once");
      expect(provider.ran).toHaveLength(1);

      provider.reset();

      expect(provider.ran).toStrictEqual([]);
      expect(provider.failed).toStrictEqual([]);
      expect(provider.steps).toStrictEqual([]);
      expect(provider.scheduled).toStrictEqual([]);
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

      const fired = await provider.runDue(
        new Date("2026-09-08T02:00:30Z"),
        ENV
      );

      expect(fired.map((tick) => tick.schedule)).toStrictEqual([
        "nightly-at-two",
        "every-hour",
      ]);
      expect(provider.ran.map((run) => run.job)).toStrictEqual([
        "nightly",
        "hourly",
      ]);

      provider.reset();
      await provider.runDue(new Date("2026-09-08T03:00:00Z"), ENV);
      expect(provider.ran.map((run) => run.job)).toStrictEqual(["hourly"]);
    });

    it("enqueues nothing when no schedule is due", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("nightly", noop);
      withSchedule("nightly-at-two", "0 2 * * *", "nightly");

      await expect(
        provider.runDue(new Date("2026-09-08T03:00:00Z"))
      ).resolves.toStrictEqual([]);
      expect(provider.scheduled).toStrictEqual([]);
      expect(provider.ran).toHaveLength(0);
    });

    it("selects this provider when no env is passed", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("tick", noop);
      withSchedule("every-minute", "* * * * *", "tick");

      await provider.runDue(new Date("2026-09-08T04:05:00Z"));

      expect(provider.ran.map((run) => run.job)).toStrictEqual(["tick"]);
    });

    it("keeps ticking when one schedule names a job that is gone", async () => {
      const provider = memory();
      queue.providers.length = 0;
      queue.providers.push(provider);

      withJob("survivor", noop);
      withSchedule("orphan", "* * * * *", "deleted-job");
      withSchedule("kept", "* * * * *", "survivor");

      await provider.runDue(new Date("2026-09-08T04:05:00Z"), ENV);

      expect(provider.scheduled.map((tick) => tick.schedule)).toStrictEqual([
        "orphan",
        "kept",
      ]);
      expect(provider.ran.map((run) => run.job)).toStrictEqual(["survivor"]);
      expect(errors).toHaveLength(1);
      expect(errors[0] ?? "").toMatch(/orphan/);
    });
  });
});
