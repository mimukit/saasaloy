import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PINNED_PORTS, portsFrom } from "./project.ts";

describe("portsFrom", () => {
  it("takes the pinned ports on localhost with no .devports.json", () => {
    assert.deepEqual(portsFrom(), {
      host: "localhost",
      ports: PINNED_PORTS,
    });
  });

  it("takes the recorded ports and host", () => {
    const record = JSON.stringify({
      block: 423,
      host: "devaloy",
      cookiePrefix: "wtabcdef",
      services: { web: 14_230, admin: 14_231, api: 14_235 },
    });
    assert.deepEqual(portsFrom(record), {
      host: "devaloy",
      ports: { web: 14_230, admin: 14_231, api: 14_235 },
    });
  });

  it("keeps the pinned port of an app the record does not name", () => {
    const record = JSON.stringify({
      host: "localhost",
      services: { web: 14_230 },
    });
    assert.deepEqual(portsFrom(record).ports, {
      web: 14_230,
      admin: 3001,
      api: 4000,
    });
  });

  it("throws on a record that is not valid JSON", () => {
    assert.throws(() => portsFrom("{"), /\.devports\.json/);
  });
});
