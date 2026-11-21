// Descriptor keys a released descriptor may carry and this CLI's schema no longer accepts
// (plan 0117, "Old descriptors at an old ref"). The render of an older release still has
// to load that release's descriptors: it is the base of a merge, a side a conversion
// proves a hash against, and the source `env` reads a pinned module's variables from. So
// a read at a ref that is not the running CLI's own translates each retired key into the
// shape that replaced it before the schema check. A read of the running registry never
// translates, and the schema refuses the key there.
//
// The retired keys:
//
//   - `onlyWith: X` on a `files[]` or `scaffolds[].files[]` entry (#99, retired by ADR
//     0065). It shipped the entry only while module X was installed, which is exactly
//     `when: { installed: [X] }`. Every released use names one of the two SQL drivers,
//     so with `database-postgres` installed an old render keeps one source per target:
//     the `.pg.ts` twin.

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One file entry with `onlyWith: X` turned into `when.installed` holding X. */
function translateFile(file: unknown): unknown {
  if (!isEntry(file) || !("onlyWith" in file)) {
    return file;
  }
  const { onlyWith, ...rest } = file;
  if (typeof onlyWith !== "string") {
    // Not a shape any release wrote: leave it for the schema to refuse.
    return file;
  }
  if (rest.when !== undefined && !isEntry(rest.when)) {
    // A malformed `when` stays as written, so the schema refuses it rather than the
    // translation replacing it with a valid condition.
    return file;
  }
  const when: Entry = isEntry(rest.when) ? rest.when : {};
  if (when.installed !== undefined && !Array.isArray(when.installed)) {
    return file;
  }
  const installed = (when.installed as unknown[] | undefined) ?? [];
  return {
    ...rest,
    when: {
      ...when,
      installed: installed.includes(onlyWith)
        ? [...installed]
        : [...installed, onlyWith],
    },
  };
}

function translateFiles(files: unknown): unknown {
  return Array.isArray(files) ? files.map(translateFile) : files;
}

/**
 * A copy of a raw descriptor with every retired key translated into its replacement.
 * The input is never changed. A value that is not a descriptor object comes back as is.
 */
export function normalizeRetiredKeys(raw: unknown): unknown {
  if (!isEntry(raw)) {
    return raw;
  }
  const out: Entry = { ...raw };
  if ("files" in raw) {
    out.files = translateFiles(raw.files);
  }
  if (Array.isArray(raw.scaffolds)) {
    out.scaffolds = raw.scaffolds.map((scaffold: unknown) =>
      isEntry(scaffold) && "files" in scaffold
        ? { ...scaffold, files: translateFiles(scaffold.files) }
        : scaffold
    );
  }
  return out;
}
