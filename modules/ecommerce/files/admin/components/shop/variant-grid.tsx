import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import { Input } from "@repo/ui/components/shell/input";
import { Switch } from "@repo/ui/components/shell/switch";
import { toastManager } from "@repo/ui/components/shell/toast";

import {
  refreshShop,
  setProductOptions,
  setStock,
  shopKeys,
  updateVariant,
} from "@admin/lib/shop-api";
import type { Product } from "@admin/lib/shop-api";
import {
  applyPrice,
  draftFromVariant,
  parseAmount,
  variantChanges,
  variantProblem,
} from "@admin/lib/shop-format";
import type { VariantDraft } from "@admin/lib/shop-format";

// A product's options and the variant grid they generate. The api builds the grid: "Save
// options" sends the option names and values, and every combination comes back as a row.
// A kept combination keeps its SKU, prices and stock; a new one starts inactive and
// unpriced. The grid then edits each row's SKU, price, stock and active flag, and "Save
// variants" sends only the rows that changed: the SKU, price and flag in one call, the
// counted stock in another.

interface OptionDraft {
  key: number;
  name: string;
  values: string[];
}

function optionsFrom(product: Product): OptionDraft[] {
  return product.options.map((option, index) => ({
    key: index,
    name: option.name,
    values: option.values.map((value) => value.value),
  }));
}

function sameOptions(product: Product, drafts: readonly OptionDraft[]) {
  const saved = product.options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => value.value),
  }));
  const next = drafts.map((draft) => ({
    name: draft.name.trim(),
    values: draft.values,
  }));
  return JSON.stringify(saved) === JSON.stringify(next);
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** One option: its name, its value chips and the field that adds a value. */
function OptionEditor({
  option,
  disabled,
  onChange,
  onRemove,
}: {
  option: OptionDraft;
  disabled: boolean;
  onChange: (next: OptionDraft) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState("");
  const name = option.name.trim() === "" ? "this option" : option.name;

  function add() {
    const next = value.trim();
    if (next === "" || option.values.includes(next)) {
      setValue("");
      return;
    }
    onChange({ ...option, values: [...option.values, next] });
    setValue("");
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Option name"
          placeholder="Option name, such as Size"
          value={option.name}
          maxLength={50}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...option, name: event.target.value });
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={`Values of ${name}`}>
        {option.values.map((item) => (
          <li key={item}>
            <Badge variant="secondary" size="lg" className="gap-1 pe-0.5">
              {item}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${item}`}
                disabled={disabled}
                onClick={() => {
                  onChange({
                    ...option,
                    values: option.values.filter((entry) => entry !== item),
                  });
                }}
              >
                <XIcon />
              </Button>
            </Badge>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label={`Add a value to ${name}`}
          placeholder="Add a value, such as M"
          value={value}
          maxLength={50}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button type="submit" size="sm" variant="outline" disabled={disabled}>
          Add
        </Button>
      </form>
    </div>
  );
}

export function OptionsPanel({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<OptionDraft[]>(() =>
    optionsFrom(product)
  );
  const [nextKey, setNextKey] = useState(product.options.length);
  const [saving, setSaving] = useState(false);
  const unchanged = sameOptions(product, drafts);
  const incomplete = drafts.some(
    (draft) => draft.name.trim() === "" || draft.values.length === 0
  );

  async function save() {
    setSaving(true);
    try {
      const next = await setProductOptions(
        product.id,
        drafts.map((draft) => ({
          name: draft.name.trim(),
          values: draft.values,
        }))
      );
      queryClient.setQueryData(shopKeys.product(next.id), next);
      await refreshShop(queryClient);
      setDrafts(optionsFrom(next));
      toastManager.add({
        description: `${String(next.variants.length)} variants in the grid.`,
        title: "Options saved",
        type: "success",
      });
    } catch (error) {
      toastManager.add({
        description: errorText(error),
        title: "The options were not saved",
        type: "error",
      });
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No options. The product sells as one variant. Add an option such as
          Size or Colour to sell several.
        </p>
      ) : (
        drafts.map((draft) => (
          <OptionEditor
            key={draft.key}
            option={draft}
            disabled={saving}
            onChange={(next) => {
              setDrafts((current) =>
                current.map((item) => (item.key === next.key ? next : item))
              );
            }}
            onRemove={() => {
              setDrafts((current) =>
                current.filter((item) => item.key !== draft.key)
              );
            }}
          />
        ))
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || drafts.length >= 3}
          onClick={() => {
            setDrafts((current) => [
              ...current,
              { key: nextKey, name: "", values: [] },
            ]);
            setNextKey((key) => key + 1);
          }}
        >
          <PlusIcon />
          Add option
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || unchanged || incomplete}
          onClick={() => {
            void save();
          }}
        >
          {saving ? "Saving…" : "Save options"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {drafts.length >= 3
            ? "A product takes up to three options."
            : incomplete
              ? "Each option needs a name and one or more values."
              : unchanged
                ? null
                : "Saving rebuilds the variant grid. Kept combinations keep their SKU, price and stock."}
        </span>
      </div>
    </div>
  );
}

export function VariantGrid({
  product,
  currency,
}: {
  product: Product;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const saved = product.variants.map((variant) =>
    draftFromVariant(variant, currency)
  );
  const [edits, setEdits] = useState<Record<string, VariantDraft>>({});
  const [allPrice, setAllPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const rows = saved.map((row) => edits[row.id] ?? row);
  const changed = rows.filter((row, index) => {
    const before = saved[index];
    if (!before) {
      return false;
    }
    const diff = variantChanges(before, row, currency);
    return diff.variant || diff.stock;
  });
  const blocked = changed.some((row) => variantProblem(row, currency) !== null);
  const allPriceValid =
    allPrice.trim() !== "" && parseAmount(allPrice, currency) !== null;

  function edit(next: VariantDraft) {
    setEdits((current) => ({ ...current, [next.id]: next }));
  }

  async function save() {
    setSaving(true);
    let last: Product | undefined;
    let failed = 0;
    for (const row of changed) {
      const before = saved.find((item) => item.id === row.id);
      if (!before) {
        continue;
      }
      const diff = variantChanges(before, row, currency);
      try {
        if (diff.variant) {
          last = await updateVariant(row.id, {
            active: row.active,
            price:
              row.price.trim() === "" ? null : parseAmount(row.price, currency),
            sku: row.sku.trim() === "" ? null : row.sku.trim(),
          });
        }
        if (diff.stock) {
          last = await setStock(row.id, Number(row.stock.trim()));
        }
        setEdits((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => id !== row.id)
          )
        );
      } catch (error) {
        failed += 1;
        toastManager.add({
          description: errorText(error),
          title: "A variant was not saved",
          type: "error",
        });
      }
    }
    if (last) {
      queryClient.setQueryData(shopKeys.product(last.id), last);
    }
    await refreshShop(queryClient);
    if (failed === 0) {
      toastManager.add({ title: "Variants saved", type: "success" });
    }
    setSaving(false);
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Save the options to build the variant grid.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (allPriceValid) {
            setEdits(
              Object.fromEntries(
                applyPrice(rows, allPrice).map((row) => [row.id, row])
              )
            );
          }
        }}
      >
        <label htmlFor={`price-all-${product.id}`} className="text-sm">
          Set one price for all
        </label>
        <Input
          id={`price-all-${product.id}`}
          className="w-32"
          inputMode="decimal"
          placeholder={currency}
          value={allPrice}
          onChange={(event) => {
            setAllPrice(event.target.value);
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!allPriceValid}
        >
          Apply
        </Button>
      </form>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Variants, with their SKU, price in {currency}, stock on hand and
            whether they are for sale.
          </caption>
          <thead className="bg-muted/72 text-muted-foreground text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Variant
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                SKU
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Price ({currency})
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Stock
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Active
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const variant = product.variants[index];
              const title =
                variant === undefined || variant.title === ""
                  ? "Default"
                  : variant.title;
              const problem = variantProblem(row, currency);
              return (
                <tr key={row.id} className="border-border border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <span className="block py-1.5">{title}</span>
                  </th>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`SKU of ${title}`}
                      className="min-w-28 font-mono text-xs"
                      value={row.sku}
                      maxLength={64}
                      onChange={(event) => {
                        edit({ ...row, sku: event.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Price of ${title}`}
                      aria-invalid={
                        problem?.startsWith("Use an amount") ? true : undefined
                      }
                      className="w-28 tabular-nums"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) => {
                        edit({ ...row, price: event.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Stock on hand of ${title}`}
                      aria-invalid={
                        problem?.startsWith("Stock") ? true : undefined
                      }
                      className="w-20 tabular-nums"
                      inputMode="numeric"
                      value={row.stock}
                      onChange={(event) => {
                        edit({ ...row, stock: event.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex min-h-8 items-center gap-2">
                      <Switch
                        aria-label={`Sell ${title}`}
                        checked={row.active}
                        onCheckedChange={(checked) => {
                          edit({ ...row, active: checked });
                        }}
                      />
                      {problem === null ? null : (
                        <span className="text-muted-foreground text-xs">
                          {problem}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || changed.length === 0 || blocked}
          onClick={() => {
            void save();
          }}
        >
          {saving
            ? "Saving…"
            : changed.length === 0
              ? "Save variants"
              : `Save ${String(changed.length)} ${changed.length === 1 ? "variant" : "variants"}`}
        </Button>
        {changed.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setEdits({});
            }}
          >
            Discard changes
          </Button>
        ) : null}
        {blocked ? (
          <span className="text-muted-foreground text-xs">
            Fix the rows with a note before you save.
          </span>
        ) : null}
      </div>
    </div>
  );
}
