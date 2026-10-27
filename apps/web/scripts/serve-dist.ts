// A static server over the built site, for the two gate scripts. It serves
// apps/web/dist/client the way Workers static assets do for this site: a path maps to
// the file, to its index.html, or to `<path>.html`, and anything else gets 404.html
// with a 404 status. Like Cloudflare, it compresses text with brotli or gzip and marks
// the hashed files under /_astro/ immutable (the adapter's dist/client/_headers), so
// Lighthouse measures the transfer a visitor gets rather than a raw file server.

import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createBrotliCompress, createGzip } from "node:zlib";

export const SITE_ROOT = resolve(import.meta.dirname, "../dist/client");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([".css", ".html", ".js", ".json", ".svg", ".txt"]);

function send(
  response: ServerResponse,
  file: string,
  status: number,
  acceptEncoding: string
): void {
  const type = extname(file);
  const headers: Record<string, string> = {
    "content-type": CONTENT_TYPES[type] ?? "application/octet-stream",
  };
  if (file.includes(`${sep}_astro${sep}`)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  const stream = createReadStream(file);
  if (COMPRESSIBLE.has(type) && acceptEncoding.includes("br")) {
    response.writeHead(status, { ...headers, "content-encoding": "br" });
    stream.pipe(createBrotliCompress()).pipe(response);
  } else if (COMPRESSIBLE.has(type) && acceptEncoding.includes("gzip")) {
    response.writeHead(status, { ...headers, "content-encoding": "gzip" });
    stream.pipe(createGzip()).pipe(response);
  } else {
    response.writeHead(status, headers);
    stream.pipe(response);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolveRequest(
  url: string
): Promise<{ file: string | null; status: number }> {
  const pathname = decodeURIComponent(new URL(url, "http://x").pathname);
  const base = join(SITE_ROOT, normalize(pathname));
  if (base === SITE_ROOT || base.startsWith(SITE_ROOT + sep)) {
    for (const candidate of [base, join(base, "index.html"), `${base}.html`]) {
      if (await isFile(candidate)) {
        return { file: candidate, status: 200 };
      }
    }
  }
  const notFound = join(SITE_ROOT, "404.html");
  return { file: (await isFile(notFound)) ? notFound : null, status: 404 };
}

/** Serve the built site on `localhost`. Fails when nothing has been built. */
export async function serveDist(
  port = 0
): Promise<{ origin: string; close: () => Promise<void> }> {
  if (!(await isFile(join(SITE_ROOT, "index.html")))) {
    throw new Error(
      `No built site at ${SITE_ROOT}. Run \`pnpm --filter @saasaloy/web build\` first.`
    );
  }
  const server = createServer((request, response) => {
    void resolveRequest(request.url ?? "/").then(({ file, status }) => {
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      send(response, file, status, String(request.headers["accept-encoding"]));
    });
  });
  server.listen(port, "localhost");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

/**
 * The Chromium the gate drives. `CHROME_PATH` wins, so a machine with a different
 * Playwright build in its cache can point at it; otherwise Playwright's own, which CI
 * installs with `playwright install --with-deps chromium`.
 */
export async function chromiumPath(): Promise<string> {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    return fromEnv;
  }
  const { chromium } = await import("playwright");
  return chromium.executablePath();
}
