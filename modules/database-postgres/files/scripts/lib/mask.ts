// The output masker for `pnpm db:prod:query`. It masks each output column whose name some
// table classes `pii` in `packages/db/src/column-classes/`, by the shape of the value:
//
//   +15551234567          +155****4567
//   ada@example.com       ***@example.com
//   anything else         [masked, 14 chars]
//   a number, a JSON      [masked]
//   null                  null
//
// A name shared with a plain column of another table is masked too: a result row does not
// say which table a column came from. Alias it (`select name as plan_name`) to see it.
//
// It is an accident guard, not a boundary. An alias or an expression gets past it, and
// masking applies to output only, so a WHERE clause still matches the raw value.

const PHONE = /^\+?\d{7,15}$/;
const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/** `+155****4567`: the first four characters and the last four. */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 8, 3))}${phone.slice(-4)}`;
}

/** Mask one value of a `pii` column. `null` stays `null`, so "no value" stays visible. */
export function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "string") {
    return "[masked]";
  }
  if (PHONE.test(value)) {
    return maskPhone(value);
  }
  const email = EMAIL.exec(value);
  if (email) {
    return `***@${email[1] ?? ""}`;
  }
  return `[masked, ${String(value.length)} chars]`;
}

/** A copy of `row` with every column `pii` names masked. */
export function maskRow(
  row: Readonly<Record<string, unknown>>,
  pii: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      pii.has(column) ? maskValue(value) : value,
    ])
  );
}

/** Every SQL column name some table classes `pii`: the columns `maskRow` masks. */
export function piiColumns(
  classes: readonly {
    columns: Readonly<Record<string, string>>;
  }[]
): Set<string> {
  return new Set(
    classes.flatMap((entry) =>
      Object.entries(entry.columns)
        .filter(([, value]) => value === "pii")
        .map(([column]) => column)
    )
  );
}
