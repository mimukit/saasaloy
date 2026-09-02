import { gzipSync } from "node:zlib";

// A minimal ustar writer, so a fixture server can serve the same shape GitHub's
// `/tarball/<ref>` endpoint does without pulling a tar library into the CLI's devDeps
// (the package deliberately keeps its dependency list short and auditable).
//
// Only what the fixture needs: regular files, no directory entries, no long names, no
// symlinks. giget strips the first path segment of every entry, so every path here
// carries the `<owner>-<repo>-<sha>/` prefix GitHub puts there.

const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(path: string, size: number): Buffer {
  if (Buffer.byteLength(path) > 100) {
    throw new Error(`tar fixture path is too long for a ustar header: ${path}`);
  }
  const block = Buffer.alloc(BLOCK);
  block.write(path, 0, 100, "utf-8");
  block.write(octal(0o644, 8), 100, 8, "utf-8"); // mode
  block.write(octal(0, 8), 108, 8, "utf-8"); // uid
  block.write(octal(0, 8), 116, 8, "utf-8"); // gid
  block.write(octal(size, 12), 124, 12, "utf-8");
  block.write(octal(0, 12), 136, 12, "utf-8"); // mtime — fixed, so a tarball is stable
  block.write(" ".repeat(8), 148, 8, "utf-8"); // checksum field, spaces while summing
  block.write("0", 156, 1, "utf-8"); // typeflag: regular file
  block.write("ustar\0", 257, 6, "utf-8");
  block.write("00", 263, 2, "utf-8");

  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${octal(sum, 7)} `, 148, 8, "utf-8");
  return block;
}

function pad(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/** A gzipped tar of `files` (path → UTF-8 content), paths taken as written. */
export function tarGz(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, "utf-8");
    parts.push(header(path, body.length), body, pad(body.length));
  }
  // Two zero blocks close the archive.
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}
