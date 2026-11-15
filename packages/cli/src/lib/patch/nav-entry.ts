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

/**
 * Append a nav item to one group of one area, and import the icon it names. When the area
 * has no group with that label yet, the group is added after the area's last group,
 * holding the one row, so a module can open a group of its own ("Content").
 */
export function insertNavEntry(source: string, patch: NavEntry): string {
  const wanted = patch.entry[IDENTITY];
  if (wanted === undefined) {
    return source;
  }
  // Rendering `icon: GaugeIcon` against a `GaugeIcon` that is bound to something else
  // would compile and draw the wrong picture. Leave the file alone and let the caller say
  // why.
  if (importedElsewhere(source, patch.icon)) {
    return source;
  }

  const items = findItems(source, patch);
  if (!items) {
    const groups = findGroups(source, patch);
    if (!groups) {
      return source;
    }
    const withGroup = appendEntry(
      source,
      groups,
      renderGroup(source, groups, patch)
    );
    return ensureNamedImport(withGroup, patch.icon);
  }
  if (hasEntry(items, IDENTITY, wanted)) {
    return source;
  }

  const expanded = expandSingleLine(source, items);
  const target = expanded === source ? items : findItems(expanded, patch);
  if (!target) {
    return source;
  }
  const withEntry = appendEntry(expanded, target, renderItem(patch));
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
  // A missing group is not a refusal: the insert adds it.
  const group = findElement(groups, "label", patch.group);
  if (group && !arrayProperty(group, "items")) {
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

  // The group's last row takes the group with it, so a group an insert created leaves
  // no empty shell behind.
  const groups = findGroups(source, patch);
  const groupIndex =
    items.elements.length === 1 && groups
      ? groups.elements.findIndex(
          (element) => entryValue(element, "label") === patch.group
        )
      : -1;
  const withoutEntry =
    groups && groupIndex !== -1
      ? removeEntry(source, groups, groupIndex)
      : removeEntry(source, items, index);
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

function findGroups(
  source: string,
  patch: NavEntry
): ArrayExpression | undefined {
  const program = parseModule(source).$ast as unknown as Program;
  const areas = findConstArray(program, patch.constName);
  if (!areas) {
    return undefined;
  }
  const area = findElement(areas, IDENTITY, patch.area);
  return area ? arrayProperty(area, "groups") : undefined;
}

function findItems(
  source: string,
  patch: NavEntry
): ArrayExpression | undefined {
  const groups = findGroups(source, patch);
  if (!groups) {
    return undefined;
  }
  const group = findElement(groups, "label", patch.group);
  return group ? arrayProperty(group, "items") : undefined;
}

/** The indentation of the line `offset` sits on. */
function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? "";
}

/**
 * A one-line array with rows in it, rewritten with one row per line. Prettier breaks an
 * array of two or more objects that way, and `appendEntry` then adds the next row on its
 * own line. An empty or already multi-line array is returned unchanged.
 */
function expandSingleLine(source: string, array: ArrayExpression): string {
  const body = source.slice(array.start, array.end);
  if (array.elements.length === 0 || body.includes("\n")) {
    return source;
  }
  const indent = lineIndent(source, array.start);
  const rows = array.elements
    .filter((element) => element !== null)
    .map(
      (element) => `${indent}  ${source.slice(element.start, element.end)},\n`
    )
    .join("");
  return `${source.slice(0, array.start)}[\n${rows}${indent}]${source.slice(array.end)}`;
}

/** Prettier's print width, which the rendered group is laid out against. */
const PRINT_WIDTH = 80;

/** A new group holding the one row, laid out the way prettier prints it. */
function renderGroup(
  source: string,
  groups: ArrayExpression,
  patch: NavEntry
): string {
  const close = groups.end - 1;
  const groupIndent = `${lineIndent(source, close)}  `;
  const inner = `${groupIndent}  `;
  const row = renderItem(patch);
  const oneLine = `${inner}items: [${row}],`;
  const items =
    oneLine.length <= PRINT_WIDTH
      ? oneLine
      : `${inner}items: [\n${inner}  ${row},\n${inner}],`;
  return `{\n${inner}label: ${JSON.stringify(patch.group)},\n${items}\n${groupIndent}}`;
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
