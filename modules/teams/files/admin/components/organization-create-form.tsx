import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { auth } from "@admin/lib/auth";

type SlugStatus = "idle" | "checking" | "available" | "taken" | "error";

export function OrganizationCreateForm({
  onCreated,
}: {
  onCreated: () => Promise<void>;
}) {
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
    const available = result.data?.status === true;
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
      setName("");
      setSlug("");
      setSlugEdited(false);
      setSlugStatus("idle");
      await onCreated();
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createOrganization.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an organization</CardTitle>
        <CardDescription>
          The slug is public, unique, and editable before creation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="organization-name">Name</Label>
            <Input
              id="organization-name"
              className="min-h-11 md:min-h-8"
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="organization-slug">Slug</Label>
            <Input
              id="organization-slug"
              className="min-h-11 md:min-h-8"
              value={slug}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              aria-describedby="organization-slug-status"
              aria-invalid={slugStatus === "taken" || slugStatus === "error"}
              onBlur={checkSlug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(slugify(event.target.value));
                setSlugStatus("idle");
              }}
            />
            <p
              id="organization-slug-status"
              className="text-muted-foreground min-h-4 text-xs"
              aria-live="polite"
            >
              {slugStatusText(slugStatus)}
            </p>
          </div>

          {createOrganization.error ? (
            <p className="text-destructive text-sm" role="alert">
              {createOrganization.error.message}
            </p>
          ) : null}

          <Button
            type="submit"
            className="min-h-11 md:min-h-8"
            disabled={
              !name ||
              !slug ||
              slugStatus === "checking" ||
              slugStatus === "taken" ||
              createOrganization.isPending
            }
          >
            {createOrganization.isPending
              ? "Creating organization…"
              : "Create organization"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function slugStatusText(status: SlugStatus): string {
  switch (status) {
    case "checking": {
      return "Checking the slug…";
    }
    case "available": {
      return "This slug is available.";
    }
    case "taken": {
      return "This slug is in use. Choose another slug.";
    }
    case "error": {
      return "The slug check failed. Check the api and try again.";
    }
    default: {
      return "Use lowercase letters, numbers, and hyphens.";
    }
  }
}
