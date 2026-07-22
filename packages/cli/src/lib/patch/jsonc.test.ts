import { describe, expect, it } from "vitest";
import { upsertWranglerBinding } from "./jsonc.js";

const WRANGLER = `{
  // Cloudflare Worker config
  "name": "api",
  "compatibility_date": "2024-09-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "abc-123" }
  ]
}
`;

describe("upsertWranglerBinding", () => {
  it("appends a new binding to an existing array, keeping comments and prior entries", () => {
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "kv_namespaces",
      entry: { binding: "CACHE", id: "kv-1" },
    });
    // The freshly created array holds the new binding...
    expect(out).toContain("kv_namespaces");
    expect(out).toContain("CACHE");
    // ...and nothing about the original file was lost.
    expect(out).toContain("// Cloudflare Worker config");
    expect(out).toContain("app-db");
  });

  it("appends into an existing array of the same type without dropping siblings", () => {
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "d1_databases",
      entry: { binding: "ANALYTICS", database_name: "an-db", database_id: "xyz-789" },
    });
    expect(out).toContain("DB");
    expect(out).toContain("ANALYTICS");
    // Both entries parse back as an array of two.
    const parsed = JSON.parse(stripComments(out)) as { d1_databases: unknown[] };
    expect(parsed.d1_databases).toHaveLength(2);
  });

  it("is idempotent: re-inserting an already-present binding returns the source byte-for-byte", () => {
    const entry = { binding: "DB", database_name: "app-db", database_id: "abc-123" };
    const once = upsertWranglerBinding(WRANGLER, { bindingType: "d1_databases", entry });
    const twice = upsertWranglerBinding(once, { bindingType: "d1_databases", entry });
    expect(twice).toBe(once);
  });

  it("never clobbers: a binding whose match key already exists is left untouched", () => {
    // Same `binding` name ("DB") but a different database_id — must NOT overwrite.
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "d1_databases",
      entry: { binding: "DB", database_name: "hijacked", database_id: "evil" },
    });
    expect(out).toBe(WRANGLER);
    expect(out).not.toContain("hijacked");
  });

  it("honors a custom matchOn key (e.g. wrangler routes keyed by pattern)", () => {
    const withRoute = upsertWranglerBinding(WRANGLER, {
      bindingType: "routes",
      entry: { pattern: "api.example.com", custom_domain: true },
      matchOn: "pattern",
    });
    const again = upsertWranglerBinding(withRoute, {
      bindingType: "routes",
      entry: { pattern: "api.example.com", custom_domain: true },
      matchOn: "pattern",
    });
    expect(again).toBe(withRoute);
    expect(withRoute).toContain("api.example.com");
  });
});

// Cheap JSONC → JSON for assertions: drop `//` line comments. Good enough for the
// controlled fixtures above (no `//` inside string values).
function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s*\/\/.*$/, ""))
    .join("\n");
}
