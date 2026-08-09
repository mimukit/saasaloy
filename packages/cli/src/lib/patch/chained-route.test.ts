import { parseModule } from "magicast";
import { describe, expect, it } from "vitest";
import {
  chainedRouteInsertRefusal,
  chainedRouteRemoveRefusal,
  insertChainedRoute,
  removeChainedRoute,
} from "./chained-route.js";
import type { ChainedRoute } from "./chained-route.js";

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

describe(insertChainedRoute, () => {
  it("appends the .route() link and adds its named import", () => {
    const out = insertChainedRoute(ENTRY, WAITLIST);
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(out).toContain('from "./routes/waitlist.js"');
    // The surrounding module is preserved.
    expect(out).toContain("new Hono()");
    expect(out).toContain("export type AppType = typeof app;");
    expect(out).toContain("export default app;");
    expect(parses(out)).toBeTruthy();
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
    expect(parses(out)).toBeTruthy();
  });

  it("extends a named export's chain, not just the default one", () => {
    const named = `import { Hono } from "hono";

export const app = new Hono();
`;
    const out = insertChainedRoute(named, { ...WAITLIST, exportName: "app" });
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(parses(out)).toBeTruthy();
  });

  it("extends the exported expression directly when it is the chain itself", () => {
    const inline = `import { Hono } from "hono";

export default new Hono();
`;
    const out = insertChainedRoute(inline, WAITLIST);
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(parses(out)).toBeTruthy();
  });

  it("leaves the source untouched when the named export is absent", () => {
    expect(insertChainedRoute(ENTRY, { ...WAITLIST, exportName: "nope" })).toBe(
      ENTRY
    );
  });

  it("writes no anchor or sentinel comment (ADR 0006)", () => {
    const out = insertChainedRoute(ENTRY, WAITLIST);
    expect(out).not.toContain("saasaloy");
    expect(out.match(/\/\//g) ?? []).toHaveLength(0);
  });

  // magicast keys imports by local name, so presence alone is not proof the binding is
  // the one this patch needs. Wiring the route anyway is the silent-wrong-handler bug.
  it("refuses when the local name is already imported from another module", () => {
    const legacy = `import { Hono } from "hono";
import { waitlist } from "./legacy.js";

const app = new Hono();

export default app;
`;
    expect(insertChainedRoute(legacy, WAITLIST)).toBe(legacy);
    const refusal = chainedRouteInsertRefusal(legacy, WAITLIST);
    expect(refusal).toContain("./legacy.js");
    expect(refusal).toContain("/waitlist");
  });

  it("refuses when the local name is held by a default import", () => {
    const asDefault = `import { Hono } from "hono";
import waitlist from "./legacy.js";

const app = new Hono();

export default app;
`;
    expect(insertChainedRoute(asDefault, WAITLIST)).toBe(asDefault);
    expect(chainedRouteInsertRefusal(asDefault, WAITLIST)).toContain(
      "default import"
    );
  });

  it("refuses when the local name is held by a renamed specifier", () => {
    const renamed = `import { Hono } from "hono";
import { legacyWaitlist as waitlist } from "./routes/waitlist.js";

const app = new Hono();

export default app;
`;
    expect(insertChainedRoute(renamed, WAITLIST)).toBe(renamed);
    expect(chainedRouteInsertRefusal(renamed, WAITLIST)).toContain(
      "legacyWaitlist"
    );
  });

  it("reuses the binding when the existing import is the one it needs", () => {
    const same = `import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono();

export default app;
`;
    const out = insertChainedRoute(same, WAITLIST);
    expect(out).toContain('.route("/waitlist", waitlist)');
    expect(out.match(/routes\/waitlist\.js/g) ?? []).toHaveLength(1);
    expect(chainedRouteInsertRefusal(same, WAITLIST)).toBeUndefined();
    expect(parses(out)).toBeTruthy();
  });

  it("reports no refusal for an idempotent no-op or an absent export", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(chainedRouteInsertRefusal(applied, WAITLIST)).toBeUndefined();
    expect(
      chainedRouteInsertRefusal(ENTRY, { ...WAITLIST, exportName: "nope" })
    ).toBeUndefined();
  });
});

describe(removeChainedRoute, () => {
  it("drops the .route() link and its import, leaving a file that still parses", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    const out = removeChainedRoute(applied, WAITLIST);
    expect(out).not.toContain("waitlist");
    expect(out).toContain("new Hono()");
    expect(out).toContain("export default app;");
    expect(parses(out)).toBeTruthy();
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
    expect(parses(out)).toBeTruthy();
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
    expect(parses(out)).toBeTruthy();
  });

  it("still drops the link when the import was already removed by hand", () => {
    const noImport = `import { Hono } from "hono";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    const out = removeChainedRoute(noImport, WAITLIST);
    expect(out).not.toContain(".route(");
    expect(out).toContain("const app = new Hono();");
    expect(parses(out)).toBeTruthy();
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
    expect(parses(out)).toBeTruthy();
  });

  it("leaves the source untouched when the link is already gone (never force-edit)", () => {
    expect(removeChainedRoute(ENTRY, WAITLIST)).toBe(ENTRY);
  });

  it("leaves the source untouched when the named export is absent", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(
      removeChainedRoute(applied, { ...WAITLIST, exportName: "nope" })
    ).toBe(applied);
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
    expect(parses(out)).toBeTruthy();
  });

  // The path is the lookup key, not proof of ownership. A route the user repointed is
  // theirs, and deleting it would be the "silently delete drifted content" failure.
  it("leaves a route the user repointed at their own handler", () => {
    const repointed = `import { Hono } from "hono";
import { myWaitlist } from "./mine.js";

const app = new Hono().route("/waitlist", myWaitlist);

export default app;
`;
    expect(removeChainedRoute(repointed, WAITLIST)).toBe(repointed);
    const refusal = chainedRouteRemoveRefusal(repointed, WAITLIST);
    expect(refusal).toContain("myWaitlist");
    expect(refusal).toContain("/waitlist");
  });

  it("leaves a route whose handler is now an inline expression", () => {
    const inline = `import { Hono } from "hono";

const app = new Hono().route("/waitlist", new Hono());

export default app;
`;
    expect(removeChainedRoute(inline, WAITLIST)).toBe(inline);
    expect(chainedRouteRemoveRefusal(inline, WAITLIST)).toContain(
      "inline expression"
    );
  });

  it("removes a route recorded against a dotted handler", () => {
    const dotted = `import { Hono } from "hono";
import { routes } from "./routes/index.js";

const app = new Hono().route("/waitlist", routes.waitlist);

export default app;
`;
    const patch: ChainedRoute = {
      exportName: "default",
      path: "/waitlist",
      call: "routes.waitlist",
      import: { name: "routes", from: "./routes/index.js" },
    };
    expect(chainedRouteRemoveRefusal(dotted, patch)).toBeUndefined();
    const out = removeChainedRoute(dotted, patch);
    expect(out).not.toContain('.route("/waitlist"');
    expect(parses(out)).toBeTruthy();
  });

  // The link can read exactly as written and still mean something else: repointing the
  // import changes what the identifier resolves to. Deleting the import here would take
  // out a line the user rewrote.
  it("leaves the link alone when the user repointed its import", () => {
    const repointedImport = `import { Hono } from "hono";
import { waitlist } from "./mine.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    expect(removeChainedRoute(repointedImport, WAITLIST)).toBe(repointedImport);
    const refusal = chainedRouteRemoveRefusal(repointedImport, WAITLIST);
    expect(refusal).toContain("./mine.js");
    expect(refusal).toContain("./routes/waitlist.js");
  });

  it("leaves the link alone when the import became a default or namespace binding", () => {
    for (const line of [
      'import waitlist from "./routes/waitlist.js";',
      'import * as waitlist from "./routes/waitlist.js";',
    ]) {
      const source = `import { Hono } from "hono";
${line}

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
      expect(removeChainedRoute(source, WAITLIST)).toBe(source);
      expect(chainedRouteRemoveRefusal(source, WAITLIST)).toBeDefined();
    }
  });

  it("still removes a link whose import is absent entirely", () => {
    const noImport = `import { Hono } from "hono";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    expect(chainedRouteRemoveRefusal(noImport, WAITLIST)).toBeUndefined();
    expect(removeChainedRoute(noImport, WAITLIST)).not.toContain(
      '.route("/waitlist"'
    );
  });

  it("reports no refusal when the link is already gone", () => {
    expect(chainedRouteRemoveRefusal(ENTRY, WAITLIST)).toBeUndefined();
  });
});

describe("trailing newline", () => {
  it("keeps the terminator on insert", () => {
    expect(insertChainedRoute(ENTRY, WAITLIST).endsWith("\n")).toBeTruthy();
  });

  it("keeps the terminator on remove", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(removeChainedRoute(applied, WAITLIST).endsWith("\n")).toBeTruthy();
  });

  it("an add → remove round trip is byte-identical, last byte included", () => {
    const applied = insertChainedRoute(ENTRY, WAITLIST);
    expect(removeChainedRoute(applied, WAITLIST)).toBe(ENTRY);
  });

  it("does not add a terminator to a file that had none", () => {
    const noNewline = ENTRY.slice(0, -1);
    const applied = insertChainedRoute(noNewline, WAITLIST);
    expect(applied.endsWith("\n")).toBeFalsy();
    expect(removeChainedRoute(applied, WAITLIST)).toBe(noNewline);
  });
});
