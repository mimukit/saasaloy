// A `?raw` import is the file's text: Vite's own query under vitest, and the `raw-text`
// esbuild plugin in tsup.config.ts in the build. ./lib/kits.ts reads the kit blocks so.
declare module "*?raw" {
  const text: string;
  export default text;
}
