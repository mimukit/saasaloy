import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "@repo/config";
import { requireAdmin, withAuthScope } from "@repo/auth/server";
import type { AuthRequestContext } from "@repo/auth/server";
import {
  TEST_DB,
  TRANSACTION_IS_ATOMIC,
  transaction,
  withDb,
} from "@repo/db/client";
import type { Db } from "@repo/db/client";
import { insertAuditEvents } from "@repo/db/repositories/audit";
import type { AuditEventInput } from "@repo/db/repositories/audit";
import { createLogger } from "@repo/logger";
import type { Logger, LoggerEnv, LoggerVariables } from "@repo/logger";
import type { Context } from "hono";

import { AUDIT_ACTIONS, targetOfAction } from "./audit-actions";
import type { AuditAction } from "./audit-actions";
import { changedFields, refusedKey } from "./changed-fields";
import type { FlatFields } from "./changed-fields";

// The one way an admin write route changes data. `adminWrite` runs the admin gate, opens
// one transaction, and hands the route body its scope. The body makes its change and calls
// `audit()` once per change; the wrapper inserts those rows last, inside the same
// transaction.
//
// Only a successful change leaves a row. When the body throws, or answers a status of 400
// or more, the wrapper inserts no row and answers what the body answered.
//
// What "the same transaction" buys depends on the driver (issue #310, "D1 guarantee"):
//
// - Under `database-postgres` it is a real transaction. The change and its rows commit
//   together or not at all, and a body that throws or answers 4xx keeps nothing it wrote.
// - Under `database-d1` there is no interactive transaction. Each statement of the body
//   commits as it runs, so a body that writes and then fails keeps its write; it only gets
//   no row. The rows go in after the body. When that insert fails, the change has already
//   stood, so the failure is logged at `error` and the route answers what the body
//   answered. Validate before you write, and a D1 route keeps nothing on a 4xx either.
//
// A new admin write route, in four steps:
//
//   1. Add its action to your module's action file, `apps/api/src/audit/<module>.ts`: the
//      route as `METHOD /admin/...`, the target type, and the area. Until it is there, the
//      coverage test in `../routes/audit-coverage.test.ts` fails. That test checks the map
//      only, so step 4's route test is what proves the row is written.
//   2. Open the handler with `adminWrite(c, async ({ db, actor, audit, afterCommit }) => {`
//      in place of `requireAdmin(c)` and `withDb(c, ...)`. Use `db` for every query: a query
//      on another client runs outside the transaction.
//   3. Load the row it changes, change it, and call
//      `audit({ action, target: { id, label }, before, after })` with the fields the change
//      touched. The wrapper keeps the fields that differ, under dot paths. A create passes
//      `after` only, a delete `before` only. Never pass a password: a key that matches
//      /password/i throws.
//   4. Put anything that must not happen for a failed change, such as an email, in
//      `afterCommit((db) => ...)`. It runs after the commit, on `waitUntil`, on a client of
//      its own, and a failure there is logged and never fails the request.
//
// A change Better Auth makes cannot join our transaction. Its route uses `adminAuthWrite`,
// which inserts the rows after the change and logs a failed insert at `error` rather than
// failing a change that already stood.

export interface AuditTarget {
  /** The target row's id, for a filter by target. */
  id: string;
  /** What admins call it: a payment reference, an email, a flag key. */
  label: string;
}

export interface AuditEntry {
  /** An action some installed module registers in `./audit-actions.ts`. */
  action: AuditAction;
  target: AuditTarget;
  /** The fields as they were. Leave it out for a create. */
  before?: Record<string, unknown> | null;
  /** The fields as they are now. Leave it out for a delete. */
  after?: Record<string, unknown> | null;
}

export interface AdminActor {
  id: string;
  /** The actor's role at the time of the change, such as `admin` or `superadmin`. */
  role: string;
}

/** Queue a task that runs after the change commits, with a client of its own. */
export type AfterCommit = (task: (db: Db) => Promise<unknown>) => void;

export interface AdminWriteScope {
  /** The transaction. Every query of the change goes through it. */
  db: Db;
  actor: AdminActor;
  /** Queue one audit row. The wrapper inserts it when the body succeeds. */
  audit: (entry: AuditEntry) => void;
  afterCommit: AfterCommit;
}

/** What `adminAuthWrite` hands its body: no client, because Better Auth owns the write. */
export type AdminAuthWriteScope = Omit<AdminWriteScope, "db" | "afterCommit">;

/** What `currentAdminWrite()` answers inside an open `adminWrite`. */
export interface CurrentAdminWrite {
  db: Db;
  afterCommit: AfterCommit;
}

/** The request context the wrappers read. A Hono `Context` from any admin route fits. */
export type AdminWriteContext = AuthRequestContext;

/** The request's correlated logger, which the api's spine sets on every request. */
function loggerOf(c: AdminWriteContext): Logger {
  // A route module's Hono type carries no `Variables`, so the spine's `log` is not on its
  // context type. The spine sets it before any route runs; `createLogger` covers a context
  // with no `get`, such as a test's.
  const hono = c as unknown as Partial<Context<{ Variables: LoggerVariables }>>;
  return hono.get?.("log") ?? createLogger(c.env as unknown as LoggerEnv);
}

function rowOf(
  actor: AdminActor,
  entry: AuditEntry,
  before: FlatFields | null,
  after: FlatFields | null
): AuditEventInput {
  // `AUDIT_ACTIONS` is passed by name rather than left to the default, so a test that
  // swaps the module's export for a map of its own is read here too.
  const targetType = targetOfAction(entry.action, AUDIT_ACTIONS);
  if (targetType === null) {
    throw new Error(
      `No installed module registers the audit action "${entry.action}". Add it to the module's file in apps/api/src/audit/.`
    );
  }
  return {
    action: entry.action,
    actorRole: actor.role,
    actorUserId: actor.id,
    after,
    before,
    targetId: entry.target.id,
    targetLabel: entry.target.label,
    targetType,
  };
}

/** The row an entry becomes. Throws on a refused key, so the change fails with it. */
export function auditRowOf(
  actor: AdminActor,
  entry: AuditEntry
): AuditEventInput {
  const { before, after } = changedFields(
    entry.before ?? null,
    entry.after ?? null
  );
  const refused = refusedKey(before) ?? refusedKey(after);
  if (refused !== null) {
    throw new Error(
      `${entry.action}: the audit log never stores "${refused}". Leave it out.`
    );
  }
  return rowOf(actor, entry, before, after);
}

/** `fields` without the keys the log refuses, and the keys it dropped. */
function withoutRefused(fields: FlatFields | null): {
  fields: FlatFields | null;
  dropped: string[];
} {
  if (fields === null) {
    return { dropped: [], fields };
  }
  const kept: FlatFields = {};
  const dropped: string[] = [];
  for (const [path, value] of Object.entries(fields)) {
    if (refusedKey({ [path]: value }) === null) {
      kept[path] = value;
    } else {
      dropped.push(path);
    }
  }
  return {
    dropped,
    fields: Object.keys(kept).length > 0 ? kept : null,
  };
}

/** True when the body answered a 4xx or 5xx, which fails the write. */
export function isFailedAnswer(result: unknown): boolean {
  return result instanceof Response && result.status >= 400;
}

/**
 * Carries the body's answer out of the transaction. `refused`: the body answered a 4xx or
 * 5xx, and the throw rolls the write back. `unaudited`: under D1 the audit insert failed
 * after the change had already stood, so the answer stands with it. One class for both,
 * so nothing else a body throws is mistaken for either.
 */
class CarriedAnswer {
  readonly kind: "refused" | "unaudited";
  readonly result: unknown;
  readonly error: unknown;
  readonly actions: readonly string[];

  constructor(
    kind: "refused" | "unaudited",
    result: unknown,
    error: unknown = null,
    actions: readonly string[] = []
  ) {
    this.kind = kind;
    this.result = result;
    this.error = error;
    this.actions = actions;
  }
}

/** The open write's client and hook, for code a route calls deep down. */
const writeScope = new AsyncLocalStorage<CurrentAdminWrite>();

/**
 * The admin write the current call runs inside, or `undefined` outside one. Code a route
 * calls deep down, such as a store a capability core writes through, reads it to join the
 * write's transaction: on another client it would not see the change, and under Postgres
 * its own writes would survive a rollback.
 */
export function currentAdminWrite(): CurrentAdminWrite | undefined {
  return writeScope.getStore();
}

/**
 * Run each queued task, one at a time, in the order the body queued them. Under a route
 * test the env carries `TEST_DB`, so they run now, on the test's client, and the test sees
 * what they did. Anywhere else they run on `waitUntil`, on a client of their own, so the
 * answer does not wait for them.
 */
async function runAfterCommit(
  c: AdminWriteContext,
  tasks: readonly ((db: Db) => Promise<unknown>)[],
  log: Logger
): Promise<void> {
  if (tasks.length === 0) {
    return;
  }
  const runAll = async (db: Db) => {
    for (const task of tasks) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the tasks run in order on one client
        await task(db);
      } catch (error) {
        log.error("an after-commit task failed", { err: error });
      }
    }
  };
  if (c.env[TEST_DB] !== undefined) {
    await withDb(c, runAll);
    return;
  }
  const done = withDb(c, runAll).catch((error: unknown) => {
    log.error("the after-commit tasks did not run", { err: error });
  });
  try {
    c.executionCtx.waitUntil(done);
  } catch {
    // No execution context to hold open, as under `app.request()`. The tasks still run.
  }
}

/** The signed-in admin, or a thrown 401 or 403. */
async function actorOf(c: AdminWriteContext): Promise<AdminActor> {
  // Throws 401 when nobody is signed in and 403 for any role but admin or superadmin.
  const session = await withAuthScope(c, () => requireAdmin(c));
  return {
    id: session.user.id,
    role: session.user.role ?? config.auth.adminRole,
  };
}

/**
 * The admin gate, one transaction, and the audit rows of the change. Generic in what the
 * body returns, so `hc` keeps each route's response types.
 */
export async function adminWrite<T>(
  c: AdminWriteContext,
  body: (scope: AdminWriteScope) => Promise<T>
): Promise<T> {
  const actor = await actorOf(c);
  const log = loggerOf(c);
  const tasks: ((db: Db) => Promise<unknown>)[] = [];
  const afterCommit: AfterCommit = (task) => {
    tasks.push(task);
  };

  let result: T;
  try {
    result = await withDb(c, (client) =>
      transaction(client, async (db) => {
        const rows: AuditEventInput[] = [];
        const audit = (entry: AuditEntry) => {
          rows.push(auditRowOf(actor, entry));
        };
        const answer = await writeScope.run({ afterCommit, db }, () =>
          body({ actor, afterCommit, audit, db })
        );
        if (isFailedAnswer(answer)) {
          throw new CarriedAnswer("refused", answer);
        }
        try {
          await insertAuditEvents(db, rows);
        } catch (error) {
          // Under Postgres the throw rolls the change back with its rows, and the request
          // fails. Under D1 the change has already stood, so the answer stands with it.
          if (TRANSACTION_IS_ATOMIC) {
            throw error;
          }
          throw new CarriedAnswer(
            "unaudited",
            answer,
            error,
            rows.map((row) => row.action)
          );
        }
        return answer;
      })
    );
  } catch (error) {
    if (!(error instanceof CarriedAnswer)) {
      throw error;
    }
    if (error.kind === "refused") {
      return error.result as T;
    }
    log.error("the audit rows of an admin write were not written", {
      actions: error.actions,
      err: error.error,
    });
    result = error.result as T;
  }
  await runAfterCommit(c, tasks, log);
  return result;
}

/**
 * `adminWrite` for a change Better Auth makes, which no transaction of ours can hold. The
 * body runs inside the auth scope Better Auth reads its client from. Its rows are inserted
 * once it succeeds; a failed insert is logged at `error` and the route still answers what
 * the body answered, because the change already stands.
 *
 * A refused key is dropped from its row and logged, not thrown: Better Auth has made the
 * change by the time the row is built, and a throw would answer 500 for a change that
 * stands.
 */
export function adminAuthWrite<T>(
  c: AdminWriteContext,
  body: (scope: AdminAuthWriteScope) => Promise<T>
): Promise<T> {
  return withAuthScope(c, async () => {
    const session = await requireAdmin(c);
    const actor: AdminActor = {
      id: session.user.id,
      role: session.user.role ?? config.auth.adminRole,
    };
    const log = loggerOf(c);
    const rows: AuditEventInput[] = [];
    const answer = await body({
      actor,
      audit: (entry) => {
        const changed = changedFields(
          entry.before ?? null,
          entry.after ?? null
        );
        const before = withoutRefused(changed.before);
        const after = withoutRefused(changed.after);
        const dropped = [...before.dropped, ...after.dropped];
        if (dropped.length > 0) {
          log.error("an audit row named a refused key, which was left out", {
            action: entry.action,
            dropped,
          });
        }
        try {
          rows.push(rowOf(actor, entry, before.fields, after.fields));
        } catch (error) {
          log.error("an audit row of a Better Auth change was refused", {
            action: entry.action,
            err: error,
          });
        }
      },
    });
    if (isFailedAnswer(answer) || rows.length === 0) {
      return answer;
    }
    try {
      await withDb(c, (db) => insertAuditEvents(db, rows));
    } catch (error) {
      log.error("the audit rows of a Better Auth change were not written", {
        actions: rows.map((row) => row.action),
        err: error,
      });
    }
    return answer;
  });
}
