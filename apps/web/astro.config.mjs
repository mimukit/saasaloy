// @ts-check
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    starlight({
      title: "SaasAloy Documentation",
      description:
        "SaasAloy is an enterprise-grade, open-source SaaS starter kit designed for 2026's 'Native-AI' landscape, prioritizing data sovereignty and agentic autonomy without the typical 'platform tax' of proprietary boilerplates.",
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Example Guide", slug: "guides/example" },
          ],
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
    mdx(), // need to be after starlight config
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
