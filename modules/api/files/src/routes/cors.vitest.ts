import { describe, expect, it } from "vitest";
import app from "../index";

// The CORS preflight, answered by the middleware in ../index.ts before any route runs, so
// it needs no database. `maxAge` lets the browser keep the answer: without it, every admin
// call paid an OPTIONS round trip on each page load.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const ORIGIN = "https://app.example.com";

function preflight(origin: string) {
  return app.request(
    "/health",
    {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
      },
    },
    { CORS_ORIGINS: ORIGIN, LOGGER_PROVIDER: "console" }
  );
}

describe("CORS preflight", () => {
  it("lets an allowed origin keep the answer for two hours", async () => {
    const res = await preflight(ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-max-age")).toBe("7200");
  });

  it("allows no other origin", async () => {
    const res = await preflight("https://evil.example");

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
