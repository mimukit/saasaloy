import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { PlusIcon, TruckIcon } from "lucide-react";
import { useState } from "react";

import { config } from "@repo/config";
import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@repo/ui/components/shell/alert-dialog";
import { Button } from "@repo/ui/components/shell/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/shell/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@repo/ui/components/shell/input-group";
import { Switch } from "@repo/ui/components/shell/switch";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import {
  createZone,
  deleteZone,
  refreshShop,
  updateZone,
  zonesQuery,
} from "@admin/lib/shop-api";
import type { Zone, ZoneFields } from "@admin/lib/shop-api";
import { SHOP_LOCALE } from "@admin/lib/shop-dates";
import {
  amountText,
  money,
  parseAmount,
  relativeTime,
} from "@admin/lib/shop-format";
import { useNow } from "@admin/lib/cms-now";

// The shop's Shipping zones at `/shop/shipping-zones`: one flat rate per zone, such as
// inside and outside Dhaka (plan 0106, "Shipping in the MVP"). Checkout offers the active
// zones and copies the chosen name and rate onto the order, so an edit here never changes
// a placed order. The Active switch saves at once; a create or an edit opens a dialog.

export const Route = createFileRoute("/shop/shipping-zones")({
  loader: ({ context }) => context.queryClient.ensureQueryData(zonesQuery()),
  component: ShippingZones,
  errorComponent: ShippingZonesError,
});

const CURRENCY = config.ecommerce.currency;

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; zone: Zone }
  | { kind: "delete"; zone: Zone }
  | null;

function ZoneForm({
  zone,
  pending,
  error,
  onSave,
}: {
  zone: Zone | undefined;
  pending: boolean;
  error: string | null;
  onSave: (fields: ZoneFields) => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [rate, setRate] = useState(
    zone === undefined ? "" : amountText(zone.rate, CURRENCY)
  );
  const [active, setActive] = useState(zone?.active ?? true);
  const minor = parseAmount(rate, CURRENCY);
  const rateBad = rate.trim() !== "" && minor === null;
  const valid = name.trim() !== "" && minor !== null;

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          onSave({
            active,
            name: name.trim(),
            position: zone?.position ?? 0,
            rate: minor,
          });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {zone === undefined ? "New zone" : "Edit zone"}
        </DialogTitle>
        <DialogDescription>
          Checkout offers the active zones. A placed order keeps the rate it was
          placed with.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            required
            maxLength={120}
            value={name}
            placeholder="Inside Dhaka"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Rate</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>{CURRENCY}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              inputMode="decimal"
              required
              value={rate}
              placeholder="60"
              aria-invalid={rateBad ? true : undefined}
              onChange={(event) => {
                setRate(event.target.value);
              }}
            />
          </InputGroup>
          <FieldDescription>
            {rateBad
              ? "Use an amount such as 60 or 60.50."
              : "One flat rate per order. Use 0 for free delivery."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel className="flex items-center gap-3">
            <Switch
              checked={active}
              onCheckedChange={(next) => {
                setActive(next);
              }}
            />
            Active
          </FieldLabel>
        </Field>
        {error === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ZoneActions {
  toggling: boolean;
  onToggle: (zone: Zone, active: boolean) => void;
  onEdit: (zone: Zone) => void;
  onDelete: (zone: Zone) => void;
}

function zoneColumns(
  now: Date,
  actions: ZoneActions
): readonly DataTableColumn<Zone>[] {
  return [
    {
      id: "name",
      header: "Name",
      card: "title",
      value: (zone) => zone.name,
      sortable: true,
      cell: (zone) => <span className="truncate font-medium">{zone.name}</span>,
    },
    {
      id: "rate",
      header: "Rate",
      card: "trailing",
      align: "end",
      value: (zone) => zone.rate,
      sortable: true,
      cell: (zone) => (
        <span className="tabular-nums">
          {money(zone.rate, zone.currency, SHOP_LOCALE)}
        </span>
      ),
    },
    {
      id: "active",
      header: "Active",
      card: "line",
      value: (zone) => zone.active,
      cell: (zone) => (
        <Switch
          aria-label={`Offer ${zone.name} at checkout`}
          checked={zone.active}
          disabled={actions.toggling}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onCheckedChange={(next) => {
            actions.onToggle(zone, next);
          }}
        />
      ),
    },
    {
      id: "updated",
      header: "Updated",
      card: "line",
      value: (zone) => new Date(zone.updatedAt),
      sortable: true,
      cell: (zone) => (
        <span className="text-muted-foreground">
          {relativeTime(zone.updatedAt, now, SHOP_LOCALE)}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      pin: "end",
      align: "end",
      value: () => null,
      cell: (zone) => (
        <span className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            aria-label={`Edit ${zone.name}`}
            onClick={(event) => {
              event.stopPropagation();
              actions.onEdit(zone);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${zone.name}`}
            onClick={(event) => {
              event.stopPropagation();
              actions.onDelete(zone);
            }}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];
}

function ShippingZones() {
  const queryClient = useQueryClient();
  const now = useNow();
  const { data } = useQuery(zonesQuery());
  const zones = data?.zones ?? [];
  const [dialog, setDialog] = useState<DialogState>(null);

  const save = useMutation({
    mutationFn: async (input: { id?: string; fields: ZoneFields }) =>
      input.id === undefined
        ? createZone(input.fields)
        : updateZone(input.id, input.fields),
    onSuccess: async (zone, input) => {
      setDialog(null);
      await refreshShop(queryClient);
      toastManager.add({
        title:
          input.id === undefined ? `${zone.name} added` : `${zone.name} saved`,
        type: "success",
      });
    },
  });

  const toggle = useMutation({
    mutationFn: async (input: { zone: Zone; active: boolean }) =>
      updateZone(input.zone.id, { active: input.active }),
    onSuccess: async (zone) => {
      await refreshShop(queryClient);
      toastManager.add({
        title: zone.active
          ? `${zone.name} is offered at checkout`
          : `${zone.name} is no longer offered at checkout`,
        type: "success",
      });
    },
    onError: (error) => {
      toastManager.add({
        description: error.message,
        title: "The zone was not saved",
        type: "error",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (zone: Zone) => deleteZone(zone.id),
    onSuccess: async (_, zone) => {
      setDialog(null);
      await refreshShop(queryClient);
      toastManager.add({ title: `${zone.name} deleted`, type: "success" });
    },
  });

  const columns = zoneColumns(now, {
    onDelete: (zone) => {
      remove.reset();
      setDialog({ kind: "delete", zone });
    },
    onEdit: (zone) => {
      save.reset();
      setDialog({ kind: "edit", zone });
    },
    onToggle: (zone, active) => {
      toggle.mutate({ active, zone });
    },
    toggling: toggle.isPending,
  });

  const newZone = (
    <Button
      size="sm"
      onClick={() => {
        save.reset();
        setDialog({ kind: "create" });
      }}
    >
      <PlusIcon />
      New zone
    </Button>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Shipping zones"
        count={zones.length}
        actions={newZone}
      />
      <DataTable
        caption="Shipping zones, with the flat rate each charges and whether checkout offers it."
        columns={columns}
        rows={zones}
        rowId={(zone) => zone.id}
        emptyState={
          <EmptyState
            icon={TruckIcon}
            title="No shipping zones yet"
            description="Checkout needs one or more active zones before a buyer can order."
            action={newZone}
          />
        }
      />

      <Dialog
        open={dialog?.kind === "create" || dialog?.kind === "edit"}
        onOpenChange={(next) => {
          if (!next) {
            setDialog(null);
          }
        }}
      >
        <DialogPopup>
          <ZoneForm
            zone={dialog?.kind === "edit" ? dialog.zone : undefined}
            pending={save.isPending}
            error={save.error?.message ?? null}
            onSave={(fields) => {
              save.mutate({
                fields,
                ...(dialog?.kind === "edit" ? { id: dialog.zone.id } : {}),
              });
            }}
          />
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(next) => {
          if (!next) {
            setDialog(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {dialog?.kind === "delete" ? dialog.zone.name : "this zone"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Checkout stops offering it. Placed orders keep the zone name and
              rate they were placed with. To pause a zone instead, switch it
              off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error === null ? null : (
            <p className="text-destructive px-6 text-sm" role="alert">
              {remove.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (dialog?.kind === "delete") {
                  remove.mutate(dialog.zone);
                }
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete zone"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </PageLayout>
  );
}

function ShippingZonesError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Shipping zones" />
      <ErrorState
        code="500"
        title="The zones did not load"
        description="Check that the api is running and that you are signed in to the admin app."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
