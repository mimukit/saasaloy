// Tests for ./mapping.ts. Repo-only, like ./branch-name.test.ts: the descriptor does not
// ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloneIdOf,
  formatMapping,
  mappingStatement,
  parseMapping,
} from "./mapping.ts";

const MAPPING = {
  prefix: "acme_dev",
  branch: "feat-a",
  worktree: "/home/dev/worktrees/acme/feat-a",
  clone: "0123456789ab",
};

describe("cloneIdOf", () => {
  it("gives every worktree of one clone the same id", () => {
    assert.equal(
      cloneIdOf("box", "/home/dev/acme/.git"),
      cloneIdOf("box", "/home/dev/acme/.git")
    );
    assert.match(cloneIdOf("box", "/home/dev/acme/.git"), /^[0-9a-f]{12}$/);
  });

  it("tells a second clone and another host apart", () => {
    const id = cloneIdOf("box", "/home/dev/acme/.git");
    assert.notEqual(id, cloneIdOf("box", "/home/dev/acme-2/.git"));
    assert.notEqual(id, cloneIdOf("laptop", "/home/dev/acme/.git"));
  });
});

describe("formatMapping / parseMapping", () => {
  it("round-trips a mapping with the saasaloy marker", () => {
    const text = formatMapping(MAPPING);
    assert.equal(JSON.parse(text).saasaloy, 1);
    assert.deepEqual(parseMapping(text), MAPPING);
  });

  it("reads nothing out of a comment that is not a mapping", () => {
    assert.equal(parseMapping(null), undefined);
    assert.equal(parseMapping(""), undefined);
    assert.equal(parseMapping("staging copy, do not drop"), undefined);
    assert.equal(
      parseMapping('{"branch":"x","worktree":"/w","clone":"c"}'),
      undefined
    );
    assert.equal(
      parseMapping('{"saasaloy":2,"branch":"x","worktree":"/w","clone":"c"}'),
      undefined
    );
    assert.equal(parseMapping('{"saasaloy":1,"branch":"x"}'), undefined);
    // A mapping with no project prefix cannot say which project it belongs to.
    assert.equal(
      parseMapping('{"saasaloy":1,"branch":"x","worktree":"/w","clone":"c"}'),
      undefined
    );
    assert.equal(parseMapping("[1]"), undefined);
  });
});

describe("mappingStatement", () => {
  it("quotes the comment and doubles a single quote in it", () => {
    const statement = mappingStatement("app_dev", "app_dev_feat_a", {
      ...MAPPING,
      worktree: "/home/o'neil/acme",
    });
    assert.match(statement, /^COMMENT ON DATABASE "app_dev_feat_a" IS '.*'$/);
    assert.ok(statement.includes("/home/o''neil/acme"));
  });

  it("refuses a database these scripts do not manage", () => {
    assert.throws(() =>
      mappingStatement("app_dev", 'other"; drop database x; --', MAPPING)
    );
  });
});
