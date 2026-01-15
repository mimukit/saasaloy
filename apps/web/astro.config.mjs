// @ts-check
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import "@repo/config/env/web";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightThemeBlack from "starlight-theme-black";

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    starlight({
      title: "SaasAloy",
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
      social: [
        {
          href: "https://github.com/mimukit/saasaloy",
          icon: "github",
          label: "GitHub",
        },
      ],
      plugins: [
        starlightThemeBlack({
          // optional
          navLinks: [
            {
              label: "Docs",
              link: "/docs",
            },
          ],
          //optional
          footerText:
            "Design & development by [Mukitul Islam Mukit](https://github.com/mukitulislammukit).",
        }),
      ],
    }),
    mdx(), // need to be after starlight config
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
