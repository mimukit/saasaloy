// Tests for ./state.ts. Repo-only, like ./branch-name.test.ts: the descriptor does not
// ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseBackend,
  formatState,
  inferState,
  liveness,
  parseState,
  timeLeft,
} from "./state.ts";
import type { State } from "./state.ts";

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
    assert.deepEqual(parseState(formatState(state)), state);
  });

  it("round-trips the minimum block", () => {
    const state: State = { backend: "docker", database: "app_dev" };
    assert.deepEqual(parseState(formatState(state)), state);
  });

  it("reads nothing out of a block naming an unknown backend", () => {
    assert.equal(
      parseState(["# backend=sqlite", "# database=app_dev"]),
      undefined
    );
  });

  it("reads nothing out of a file with no block", () => {
    assert.equal(parseState([]), undefined);
    assert.equal(parseState(["# just a comment"]), undefined);
  });
});

describe("chooseBackend", () => {
  it("defaults to docker with no flag and no state", () => {
    assert.equal(chooseBackend(flags()), "docker");
  });

  it("keeps the state's backend when no flag names one", () => {
    assert.equal(
      chooseBackend(flags(), { backend: "neon", database: "app_dev" }),
      "neon"
    );
  });

  it("takes the flag on a first run", () => {
    assert.equal(chooseBackend(flags({ server: true })), "server");
  });

  it("refuses two backend flags at once", () => {
    assert.throws(
      () => chooseBackend(flags({ docker: true, neon: true })),
      /not several/
    );
  });

  // Switching backend moves the data nowhere, so it has to be asked for twice.
  it("refuses a switch without --reset", () => {
    assert.throws(
      () =>
        chooseBackend(flags({ neon: true }), {
          backend: "docker",
          database: "app_dev",
        }),
      /--reset/
    );
  });

  it("allows the switch with --reset", () => {
    assert.equal(
      chooseBackend(flags({ neon: true, reset: true }), {
        backend: "docker",
        database: "app_dev",
      }),
      "neon"
    );
  });

  it("keeps the backend when --reset comes alone", () => {
    assert.equal(
      chooseBackend(flags({ reset: true }), {
        backend: "server",
        database: "app_dev",
      }),
      "server"
    );
  });
});

describe("liveness / timeLeft", () => {
  it("calls a docker or server database live with no expiry", () => {
    const state: State = { backend: "docker", database: "app_dev" };
    assert.equal(liveness(state, NOW), "live");
    assert.equal(timeLeft(state, NOW), "no expiry");
  });

  it("calls a neon database with a future expiry live", () => {
    const state: State = {
      backend: "neon",
      database: "app_dev",
      expires: "2026-09-20T14:30:00.000Z",
    };
    assert.equal(liveness(state, NOW), "live");
    assert.equal(timeLeft(state, NOW), "2h 30m left");
  });

  it("calls a past expiry expired", () => {
    const state: State = {
      backend: "neon",
      database: "app_dev",
      expires: "2026-09-19T10:00:00.000Z",
    };
    assert.equal(liveness(state, NOW), "expired");
    assert.equal(timeLeft(state, NOW), "expired");
  });

  it("calls a neon database with no readable expiry unknown", () => {
    const state: State = { backend: "neon", database: "app_dev" };
    assert.equal(liveness(state, NOW), "unknown");
    assert.equal(timeLeft(state, NOW), "unknown");
  });
});

/** Stands in for `isManagedDatabase`: this project's databases all start with the prefix. */
const managed = (database: string) => database.startsWith("app_dev");

describe("inferState", () => {
  it("reads a neon host as the neon backend", () => {
    assert.deepEqual(
      inferState(
        "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/app_dev",
        () => false
      ),
      { backend: "neon", database: "app_dev" }
    );
  });

  it("reads a localhost URL as the docker backend", () => {
    assert.deepEqual(
      inferState(
        "postgres://postgres:postgres@127.0.0.1:5432/app_dev",
        managed
      ),
      { backend: "docker", database: "app_dev" }
    );
  });

  it("reads a remote URL holding a managed database as the server backend", () => {
    assert.deepEqual(
      inferState("postgres://u:p@db.example.com:5432/app_dev_main", managed),
      { backend: "server", database: "app_dev_main" }
    );
  });

  // The refusal that keeps `db:drop` off a database these scripts did not make.
  it("reads nothing out of a URL naming another project's database", () => {
    assert.equal(
      inferState("postgres://u:p@db.example.com:5432/production", managed),
      undefined
    );
  });

  it("reads nothing out of a URL with no database or no shape", () => {
    assert.equal(
      inferState("postgres://u:p@db.example.com:5432/", managed),
      undefined
    );
    assert.equal(inferState("not a url", managed), undefined);
  });
});
