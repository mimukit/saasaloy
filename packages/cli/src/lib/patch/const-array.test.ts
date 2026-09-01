import { describe, expect, it } from "vitest";
import { format } from "prettier";
import {
  constArrayInsertRefusal,
  insertIntoConstArray,
  removeFromConstArray,
} from "./const-array.js";

const NAV = `import { LayoutDashboardIcon } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
] as const;
`;

const TEAMS = {
  constName: "NAV_ITEMS",
  key: "to",
  entry: { to: "/teams", label: "Teams" },
} as const;

describe(insertIntoConstArray, () => {
  it("appends an object literal to the named const array", () => {
    const out = insertIntoConstArray(NAV, TEAMS);
    expect(out).toContain('to: "/teams"');
    expect(out).toContain('label: "Teams"');
    expect(out).toContain("LayoutDashboardIcon");
  });

  it("is a byte-for-byte no-op on a second append", () => {
    const once = insertIntoConstArray(NAV, TEAMS);
    expect(insertIntoConstArray(once, TEAMS)).toBe(once);
  });

  it("leaves the source untouched when the named const is absent", () => {
    expect(insertIntoConstArray("const OTHER = [];\n", TEAMS)).toBe(
      "const OTHER = [];\n"
    );
  });

  it("matches only the key when a user edits another property", () => {
    const edited = NAV.replace(
      "] as const;",
      '  { to: "/teams", label: "My teams" },\n] as const;'
    );
    expect(insertIntoConstArray(edited, TEAMS)).toBe(edited);
  });

  it("emits Prettier-compatible object layout and keeps the final newline", async () => {
    const out = insertIntoConstArray(NAV, TEAMS);
    expect(out).toContain('  { to: "/teams", label: "Teams" },\n] as const;');
    expect(out.endsWith("\n")).toBeTruthy();
    await expect(format(out, { parser: "typescript" })).resolves.toBe(out);
  });

  it("explains a missing named const without changing it", () => {
    const source = "const OTHER = [];\n";
    expect(insertIntoConstArray(source, TEAMS)).toBe(source);
    expect(constArrayInsertRefusal(source, TEAMS)).toContain("NAV_ITEMS");
  });
});

describe(removeFromConstArray, () => {
  it("removes the object with the recorded key and value", () => {
    const applied = insertIntoConstArray(NAV, TEAMS);
    const out = removeFromConstArray(applied, TEAMS);
    expect(out).toBe(NAV);
  });

  it("removes an entry after a user edits a non-key property", () => {
    const applied = insertIntoConstArray(NAV, TEAMS).replace(
      'label: "Teams"',
      'label: "My teams"'
    );
    expect(removeFromConstArray(applied, TEAMS)).toBe(NAV);
  });

  it("is a no-op when the keyed entry is already absent", () => {
    expect(removeFromConstArray(NAV, TEAMS)).toBe(NAV);
  });
});
