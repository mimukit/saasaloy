import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "@repo/env/deploy";
import { readEnvFile } from "@repo/env/env-file";
import { describe, expect, it } from "vitest";

// `R2_BUCKET_NAME` names the bucket the BUCKET binding in ../wrangler.jsonc points at.
//
// The storage-cloudflare provider writes through the binding and signs links with
// `R2_BUCKET_NAME`. A Worker cannot read a bucket name from a binding, so nothing at runtime
// can compare the two. When they differ, uploads work and every presigned link answers
// `NoSuchBucket`. This test compares them in `packages/env/.env` and `.env.prod`. A file
// that is absent, or that leaves the key blank, is skipped: blank means links go through
// the Worker's proxy route. A value only a remote source (Infisical) holds is not seen here.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const here = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

/** The `bucket_name` of the BUCKET binding, or undefined when the config has none. */
export function bindingBucket(config: unknown): string | undefined {
  const buckets = (config as { r2_buckets?: unknown }).r2_buckets;
  if (!Array.isArray(buckets)) {
    return undefined;
  }
  const entry = buckets.find(
    (b): b is { binding: string; bucket_name?: unknown } =>
      typeof b === "object" &&
      b !== null &&
      "binding" in b &&
      b.binding === "BUCKET"
  );
  return typeof entry?.bucket_name === "string" ? entry.bucket_name : undefined;
}

/** One line per values file whose `R2_BUCKET_NAME` is set and differs from `bucket`. */
export function bucketMismatches(
  bucket: string,
  files: { file: string; value: string | undefined }[]
): string[] {
  return files
    .filter(
      ({ value }) => value !== undefined && value !== "" && value !== bucket
    )
    .map(
      ({ file, value }) =>
        `${file} sets R2_BUCKET_NAME=${String(value)}, but the BUCKET binding in apps/api/wrangler.jsonc stores objects in ${bucket}.`
    );
}

describe("R2_BUCKET_NAME", () => {
  it("names the bucket the BUCKET binding uses", () => {
    const wrangler = here("../wrangler.jsonc");
    const bucket = existsSync(wrangler)
      ? bindingBucket(parseJsonc(readFileSync(wrangler, "utf-8")))
      : undefined;
    if (bucket === undefined) {
      return;
    }
    const files = ["packages/env/.env", "packages/env/.env.prod"].map(
      (file) => ({
        file,
        value: readEnvFile(here(`../../../${file}`)).values.get(
          "R2_BUCKET_NAME"
        ),
      })
    );
    expect(bucketMismatches(bucket, files)).toStrictEqual([]);
  });

  it("reports a set value that differs, and skips a blank or absent one", () => {
    expect(
      bucketMismatches("acme-storage", [
        { file: ".env", value: "acme-web" },
        { file: ".env.prod", value: "acme-storage" },
        { file: ".env.x", value: "" },
        { file: ".env.y", value: undefined },
      ])
    ).toStrictEqual([
      ".env sets R2_BUCKET_NAME=acme-web, but the BUCKET binding in apps/api/wrangler.jsonc stores objects in acme-storage.",
    ]);
  });

  it("reads the BUCKET binding's bucket name", () => {
    const config = parseJsonc(`{
      // a comment
      "r2_buckets": [
        { "binding": "OTHER", "bucket_name": "x" },
        { "binding": "BUCKET", "bucket_name": "acme-storage" },
      ],
    }`);
    expect(bindingBucket(config)).toBe("acme-storage");
    expect(bindingBucket({})).toBeUndefined();
  });
});
