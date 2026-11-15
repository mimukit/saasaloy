import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { describe, it } from "node:test";
import {
  BLOCK_END,
  BLOCK_START,
  blockPorts,
  browserOrigins,
  checkHost,
  checkoutHash,
  chooseBlock,
  cookiePrefixFor,
  homeBlock,
  isPortListening,
  parseRecord,
  parseWorktreeList,
  portServices,
  portSlot,
  renderBlock,
  rewriteBlock,
  serviceBlocks,
} from "./dev-ports.ts";
import type { Service } from "./services.ts";

const WEB: Service = {
  name: "web",
  file: "apps/web/.env",
  environment: "dev",
  omit: [],
  devPort: 3000,
};
const ADMIN: Service = {
  name: "admin",
  file: "apps/admin/.env",
  environment: "dev",
  omit: [],
  devPort: 3001,
};
const PREVIEW: Service = {
  name: "email-react",
  file: "packages/email-react/.env",
  environment: "dev",
  omit: [],
  devPort: 3003,
};
const API: Service = {
  name: "api",
  file: "apps/api/.env",
  environment: "dev",
  omit: [],
  devPort: 4000,
};
const DEPLOY: Service = { name: "deploy", environment: "prod", omit: [] };

describe("checkoutHash and homeBlock", () => {
  it("hashes the checkout root with sha256", () => {
    const root = "/work/project-a";
    assert.equal(
      checkoutHash(root),
      createHash("sha256").update(root).digest("hex")
    );
  });

  it("takes the first 8 hex digits modulo 1000 as the block", () => {
    assert.equal(homeBlock(`0000ffff${"0".repeat(56)}`), 65_535 % 1000);
    assert.equal(homeBlock(`ffffffff${"0".repeat(56)}`), 4_294_967_295 % 1000);
  });

  it("gives two checkouts different blocks and prefixes", () => {
    const a = checkoutHash("/work/project-a");
    const b = checkoutHash("/work/project-b");
    assert.notEqual(cookiePrefixFor(a), cookiePrefixFor(b));
    assert.match(cookiePrefixFor(a), /^wt[0-9a-f]{6}$/);
    assert.equal(cookiePrefixFor(a), `wt${a.slice(0, 6)}`);
  });
});

describe("portSlot", () => {
  it("puts a frontend at devPort - 3000", () => {
    assert.equal(portSlot(WEB), 0);
    assert.equal(portSlot({ ...WEB, devPort: 3004 }), 4);
  });

  it("puts a backend at devPort - 4000 + 5", () => {
    assert.equal(portSlot(API), 5);
    assert.equal(portSlot({ ...API, devPort: 4004 }), 9);
  });

  for (const devPort of [2999, 3005, 3999, 4005, 5432]) {
    it(`refuses devPort ${devPort}, naming the service`, () => {
      assert.throws(
        () => portSlot({ ...WEB, name: "odd", devPort }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("odd") &&
          error.message.includes(String(devPort))
      );
    });
  }
});

describe("portServices", () => {
  it("keeps the rows with a devPort and a file", () => {
    assert.deepEqual(
      portServices([WEB, DEPLOY, { ...API, file: undefined }, ADMIN]).map(
        (service) => service.name
      ),
      ["web", "admin"]
    );
  });
});

describe("blockPorts", () => {
  it("uses the pinned ports in the main checkout", () => {
    assert.deepEqual(blockPorts(null, [WEB, ADMIN, API]), {
      web: 3000,
      admin: 3001,
      api: 4000,
    });
  });

  it("puts each service at 10000 + 10k + slot in a block", () => {
    assert.deepEqual(blockPorts(423, [WEB, ADMIN, PREVIEW, API]), {
      web: 14_230,
      admin: 14_231,
      "email-react": 14_233,
      api: 14_235,
    });
    assert.deepEqual(blockPorts(999, [API]), { api: 19_995 });
  });
});

describe("chooseBlock", () => {
  const never = (): Promise<boolean> => Promise.resolve(false);

  it("takes the home block when nothing holds it", async () => {
    assert.equal(
      await chooseBlock({
        home: 7,
        recorded: undefined,
        claimed: new Set(),
        isListening: never,
      }),
      7
    );
  });

  it("skips a block another worktree records", async () => {
    assert.equal(
      await chooseBlock({
        home: 7,
        recorded: undefined,
        claimed: new Set([7, 8]),
        isListening: never,
      }),
      9
    );
  });

  it("skips a block with a listening port", async () => {
    const asked: number[] = [];
    const block = await chooseBlock({
      home: 7,
      recorded: undefined,
      claimed: new Set(),
      isListening: (candidate) => {
        asked.push(candidate);
        return Promise.resolve(candidate === 7);
      },
    });
    assert.equal(block, 8);
    assert.deepEqual(asked, [7, 8]);
  });

  it("wraps from 999 to 0", async () => {
    assert.equal(
      await chooseBlock({
        home: 999,
        recorded: undefined,
        claimed: new Set([999]),
        isListening: never,
      }),
      0
    );
  });

  it("keeps the recorded block, even while its own servers listen", async () => {
    assert.equal(
      await chooseBlock({
        home: 7,
        recorded: 12,
        claimed: new Set([7]),
        isListening: () => Promise.resolve(true),
      }),
      12
    );
  });

  it("moves off a recorded block another worktree now records", async () => {
    assert.equal(
      await chooseBlock({
        home: 7,
        recorded: 12,
        claimed: new Set([12]),
        isListening: never,
      }),
      7
    );
  });

  it("fails when every block is taken", async () => {
    await assert.rejects(
      chooseBlock({
        home: 0,
        recorded: undefined,
        claimed: new Set(),
        isListening: () => Promise.resolve(true),
      }),
      /every block/
    );
  });
});

describe("parseWorktreeList", () => {
  it("reads every worktree path from the porcelain output", () => {
    const porcelain = [
      "worktree /work/main",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /work/wt one",
      "HEAD def",
      "detached",
      "",
    ].join("\n");
    assert.deepEqual(parseWorktreeList(porcelain), [
      "/work/main",
      "/work/wt one",
    ]);
  });
});

describe("parseRecord", () => {
  it("reads a record", () => {
    assert.deepEqual(
      parseRecord(
        JSON.stringify({
          block: 4,
          host: "localhost",
          cookiePrefix: "wtabcdef",
          services: { web: 10_040 },
        })
      ),
      {
        block: 4,
        host: "localhost",
        cookiePrefix: "wtabcdef",
        services: { web: 10_040 },
      }
    );
  });

  it("reads nothing from a missing or broken file", () => {
    assert.equal(parseRecord(), undefined);
    assert.equal(parseRecord("{"), undefined);
    assert.equal(parseRecord('{"block":"x"}'), undefined);
    assert.equal(parseRecord('{"block":1000}'), undefined);
  });
});

describe("checkHost", () => {
  it("takes a host name or an address", () => {
    assert.equal(checkHost("devaloy"), "devaloy");
    assert.equal(checkHost("box.tail1234.ts.net"), "box.tail1234.ts.net");
    assert.equal(checkHost("100.64.0.1"), "100.64.0.1");
  });

  for (const host of ["", "http://devaloy", "devaloy:3000", "a b"]) {
    it(`refuses ${JSON.stringify(host)}`, () => {
      assert.throws(() => checkHost(host), /DEV_HOST/);
    });
  }
});

describe("browserOrigins", () => {
  const ports = { web: 14_230, admin: 14_231, "email-react": 14_233 };

  it("lists the localhost origin of each browser service", () => {
    assert.deepEqual(
      browserOrigins([WEB, ADMIN, PREVIEW], ports, "localhost"),
      ["http://localhost:14230", "http://localhost:14231"]
    );
  });

  it("adds the DEV_HOST origin of each when the host is not localhost", () => {
    assert.deepEqual(browserOrigins([WEB, ADMIN], ports, "devaloy"), [
      "http://localhost:14230",
      "http://devaloy:14230",
      "http://localhost:14231",
      "http://devaloy:14231",
    ]);
  });
});

describe("serviceBlocks", () => {
  const services = [WEB, ADMIN, PREVIEW, API];
  const ports = blockPorts(423, services);

  it("writes each service the keys it reads", () => {
    const blocks = serviceBlocks({
      services,
      ports,
      host: "devaloy",
      cookiePrefix: "wtabcdef",
    });
    assert.deepEqual(blocks.get("web"), [
      ["DEV_PORT", "14230"],
      ["PUBLIC_API_URL", "http://devaloy:14235"],
      ["PUBLIC_SITE_URL", "http://devaloy:14230"],
    ]);
    assert.deepEqual(blocks.get("admin"), [
      ["DEV_PORT", "14231"],
      ["PUBLIC_API_URL", "http://devaloy:14235"],
      ["PUBLIC_SITE_URL", "http://devaloy:14230"],
    ]);
    assert.deepEqual(blocks.get("email-react"), [["DEV_PORT", "14233"]]);
    assert.deepEqual(blocks.get("api"), [
      ["DEV_PORT", "14235"],
      ["BETTER_AUTH_URL", "http://devaloy:14235"],
      [
        "CORS_ORIGINS",
        "http://localhost:14230,http://devaloy:14230,http://localhost:14231,http://devaloy:14231",
      ],
      ["AUTH_COOKIE_PREFIX", "wtabcdef"],
    ]);
  });

  it("writes no cookie prefix in the main checkout", () => {
    const main = [WEB, API];
    const blocks = serviceBlocks({
      services: main,
      ports: blockPorts(null, main),
      host: "localhost",
      cookiePrefix: null,
    });
    assert.deepEqual(blocks.get("api"), [
      ["DEV_PORT", "4000"],
      ["BETTER_AUTH_URL", "http://localhost:4000"],
      ["CORS_ORIGINS", "http://localhost:3000"],
    ]);
  });

  it("writes no api URL when there is no api", () => {
    const blocks = serviceBlocks({
      services: [WEB],
      ports: blockPorts(null, [WEB]),
      host: "localhost",
      cookiePrefix: null,
    });
    assert.deepEqual(blocks.get("web"), [
      ["DEV_PORT", "3000"],
      ["PUBLIC_SITE_URL", "http://localhost:3000"],
    ]);
  });
});

describe("rewriteBlock", () => {
  const block = renderBlock([["DEV_PORT", "14230"]]);

  it("renders the markers around the keys", () => {
    assert.deepEqual(block, [BLOCK_START, "DEV_PORT=14230", BLOCK_END]);
  });

  it("writes a block into an empty file", () => {
    assert.equal(rewriteBlock("", block), `${block.join("\n")}\n`);
  });

  it("appends a block after the lines already there", () => {
    assert.equal(
      rewriteBlock("# mine\nFOO=1\n", block),
      `# mine\nFOO=1\n\n${block.join("\n")}\n`
    );
  });

  it("replaces an old block and keeps the rest", () => {
    const old = `FOO=1\n\n${BLOCK_START}\nDEV_PORT=1\n${BLOCK_END}\nBAR=2\n`;
    assert.equal(
      rewriteBlock(old, block),
      `FOO=1\nBAR=2\n\n${block.join("\n")}\n`
    );
  });

  it("gives the same text on a second run", () => {
    const first = rewriteBlock("FOO=1\n", block);
    assert.equal(rewriteBlock(first, block), first);
  });

  it("removes the block, and leaves an empty text when nothing else was there", () => {
    assert.equal(rewriteBlock(rewriteBlock("", block)), "");
    assert.equal(rewriteBlock(rewriteBlock("FOO=1\n", block)), "FOO=1\n");
  });

  it("refuses a start marker with no end marker", () => {
    assert.throws(
      () => rewriteBlock(`${BLOCK_START}\nDEV_PORT=1\n`, block),
      /no end/
    );
  });
});

describe("isPortListening", () => {
  async function listen(host: string): Promise<Server> {
    const server = createServer();
    server.listen(0, host);
    await once(server, "listening");
    return server;
  }

  for (const host of ["127.0.0.1", "0.0.0.0", "::"]) {
    it(`sees a server bound on ${host}`, async () => {
      const server = await listen(host);
      const { port } = server.address() as AddressInfo;
      try {
        assert.equal(await isPortListening(port), true);
      } finally {
        server.close();
      }
    });
  }

  it("sees a free port as free", async () => {
    const server = await listen("127.0.0.1");
    const { port } = server.address() as AddressInfo;
    server.close();
    await once(server, "close");
    assert.equal(await isPortListening(port), false);
  });
});
