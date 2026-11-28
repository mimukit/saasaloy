// Convert the registration tables of every descriptor into generated tables (plan 0116,
// Phase 7, issue #365).
//
//   node scripts/convert-tables.ts [--check]
//
// The old engine wrote a registration table with one of four patch kinds, each inserting
// a row into a file the owner keeps: `plugin-array`, `const-array`, `chained-route` and
// `nav-entry`. The render engine writes each table as a generated file instead. This
// script rewrites the descriptors to match: every patch of the four kinds becomes a row in
// the module's `entries`, and the module that ships the file holding the table (or the
// base template, in `_saasaloy-base.json`) declares the table in `tables`.
//
// It stays in the branch until #365 merges (plan 0116, "One branch while main moves"). A
// rebase onto a `main` that changed a descriptor runs it again, so nobody merges the
// descriptors by hand. It is idempotent: a descriptor with no table patch keeps its rows,
// and a table already declared is not declared twice. A patch whose table is not in
// `TABLES` below stops the run, because a new table needs its id and file chosen by hand.
//
// `--check` writes nothing and exits 1 when a descriptor still holds a table patch.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import * as prettier from "prettier";

const REPO = resolve(import.meta.dirname, "..");
const MODULES = join(REPO, "modules");
const BASE_DECLARATION = join(
  REPO,
  "packages/cli/templates/base/_saasaloy-base.json"
);

/** The four patch kinds that wrote a table into a file the owner keeps. */
export const TABLE_KINDS = [
  "chained-route",
  "const-array",
  "nav-entry",
  "plugin-array",
] as const;

type Shape = "calls" | "objects" | "routes" | "nav";

interface Import {
  name: string;
  from: string;
}

export interface TableSpec {
  id: string;
  /** The generated file, with an alias where the project has one. */
  file: string;
  shape: Shape;
  /** The module that ships the file holding the table, or `base`. */
  owner: string;
  type?: Import;
}

/**
 * Every table of the payload, keyed by `<file>|<export or const>|<array property>`: the
 * fields a table patch names its table by.
 */
export const TABLES: Record<string, TableSpec> = {
  // --- Base template ---------------------------------------------------------------
  "apps/web/src/lib/agent-entries.ts|agentEntries|entries": {
    file: "@web/lib/agent-entries.generated.ts",
    id: "web.agentEntries",
    owner: "base",
    shape: "calls",
  },
  "packages/config/src/sections.ts|sections|sections": {
    file: "@config/sections.generated.ts",
    id: "config.sections",
    owner: "base",
    shape: "calls",
  },
  "packages/env/src/services.ts|SERVICES|": {
    file: "@env/services.generated.ts",
    id: "env.services",
    owner: "base",
    shape: "objects",
    type: { name: "Service", from: "./services.ts" },
  },
  "packages/env/src/sources.ts|sources|sources": {
    file: "@env/sources.generated.ts",
    id: "env.sources",
    owner: "base",
    shape: "calls",
  },
  "packages/tooling/src/targets.ts|DEPLOY_TARGETS|": {
    file: "packages/tooling/src/targets.generated.ts",
    id: "tooling.deployTargets",
    owner: "base",
    shape: "objects",
    type: { name: "DeployTarget", from: "./types.ts" },
  },
  "packages/tooling/src/targets.ts|SMOKE_CHECKS|": {
    file: "packages/tooling/src/targets.generated.ts",
    id: "tooling.smokeChecks",
    owner: "base",
    shape: "objects",
    type: { name: "SmokeCheck", from: "./types.ts" },
  },
  "packages/ui/src/blocks/navbar.tsx|pageLinks|": {
    file: "@ui/blocks/navbar.generated.ts",
    id: "ui.pageLinks",
    owner: "base",
    shape: "objects",
    type: { name: "NavbarLink", from: "./navbar" },
  },
  // --- admin -------------------------------------------------------------------------
  "apps/admin/src/components/nav-counts.ts|NAV_COUNTS|": {
    file: "@admin/components/nav-counts.generated.ts",
    id: "admin.navCounts",
    owner: "admin",
    shape: "objects",
    type: { name: "NavCountSource", from: "./nav-counts" },
  },
  "apps/admin/src/components/nav.ts|NAV_AREAS|": {
    file: "@admin/components/nav.generated.ts",
    id: "admin.nav",
    owner: "admin",
    shape: "nav",
  },
  "apps/admin/src/components/shell-extensions.ts|shellExtensions|extensions": {
    file: "@admin/components/shell-extensions.generated.ts",
    id: "admin.shellExtensions",
    owner: "admin",
    shape: "calls",
  },
  "apps/api/src/lib/audit-actions.ts|AUDIT_ACTIONS|actions": {
    file: "@api/lib/audit-actions.generated.ts",
    id: "audit.actions",
    owner: "admin",
    shape: "calls",
  },
  // --- agent -------------------------------------------------------------------------
  "apps/api/src/agent/guards.ts|agentGuards|guards": {
    file: "@api/agent/guards.generated.ts",
    id: "agent.routeGuards",
    owner: "agent",
    shape: "calls",
  },
  // --- api ---------------------------------------------------------------------------
  "apps/api/src/env.ts|apiEnv|extends": {
    file: "@api/env.generated.ts",
    id: "api.envPresets",
    owner: "api",
    shape: "calls",
  },
  "apps/api/src/index.ts|base|": {
    file: "@api/routes.generated.ts",
    id: "api.baseRoutes",
    owner: "api",
    shape: "routes",
  },
  "apps/api/src/index.ts|default|": {
    file: "@api/routes.generated.ts",
    id: "api.routes",
    owner: "api",
    shape: "routes",
  },
  "apps/api/src/worker.ts|worker|handlers": {
    file: "@api/worker.generated.ts",
    id: "worker.handlers",
    owner: "api",
    shape: "calls",
  },
  // --- app ---------------------------------------------------------------------------
  "apps/app/src/components/nav-counts.ts|NAV_COUNTS|": {
    file: "@app/components/nav-counts.generated.ts",
    id: "app.navCounts",
    owner: "app",
    shape: "objects",
    type: { name: "NavCountSource", from: "./nav-counts" },
  },
  "apps/app/src/components/nav.ts|NAV_AREAS|": {
    file: "@app/components/nav.generated.ts",
    id: "app.nav",
    owner: "app",
    shape: "nav",
  },
  "apps/app/src/components/shell-extensions.ts|shellExtensions|extensions": {
    file: "@app/components/shell-extensions.generated.ts",
    id: "app.shellExtensions",
    owner: "app",
    shape: "calls",
  },
  "apps/app/src/lib/redirect.ts|AUTH_SCREENS|": {
    file: "@app/lib/redirect.generated.ts",
    id: "app.authScreens",
    owner: "app",
    shape: "objects",
  },
  // --- auth --------------------------------------------------------------------------
  "apps/api/src/routes/auth.ts|authGuards|guards": {
    file: "@api/routes/auth-guards.generated.ts",
    id: "auth.routeGuards",
    owner: "auth",
    shape: "calls",
  },
  "packages/auth/src/auth.ts|auth|plugins": {
    file: "@auth/plugins.generated.ts",
    id: "auth.plugins",
    owner: "auth",
    shape: "calls",
  },
  "packages/auth/src/auth.ts|adminAuth|plugins": {
    file: "@auth/plugins.generated.ts",
    id: "adminAuth.plugins",
    owner: "auth",
    shape: "calls",
  },
  "packages/auth/src/client.ts|authClientPlugins|plugins": {
    file: "@auth/client-plugins.generated.ts",
    id: "client.plugins",
    owner: "auth",
    shape: "calls",
  },
  "packages/auth/src/client.ts|adminAuthClientPlugins|plugins": {
    file: "@auth/client-plugins.generated.ts",
    id: "adminClient.plugins",
    owner: "auth",
    shape: "calls",
  },
  "packages/auth/src/user-caller.ts|userResolvers|resolvers": {
    file: "@auth/user-caller.generated.ts",
    id: "userCaller.resolvers",
    owner: "auth",
    shape: "calls",
  },
  "packages/db/src/seed/slices/accounts.ts|extraAccounts|accounts": {
    file: "@db/seed/slices/accounts.generated.ts",
    id: "seed.accounts",
    owner: "auth",
    shape: "calls",
  },
  "packages/db/src/seed/slices/users.ts|extraUsers|rows": {
    file: "@db/seed/slices/users.generated.ts",
    id: "seed.users",
    owner: "auth",
    shape: "calls",
  },
  // --- cms ---------------------------------------------------------------------------
  "packages/cms/src/index.ts|cms|collections": {
    file: "@cms/collections.generated.ts",
    id: "cms.collections",
    owner: "cms",
    shape: "calls",
  },
  // --- multitenant -------------------------------------------------------------------
  "packages/auth/src/tenant.ts|tenantResolvers|resolvers": {
    file: "@auth/tenant.generated.ts",
    id: "multitenant.resolvers",
    owner: "multitenant",
    shape: "calls",
  },
  // --- Capabilities with providers ---------------------------------------------------
  ...capability("ai", ["providers"]),
  ...capability("email", ["providers"]),
  ...capability("kv", ["policies", "providers"]),
  ...capability("logger", ["providers"], false),
  ...capability("payment", ["listeners", "providers"]),
  ...capability("queue", ["jobs", "providers", "schedules"], false),
  ...capability("sms", ["providers"]),
  ...capability("storage", ["providers"]),
  ...capability("subscription", ["providers"]),
};

/** The tables of a capability's `index.ts` and, when it has one, its env preset. */
function capability(
  name: string,
  arrays: string[],
  preset = true
): Record<string, TableSpec> {
  const out: Record<string, TableSpec> = {};
  for (const array of arrays) {
    out[`packages/${name}/src/index.ts|${name}|${array}`] = {
      file: `@${name}/${array}.generated.ts`,
      id: `${name}.${array}`,
      owner: name,
      shape: "calls",
    };
  }
  if (preset) {
    out[`packages/${name}/src/env-preset.ts|${name}Preset|extends`] = {
      file: `@${name}/env-preset.generated.ts`,
      id: `${name}.envPresets`,
      owner: name,
      shape: "calls",
    };
  }
  return out;
}

/**
 * The first CLI that reads `tables` and `entries`. A descriptor that holds either needs a
 * `requires.saasaloy` floor at it, so an older CLI refuses with an upgrade line rather
 * than a schema error (#205, `registry-floors.test.ts`).
 */
export const TABLES_FLOOR = ">=0.10.0";

/** Rows no patch held: an entry the owning module used to ship inline. */
export const EXTRA_ENTRIES: Record<string, Record<string, unknown>[]> = {
  // `/health` was the head of the typed chain in `apps/api/src/index.ts`. The generated
  // chain takes `base` itself, which keeps the Hono RPC types, so the link is a row.
  api: [
    {
      table: "api.routes",
      path: "/health",
      call: "health",
      import: { name: "health", from: "./routes/health" },
      order: 0,
    },
  ],
};

type Patch = Record<string, unknown> & { kind: string; file: string };
type Descriptor = Record<string, unknown> & {
  name?: string;
  patches?: Patch[];
  tables?: Record<string, unknown>[];
  entries?: Record<string, unknown>[];
};

/** The key a table patch names its table by. */
export function tableKey(patch: Patch): string {
  const name = (patch.exportName ?? patch.constName) as string | undefined;
  const array = (patch.arrayProp as string | undefined) ?? "";
  return `${patch.file}|${String(name)}|${array}`;
}

/** The row a table patch becomes. */
export function entryOf(
  patch: Patch,
  spec: TableSpec
): Record<string, unknown> {
  const when = patch.when === undefined ? {} : { when: patch.when };
  switch (patch.kind) {
    case "plugin-array": {
      return {
        table: spec.id,
        call: patch.call,
        import: patch.import,
        ...when,
      };
    }
    case "chained-route": {
      return {
        table: spec.id,
        path: patch.path,
        call: patch.call,
        import: patch.import,
        ...when,
      };
    }
    case "const-array": {
      const entry = patch.entry as Record<string, unknown>;
      // `DEPLOY_TARGETS` already orders its rows; the row keeps that order.
      const order =
        spec.id === "tooling.deployTargets" && typeof entry.order === "number"
          ? { order: entry.order }
          : {};
      return { table: spec.id, entry, ...order, ...when };
    }
    case "nav-entry": {
      return {
        table: spec.id,
        area: patch.area,
        group: patch.group,
        entry: patch.entry,
        import: patch.icon,
        ...when,
      };
    }
    default: {
      throw new Error(`not a table patch: ${patch.kind}`);
    }
  }
}

/** A table declaration as a descriptor holds it. */
function declarationOf(spec: TableSpec): Record<string, unknown> {
  return {
    id: spec.id,
    file: spec.file,
    shape: spec.shape,
    ...(spec.type === undefined ? {} : { type: spec.type }),
  };
}

/** Rows of `rows` not already in `list`, compared by structure. */
function newRows(
  list: Record<string, unknown>[] | undefined,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set((list ?? []).map((row) => JSON.stringify(row)));
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const EDIT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/**
 * Insert `key` with `value` after the first of `after` the object holds, or at its end.
 * jsonc-parser rewrites only the touched region, so the rest keeps its layout.
 */
function insertKey(
  text: string,
  key: string,
  value: unknown,
  after: string[]
): string {
  const keys = Object.keys(JSON.parse(text) as object);
  const anchor = after.find((candidate) => keys.includes(candidate));
  const at = anchor === undefined ? keys.length : keys.indexOf(anchor) + 1;
  return applyEdits(
    text,
    modify(text, [key], value, { ...EDIT, getInsertionIndex: () => at })
  );
}

/** Append each of `values` to the array at `key`. */
function appendAll(text: string, key: string, values: unknown[]): string {
  let out = text;
  for (const value of values) {
    out = applyEdits(
      out,
      modify(out, [key, -1], value, { ...EDIT, isArrayInsertion: true })
    );
  }
  return out;
}

export interface ConvertResult {
  /** The descriptor text after the conversion. */
  text: string;
  /** How many table patches it held. */
  converted: number;
}

/**
 * Convert one module's descriptor text. Pure. The table patches leave `patches` (the key
 * goes once it is empty), the module's rows land in `entries`, and the tables it owns in
 * `tables`, both after `patches` or `files`.
 */
export function convertDescriptor(raw: string): ConvertResult {
  const descriptor = JSON.parse(raw) as Descriptor;
  const name = descriptor.name ?? "";
  const patches = descriptor.patches ?? [];
  const rows: Record<string, unknown>[] = [];
  const drop: number[] = [];
  for (const [index, patch] of patches.entries()) {
    if (!(TABLE_KINDS as readonly string[]).includes(patch.kind)) {
      continue;
    }
    const spec = TABLES[tableKey(patch)];
    if (spec === undefined) {
      throw new Error(
        `${name}: a ${patch.kind} patch names table ${tableKey(patch)}, which TABLES does not hold. Add it to scripts/convert-tables.ts.`
      );
    }
    rows.push(entryOf(patch, spec));
    drop.push(index);
  }
  rows.push(...(EXTRA_ENTRIES[name] ?? []));

  let text = raw;
  for (const index of drop.toReversed()) {
    text = applyEdits(text, modify(text, ["patches", index], undefined, EDIT));
  }
  if (drop.length > 0 && drop.length === patches.length) {
    text = applyEdits(text, modify(text, ["patches"], undefined, EDIT));
  }
  const declared = new Set((descriptor.tables ?? []).map((table) => table.id));
  const owned = Object.values(TABLES)
    .filter((spec) => spec.owner === name && !declared.has(spec.id))
    .map(declarationOf);
  const anchors = ["patches", "files"];
  if (owned.length > 0) {
    text =
      descriptor.tables === undefined
        ? insertKey(text, "tables", owned, anchors)
        : appendAll(text, "tables", owned);
  }
  const added = newRows(descriptor.entries, rows);
  if (added.length > 0) {
    text =
      descriptor.entries === undefined
        ? insertKey(text, "entries", added, ["tables", ...anchors])
        : appendAll(text, "entries", added);
  }
  const after = JSON.parse(text) as Descriptor & {
    requires?: { saasaloy?: string };
  };
  if (
    (after.tables !== undefined || after.entries !== undefined) &&
    after.requires?.saasaloy !== TABLES_FLOOR
  ) {
    text = applyEdits(
      text,
      modify(text, ["requires", "saasaloy"], TABLES_FLOOR, EDIT)
    );
  }
  return { converted: drop.length, text };
}

/** The base template's declaration text with its tables. Pure. */
export function convertBase(raw: string): string {
  const owned = Object.values(TABLES)
    .filter((spec) => spec.owner === "base")
    .map(declarationOf);
  return applyEdits(raw, modify(raw, ["tables"], owned, EDIT));
}

async function format(path: string, text: string): Promise<string> {
  const options = (await prettier.resolveConfig(path)) ?? {};
  return prettier.format(text, { ...options, filepath: path });
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  let total = 0;
  let left = 0;
  for (const name of readdirSync(MODULES).toSorted()) {
    const path = join(MODULES, name, "registry-item.json");
    if (!existsSync(path)) {
      continue;
    }
    const raw = readFileSync(path, "utf-8");
    const { converted, text: next } = convertDescriptor(raw);
    total += converted;
    if (check) {
      left += converted;
      continue;
    }
    const text = await format(path, next);
    if (text !== raw) {
      writeFileSync(path, text);
    }
  }
  if (!check) {
    const raw = readFileSync(BASE_DECLARATION, "utf-8");
    const text = await format(BASE_DECLARATION, convertBase(raw));
    if (text !== raw) {
      writeFileSync(BASE_DECLARATION, text);
    }
  }
  if (check) {
    process.stdout.write(`table patches left: ${String(left)}\n`);
    return left === 0 ? 0 : 1;
  }
  process.stdout.write(
    `converted ${String(total)} table patches into entries; ${String(Object.keys(TABLES).length)} tables\n`
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
