import { describe, expect, it } from "vitest";
import app from "../index";
import { routeContracts } from "../contract";
import { agentTools } from "./document";

// Every route of this api states whether an agent may call it (plan 0110, ADR 0063).
//
// A route with no `declare(...)` link is a decision nobody took, so this test fails on it,
// naming the method and the path. Add the statement from `../contract`: closed with a
// reason, or callable with its output schema, its marks and its scope word. The
// `saasaloy-agent` skill has the four parts of a callable entity.
//
// It reads the finished app, every module's routes and your own, through
// `routeContracts`. A route registered with `.all()` is invisible to it, as it is to the
// agent surfaces.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const contracts = routeContracts(app);

function where(contract: { method: string; path: string }): string {
  return `${contract.method} ${contract.path}`;
}

describe("every api route states whether an agent may call it", () => {
  it("gives every route a declare(...) statement", () => {
    expect(
      contracts.filter((c) => c.declaration === undefined).map(where)
    ).toStrictEqual([]);
  });

  it("names every route once, in snake_case", () => {
    // One statement may serve several methods (`.on(["GET", "POST"], ...)`), so a name
    // is a duplicate only when two different statements carry it.
    const statements = [
      ...new Set(
        contracts.flatMap((c) => (c.declaration ? [c.declaration] : []))
      ),
    ];
    const names = statements.map((statement) => statement.name);
    expect(
      names.filter((name) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name))
    ).toStrictEqual([]);
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toStrictEqual(
      []
    );
  });

  it("writes each scope as resource:action, or null for a public route", () => {
    expect(
      contracts
        .filter((c) => {
          const agent = c.declaration?.agent;
          return (
            agent?.callable === true &&
            agent.scope !== null &&
            !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(agent.scope)
          );
        })
        .map(where)
    ).toStrictEqual([]);
  });

  it("never opens an admin route", () => {
    expect(
      contracts
        .filter(
          (c) =>
            c.path.split("/").includes("admin") &&
            c.declaration?.agent.callable === true
        )
        .map(where)
    ).toStrictEqual([]);
  });

  it("builds one tool for each callable route", async () => {
    const callable = contracts.filter((c) => c.declaration?.agent.callable);
    const tools = await agentTools(app);
    expect(tools.map((tool) => tool.name).toSorted()).toStrictEqual(
      callable.map((c) => c.declaration?.name).toSorted()
    );
  });
});
