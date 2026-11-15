import { resolve } from "node:path";
import { runnerImport } from "vite";
import type * as RepositoryModule from "../../db/src/repositories/cms";
import type * as UploadsModule from "../../../apps/api/src/lib/file-uploads";
import type * as RegistryModule from "../src/index";
import { openDb } from "./open-db.ts";

// `pnpm cms:rerender`: rebuild the stored `html` of every live revision.
//
// Run it after a Tiptap or renderer upgrade, or after `STORAGE_PUBLIC_URL` changes, because
// a revision stores HTML rendered at publish and image URLs are baked into it. Drafts and
// older revisions are left alone: only what the public site serves is rewritten.
//
// It writes to the local database only, the one `vite dev` uses. `NODE_ENV=production` is
// refused. The package script loads `apps/api/.env`, so `STORAGE_PUBLIC_URL`,
// `STORAGE_IMAGE_TRANSFORMS` and, under `database-postgres`, `DATABASE_URL` are the api's.
//
// The repository, the registry and `publicImageUrl` are loaded through Vite's
// `runnerImport`, because they import their siblings without a file extension and plain
// Node cannot resolve that. `./open-db.ts` is the one driver-specific file.

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

const root = resolve(import.meta.dirname, "../../..");

async function load<T>(file: string, workspace: string): Promise<T> {
  const { module } = await runnerImport<T>(resolve(root, file), {
    logLevel: "error",
    root: resolve(root, workspace),
  });
  return module;
}

type Repository = typeof RepositoryModule;
type Registry = typeof RegistryModule;
type Uploads = typeof UploadsModule;

try {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "cms:rerender writes to the local database only. Unset NODE_ENV=production."
    );
  }
  const repository = await load<Repository>(
    "packages/db/src/repositories/cms.ts",
    "packages/db"
  );
  const registry = await load<Registry>(
    "packages/cms/src/index.ts",
    "packages/cms"
  );
  const uploads = await load<Uploads>(
    "apps/api/src/lib/file-uploads.ts",
    "apps/api"
  );

  const env = process.env as Parameters<Uploads["publicImageUrl"]>[0];
  const skipped = new Set<string>();
  const { db, dispose, target } = await openDb(root);
  let rewritten: number;
  try {
    rewritten = await repository.rerenderLiveRevisions(db, (snapshot) => {
      if (!registry.cms.has(snapshot.collection)) {
        skipped.add(snapshot.collection);
        return null;
      }
      return registry.renderCollectionHtml(
        registry.cms.collection(snapshot.collection),
        snapshot.data,
        { imageUrl: (key) => uploads.publicImageUrl(env, key) }
      );
    });
  } finally {
    await dispose();
  }

  say(
    `Re-rendered ${rewritten} live revision${rewritten === 1 ? "" : "s"} in ${target}.`
  );
  for (const name of skipped) {
    say(
      `Skipped collection "${name}": it is not registered in packages/cms/src/index.ts.`
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
