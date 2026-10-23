import { describe, expect, it } from "vitest";
import { rootVersion, withRootVersion } from "./root-version.js";

const manifest = `{
  "name": "app",
  "version": "0.3.0",
  "dependencies": {
    "pkg": { "version": "9.9.9" }
  }
}
`;

describe(rootVersion, () => {
  it("reads the top-level version, never a nested one", () => {
    expect(rootVersion(manifest)).toBe("0.3.0");
    expect(
      rootVersion(
        '{\n  "name": "app",\n  "x": {\n    "version": "1.0.0"\n  }\n}\n'
      )
    ).toBeUndefined();
  });

  it("answers undefined for a file that is not there", () => {
    expect(rootVersion()).toBeUndefined();
  });
});

describe(withRootVersion, () => {
  it("sets the top-level version and keeps every other byte", () => {
    expect(withRootVersion(manifest, "0.0.0")).toBe(
      manifest.replace('"version": "0.3.0"', '"version": "0.0.0"')
    );
  });

  it("leaves a file with no top-level version unchanged", () => {
    const plain = '{\n  "name": "app"\n}\n';
    expect(withRootVersion(plain, "1.0.0")).toBe(plain);
  });
});
