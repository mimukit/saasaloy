import { describe, expect, it } from "vitest";
import { format } from "prettier";
import {
  insertNavEntry,
  navEntryInsertRefusal,
  navEntryRemoveRefusal,
  removeNavEntry,
} from "./nav-entry.js";

// The shape the admin module actually ships, trimmed of its comments.
const NAV = `import { GaugeIcon, LayoutDashboardIcon, UsersIcon } from "lucide-react";

export const NAV_AREAS = [
  {
    label: "Admin",
    to: "/",
    icon: LayoutDashboardIcon,
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview", icon: GaugeIcon },
          { to: "/users", label: "Users", icon: UsersIcon },
        ],
      },
    ],
  },
] as const;
`;

const TEAMS = {
  constName: "NAV_AREAS",
  area: "/",
  group: "Manage",
  entry: { to: "/teams", label: "Teams" },
  icon: { name: "UsersRoundIcon", from: "lucide-react" },
} as const;

describe(insertNavEntry, () => {
  it("appends the row to the named group and imports its icon", () => {
    const out = insertNavEntry(NAV, TEAMS);
    expect(out).toContain(
      '{ to: "/teams", label: "Teams", icon: UsersRoundIcon },'
    );
    // Past 80 columns, so prettier would wrap it and so does the codemod.
    expect(out).toContain(
      `import {\n  GaugeIcon,\n  LayoutDashboardIcon,\n  UsersIcon,\n  UsersRoundIcon,\n} from "lucide-react";`
    );
  });

  it("puts the row inside the group, after the rows already there", () => {
    const out = insertNavEntry(NAV, TEAMS);
    expect(out.indexOf('to: "/teams"')).toBeGreaterThan(
      out.indexOf('to: "/users"')
    );
    expect(out.indexOf('to: "/teams"')).toBeLessThan(out.indexOf("] as const"));
  });

  it("writes what prettier would have written", async () => {
    const out = insertNavEntry(NAV, TEAMS);
    await expect(format(out, { parser: "typescript" })).resolves.toBe(out);
  });

  it("is a byte-for-byte no-op on a second apply", () => {
    const once = insertNavEntry(NAV, TEAMS);
    expect(insertNavEntry(once, TEAMS)).toBe(once);
  });

  it("leaves an icon already imported alone", () => {
    const out = insertNavEntry(NAV, {
      ...TEAMS,
      icon: { name: "UsersIcon", from: "lucide-react" },
    });
    expect(out).toContain(
      'import { GaugeIcon, LayoutDashboardIcon, UsersIcon } from "lucide-react";'
    );
    expect(out).toContain("icon: UsersIcon }");
  });

  it("adds a whole import statement when the module is not imported yet", () => {
    const out = insertNavEntry(NAV, {
      ...TEAMS,
      icon: { name: "Teams", from: "@repo/icons" },
    });
    expect(out).toContain('import { Teams } from "@repo/icons";');
  });

  it.each([
    ["the const is absent", { ...TEAMS, constName: "NAV_ITEMS" }],
    ["the area is absent", { ...TEAMS, area: "/reports" }],
  ])("leaves the source untouched when %s", (_case, patch) => {
    expect(insertNavEntry(NAV, patch)).toBe(NAV);
  });

  it("refuses when the icon name is already bound to something else", () => {
    const source = NAV.replace(
      "import { GaugeIcon",
      'import UsersRoundIcon from "./logo.js";\nimport { GaugeIcon'
    );
    expect(insertNavEntry(source, TEAMS)).toBe(source);
    expect(navEntryInsertRefusal(source, TEAMS)).toContain(
      "already bound to something other than"
    );
  });
});

describe("insertNavEntry into a group that does not exist yet", () => {
  const BLOG = {
    constName: "NAV_AREAS",
    area: "/",
    group: "Content",
    entry: { to: "/cms/blog", label: "Blog" },
    icon: { name: "FileTextIcon", from: "lucide-react" },
  } as const;

  it("adds the group after the area's last group, holding the row", () => {
    const out = insertNavEntry(NAV, BLOG);
    expect(out).toContain(
      `      {\n        label: "Content",\n        items: [{ to: "/cms/blog", label: "Blog", icon: FileTextIcon }],\n      },\n    ],\n  },\n] as const;`
    );
    expect(out.indexOf('label: "Content"')).toBeGreaterThan(
      out.indexOf('label: "Manage"')
    );
  });

  it("writes what prettier would have written", async () => {
    const out = insertNavEntry(NAV, BLOG);
    await expect(format(out, { parser: "typescript" })).resolves.toBe(out);
  });

  it("appends a second row to the group it created", async () => {
    const once = insertNavEntry(NAV, BLOG);
    const twice = insertNavEntry(once, {
      ...BLOG,
      entry: { to: "/cms/pages", label: "Pages" },
    });
    expect(twice.match(/label: "Content"/g)).toHaveLength(1);
    expect(twice.indexOf('to: "/cms/pages"')).toBeGreaterThan(
      twice.indexOf('to: "/cms/blog"')
    );
    await expect(format(twice, { parser: "typescript" })).resolves.toBe(twice);
  });

  it("is a byte-for-byte no-op on a second apply", () => {
    const once = insertNavEntry(NAV, BLOG);
    expect(insertNavEntry(once, BLOG)).toBe(once);
  });

  it("does not count a missing group as a refusal", () => {
    expect(navEntryInsertRefusal(NAV, BLOG)).toBeUndefined();
  });

  it("takes the group out again with its last row", () => {
    expect(removeNavEntry(insertNavEntry(NAV, BLOG), BLOG)).toBe(NAV);
  });

  it("keeps the group while another row is still in it", () => {
    const twice = insertNavEntry(insertNavEntry(NAV, BLOG), {
      ...BLOG,
      entry: { to: "/cms/pages", label: "Pages" },
    });
    const out = removeNavEntry(twice, BLOG);
    expect(out).toContain('label: "Content"');
    expect(out).toContain('to: "/cms/pages"');
    expect(out).not.toContain('to: "/cms/blog"');
  });
});

describe(navEntryInsertRefusal, () => {
  it("says nothing about a patch that applies cleanly", () => {
    expect(navEntryInsertRefusal(NAV, TEAMS)).toBeUndefined();
  });

  it.each([
    [{ ...TEAMS, constName: "NAV_ITEMS" }, "const array named NAV_ITEMS"],
    [{ ...TEAMS, area: "/reports" }, 'area with to "/reports"'],
  ])("names what it could not find", (patch, expected) => {
    expect(navEntryInsertRefusal(NAV, patch)).toContain(expected);
  });
});

describe(removeNavEntry, () => {
  it("round trips back to the file it started from", () => {
    expect(removeNavEntry(insertNavEntry(NAV, TEAMS), TEAMS)).toBe(NAV);
  });

  it("keeps the icon import when another row still uses it", () => {
    const once = insertNavEntry(NAV, TEAMS);
    const twice = insertNavEntry(once, {
      ...TEAMS,
      entry: { to: "/teams/invites", label: "Invites" },
    });
    const out = removeNavEntry(twice, TEAMS);
    expect(out).toContain("UsersRoundIcon");
    expect(out).not.toContain('to: "/teams"');
  });

  it("is a no-op on a row that is already gone", () => {
    expect(removeNavEntry(NAV, TEAMS)).toBe(NAV);
    expect(navEntryRemoveRefusal(NAV, TEAMS)).toBeUndefined();
  });

  it("reports a group that is no longer there", () => {
    expect(
      navEntryRemoveRefusal(NAV, { ...TEAMS, group: "Settings" })
    ).toContain('"Settings"');
  });
});
