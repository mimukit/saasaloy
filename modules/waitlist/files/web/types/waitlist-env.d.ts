// Augments Astro/Vite's `ImportMetaEnv` so `import.meta.env.PUBLIC_API_URL` typechecks
// in WaitlistForm.tsx. A global ambient `interface` declaration merges into the
// project's env typing with no edit to any shared file — TypeScript unions same-named
// interfaces across files, so this stays a pure file-drop.
interface ImportMetaEnv {
  readonly PUBLIC_API_URL?: string;
}
