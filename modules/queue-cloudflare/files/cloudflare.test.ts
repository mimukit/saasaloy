// Tests for the Cloudflare provider: the producer's option passing and error mapping,
// the consumer's ack / retry / dead-letter split, and the cron tick. Like the core's
// tests this file is repo-only — the descriptor ships `cloudflare.ts` and nothing else —
// and it runs on `node:test` via `pnpm test:modules`.
//
// The bindings are stubs, because the real ones exist only inside workerd. What is *not*
// stubbed is the capability core: `../index` resolves through the shim beside this
// module to the real `packages/queue` barrel, so a message goes through the same job
// lookup, validation and error normalization a deployed Worker uses.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cloudflare, cloudflareQueueHandlers } from "./cloudflare.ts";
import { defineJob, defineSchedule, queue } from "../index.ts";
import { QueueError } from "../provider.ts";

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

    assert.deepEqual(JOBS.sent, [
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

    assert.equal(JOBS.sent[0]?.options, undefined);
  });

  it("rejects a durable job and names the follow-up issue", async () => {
    const JOBS = stubQueue();
    const durable = defineJob({ durable: true, handler: () => {}, name: "d" });

    await assert.rejects(
      () => cloudflare().enqueue({ JOBS }, durable, {}, {}),
      (error: unknown) => {
        assert.ok(error instanceof QueueError);
        assert.equal(error.code, "provider_error");
        assert.equal(error.retryable, false);
        assert.match(error.message, /#131/);
        return true;
      }
    );
    assert.deepEqual(JOBS.sent, []);
  });

  it("explains a missing binding instead of throwing a TypeError", async () => {
    await assert.rejects(
      () =>
        cloudflare().enqueue(
          {},
          defineJob({ handler: () => {}, name: "x" }),
          {},
          {}
        ),
      (error: unknown) => {
        assert.ok(error instanceof QueueError);
        assert.match(error.message, /No `JOBS` Queues binding/);
        return true;
      }
    );
  });

  it("maps a Queues error onto a core code and keeps the raw one", async () => {
    const JOBS = stubQueue(
      Object.assign(new Error("too big"), { code: "QUEUE_MESSAGE_TOO_LARGE" })
    );

    await assert.rejects(
      () =>
        cloudflare().enqueue(
          { JOBS },
          defineJob({ handler: () => {}, name: "x" }),
          {},
          {}
        ),
      (error: unknown) => {
        assert.ok(error instanceof QueueError);
        assert.equal(error.code, "too_large");
        assert.equal(error.providerCode, "QUEUE_MESSAGE_TOO_LARGE");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  });

  it("treats a full queue as retryable and an unknown code as not", async () => {
    const full = stubQueue(
      Object.assign(new Error("backlog"), { code: "QUEUE_FULL" })
    );
    const job = defineJob({ handler: () => {}, name: "x" });
    await assert.rejects(
      () => cloudflare().enqueue({ JOBS: full }, job, {}, {}),
      (error: unknown) => {
        assert.ok(error instanceof QueueError);
        assert.equal(error.code, "rate_limited");
        assert.equal(error.retryable, true);
        return true;
      }
    );

    const odd = stubQueue(
      Object.assign(new Error("who knows"), { code: "E_SOMETHING_NEW" })
    );
    await assert.rejects(
      () => cloudflare().enqueue({ JOBS: odd }, job, {}, {}),
      (error: unknown) => {
        assert.ok(error instanceof QueueError);
        assert.equal(error.code, "provider_error");
        assert.equal(error.providerCode, "E_SOMETHING_NEW");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  });
});

describe("cloudflareQueueHandlers() — the consumer", () => {
  const ctx = {} as never;

  it("warns and settles nothing when QUEUE_PROVIDER is not cloudflare", async () => {
    const message = stubMessage({ job: "example", payload: { message: "x" } });

    await cloudflareQueueHandlers().queue(
      { messages: [message] } as never,
      { QUEUE_PROVIDER: "memory" },
      ctx
    );

    assert.equal(message.settled.acked, 0);
    assert.deepEqual(message.settled.retries, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /QUEUE_PROVIDER is "memory"/);
  });

  it("warns when QUEUE_PROVIDER is unset", async () => {
    await cloudflareQueueHandlers().queue({ messages: [] } as never, {}, ctx);

    assert.match(warnings[0] ?? "", /QUEUE_PROVIDER is unset/);
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

    assert.deepEqual(ran, [1]);
    assert.equal(message.settled.acked, 1);
    assert.deepEqual(message.settled.retries, []);
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
      assert.equal(message.settled.acked, 0);
      delays.push(message.settled.retries[0]);
    }

    assert.deepEqual(delays, [
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

    assert.equal(message.settled.acked, 1);
    assert.deepEqual(message.settled.retries, []);
    assert.equal(JOBS_DLQ.sent.length, 1);
    const body = JOBS_DLQ.sent[0]?.body as {
      body: unknown;
      failure: { code: string; message: string };
      messageId: string;
    };
    assert.deepEqual(body.body, { job: "doomed", payload: { a: 1 } });
    assert.equal(body.failure.code, "invalid_job");
    assert.equal(body.messageId, "msg-1");
  });

  it("dead-letters a message that names no job", async () => {
    const JOBS_DLQ = stubQueue();
    const message = stubMessage({ nope: true });

    await cloudflareQueueHandlers().queue(
      { messages: [message] } as never,
      { JOBS_DLQ, QUEUE_PROVIDER: "cloudflare" },
      ctx
    );

    assert.equal(message.settled.acked, 1);
    assert.equal(JOBS_DLQ.sent.length, 1);
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

    assert.equal(message.settled.acked, 0);
    assert.deepEqual(message.settled.retries, [undefined]);
    assert.match(errors[0] ?? "", /no `JOBS_DLQ` binding/);
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

    assert.equal(first.settled.acked, 1);
    assert.equal(second.settled.acked, 1);
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

    assert.deepEqual(JOBS.sent, []);
    assert.match(warnings[0] ?? "", /cron tick/);
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

    assert.deepEqual(JOBS.sent, [
      {
        body: { job: "example", payload: { message: "tick" } },
        options: undefined,
      },
    ]);
  });

  it("keeps ticking when one schedule cannot be enqueued", async () => {
    const JOBS = stubQueue();
    queue.schedules.push(
      defineSchedule({ cron: "* * * * *", job: "not-registered", name: "bad" }),
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

    assert.equal(JOBS.sent.length, 1);
    assert.match(errors[0] ?? "", /schedule "bad"/);
  });
});
