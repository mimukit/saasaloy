/** @type {import('prettier').Config} */
export default {
  plugins: [
    "@trivago/prettier-plugin-sort-imports",
    "prettier-plugin-astro",
    "prettier-plugin-tailwindcss", // needs to be last
  ],
  endOfLine: "lf",
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  importOrder: [
    "^react",
    "<BUILTIN_MODULES>",
    "<THIRD_PARTY_MODULES>",
    "^@/(.*)$",
    "^[./]",
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  overrides: [
    {
      files: "*.astro",
      options: {
        parser: "astro",
      },
    },
  ],
};
