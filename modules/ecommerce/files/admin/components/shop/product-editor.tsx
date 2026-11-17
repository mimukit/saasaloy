import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { slugify } from "@repo/cms";
import type { RichTextDocument } from "@repo/cms";
import { RichTextEditor } from "@repo/cms/editor";
import type { EditorToolbarState } from "@repo/cms/editor";
import { config } from "@repo/config";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/shell/alert-dialog";
import { Button } from "@repo/ui/components/shell/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/shell/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/shell/select";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import {
  EDITOR_CONTENT_CLASS,
  EditorToolbar,
} from "@admin/components/cms/editor-toolbar";
import { usePageTrail } from "@admin/components/page-trail";
import { ProductImages } from "@admin/components/shop/product-images";
import { ProductStatusPill } from "@admin/components/shop/shop-pills";
import { OptionsPanel, VariantGrid } from "@admin/components/shop/variant-grid";
import {
  categoriesQuery,
  createProduct,
  deleteProduct,
  refreshShop,
  setProductStatus,
  shopKeys,
  updateProduct,
} from "@admin/lib/shop-api";
import type { Product, ProductFields } from "@admin/lib/shop-api";
import { shownDateTime } from "@admin/lib/shop-dates";

// The product editor, new or stored. The main column holds the title, the slug, the
// description (the CMS's Tiptap editor, rendered to HTML by the api on save), then the
// images, the options and the variant grid; the side column holds the status and the
// category. A new product saves its fields first: the images, the options and the grid
// need a stored product, so they appear once it exists.
//
// Publishing saves any unsaved field first, then asks the api to go active, which it
// refuses while no variant is active and priced (grill Q4).

const NO_CATEGORY = "none";

interface Values {
  title: string;
  slug: string;
  categoryId: string | null;
  description: RichTextDocument | undefined;
}

function valuesOf(product: Product | undefined): Values {
  return {
    categoryId: product?.categoryId ?? null,
    description:
      (product?.description as RichTextDocument | null | undefined) ??
      undefined,
    slug: product?.slug ?? "",
    title: product?.title ?? "",
  };
}

function payload(values: Values): ProductFields {
  return {
    categoryId: values.categoryId,
    description:
      values.description === undefined
        ? null
        : (values.description as unknown as Record<string, unknown>),
    slug: values.slug.trim(),
    title: values.title.trim(),
  };
}

function renderToolbar(state: EditorToolbarState) {
  return <EditorToolbar {...state} />;
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** A panel of the main or side column: a card with a title and an optional line. */
function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="gap-1 p-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description === undefined ? null : (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardPanel className="grid gap-4 p-4 pt-0">{children}</CardPanel>
    </Card>
  );
}

export function ProductEditor({ product }: { product: Product | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { currency } = config.ecommerce;
  const categories = useQuery(categoriesQuery());
  const [values, setValues] = useState<Values>(() => valuesOf(product));
  const [saved, setSaved] = useState<Values>(() => valuesOf(product));
  const [pending, setPending] = useState<
    "save" | "publish" | "unpublish" | "delete" | null
  >(null);

  const title = product?.title ?? "New product";
  usePageTrail([{ label: "Products", to: "/shop/products" }, { label: title }]);

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug.trim());
  const valid = values.title.trim() !== "" && slugValid;
  const active = product?.status === "active";
  const sellable = (product?.variants ?? []).some(
    (variant) =>
      variant.active &&
      variant.prices.some((price) => price.currency === currency)
  );

  const categoryItems = [
    { label: "No category", value: NO_CATEGORY },
    ...(categories.data?.categories ?? []).map((category) => ({
      label: category.name,
      value: category.id,
    })),
  ];

  async function settle(next: Product) {
    queryClient.setQueryData(shopKeys.product(next.id), next);
    const fresh = valuesOf(next);
    setValues(fresh);
    setSaved(fresh);
    await refreshShop(queryClient);
  }

  /** Store the fields. A new product moves the address to its own editor. */
  async function store(): Promise<Product | null> {
    if (product === undefined) {
      // The create route's 201 body is the product; `hc` loses it in the union with the
      // route's refusal branch, so only the id is read here.
      const created = (await createProduct(payload(values))) as unknown as {
        id: string;
      };
      await refreshShop(queryClient);
      toastManager.add({
        description: "Add images and options, then publish it.",
        title: "Product created",
        type: "success",
      });
      void navigate({
        params: { productId: created.id },
        to: "/shop/products/$productId",
      });
      return null;
    }
    const next = await updateProduct(product.id, payload(values));
    await settle(next);
    return next;
  }

  async function save() {
    setPending("save");
    try {
      const next = await store();
      if (next) {
        toastManager.add({ title: "Product saved", type: "success" });
      }
    } catch (error) {
      toastManager.add({
        description: errorText(error),
        title: "The product was not saved",
        type: "error",
      });
    }
    setPending(null);
  }

  async function changeStatus(status: "active" | "draft") {
    if (product === undefined) {
      return;
    }
    setPending(status === "active" ? "publish" : "unpublish");
    try {
      if (dirty) {
        await store();
      }
      await settle(await setProductStatus(product.id, status));
      toastManager.add({
        title:
          status === "active" ? "Product published" : "Product unpublished",
        type: "success",
      });
    } catch (error) {
      toastManager.add({
        description: errorText(error),
        title:
          status === "active"
            ? "The product was not published"
            : "The product was not unpublished",
        type: "error",
      });
    }
    setPending(null);
  }

  async function remove() {
    if (product === undefined) {
      return;
    }
    setPending("delete");
    try {
      await deleteProduct(product.id);
      await refreshShop(queryClient);
      toastManager.add({ title: `${product.title} deleted`, type: "success" });
      void navigate({
        search: { page: 1, status: "all" },
        to: "/shop/products",
      });
    } catch (error) {
      toastManager.add({
        description: errorText(error),
        title: "The product was not deleted",
        type: "error",
      });
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <PageLayout>
      <PageHeader
        title={title}
        badges={
          product === undefined ? undefined : (
            <ProductStatusPill status={product.status} />
          )
        }
        description={
          product === undefined
            ? "Not saved yet. Create the product to add images and options."
            : `Updated ${shownDateTime(product.updatedAt)}${dirty ? ". Unsaved changes in this form." : ""}`
        }
        actions={
          <>
            <Button
              size="sm"
              variant={product === undefined ? "default" : "outline"}
              disabled={busy || !valid || (product !== undefined && !dirty)}
              onClick={() => {
                void save();
              }}
            >
              {pending === "save"
                ? "Saving…"
                : product === undefined
                  ? "Create product"
                  : "Save"}
            </Button>
            {product === undefined ? null : active ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void changeStatus("draft");
                }}
              >
                {pending === "unpublish" ? "Unpublishing…" : "Unpublish"}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !valid || !sellable}
                title={
                  sellable
                    ? undefined
                    : "Make one variant active, with a price, to publish."
                }
                onClick={() => {
                  void changeStatus("active");
                }}
              >
                {pending === "publish" ? "Publishing…" : "Publish"}
              </Button>
            )}
          </>
        }
      />
      <PageBody
        aside={
          <>
            <Panel
              title="Status"
              description="A product needs one active variant to go active."
            >
              <p className="flex items-center gap-2 text-sm">
                {product === undefined ? (
                  <span className="text-muted-foreground">Not created yet</span>
                ) : (
                  <>
                    <ProductStatusPill status={product.status} />
                    <span className="text-muted-foreground">
                      {active
                        ? "Shoppers see it in the shop."
                        : sellable
                          ? "Ready to publish."
                          : "No active variant with a price yet."}
                    </span>
                  </>
                )}
              </p>
            </Panel>
            <Panel title="Category">
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select
                  items={categoryItems}
                  value={values.categoryId ?? NO_CATEGORY}
                  disabled={busy}
                  onValueChange={(next: string | null) => {
                    setValues((current) => ({
                      ...current,
                      categoryId:
                        next === null || next === NO_CATEGORY ? null : next,
                    }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            </Panel>
            {product === undefined ? null : (
              <Panel title="Delete">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="destructive-outline"
                        size="sm"
                        disabled={busy}
                      />
                    }
                  >
                    <Trash2Icon />
                    Delete product
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete {product.title}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The product, its variants, prices and stock go. Orders
                        keep their own copy of the lines they sold. This cannot
                        be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button variant="ghost" />}>
                        Cancel
                      </AlertDialogClose>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => {
                          void remove();
                        }}
                      >
                        {pending === "delete" ? "Deleting…" : "Delete product"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>
              </Panel>
            )}
          </>
        }
      >
        <Panel title="Details">
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={values.title}
              maxLength={200}
              required
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setValues((current) => {
                  const following =
                    current.slug === "" ||
                    current.slug === slugify(current.title);
                  return {
                    ...current,
                    slug:
                      following && product === undefined
                        ? slugify(next)
                        : current.slug,
                    title: next,
                  };
                });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>Slug</FieldLabel>
            <Input
              value={values.slug}
              maxLength={96}
              required
              disabled={busy}
              aria-invalid={values.slug !== "" && !slugValid ? true : undefined}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  slug: event.target.value,
                }));
              }}
            />
            <FieldDescription>
              {values.slug !== "" && !slugValid
                ? "Use lower-case letters, digits and single hyphens."
                : `The product's address: ${config.ecommerce.basePath}/${values.slug.trim() || "slug"}`}
            </FieldDescription>
          </Field>
          <Field className="min-w-0 items-stretch">
            <FieldLabel
              id="product-description-label"
              nativeLabel={false}
              render={<span />}
            >
              Description
            </FieldLabel>
            <RichTextEditor
              labelledBy="product-description-label"
              value={values.description}
              editable={!busy}
              onChange={(next) => {
                setValues((current) => ({ ...current, description: next }));
              }}
              onNormalize={(next) => {
                // The editor's own form of a body it loaded. While nobody has edited it,
                // the saved baseline moves with it, so the form stays clean.
                if (
                  JSON.stringify(saved.description) ===
                  JSON.stringify(values.description)
                ) {
                  setSaved((current) => ({ ...current, description: next }));
                }
                setValues((current) => ({ ...current, description: next }));
              }}
              onLinkRefused={(href) => {
                toastManager.add({
                  description: `${href} was not linked. Links take http, https, mailto, tel or a path on this site.`,
                  title: "That link was refused",
                  type: "error",
                });
              }}
              toolbar={renderToolbar}
              className="border-input bg-background dark:bg-input/32 w-full min-w-0 overflow-hidden rounded-lg border"
              contentClassName={EDITOR_CONTENT_CLASS}
            />
          </Field>
        </Panel>

        {product === undefined ? null : (
          <>
            <Panel
              title="Images"
              description="The first image is the cover the lists and the shop show."
            >
              <ProductImages product={product} />
            </Panel>
            <Panel
              title="Options"
              description="Up to three options, such as Size and Colour. Each combination becomes a variant."
            >
              <OptionsPanel product={product} />
            </Panel>
            <Panel
              title="Variants"
              description={`Prices in ${currency}. A variant needs a price to be active.`}
            >
              <VariantGrid product={product} currency={currency} />
            </Panel>
          </>
        )}
      </PageBody>
    </PageLayout>
  );
}
