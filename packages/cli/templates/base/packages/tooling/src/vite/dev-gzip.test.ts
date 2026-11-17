import { once } from "node:events";
import { IncomingMessage, createServer, request } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { devGzip, gzipMiddleware, shouldGzip } from "./dev-gzip.ts";

// The middleware runs on a plain node server with handlers shaped like Vite's: one sets
// headers and calls `end(body)`, one calls `writeHead` first, one writes in chunks, and one
// answers 304. Node's `end()` sends the headers through `writeHead()`, which is how the
// first version of this middleware replied with nothing at all.

const SCRIPT = "export const value = 1;\n".repeat(200);

function handle(req: IncomingMessage, res: ServerResponse): void {
  switch (req.url ?? "") {
    case "/end": {
      res.setHeader("content-type", "text/javascript");
      res.statusCode = 200;
      res.end(SCRIPT);
      return;
    }
    case "/write-head": {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(SCRIPT);
      return;
    }
    case "/chunks": {
      res.setHeader("content-type", "text/css");
      res.write(SCRIPT.slice(0, 1000));
      res.write(Buffer.from(SCRIPT.slice(1000)));
      res.end();
      return;
    }
    case "/proxied": {
      // The Cloudflare plugin copies a worker response's headers onto the reply, and
      // Astro's pages come back with `transfer-encoding: chunked` among them.
      res.setHeader("content-type", "text/html");
      res.setHeader("transfer-encoding", "chunked");
      res.end(SCRIPT);
      return;
    }
    case "/small": {
      res.setHeader("content-type", "text/javascript");
      res.end("export {};");
      return;
    }
    default: {
      res.statusCode = 304;
      res.end();
    }
  }
}

let server: Server;
let origin = "";

async function get(path: string, acceptEncoding = "gzip, br") {
  // node:http, not fetch: fetch always decompresses, and these checks need the raw bytes.
  const req = request(origin + path, {
    headers: { "accept-encoding": acceptEncoding },
  });
  req.end();
  const events: unknown[] = await once(req, "response");
  const res = events.at(0);
  if (!(res instanceof IncomingMessage)) {
    throw new TypeError("The request emitted no response.");
  }
  const parts: Buffer[] = [];
  for await (const part of res) {
    if (Buffer.isBuffer(part)) {
      parts.push(part);
    }
  }
  const raw = Buffer.concat(parts);
  const encoding = res.headers["content-encoding"] ?? null;
  return {
    status: res.statusCode ?? 0,
    encoding,
    length: res.headers["content-length"] ?? null,
    transferEncoding: res.headers["transfer-encoding"] ?? null,
    raw,
    body: encoding === "gzip" ? gunzipSync(raw).toString() : raw.toString(),
  };
}

describe(gzipMiddleware, () => {
  beforeAll(async () => {
    server = createServer((req, res) => {
      gzipMiddleware(req, res, () => {
        handle(req, res);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new TypeError("The server has no TCP port.");
    }
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it.each(["/end", "/write-head", "/chunks"])(
    "gzips a script sent through %s",
    async (path) => {
      const res = await get(path);

      expect(res.status).toBe(200);
      expect(res.encoding).toBe("gzip");
      expect(res.body).toBe(SCRIPT);
      expect(Number(res.length)).toBe(res.raw.length);
      expect(res.raw.length).toBeLessThan(SCRIPT.length);
    }
  );

  // A reply with both headers breaks the HTTP/1.1 framing, and Node's fetch refuses it:
  // "Content-Length can't be present with Transfer-Encoding" (issue #347).
  it("drops a copied transfer-encoding when it sets the length", async () => {
    const res = await get("/proxied");

    expect(res.encoding).toBe("gzip");
    expect(res.transferEncoding).toBeNull();
    expect(res.body).toBe(SCRIPT);
  });

  it("sends a small file as it is", async () => {
    const res = await get("/small");

    expect(res.encoding).toBeNull();
    expect(res.body).toBe("export {};");
  });

  it("leaves the response alone for a client that does not take gzip", async () => {
    const res = await get("/end", "identity");

    expect(res.encoding).toBeNull();
    expect(res.body).toBe(SCRIPT);
  });

  it("answers a 304 with no body", async () => {
    const res = await get("/not-modified");

    expect(res.status).toBe(304);
    expect(res.encoding).toBeNull();
  });
});

describe(shouldGzip, () => {
  it("skips a font, which is compressed already", () => {
    expect(
      shouldGzip("gzip", 200, "font/woff2", undefined, 50_000)
    ).toBeFalsy();
  });

  it("skips a response that already names an encoding", () => {
    expect(
      shouldGzip("gzip", 200, "text/javascript", "br", 50_000)
    ).toBeFalsy();
  });

  it("takes an svg", () => {
    expect(
      shouldGzip("gzip", 200, "image/svg+xml", undefined, 50_000)
    ).toBeTruthy();
  });
});

describe(devGzip, () => {
  it("runs on the dev server only", () => {
    const plugin = devGzip();
    expect(plugin.name).toBe("saasaloy-dev-gzip");
    expect(plugin.apply).toBe("serve");
  });
});
