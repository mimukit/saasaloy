// Guard for the one landing-page regression neither `build` nor `typecheck` can see: a
// user-visible string written back into a block instead of into the content module.
//
// The base template keeps every word the landing page shows in
// packages/ui/src/content/landing.ts, so a project owner (or the saasaloy-landing-copy
// skill) rewrites copy in one file. Nothing enforces that. Paste `<Badge>Most popular</Badge>`
// back into pricing-table.tsx and the build stays green, the types stay green, and the
// string is once again something a founder has to hunt for in markup.
//
// So: scan the template's blocks, and the page that composes them, and fail on three shapes.
//
//   A. a string literal that reads like prose        `title = "Start building today"`
//   B. text sitting directly in JSX                  `<Badge>Most popular</Badge>`
//   C. an accessibility label written as a literal   `aria-label="Main"`
//
// Class names are exempt — a Tailwind string is not copy — so `className=`/`class=`
// values and `cn(…)` arguments are stripped before rule A runs.
//
// This is a TEXTUAL check, deliberately: like verify-css it imports nothing but node:
// builtins, so there is no TypeScript parser here. That buys a real trade: it catches the
// shapes above and can miss an exotic one (a single-word literal handed to a prop, copy
// assembled by a helper). It is a guard against drift, not a proof.
//
// NOT part of `deps:verify` — the same call verify-preset makes. `deps:verify` is the
// post-dependency-bump gate and scaffolds, installs and builds a playground to get there;
// this needs none of that and answers a different question. Run it by hand —
// `pnpm verify:content` — after touching a block or the content module.
//
// Node 24 strips the types, so there is no build step; `pnpm typecheck` checks it via
// tsconfig.scripts.json.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const BASE_UI = "packages/cli/templates/base/packages/ui";
const BLOCKS_DIR = join(root, BASE_UI, "src/blocks");
const CONTENT_MODULE = join(root, BASE_UI, "src/content/landing.ts");
// The page that composes the blocks is the second place a string can drift back in: it owns
// the tab title and meta description, and both now read from `landing.meta`. Rules A and C
// apply to Astro frontmatter and markup unchanged, and rule B reads the template markup the
// same way it reads JSX.
const LANDING_PAGE = join(
  root,
  "packages/cli/templates/base/apps/web/src/pages/index.astro"
);

// The attributes whose value a screen reader or a tooltip reads out loud. Any literal
// here is user-visible even when it is a single word, so rule C ignores the prose test.
const SPOKEN_ATTRIBUTES = ["aria-label", "alt", "title", "placeholder"];

interface Finding {
  rule: string;
  line: number;
  text: string;
}

function fail(message: string, ...detail: string[]): never {
  console.error(`verify-content: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

/** 1-based line number of `index` in `source`. */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") {
      line++;
    }
  }
  return line;
}

/**
 * Blank out every comment, keeping newlines so line numbers survive.
 *
 * Quoted regions are walked rather than skipped, so a `//` inside a string cannot start a
 * phantom comment.
 */
function stripComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length;) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) {
        out += source[j] === "\n" ? "\n" : " ";
      }
      i = stop;
      continue;
    }
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      i++;
      while (i < source.length) {
        out += source[i];
        if (source[i] === "\\") {
          i++;
          if (i < source.length) {
            out += source[i];
          }
          i++;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

/** Replace `from`…matching-close-paren with spaces, honouring nesting and quotes. */
function blankCall(source: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i++;
      while (i < source.length && source[i] !== quote) {
        i += source[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (char === "(") {
      depth++;
    }
    if (char === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  const blanked = source.slice(from, i).replaceAll(/[^\n]/g, " ");
  return source.slice(0, from) + blanked + source.slice(i);
}

/** Blank `className=`/`class=` values and every `cn(…)` argument list. */
function stripClassNames(source: string): string {
  let out = source.replaceAll(
    /\b(?:className|class)\s*=\s*(?:"[^"]*"|'[^']*')/g,
    (match) => match.replaceAll(/[^\n]/g, " ")
  );
  for (;;) {
    const at = out.search(/\bcn\s*\(/);
    if (at === -1) {
      break;
    }
    const open = out.indexOf("(", at);
    const next = blankCall(out, open);
    if (next === out) {
      break;
    }
    out = next;
  }
  return out;
}

/** Replace each string/template literal's contents with spaces, keeping the quotes. */
function blankLiterals(source: string): string {
  return source
    .replaceAll(
      /"[^"\n]*"/g,
      (m) => `"${" ".repeat(Math.max(0, m.length - 2))}"`
    )
    .replaceAll(
      /'[^'\n]*'/g,
      (m) => `'${" ".repeat(Math.max(0, m.length - 2))}'`
    )
    .replaceAll(
      /`[^`]*`/g,
      (m) => `\`${m.slice(1, -1).replaceAll(/[^\n]/g, " ")}\``
    );
}

// Prose, for rule A: it has letters, and it is either more than one word or ends like a
// sentence. That is what separates `"Start building today"` and `"Save 20%"` from the
// structural literals a block legitimately holds — `"cta"`, `"#pricing"`, `"icon-sm"`, `"$"`.
function isProse(value: string): boolean {
  if (!/[A-Za-z]/.test(value)) {
    return false;
  }
  return /\s/.test(value) || /[.?!]$/.test(value.trim());
}

function findProseLiterals(source: string): Finding[] {
  const findings: Finding[] = [];
  const patterns = [/"([^"\n]*)"/g, /'([^'\n]*)'/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? "";
      if (isProse(value)) {
        findings.push({
          rule: "A prose string literal",
          line: lineOf(source, match.index),
          text: value,
        });
      }
    }
  }
  // A template literal carrying words is the same defect wearing a different hat: it is a
  // function, so it can never be lifted into the catalog as-is. One with no words in its
  // static parts (`` `${symbol}${price}` ``) is composition, not copy.
  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const statics = (match[1] ?? "").split(/\$\{[^}]*\}/).join(" ");
    if (/[A-Za-z]{2,}/.test(statics)) {
      findings.push({
        rule: "A template-literal message",
        line: lineOf(source, match.index),
        text: match[1] ?? "",
      });
    }
  }
  return findings;
}

function findJsxText(source: string): Finding[] {
  const findings: Finding[] = [];
  // `>` that closes a tag — not `=>`, `!=>`, `<>` or `>>`. What follows, up to the next
  // `<`, is JSX children. Anything with code punctuation in it is not text; that is what
  // keeps `useState<Foo>(null);` and `(link) => link.label` out of the results.
  for (const match of source.matchAll(/(?<![=!<>-])>([^<>]*)</g)) {
    const text = (match[1] ?? "").trim();
    if (!/[A-Za-z]/.test(text)) {
      continue;
    }
    if (/[;(){}="'`[\]]/.test(text)) {
      continue;
    }
    findings.push({
      rule: "B text in JSX",
      line: lineOf(source, match.index),
      text,
    });
  }
  return findings;
}

function findSpokenLiterals(source: string): Finding[] {
  const findings: Finding[] = [];
  const pattern = new RegExp(
    `\\b(${SPOKEN_ATTRIBUTES.join("|")})\\s*=\\s*("([^"]*)"|'([^']*)')`,
    "g"
  );
  for (const match of source.matchAll(pattern)) {
    const value = match[3] ?? match[4] ?? "";
    if (!/[A-Za-z]/.test(value)) {
      continue;
    }
    // `aria-hidden="true"` and friends are state, not speech — but these four attributes
    // only ever carry words a person hears or reads.
    findings.push({
      rule: `C ${match[1]} literal`,
      line: lineOf(source, match.index),
      text: value,
    });
  }
  return findings;
}

/** Every rule's findings, before deduplication — one string can appear under two rules. */
function scanAll(source: string): Finding[] {
  const clean = stripComments(source);
  return [
    ...findProseLiterals(stripClassNames(clean)),
    ...findJsxText(blankLiterals(clean)),
    ...findSpokenLiterals(clean),
  ];
}

function scan(source: string): Finding[] {
  // One string can trip two rules (`title = "…"` reads as prose and as a spoken label).
  // Report the defect once, by where it is rather than by how it was caught.
  const seen = new Set<string>();
  return scanAll(source)
    .filter((finding) => {
      const key = `${finding.line}:${finding.text}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .toSorted((a, b) => a.line - b.line);
}

// ---- Guard the guard -------------------------------------------------------------------
//
// A scan that silently matches nothing would report every block as clean forever, which is
// the worst outcome available here. So prove the three rules still bite, and prove they
// still leave the structural shapes a block is allowed to contain alone.

// Each fixture names the rule it exists to prove, and is matched on that letter rather than
// on "some rule fired": two of these trip a second rule as well (`title` is a spoken
// attribute *and* prose; `"A dashboard"` has whitespace, so rule A catches it too), and a
// loose check would let the rule they were written for stop matching unnoticed. `Finding.rule`
// is already prefixed with the letter, so `startsWith` is the whole test — run against
// `scanAll`, because `scan`'s dedupe keeps only the first rule to reach a given line+text.
const MUST_FLAG = [
  ["A", 'const title = "Start building today";'],
  // Not an unintended placeholder: this is a source-code sample, and the `${…}` has to stay
  // uninterpolated for the fixture to exercise the template-literal branch of rule A.
  // oxlint-disable-next-line no-template-curly-in-string
  ["A", "const d = `${siteName} gives your product a front door.`;"],
  ["B", "<Badge>Most popular</Badge>"],
  ["B", '<Button\n  size="sm"\n>\n  Monthly\n</Button>'],
  ["C", '<nav aria-label="Main" />'],
  ["C", '<img alt="A dashboard" />'],
] as const;

const MUST_PASS = [
  'const id = "cta";',
  'const href = "#pricing";',
  '<div className="mx-auto w-full max-w-6xl px-6 py-20" />',
  '<Card className={cn("h-full", featured && "ring-2 ring-primary")} />',
  '<Button size="icon-sm" variant="ghost" data-icon="inline-end" aria-hidden="true" />',
  "const toggleRef = useRef<HTMLButtonElement>(null);",
  'const links = all.filter((link) => link.label !== "");',
  // Same as the MUST_FLAG fixture above: a source-code sample whose placeholders must stay
  // literal, here to prove composition without words is *not* flagged.
  // oxlint-disable-next-line no-template-curly-in-string
  "const price = `${currencySymbol}${amount}`;",
  "// A comment with real sentences in it. It should never be flagged.",
  "<p>{interpolate(ui.footer.copyright, { year, siteName })}</p>",
];

for (const [rule, sample] of MUST_FLAG) {
  if (!scanAll(sample).some((finding) => finding.rule.startsWith(rule))) {
    fail(
      `self-test: rule ${rule} no longer flags its own example`,
      sample.replaceAll("\n", " ⏎ "),
      "The scanner is broken, so a clean run would prove nothing. Fix scripts/verify-content.ts."
    );
  }
}
for (const sample of MUST_PASS) {
  const findings = scan(sample);
  if (findings.length > 0) {
    fail(
      "self-test: the scanner flags a shape blocks are allowed to contain",
      sample,
      ...findings.map((f) => `${f.rule}: ${JSON.stringify(f.text)}`),
      "Loosen scripts/verify-content.ts rather than editing the block."
    );
  }
}

// ---- The real scan ---------------------------------------------------------------------

let contentModule: string;
try {
  contentModule = await readFile(CONTENT_MODULE, "utf-8");
} catch {
  contentModule = "";
}
if (
  !contentModule.includes("export const landing") ||
  !contentModule.includes("export const ui")
) {
  fail(
    `${relative(root, CONTENT_MODULE)} is missing its \`landing\` / \`ui\` exports`,
    "Every block reads its copy from there. Without it there is nowhere for a string to go,",
    "and this check would pass a template that has no content module at all."
  );
}

const blockFiles = (await readdir(BLOCKS_DIR).catch(() => []))
  .filter((name) => name.endsWith(".tsx"))
  .toSorted()
  .map((name) => join(BLOCKS_DIR, name));

if (blockFiles.length === 0) {
  fail(
    `no .tsx blocks found under ${relative(root, BLOCKS_DIR)}`,
    "Either the blocks moved and this script needs updating, or the template lost them."
  );
}

const scanFiles = [...blockFiles, LANDING_PAGE];

const offenders: string[] = [];
for (const file of scanFiles) {
  const source = await readFile(file, "utf-8").catch(() => null);
  if (source === null) {
    fail(
      `${relative(root, file)} is missing`,
      "Either it moved and this script needs updating, or the template lost it."
    );
  }
  for (const finding of scan(source)) {
    offenders.push(
      `${relative(root, file)}:${finding.line}  ${finding.rule} — ${JSON.stringify(finding.text)}`
    );
  }
}

if (offenders.length > 0) {
  fail(
    `${offenders.length} user-visible string(s) live in a block instead of the content module`,
    ...offenders,
    "",
    `Move each one into ${relative(root, CONTENT_MODULE)} — \`landing.*\` for marketing copy,`,
    "`ui.*` for chrome and accessibility labels — and read it from there.",
    "Interpolate with `interpolate()` from packages/ui/src/lib/interpolate.ts; never a template literal."
  );
}

console.log(
  `verify-content: ${blockFiles.length} block(s) + ${relative(root, LANDING_PAGE)} clean — ` +
    `no prose literal, JSX text or spoken label outside ${relative(root, CONTENT_MODULE)}.`
);
