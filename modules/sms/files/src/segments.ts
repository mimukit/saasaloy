// What a message will cost to send, before it goes. Exported from the package root
// because a caller that wants to warn ("this is 3 messages") needs the same answer the
// core attaches to every send — two implementations of this would eventually disagree.
//
// The core computes and reports. It never truncates (silent data loss, and the cut point
// is a product decision) and never refuses a long body (a policy that varies by project).

/**
 * How the message will be encoded on the wire. Not a choice — the body decides it.
 */
export type SmsEncoding = "gsm-7" | "ucs-2";

export interface SmsSegmentation {
  encoding: SmsEncoding;
  /** Septets for `gsm-7`, UTF-16 code units for `ucs-2`. Escape pairs count as 2. */
  units: number;
  /** How many concatenated parts the message will be split into. Always >= 1. */
  segments: number;
}

/**
 * The GSM 03.38 basic character set — every character that costs **one** septet. Written
 * out in code-point order (0x00–0x7F) minus the ESC slot at 0x1B, which is not a character
 * a caller sends but the prefix that introduces the extension table below.
 */
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);

/**
 * The GSM 03.38 extension table: still GSM-7, but each of these is sent as ESC + the
 * character and therefore costs **two** septets. This is the reason a length-only estimate
 * is silently wrong — `€` alone breaks it, and any European price string carries one.
 *
 * Form feed (U+000C) is the tenth entry in the published table and is deliberately absent:
 * treating it as non-GSM pushes a body containing one to UCS-2, which over-estimates
 * rather than under-estimates, and nobody puts a form feed in a text message.
 */
const GSM7_EXTENDED = new Set("^{}\\[~]|€");

/** Single-segment capacity. A message that fits here carries no concatenation header. */
const GSM7_SINGLE = 160;
const UCS2_SINGLE = 70;

/**
 * Capacity of one part of a *concatenated* message. The User Data Header that tells the
 * handset how to reassemble the parts eats the difference — which is why 161 GSM-7
 * characters is two parts of 153 and not 160 + 1.
 *
 * These are the standard 8-bit-reference numbers. A US/CA **toll-free** sender uses a
 * 16-bit reference and gets 152/66 instead, so a long toll-free message can need one more
 * part than reported here. Documented rather than modelled: the core is handed a `from`
 * it deliberately doesn't parse (see `provider.ts`), so it cannot know the sender type.
 */
const GSM7_PART = 153;
const UCS2_PART = 67;

/**
 * Measure a body: its encoding, its size in that encoding's units, and its part count.
 *
 * ```ts
 * measureSegments("Your code is 123456");        // gsm-7,  19 units, 1 segment
 * measureSegments("Your code is 123456 ✅");     // ucs-2,  21 units, 1 segment
 * ```
 */
export function measureSegments(body: string): SmsSegmentation {
  // Iterate by code point, not by index: an emoji is one character to a reader and two
  // UTF-16 code units on the wire, and `body[i]` would hand back half of it.
  const characters = [...body];
  const encoding: SmsEncoding = characters.every(isGsm7) ? "gsm-7" : "ucs-2";

  const costs =
    encoding === "gsm-7"
      ? characters.map((character) => (GSM7_EXTENDED.has(character) ? 2 : 1))
      : characters.map((character) => character.length);

  const units = costs.reduce((total, cost) => total + cost, 0);
  const single = encoding === "gsm-7" ? GSM7_SINGLE : UCS2_SINGLE;
  const part = encoding === "gsm-7" ? GSM7_PART : UCS2_PART;

  return { encoding, units, segments: countParts(costs, units, single, part) };
}

/** Just the part count — what `send()` attaches as `estimatedSegments`. */
export function countSegments(body: string): number {
  return measureSegments(body).segments;
}

/**
 * Pack the per-character costs into parts.
 *
 * The naive `ceil(units / part)` is wrong for the same reason both encodings have
 * two-unit characters: a GSM-7 escape pair and a UTF-16 surrogate pair are each
 * indivisible, so one that would straddle a boundary moves whole into the next part and
 * leaves a septet (or a code unit) unused behind it. 153 tildes is three parts, not two.
 */
function countParts(
  costs: number[],
  units: number,
  single: number,
  part: number
): number {
  if (units <= single) {
    return 1;
  }

  let parts = 1;
  let used = 0;
  for (const cost of costs) {
    if (used + cost > part) {
      parts += 1;
      used = cost;
    } else {
      used += cost;
    }
  }
  return parts;
}

function isGsm7(character: string): boolean {
  return GSM7_BASIC.has(character) || GSM7_EXTENDED.has(character);
}
