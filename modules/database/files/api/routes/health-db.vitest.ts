import { TEST_DB } from "@repo/db/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";

// The route's contract, with no database behind it. Both drivers' `getDb` return whatever
// `env[TEST_DB]` holds, so each test hands the route a stand-in client: one whose query
// answers, and one whose query fails the way an unreachable database does. The query
// itself runs against a real database in the deploy's smoke check, which is the call this
// route exists for.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const DRIVER_ERROR = "connect ECONNREFUSED 10.0.0.7:5432 as app_owner";

/** A client whose `select().from()` settles the way `result` does. */
function clientThat(result: () => Promise<unknown>): object {
  return { select: () => ({ from: result }) };
}

function request(client: object) {
  return app.request(
    "/health/db",
    {},
    {
      LOGGER_PROVIDER: "console",
      [TEST_DB]: client,
    }
  );
}

describe("GET /health/db", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 200 when the query answers", async () => {
    const res = await request(clientThat(() => Promise.resolve([{ ok: 1 }])));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toStrictEqual({ status: "ok" });
  });

  it("answers 503 with a fixed message, and logs the driver error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      // Keep the expected error out of the test output.
    });

    const res = await request(
      clientThat(() => Promise.reject(new Error(DRIVER_ERROR)))
    );

    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toStrictEqual({
      error: {
        code: "database_unavailable",
        message: "The api could not reach its database.",
      },
    });
    expect(body).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(logged.mock.calls)).toContain(DRIVER_ERROR);
  });
});
