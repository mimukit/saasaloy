import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { SEED_ADMIN, SEED_MEMBER, URLS } from "../lib/project.ts";

// Full keyboard coverage of the `command` module, kept true as modules land (issue #265).
// Each signed-in SPA on the shell gets the same checks with no mouse step after sign-in:
// Mod+K opens and closes the palette, every sidebar nav row is reachable through its
// "Go to" row in the palette and, when it declares one, through its `G` sequence, and the
// `?` sheet lists every binding the palette shows. Admin also walks the users table with
// J and K, opens a row with Enter and closes it with Escape.
//
// The nav rows are read from the sidebar at run time, not written out here. Other modules
// add rows through `<app>.nav` table rows, and a fixed list would go stale with the next.
// A row's `G` sequence is optional (plan 0084), so a row without one is checked through the
// palette only; a run that finds no `G` row at all fails, so the check cannot pass empty.

/** One sidebar row: the label it shows and the path its link points at. */
interface NavRow {
  label: string;
  href: string;
}

/** One line of the palette or the sheet: its title and the keycaps it draws. */
interface KeyLine {
  section: string;
  title: string;
  caps: string[];
}

/** Sign in through the same card both SPAs render, then wait for the shell. */
async function signIn(
  page: Page,
  url: string,
  account: { email: string; password: string }
): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(navLinks(page).first()).toBeVisible();
}

function navLinks(page: Page): Locator {
  return page.locator('[data-slot="sidebar-content"] a[href]');
}

function palette(page: Page): Locator {
  return page.getByRole("dialog", { name: "Command palette" });
}

function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Keyboard shortcuts" });
}

async function readNavRows(page: Page): Promise<NavRow[]> {
  const rows = await navLinks(page).evaluateAll((links) =>
    links.map((link) => ({
      label: (link.textContent ?? "").trim(),
      href: new URL((link as HTMLAnchorElement).href).pathname,
    }))
  );
  expect(rows.length, "the sidebar shows no nav rows").toBeGreaterThan(0);
  return rows;
}

async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = palette(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Every palette row with an empty search, and the keycaps each one draws. */
async function readPalette(page: Page): Promise<KeyLine[]> {
  const dialog = await openPalette(page);
  const lines = await dialog
    .locator('[data-slot="command-item"]')
    .evaluateAll((items) =>
      items.map((item) => ({
        section: "palette",
        // The first visible span is the title; an icon placeholder is aria-hidden.
        title: (
          item.querySelector(":scope > span:not([aria-hidden])")?.textContent ??
          ""
        ).trim(),
        caps: [...item.querySelectorAll('[data-slot="kbd"]')].map((kbd) =>
          (kbd.textContent ?? "").trim()
        ),
      }))
    );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return lines;
}

/** Every line of the `?` sheet, with the heading of the section it sits under. */
async function readSheet(page: Page): Promise<KeyLine[]> {
  await page.keyboard.press("?");
  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  const lines = await dialog.locator("section").evaluateAll((sections) =>
    sections.flatMap((section) =>
      [...section.querySelectorAll("li")].map((line) => ({
        section: (section.querySelector("h3")?.textContent ?? "").trim(),
        title: (line.querySelector("span")?.textContent ?? "").trim(),
        caps: [...line.querySelectorAll('[data-slot="kbd"]')].map((kbd) =>
          (kbd.textContent ?? "").trim()
        ),
      }))
    )
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return lines;
}

/** Search the palette for `title`, move the highlight onto it with the arrows, run it. */
async function runFromPalette(page: Page, title: string): Promise<void> {
  const dialog = await openPalette(page);
  await page.keyboard.type(title);
  const items = dialog.locator('[data-slot="command-item"]');
  await expect(items.filter({ hasText: title }).first()).toBeVisible();
  const highlightedTitle = (): Promise<string> =>
    dialog
      .locator('[data-slot="command-item"][data-highlighted]')
      .evaluateAll((found) =>
        (
          found[0]?.querySelector(":scope > span:not([aria-hidden])")
            ?.textContent ?? ""
        ).trim()
      );
  const count = await items.count();
  for (let step = 0; step < count; step++) {
    if ((await highlightedTitle()) === title) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  expect(await highlightedTitle()).toBe(title);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** The Playwright key for one keycap of a `G` sequence. */
function keyFor(cap: string): string {
  return cap.length === 1 ? cap.toLowerCase() : cap;
}

/** The shared checks: palette open and close, every nav row both ways, the sheet. */
async function coverApp(page: Page, origin: string): Promise<void> {
  // Mod+K opens the palette and Mod+K closes it again.
  await openPalette(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeHidden();

  const rows = await readNavRows(page);
  const sheetLines = await readSheet(page);

  // Every nav row through its "Go to" row in the palette.
  for (const row of rows) {
    await runFromPalette(page, `Go to ${row.label}`);
    await expect(page).toHaveURL(`${origin}${row.href}`);
  }

  // Every nav row that declares a `G` sequence, through that sequence. The row for the
  // current page goes last, so each sequence moves the page and proves something.
  const navigation = sheetLines.filter((line) => line.section === "Navigation");
  const keyed = rows
    .map((row) => ({
      row,
      caps:
        navigation.find((line) => line.title === `Go to ${row.label}`)?.caps ??
        [],
    }))
    .filter((entry) => entry.caps[0] === "G");
  expect(keyed.length, "no nav row declares a G sequence").toBeGreaterThan(0);
  const here = new URL(page.url()).pathname;
  keyed.sort(
    (left, right) =>
      Number(left.row.href === here) - Number(right.row.href === here)
  );
  for (const { row, caps } of keyed) {
    for (const cap of caps) {
      await page.keyboard.press(keyFor(cap));
    }
    await expect(page).toHaveURL(`${origin}${row.href}`);
  }
}

/** The sheet lists every palette row that has keycaps, under its title, with its caps. */
async function expectSheetCoversPalette(page: Page): Promise<KeyLine[]> {
  const paletteLines = await readPalette(page);
  const sheetLines = await readSheet(page);
  const bound = paletteLines.filter((line) => line.caps.length > 0);
  expect(bound.length, "the palette shows no keycaps").toBeGreaterThan(0);
  for (const line of bound) {
    const listed = sheetLines.find((entry) => entry.title === line.title);
    expect(listed, `the ? sheet does not list "${line.title}"`).toBeDefined();
    expect(listed?.caps, `"${line.title}" has other keys in the sheet`).toEqual(
      line.caps
    );
  }
  // The module's own two keys and the shell's sidebar key are always declared.
  const general = sheetLines
    .filter((entry) => entry.section === "General")
    .map((entry) => entry.title);
  expect(general).toEqual(
    expect.arrayContaining([
      "Open the command palette",
      "Show keyboard shortcuts",
      "Toggle sidebar",
    ])
  );
  return sheetLines;
}

/** The index of the highlighted body row, or -1 when none is highlighted. */
async function highlightedIndex(table: Locator): Promise<number> {
  return table
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.findIndex(
        (row) => (row as HTMLElement).dataset.highlighted !== undefined
      )
    );
}

test.describe(
  "command keyboard in admin",
  { tag: ["@command", "@admin", "@auth"] },
  () => {
    test("the palette, every nav row, the sheet and the users table", async ({
      page,
    }) => {
      await signIn(page, `${URLS.admin}/login`, SEED_ADMIN);
      await coverApp(page, URLS.admin);

      // The users page carries route commands and the table's four keys, so the sheet
      // check runs there. A load leaves the focus on the page body, where the table keys act.
      await page.goto(`${URLS.admin}/users`);
      const table = page.getByRole("table");
      await expect(table.locator("tbody tr").nth(1)).toBeVisible();

      const sheetLines = await expectSheetCoversPalette(page);
      expect(
        sheetLines
          .filter((line) => line.section === "Data table")
          .map((line) => line.caps)
      ).toEqual(expect.arrayContaining([["J"], ["K"]]));
      expect(
        sheetLines.filter((line) => line.section === "Data table")
      ).toHaveLength(4);

      // J and K move the highlight down and up.
      await page.keyboard.press("j");
      await expect.poll(() => highlightedIndex(table)).toBe(0);
      await page.keyboard.press("j");
      await expect.poll(() => highlightedIndex(table)).toBe(1);
      await page.keyboard.press("k");
      await expect.poll(() => highlightedIndex(table)).toBe(0);

      // Enter opens the highlighted user's detail panel, and Escape closes it.
      // The cell that holds an address, read whole: a row's text runs its cells together.
      const email = await table
        .locator("tbody tr[data-highlighted] td")
        .evaluateAll((cells) =>
          cells
            .map((cell) => (cell.textContent ?? "").trim())
            .find((text) => /^\S+@\S+$/.test(text))
        );
      expect(email, "the highlighted row shows no email").toBeDefined();
      const panel = page
        .getByRole("region")
        .filter({ hasText: email ?? "" })
        .filter({ has: page.getByRole("button", { name: /^Close / }) });
      await page.keyboard.press("Enter");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });
  }
);

test.describe(
  "command keyboard in app",
  { tag: ["@command", "@app", "@auth"] },
  () => {
    test("the palette, every nav row and the sheet", async ({ page }) => {
      await signIn(page, `${URLS.app}/sign-in`, SEED_MEMBER);
      await coverApp(page, URLS.app);
      await expectSheetCoversPalette(page);
    });
  }
);
