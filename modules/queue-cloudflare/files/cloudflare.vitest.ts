// Tests for the Cloudflare provider: the producer's option passing and error mapping, the
// consumer's ack / retry / dead-letter split, and the cron tick. It ships as
// `cloudflare.test.ts` beside the provider when testing is on, and `pnpm test:modules`
// runs it in place in the saasaloy repo.
//
// The bindings are stubs, because the real ones exist only inside workerd. What is *not*
// stubbed is the capability core: `../index` resolves by its project path to the real
// `packages/queue` barrel, so a message goes through the same job lookup, validation and
// error normalization a deployed Worker uses.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The barrel is imported before the provider on purpose. In a project the barrel registers
// this provider, so the two files import each other, and only this order lets the provider
// finish loading before the barrel calls it.
import { defineJob, defineSchedule, queue } from "../index";
import { cloudflare, cloudflareQueueHandlers } from "./cloudflare";
import { QueueError } from "../provider";

/** A `Queue` binding that records instead of sending, or throws what it was given. */
function stubQueue(failWith?: unknown) {
  const sent: { body: unknown; options: unknown }[] = [];
  return {
    sent,
    send(body: unknown, options?: unknown) {
      if (failWith !== undefined) {
        return Promise.reject(failWith);
      }
      sent.push({ body, options });
      return Promise.resolve();
    },
  };
}

/** A `Message` that records how it was settled. */
function stubMessage(body: unknown, attempts = 1) {
  const settled: { acked: number; retries: unknown[] } = {
    acked: 0,
    retries: [],
  };
  return {
    ack() {
      settled.acked += 1;
    },
    attempts,
    body,
    id: "msg-1",
    retry(options?: unknown) {
      settled.retries.push(options);
    },
    settled,
    timestamp: new Date(0),
  };
}

/** Register a job on the live table for one test, and take it back out afterwards. */
function withJob(name: string, handler: () => void | Promise<void>): void {
  queue.jobs.push(defineJob({ handler, name }));
}

let warnings: string[] = [];
let errors: string[] = [];
const realWarn = console.warn;
const realError = console.error;

describe("cloudflare queue provider", () => {
  beforeEach(() => {
    warnings = [];
    errors = [];
    // What `saasaloy add queue-cloudflare`'s `plugin-array` patch writes into the barrel.
    // The repo copy of `packages/queue` ships the array empty, so a test registers it.
    queue.providers.push(cloudflare());
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.warn = realWarn;
    console.error = realError;
    // The tables are the module singleton; leave them as they were found — one job
    // (`example`), no schedules, no providers.
    queue.jobs.length = 1;
    queue.providers.length = 0;
    queue.schedules.length = 0;
  });

  describe("cloudflare() — the producer", () => {
    it("sends the job name and payload, and honours delaySeconds", async () => {
      const JOBS = stubQueue();
      const client = queue.create({ JOBS, QUEUE_PROVIDER: "cloudflare" });

      await client.enqueue("example", { message: "hi" }, { delaySeconds: 45 });

      expect(JOBS.sent).toStrictEqual([
        {
          body: { job: "example", payload: { message: "hi" } },
          options: { delaySeconds: 45 },
        },
      ]);
    });

    it("passes no options at all when no delay was asked for", async () => {
      const JOBS = stubQueue();
      const client = queue.create({ JOBS, QUEUE_PROVIDER: "cloudflare" });

      await client.enqueue("example", { message: "hi" });

      expect(JOBS.sent[0]?.options).toBeUndefined();
    });

    it("rejects a durable job and names the follow-up issue", async () => {
      const JOBS = stubQueue();
      const durable = defineJob({
        durable: true,
        handler: () => {},
        name: "d",
      });

      await expect(() =>
        cloudflare().enqueue({ JOBS }, durable, {}, {})
      ).rejects.toThrow(
        expect.toSatisfy((error: QueueError) => {
          expect(error).toBeInstanceOf(QueueError);
          expect(error.code).toBe("provider_error");
          expect(error.retryable).toBeFalsy();
          expect(error.message).toMatch(/#131/);
          return true;
        })
      );
      expect(JOBS.sent).toStrictEqual([]);
    });

    it("explains a missing binding instead of throwing a TypeError", async () => {
      await expect(() =>
        cloudflare().enqueue(
          {},
          defineJob({ handler: () => {}, name: "x" }),
          {},
          {}
        )
      ).rejects.toThrow(
        expect.toSatisfy((error: QueueError) => {
          expect(error).toBeInstanceOf(QueueError);
          expect(error.message).toMatch(/No `JOBS` Queues binding/);
          return true;
        })
      );
    });

    it("maps a Queues error onto a core code and keeps the raw one", async () => {
      const JOBS = stubQueue(
        Object.assign(new Error("too big"), { code: "QUEUE_MESSAGE_TOO_LARGE" })
      );

      await expect(() =>
        cloudflare().enqueue(
          { JOBS },
          defineJob({ handler: () => {}, name: "x" }),
          {},
          {}
        )
      ).rejects.toThrow(
        expect.toSatisfy((error: QueueError) => {
          expect(error).toBeInstanceOf(QueueError);
          expect(error.code).toBe("too_large");
          expect(error.providerCode).toBe("QUEUE_MESSAGE_TOO_LARGE");
          expect(error.retryable).toBeFalsy();
          return true;
        })
      );
    });

    it("treats a full queue as retryable and an unknown code as not", async () => {
      const full = stubQueue(
        Object.assign(new Error("backlog"), { code: "QUEUE_FULL" })
      );
      const job = defineJob({ handler: () => {}, name: "x" });
      await expect(() =>
        cloudflare().enqueue({ JOBS: full }, job, {}, {})
      ).rejects.toThrow(
        expect.toSatisfy((error: QueueError) => {
          expect(error).toBeInstanceOf(QueueError);
          expect(error.code).toBe("rate_limited");
          expect(error.retryable).toBeTruthy();
          return true;
        })
      );

      const odd = stubQueue(
        Object.assign(new Error("who knows"), { code: "E_SOMETHING_NEW" })
      );
      await expect(() =>
        cloudflare().enqueue({ JOBS: odd }, job, {}, {})
      ).rejects.toThrow(
        expect.toSatisfy((error: QueueError) => {
          expect(error).toBeInstanceOf(QueueError);
          expect(error.code).toBe("provider_error");
          expect(error.providerCode).toBe("E_SOMETHING_NEW");
          expect(error.retryable).toBeFalsy();
          return true;
        })
      );
    });
  });

  describe("cloudflareQueueHandlers() — the consumer", () => {
    const ctx = {} as never;

    it("warns and settles nothing when QUEUE_PROVIDER is not cloudflare", async () => {
      const message = stubMessage({
        job: "example",
        payload: { message: "x" },
      });

      await cloudflareQueueHandlers().queue(
        { messages: [message] } as never,
        { QUEUE_PROVIDER: "memory" },
        ctx
      );

      expect(message.settled.acked).toBe(0);
      expect(message.settled.retries).toStrictEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0] ?? "").toMatch(/QUEUE_PROVIDER is "memory"/);
    });

    it("warns when QUEUE_PROVIDER is unset", async () => {
      await cloudflareQueueHandlers().queue({ messages: [] } as never, {}, ctx);

      expect(warnings[0] ?? "").toMatch(/QUEUE_PROVIDER is unset/);
    });

    it("dispatches through the core and acks on success", async () => {
      const ran: number[] = [];
      withJob("ok", () => {
        ran.push(1);
      });
      const message = stubMessage({ job: "ok", payload: undefined }, 2);

      await cloudflareQueueHandlers().queue(
        { messages: [message] } as never,
        { QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(ran).toStrictEqual([1]);
      expect(message.settled.acked).toBe(1);
      expect(message.settled.retries).toStrictEqual([]);
    });

    it("retries a retryable failure with 30, 60 then 120 seconds", async () => {
      withJob("flaky", () => {
        throw new QueueError("rate_limited", "later", { retryable: true });
      });

      const delays: unknown[] = [];
      for (const attempts of [1, 2, 3]) {
        const message = stubMessage({ job: "flaky" }, attempts);
        await cloudflareQueueHandlers().queue(
          { messages: [message] } as never,
          { QUEUE_PROVIDER: "cloudflare" },
          ctx
        );
        expect(message.settled.acked).toBe(0);
        delays.push(message.settled.retries[0]);
      }

      expect(delays).toStrictEqual([
        { delaySeconds: 30 },
        { delaySeconds: 60 },
        { delaySeconds: 120 },
      ]);
    });

    it("acks a non-retryable failure and sends it to JOBS_DLQ", async () => {
      withJob("doomed", () => {
        throw new QueueError("invalid_job", "bad shape");
      });
      const JOBS_DLQ = stubQueue();
      const message = stubMessage({ job: "doomed", payload: { a: 1 } });

      await cloudflareQueueHandlers().queue(
        { messages: [message] } as never,
        { JOBS_DLQ, QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(message.settled.acked).toBe(1);
      expect(message.settled.retries).toStrictEqual([]);
      expect(JOBS_DLQ.sent).toHaveLength(1);
      const body = JOBS_DLQ.sent[0]?.body as {
        body: unknown;
        failure: { code: string; message: string };
        messageId: string;
      };
      expect(body.body).toStrictEqual({ job: "doomed", payload: { a: 1 } });
      expect({
        code: body.failure.code,
        messageId: body.messageId,
      }).toStrictEqual({
        code: "invalid_job",
        messageId: "msg-1",
      });
    });

    it("dead-letters a message that names no job", async () => {
      const JOBS_DLQ = stubQueue();
      const message = stubMessage({ nope: true });

      await cloudflareQueueHandlers().queue(
        { messages: [message] } as never,
        { JOBS_DLQ, QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(message.settled.acked).toBe(1);
      expect(JOBS_DLQ.sent).toHaveLength(1);
    });

    it("retries rather than dropping when the DLQ is unreachable", async () => {
      withJob("doomed2", () => {
        throw new QueueError("invalid_job", "bad shape");
      });
      const message = stubMessage({ job: "doomed2" });

      await cloudflareQueueHandlers().queue(
        { messages: [message] } as never,
        { QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(message.settled.acked).toBe(0);
      expect(message.settled.retries).toStrictEqual([undefined]);
      expect(errors[0] ?? "").toMatch(/no `JOBS_DLQ` binding/);
    });

    it("settles every message in a batch", async () => {
      withJob("fine", () => {});
      const first = stubMessage({ job: "fine" });
      const second = stubMessage({ job: "fine" });

      await cloudflareQueueHandlers().queue(
        { messages: [first, second] } as never,
        { QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(first.settled.acked).toBe(1);
      expect(second.settled.acked).toBe(1);
    });
  });

  describe("cloudflareQueueHandlers() — the cron tick", () => {
    const ctx = {} as never;
    const at = Date.UTC(2026, 0, 1, 12, 0);

    it("warns and enqueues nothing unless QUEUE_PROVIDER is cloudflare", async () => {
      const JOBS = stubQueue();
      queue.schedules.push(
        defineSchedule({ cron: "* * * * *", job: "example", name: "every" })
      );

      await cloudflareQueueHandlers().scheduled(
        { cron: "* * * * *", scheduledTime: at } as never,
        { JOBS, QUEUE_PROVIDER: "memory" },
        ctx
      );

      expect(JOBS.sent).toStrictEqual([]);
      expect(warnings[0] ?? "").toMatch(/cron tick/);
    });

    it("enqueues one message per due schedule and skips the rest", async () => {
      const JOBS = stubQueue();
      withJob("nightly", () => {});
      queue.schedules.push(
        defineSchedule({
          cron: "* * * * *",
          job: "example",
          name: "every",
          payload: { message: "tick" },
        }),
        defineSchedule({ cron: "0 3 * * *", job: "nightly", name: "at-three" })
      );

      await cloudflareQueueHandlers().scheduled(
        { cron: "* * * * *", scheduledTime: at } as never,
        { JOBS, QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(JOBS.sent).toStrictEqual([
        {
          body: { job: "example", payload: { message: "tick" } },
          options: undefined,
        },
      ]);
    });

    it("keeps ticking when one schedule cannot be enqueued", async () => {
      const JOBS = stubQueue();
      queue.schedules.push(
        defineSchedule({
          cron: "* * * * *",
          job: "not-registered",
          name: "bad",
        }),
        defineSchedule({
          cron: "* * * * *",
          job: "example",
          name: "good",
          payload: { message: "tick" },
        })
      );

      await cloudflareQueueHandlers().scheduled(
        { cron: "* * * * *", scheduledTime: at } as never,
        { JOBS, QUEUE_PROVIDER: "cloudflare" },
        ctx
      );

      expect(JOBS.sent).toHaveLength(1);
      expect(errors[0] ?? "").toMatch(/schedule "bad"/);
    });
  });
});
