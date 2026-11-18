import { describe, expect, it } from "vitest";
import type { AgentDocument, AgentSection } from "./llms";
import { joinUrl, llmsFullTxt, llmsTxt, siteJsonLd } from "./llms";

const SITE = new URL("https://acme.test");

const PAGES = [
  {
    title: "Acme: ledgers for shops",
    path: "/index.md",
    markdown: "# Ledgers for shops\n\nAcme keeps the books.\n",
  },
  {
    title: "Privacy Policy",
    path: "/privacy.md",
    markdown: "# Privacy Policy\n\nWe keep little.\n",
  },
];

const API: AgentSection = {
  title: "API for agents",
  summary: "Call Acme's tools with a key.",
  links: [
    {
      title: "MCP server",
      url: "https://api.acme.test/mcp",
      note: "Streamable HTTP.",
    },
  ],
  full: "Send `Authorization: Bearer <key>`.",
};

function doc(sections: AgentSection[] = []): AgentDocument {
  return {
    name: "Acme",
    summary: "Acme keeps the books for small shops.",
    site: SITE,
    pages: PAGES,
    sections,
  };
}

describe(llmsTxt, () => {
  it("opens with the name and the summary, in the llmstxt.org shape", () => {
    const text = llmsTxt(doc());
    expect(
      text.startsWith("# Acme\n\n> Acme keeps the books for small shops.\n")
    ).toBeTruthy();
  });

  it("links the Markdown copy of each public page, absolute on the site", () => {
    const text = llmsTxt(doc());
    expect(text).toContain("## Pages");
    expect(text).toContain(
      "- [Acme: ledgers for shops](https://acme.test/index.md)"
    );
    expect(text).toContain("- [Privacy Policy](https://acme.test/privacy.md)");
  });

  it("names the full text file under Optional", () => {
    expect(llmsTxt(doc())).toContain(
      "## Optional\n\n- [Full text](https://acme.test/llms-full.txt)"
    );
  });

  it("writes one section per registered entry, with its links and notes", () => {
    const text = llmsTxt(doc([API]));
    expect(text).toContain(
      "## API for agents\n\nCall Acme's tools with a key.\n\n- [MCP server](https://api.acme.test/mcp): Streamable HTTP."
    );
  });

  it("names no MCP address when no entry adds one", () => {
    expect(llmsTxt(doc())).not.toContain("/mcp");
  });

  it("leaves out an entry with no links", () => {
    const text = llmsTxt(doc([{ title: "Empty", links: [] }]));
    expect(text).not.toContain("## Empty");
  });
});

describe(llmsFullTxt, () => {
  it("holds every page's Markdown with its source address", () => {
    const text = llmsFullTxt(doc([API]));
    expect(text.startsWith("# Acme\n\n> Acme keeps the books")).toBeTruthy();
    expect(text).toContain("# Ledgers for shops\n\nAcme keeps the books.");
    expect(text).toContain("# Privacy Policy\n\nWe keep little.");
    expect(text).toContain("Source: https://acme.test/privacy.md");
  });

  it("holds each entry's links and full text", () => {
    const text = llmsFullTxt(doc([API]));
    expect(text).toContain("## API for agents");
    expect(text).toContain("https://api.acme.test/mcp");
    expect(text).toContain("Send `Authorization: Bearer <key>`.");
  });
});

describe(joinUrl, () => {
  it("joins an origin and a path with one slash", () => {
    expect(joinUrl("https://api.acme.test", "/mcp")).toBe(
      "https://api.acme.test/mcp"
    );
    expect(joinUrl("https://api.acme.test/", "/mcp")).toBe(
      "https://api.acme.test/mcp"
    );
  });

  it("keeps a path prefix on the base", () => {
    expect(joinUrl("https://acme.test/api/", "/mcp")).toBe(
      "https://acme.test/api/mcp"
    );
  });
});

describe(siteJsonLd, () => {
  const json = siteJsonLd({
    name: "Acme",
    site: SITE,
    logoPath: "/favicon.svg",
    description: "Acme keeps the books.",
  });

  it("describes the organization and the site, linked by id", () => {
    const parsed = JSON.parse(json) as {
      "@context": string;
      "@graph": Record<string, unknown>[];
    };
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@graph"]).toStrictEqual([
      {
        "@type": "Organization",
        "@id": "https://acme.test/#organization",
        name: "Acme",
        url: "https://acme.test/",
        logo: "https://acme.test/favicon.svg",
      },
      {
        "@type": "WebSite",
        "@id": "https://acme.test/#website",
        name: "Acme",
        url: "https://acme.test/",
        description: "Acme keeps the books.",
        publisher: { "@id": "https://acme.test/#organization" },
      },
    ]);
  });

  it("escapes a closing script tag in a value", () => {
    const text = siteJsonLd({
      name: "</script><b>",
      site: SITE,
      logoPath: "/favicon.svg",
      description: "",
    });
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text)).toBeTruthy();
  });
});
