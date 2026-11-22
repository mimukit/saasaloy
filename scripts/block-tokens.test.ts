// Guards the mix rule of Saasaloy UI (plan 0121): a block reads semantic tokens only
// (`bg-background`, `text-primary`, `var(--radius)`), so every theme fits every block. A
// hard-coded colour in a block paints the same in every theme and breaks that promise.
//
// It reads each block as text and fails on:
//
//   - a hex colour (`#315fe8`, `#fff`);
//   - a colour function (`rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `oklab(`, `lab(`,
//     `lch(`, `hwb(`, `color(`). `color-mix(in oklch, …)` names a space, not a colour;
//   - a Tailwind palette class (`bg-blue-500`, `text-zinc-400/80`), and `black` or `white`
//     on any colour utility, `shadow-` included. A theme owns shadows, so a shadow tint
//     reads a token (`shadow-foreground/5`), not `shadow-black/5`.
//
// One exception, an alpha value and not a colour: the `#000` inside a `mask-image`
// gradient is the mask's opacity, so a theme has nothing to change there.
//
// The folders are a list: kit blocks (packages/cli/templates/kits/<kit>/blocks/) join
// through the glob, and a module block joins through its file in apps/web/registry.json.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Globs, from the repo root, for the files every check reads. */
const BLOCK_GLOBS = [
  "packages/cli/templates/base/packages/ui/src/blocks/*.tsx",
  "packages/cli/templates/kits/*/blocks/**/*.tsx",
];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe";
const COLOUR_UTILITIES =
  "bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|drop-shadow|text-shadow";

const CHECKS: { rule: string; pattern: RegExp }[] = [
  { rule: "hex colour", pattern: /#[0-9a-fA-F]{3,8}(?![\w-])/g },
  {
    rule: "colour function",
    pattern: /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/g,
  },
  {
    rule: "palette class",
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:${COLOUR_UTILITIES})-(?:${PALETTE})-\d{2,3}(?![\w-])`,
      "g"
    ),
  },
  {
    rule: "black or white class",
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:${COLOUR_UTILITIES})-(?:black|white)(?![\w-])`,
      "g"
    ),
  },
];

// The alpha mask: `mask-image:` up to the end of its arbitrary value or declaration.
const MASK_IMAGE = /mask-image:[^\]"';]*/g;

interface Finding {
  line: number;
  rule: string;
  text: string;
}

/** Every hard-coded colour in `source`, with its line. */
function findColours(source: string): Finding[] {
  // Blank each mask-image value's `#000`, keeping the offsets, so its alpha stop passes.
  const masked = source.replaceAll(MASK_IMAGE, (value) =>
    value.replaceAll(/#000(?![\w-])/g, "    ")
  );
  const findings: Finding[] = [];
  for (const { rule, pattern } of CHECKS) {
    for (const match of masked.matchAll(pattern)) {
      findings.push({
        line: masked.slice(0, match.index).split("\n").length,
        rule,
        text: match[0],
      });
    }
  }
  return findings.toSorted((a, b) => a.line - b.line);
}

/** The block files of the module items apps/web/registry.json names. */
function moduleBlockFiles(): string[] {
  const registry = JSON.parse(
    readFileSync(join(ROOT, "apps/web/registry.json"), "utf-8")
  ) as { items: { type: string; files?: { path: string }[] }[] };
  return registry.items
    .filter((item) => item.type === "registry:block")
    .flatMap((item) => item.files ?? [])
    .map((file) => join(ROOT, "apps/web", file.path))
    .filter((file) => file.includes("/modules/"));
}

/** Every block file the rule covers, absolute. */
function blockFiles(): string[] {
  const fromGlobs = BLOCK_GLOBS.flatMap((pattern) =>
    globSync(pattern, { cwd: ROOT }).map((file) => join(ROOT, file))
  );
  return [...new Set([...fromGlobs, ...moduleBlockFiles()])]
    .filter((file) => existsSync(file))
    .toSorted();
}

describe("block tokens", () => {
  it("finds the base blocks", () => {
    const names = blockFiles().map((file) => relative(ROOT, file));
    assert.ok(
      names.some((name) => name.endsWith("blocks/hero.tsx")),
      `the base hero is missing from ${names.join(", ")}`
    );
  });

  for (const file of blockFiles()) {
    it(`${relative(ROOT, file)} uses semantic tokens only`, () => {
      const findings = findColours(readFileSync(file, "utf-8"));
      assert.deepEqual(
        findings.map(
          (finding) => `${finding.line}: ${finding.rule} ${finding.text}`
        ),
        []
      );
    });
  }

  it("fails a fixture block with a palette class", () => {
    const fixture = `export function Hero() {\n  return <section className="bg-blue-500 text-white">Hi</section>;\n}\n`;
    assert.deepEqual(
      findColours(fixture).map((finding) => finding.text),
      ["bg-blue-500", "text-white"]
    );
  });

  it("fails a hex, an rgb() and an oklch() colour", () => {
    const fixture = `const a = "#315fe8";\nconst b = "rgb(0 0 0)";\nconst c = "[color:oklch(0.5_0.1_250)]";\n`;
    assert.deepEqual(
      findColours(fixture).map((finding) => finding.rule),
      ["hex colour", "colour function", "colour function"]
    );
  });

  it("allows the #000 in a mask-image gradient and a token shadow tint", () => {
    const fixture = `<div className="[mask-image:radial-gradient(ellipse_at_center,#000,transparent_70%)] shadow-md shadow-foreground/5 [--grid-line:color-mix(in_oklch,var(--foreground)_5%,transparent)]" />`;
    assert.deepEqual(findColours(fixture), []);
  });

  it("fails a black or white shadow tint", () => {
    const fixture = `<div className="shadow-md shadow-black/5 drop-shadow-white" />`;
    assert.deepEqual(
      findColours(fixture).map((finding) => finding.text),
      ["shadow-black", "drop-shadow-white"]
    );
  });

  it("still fails a #000 outside a mask", () => {
    assert.equal(findColours(`<div style={{ color: "#000" }} />`).length, 1);
  });

  it("leaves a same-page anchor alone", () => {
    assert.deepEqual(findColours(`<a href="/#features">x</a>`), []);
  });
});
