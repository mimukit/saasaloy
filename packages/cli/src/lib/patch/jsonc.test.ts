import { describe, expect, it } from "vitest";
import {
  removeWranglerBinding,
  upsertWranglerBinding,
  wranglerBindingRemoveRefusal,
} from "./jsonc.js";

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

describe(removeWranglerBinding, () => {
  it("round-trips: upsert then remove restores the source byte-for-byte", () => {
    // The shipping case (email-cloudflare): the module introduces the array, so undoing
    // it has to take the array with it or the file never returns to its pre-patch bytes.
    const patch = {
      bindingType: "send_email",
      entry: { name: "EMAIL", remote: true },
      matchOn: "name",
    };
    const patched = upsertWranglerBinding(WRANGLER, patch);
    expect(patched).not.toBe(WRANGLER);
    expect(removeWranglerBinding(patched, patch)).toBe(WRANGLER);
  });

  it("round-trips an append into an array that already had entries", () => {
    // Normalise first. `upsertWranglerBinding` reflows an array it appends into, so a
    // round trip is only byte-exact from a document already in the shape it writes —
    // asserting otherwise would be a claim about the forward direction, not the inverse.
    const base = upsertWranglerBinding(WRANGLER, {
      bindingType: "d1_databases",
      entry: { binding: "FIRST", database_id: "one" },
    });
    const patch = {
      bindingType: "d1_databases",
      entry: {
        binding: "ANALYTICS",
        database_id: "xyz-789",
        database_name: "an-db",
      },
    };
    const patched = upsertWranglerBinding(base, patch);
    expect(patched).toContain("ANALYTICS");
    const back = removeWranglerBinding(patched, patch);
    expect(back).toBe(base);
    // The siblings that were there before the patch are still there, comments included.
    expect(back).toContain("app-db");
    expect(back).toContain("FIRST");
    expect(back).toContain("// Cloudflare Worker config");
  });

  it("round-trips a bare-string entry and drops the array it created", () => {
    const patch = {
      bindingType: "compatibility_flags",
      entry: "nodejs_compat",
    };
    const patched = upsertWranglerBinding(WRANGLER, patch);
    expect(patched).toContain("nodejs_compat");
    expect(removeWranglerBinding(patched, patch)).toBe(WRANGLER);
  });

  it("keeps a sibling string flag it did not add", () => {
    const withBoth = `{
  "name": "api",
  "compatibility_flags": ["nodejs_compat", "no_nodejs_compat_v2"]
}
`;
    const out = removeWranglerBinding(withBoth, {
      bindingType: "compatibility_flags",
      entry: "nodejs_compat",
    });
    expect(out).toContain("no_nodejs_compat_v2");
    expect(out).not.toContain('"nodejs_compat"');
  });

  it("is idempotent: removing an entry that is already gone returns the source", () => {
    const patch = {
      bindingType: "kv_namespaces",
      entry: { binding: "CACHE", id: "kv-1" },
    };
    expect(removeWranglerBinding(WRANGLER, patch)).toBe(WRANGLER);
    const once = removeWranglerBinding(
      upsertWranglerBinding(WRANGLER, patch),
      patch
    );
    expect(removeWranglerBinding(once, patch)).toBe(once);
  });

  it("never reverse-patches a hand-edited entry", () => {
    // Same match key, different value — the user owns this line now.
    const edited = `{
  "name": "api",
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "9f2c-real" }
  ]
}
`;
    const out = removeWranglerBinding(edited, {
      bindingType: "d1_databases",
      entry: { binding: "DB", database_id: "abc-123", database_name: "app-db" },
    });
    expect(out).toBe(edited);
    expect(out).toContain("9f2c-real");
  });

  it("leaves an unparseable document alone", () => {
    const broken = `{ "name": "api",,, }`;
    expect(
      removeWranglerBinding(broken, {
        bindingType: "d1_databases",
        entry: { binding: "DB" },
      })
    ).toBe(broken);
  });
});

describe(wranglerBindingRemoveRefusal, () => {
  it("reports the drifted entry it refused to delete", () => {
    const edited = `{
  "name": "api",
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "9f2c-real" }
  ]
}
`;
    const reason = wranglerBindingRemoveRefusal(edited, {
      bindingType: "d1_databases",
      entry: { binding: "DB", database_id: "abc-123", database_name: "app-db" },
    });
    expect(reason).toContain("d1_databases[binding=DB]");
  });

  it("says nothing when the entry is already gone — that is not a refusal", () => {
    expect(
      wranglerBindingRemoveRefusal(WRANGLER, {
        bindingType: "kv_namespaces",
        entry: { binding: "CACHE" },
      })
    ).toBeUndefined();
  });

  it("says nothing when the entry on disk is the one that was applied", () => {
    expect(
      wranglerBindingRemoveRefusal(WRANGLER, {
        bindingType: "d1_databases",
        entry: {
          binding: "DB",
          database_id: "abc-123",
          database_name: "app-db",
        },
      })
    ).toBeUndefined();
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
