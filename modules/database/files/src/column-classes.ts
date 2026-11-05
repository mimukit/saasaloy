import { collectColumnClasses } from "./column-class";

// The column classes entry. Every file under `./column-classes/` is picked up here by the
// same Vite `import.meta.glob` the schema barrel and the seed use, so classifying a table is
// one new file and no list to edit.
//
// Only a Vite runtime executes `import.meta.glob`. A script loads this file through Vite's
// `runnerImport`, and Vitest runs it natively, so the class test reads it too. The glob is
// eager on purpose: `runnerImport` closes its module runner before it returns, and a lazy
// loader called after that throws.

const modules = import.meta.glob<Record<string, unknown>>(
  "./column-classes/*.ts",
  { eager: true }
);

/** Every table's column classes, sorted by table. */
export const columnClasses = collectColumnClasses(modules);
