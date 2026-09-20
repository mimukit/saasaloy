import { describe, expect, it } from "vitest";
import {
  appendVars,
  isPublicVar,
  isSet,
  parseEnvValues,
  productionSecretCommands,
} from "./env-vars.js";

describe(isPublicVar, () => {
  it("is the literal prefix, case-sensitive", () => {
    expect(isPublicVar("PUBLIC_API_URL")).toBeTruthy();
    expect(isPublicVar("public_api_url")).toBeFalsy();
    expect(isPublicVar("API_PUBLIC_URL")).toBeFalsy();
  });
});

describe(parseEnvValues, () => {
  it("reads the pairs and drops comments and blanks", () => {
    expect(parseEnvValues("# note\nA=1\n\nB=\nnot a pair\n")).toStrictEqual({
      A: "1",
      B: "",
    });
  });
});

describe(isSet, () => {
  it("counts a blank value as unset, so `env` offers to fill it", () => {
    expect(isSet({ A: "value" }, "A")).toBeTruthy();
    expect(isSet({ A: "" }, "A")).toBeFalsy();
    expect(isSet({ A: "   " }, "A")).toBeFalsy();
    expect(isSet({}, "A")).toBeFalsy();
  });
});

describe(appendVars, () => {
  it("keeps every existing line and appends the new pairs", () => {
    expect(
      appendVars("# note\nKEEP_ME=yes\n", [
        ["A", "1"],
        ["B", "2"],
      ])
    ).toBe("# note\nKEEP_ME=yes\nA=1\nB=2\n");
  });

  it("adds the missing newline before appending", () => {
    expect(appendVars("KEEP_ME=yes", [["A", "1"]])).toBe("KEEP_ME=yes\nA=1\n");
  });

  it("writes a fresh file when there was none", () => {
    expect(appendVars(undefined, [["A", "1"]])).toBe("A=1\n");
  });

  it("changes nothing when there is nothing to add", () => {
    expect(appendVars("KEEP_ME=yes", [])).toBe("KEEP_ME=yes");
  });

  // A `.dev.vars` copied from `.dev.vars.example` is all empty placeholders, and `isSet`
  // calls those unset. Appending would leave two lines for one key, the first of them
  // wrong (review N1).
  it("fills an empty placeholder in place rather than appending a second line", () => {
    expect(
      appendVars("# note\nA=\nKEEP_ME=yes\nB =  \n", [
        ["A", "1"],
        ["B", "2"],
      ])
    ).toBe("# note\nA=1\nKEEP_ME=yes\nB=2\n");
  });

  it("appends only the keys the file has never heard of", () => {
    expect(
      appendVars("A=\n", [
        ["A", "1"],
        ["C", "3"],
      ])
    ).toBe("A=1\nC=3\n");
  });

  it("leaves a commented-out placeholder alone", () => {
    expect(appendVars("# A=\n", [["A", "1"]])).toBe("# A=\nA=1\n");
  });

  it("never rewrites a line that already carries a value", () => {
    expect(appendVars("A=keep-me\n", [["B", "2"]])).toBe("A=keep-me\nB=2\n");
  });
});

describe(productionSecretCommands, () => {
  it("prints one put per secret and skips a public value", () => {
    expect(
      productionSecretCommands([
        "STRIPE_SECRET_KEY",
        "PUBLIC_API_URL",
        "EMAIL_FROM",
      ])
    ).toStrictEqual([
      "# from the Worker's workspace, e.g. apps/api",
      "wrangler secret put EMAIL_FROM",
      "wrangler secret put STRIPE_SECRET_KEY",
    ]);
  });

  it("prints nothing when every declared value is public", () => {
    expect(productionSecretCommands(["PUBLIC_API_URL"])).toStrictEqual([]);
  });
});
