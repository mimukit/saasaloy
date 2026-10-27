// Tests for ./state.ts. It ships as `state.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import {
  chooseBackend,
  formatState,
  inferState,
  liveness,
  parseState,
  timeLeft,
} from "./state";
import type { State } from "./state";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function flags(over: Partial<Record<string, boolean>> = {}) {
  return {
    docker: false,
    server: false,
    neon: false,
    reset: false,
    ...over,
  };
}

describe("formatState / parseState", () => {
  it("round-trips every field", () => {
    const state: State = {
      backend: "neon",
      database: "app_dev_issue_1_aaaaaa",
      created: "2026-09-20T10:00:00.000Z",
      expires: "2026-09-23T10:00:00.000Z",
      claim: "https://neon.new/claim/x",
    };
    expect(parseState(formatState(state))).toStrictEqual(state);
  });

  it("round-trips the minimum block", () => {
    const state: State = { backend: "docker", database: "app_dev" };
    expect(parseState(formatState(state))).toStrictEqual(state);
  });

  it("reads nothing out of a block naming an unknown backend", () => {
    expect(
      parseState(["# backend=sqlite", "# database=app_dev"])
    ).toBeUndefined();
  });

  it("reads nothing out of a file with no block", () => {
    expect(parseState([])).toBeUndefined();
    expect(parseState(["# just a comment"])).toBeUndefined();
  });
});

describe(chooseBackend, () => {
  it("defaults to docker with no flag and no state", () => {
    expect(chooseBackend(flags())).toBe("docker");
  });

  it("keeps the state's backend when no flag names one", () => {
    expect(
      chooseBackend(flags(), { backend: "neon", database: "app_dev" })
    ).toBe("neon");
  });

  it("takes the flag on a first run", () => {
    expect(chooseBackend(flags({ server: true }))).toBe("server");
  });

  it("refuses two backend flags at once", () => {
    expect(() => chooseBackend(flags({ docker: true, neon: true }))).toThrow(
      /not several/
    );
  });

  // Switching backend moves the data nowhere, so it has to be asked for twice.
  it("refuses a switch without --reset", () => {
    expect(() =>
      chooseBackend(flags({ neon: true }), {
        backend: "docker",
        database: "app_dev",
      })
    ).toThrow(/--reset/);
  });

  it("allows the switch with --reset", () => {
    expect(
      chooseBackend(flags({ neon: true, reset: true }), {
        backend: "docker",
        database: "app_dev",
      })
    ).toBe("neon");
  });

  it("keeps the backend when --reset comes alone", () => {
    expect(
      chooseBackend(flags({ reset: true }), {
        backend: "server",
        database: "app_dev",
      })
    ).toBe("server");
  });
});

describe("liveness / timeLeft", () => {
  it("calls a docker or server database live with no expiry", () => {
    const state: State = { backend: "docker", database: "app_dev" };
    expect(liveness(state, NOW)).toBe("live");
    expect(timeLeft(state, NOW)).toBe("no expiry");
  });

  it("calls a neon database with a future expiry live", () => {
    const state: State = {
      backend: "neon",
      database: "app_dev",
      expires: "2026-09-20T14:30:00.000Z",
    };
    expect(liveness(state, NOW)).toBe("live");
    expect(timeLeft(state, NOW)).toBe("2h 30m left");
  });

  it("calls a past expiry expired", () => {
    const state: State = {
      backend: "neon",
      database: "app_dev",
      expires: "2026-09-19T10:00:00.000Z",
    };
    expect(liveness(state, NOW)).toBe("expired");
    expect(timeLeft(state, NOW)).toBe("expired");
  });

  it("calls a neon database with no readable expiry unknown", () => {
    const state: State = { backend: "neon", database: "app_dev" };
    expect(liveness(state, NOW)).toBe("unknown");
    expect(timeLeft(state, NOW)).toBe("unknown");
  });
});

/** Stands in for `isManagedDatabase`: this project's databases all start with the prefix. */
const managed = (database: string) => database.startsWith("app_dev");

describe(inferState, () => {
  it("reads a neon host as the neon backend", () => {
    expect(
      inferState(
        "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/app_dev",
        () => false
      )
    ).toStrictEqual({ backend: "neon", database: "app_dev" });
  });

  it("reads a localhost URL as the docker backend", () => {
    expect(
      inferState("postgres://postgres:postgres@127.0.0.1:5432/app_dev", managed)
    ).toStrictEqual({ backend: "docker", database: "app_dev" });
  });

  it("reads a remote URL holding a managed database as the server backend", () => {
    expect(
      inferState("postgres://u:p@db.example.com:5432/app_dev_main", managed)
    ).toStrictEqual({ backend: "server", database: "app_dev_main" });
  });

  // The refusal that keeps `db:drop` off a database these scripts did not make.
  it("reads nothing out of a URL naming another project's database", () => {
    expect(
      inferState("postgres://u:p@db.example.com:5432/production", managed)
    ).toBeUndefined();
  });

  it("reads nothing out of a URL with no database or no shape", () => {
    expect(
      inferState("postgres://u:p@db.example.com:5432/", managed)
    ).toBeUndefined();
    expect(inferState("not a url", managed)).toBeUndefined();
  });
});
