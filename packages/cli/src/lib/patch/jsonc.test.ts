import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
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

describe(upsertWranglerBinding, () => {
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
      entry: {
        binding: "ANALYTICS",
        database_id: "xyz-789",
        database_name: "an-db",
      },
    });
    expect(out).toContain("DB");
    expect(out).toContain("ANALYTICS");
    // Both entries parse back as an array of two.
    const parsed = JSON.parse(stripComments(out)) as {
      d1_databases: unknown[];
    };
    expect(parsed.d1_databases).toHaveLength(2);
  });

  it("is idempotent: re-inserting an already-present binding returns the source byte-for-byte", () => {
    const entry = {
      binding: "DB",
      database_id: "abc-123",
      database_name: "app-db",
    };
    const once = upsertWranglerBinding(WRANGLER, {
      bindingType: "d1_databases",
      entry,
    });
    const twice = upsertWranglerBinding(once, {
      bindingType: "d1_databases",
      entry,
    });
    expect(twice).toBe(once);
  });

  it("never clobbers: a binding whose match key already exists is left untouched", () => {
    // Same `binding` name ("DB") but a different database_id — must NOT overwrite.
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "d1_databases",
      entry: { binding: "DB", database_id: "evil", database_name: "hijacked" },
    });
    expect(out).toBe(WRANGLER);
    expect(out).not.toContain("hijacked");
  });

  it("supports a bare-string entry (e.g. compatibility_flags), matched by equality", () => {
    const withFlag = upsertWranglerBinding(WRANGLER, {
      bindingType: "compatibility_flags",
      entry: "nodejs_compat",
    });
    expect(withFlag).toContain("nodejs_compat");
    const again = upsertWranglerBinding(withFlag, {
      bindingType: "compatibility_flags",
      entry: "nodejs_compat",
    });
    expect(again).toBe(withFlag);
  });

  it("upserts a send_email binding idempotently under matchOn: 'name'", () => {
    // `send_email` entries are keyed by `name`, not `binding` — the only shipping
    // module that relies on the non-default matchOn (email-cloudflare), so its
    // second-run no-op is worth pinning here rather than in a playground.
    const entry = { name: "EMAIL", remote: true };
    const once = upsertWranglerBinding(WRANGLER, {
      bindingType: "send_email",
      entry,
      matchOn: "name",
    });
    expect(once).toContain("send_email");
    expect(once).toContain("EMAIL");
    expect(once).toContain("// Cloudflare Worker config");

    const twice = upsertWranglerBinding(once, {
      bindingType: "send_email",
      entry,
      matchOn: "name",
    });
    expect(twice).toBe(once);

    // And the array is genuinely one entry, not two that happen to stringify alike.
    const parsed = JSON.parse(stripComments(twice)) as {
      send_email: unknown[];
    };
    expect(parsed.send_email).toStrictEqual([entry]);

    // A *different* `name` must still append. This is what makes the test able to fail:
    // `send_email` entries carry no `binding` key, so under the default matchOn the
    // comparison is `undefined === undefined` for every pair — an implementation that
    // ignored matchOn would see a false match here and silently swallow the second entry.
    const second = { name: "MARKETING", remote: true };
    const both = upsertWranglerBinding(twice, {
      bindingType: "send_email",
      entry: second,
      matchOn: "name",
    });
    const parsedBoth = JSON.parse(stripComments(both)) as {
      send_email: unknown[];
    };
    expect(parsedBoth.send_email).toStrictEqual([entry, second]);
  });

  it("honors a custom matchOn key (e.g. wrangler routes keyed by pattern)", () => {
    const withRoute = upsertWranglerBinding(WRANGLER, {
      bindingType: "routes",
      entry: { custom_domain: true, pattern: "api.example.com" },
      matchOn: "pattern",
    });
    const again = upsertWranglerBinding(withRoute, {
      bindingType: "routes",
      entry: { custom_domain: true, pattern: "api.example.com" },
      matchOn: "pattern",
    });
    expect(again).toBe(withRoute);
    expect(withRoute).toContain("api.example.com");
  });
});

// A dotted `bindingType` addresses a nested array (`queues.producers`,
// `queues.consumers`, `triggers.crons`). ADR 0033 makes it an extension of this kind,
// not a new one, so the round trip has to hold to the byte.
describe("dotted bindingType", () => {
  it("creates the missing parent object and the array under it", () => {
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "queues.producers",
      entry: { binding: "JOBS", queue: "app-jobs" },
    });
    const parsed = JSON.parse(stripComments(out)) as {
      queues: { producers: unknown[] };
    };
    expect(parsed.queues.producers).toStrictEqual([
      { binding: "JOBS", queue: "app-jobs" },
    ]);
    expect(out).toContain("// Cloudflare Worker config");
    expect(out).toContain("app-db");
  });

  it("appends into a nested array that already exists, keeping its siblings", () => {
    const once = upsertWranglerBinding(WRANGLER, {
      bindingType: "queues.producers",
      entry: { binding: "JOBS", queue: "app-jobs" },
    });
    const twice = upsertWranglerBinding(once, {
      bindingType: "queues.producers",
      entry: { binding: "JOBS_DLQ", queue: "app-jobs-dlq" },
    });
    const parsed = JSON.parse(stripComments(twice)) as {
      queues: { producers: { binding: string }[] };
    };
    expect(parsed.queues.producers.map((p) => p.binding)).toStrictEqual([
      "JOBS",
      "JOBS_DLQ",
    ]);
  });

  it("shares a parent object between two different nested arrays", () => {
    const withProducer = upsertWranglerBinding(WRANGLER, {
      bindingType: "queues.producers",
      entry: { binding: "JOBS", queue: "app-jobs" },
    });
    const out = upsertWranglerBinding(withProducer, {
      bindingType: "queues.consumers",
      entry: { max_retries: 3, queue: "app-jobs" },
      matchOn: "queue",
    });
    const parsed = JSON.parse(stripComments(out)) as {
      queues: { consumers: unknown[]; producers: unknown[] };
    };
    expect(parsed.queues.producers).toHaveLength(1);
    expect(parsed.queues.consumers).toHaveLength(1);
  });

  it("is idempotent: re-inserting a nested entry returns the source byte-for-byte", () => {
    const entry = { binding: "JOBS", queue: "app-jobs" };
    const once = upsertWranglerBinding(WRANGLER, {
      bindingType: "queues.producers",
      entry,
    });
    expect(
      upsertWranglerBinding(once, { bindingType: "queues.producers", entry })
    ).toBe(once);
  });

  it("takes a bare string entry at a dotted path (triggers.crons)", () => {
    const out = upsertWranglerBinding(WRANGLER, {
      bindingType: "triggers.crons",
      entry: "* * * * *",
    });
    const parsed = JSON.parse(stripComments(out)) as {
      triggers: { crons: string[] };
    };
    expect(parsed.triggers.crons).toStrictEqual(["* * * * *"]);
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

describe("assets.run_worker_first on the web wrangler.jsonc", () => {
  // The cms module routes /blog to the web Worker with two string patches. Without them a
  // browser navigation to an on-demand page gets the assets layer's 404 page, because
  // `not_found_handling: "404-page"` answers navigations before the Worker runs. The
  // template file is the fixture, so a reshaped config fails here first.
  const ROUTES = ["/blog", "/blog/*"].map((entry) => ({
    bindingType: "assets.run_worker_first",
    entry,
  }));

  it("adds both patterns under assets, once", async () => {
    const source = await readFile(
      new URL(
        "../../../templates/base/apps/web/wrangler.jsonc",
        import.meta.url
      ),
      "utf-8"
    );
    let out = source;
    for (const route of ROUTES) {
      out = upsertWranglerBinding(out, route);
    }
    const parsed = parse(out) as {
      assets: { run_worker_first: string[]; not_found_handling: string };
    };
    expect(parsed.assets.run_worker_first).toStrictEqual(["/blog", "/blog/*"]);
    expect(parsed.assets.not_found_handling).toBe("404-page");
    let again = out;
    for (const route of ROUTES) {
      again = upsertWranglerBinding(again, route);
    }
    expect(again).toBe(out);
  });
});
