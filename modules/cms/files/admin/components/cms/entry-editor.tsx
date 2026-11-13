import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { HistoryIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  emptyValues,
  formLayout,
  isDirty,
  nextSlug,
  seoPlaceholders,
  slugPrefix,
  toPayload,
  valuesFromEntry,
} from "@repo/cms";
import type {
  Collection,
  FormField,
  FormValues,
  MediaValue,
  RichTextDocument,
  SeoValue,
  TextField,
} from "@repo/cms";
import { RichTextEditor } from "@repo/cms/editor";
import type { EditorToolbarState } from "@repo/cms/editor";
import { config } from "@repo/config";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/shell/alert";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@repo/ui/components/shell/input-group";
import { Textarea } from "@repo/ui/components/shell/textarea";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import {
  EDITOR_CONTENT_CLASS,
  EditorToolbar,
} from "@admin/components/cms/editor-toolbar";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  MediaPicker,
} from "@admin/components/cms/media-picker";
import { RevisionsSheet } from "@admin/components/cms/revisions-sheet";
import { usePageTrail } from "@admin/components/page-trail";
import { CmsStatusPill } from "@admin/components/cms/status-pill";
import {
  CmsRequestError,
  cmsKeys,
  createEntry,
  entryQuery,
  publishEntry,
  restoreRevision,
  revisionsQuery,
  saveEntry,
  unpublishEntry,
  uploadImage,
} from "@admin/lib/cms-api";
import type { CmsEntry, CmsRevision } from "@admin/lib/cms-api";
import {
  conflictText,
  revisionNumbers,
  savedLine,
  shortDate,
} from "@admin/lib/cms-format";
import type { CmsConflict, CmsWriteAction } from "@admin/lib/cms-format";
import { pickFile } from "@admin/lib/cms-pick-file";
import { useNow } from "@admin/lib/cms-now";

// The editor for one entry of any collection, new or stored. The form is generated from
// the collection definition: `formLayout` splits the fields into the main column and the
// 20rem side column, and each field kind draws one control. A collection with the five
// builder kinds needs no screen code of its own.
//
// Every write sends the `version` the form started from. A stale one answers 409 with who
// saved last and when, and the screen shows the conflict alert with one action, Reload.

type Values = FormValues;

/** Who won a write race, and which of this form's writes lost it. */
interface Conflict {
  action: CmsWriteAction;
  conflict: CmsConflict;
}

function fieldId(base: string, key: string) {
  return `${base}-${key}`;
}

/** A side-column panel: a small card with a title and an optional line under it. */
function SidePanel({
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
      <CardPanel className="grid gap-4 p-4">{children}</CardPanel>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

function ConflictAlert({
  singular,
  conflict,
  now,
  onReload,
  reloading,
}: {
  singular: string;
  conflict: Conflict;
  now: Date;
  onReload: () => void;
  reloading: boolean;
}) {
  const text = conflictText({
    action: conflict.action,
    conflict: conflict.conflict,
    now,
    singular,
  });
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>{text.description}</AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          disabled={reloading}
          onClick={onReload}
        >
          <RefreshCwIcon />
          Reload
        </Button>
      </AlertAction>
    </Alert>
  );
}

function renderToolbar(state: EditorToolbarState) {
  return <EditorToolbar {...state} />;
}

/** Body images carry `src` for the editor's view; fill it in from the api's URLs. */
function withImageSources(
  value: unknown,
  urls: Record<string, string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withImageSources(item, urls));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(record)) {
    next[key] = withImageSources(inner, urls);
  }
  if (record.type === "image" && typeof record.attrs === "object") {
    const attrs = record.attrs as Record<string, unknown>;
    const url =
      typeof attrs.storageKey === "string" ? urls[attrs.storageKey] : undefined;
    if (url !== undefined && !attrs.src) {
      next.attrs = { ...attrs, src: url };
    }
  }
  return next;
}

function valuesOf(collection: Collection, entry: CmsEntry): Values {
  const values = valuesFromEntry(collection, entry);
  return {
    ...values,
    data: withImageSources(values.data, entry.mediaUrls) as Values["data"],
  };
}

export function EntryEditor({
  collection,
  entry: initial,
}: {
  collection: Collection;
  /** The stored entry, or undefined for a new one. */
  entry: CmsEntry | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = useId();
  const layout = formLayout(collection);
  const now = useNow();

  const [entry, setEntry] = useState(initial);
  const [saved, setSaved] = useState<Values>(() =>
    initial ? valuesOf(collection, initial) : emptyValues(collection)
  );
  const [values, setValues] = useState<Values>(saved);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>(
    initial?.mediaUrls ?? {}
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, setPending] = useState<CmsWriteAction | "reload" | null>(
    null
  );
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Set once a new entry is created, so the action that created it can move the address.
  const createdId = useRef<string | null>(null);

  const revisions = useQuery({
    ...revisionsQuery(collection.name, entry?.id ?? ""),
    enabled: entry !== undefined,
  });

  const dirty = entry === undefined || isDirty(collection, saved, values);
  const singular = collection.singular.toLowerCase();

  /** Take a stored entry as the form's new starting point. */
  function adopt(next: CmsEntry) {
    const nextValues = valuesOf(collection, next);
    setEntry(next);
    setSaved(nextValues);
    setValues(nextValues);
    setMediaUrls((current) => ({ ...current, ...next.mediaUrls }));
    queryClient.setQueryData(cmsKeys.entry(collection.name, next.id), next);
    void queryClient.invalidateQueries({
      queryKey: cmsKeys.all(collection.name),
    });
  }

  function fail(action: CmsWriteAction, error: unknown) {
    if (error instanceof CmsRequestError && error.conflict) {
      setConflict({ action, conflict: error.conflict });
      return;
    }
    toastManager.add({
      description:
        error instanceof Error ? error.message : "The api did not answer.",
      title: `The ${action} did not go through`,
      type: "error",
    });
  }

  /** Save the draft, creating the entry first when it is new. Answers the stored entry. */
  async function persist(): Promise<CmsEntry> {
    const draft = toPayload(collection, values);
    if (entry === undefined) {
      const created = await createEntry(collection.name, draft);
      createdId.current = created.id;
      adopt(created);
      return created;
    }
    if (!isDirty(collection, saved, values)) {
      return entry;
    }
    const stored = await saveEntry(collection.name, entry.id, {
      ...draft,
      version: entry.version,
    });
    adopt(stored);
    return stored;
  }

  async function run(action: CmsWriteAction, work: () => Promise<void>) {
    setPending(action);
    try {
      await work();
    } catch (error) {
      fail(action, error);
    }
    setPending(null);
    // A new entry moves to its stored address once every write of the action is done, so
    // the stored editor opens on the final version (a publish runs two writes).
    const created = createdId.current;
    if (entry === undefined && created !== null) {
      void navigate({
        params: { collection: collection.name, entryId: created },
        replace: true,
        to: "/cms/$collection/$entryId",
      });
    }
  }

  const saveDraft = () =>
    run("save", async () => {
      await persist();
      toastManager.add({ title: "Draft saved", type: "success" });
    });

  const publish = () =>
    run("publish", async () => {
      const stored = await persist();
      const published = await publishEntry(
        collection.name,
        stored.id,
        stored.version
      );
      adopt(published);
      toastManager.add({
        description: "The live post updates within a minute.",
        title: "Published",
        type: "success",
      });
    });

  const unpublish = () =>
    run("unpublish", async () => {
      if (!entry) {
        return;
      }
      adopt(await unpublishEntry(collection.name, entry.id, entry.version));
      toastManager.add({
        description: "It is a draft again. Its revisions are kept.",
        title: "Unpublished",
        type: "success",
      });
    });

  const restore = (revision: CmsRevision, number: number) =>
    run("restore", async () => {
      if (!entry) {
        return;
      }
      setRestoringId(revision.id);
      let restored: CmsEntry;
      try {
        restored = await restoreRevision(
          collection.name,
          entry.id,
          revision.id,
          entry.version
        );
      } catch (error) {
        setRestoringId(null);
        throw error;
      }
      setRestoringId(null);
      adopt(restored);
      setRevisionsOpen(false);
      toastManager.add({
        description: "Publish to make it live.",
        title: `Revision ${String(number)} restored into the draft`,
        type: "success",
      });
    });

  async function reload() {
    if (!entry) {
      return;
    }
    setPending("reload");
    try {
      const fresh = await queryClient.fetchQuery({
        ...entryQuery(collection.name, entry.id),
        staleTime: 0,
      });
      adopt(fresh);
      setConflict(null);
    } catch (error) {
      fail("save", error);
    }
    setPending(null);
  }

  function setData(key: string, value: unknown) {
    setValues((current) => ({
      ...current,
      data: { ...current.data, [key]: value },
    }));
  }

  function setMedia(
    key: string,
    value: MediaValue | null,
    url: string | undefined
  ) {
    if (value && url) {
      setMediaUrls((current) => ({ ...current, [value.key]: url }));
    }
    setData(key, value);
  }

  async function requestImage() {
    const file = await pickFile(IMAGE_TYPES);
    if (!file) {
      return null;
    }
    if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
      toastManager.add({
        description: `${file.name} is not a PNG, JPEG, WebP or GIF image.`,
        title: "That image was not added",
        type: "error",
      });
      return null;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toastManager.add({
        description: `${file.name} is over the 10 MB limit.`,
        title: "That image was not added",
        type: "error",
      });
      return null;
    }
    try {
      return await uploadImage(file);
    } catch (error) {
      toastManager.add({
        description: error instanceof Error ? error.message : undefined,
        title: "The image did not upload",
        type: "error",
      });
      return null;
    }
  }

  const placeholders = seoPlaceholders(values);
  const busy = pending !== null;
  const live = revisions.data?.find((revision) => revision.live);
  const liveNumber =
    live && revisions.data
      ? revisionNumbers(revisions.data.length)[revisions.data.indexOf(live)]
      : undefined;
  const title =
    values.title.trim() === "" ? `New ${singular}` : values.title.trim();
  usePageTrail([
    { label: collection.label, to: `/cms/${collection.name}` },
    { label: title },
  ]);

  function control(item: FormField): ReactNode {
    const { field, key } = item;
    const id = fieldId(base, key);
    if (key === "title") {
      const titleField = field as TextField;
      return (
        <Field key={key}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <Input
            id={id}
            size="lg"
            maxLength={titleField.maxLength}
            value={values.title}
            onChange={(event) => {
              const next = event.target.value;
              setValues((current) => ({
                ...current,
                slug:
                  entry?.publishedAt === null || entry === undefined
                    ? nextSlug({
                        previousTitle: current.title,
                        slug: current.slug,
                        title: next,
                      })
                    : current.slug,
                title: next,
              }));
            }}
          />
          {field.help === undefined ? null : (
            <FieldDescription>{field.help}</FieldDescription>
          )}
        </Field>
      );
    }
    if (field.kind === "slug") {
      return (
        <Field key={key}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>
                {slugPrefix(collection.name, config.cms.basePath)}
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={id}
              value={values.slug}
              maxLength={96}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  slug: event.target.value,
                }));
              }}
            />
          </InputGroup>
          {field.help === undefined ? null : (
            <FieldDescription>{field.help}</FieldDescription>
          )}
        </Field>
      );
    }
    if (field.kind === "richText") {
      const labelId = `${id}-label`;
      return (
        <Field key={key} className="min-w-0 items-stretch">
          <FieldLabel id={labelId} nativeLabel={false} render={<span />}>
            {field.label}
          </FieldLabel>
          <RichTextEditor
            labelledBy={labelId}
            value={values.data[key] as RichTextDocument | undefined}
            onChange={(next) => {
              setData(key, next);
            }}
            onNormalize={(next) => {
              // The editor's own form of a body it loaded. While the admin has not edited
              // the body, the saved baseline moves with it, so the form stays clean.
              if (saved.data[key] === values.data[key]) {
                setSaved((current) => ({
                  ...current,
                  data: { ...current.data, [key]: next },
                }));
              }
              setData(key, next);
            }}
            onRequestImage={requestImage}
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
          {field.help === undefined ? null : (
            <FieldDescription>{field.help}</FieldDescription>
          )}
        </Field>
      );
    }
    if (field.kind === "media") {
      const value = (values.data[key] ?? null) as MediaValue | null;
      const picker = (
        <MediaPicker
          id={id}
          label={field.label}
          value={value}
          url={value ? mediaUrls[value.key] : undefined}
          upload={uploadImage}
          disabled={busy}
          onChange={(next, url) => {
            setMedia(key, next, url);
          }}
        />
      );
      return item.placement === "side" ? (
        <SidePanel key={key} title={field.label} description={field.help}>
          {picker}
        </SidePanel>
      ) : (
        <Field key={key}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          {picker}
        </Field>
      );
    }
    if (field.kind === "seo") {
      const seo = (values.data[key] ?? {}) as SeoValue;
      const setSeo = (patch: Partial<SeoValue>) => {
        setData(key, { ...seo, ...patch });
      };
      const og = seo.ogImage ?? null;
      const body = (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>Meta title</FieldLabel>
            <Input
              id={`${id}-title`}
              maxLength={70}
              placeholder={placeholders.metaTitle}
              value={seo.metaTitle ?? ""}
              onChange={(event) => {
                setSeo({ metaTitle: event.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-description`}>
              Meta description
            </FieldLabel>
            <Textarea
              id={`${id}-description`}
              maxLength={160}
              placeholder={placeholders.metaDescription}
              value={seo.metaDescription ?? ""}
              onChange={(event) => {
                setSeo({ metaDescription: event.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-og`}>Open Graph image</FieldLabel>
            <MediaPicker
              id={`${id}-og`}
              label="Open Graph image"
              value={og}
              url={og ? mediaUrls[og.key] : undefined}
              upload={uploadImage}
              disabled={busy}
              hint="1200 × 630 works best. Empty uses the cover image."
              onChange={(next, url) => {
                if (next && url) {
                  setMediaUrls((current) => ({ ...current, [next.key]: url }));
                }
                setSeo({ ogImage: next });
              }}
            />
          </Field>
        </>
      );
      return item.placement === "side" ? (
        <SidePanel key={key} title={field.label} description={field.help}>
          {body}
        </SidePanel>
      ) : (
        <fieldset key={key} className="grid gap-4">
          <legend className="text-sm font-medium">{field.label}</legend>
          {body}
        </fieldset>
      );
    }
    // A plain text field: a textarea when multiline, else an input.
    const textField = field as TextField;
    const value = typeof values.data[key] === "string" ? values.data[key] : "";
    const input = textField.multiline ? (
      <Textarea
        id={id}
        maxLength={textField.maxLength}
        value={value}
        onChange={(event) => {
          setData(key, event.target.value);
        }}
        {...(item.placement === "side" ? { "aria-label": field.label } : {})}
      />
    ) : (
      <Input
        id={id}
        maxLength={textField.maxLength}
        value={value}
        onChange={(event) => {
          setData(key, event.target.value);
        }}
        {...(item.placement === "side" ? { "aria-label": field.label } : {})}
      />
    );
    return item.placement === "side" ? (
      <SidePanel key={key} title={field.label} description={field.help}>
        <Field>{input}</Field>
      </SidePanel>
    ) : (
      <Field key={key}>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        {input}
        {field.help === undefined ? null : (
          <FieldDescription>{field.help}</FieldDescription>
        )}
      </Field>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title={title}
        description={
          <span className="inline-flex items-center gap-2">
            <CmsStatusPill status={entry?.status ?? "draft"} />
            <span className="truncate">
              {entry
                ? savedLine(entry, now)
                : `Not saved yet. Save a draft or publish to store the ${singular}.`}
              {entry && dirty ? " Unsaved changes in this form." : ""}
            </span>
          </span>
        }
        actions={
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
            {entry ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRevisionsOpen(true);
                }}
              >
                <HistoryIcon />
                Revisions
              </Button>
            ) : null}
            {entry?.status === "published" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void unpublish();
                }}
              >
                {pending === "unpublish" ? "Unpublishing…" : "Unpublish"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void saveDraft();
              }}
            >
              {pending === "save" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void publish();
              }}
            >
              {pending === "publish" ? "Publishing…" : "Publish"}
            </Button>
          </div>
        }
      />
      <PageBody>
        {conflict ? (
          <ConflictAlert
            singular={collection.singular}
            conflict={conflict}
            now={now}
            reloading={pending === "reload"}
            onReload={() => {
              void reload();
            }}
          />
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid min-w-0 content-start gap-5">
            {layout.main.map(control)}
          </div>
          <div className="grid content-start gap-4">
            <SidePanel title="Publishing">
              <dl className="grid gap-2">
                <Row label="Status">
                  <CmsStatusPill status={entry?.status ?? "draft"} />
                </Row>
                <Row label="Live revision">
                  {liveNumber === undefined
                    ? "None"
                    : `Revision ${String(liveNumber)}`}
                </Row>
                <Row label="First published">
                  {entry?.publishedAt
                    ? shortDate(entry.publishedAt)
                    : "Not yet"}
                </Row>
                <Row label="Last published">
                  {live ? shortDate(live.createdAt) : "Not yet"}
                </Row>
                <Row label="Author">
                  {entry === undefined ? (
                    "You"
                  ) : entry.authorName === null ? (
                    <span className="text-muted-foreground">No author</span>
                  ) : (
                    entry.authorName
                  )}
                </Row>
              </dl>
            </SidePanel>
            {layout.side.map(control)}
          </div>
        </div>
      </PageBody>
      <RevisionsSheet
        open={revisionsOpen}
        onOpenChange={setRevisionsOpen}
        revisions={revisions.data}
        loading={revisions.isPending && entry !== undefined}
        busyId={restoringId}
        onRestore={(revision, number) => {
          void restore(revision, number);
        }}
      />
    </PageLayout>
  );
}
