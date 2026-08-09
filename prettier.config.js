import ultracite from "ultracite/prettier";

// Ultracite's Prettier config carries no `plugins` key, so this is a spread rather
// than a re-export: we add Astro parsing and Tailwind class sorting on top.
// `prettier-plugin-tailwindcss` must stay LAST — it wraps whichever printer runs
// before it, and loses its sorting if another plugin is loaded after it.
export default {
  ...ultracite,
  plugins: ["prettier-plugin-astro", "prettier-plugin-tailwindcss"],
};
