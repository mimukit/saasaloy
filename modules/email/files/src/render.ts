// Rendering helpers: an escaping `html` tag, a shared layout wrapper, and the
// plaintext derivation that makes every message multipart without any template being
// authored twice. Plain tagged templates on purpose — `send()` takes `html`/`text`
// strings, so nothing here forces a rendering framework into the api Worker's bundle.

/**
 * A string that is already valid HTML and must not be escaped again. Produced by the
 * `html` tag and by `raw()`; interpolating one into another `html` tag composes
 * fragments instead of double-escaping them.
 */
export class SafeHtml {
  readonly value: string;

  // A plain field assignment, not a `readonly` constructor parameter property: the
  // latter is TS syntax that can't simply be erased, so it breaks any type-stripping
  // runtime (`node --experimental-strip-types`) a consumer might reach for.
  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Mark a string as trusted HTML. Only for markup you constructed yourself — passing
 * user input through `raw()` is exactly the injection the `html` tag prevents.
 */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A plain string is treated as text and escaped; a `SafeHtml` passes through. */
function asSafe(value: SafeHtml | string): SafeHtml {
  return value instanceof SafeHtml ? value : new SafeHtml(escapeHtml(value));
}

function interpolate(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escapeHtml(String(value));
}

/**
 * Tagged template for email HTML. **Every interpolation is escaped by default** —
 * a name, a subject line, or anything else a user typed can't inject markup:
 *
 * ```ts
 * html`<p>Hi ${user.name}, welcome to ${appName}.</p>`
 * ```
 *
 * Nested `html` fragments and arrays of them interpolate as-is; `null`, `undefined`
 * and `false` render as nothing, so `${isTrial && html`<p>…</p>`}` works.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += interpolate(values[i]) + (strings[i + 1] ?? "");
  }
  return new SafeHtml(out);
}

export interface LayoutOptions {
  /** `<title>`, and the fallback for `preheader`. */
  title: string;
  /** The message body. */
  content: SafeHtml | string;
  /** The grey line under the body — an unsubscribe note, a "you received this because…". */
  footer?: SafeHtml | string;
  /**
   * The preview line most clients show beside the subject. Hidden in the body itself.
   * Defaults to `title`.
   */
  preheader?: string;
}

/**
 * Wrap a fragment in a complete, standalone HTML document. Styles are inline and the
 * layout is a single centred column: email clients strip `<style>` blocks, ignore most
 * of CSS, and render a stray `<div>` grid as a stack of nonsense.
 */
export function layout(options: LayoutOptions): string {
  const { title, content, footer, preheader = options.title } = options;
  const body = asSafe(content);
  const foot = footer === undefined ? undefined : asSafe(footer);

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f7f9;">
    <span style="display:none;font-size:0;line-height:0;max-height:0;opacity:0;overflow:hidden;"
      >${preheader}</span
    >
    <div
      style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2933;"
    >
      ${body}
      ${foot
        ? html`<hr style="border:none;border-top:1px solid #e4e7eb;margin:32px 0 16px;" />
      <p style="font-size:13px;line-height:1.5;color:#7b8794;margin:0;">${foot}</p>`
        : ""}
    </div>
  </body>
</html>
`.value;
}

const BLOCK_END =
  /<\/(?:p|div|h[1-6]|li|ul|ol|tr|table|section|header|footer|blockquote)\s*>|<hr\s*\/?>/gi;

/** Placeholder for an author's own `<br>`, restored at the end of `deriveText`. */
const HARD_BREAK = "\u0000";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Best-effort plaintext for an HTML body — what the core uses when a message (or a
 * template) doesn't supply its own `text`. Links keep their destination
 * (`<a href="x">y</a>` → `y (x)`) because a plaintext reader can't click one.
 *
 * It is a renderer, not a sanitizer: pass it the HTML you generated, and override
 * `text` by hand whenever the derived version reads badly.
 */
export function deriveText(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    // Hidden elements — the layout's preheader span — are for the client's preview
    // pane, not for a plaintext reader who'd just see the subject line twice.
    // (`<\/\1\s*>` throughout: a formatter is free to break a closing tag across
    // lines as `</span\n  >`, and a rule that misses it silently degrades the text.)
    .replace(
      /<([a-z]+)\b[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_match, href: string, label: string) => {
        const text = stripTags(label).trim();
        return text && text !== href ? `${text} (${href})` : href;
      },
    )
    // A `<br>` is a break the author asked for; park it out of reach of the
    // soft-wrap collapse two steps down, which exists to undo the *source file's*
    // line wrapping rather than the message's own.
    .replace(/<br\s*\/?>/gi, HARD_BREAK)
    .replace(BLOCK_END, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    // A lone newline came from how the source HTML happened to wrap, not from the
    // message — rejoin it so a paragraph reads as one paragraph. Blank lines (the
    // block-level breaks above) survive.
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .split(HARD_BREAK)
    .join("\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}
