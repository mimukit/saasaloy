import app from "./index";
import { workerHandlers } from "./worker.generated";

// The Worker entry. `wrangler.jsonc`'s `main` points here, not at `src/index.ts`, so a
// capability that needs a non-`fetch` export (a queue consumer, a cron tick) has one
// place to register it. `src/index.ts` stays the Hono app and nothing else: it keeps
// `export default app` and `AppType`, which is what `@repo/api/client` and the
// generated `./routes.generated.ts` both build on. See ADR 0033.

/**
 * One module's non-`fetch` exports. A binding provider ships a function returning this
 * shape and adds the call as a row of the `worker.handlers` table, which the CLI writes
 * into `./worker.generated.ts`, the same way a provider registers itself with its
 * capability.
 *
 * The type is declared here rather than imported from a capability on purpose: `api`
 * depends on no capability, and every queue module depends on `api`.
 */
export interface HandlerSet {
  /** Handles a batch of messages the platform delivers. */
  queue?: (
    batch: MessageBatch<unknown>,
    env: unknown,
    ctx: ExecutionContext
  ) => Promise<void> | void;
  /** Handles a Cron Trigger tick. */
  scheduled?: (
    event: ScheduledController,
    env: unknown,
    ctx: ExecutionContext
  ) => Promise<void> | void;
}

export interface WorkerConfig {
  /** The Hono app's request handler. */
  fetch: ExportedHandlerFetchHandler<never>;
  /** Every installed module's handler set, in table order. */
  handlers: HandlerSet[];
}

/**
 * Fold the handler sets into the single object the Workers runtime expects.
 *
 * Each hook is exported only when at least one set declares it, because Cloudflare
 * treats the presence of a `queue` export as a promise that the Worker consumes a
 * queue. Every set that declares a hook runs, in registration order, and a rejection
 * propagates: the platform's own retry is the recovery, not a swallow here.
 */
export function defineWorker(config: WorkerConfig): ExportedHandler<never> {
  const consumers = config.handlers.filter((set) => set.queue !== undefined);
  const tickers = config.handlers.filter((set) => set.scheduled !== undefined);

  const worker: ExportedHandler<never> = { fetch: config.fetch };

  if (consumers.length > 0) {
    worker.queue = async (batch, env, ctx) => {
      for (const set of consumers) {
        await set.queue?.(batch, env, ctx);
      }
    };
  }

  if (tickers.length > 0) {
    worker.scheduled = async (event, env, ctx) => {
      for (const set of tickers) {
        await set.scheduled?.(event, env, ctx);
      }
    };
  }

  return worker;
}

// The registration table. A module adds its handler set as a `worker.handlers` row, the
// CLI writes it into `./worker.generated.ts`, and a `remove` takes the row back out. A
// handler set of your own goes after the spread.
export const worker: ExportedHandler<never> = defineWorker({
  fetch: app.fetch,
  handlers: [...workerHandlers],
});

export default worker;
