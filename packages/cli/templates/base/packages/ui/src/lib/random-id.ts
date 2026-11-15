// A random v4 UUID that works on a page that is not a secure context.
//
// `crypto.randomUUID()` exists only on https and localhost. A dev server opened over a
// plain-http address (a remote dev box, a phone on the LAN) has no `randomUUID`, and the
// call throws. `crypto.getRandomValues()` works in every context, so the id is built
// from it.

/** A v4 UUID: 8-4-4-4-12 lowercase hex, with the version and variant bits set. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Byte 6 carries the version in its high nibble (0100), byte 8 the RFC 9562 variant in
  // its top two bits (10). The low bits stay random.
  bytes[6] = 0x40 + ((bytes[6] as number) % 0x10);
  bytes[8] = 0x80 + ((bytes[8] as number) % 0x40);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
