// Types for the files in this folder. A bundler turns an imported asset into a URL
// string, which is all a component in @repo/ui needs to know about it. Vite's own
// `vite/client` types say the same for the admin app; this file says it for the
// package's own typecheck, which does not load Vite's types.

declare module "*.svg" {
  const src: string;
  export default src;
}
