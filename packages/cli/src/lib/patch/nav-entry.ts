import { parseModule } from "magicast";
import {
  ensureNamedImport,
  importedElsewhere,
  removeNamedImport,
} from "./named-import.js";
import type { NamedImport } from "./ts-ast.js";
import {
  appendEntry,
  asArray,
  entryValue,
  findConstArray,
  findElement,
  hasEntry,
  propertyValue,
  removeEntry,
  renderKey,
  renderProperties,
} from "./ts-array.js";
import type { ArrayExpression, Program } from "./ts-array.js";

// Adding one row to the admin shell's navigation.
//
// `const-array` used to do this, back when the shell held a flat `NAV_ITEMS` of
// `{ to, label }`. The nav is now `NAV_AREAS` in its own module — areas, each holding
// groups, each holding items — and a row carries a third property, `icon`, whose value is
// an imported component rather than a JSON value. Neither is something `const-array` can
// express: it appends at the top level and it renders JSON. So this kind names the area
// and the group it is aiming at, renders the icon as the identifier it is, and keeps that
// identifier's import in step in both directions.

/** The property that identifies a nav item, in both directions. Fixed by the file's shape. */
const IDENTITY = "to";

export interface NavEntry {
  /** Module-scope const holding the areas, i.e. `NAV_AREAS`. */
  constName: string;
  /** Which area to add to, named by its `to`. */
  area: string;
  /** Which of that area's groups to add to, named by its `label`. */
  group: string;
  /** The item, minus its icon. `to` identifies it for add and remove. */
  entry: Record<string, unknown>;
  /** The icon component: rendered as `icon: <name>`, imported from `from`. */
  icon: NamedImport;
}

/** Append a nav item to one group of one area, and import the icon it names. */
export function insertNavEntry(source: string, patch: NavEntry): string {
  const items = findItems(source, patch);
  const wanted = patch.entry[IDENTITY];
  if (!items || wanted === undefined || hasEntry(items, IDENTITY, wanted)) {
    return source;
  }
  // Rendering `icon: GaugeIcon` against a `GaugeIcon` that is bound to something else
  // would compile and draw the wrong picture. Leave the file alone and let the caller say
  // why.
  if (importedElsewhere(source, patch.icon)) {
    return source;
  }

  const withEntry = appendEntry(source, items, renderItem(patch));
  return ensureNamedImport(withEntry, patch.icon);
}

/** Explain why an unchanged insert could not find its declared target shape. */
export function navEntryInsertRefusal(
  source: string,
  patch: NavEntry
): string | undefined {
  const program = parseModule(source).$ast as unknown as Program;
  const areas = findConstArray(program, patch.constName);
  if (!areas) {
    return `nav-entry could not find a module-scope const array named ${patch.constName}`;
  }
  const area = findElement(areas, IDENTITY, patch.area);
  if (!area) {
    return `nav-entry could not find an area with ${IDENTITY} ${JSON.stringify(patch.area)} in ${patch.constName}`;
  }
  const groups = arrayProperty(area, "groups");
  if (!groups) {
    return `nav-entry found the ${JSON.stringify(patch.area)} area but it has no groups array`;
  }
  const group = findElement(groups, "label", patch.group);
  if (!group) {
    return `nav-entry could not find a group labelled ${JSON.stringify(patch.group)} in the ${JSON.stringify(patch.area)} area`;
  }
  if (!arrayProperty(group, "items")) {
    return `nav-entry found the ${JSON.stringify(patch.group)} group but it has no items array`;
  }
  if (patch.entry[IDENTITY] === undefined) {
    return `nav-entry entry has no identity property named ${IDENTITY}`;
  }
  if (importedElsewhere(source, patch.icon)) {
    return `${JSON.stringify(patch.icon.name)} is already bound to something other than the named import from ${JSON.stringify(patch.icon.from)}, so the icon would render the wrong component`;
  }
  return undefined;
}

/** Take the nav item back out, and its icon import with it when nothing else reads it. */
export function removeNavEntry(source: string, patch: NavEntry): string {
  const items = findItems(source, patch);
  const wanted = patch.entry[IDENTITY];
  if (!items || wanted === undefined) {
    return source;
  }
  const index = items.elements.findIndex(
    (element) => entryValue(element, IDENTITY) === wanted
  );
  if (index === -1) {
    return source;
  }

  const withoutEntry = removeEntry(source, items, index);
  // After the row is gone, so the reference count this reads is the one that matters: a
  // second row still using the same icon keeps the import.
  return removeNamedImport(withoutEntry, patch.icon);
}

/**
 * Why `removeNavEntry` declined, or `undefined` when it had no objection. An item that is
 * already gone is not a refusal — it is a hand-reverted file, which the remover reports
 * on its own terms.
 */
export function navEntryRemoveRefusal(
  source: string,
  patch: NavEntry
): string | undefined {
  const items = findItems(source, patch);
  if (!items) {
    return `nav-entry could not find the ${JSON.stringify(patch.group)} group of the ${JSON.stringify(patch.area)} area in ${patch.constName}`;
  }
  return undefined;
}

function findItems(
  source: string,
  patch: NavEntry
): ArrayExpression | undefined {
  const program = parseModule(source).$ast as unknown as Program;
  const areas = findConstArray(program, patch.constName);
  if (!areas) {
    return undefined;
  }
  const area = findElement(areas, IDENTITY, patch.area);
  const groups = area && arrayProperty(area, "groups");
  if (!groups) {
    return undefined;
  }
  const group = findElement(groups, "label", patch.group);
  return group ? arrayProperty(group, "items") : undefined;
}

function arrayProperty(
  object: Parameters<typeof propertyValue>[0],
  key: string
): ArrayExpression | undefined {
  const value = propertyValue(object, key);
  return value ? asArray(value) : undefined;
}

function renderItem(patch: NavEntry): string {
  const properties = [
    ...renderProperties(patch.entry),
    `${renderKey("icon")}: ${patch.icon.name}`,
  ];
  return `{ ${properties.join(", ")} }`;
}
