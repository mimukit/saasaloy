import { describe, expect, it } from "vitest";
import { templateVars } from "./scaffold.js";

describe("init template variables", () => {
  it("includes the CLI package version", () => {
    expect(templateVars("demo-app")).toEqual({
      PROJECT_NAME: "demo-app",
      CLI_VERSION: "0.0.0",
    });
  });
});
