import { defineSection } from "@repo/config/define";

// `storage`'s config section, installed by `saasaloy add storage`.
//
// `maxUploadBytes` was the `STORAGE_MAX_UPLOAD_BYTES` env var until #162. Two deployments
// of one project accept the same files, so it is checked in here. Change it in
// `packages/config/src/project.ts`.
//
// What is *not* here: the provider selection, the link-signing secret, the proxy origin.
// Those differ between two deployments of this same project, which makes them `env` values.

/** The `storage` section. Override it in `packages/config/src/project.ts`. */
export function storageConfig() {
  return defineSection("storage", {
    /**
     * The per-file upload cap in bytes. The proxy route refuses a larger body, a signed
     * upload link carries the cap, and the `file-uploads` picker checks it before it sends.
     * The default is 104857600 (100 MiB), the Free-plan Worker request body limit.
     *
     * What a change costs: a proxied upload streams through the Worker, so a cap above
     * your plan's request body limit (100 MiB Free and Pro, 500 MiB Business) fails at
     * Cloudflare instead of with this capability's error. A larger cap also lets one
     * tenant fill the bucket faster, because v1 sets no total quota. A lower cap turns away
     * files that worked before. A whole number of bytes above zero.
     */
    maxUploadBytes: 104_857_600,
  });
}
