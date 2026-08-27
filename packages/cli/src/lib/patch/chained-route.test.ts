import { parseModule } from "magicast";
import { describe, expect, it } from "vitest";
import { insertChainedRoute, removeChainedRoute, type ChainedRoute } from "./chained-route.js";

// The Hono RPC entry shape: a router built once, extended by `.route()` links, exported
// so `typeof app` can be published as the client's AppType. A feature module adds its
// own link; `remove` takes it back out and the file still compiles.
const ENTRY = `import { Hono } from "hono";

const app = new Hono();

export type AppType = typeof app;
export default app;
`;

const WAITLIST: ChainedRoute = {
  exportName: "default",
  path: "/waitlist",
  call: "waitlist",
  import: { name: "waitlist", from: "./routes/waitlist.js" },
};

// Round-trips the output through the parser: a codemod that emits code the parser
// rejects would still pass a substring assertion.
function parses(code: string): boolean {
  try {
    parseModule(code);
    return true;
  } catch {
    return false;
  }
}

describe("insertChainedRoute", () => {
  it("appends the .route() link and adds its named import", () => {
    const out = insertChainedRoute(ENTRY, WAITLIST);
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(out).toContain('from "./routes/waitlist.js"');
    // The surrounding module is preserved.
    expect(out).toContain("new Hono()");
    expect(out).toContain("export type AppType = typeof app;");
    expect(out).toContain("export default app;");
    expect(parses(out)).toBe(true);
  });

  it("is idempotent and formatting-safe: a second run equals the first byte-for-byte", () => {
    const once = insertChainedRoute(ENTRY, WAITLIST);
    const twice = insertChainedRoute(once, WAITLIST);
    expect(twice).toBe(once);
  });

  it("leaves the source untouched when the path is already routed", () => {
    const already = `import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    expect(insertChainedRoute(already, WAITLIST)).toBe(already);
  });

  it("does not duplicate an import that already exists", () => {
    const out = insertChainedRoute(ENTRY, WAITLIST);
    expect(out.match(/routes\/waitlist\.js/g) ?? []).toHaveLength(1);
  });

  it("appends to an existing chain, keeping the earlier links", () => {
    const withBilling = `import { Hono } from "hono";
import { billing } from "./routes/billing.js";

const app = new Hono().route("/billing", billing);

export default app;
`;
    const out = insertChainedRoute(withBilling, WAITLIST);
    expect(out).toContain('.route("/billing", billing)');
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(out.indexOf('"/billing"')).toBeLessThan(out.indexOf('"/waitlist"'));
    expect(parses(out)).toBe(true);
  });

  it("extends a named export's chain, not just the default one", () => {
    const named = `import { Hono } from "hono";

export const app = new Hono();
`;
    const out = insertChainedRoute(named, { ...WAITLIST, exportName: "app" });
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(parses(out)).toBe(true);
  });

  it("extends the exported expression directly when it is the chain itself", () => {
    const inline = `import { Hono } from "hono";

export default new Hono();
`;
    const out = insertChainedRoute(inline, WAITLIST);
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(parses(out)).toBe(true);
  });

  it("leaves the source untouched when the named export is absent", () => {
    expect(insertChainedRoute(ENTRY, { ...WAITLIST, exportName: "nope" })).toBe(ENTRY);
  });

  it("writes no anchor or sentinel comment (ADR 0006)", () => {
    const out = insertChainedRoute(ENTRY, WAITLIST);
    expect(out).not.toContain("saasaloy");
    expect(out.match(/\/\//g) ?? []).toHaveLength(0);
  });
});

describe("removeChainedRoute", () => {
  it("drops the .route() link and its import, leaving a file that still parses", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    const out = removeChainedRoute(applied, WAITLIST);
    expect(out).not.toContain("waitlist");
    expect(out).toContain("new Hono()");
    expect(out).toContain("export default app;");
    expect(parses(out)).toBe(true);
  });

  it("leaves the bare receiver behind when it removes the only link", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    const out = removeChainedRoute(applied, WAITLIST);
    expect(out).toContain("const app = new Hono();");
    expect(out).toContain("export type AppType = typeof app;");
  });

  it("removes only the matched link, keeping its siblings", () => {
    const both = `import { Hono } from "hono";
import { billing } from "./routes/billing.js";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/billing", billing).route("/waitlist", waitlist);

export default app;
`;
    const out = removeChainedRoute(both, WAITLIST);
    expect(out).toContain('.route("/billing", billing)');
    expect(out).not.toContain("/waitlist");
    expect(out).toContain('from "./routes/billing.js"');
    expect(parses(out)).toBe(true);
  });

  it("removes a link from the middle of a chain", () => {
    const three = `import { Hono } from "hono";
import { a } from "./routes/a.js";
import { b } from "./routes/b.js";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/a", a).route("/waitlist", waitlist).route("/b", b);

export default app;
`;
    const out = removeChainedRoute(three, WAITLIST);
    expect(out).toContain('.route("/a", a)');
    expect(out).toContain('.route("/b", b)');
    expect(out).not.toContain("/waitlist");
    expect(parses(out)).toBe(true);
  });

  it("still drops the link when the import was already removed by hand", () => {
    const noImport = `import { Hono } from "hono";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    const out = removeChainedRoute(noImport, WAITLIST);
    expect(out).not.toContain(".route(");
    expect(out).toContain("const app = new Hono();");
    expect(parses(out)).toBe(true);
  });

  it("keeps the import statement when other specifiers still use it", () => {
    const shared = `import { Hono } from "hono";
import { waitlist, waitlistSchema } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    const out = removeChainedRoute(shared, WAITLIST);
    expect(out).toContain("waitlistSchema");
    expect(out).toContain('from "./routes/waitlist.js"');
    expect(out).not.toContain('.route("/waitlist"');
    expect(parses(out)).toBe(true);
  });

  it("leaves the source untouched when the link is already gone (never force-edit)", () => {
    expect(removeChainedRoute(ENTRY, WAITLIST)).toBe(ENTRY);
  });

  it("leaves the source untouched when the named export is absent", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(removeChainedRoute(applied, { ...WAITLIST, exportName: "nope" })).toBe(applied);
  });

  it("is idempotent: a second removal is a no-op", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    const once = removeChainedRoute(applied, WAITLIST);
    expect(removeChainedRoute(once, WAITLIST)).toBe(once);
  });

  it("keeps the import when the identifier is still referenced elsewhere", () => {
    const alsoUsed = `import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);
app.use(waitlist.middleware);

export default app;
`;
    const out = removeChainedRoute(alsoUsed, WAITLIST);
    expect(out).not.toContain('.route("/waitlist"');
    expect(out).toContain("app.use(waitlist.middleware)");
    // Dropping the import here would leave `waitlist.middleware` unbound.
    expect(out).toContain('from "./routes/waitlist.js"');
    expect(parses(out)).toBe(true);
  });
});

describe("trailing newline", () => {
  it("keeps the terminator on insert", () => {
    expect(insertChainedRoute(ENTRY, WAITLIST).endsWith("\n")).toBe(true);
  });

  it("keeps the terminator on remove", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(removeChainedRoute(applied, WAITLIST).endsWith("\n")).toBe(true);
  });

  it("an add → remove round trip is byte-identical, last byte included", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(removeChainedRoute(applied, WAITLIST)).toBe(ENTRY);
  });

  it("does not add a terminator to a file that had none", () => {
    const noNewline = ENTRY.slice(0, -1);
    const applied = insertChainedRoute(noNewline, WAITLIST);
    expect(applied.endsWith("\n")).toBe(false);
    expect(removeChainedRoute(applied, WAITLIST)).toBe(noNewline);
  });
});
