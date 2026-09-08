// The reserved flags this module seeds, and the one place their keys are written down.
//
// Two prefixes are reserved, and both are ordinary flags — no separate module, no separate
// store, no separate resolution path:
//
//   `system.maintenance`  drives `maintenance()` in apps/api/src/middleware/maintenance.ts
//   `kill.<integration>`  drives `assertEnabled("<integration>")`
//
// Each export is a factory, not a plain object, because a project registers a flag by
// appending a bare `killPayments()` call to the array in `src/index.ts` (the `plugin-array`
// patch kind writes a call with no arguments). Your own flags belong beside them in a file
// of your own; this one is the module's, and `saasaloy update` may rewrite it.

import { defineFlag, KILL_PREFIX, MAINTENANCE_KEY } from "../define";
import type { FlagDefinition } from "../define";

/**
 * The maintenance switch. Defaults **off**, so installing this module does not take the
 * api down, and a database the resolver cannot reach leaves the site up rather than
 * sealing it shut.
 */
export function maintenanceFlag(): FlagDefinition<typeof MAINTENANCE_KEY> {
  return defineFlag({
    default: false,
    description:
      "Serve a 503 maintenance page to everyone except admins and the bypass paths.",
    key: MAINTENANCE_KEY,
    type: "boolean",
  });
}

/**
 * Payments. Defaults **on**: a kill switch is off-by-exception, and a flag store that has
 * never been published must not stop a project charging its customers.
 */
export function killPayments(): FlagDefinition<`${typeof KILL_PREFIX}payments`> {
  return defineFlag({
    default: true,
    description:
      "Turn off to stop checkout and billing calls while a payment provider is down.",
    key: `${KILL_PREFIX}payments`,
    type: "boolean",
  });
}

/** Model calls. Turn it off when a provider is failing or a bill is running away. */
export function killAi(): FlagDefinition<`${typeof KILL_PREFIX}ai`> {
  return defineFlag({
    default: true,
    description: "Turn off to stop every AI model call.",
    key: `${KILL_PREFIX}ai`,
    type: "boolean",
  });
}

/** Outbound email. Turn it off to stop a loop before it burns a sending reputation. */
export function killEmail(): FlagDefinition<`${typeof KILL_PREFIX}email`> {
  return defineFlag({
    default: true,
    description: "Turn off to stop every outbound email send.",
    key: `${KILL_PREFIX}email`,
    type: "boolean",
  });
}
