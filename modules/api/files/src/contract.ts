import { zValidator as zodValidator } from "@hono/zod-validator";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import type { ZodType } from "zod";

// The route contract: what each api route says about itself to an agent (plan 0110, ADR
// 0063). A route states it one time, in one `declare({...})` link in front of its own
// validators, and the `agent` module builds every agent surface from it: the OpenAPI
// document, the MCP tools, the tool list in `llms.txt`.
//
//   .get(
//     "/",
//     declare({
//       name: "notifications_list",
//       description: "One page of the caller's notifications, newest first.",
//       output: notificationList,
//       agent: { callable: true, readOnly: true, confirm: false },
//     }),
//     validateList,
//     (c) => ...
//   )
//
// **It does nothing in a project without `agent`.** `declare` returns a middleware that
// only calls `next()`, and the statement rides on the function as a property that nothing
// reads at request time. The response, the status and `AppType` are the route's own: the
// link adds no input and no response type to the chain. This file imports no runtime code
// but `@hono/zod-validator`, which api already ships, and it pulls nothing from `agent`.
// The `agent` module reads the statements; a route module never depends on `agent`.
//
// **A route writes its input schema one time**, in its validator, as it always did. The
// `zValidator` exported here is `@hono/zod-validator`'s, with the same signature and the
// same failure hook, and it records which target it checks and with which schema on the
// middleware it returns. So a route file swaps one import and keeps every call, and the
// agent reads the input from the same object that checks it: no second copy to drift. The
// statement adds what the validators cannot say: the name, the description, the output
// schema and the agent marks.
//
// **Every route states it, callable or not.** `scripts/route-declarations.test.ts` in the
// Saasaloy repo fails on a shipped route with no `declare(...)`. Admin routes are never
// callable, and neither are auth or payment callback routes.

/**
 * Whether an agent may call the route.
 *
 * - `callable: false` keeps the route out of every agent surface. `reason` says why, for
 *   the next person who reads the route: "Admin routes are never callable."
 * - `callable: true` makes it a tool. `readOnly` says it changes nothing, and `confirm`
 *   says a person must agree before an agent runs it (the MCP client asks its user; the
 *   server keeps no approval queue). A delete or a payment is `confirm: true`.
 */
export type AgentStatement =
  | { callable: false; reason: string }
  | { callable: true; readOnly: boolean; confirm: boolean };

interface Described {
  /**
   * The tool name and the OpenAPI `operationId`: snake_case, unique across the api, and
   * stable, because an agent's saved prompt calls it by name. Lead with the resource:
   * `notifications_list`, `cms_entry_read`.
   */
  name: string;
  /** One or two sentences an agent reads to pick the tool: what it does and returns. */
  description: string;
  /** The success status the `output` schema describes. Defaults to 200. */
  status?: 200 | 201 | 202 | 204;
}

/** What a route states. A callable route must give its output schema. */
export type RouteDeclaration = Described &
  (
    | {
        agent: Extract<AgentStatement, { callable: true }>;
        /** The body the route answers on `status`. The tool's output schema. */
        output: ZodType;
      }
    | {
        agent: Extract<AgentStatement, { callable: false }>;
        output?: ZodType;
      }
  );

/** The input one validator checks: the target and the schema it checks with. */
export interface RouteInput {
  target: keyof ValidationTargets;
  schema: ZodType;
}

// `Symbol.for` rather than `Symbol()`, so a reader in another bundle chunk or a test that
// loads this file twice still finds the property.
const DECLARATION = Symbol.for("saasaloy.api.route-declaration");
const INPUT = Symbol.for("saasaloy.api.route-input");

/**
 * The statement link. Put it first after the path, in front of the route's validators.
 *
 * The middleware it returns is typed `MiddlewareHandler` with no input and no response
 * type, which is what leaves the chain's type, and so `AppType`, as it was.
 */
export function declare(declaration: RouteDeclaration): MiddlewareHandler {
  const link: MiddlewareHandler = async (_c, next) => {
    // `next` is Hono's downstream continuation, not a Node error-first callback.
    // oxlint-disable-next-line node/callback-return
    await next();
  };
  return Object.assign(link, { [DECLARATION]: declaration });
}

/**
 * `@hono/zod-validator`'s `zValidator`, which also records its target and schema on the
 * middleware it returns. Same overloads, same hook, same failure response.
 *
 * The cast is the one place the types are taken on trust: the library exports an
 * overloaded function, and a wrapper that forwards its arguments cannot restate the
 * overloads without copying the library's internal types. The body forwards every
 * argument unchanged, so the overloads still describe it.
 */
export const zValidator = ((
  target: keyof ValidationTargets,
  schema: ZodType,
  ...rest: unknown[]
) =>
  Object.assign(
    (zodValidator as (...args: unknown[]) => MiddlewareHandler)(
      target,
      schema,
      ...rest
    ),
    { [INPUT]: { schema, target } satisfies RouteInput }
  )) as typeof zodValidator;

// Hono wraps a mounted sub-app's handler when that sub-app sets its own `onError`, and
// keeps the original under this key (`COMPOSED_HANDLER` in hono's `utils/constants`,
// which hono does not export). A shipped route sets none, but a project's route may.
const COMPOSED_HANDLER = "__COMPOSED_HANDLER";

function unwrap(handler: unknown): Record<PropertyKey, unknown> | undefined {
  if (typeof handler !== "function") {
    return undefined;
  }
  const fn = handler as unknown as Record<PropertyKey, unknown>;
  return fn[COMPOSED_HANDLER] === undefined ? fn : unwrap(fn[COMPOSED_HANDLER]);
}

/** The statement a `declare(...)` link carries, or `undefined` for any other handler. */
export function declarationOf(handler: unknown): RouteDeclaration | undefined {
  return unwrap(handler)?.[DECLARATION] as RouteDeclaration | undefined;
}

/** The target and schema a `zValidator(...)` link checks, or `undefined`. */
export function inputOf(handler: unknown): RouteInput | undefined {
  return unwrap(handler)?.[INPUT] as RouteInput | undefined;
}

/** One route of the finished app, as `routeContracts` reads it. */
export interface RouteContract {
  /** Upper case, as Hono stores it: `GET`, `POST`. */
  method: string;
  /** The full Hono path, mount included: `/notifications/:id/read`. */
  path: string;
  /** `undefined` when the route has no `declare(...)` link. */
  declaration: RouteDeclaration | undefined;
  /** The schema of each validated target, from the route's `zValidator` links. */
  input: Partial<Record<keyof ValidationTargets, ZodType>>;
}

/**
 * Every route of a finished app with its statement and its inputs, in registration
 * order. This is the reader the `agent` module uses, and a project test can use it to
 * find a route with no statement.
 *
 * Hono keeps one entry in `app.routes` per handler, so a route with a statement, two
 * validators and a handler is four entries with the same method and path. They are
 * grouped here. `ALL` entries are skipped: they are app-wide middleware such as CORS and
 * the request logger, and no shipped route registers with `.all()`.
 */
export function routeContracts(app: {
  routes: readonly { method: string; path: string; handler: unknown }[];
}): RouteContract[] {
  const byRoute = new Map<string, RouteContract>();
  for (const { handler, method, path } of app.routes) {
    if (method === "ALL") {
      continue;
    }
    const key = `${method} ${path}`;
    let contract = byRoute.get(key);
    if (!contract) {
      contract = { declaration: undefined, input: {}, method, path };
      byRoute.set(key, contract);
    }
    contract.declaration ??= declarationOf(handler);
    const input = inputOf(handler);
    if (input) {
      contract.input[input.target] = input.schema;
    }
  }
  return [...byRoute.values()];
}
