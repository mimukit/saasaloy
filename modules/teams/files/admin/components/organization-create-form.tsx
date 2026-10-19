import { useMutation } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { Button } from "@repo/ui/components/admin/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/admin/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/admin/field";
import { Input } from "@repo/ui/components/admin/input";
import { toastManager } from "@repo/ui/components/admin/toast";

import { auth } from "@admin/lib/auth";

// The "New organization" button in the teams PageHeader, and the dialog it opens: a name,
// a slug derived from it until the visitor edits the slug, a slug check on blur, and a
// Create button that checks the slug once more before it creates.
//
// The form state lives here, above the popup, so closing the dialog with Cancel keeps
// what was typed. Only a successful create clears it.

type SlugStatus = "idle" | "checking" | "available" | "taken" | "error";

export function OrganizationCreateForm({
  onCreated,
}: {
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");

  const checkSlug = async () => {
    if (!slug) {
      setSlugStatus("idle");
      return false;
    }
    setSlugStatus("checking");
    const result = await auth.organization.checkSlug({ slug });
    if (result.error) {
      // Better Auth reports a taken slug as an error, not as { status: false }.
      setSlugStatus(
        result.error.code === "ORGANIZATION_SLUG_ALREADY_TAKEN"
          ? "taken"
          : "error"
      );
      return false;
    }
    const available = result.data.status;
    setSlugStatus(available ? "available" : "taken");
    return available;
  };

  const createOrganization = useMutation({
    mutationFn: async () => {
      if (!(await checkSlug())) {
        throw new Error(
          "Choose an available slug before you create the organization."
        );
      }
      const result = await auth.organization.create({ name, slug });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      toastManager.add({
        type: "success",
        title: "Organization created",
        description: `${name} is now the active organization.`,
      });
      setName("");
      setSlug("");
      setSlugEdited(false);
      setSlugStatus("idle");
      setOpen(false);
      await onCreated();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The organization was not created",
        description: error.message,
      });
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    createOrganization.mutate();
  };

  const slugInvalid = slugStatus === "taken" || slugStatus === "error";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon />
        New organization
      </DialogTrigger>

      <DialogPopup>
        {/* The form wraps the panel and the footer, so the footer's Create button is a
            real submit button and Enter in either field submits. */}
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>
              The slug is public, unique, and editable before creation.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={name}
                required
                autoComplete="organization"
                onChange={(event) => {
                  const nextName = event.target.value;
                  setName(nextName);
                  if (!slugEdited) {
                    setSlug(slugify(nextName));
                    setSlugStatus("idle");
                  }
                }}
              />
            </Field>

            <Field invalid={slugInvalid}>
              <FieldLabel>Slug</FieldLabel>
              <Input
                value={slug}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                onBlur={() => {
                  void checkSlug();
                }}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(slugify(event.target.value));
                  setSlugStatus("idle");
                }}
              />
              {/* One line under the slug, in a polite live region so the check's answer
                  is announced. A taken slug or a failed check is the field's error;
                  every other state is a hint. `match` shows the error whenever this
                  branch renders, rather than waiting on native validity. */}
              <div aria-live="polite" className="min-h-4">
                {slugInvalid ? (
                  <FieldError match>{SLUG_STATUS_TEXT[slugStatus]}</FieldError>
                ) : (
                  <FieldDescription>
                    {SLUG_STATUS_TEXT[slugStatus]}
                  </FieldDescription>
                )}
              </div>
            </Field>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              loading={createOrganization.isPending}
              disabled={
                !name ||
                !slug ||
                slugStatus === "checking" ||
                slugStatus === "taken"
              }
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

// One line per state, keyed by the union, so adding a state without its words fails the
// type check rather than falling through to a default.
const SLUG_STATUS_TEXT: Record<SlugStatus, string> = {
  idle: "Use lowercase letters, numbers, and hyphens.",
  checking: "Checking the slug…",
  available: "This slug is available.",
  taken: "This slug is in use. Choose another slug.",
  error: "The slug check failed. Check the api and try again.",
};
