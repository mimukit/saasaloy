// A one-time code must not reach an admin screen. The log stores no body, but a provider's
// error text can echo the message it refused. Every run of 4 to 8 digits standing on its
// own is a candidate code and is masked, also after `+` or `_` (a form-encoded body). A run
// joined to a letter or a hyphen (`INV-2026-000001`) is a reference and stays. An E.164
// number has more than 8 digits and stays, so the text still says which number failed.

const CODE = /(?<![\dA-Za-z-])\d{4,8}(?![\dA-Za-z-])/g;

/** `text` with every standalone run of 4 to 8 digits replaced by bullets of its length. */
export function maskCodes(text: string): string {
  return text.replaceAll(CODE, (digits) => "•".repeat(digits.length));
}
