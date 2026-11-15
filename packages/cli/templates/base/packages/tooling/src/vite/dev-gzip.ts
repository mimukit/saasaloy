import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// The dev server sends every module uncompressed. On localhost that costs nothing, but a
// dev server opened from another machine (a remote dev box, a phone on the LAN) pays for
// every byte. Measured on a cold load of an admin sign-in page at 60 ms RTT and 30 Mbps,
// gzip took the transfer from 19.7 MB to 5.2 MB and the time to the form from 6.8 s to
// 4.1 s.
//
// Vite has no compression option for its dev server, so this middleware does it with
// node:zlib and no new dependency. It holds each response in memory and compresses it in
// one pass at `end()`. HMR runs on its own websocket, so it is untouched. An Astro page
// streams its HTML, and the buffer holds it until the render ends, which costs nothing
// that matters in dev.
//
// The build is untouched (`apply: "serve"`). Production compression is the host's job.

const MIN_BYTES = 1024;
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|json|xml)|image\/svg\+xml)/;

/** True when a finished response is worth compressing for this request. */
export function shouldGzip(
  acceptEncoding: string | undefined,
  status: number,
  contentType: string | undefined,
  contentEncoding: string | undefined,
  bytes: number
): boolean {
  return (
    /\bgzip\b/.test(acceptEncoding ?? "") &&
    status === 200 &&
    contentEncoding === undefined &&
    COMPRESSIBLE.test(contentType ?? "") &&
    bytes >= MIN_BYTES
  );
}

type Chunk = string | Uint8Array;

function toBuffer(chunk: Chunk, encoding?: BufferEncoding): Buffer {
  return typeof chunk === "string"
    ? Buffer.from(chunk, encoding)
    : Buffer.from(chunk);
}

/** The connect middleware. Exported for the test, which runs it on a plain node server. */
export function gzipMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): void {
  if (!/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  const end = res.end.bind(res);
  const { write } = res;
  const { writeHead } = res;

  // `writeHead` would flush the headers before the body is known, so it only records
  // them on the response here and the real one runs at `end()`.
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    res.statusCode = status;
    const headers = rest.find((arg) => typeof arg === "object" && arg !== null);
    if (headers) {
      for (const [name, value] of Object.entries(
        headers as Record<string, string>
      )) {
        res.setHeader(name, value);
      }
    }
    return res;
  }) as typeof res.writeHead;

  res.write = ((
    chunk: Chunk,
    encoding?: BufferEncoding | (() => void),
    done?: () => void
  ) => {
    chunks.push(
      toBuffer(chunk, typeof encoding === "string" ? encoding : undefined)
    );
    const callback = typeof encoding === "function" ? encoding : done;
    callback?.();
    return true;
  }) as typeof res.write;

  res.end = ((
    chunk?: Chunk | (() => void),
    encoding?: BufferEncoding | (() => void)
  ) => {
    if (chunk !== undefined && typeof chunk !== "function") {
      chunks.push(
        toBuffer(chunk, typeof encoding === "string" ? encoding : undefined)
      );
    }
    let body = Buffer.concat(chunks);
    const type = res.getHeader("content-type");
    const contentEncoding = res.getHeader("content-encoding");
    if (
      shouldGzip(
        req.headers["accept-encoding"],
        res.statusCode,
        typeof type === "string" ? type : undefined,
        typeof contentEncoding === "string" ? contentEncoding : undefined,
        body.length
      )
    ) {
      body = gzipSync(body, { level: 1 });
      res.setHeader("content-encoding", "gzip");
      res.setHeader("vary", "accept-encoding");
    }
    if (res.statusCode !== 304 && res.statusCode !== 204) {
      res.setHeader("content-length", body.length);
    }
    // Node's own `end()` calls `writeHead()` to send the headers, so the real ones go back
    // first. With the recording version in place the reply would leave with no headers.
    res.write = write;
    res.writeHead = writeHead;
    return end(body);
  }) as typeof res.end;

  next();
}

/** Gzip the dev server's responses. Dev only. */
export function devGzip(): Plugin {
  return {
    name: "saasaloy-dev-gzip",
    apply: "serve",
    configureServer(server) {
      // Added before Vite's own middlewares, so it wraps every response they send.
      server.middlewares.use(gzipMiddleware);
    },
  };
}
