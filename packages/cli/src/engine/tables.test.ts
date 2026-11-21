import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBaseDeclaration } from "../lib/base.js";
import { RefusalError } from "../lib/exit.js";
import type { RegistryEntry, RegistryTable } from "../lib/schema.js";
import {
  GENERATED_HEADER,
  exportName,
  printString,
  printTableFile,
  renderTables,
  sortEntries,
} from "./tables.js";
import type { PlacedEntry, ResolvedTable } from "./tables.js";

// The options of the project's Prettier (Ultracite's config), minus its plugins, which
// touch neither a `.ts` file's layout nor anything a generated table prints.
const PRETTIER = {
  arrowParens: "always",
  bracketSpacing: true,
  parser: "typescript",
  printWidth: 80,
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
} as const;

async function prettierFormat(source: string): Promise<string> {
  const prettier = await import("prettier");
  return prettier.format(source, PRETTIER);
}

function resolved(table: RegistryTable, owner = "owner"): ResolvedTable {
  return { owner, path: "src/x.generated.ts", table };
}

function rows(
  table: string,
  list: (Omit<RegistryEntry, "table"> & { module?: string })[]
): Map<string, PlacedEntry[]> {
  return new Map([
    [
      table,
      list.map(({ module, ...entry }) => ({
        entry: { table, ...entry },
        module: module ?? "mod",
      })),
    ],
  ]);
}

const call = (name: string, from = `./providers/${name}`) => ({
  call: name,
  import: { from, name },
});

describe(exportName, () => {
  it("joins the id in camelCase", () => {
    expect(exportName("email.providers")).toBe("emailProviders");
    expect(exportName("adminAuth.plugins")).toBe("adminAuthPlugins");
    expect(exportName("tooling.deployTargets")).toBe("toolingDeployTargets");
  });
});

describe(sortEntries, () => {
  it("sorts by order, then module name, and keeps one module's rows in order", () => {
    const placed: PlacedEntry[] = [
      { entry: { call: "z1", table: "t" }, module: "zeta" },
      { entry: { call: "b2", table: "t" }, module: "beta" },
      { entry: { call: "a1", order: 5, table: "t" }, module: "alpha" },
      { entry: { call: "b1", table: "t" }, module: "beta" },
      { entry: { call: "z0", order: 2000, table: "t" }, module: "zeta" },
    ];
    expect(sortEntries(placed).map(({ entry }) => entry.call)).toStrictEqual([
      "a1",
      "b2",
      "b1",
      "z1",
      "z0",
    ]);
  });
});

describe(printString, () => {
  it("picks the quotes Prettier picks", () => {
    expect(printString("ok")).toBe('"ok"');
    expect(printString('"ok"')).toBe(`'"ok"'`);
    expect(printString(`it's "a" "b"`)).toBe(String.raw`'it\'s "a" "b"'`);
  });
});

describe(printTableFile, () => {
  const cases: [string, ResolvedTable[], Map<string, PlacedEntry[]>][] = [
    [
      "an empty calls table",
      [resolved({ file: "x", id: "email.providers", shape: "calls" })],
      new Map(),
    ],
    [
      "a short calls table",
      [resolved({ file: "x", id: "email.providers", shape: "calls" })],
      rows("email.providers", [call("consoleEmail")]),
    ],
    [
      "a long calls table",
      [resolved({ file: "x", id: "auth.plugins", shape: "calls" })],
      rows("auth.plugins", [
        call("apiKeyPlugin", "./plugins/api-key"),
        call("apiKeyScopeGuard", "./plugins/api-key"),
        call("organizationPlugin"),
        call("phoneNumberPlugin"),
      ]),
    ],
    [
      "a typed objects table with quotes in a value",
      [
        resolved({
          file: "x",
          id: "tooling.smokeChecks",
          shape: "objects",
          type: { from: "./types.ts", name: "SmokeCheck" },
        }),
      ],
      rows("tooling.smokeChecks", [
        { entry: { id: "a", path: "/", service: "admin", status: 200 } },
        {
          entry: {
            body: '"ok"',
            id: "api-health",
            path: "/health",
            service: "api",
            status: 200,
          },
        },
      ]),
    ],
    [
      "an objects table of one-property rows",
      [resolved({ file: "x", id: "app.authScreens", shape: "objects" })],
      rows("app.authScreens", [
        { entry: { path: "/phone/sign-in" } },
        { entry: { path: "/phone/sign-up" } },
      ]),
    ],
    [
      "an objects table of nested values",
      [
        resolved({
          file: "x",
          id: "env.services",
          shape: "objects",
          type: { from: "./services.ts", name: "Service" },
        }),
      ],
      rows("env.services", [
        {
          entry: {
            devPort: 4000,
            environment: "dev",
            file: "apps/api/.env",
            name: "api",
            omit: [],
          },
        },
      ]),
    ],
    [
      "a nav table",
      [resolved({ file: "x", id: "admin.nav", shape: "nav" })],
      rows("admin.nav", [
        {
          area: "/",
          entry: { label: "Flags", to: "/flags" },
          group: "Manage",
          import: { from: "lucide-react", name: "FlagIcon" },
        },
        {
          area: "/",
          entry: {
            label: "Subscription",
            shortcut: "G S",
            to: "/subscription",
          },
          group: "Manage",
          import: { from: "lucide-react", name: "CreditCardIcon" },
        },
      ]),
    ],
    [
      "two route tables in one file",
      [
        resolved({ file: "x", id: "api.baseRoutes", shape: "routes" }),
        resolved({ file: "x", id: "api.routes", shape: "routes" }),
      ],
      new Map([
        ...rows("api.baseRoutes", [
          {
            ...call("authRoute", "./routes/auth"),
            path: "/auth",
          },
        ]),
        ...rows("api.routes", [
          { ...call("health", "./routes/health"), path: "/health" },
          { ...call("waitlist", "./routes/waitlist"), path: "/waitlist" },
          { ...call("adminUsers", "./routes/admin-users"), path: "/admin" },
        ]),
      ]),
    ],
    [
      "an empty route table",
      [resolved({ file: "x", id: "api.routes", shape: "routes" })],
      new Map(),
    ],
  ];

  it.each(cases)(
    "prints %s in a layout Prettier keeps",
    async (_, tables, entries) => {
      const printed = printTableFile("src/x.generated.ts", tables, entries);
      expect(printed.startsWith(`${GENERATED_HEADER}\n`)).toBeTruthy();
      await expect(prettierFormat(printed)).resolves.toBe(printed);
    }
  );

  it("prints a short calls table on one line, its import above it", () => {
    expect(
      printTableFile(
        "src/x.generated.ts",
        [resolved({ file: "x", id: "email.providers", shape: "calls" })],
        rows("email.providers", [call("consoleEmail", "./providers/console")])
      )
    ).toBe(
      [
        GENERATED_HEADER,
        'import { consoleEmail } from "./providers/console";',
        "",
        "export const emailProviders = [consoleEmail()];",
        "",
      ].join("\n")
    );
  });

  it("writes a repeated call once", () => {
    const printed = printTableFile(
      "src/x.generated.ts",
      [resolved({ file: "x", id: "email.providers", shape: "calls" })],
      rows("email.providers", [
        call("a", "./a"),
        { ...call("a", "./a"), module: "other" },
      ])
    );
    expect(printed).toContain("export const emailProviders = [a()];");
  });

  it("refuses a row that does not fit the shape", () => {
    expect(() =>
      printTableFile(
        "src/x.generated.ts",
        [resolved({ file: "x", id: "api.routes", shape: "routes" })],
        rows("api.routes", [call("health")])
      )
    ).toThrow(/a routes row needs `path`/);
  });

  it("refuses one name imported from two places", () => {
    expect(() =>
      printTableFile(
        "src/x.generated.ts",
        [resolved({ file: "x", id: "email.providers", shape: "calls" })],
        rows("email.providers", [
          { call: "x", import: { from: "./one", name: "a" } },
          { call: "y", import: { from: "./two", name: "a" } },
        ])
      )
    ).toThrow(RefusalError);
  });
});

describe(renderTables, () => {
  const table: RegistryTable = {
    file: "@email/providers.generated.ts",
    id: "email.providers",
    shape: "calls",
  };

  it("writes each table's file at its resolved path, owned by its module", () => {
    const out = renderTables({
      owners: [{ module: "email", tables: [table] }],
      resolve: (file) => file.replace("@email", "packages/email/src"),
      rows: [
        {
          entries: [{ ...call("consoleEmail"), table: "email.providers" }],
          module: "email-console",
        },
      ],
    });
    expect(out.files.map(({ owner, path }) => ({ owner, path }))).toStrictEqual(
      [{ owner: "email", path: "packages/email/src/providers.generated.ts" }]
    );
    expect(out.files[0]?.content).toContain("consoleEmail()");
    expect(out.warnings).toStrictEqual([]);
  });

  it("warns about a row whose table no module of the set owns", () => {
    const out = renderTables({
      owners: [],
      resolve: (file) => file,
      rows: [
        {
          entries: [{ ...call("consoleEmail"), table: "email.providers" }],
          module: "email-console",
        },
      ],
    });
    expect(out.files).toStrictEqual([]);
    expect(out.warnings).toStrictEqual([
      "email-console: row for table email.providers not written — no module in the set owns that table.",
    ]);
  });

  it("refuses two modules that declare one table", () => {
    expect(() =>
      renderTables({
        owners: [
          { module: "a", tables: [table] },
          { module: "b", tables: [table] },
        ],
        resolve: (file) => file,
        rows: [],
      })
    ).toThrow(/both declare table "email.providers"/);
  });
});

// The template holds the render of each of its tables with no rows, so its own tests can
// import the files that spread them (`isGeneratedFile` in lib/base.ts keeps them out of a
// project). Each one has to stay what the render writes.
describe("the template's generated tables", () => {
  const TEMPLATE = fileURLToPath(
    new URL("../../templates/base/", import.meta.url)
  );

  it("each equals the render of its tables with no rows", async () => {
    const declaration = await readBaseDeclaration(TEMPLATE);
    const config = JSON.parse(
      await readFile(`${TEMPLATE}saasaloy.json`, "utf-8")
    ) as { aliases: Record<string, string> };
    const byFile = new Map<string, ResolvedTable[]>();
    for (const table of declaration.tables ?? []) {
      const slash = table.file.indexOf("/");
      const path = table.file.startsWith("@")
        ? `${config.aliases[table.file.slice(0, slash)] ?? ""}${table.file.slice(slash)}`
        : table.file;
      byFile.set(path, [
        ...(byFile.get(path) ?? []),
        { owner: "base", path, table },
      ]);
    }
    expect(byFile.size).toBeGreaterThan(0);
    for (const [path, tables] of byFile) {
      // oxlint-disable-next-line vitest/valid-expect -- the message names the file
      await expect(readFile(`${TEMPLATE}${path}`, "utf-8"), path).resolves.toBe(
        printTableFile(path, tables, new Map())
      );
    }
  });
});
