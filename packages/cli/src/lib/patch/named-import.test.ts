import { describe, expect, it } from "vitest";
import { format } from "prettier";
import {
  ensureNamedImport,
  importedElsewhere,
  removeNamedImport,
} from "./named-import.js";

const ICONS = { name: "UsersIcon", from: "lucide-react" } as const;

describe(ensureNamedImport, () => {
  it("adds a whole declaration to a file that imports nothing", () => {
    expect(ensureNamedImport("export const x = 1;\n", ICONS)).toBe(
      'import { UsersIcon } from "lucide-react";\n\nexport const x = 1;\n'
    );
  });

  it("adds the declaration after the last import there is", () => {
    const source = 'import { a } from "./a.js";\n\nexport const x = 1;\n';
    expect(ensureNamedImport(source, ICONS)).toBe(
      'import { a } from "./a.js";\nimport { UsersIcon } from "lucide-react";\n\nexport const x = 1;\n'
    );
  });

  it("inserts into the existing declaration, in alphabetical position", () => {
    const source = 'import { GaugeIcon, ZapIcon } from "lucide-react";\n';
    expect(ensureNamedImport(source, ICONS)).toBe(
      'import { GaugeIcon, UsersIcon, ZapIcon } from "lucide-react";\n'
    );
  });

  it("is a no-op when the specifier is already there", () => {
    const source = 'import { UsersIcon } from "lucide-react";\n';
    expect(ensureNamedImport(source, ICONS)).toBe(source);
  });

  it("keeps a default specifier ahead of the braces", () => {
    const source = 'import React, { useState } from "react";\n';
    expect(
      ensureNamedImport(source, { name: "useEffect", from: "react" })
    ).toBe('import React, { useEffect, useState } from "react";\n');
  });

  it("sorts an aliased specifier by its local name", () => {
    const source = 'import { ZapIcon as AlertIcon } from "lucide-react";\n';
    expect(ensureNamedImport(source, ICONS)).toBe(
      'import { ZapIcon as AlertIcon, UsersIcon } from "lucide-react";\n'
    );
  });

  it("leaves an `import type` declaration alone and adds its own", () => {
    const source = 'import type { Theme } from "./theme.js";\n';
    expect(
      ensureNamedImport(source, { name: "setTheme", from: "./theme.js" })
    ).toBe(
      'import type { Theme } from "./theme.js";\nimport { setTheme } from "./theme.js";\n'
    );
  });

  it("wraps past 80 columns, the way prettier does", async () => {
    const source =
      'import { AlarmClockIcon, BadgeCheckIcon, CircleUserIcon } from "lucide-react";\n';
    const out = ensureNamedImport(source, ICONS);
    expect(out).toBe(
      `import {\n  AlarmClockIcon,\n  BadgeCheckIcon,\n  CircleUserIcon,\n  UsersIcon,\n} from "lucide-react";\n`
    );
    await expect(format(out, { parser: "typescript" })).resolves.toBe(out);
  });
});

describe(removeNamedImport, () => {
  it("drops the whole declaration when the specifier was the only one", () => {
    const source =
      'import { UsersIcon } from "lucide-react";\n\nexport const x = 1;\n';
    expect(removeNamedImport(source, ICONS)).toBe("\nexport const x = 1;\n");
  });

  it("drops one specifier and leaves the rest", () => {
    const source = 'import { GaugeIcon, UsersIcon } from "lucide-react";\n';
    expect(removeNamedImport(source, ICONS)).toBe(
      'import { GaugeIcon } from "lucide-react";\n'
    );
  });

  it("unwraps back to one line once the rest fits", () => {
    const wrapped = `import {\n  AlarmClockIcon,\n  BadgeCheckIcon,\n  CircleUserIcon,\n  UsersIcon,\n} from "lucide-react";\n`;
    expect(removeNamedImport(wrapped, ICONS)).toBe(
      'import { AlarmClockIcon, BadgeCheckIcon, CircleUserIcon } from "lucide-react";\n'
    );
  });

  it("keeps the import when the file still references the name", () => {
    const source =
      'import { GaugeIcon, UsersIcon } from "lucide-react";\n\nexport const icon = UsersIcon;\n';
    expect(removeNamedImport(source, ICONS)).toBe(source);
  });

  it("keeps an aliased binding, which is not the one that was added", () => {
    const source = 'import { UsersIcon as People } from "lucide-react";\n';
    expect(removeNamedImport(source, ICONS)).toBe(source);
  });

  it("is a no-op when the specifier is already gone", () => {
    const source = 'import { GaugeIcon } from "lucide-react";\n';
    expect(removeNamedImport(source, ICONS)).toBe(source);
  });
});

describe(importedElsewhere, () => {
  it("is false for the named import this would have written", () => {
    expect(
      importedElsewhere('import { UsersIcon } from "lucide-react";\n', ICONS)
    ).toBeFalsy();
  });

  it("is false when nothing binds the name", () => {
    expect(importedElsewhere("export const x = 1;\n", ICONS)).toBeFalsy();
  });

  it.each([
    ['import UsersIcon from "./logo.js";\n', "a default import"],
    ['import { UsersIcon } from "./logo.js";\n', "another module"],
    ['import { PeopleIcon as UsersIcon } from "lucide-react";\n', "an alias"],
  ])("is true when the name is %s", (source) => {
    expect(importedElsewhere(source, ICONS)).toBeTruthy();
  });
});
